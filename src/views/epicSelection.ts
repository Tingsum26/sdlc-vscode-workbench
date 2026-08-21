import * as vscode from "vscode";
import type { EpicSelection } from "./types.js";

/**
 * Extension-scoped live Epic selection. It deliberately keeps no fixture
 * fallback: dependent views show an accessible prompt until an Epic exists.
 */
export class EpicSelectionStore implements EpicSelection, vscode.Disposable {
  private selected: string | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  selectedEpicId(): string | undefined { return this.selected; }

  select(epicId: string): void {
    if (this.selected === epicId) return;
    this.selected = epicId;
    this.changed.fire();
  }

  dispose(): void { this.changed.dispose(); }
}
