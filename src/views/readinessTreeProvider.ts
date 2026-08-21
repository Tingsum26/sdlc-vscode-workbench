import * as vscode from "vscode";
import type { EnterpriseIdentity, IntegrationDiagnostic, NextInternalValidation } from "../api/workflowClient.js";
import { buildReadinessRows, type ReadinessRow } from "./readinessModel.js";

export class ReadinessTreeProvider implements vscode.TreeDataProvider<ReadinessRow> {
  private readonly changed = new vscode.EventEmitter<ReadinessRow | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: ReadinessRow[] = [{ label: "Readiness · Not loaded", description: "Refresh required", tooltip: "Use SDLC: Refresh Tasks.", status: "UNKNOWN" }];

  setReadiness(identity: EnterpriseIdentity, diagnostics: IntegrationDiagnostic[], next: NextInternalValidation): void {
    this.rows = buildReadinessRows(identity, diagnostics, next);
    this.changed.fire(undefined);
  }

  setError(message: string): void {
    this.rows = [{ label: "Readiness · Action required", description: "Connection failed", tooltip: message, status: "BLOCKED" }];
    this.changed.fire(undefined);
  }

  getTreeItem(row: ReadinessRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.description;
    item.tooltip = row.tooltip;
    item.iconPath = new vscode.ThemeIcon(row.status.includes("PASS") || row.status === "IDENTIFIED" ? "pass" : row.status === "BLOCKED" ? "error" : "info");
    item.accessibilityInformation = { label: `${row.label}. ${row.description}. ${row.tooltip}` };
    return item;
  }

  getChildren(): ReadinessRow[] { return this.rows; }
}
