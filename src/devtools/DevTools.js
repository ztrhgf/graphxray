import React from "react";
import "./DevTools.css";
import { CodeView } from "../components/CodeView";
import { AppHeader } from "../components/AppHeader";
import { FontSizes } from "@fluentui/theme";
import { getTheme } from "@fluentui/react";
import {
  getCodeView,
  getRequestBody,
  getResponseContent,
  isBatchEndpoint,
  parseBatchRequestResponse,
  resolveSubrequestUrl,
} from "../common/client.js";
import { isAllowedDomain } from "../common/domains.js";
import { Dropdown } from "@fluentui/react/lib/Dropdown";
import { Toggle } from "@fluentui/react/lib/Toggle";
import { IconButton } from "@fluentui/react/lib/Button";
import { TooltipHost } from "@fluentui/react/lib/Tooltip";
import DevToolsCommandBar from "../components/DevToolsCommandBar";
import { Layer } from "@fluentui/react/lib/Layer";

const theme = getTheme();

const dropdownStyles = {
  dropdown: { width: 300 },
};

const languageOptions = [
  { key: "powershell", text: "PowerShell", fileExt: "ps1" },
  { key: "python", text: "Python", fileExt: "py" },
  { key: "c#", text: "C#", fileExt: "cs" },
  { key: "javascript", text: "JavaScript", fileExt: "js" },
  { key: "java", text: "Java", fileExt: "java" },
  { key: "objective-c", text: "Objective-C", fileExt: "c" },
  { key: "go", text: "Go", fileExt: "go" },
];

const methodOptions = [
  { key: "ALL", text: "All Methods" },
  { key: "GET", text: "GET" },
  { key: "POST", text: "POST" },
  { key: "PUT", text: "PUT" },
  { key: "PATCH", text: "PATCH" },
  { key: "DELETE", text: "DELETE" },
  { key: "HEAD", text: "HEAD" },
  { key: "OPTIONS", text: "OPTIONS" },
];

class DevTools extends React.Component {
  constructor() {
    super();
    const savedUltraXRayMode = localStorage.getItem("graphxray-ultraXRayMode");
    const ultraXRayMode = savedUltraXRayMode ? JSON.parse(savedUltraXRayMode) : false;
    const savedShowApiTranslation = localStorage.getItem("graphxray-showApiTranslation");
    const showApiTranslation = savedShowApiTranslation
      ? JSON.parse(savedShowApiTranslation)
      : false;

    this.state = {
      stack: [],
      snippetLanguage: "powershell",
      ultraXRayMode: ultraXRayMode,
      showApiTranslation: showApiTranslation,
      methodFilter: "ALL",
    };
  }

  componentDidMount() {
    this.addListener();
    this.addListenerGraph();
  }

  clearStack = () => {
    this.setState({ stack: [] });
  };

  saveScript = () => {
    const script = this.getSaveScriptContent();
    const languageOpt = languageOptions.filter((opt) => {
      return opt.key === this.state.snippetLanguage;
    });
    const fileName = "GraphXRaySession." + languageOpt[0].fileExt;
    this.downloadFile(script, fileName);
  };

  copyScript = () => {
    const script = this.getSaveScriptContent();
    navigator.clipboard.writeText(script);
  };

  getSaveScriptContent() {
    let script = "";
    this.state.stack.forEach((request) => {
      if (request.code) {
        script += "\n\n" + request.code;
      }
    });
    return script;
  }

  getFilteredStack = () => {
    if (this.state.methodFilter === "ALL") {
      return this.state.stack;
    }

    return this.state.stack.filter((request) => {
      const method = request.method || (request.displayRequestUrl || "").split(" ")[0];
      return method === this.state.methodFilter;
    });
  };

  downloadFile(content, filename) {
    const element = document.createElement("a");
    const file = new Blob([content], {
      type: "text/plain",
    });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
  }

  addListenerGraph() {
    if (!window.chrome.webview) {
      return;
    }
    window.chrome.webview.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.eventName === "GraphCall") {
        this.showRequest(msg);
      }
    });
  }

  async addRequestToStack(request, version, harEntry = null, overrides = {}, metadata = {}) {
    const codeView = await getCodeView(
      this.state.snippetLanguage,
      request,
      version,
      harEntry,
      overrides,
      metadata
    );

    if (codeView) {
      this.setState((prevState) => ({ stack: [...prevState.stack, codeView] }));
    }
  }

  addListener() {
    if (!chrome.devtools) {
      return;
    }

    chrome.devtools.network.onRequestFinished.addListener(async (harEntry) => {
      try {
        if (
          harEntry.request &&
          harEntry.request.url &&
          isAllowedDomain(harEntry.request.url, this.state.ultraXRayMode)
        ) {
          const request = harEntry.request;
          request._harEntry = harEntry;
          await this.showRequest(request, harEntry);
        }
      } catch (error) {
        console.log(error);
      }
    });
  }

  async showRequest(request, harEntry = null) {
    if (isBatchEndpoint(request.url)) {
      try {
        const batchRequestBody = await getRequestBody(request);
        const batchResponseContent = harEntry ? await getResponseContent(harEntry) : "";
        const batchItems = parseBatchRequestResponse(
          batchRequestBody,
          batchResponseContent,
          request.url
        );

        if (batchItems && batchItems.length > 0) {
          for (const batchItem of batchItems) {
            const fullUrl = resolveSubrequestUrl(request.url, batchItem.url);
            const syntheticRequest = {
              method: batchItem.method,
              url: fullUrl,
            };

            await this.addRequestToStack(
              syntheticRequest,
              "",
              null,
              {
                requestBody: batchItem.requestBody || "",
                responseContent: batchItem.responseBody || "",
              },
              {
                isBatchDerived: true,
                batchRequestId: batchItem.id,
                batchParentUrl: batchItem.parentBatchUrl,
                responseStatus: batchItem.responseStatus,
              }
            );
          }
          return;
        }
      } catch (error) {
        console.log("Batch expansion failed, falling back to parent row:", error);
      }
    }

    await this.addRequestToStack(request, "", harEntry);
  }

  onLanguageChange = (e, option) => {
    this.setState({ snippetLanguage: option.key });
    this.clearStack();
  };

  onMethodFilterChange = (e, option) => {
    this.setState({ methodFilter: option.key });
  };

  onUltraXRayToggle = (e, checked) => {
    this.setState({ ultraXRayMode: checked });
    localStorage.setItem("graphxray-ultraXRayMode", JSON.stringify(checked));
    this.clearStack();
  };

  onShowApiTranslationToggle = (e, checked) => {
    this.setState({ showApiTranslation: checked });
    localStorage.setItem("graphxray-showApiTranslation", JSON.stringify(checked));
  };

  render() {
    const filteredStack = this.getFilteredStack();

    return (
      <div className="App" style={{ fontSize: FontSizes.size12 }}>
        <Layer>
          <div
            style={{
              boxShadow: theme.effects.elevation4,
            }}
          >
            <AppHeader hideSettings={true}></AppHeader>
            <DevToolsCommandBar
              clearStack={this.clearStack}
              saveScript={this.saveScript}
              copyScript={this.copyScript}
            ></DevToolsCommandBar>
          </div>
        </Layer>
        <header className="App-header">
          <div
            style={{
              boxShadow: theme.effects.elevation16,
              padding: "10px",
              marginTop: "80px",
              marginBottom: "15px",
            }}
          >
            <h2>Graph Call Stack Trace</h2>
            <p>
              Displays the Graph API calls that are being made by the current
              browser tab. Code conversions are only available for published Graph APIs.
              Turn on <strong>Ultra X-Ray</strong> mode to see all API calls (open a <a href="https://github.com/merill/graphxray/issues" target="_blank" rel="noreferrer">GitHub issue</a> if there are admin portals or blades that are not being captured).
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "20px",
                flexWrap: "wrap",
              }}
            >
              <Dropdown
                placeholder="Select an option"
                label="Select language"
                options={languageOptions}
                styles={dropdownStyles}
                defaultSelectedKey={this.state.snippetLanguage}
                onChange={this.onLanguageChange}
              />

              <Dropdown
                placeholder="All methods"
                label="HTTP method"
                options={methodOptions}
                styles={dropdownStyles}
                selectedKey={this.state.methodFilter}
                onChange={this.onMethodFilterChange}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <Toggle
                  label="Ultra X-Ray"
                  checked={this.state.ultraXRayMode}
                  onChange={this.onUltraXRayToggle}
                  onText="On"
                  offText="Off"
                  styles={{
                    root: { marginBottom: 0 },
                    label: { fontWeight: "600" },
                  }}
                />
                <TooltipHost
                  content="Enables ultra mode which allows you to see API calls that are not publicly documented by Microsoft. These are meant for educational purposes. These endpoints should not be used in custom scripts as they are not supported by Microsoft and are only meant for internal use."
                  styles={{
                    root: {
                      display: "inline-block",
                    },
                  }}
                >
                  <IconButton
                    iconProps={{ iconName: "Info" }}
                    title="Ultra X-Ray Information"
                    styles={{
                      root: {
                        minWidth: "24px",
                        width: "24px",
                        height: "24px",
                        color: "#666",
                        backgroundColor: "transparent",
                        border: "1px solid #ccc",
                        borderRadius: "50%",
                      },
                      rootHovered: {
                        backgroundColor: "rgba(0, 0, 0, 0.05)",
                        color: "#333",
                      },
                    }}
                  />
                </TooltipHost>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <Toggle
                  label="Translate to command"
                  checked={this.state.showApiTranslation}
                  onChange={this.onShowApiTranslationToggle}
                  onText="On"
                  offText="Off"
                  styles={{
                    root: { marginBottom: 0 },
                    label: { fontWeight: "600" },
                  }}
                />
                <TooltipHost
                  content={`Generates a ${this.state.snippetLanguage} command snippet for each captured API call.`}
                  styles={{
                    root: {
                      display: "inline-block",
                    },
                  }}
                >
                  <IconButton
                    iconProps={{ iconName: "Info" }}
                    title="Translate to command information"
                    styles={{
                      root: {
                        minWidth: "24px",
                        width: "24px",
                        height: "24px",
                        color: "#666",
                        backgroundColor: "transparent",
                        border: "1px solid #ccc",
                        borderRadius: "50%",
                      },
                      rootHovered: {
                        backgroundColor: "rgba(0, 0, 0, 0.05)",
                        color: "#333",
                      },
                    }}
                  />
                </TooltipHost>
              </div>
            </div>
          </div>
          {filteredStack && filteredStack.length > 0 && (
            <div
              style={{
                boxShadow: theme.effects.elevation16,
                padding: "10px",
                marginBottom: "15px",
              }}
            >
              {filteredStack.map((request, index) => (
                <div
                  key={index}
                  style={{
                    boxShadow: theme.effects.elevation16,
                    padding: "10px",
                    marginBottom: "15px",
                    borderRadius: "8px",
                  }}
                >
                  <CodeView
                    request={request}
                    lightUrl={true}
                    snippetLanguage={this.state.snippetLanguage}
                    showApiTranslation={this.state.showApiTranslation}
                  ></CodeView>
                </div>
              ))}
            </div>
          )}
        </header>
      </div>
    );
  }
}

export default DevTools;
