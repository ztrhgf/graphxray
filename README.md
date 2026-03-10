# Microsoft X-Ray

(this is modified version of the Merill`s Graph X-Ray extension https://github.com/merill/graphxray)

Microsoft X-Ray is a browser DevTools extension for learning and automating Microsoft Graph and related admin portal API traffic. It captures requests made by the current tab, shows request and response details, and can generate command/code snippets for supported languages.

![Microsoft X-Ray demo](./public/img/tutorial/graphxraydemo.gif)

## Installation (Local Build Only)

Microsoft X-Ray is currently installed by building it locally with npm and loading the unpacked extension in your browser developer settings.

### Prerequisites

- Node.js (includes npm)

### Build the extension
(in cloned repository root)
1. Install dependencies:

```bash
npm install
```

2. Create a production build:

```bash
npm run build
```

3. Build output is generated in:

- `build/graphxray`

### Load into browser (Developer Mode)

1. Open extensions page:
- Edge: `edge://extensions`
- Chrome: `chrome://extensions`
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `build/graphxray` folder.

## How Microsoft X-Ray Works

Microsoft X-Ray listens to network requests in DevTools and stores request metadata for supported domains. It then renders each captured call in the Microsoft X-Ray panel.

### Domain capture modes

- Default mode captures standard endpoints, including:
  - `https://graph.microsoft.com`
  - `https://graph.microsoft.us`
  - `https://dod-graph.microsoft.us`
  - `https://microsoftgraph.chinacloudapi.cn`
  - `https://management.azure.com`
- Ultra X-Ray mode (toggle) expands capture to additional undocumented/internal endpoints for exploration.

### HTTP method filtering

Use the HTTP method dropdown in the DevTools panel to filter captured rows by method:

- `ALL`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`

### Command translation behavior

- By default, command translation is **off**.
- Enable it with the **Translate to command** toggle.
- When enabled, Microsoft X-Ray generates snippets in the selected language (PowerShell, Python, C#, JavaScript, Java, Objective-C, Go).

### PowerShell translation fallback

For PowerShell snippets, Microsoft X-Ray first attempts to generate a command via the DevX snippet service. If generation fails (or if the call is from an Ultra X-Ray domain), it falls back to local command generation:

- `Invoke-MgGraphRequest` for Microsoft Graph endpoints
- `Invoke-AzRestMethod` for Azure domain requests
- `Invoke-RestMethod` with auth/content-type headers for other endpoints

This ensures PowerShell output is still available when cloud snippet generation is unavailable.

### Batch request expansion

For supported batch endpoints (for example `/$batch`), Microsoft X-Ray attempts to:

1. Parse the parent batch request body
2. Parse the batch response
3. Match sub-requests and sub-responses by ID
4. Expand them into individual rows in the panel

If parsing fails, Microsoft X-Ray falls back to showing the parent batch row.

## Usage

1. Open a Microsoft admin portal page.
2. Open browser Developer Tools.
3. Open the Microsoft X-Ray tab.
4. Perform actions in the portal.
5. Inspect captured requests, request/response bodies, and optional command translations.