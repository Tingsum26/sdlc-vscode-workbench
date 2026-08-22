import * as vscode from "vscode";
import type { EnterpriseIdentity, IntegrationDiagnostic, NextInternalValidation } from "../api/workflowClient.js";
import { buildJourneyFreshnessRows, buildReadinessRows, type ReadinessRow } from "./readinessModel.js";
import type { ReadinessClient } from "./types.js";

/**
 * Diagnostics view: an imperative snapshot API (setReadiness/setError) plus a
 * self-refreshing `refresh()` that re-fetches the readiness snapshot and the
 * journey freshness overview. Freshness rows carry LIVE/DELAYED/STALE/OFFLINE
 * badges as text so the state is never color-only.
 */
export class ReadinessTreeProvider implements vscode.TreeDataProvider<ReadinessRow> {
  private readonly changed = new vscode.EventEmitter<ReadinessRow | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: ReadinessRow[] = [{ label: "Readiness · Not loaded", description: "Refresh required", tooltip: "Use SDLC: Refresh Tasks.", status: "UNKNOWN" }];

  constructor(private readonly client?: ReadinessClient) {}

  setReadiness(identity: EnterpriseIdentity, diagnostics: IntegrationDiagnostic[], next: NextInternalValidation): void {
    this.rows = buildReadinessRows(identity, diagnostics, next);
    this.changed.fire(undefined);
  }

  setError(message: string): void {
    this.rows = [{ label: "Readiness · Action required", description: "Connection failed", tooltip: message, status: "BLOCKED" }];
    this.changed.fire(undefined);
  }

  async refresh(): Promise<void> {
    if (!this.client) return;
    let readiness: ReadinessRow[] = [];
    const freshness: ReadinessRow[] = [];
    try {
      const [identity, diagnostics, next] = await Promise.all([
        this.client.getIdentity(),
        this.client.getIntegrationDiagnostics(),
        this.client.getNextInternalValidation(),
      ]);
      readiness = buildReadinessRows(identity, diagnostics, next);
    } catch (error) {
      readiness = [{ label: "Readiness · Action required", description: "Connection failed", tooltip: error instanceof Error ? error.message : "Unknown error", status: "BLOCKED" }];
    }
    try {
      freshness.push(...buildJourneyFreshnessRows(await this.client.listJourneyFreshness()));
    } catch {
      // Journey freshness is best-effort; a snapshot failure keeps the view usable.
    }
    this.rows = [...readiness, ...freshness];
    this.changed.fire(undefined);
  }

  getTreeItem(row: ReadinessRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.description;
    item.tooltip = row.tooltip;
    item.iconPath = new vscode.ThemeIcon(readinessIcon(row.status));
    item.accessibilityInformation = { label: `${row.label}. ${row.description}. ${row.tooltip}` };
    return item;
  }

  getChildren(): ReadinessRow[] { return this.rows; }
}

function readinessIcon(status: string): string {
  const value = status.toUpperCase();
  if (value.includes("PASS") || value === "IDENTIFIED" || value === "LIVE") return "pass";
  if (value === "BLOCKED" || value === "OFFLINE" || value === "FAILED") return "error";
  if (value === "DELAYED" || value === "STALE") return "warning";
  return "info";
}
