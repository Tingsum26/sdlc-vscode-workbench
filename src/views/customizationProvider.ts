import * as vscode from "vscode";
import { retainLastKnownData, toViewState, type Freshness } from "./viewState.js";
import { commandItem, emptyItem, errorItem, loadingItem, safeMessage } from "./treeItems.js";
import { INSTALLED_BUNDLES_KEY, type InstalledBundle, type KeyValueStore, type ViewStateWithFreshness } from "./types.js";

/** An installed-bundle row carrying its version so rollback-to targets it. */
class BundleItem extends vscode.TreeItem {
  constructor(label: string, public readonly version: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
  }
}

/**
 * Customization Center view: installed bundle versions from the globalState
 * store plus the install/rollback/copy commands that drive that store.
 */
export class CustomizationProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private state: ViewStateWithFreshness<InstalledBundle[]> = toViewState({ kind: "loading" });

  constructor(private readonly store: KeyValueStore) {}

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  async refresh(): Promise<void> {
    try {
      const bundles = this.store.get<InstalledBundle[]>(INSTALLED_BUNDLES_KEY, []);
      this.state = toViewState({ kind: "data", data: bundles, at: Date.now() });
    } catch (error) {
      this.state = retainLastKnownData(this.state, error);
    }
    this.changed.fire();
  }

  getChildren(): vscode.TreeItem[] {
    if (this.state.kind === "loading") return [loadingItem()];
    if (this.state.kind === "error") return [errorItem(this.state.message)];
    const rows: vscode.TreeItem[] = [];
    if (this.state.warning) rows.push(errorItem(`Last refresh failed; showing ${this.state.freshness} data: ${this.state.warning}`));
    if (this.state.data.length === 0) rows.push(emptyItem("No installed bundles"));
    else rows.push(...this.state.data.map((bundle) => this.bundleItem(bundle, this.state.freshness)));
    rows.push(
      commandItem("Install reviewed bundle", "sdlc.installCustomizationBundle"),
      commandItem("Roll back bundle", "sdlc.rollbackCustomizationBundle"),
      commandItem("Copy /start-ticket command", "sdlc.copyCopilotCommand"),
    );
    return rows;
  }

  private bundleItem(bundle: InstalledBundle, freshness: Freshness): vscode.TreeItem {
    const item = new BundleItem(bundle.version, bundle.version);
    item.description = `${bundle.installedAt} · ${freshness}`;
    item.tooltip = `Root ${bundle.root}\nInstalled ${bundle.installedAt}`;
    item.iconPath = new vscode.ThemeIcon("package");
    item.contextValue = "sdlc.bundle";
    item.accessibilityInformation = { label: `${bundle.version}. ${bundle.installedAt}. Installed bundle. Freshness ${freshness}.` };
    return item;
  }
}
