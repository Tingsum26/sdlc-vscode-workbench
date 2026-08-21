import * as vscode from "vscode";
import { escapeHtml, shell } from "./html.js";

export function openApprovalPanel(input: {
  taskId: string; artifactId: string; artifactVersion: number; taskVersion: number;
}, onApprove: () => Promise<void>): void {
  const panel = vscode.window.createWebviewPanel("sdlcApproval", "Approve workflow artifact", vscode.ViewColumn.Active, { enableScripts: true });
  const label = `I reviewed ${input.artifactId} version ${input.artifactVersion}`;
  panel.webview.html = shell(panel.webview, "Human approval", `<div class="card"><p>Task <code>${escapeHtml(input.taskId)}</code>, task version ${input.taskVersion}.</p>
<label><input id="confirm" type="checkbox"> ${escapeHtml(label)}</label><p><button id="approve" disabled>Approve exact version</button></p></div>`,
  `const vscode=acquireVsCodeApi();const c=document.getElementById('confirm');const b=document.getElementById('approve');c.addEventListener('change',()=>b.disabled=!c.checked);b.addEventListener('click',()=>vscode.postMessage({type:'approve'}));`);
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type !== "approve") return;
    await onApprove();
    panel.dispose();
  });
}
