import { randomBytes } from "node:crypto";
import type * as vscode from "vscode";

export const nonce = () => randomBytes(16).toString("base64");
export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function shell(webview: vscode.Webview, title: string, body: string, script = ""): string {
  const value = nonce();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${value}'; frame-src 'none'; img-src ${webview.cspSource} data:;">
<title>${escapeHtml(title)}</title><style>body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px;line-height:1.5}button,input{font:inherit}button{padding:6px 12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.card{border:1px solid var(--vscode-panel-border);padding:12px;margin-block:8px}:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main>${script ? `<script nonce="${value}">${script}</script>` : ""}</body></html>`;
}
