import * as vscode from "vscode";
import type { HealthLatency } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { commandItem, emptyItem, errorItem, loadingItem, safeMessage } from "./treeItems.js";
import type { McpCatalogEntry, McpCenterClient, ViewStateWithFreshness } from "./types.js";

interface McpCenterData {
  catalog: McpCatalogEntry[];
  source: "service" | "bundled";
}

/**
 * MCP Center view: catalog servers with their required/optional status and
 * skill counts. When a client is wired, the catalog is fetched live from the
 * workflow-service diagnostics endpoint and falls back to the bundled static
 * list on failure; a health-check row reports round-trip latency.
 */
export class McpCenterProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<McpCenterData> = toViewState({ kind: "loading" });
  private health: HealthLatency | undefined;

  constructor(private readonly catalog: McpCatalogEntry[], private readonly client?: McpCenterClient) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async refresh(): Promise<void> {
    try {
      if (!this.client) {
        this.state = toViewState({ kind: "data", data: { catalog: this.catalog, source: "bundled" }, at: Date.now() });
      } else {
        const fetched = await this.client.getMcpCatalog();
        const catalog = fetched.length > 0 ? fetched : this.catalog;
        const source = fetched.length > 0 ? "service" : "bundled";
        this.state = toViewState({ kind: "data", data: { catalog, source }, at: Date.now() });
      }
    } catch (error) {
      this.state = toViewState({ kind: "data", data: { catalog: this.catalog, source: "bundled" }, at: Date.now(), warning: safeMessage(error) });
    }
    this.changed.fire();
  }

  /** Records a health probe result and re-renders the latency node. */
  setHealth(health: HealthLatency): void {
    this.health = health;
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    const { catalog, source } = this.state.data;
    const rows: vscode.TreeItem[] = [];
    if (this.client) rows.push(this.sourceItem(source));
    if (this.state.warning) rows.push(errorItem(`Last refresh failed; showing bundled data: ${this.state.warning}`));
    rows.push(...catalog.map((entry) => this.serverItem(entry, this.state.freshness)));
    if (catalog.length === 0) rows.push(emptyItem("No catalog servers"));
    if (this.health) rows.push(this.healthItem(this.health));
    rows.push(commandItem("Open MCP onboarding", "sdlc.openMcpCenter"));
    if (this.client) rows.push(commandItem("Check MCP health", "sdlc.checkMcpHealthLatency"));
    return rows;
  }

  private sourceItem(source: "service" | "bundled"): vscode.TreeItem {
    const label = source === "service" ? "Catalog · live service" : "Catalog · bundled fallback";
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = "MCP catalog source";
    item.iconPath = new vscode.ThemeIcon(source === "service" ? "radio-tower" : "archive");
    item.accessibilityInformation = { label: `${label}. MCP catalog source.` };
    return item;
  }

  private healthItem(health: HealthLatency): vscode.TreeItem {
    const label = health.ok ? "MCP health · OK" : "MCP health · FAIL";
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${health.latencyMs}ms`;
    item.tooltip = `Workflow Service actuator health: ${health.ok ? "reachable" : "unreachable"} in ${health.latencyMs}ms`;
    item.iconPath = new vscode.ThemeIcon(health.ok ? "pass" : "error");
    item.accessibilityInformation = { label: `${label}. ${health.latencyMs} milliseconds.` };
    return item;
  }

  private serverItem(entry: McpCatalogEntry, freshness: Freshness): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.id, vscode.TreeItemCollapsibleState.None);
    item.description = `${entry.required ? "required" : "optional"} · ${freshness}`;
    item.tooltip = `${entry.name} · ${entry.skills.length} skills: ${entry.skills.join(", ")}`;
    item.iconPath = new vscode.ThemeIcon("server");
    item.accessibilityInformation = {
      label: `${entry.id}. ${entry.required ? "Required" : "Optional"}. ${entry.skills.length} skills. Freshness ${freshness}.`,
    };
    return item;
  }
}
