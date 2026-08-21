import * as vscode from "vscode";

export class WorkflowStatusBar {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  constructor() { this.item.command = "sdlc.refreshTasks"; this.item.text = "$(checklist) SDLC: —"; this.item.show(); }
  update(total: number, actionable: number): void {
    this.item.text = `$(checklist) SDLC: ${actionable}/${total}`;
    this.item.tooltip = `${actionable} actionable workflow tasks out of ${total}`;
  }
  dispose(): void { this.item.dispose(); }
}
