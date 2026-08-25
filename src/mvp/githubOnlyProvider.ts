import * as vscode from "vscode";
import { findJourneyWorkspace, readJourneySnapshot, type JourneySnapshot } from "./journeyWorkspace.js";

const mvpViewIds = ["sdlc.myWork", "sdlc.scrumMaster", "sdlc.epic", "sdlc.ticket", "sdlc.identityPod", "sdlc.customization", "sdlc.mcpCenter", "sdlc.diagnostics"];
class JourneyItem extends vscode.TreeItem {
  constructor(label: string, description: string, tooltip: string) { super(label); this.description = description; this.tooltip = tooltip; this.accessibilityInformation = { label: `${label}. ${description}` }; }
}
class JourneyProvider implements vscode.TreeDataProvider<JourneyItem> {
  private snapshot: JourneySnapshot;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(private readonly root: string, private readonly section: string) { this.snapshot = readJourneySnapshot(root); }
  refresh(): void { try { this.snapshot = readJourneySnapshot(this.root); this.changed.fire(); } catch { /* retain last good snapshot */ } }
  getTreeItem(item: JourneyItem): vscode.TreeItem { return item; }
  getChildren(): JourneyItem[] {
    const s = this.snapshot;
    const base = [new JourneyItem(`Journey · ${s.journeyId}`, `${s.status} · ${s.currentStage}`, `Workflow ${s.workflowId}\nBranch ${s.branch}`), new JourneyItem("Current stage", s.nextRole ? `${s.currentStage} → ${s.nextRole}` : s.currentStage, "Declared by .sdlc/workflow.json"), new JourneyItem("Gate", `${s.gateState} · output ${s.currentOutputStatus}`, "The gate is derived from workflow.json; no chat history is used")];
    if (this.section === "sdlc.myWork" || this.section === "sdlc.scrumMaster") {
      const next = s.gateState === "WAITING_FOR_APPROVAL" ? "等待人工批准当前输出" : s.gateState === "COMPLETED" ? "Journey 已完成" : s.gateState === "BLOCKED" ? "处理阻塞后重试" : `启动 ${s.nextAgent ?? "下一阶段 Agent"}`;
      return [...base, new JourneyItem("Next Agent", s.nextAgent ?? "none", "由 stageOrder 和当前输出状态确定"), new JourneyItem("Next action", next, `Copilot: /resume-workflow ${s.workflowId}`), new JourneyItem("Tickets", s.sourceTickets.join(", ") || "none", "Source tickets in workflow.json")];
    }
    if (this.section === "sdlc.mcpCenter") return [new JourneyItem("GitHub-only MVP", "No Workflow MCP required", "State is persisted by GitHub branch, PR and Markdown"), new JourneyItem("Optional local MCP", "Jira · Confluence · GitHub · Figma · code graph", "Connectors provide context but do not persist workflow state")];
    if (this.section === "sdlc.diagnostics") { const receipts = s.artifacts.filter((artifact) => artifact.receipt !== "NOT_REQUIRED"); const stale = receipts.filter((artifact) => artifact.receipt !== "OK"); return [...base, new JourneyItem("Context Receipts", stale.length === 0 ? "ALL CURRENT" : `${stale.length} NEED ATTENTION`, stale.map((artifact) => `${artifact.id}: ${artifact.receipt}`).join("\n") || "No staged artifacts")]; }
    return [...base, ...s.artifacts.map((artifact) => new JourneyItem(artifact.id, `${artifact.status} · receipt ${artifact.receipt}`, `${artifact.path}\n${artifact.receipt}`)), new JourneyItem("Repositories", s.affectedRepositories.join(", ") || "none", "Linked code repositories")];
  }
}
export function activateGitHubOnlyMvp(context: vscode.ExtensionContext, output: vscode.OutputChannel): boolean {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const root = findJourneyWorkspace(roots); if (!root) return false;
  const providers = mvpViewIds.map((id) => new JourneyProvider(root, id));
  for (let index = 0; index < mvpViewIds.length; index += 1) context.subscriptions.push(vscode.window.registerTreeDataProvider(mvpViewIds[index]!, providers[index]!));
  const refresh = (): void => providers.forEach((provider) => provider.refresh());
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "{.sdlc,docs}/**"));
  context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh));
  const copyCommand = async (): Promise<void> => { const snapshot = readJourneySnapshot(root); const command = `/resume-workflow ${snapshot.workflowId}`; await vscode.env.clipboard.writeText(command); void vscode.window.showInformationMessage(`Copied: ${command}`); };
  context.subscriptions.push(vscode.commands.registerCommand("sdlc.refreshTasks", refresh), vscode.commands.registerCommand("sdlc.copyCopilotCommand", copyCommand), vscode.commands.registerCommand("sdlc.copyTaskCopilotCommand", copyCommand), vscode.commands.registerCommand("sdlc.openMcpCenter", () => void vscode.window.showInformationMessage("GitHub-only MVP: Workflow MCP and Workflow Service are not required.")), vscode.commands.registerCommand("sdlc.checkMcpHealth", () => void vscode.window.showInformationMessage("GitHub-only MVP is healthy when workflow.json and Context Receipts validate.")));
  output.appendLine(`GitHub-only MVP active: ${root}`); return true;
}
