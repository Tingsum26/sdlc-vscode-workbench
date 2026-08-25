import { randomBytes } from "node:crypto";
import type * as vscode from "vscode";

export const nonce = () => randomBytes(16).toString("base64");
export const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function shell(webview: vscode.Webview, title: string, body: string, script = ""): string {
  const value = nonce();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${value}'; frame-src 'none'; img-src ${webview.cspSource} data:;">
<title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark}body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px;line-height:1.5}main{max-width:1180px;margin:0 auto}h1,h2,h3{line-height:1.25}h1{font-size:1.55rem}h2{margin-top:1.5rem}button,input{font:inherit}button{padding:8px 12px;min-height:36px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:16px;margin-block:12px;background:var(--vscode-textCodeBlock-background)}.meta{color:var(--vscode-descriptionForeground);font-size:.9em}.warning{color:var(--vscode-editorWarning-foreground);border-left:3px solid var(--vscode-editorWarning-foreground);padding:8px}.report-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0}.report-meta div{padding:8px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px}.report-meta dt{color:var(--vscode-descriptionForeground);font-size:.8em}.report-meta dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}hr{border:0;border-top:1px solid var(--vscode-panel-border);margin:16px 0}table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border:1px solid var(--vscode-panel-border);padding:8px;text-align:left;vertical-align:top}th{background:var(--vscode-editor-background)}.diagram{border-left:3px solid var(--vscode-textLink-foreground);font-size:.9em}.code{background:var(--vscode-textCodeBlock-background)}a{color:var(--vscode-textLink-foreground)}:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}@media(max-width:640px){body{padding:10px}.card{padding:12px}}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1>${body}</main>${script ? `<script nonce="${value}">${script}</script>` : ""}</body></html>`;
}
