import * as vscode from "vscode";

/** Leaf row for "no data" states; invites a refresh. */
export function emptyItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = "Refresh with SDLC: Refresh Tasks";
  item.iconPath = new vscode.ThemeIcon("info");
  item.accessibilityInformation = { label: `${label}. No data. Refresh with SDLC: Refresh Tasks.` };
  return item;
}

/** Explicit error row; the refresh command is the retry path. */
export function errorItem(message: string): vscode.TreeItem {
  const label = `Error: ${message} · retry with SDLC: Refresh Tasks`;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("error");
  item.tooltip = message;
  item.accessibilityInformation = { label: `${label}. Refresh required.` };
  return item;
}

/** Placeholder shown before the first successful load. */
export function loadingItem(): vscode.TreeItem {
  const item = new vscode.TreeItem("Loading…", vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("loading~spin");
  item.accessibilityInformation = { label: "Loading. Refresh pending." };
  return item;
}

/** A clickable row that runs a workbench command. */
export function commandItem(label: string, command: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.command = { command, title: label };
  item.iconPath = new vscode.ThemeIcon("run");
  item.accessibilityInformation = { label: `${label}. Command.` };
  return item;
}

/** Status-mapped pass/error/info icon, mirroring the readiness view. */
export function statusIcon(status: string): vscode.ThemeIcon {
  const value = status.toUpperCase();
  const icon = value.includes("PASS") || value === "MERGED" || value === "DONE" ? "pass"
    : value === "BLOCKED" || value === "FAILED" || value === "CANCELLED" ? "error" : "info";
  return new vscode.ThemeIcon(icon);
}

/** Redacts secrets from client errors before they reach the tree. */
export function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/(token|password|secret)=[^\s]+/gi, "$1=[redacted]") : "Unknown error";
}
