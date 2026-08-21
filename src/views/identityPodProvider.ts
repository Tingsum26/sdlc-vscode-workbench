import * as vscode from "vscode";
import type { EnterpriseIdentity, PodMember } from "../api/workflowClient.js";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { emptyItem, errorItem, loadingItem, safeMessage } from "./treeItems.js";
import { ACCOUNT_OPENING_JOURNEY, type ViewStateWithFreshness, type WorkflowViewsClient } from "./types.js";

interface IdentityPodData {
  identity: EnterpriseIdentity;
  members: PodMember[];
}

/**
 * Identity / Pod Configuration view: the bound identity line followed by the
 * account-opening pod's members with their role and onboarding status.
 */
export class IdentityPodProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<IdentityPodData> = toViewState({ kind: "loading" });

  constructor(private readonly client: WorkflowViewsClient) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async refresh(): Promise<void> {
    try {
      const [identity, members] = await Promise.all([
        this.client.getIdentity(),
        this.client.getPodMembers(ACCOUNT_OPENING_JOURNEY),
      ]);
      this.state = toViewState({ kind: "data", data: { identity, members }, at: Date.now() });
    } catch (error) {
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    const { identity, members } = this.state.data;
    const rows = [this.identityItem(identity, this.state.freshness)];
    if (this.state.warning) rows.unshift(errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`));
    rows.push(...members.map((member) => this.memberItem(member, this.state.freshness)));
    if (members.length === 0) rows.push(emptyItem("No pod members"));
    return rows;
  }

  private identityItem(identity: EnterpriseIdentity, freshness: Freshness): vscode.TreeItem {
    const label = `${identity.employeeId} · ${identity.displayLabel}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `Identity · ${freshness}`;
    item.tooltip = `Source ${identity.source}\nFreshness: ${freshness}`;
    item.iconPath = new vscode.ThemeIcon("account");
    item.accessibilityInformation = { label: `${label}. Identity. Source ${identity.source}. Freshness ${freshness}.` };
    return item;
  }

  private memberItem(member: PodMember, freshness: Freshness): vscode.TreeItem {
    const label = `${member.employeeId} · ${member.displayLabel}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = `${member.role} · ${member.onboardingStatus} · ${freshness}`;
    item.tooltip = `Pod of ${ACCOUNT_OPENING_JOURNEY}\nFreshness: ${freshness}`;
    item.iconPath = new vscode.ThemeIcon("person");
    item.accessibilityInformation = { label: `${label}. ${member.role}. ${member.onboardingStatus}. Freshness ${freshness}.` };
    return item;
  }
}
