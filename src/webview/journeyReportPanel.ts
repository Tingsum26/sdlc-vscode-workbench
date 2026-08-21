import * as vscode from "vscode";

export function openJourneyReportPanel(html: string): void {
  if (!/^\s*<!doctype html>/i.test(html) || /<script\b/i.test(html)) {
    throw new Error("Journey report is not an approved standalone, script-free HTML document");
  }
  const panel = vscode.window.createWebviewPanel("sdlcJourneyReport", "Journey Readiness Report", vscode.ViewColumn.Active, {
    enableScripts: false, retainContextWhenHidden: true,
  });
  panel.webview.html = html;
}
