import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import * as vscode from "vscode";
import { escapeHtml, shell } from "../webview/html.js";
import { markdownToHtml } from "./markdownRenderer.js";

const safePath = (root: string, artifactPath: string): string => {
  if (isAbsolute(artifactPath)) throw new Error("Journey artifact path must be relative");
  const absolute = resolve(root, artifactPath);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Journey artifact path escapes workspace");
  return absolute;
};

function bodyFor(root: string, artifactPath: string): string {
  const path = safePath(root, artifactPath);
  if (!existsSync(path)) return `<p class="warning">Artifact is missing: ${escapeHtml(artifactPath)}</p>`;
  return markdownToHtml(readFileSync(path, "utf8"));
}

export function openJourneyArtifactPanel(root: string, artifactId: string, artifactPath: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("sdlcJourneyArtifact", `Agent Report · ${artifactId}`, vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  const initial = bodyFor(root, artifactPath);
  const script = `window.addEventListener('message', event => { if (event.data?.type === 'artifact-update') document.querySelector('.report-body').innerHTML = event.data.body; });`;
  panel.webview.html = shell(panel.webview, `Agent Report · ${artifactId}`, `<p class="meta">${escapeHtml(artifactPath)} · live from Journey workspace</p><article class="card report-body">${initial}</article>`, script);
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, artifactPath));
  const update = (): void => { void panel.webview.postMessage({ type: "artifact-update", body: bodyFor(root, artifactPath) }); };
  panel.onDidDispose(() => watcher.dispose());
  watcher.onDidCreate(update); watcher.onDidChange(update); watcher.onDidDelete(update);
  return panel;
}
