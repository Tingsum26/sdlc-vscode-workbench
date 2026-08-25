import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import * as vscode from "vscode";
import { escapeHtml, shell } from "../webview/html.js";
import { markdownToHtml, parseFrontMatter, type AgentReportMetadata } from "./markdownRenderer.js";

const safePath = (root: string, artifactPath: string): string => {
  if (isAbsolute(artifactPath)) throw new Error("Journey artifact path must be relative");
  const absolute = resolve(root, artifactPath);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Journey artifact path escapes workspace");
  return absolute;
};

function reportType(artifactId: string, metadata: AgentReportMetadata): string {
  if (metadata.reportType) return metadata.reportType;
  return artifactId.toLowerCase().replace(/_contract$|_design$|_plan$|_report$|_review$/, "");
}

function bodyFor(root: string, artifactId: string, artifactPath: string, workflowStatus?: string, receipt?: string): string {
  const path = safePath(root, artifactPath);
  if (!existsSync(path)) return `<p class="warning">Artifact is missing: ${escapeHtml(artifactPath)}</p>`;
  const markdown = readFileSync(path, "utf8");
  const { metadata } = parseFrontMatter(markdown);
  const metadataRows = [
    ["Report type", reportType(artifactId, metadata)],
    ["Stage", metadata.stage ?? "—"], ["Role", metadata.role ?? "—"],
    ["Status", workflowStatus ?? metadata.status ?? "—"], ["Receipt", receipt ?? "—"],
    ["Revision", metadata.revision ?? "—"], ["Evidence", metadata.evidenceLevel ?? "—"],
  ].map(([label, value]) => `<div><dt>${escapeHtml(String(label))}</dt><dd>${escapeHtml(String(value ?? "—"))}</dd></div>`).join("");
  return `<dl class="report-meta">${metadataRows}</dl><hr>${markdownToHtml(markdown)}`;
}

export function openJourneyArtifactPanel(root: string, artifactId: string, artifactPath: string, workflowStatus?: string, receipt?: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("sdlcJourneyArtifact", `Agent Report · ${artifactId}`, vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  let liveStatus = workflowStatus;
  let liveReceipt = receipt;
  const initial = bodyFor(root, artifactId, artifactPath, liveStatus, liveReceipt);
  const script = `window.addEventListener('message', event => { if (event.data?.type === 'artifact-update') document.querySelector('.report-body').innerHTML = event.data.body; });`;
  panel.webview.html = shell(panel.webview, `Agent Report · ${artifactId}`, `<p class="meta">${escapeHtml(artifactPath)} · live from Journey workspace</p><article class="card report-body">${initial}</article>`, script);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, artifactPath));
  const update = (): void => { void panel.webview.postMessage({ type: "artifact-update", body: bodyFor(root, artifactId, artifactPath, liveStatus, liveReceipt) }); };
  panel.onDidDispose(() => watcher.dispose());
  watcher.onDidCreate(update); watcher.onDidChange(update); watcher.onDidDelete(update);
  const workflowWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, ".sdlc/workflow.json"));
  const updateWorkflowMetadata = (): void => {
    try {
      const state = JSON.parse(readFileSync(join(root, ".sdlc", "workflow.json"), "utf8")) as { artifacts?: Record<string, { path?: string; status?: string }> };
      const current = Object.values(state.artifacts ?? {}).find((artifact) => artifact.path === artifactPath);
      liveStatus = current?.status ?? liveStatus;
      update();
    } catch { update(); }
  };
  panel.onDidDispose(() => workflowWatcher.dispose());
  workflowWatcher.onDidCreate(updateWorkflowMetadata); workflowWatcher.onDidChange(updateWorkflowMetadata); workflowWatcher.onDidDelete(updateWorkflowMetadata);
  return panel;
}
