import * as vscode from "vscode";

export function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

export function getWebviewHtml(options: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  title: string;
  scripts: string[];
  body: string;
}): string {
  const nonce = createNonce();
  const { webview, extensionUri } = options;
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "common.css"));
  const scriptTags = ["common.js", ...options.scripts]
    .map((file) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", file));
      return `<script nonce="${nonce}" src="${uri}"></script>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>${escapeHtml(options.title)}</title>
  <link rel="stylesheet" href="${cssUri}" />
</head>
<body>
  ${options.body}
  ${scriptTags}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
