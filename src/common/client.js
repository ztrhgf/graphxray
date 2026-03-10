import { parseGraphUrl, GRAPH_DOMAINS, isUltraXRayDomain } from "./domains.js";

const devxEndPoint =
  "https://devxapi-func-prod-eastus.azurewebsites.net/api/graphexplorersnippets";

const getFallbackPowershellCmd = function (method, url, body) {
  const upperMethod = (method || "GET").toUpperCase();
  const bodyText = body ?? "";
  const hasBody = bodyText.length > 0;
  const escapedBody = bodyText.replace(/\r/g, "").replace(/`/g, "``");
  const isGraphRequest = GRAPH_DOMAINS.STANDARD.some((domain) =>
    url.includes(domain) && domain.includes("graph.microsoft")
  );
  let hostName = "";
  try {
    hostName = new URL(url).hostname;
  } catch (error) {
    hostName = "";
  }
  const isAzureDomain = hostName.endsWith(".azure.com");

  const lines = [];

  if (hasBody) {
    lines.push("$body = @'");
    lines.push(escapedBody);
    lines.push("'@");
    lines.push("");
  }

  if (isGraphRequest) {
    let command = `Invoke-MgGraphRequest -Method ${upperMethod} -Uri "${url}"`;
    if (hasBody) {
      command += " -Body $body -ContentType \"application/json\"";
    }
    lines.push(command);
  } else if (isAzureDomain) {
    let command = `Invoke-AzRestMethod -Method ${upperMethod} -Uri "${url}"`;
    if (hasBody) {
      command += " -Payload $body";
    }
    lines.push(command);
  } else {
    lines.push("$headers = @{");
    lines.push('  "Authorization" = "Bearer <token>"');
    if (hasBody) {
      lines.push('  "Content-Type" = "application/json"');
    }
    lines.push("}");
    lines.push("");
    let command = `Invoke-RestMethod -Method ${upperMethod} -Uri "${url}" -Headers $headers`;
    if (hasBody) {
      command += " -Body $body";
    }
    lines.push(command);
  }

  return lines.join("\n");
};

const getPowershellCmd = async function (snippetLanguage, method, url, body) {
  console.log("Get code snippet from DevX:", url, method);
  
  if (isUltraXRayDomain(url)) {
    console.log("Skipping DevX call for Ultra X-Ray domain:", url);
    return snippetLanguage === "powershell"
      ? getFallbackPowershellCmd(method, url, body)
      : null;
  }
  
  const bodyText = body ?? "";
  const { path: parsedPath, host } = parseGraphUrl(url);
  const path = encodeURI(parsedPath);
  const payload = `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\nContent-Type: application/json\r\n\r\n${bodyText}`;
  console.log("Payload:", payload);

  const snippetParam = "?lang=%snippetLanguage%".replace(
    "%snippetLanguage%",
    snippetLanguage
  );
  const openApiParam = "&generation=openapi";

  let devxSnippetUri = devxEndPoint;
  if (snippetLanguage === "c#") {
    devxSnippetUri = devxEndPoint;
  } else if (["javascript", "java", "objective-c", "powershell"].includes(snippetLanguage)) {
    devxSnippetUri = devxEndPoint + snippetParam;
  } else if (["go", "python"].includes(snippetLanguage)) {
    devxSnippetUri = devxEndPoint + snippetParam + openApiParam;
  }

  try {
    const response = await fetch(devxSnippetUri, {
      headers: {
        "content-type": "application/http",
      },
      method: "POST",
      body: payload,
    });
    console.log("DevX responded");
    if (response.ok) {
      const resp = await response.text();
      console.log("DevX-Response", resp);
      return resp;
    }

    const errorText = await response.text();
    const errorMsg = `DevXError: ${response.status} ${response.statusText} for ${method} ${url} - Response: ${errorText}`;
    console.log(errorMsg);
    return snippetLanguage === "powershell"
      ? getFallbackPowershellCmd(method, url, body)
      : null;
  } catch (error) {
    const errorMsg = `DevXError: Network/Request error for ${method} ${url} - ${
      error.message || error
    }`;
    console.log(errorMsg, error);
    return snippetLanguage === "powershell"
      ? getFallbackPowershellCmd(method, url, body)
      : null;
  }
};
const getRequestBody = async function (request) {
  let requestBody = "";
  
  console.log("getRequestBody - request object:", request);
  console.log("getRequestBody - request.method:", request.method);
  console.log("getRequestBody - request.url:", request.url);
  
  // First, check if the request object directly has a body property (seems to be the case!)
  if (request.body) {
    if (typeof request.body === 'string') {
      requestBody = request.body;
    } else {
      requestBody = JSON.stringify(request.body);
    }
    console.log("getRequestBody - found body in request.body:", requestBody);
    return requestBody;
  }
  
  // Second, try to get from the standard devtools API (limited access)
  if (request.postData && request.postData.text) {
    requestBody = request.postData.text;
    console.log("getRequestBody - found body in postData:", requestBody);
    return requestBody;
  }
  
  // Try using getContent() method if available (for DevTools Network requests)
  // IMPORTANT: This should only get REQUEST content, not response content
  if (!requestBody && request._harEntry && typeof request._harEntry.getContent === 'function') {
    console.log("getRequestBody - trying getContent() method on harEntry for REQUEST body");
    try {
      const content = await new Promise((resolve) => {
        request._harEntry.getContent((content, encoding) => {
          console.log("getRequestBody - getContent returned:", content, encoding);
          resolve(content);
        });
      });
      
      // Only use this if it's actually request content (POST/PUT/PATCH methods typically have bodies)
      if (content && ['POST', 'PUT', 'PATCH'].includes(request.method.toUpperCase())) {
        requestBody = content;
        console.log("getRequestBody - found REQUEST body from getContent:", requestBody);
        return requestBody;
      } else {
        console.log("getRequestBody - ignoring getContent result for GET/DELETE request or empty content");
      }
    } catch (error) {
      console.log("getRequestBody - getContent failed:", error);
    }
  }
  
  // If no body found, try to get from background script using URL
  if (!requestBody && request.url) {
    console.log("getRequestBody - trying background script with URL:", request.url);
    try {
      // Generate URLs to try based on standard Graph domains
      const urlsToTry = [request.url];
      
      // Add variations for standard Graph endpoints
      GRAPH_DOMAINS.STANDARD.forEach(domain => {
        urlsToTry.push(`${domain}/v1.0${request.url}`);
        urlsToTry.push(`${domain}/beta${request.url}`);
      });
      
      for (const url of urlsToTry) {
        const response = await chrome.runtime.sendMessage({
          type: "GET_REQUEST_BODY",
          url: url
        });
        console.log("getRequestBody - background script response for", url, ":", response);
        if (response && response.body) {
          requestBody = response.body;
          console.log("getRequestBody - found body from background script:", requestBody);
          return requestBody;
        }
      }
    } catch (error) {
      console.log("Could not get request body from background script:", error);
    }
  }
  
  console.log("getRequestBody - final result (should only be REQUEST body):", requestBody);
  return requestBody;
};

const getResponseContent = async function (harEntry) {
  let responseContent = "";
  
  console.log("getResponseContent - harEntry:", harEntry);
  console.log("getResponseContent - harEntry type:", typeof harEntry);
  
  // Try to get response content from harEntry
  if (harEntry && harEntry.response) {
    console.log("getResponseContent - response object:", harEntry.response);
    console.log("getResponseContent - response status:", harEntry.response.status);
    console.log("getResponseContent - response headers:", harEntry.response.headers);
    console.log("getResponseContent - response content object:", harEntry.response.content);
    
    // Check if response has content directly in the content.text property
    if (harEntry.response.content && harEntry.response.content.text !== undefined) {
      responseContent = harEntry.response.content.text;
      console.log("getResponseContent - raw content.text:", responseContent, "length:", responseContent.length);
      
      // If it's base64 encoded, decode it
      if (harEntry.response.content.encoding === 'base64') {
        try {
          responseContent = atob(harEntry.response.content.text);
          console.log("getResponseContent - decoded base64 content:", responseContent);
        } catch (e) {
          console.log("Failed to decode base64 content:", e);
          // Keep the original text if decoding fails
        }
      }
      
      console.log("getResponseContent - found content in response.content.text:", responseContent);
      if (responseContent && responseContent.length > 0) {
        return responseContent;
      }
    }
    
    // Try using getResponseBody() method if available (this is different from getContent)
    if (typeof harEntry.getResponseBody === 'function') {
      console.log("getResponseContent - trying getResponseBody() method");
      try {
        const content = await new Promise((resolve) => {
          harEntry.getResponseBody((content, encoding) => {
            console.log("getResponseContent - getResponseBody returned:", content, encoding);
            resolve(content);
          });
        });
        if (content) {
          responseContent = content;
          console.log("getResponseContent - found content from getResponseBody:", responseContent);
          return responseContent;
        }
      } catch (error) {
        console.log("getResponseContent - getResponseBody failed:", error);
      }
    }
    
    // Try using getContent() method which should get the response content for completed requests
    if (typeof harEntry.getContent === 'function') {
      console.log("getResponseContent - trying getContent() method for response content");
      try {
        const content = await new Promise((resolve) => {
          harEntry.getContent((content, encoding) => {
            console.log("getResponseContent - getContent returned:", content, "encoding:", encoding, "content length:", content ? content.length : 0);
            resolve(content);
          });
        });
        if (content && content.length > 0) {
          responseContent = content;
          console.log("getResponseContent - found content from getContent:", responseContent.substring(0, 200) + "...");
          return responseContent;
        }
      } catch (error) {
        console.log("getResponseContent - getContent failed:", error);
      }
    }
    
    // Final attempt: check if there's any content object with size > 0
    if (harEntry.response.content && harEntry.response.content.size > 0) {
      console.log("getResponseContent - response has content with size:", harEntry.response.content.size);
      // Sometimes the content is there but text property is empty string
      if (harEntry.response.content.text === "") {
        console.log("getResponseContent - content.text is empty string but size > 0, this might be an issue with content retrieval");
      }
    }
  }
  
  console.log("getResponseContent - final result:", responseContent);
  return responseContent;
};

const isBatchEndpoint = function (url = "") {
  if (!url || typeof url !== "string") {
    return false;
  }

  return /\/\$batch(?:\?|$)/i.test(url) || /management\.azure\.com\/batch(?:\?|$)/i.test(url);
};

const parseBatchRequestResponse = function (requestBody, responseContent, parentUrl) {
  if (!requestBody || !responseContent) {
    return null;
  }

  try {
    const requestData = JSON.parse(requestBody);
    const responseData = JSON.parse(responseContent);
    const requestItems = Array.isArray(requestData.requests)
      ? requestData.requests
      : Array.isArray(requestData.Requests)
        ? requestData.Requests
        : null;
    const responseItems = Array.isArray(responseData.responses)
      ? responseData.responses
      : Array.isArray(responseData.Responses)
        ? responseData.Responses
        : Array.isArray(responseData.value)
          ? responseData.value
          : null;

    if (!requestItems || !responseItems) {
      return null;
    }

    const getItemId = (item) => {
      if (!item) {
        return null;
      }

      return item.id ?? item.requestId ?? item.name ?? item.contentId ?? null;
    };

    const getRequestMethod = (item) => {
      return (item.method ?? item.httpMethod ?? item.request?.method ?? "GET").toUpperCase();
    };

    const getRequestUrl = (item) => {
      return item.url ?? item.relativeUrl ?? item.path ?? item.request?.url ?? item.httpRequest?.url ?? "";
    };

    const stringifyBody = (value) => {
      if (value === undefined || value === null || value === "") {
        return "";
      }

      if (typeof value === "string") {
        return value;
      }

      return JSON.stringify(value);
    };

    const getResponseStatus = (item) => {
      return item.status ?? item.httpStatusCode ?? item.statusCode ?? item.httpResponse?.statusCode ?? null;
    };

    const getResponseBody = (item) => {
      return stringifyBody(
        item.body ??
          item.content ??
          item.responseBody ??
          item.httpResponse?.body ??
          item.httpResponse?.content
      );
    };

    const responseMap = new Map();
    responseItems.forEach((response) => {
      const responseId = getItemId(response);
      if (responseId) {
        responseMap.set(String(responseId), response);
      }
    });

    const matched = [];
    requestItems.forEach((batchRequest) => {
      const requestId = getItemId(batchRequest);
      if (!requestId) {
        return;
      }

      const response = responseMap.get(String(requestId));
      if (!response) {
        return;
      }

      matched.push({
        id: String(requestId),
        method: getRequestMethod(batchRequest),
        url: getRequestUrl(batchRequest),
        requestBody: stringifyBody(batchRequest.body ?? batchRequest.content ?? batchRequest.payload),
        responseStatus: getResponseStatus(response),
        responseBody: getResponseBody(response),
        parentBatchUrl: parentUrl,
      });
    });

    return matched;
  } catch (error) {
    console.log("Error parsing batch request/response:", error);
    return null;
  }
};

const resolveSubrequestUrl = function (baseUrl, subrequestUrl = "") {
  if (!subrequestUrl) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(subrequestUrl)) {
    return subrequestUrl;
  }

  const baseWithoutBatch = baseUrl
    .replace(/\/\$batch(?:\?.*)?$/i, "")
    .replace(/\/batch(?:\?.*)?$/i, "");

  const normalizedPath = subrequestUrl.startsWith("/") ? subrequestUrl : `/${subrequestUrl}`;
  return `${baseWithoutBatch}${normalizedPath}`;
};
const getBatchCodeSnippets = async function (snippetLanguage, requestBody, baseUrl) {
  console.log("Generating code snippets for batch request");
  
  if (!requestBody) {
    return [];
  }
  
  try {
    const batchData = JSON.parse(requestBody);
    const requestItems = Array.isArray(batchData.requests)
      ? batchData.requests
      : Array.isArray(batchData.Requests)
        ? batchData.Requests
        : [];

    const codeSnippets = [];
    
    for (const request of requestItems) {
      const requestId = request.id ?? request.requestId ?? request.name ?? "batch-item";
      const requestMethod = (request.method ?? request.httpMethod ?? "GET").toUpperCase();
      const requestUrl = request.url ?? request.relativeUrl ?? request.path ?? "";
      console.log("Generating snippet for batch request:", requestId, requestMethod, requestUrl);
      
      const fullUrl = resolveSubrequestUrl(baseUrl, requestUrl);
      const requestBodyText = request.body || request.content
        ? JSON.stringify(request.body ?? request.content)
        : "";
      
      const code = await getPowershellCmd(
        snippetLanguage,
        requestMethod,
        fullUrl,
        requestBodyText
      );
      
      if (code) {
        codeSnippets.push({
          id: requestId,
          method: requestMethod,
          url: requestUrl,
          code: code
        });
      }
    }
    
    console.log("Generated", codeSnippets.length, "code snippets for batch request");
    return codeSnippets;
  } catch (error) {
    console.log("Error generating batch code snippets:", error);
    return [];
  }
};

const getCodeView = async function (snippetLanguage, request, version, harEntry = null, overrides = {}, metadata = {}) {
  if (["OPTIONS"].includes(request.method)) {
    return null;
  }
  console.log("GetCodeView", snippetLanguage, request, harEntry);
  const requestBody = Object.prototype.hasOwnProperty.call(overrides, "requestBody")
    ? overrides.requestBody
    : await getRequestBody(request);
  const responseContent = Object.prototype.hasOwnProperty.call(overrides, "responseContent")
    ? overrides.responseContent
    : harEntry
      ? await getResponseContent(harEntry)
      : "";
  
  let code = null;
  let batchCodeSnippets = [];
  
  // Check if this is a batch request
  if (isBatchEndpoint(request.url)) {
    console.log("Processing batch request for code generation");
    batchCodeSnippets = await getBatchCodeSnippets(snippetLanguage, requestBody, request.url);
    
    // Also generate a code snippet for the main batch request
    code = await getPowershellCmd(
      snippetLanguage,
      request.method,
      version + request.url,
      requestBody
    );
  } else {
    // Regular single request
    code = await getPowershellCmd(
      snippetLanguage,
      request.method,
      version + request.url,
      requestBody
    );
  }
  
  const codeView = {
    method: request.method,
    url: request.url,
    displayRequestUrl: request.method + " " + request.url,
    requestBody: requestBody,
    responseContent: responseContent,
    code: code,
    batchCodeSnippets: batchCodeSnippets, // Add batch code snippets to the result
    ...metadata,
  };
  console.log("CodeView", codeView);
  return codeView;
};
export {
  getPowershellCmd,
  getRequestBody,
  getResponseContent,
  getCodeView,
  getBatchCodeSnippets,
  isBatchEndpoint,
  parseBatchRequestResponse,
  resolveSubrequestUrl,
};


