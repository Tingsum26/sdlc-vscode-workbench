import * as vscode from "vscode";
import { escapeHtml, shell } from "./html.js";

const safeReportBody = (html: string): string => {
  if (/<script|<iframe|<object|<embed|javascript:|\son\w+\s*=/i.test(html)) return `<pre>${escapeHtml(html)}</pre>`;
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? `<pre>${escapeHtml(html)}</pre>`;
};

export function openReportPanel(title: string, reportHtml: string): void {
  const panel = vscode.window.createWebviewPanel("sdlcReport", title, vscode.ViewColumn.Active, { enableScripts: false });
  panel.webview.html = shell(panel.webview, title,
    `<p>The report below is rendered from an immutable server artifact.</p><div class="card">${safeReportBody(reportHtml)}</div>`);
}
