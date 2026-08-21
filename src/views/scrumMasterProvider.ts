import * as vscode from "vscode";
import type { EpicResume } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { emptyItem, errorItem, loadingItem, safeMessage, statusIcon } from "./treeItems.js";
import { type EpicSelection, type ViewStateWithFreshness, type WorkflowViewsClient } from "./types.js";

/**
 * Scrum Master view: next-action hints for the selected epic's tickets from the
 * epic resume, so the scrum master knows what to unblock first.
 */
export class ScrumMasterProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<EpicResume | undefined> = toViewState({ kind: "loading" });

  private readonly selectionListener: vscode.Disposable;

  constructor(private readonly client: WorkflowViewsClient, private readonly selection: EpicSelection) {
    this.selectionListener = this.selection.onDidChange(() => { void this.refresh(); });
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  dispose(): void {
    this.selectionListener.dispose();
    this.changed.dispose();
  }

  async refresh(): Promise<void> {
    const epicId = this.selection.selectedEpicId();
    try {
      if (!epicId) {
        this.state = toViewState({ kind: "data", data: undefined, at: Date.now() });
        this.changed.fire();
        return;
      }
      const resume = await this.client.getEpicResume(epicId);
      if (this.selection.selectedEpicId() !== epicId) return;
      this.state = toViewState({ kind: "data", data: resume, at: Date.now() });
    } catch (error) {
      if (this.selection.selectedEpicId() !== epicId) return;
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    if (!this.state.data) return [emptyItem("Select an epic in Epic View")];
    const warning = this.state.warning ? [errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`)] : [];
    const tickets = this.state.data.tickets;
    if (tickets.length === 0) return [...warning, emptyItem("No next actions")];
    const rows = tickets.map((entry) => this.ticketItem(entry, this.state.freshness));
    return [...warning, ...rows];
  }

  private ticketItem(entry: EpicResume["tickets"][number], freshness: Freshness): vscode.TreeItem {
    const label = `${entry.ticket.ticketId} · ${entry.ticket.status}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${entry.nextAction} · ${freshness}`;
    item.tooltip = `Next action: ${entry.nextAction}\nVersion ${entry.ticket.version}\nFreshness: ${freshness}`;
    item.iconPath = statusIcon(entry.ticket.status);
    item.accessibilityInformation = { label: `${label}. ${entry.nextAction}. Status ${entry.ticket.status}. Freshness ${freshness}.` };
    return item;
  }
}
