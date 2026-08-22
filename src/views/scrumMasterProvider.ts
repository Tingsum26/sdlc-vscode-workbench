import * as vscode from "vscode";
import type { EpicResume } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { commandItem, emptyItem, errorItem, loadingItem, safeMessage, sectionItem, statusIcon } from "./treeItems.js";
import { type EpicSelection, type ViewStateWithFreshness, type WorkflowViewsClient } from "./types.js";

/**
 * Builds the plain-text standup digest a scrum master copies into the daily
 * channel. Pure and exported so it can be unit-tested without a provider.
 */
export function buildStandupDigest(resume: EpicResume): string {
  const { epic, tickets } = resume;
  const blocked = tickets.filter((entry) => entry.ticket.status.toUpperCase() === "BLOCKED");
  const openTasks = tickets.reduce((total, entry) => total + entry.openTasks.length, 0);
  const lines = [
    `Standup — ${epic.epicId} · ${epic.title}`,
    `Status: ${epic.status} · v${epic.version} · Journey ${epic.journeyId}`,
    `Tickets: ${tickets.length} · Blocked: ${blocked.length} · Open tasks: ${openTasks}`,
  ];
  for (const entry of tickets) lines.push(`- ${entry.ticket.ticketId} [${entry.ticket.status}]: ${entry.nextAction}`);
  return lines.join("\n");
}

/**
 * Scrum Master view: next-action hints for the selected epic's tickets from the
 * epic resume, plus a blockers section, an epic resume summary node, and a
 * copy-standup-digest command.
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
    const resume = this.state.data;
    const tickets = resume.tickets;
    if (tickets.length === 0) return [...warning, emptyItem("No next actions")];
    const rows = tickets.map((entry) => this.ticketItem(entry, this.state.freshness));
    const blocked = tickets.filter((entry) => entry.ticket.status.toUpperCase() === "BLOCKED");
    if (blocked.length > 0) {
      rows.push(sectionItem(`Blockers (${blocked.length})`));
      rows.push(...blocked.map((entry) => this.blockerItem(entry)));
    }
    rows.push(this.epicSummaryItem(resume, this.state.freshness));
    rows.push(commandItem("Copy standup digest", "sdlc.copyStandupDigest", [resume.epic.epicId]));
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

  private blockerItem(entry: EpicResume["tickets"][number]): vscode.TreeItem {
    const label = `${entry.ticket.ticketId} · BLOCKED`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = "Needs attention before it can advance";
    item.iconPath = new vscode.ThemeIcon("error");
    item.accessibilityInformation = { label: `${label}. Blocker. Next action ${entry.nextAction}.` };
    return item;
  }

  private epicSummaryItem(resume: EpicResume, freshness: Freshness): vscode.TreeItem {
    const item = new vscode.TreeItem(`Epic · ${resume.epic.title}`, vscode.TreeItemCollapsibleState.None);
    item.description = `${resume.epic.status} · v${resume.epic.version} · ${freshness}`;
    item.tooltip = `Journey ${resume.epic.journeyId}\nFreshness: ${freshness}`;
    item.iconPath = new vscode.ThemeIcon("milestone");
    item.accessibilityInformation = { label: `Epic ${resume.epic.title}. Status ${resume.epic.status}. Version ${resume.epic.version}. Freshness ${freshness}.` };
    return item;
  }
}
