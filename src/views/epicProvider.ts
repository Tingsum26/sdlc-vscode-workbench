import * as vscode from "vscode";
import type { EpicSummary } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { emptyItem, errorItem, loadingItem, safeMessage, statusIcon } from "./treeItems.js";
import type { EpicSelection, ViewStateWithFreshness, WorkflowViewsClient } from "./types.js";

/** Epic view: the journey epics with their lifecycle status. */
export class EpicProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<EpicSummary[]> = toViewState({ kind: "loading" });

  constructor(private readonly client: WorkflowViewsClient, private readonly selection: EpicSelection) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  dispose(): void { this.changed.dispose(); }

  async refresh(): Promise<void> {
    try {
      const epics = await this.client.listEpics();
      this.state = toViewState({ kind: "data", data: epics, at: Date.now() });
      if (!this.selection.selectedEpicId() && epics[0]) this.selection.select(epics[0].epicId);
    } catch (error) {
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    const warning = this.state.warning ? [errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`)] : [];
    if (this.state.data.length === 0) return [...warning, emptyItem("No epics")];
    const rows = this.state.data.map((epic) => this.epicItem(epic, this.state.freshness));
    return [...warning, ...rows];
  }

  private epicItem(epic: EpicSummary, freshness: Freshness): vscode.TreeItem {
    const label = `${epic.epicId} · ${epic.title}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${epic.status} · ${freshness}`;
    item.tooltip = `Journey ${epic.journeyId}\nVersion ${epic.version}\nFreshness: ${freshness}`;
    item.iconPath = statusIcon(epic.status);
    item.command = { command: "sdlc.selectEpic", title: "Select Epic", arguments: [epic.epicId] };
    item.contextValue = "sdlc.epic";
    item.accessibilityInformation = { label: `${label}. Status ${epic.status}. Journey ${epic.journeyId}. Freshness ${freshness}.` };
    return item;
  }
}
