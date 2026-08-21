import * as vscode from "vscode";
import type { WorkflowTask } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { emptyItem, errorItem, loadingItem, safeMessage, statusIcon } from "./treeItems.js";
import type { ViewStateWithFreshness, WorkflowViewsClient } from "./types.js";

/**
 * My Work view: the actionable task backlog (COMPLETED/CANCELLED excluded),
 * each row carrying the ticket, repository alias, and poll freshness.
 */
export class MyWorkProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<WorkflowTask[]> = toViewState({ kind: "loading" });

  constructor(private readonly client: WorkflowViewsClient) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async refresh(): Promise<void> {
    try {
      const tasks = (await this.client.listTasks())
        .filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status));
      this.state = toViewState({ kind: "data", data: tasks, at: Date.now() });
    } catch (error) {
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    const warning = this.state.warning ? [errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`)] : [];
    if (this.state.data.length === 0) return [...warning, emptyItem("No actionable tasks")];
    const rows = this.state.data.map((task) => this.taskItem(task, this.state.freshness));
    return [...warning, ...rows];
  }

  private taskItem(task: WorkflowTask, freshness: Freshness): vscode.TreeItem {
    const label = `${task.scope.ticketId} · ${task.status}`;
    const evidenceClassification = task.evidenceClassification ?? "REAL";
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${task.scope.repositoryAlias} · ${evidenceClassification} · ${freshness}`;
    item.tooltip = `${task.taskId}\nEvidence: ${evidenceClassification}\nVersion ${task.version}\nUpdated ${task.updatedAt}\nFreshness: ${freshness}`;
    item.iconPath = statusIcon(task.status);
    item.command = { command: "sdlc.openTask", title: "Open task", arguments: [task.taskId] };
    item.contextValue = "sdlcTask";
    const evidenceLabel = evidenceClassification === "SIMULATED_PASS"
      ? "Simulated workflow evidence" : "Non-simulated workflow record";
    item.accessibilityInformation = { label: `${label}. ${task.scope.repositoryAlias}. ${evidenceLabel}. Status ${task.status}. Freshness ${freshness}.` };
    return item;
  }
}
