import * as vscode from "vscode";
import type { RepoTaskSummary, TicketSummary } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { emptyItem, errorItem, loadingItem, safeMessage, statusIcon } from "./treeItems.js";
import { type EpicSelection, type ViewStateWithFreshness, type WorkflowViewsClient } from "./types.js";

/** A ticket row that knows its ticket id so getChildren can load its repo tasks. */
class TicketItem extends vscode.TreeItem {
  constructor(label: string, public readonly ticketId: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
  }
}

/**
 * Ticket view: the selected epic's tickets, each expandable to its repo tasks
 * (loaded on demand via listRepoTasks).
 */
export class TicketProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<TicketSummary[]> = toViewState({ kind: "loading" });
  private needsEpicSelection = false;

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
        this.needsEpicSelection = true;
        this.state = toViewState({ kind: "data", data: [], at: Date.now() });
        this.changed.fire();
        return;
      }
      this.needsEpicSelection = false;
      const tickets = await this.client.listTickets(epicId);
      if (this.selection.selectedEpicId() !== epicId) return;
      this.state = toViewState({ kind: "data", data: tickets, at: Date.now() });
    } catch (error) {
      if (this.selection.selectedEpicId() !== epicId) return;
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] | Thenable<vscode.TreeItem[]> {
    if (element instanceof TicketItem) return this.repoTaskItems(element.ticketId);
    return this.rootItems();
  }

  private rootItems(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    if (this.needsEpicSelection) return [emptyItem("Select an epic in Epic View")];
    const warning = this.state.warning ? [errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`)] : [];
    if (this.state.data.length === 0) return [...warning, emptyItem("No tickets")];
    const rows: vscode.TreeItem[] = this.state.data.map((ticket) => this.ticketItem(ticket, this.state.freshness));
    return [...warning, ...rows];
  }

  private ticketItem(ticket: TicketSummary, freshness: Freshness): TicketItem {
    const label = `${ticket.ticketId} · ${ticket.status}`;
    const evidenceClassification = ticket.evidenceClassification ?? "REAL";
    const item = new TicketItem(label, ticket.ticketId);
    item.description = `${ticket.channel} · ${evidenceClassification} · ${freshness}`;
    item.tooltip = `Channel ${ticket.channel}\nEvidence: ${evidenceClassification}\nVersion ${ticket.version}\nFreshness: ${freshness}`;
    item.iconPath = statusIcon(ticket.status);
    item.accessibilityInformation = { label: `${label}. Channel ${ticket.channel}. Evidence ${evidenceClassification}. Status ${ticket.status}. Freshness ${freshness}.` };
    return item;
  }

  private async repoTaskItems(ticketId: string): Promise<vscode.TreeItem[]> {
    try {
      const tasks = await this.client.listRepoTasks(ticketId);
      if (tasks.length === 0) return [emptyItem("No repo tasks")];
      return tasks.map((task) => this.repoTaskItem(task));
    } catch (error) {
      return [errorItem(safeMessage(error))];
    }
  }

  private repoTaskItem(task: RepoTaskSummary): vscode.TreeItem {
    const label = `${task.repoTaskId} · ${task.status}`;
    const evidenceClassification = task.evidenceClassification ?? "REAL";
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${task.repositoryAlias} · ${evidenceClassification}`;
    item.tooltip = `Evidence: ${evidenceClassification}\nVersion ${task.version}`;
    item.iconPath = statusIcon(task.status);
    item.accessibilityInformation = { label: `${label}. ${task.repositoryAlias}. Evidence ${evidenceClassification}. Status ${task.status}.` };
    return item;
  }
}
