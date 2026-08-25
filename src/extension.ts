import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { WorkflowClient, type WorkflowTask } from "./api/workflowClient.js";
import { checkMcpHealth } from "./diagnostics/mcpHealth.js";
import { installCustomizationBundle, rollbackBundleToVersion, rollbackCustomizationBundle } from "./customization/bundleInstaller.js";
import { ExtensionLogger } from "./logging/logger.js";
import { TaskPoller } from "./polling/taskPoller.js";
import { CustomizationProvider } from "./views/customizationProvider.js";
import { EpicProvider } from "./views/epicProvider.js";
import { EpicSelectionStore } from "./views/epicSelection.js";
import { IdentityPodProvider } from "./views/identityPodProvider.js";
import { McpCenterProvider } from "./views/mcpCenterProvider.js";
import { MyWorkProvider } from "./views/myWorkProvider.js";
import { ReadinessTreeProvider } from "./views/readinessTreeProvider.js";
import { buildStandupDigest, ScrumMasterProvider } from "./views/scrumMasterProvider.js";
import { WorkflowStatusBar } from "./views/statusBar.js";
import { TicketProvider } from "./views/ticketProvider.js";
import { parseRosterCsv } from "./views/rosterCsv.js";
import { ACCOUNT_OPENING_JOURNEY, type McpCatalogEntry } from "./views/types.js";
import { openApprovalPanel } from "./webview/approvalPanel.js";
import { escapeHtml, shell } from "./webview/html.js";
import { openReportPanel } from "./webview/reportPanel.js";
import { openJourneyReportPanel } from "./webview/journeyReportPanel.js";
import { activateGitHubOnlyMvp } from "./mvp/githubOnlyProvider.js";

const viewIds = ["sdlc.myWork", "sdlc.scrumMaster", "sdlc.epic", "sdlc.ticket",
  "sdlc.identityPod", "sdlc.customization", "sdlc.mcpCenter", "sdlc.diagnostics"];

/**
 * Static MCP catalog mirroring central/mcp/catalog.json. The packaged VSIX
 * ships only dist/ (see package.json "files"), so the catalog file is not read
 * at runtime; test/extension.test.ts asserts this mirror keeps the same server
 * ids and required flags as the central catalog.
 */
const mcpCatalog: McpCatalogEntry[] = [
  { id: "workflow", name: "Workflow MCP (Phase 2)", required: false, skills: ["start-epic", "join-epic", "change-epic", "start-ticket", "resume-workflow", "import-pod-members"] },
  { id: "jira", name: "Jira MCP", required: false, skills: [] },
  { id: "confluence", name: "Confluence MCP", required: false, skills: [] },
  { id: "github-enterprise", name: "GitHub MCP", required: false, skills: [] },
  { id: "figma-desktop", name: "Figma Desktop", required: false, skills: [] },
  { id: "code-graph", name: "Code graph", required: false, skills: [] },
];

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Local Copilot SDLC");
  const logger = new ExtensionLogger(output);
  if (activateGitHubOnlyMvp(context, output)) return;
  const config = () => vscode.workspace.getConfiguration("sdlc");
  const client = () => new WorkflowClient(config().get<string>("workflowServiceUrl", "http://127.0.0.1:8080"),
    fetch, config().get<string>("demoActorId") || undefined);
  const epicSelection = new EpicSelectionStore();
  const myWorkProvider = new MyWorkProvider(client());
  const scrumMasterProvider = new ScrumMasterProvider(client(), epicSelection);
  const epicProvider = new EpicProvider(client(), epicSelection);
  const ticketProvider = new TicketProvider(client(), epicSelection);
  const identityPodProvider = new IdentityPodProvider(client());
  const customizationProvider = new CustomizationProvider(context.globalState);
  const mcpCenterProvider = new McpCenterProvider(mcpCatalog, client());
  // Every view provider implements the tree contract and its own refresh();
  // the intersection makes the refresh fan-out below type-safe.
  const viewProviders: Array<vscode.TreeDataProvider<vscode.TreeItem> & { refresh(): Promise<void> }> = [
    myWorkProvider,
    scrumMasterProvider,
    epicProvider,
    ticketProvider,
    identityPodProvider,
    customizationProvider,
    mcpCenterProvider,
  ];
  const readinessProvider = new ReadinessTreeProvider(client());
  const status = new WorkflowStatusBar();
  let tasks: WorkflowTask[] = [];

  const taskViewIds = viewIds.filter((id) => id !== "sdlc.diagnostics");
  for (let index = 0; index < taskViewIds.length; index += 1) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(taskViewIds[index]!, viewProviders[index]!));
  }
  context.subscriptions.push(vscode.window.registerTreeDataProvider("sdlc.diagnostics", readinessProvider),
    epicSelection, scrumMasterProvider, epicProvider, ticketProvider);

  // Per-view refresh fan-out: every provider refreshes independently and a
  // failure in one view never blocks the others. Each provider's refresh()
  // already swallows its own errors into the view's error state; the try/catch
  // here is the last line of defense and keeps a rejection visible to
  // allSettled instead of escaping into the aggregate.
  const refreshView = async (provider: { refresh(): Promise<void> }): Promise<void> => {
    try {
      await provider.refresh();
    } catch (error) {
      logger.error("view_refresh_failed", { message: safeMessage(error) });
      throw error;
    }
  };

  const refresh = async () => {
    const refreshables: Array<{ refresh(): Promise<void> }> = [...viewProviders, readinessProvider];
    const settled = await Promise.allSettled(refreshables.map((provider) => refreshView(provider)));

    // Aggregate summary for the status bar and logger, unchanged from the
    // single-provider wiring.
    let total = 0;
    let actionable = 0;
    try {
      tasks = await client().listTasks();
      total = tasks.length;
      actionable = tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)).length;
    } catch (error) {
      logger.error("aggregate_tasks_failed", { message: safeMessage(error) });
    }
    status.update(total, actionable);
    logger.info("tasks_refreshed", {
      total, actionable,
      viewFailures: settled.filter((result) => result.status === "rejected").length,
    });
  };

  // Shared action runner: executes a workflow mutation, refreshes all views,
  // and surfaces a single success/failure message. Keeps the per-command
  // handlers below short and consistently safe.
  const runAction = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      await refresh();
      void vscode.window.showInformationMessage(`${label} succeeded.`);
    } catch (error) {
      logger.error("action_failed", { message: safeMessage(error) });
      void vscode.window.showErrorMessage(`${label} failed. Check Diagnostics.`);
    }
  };

  const poller = new TaskPoller(refresh, () => vscode.window.state.focused, {
      foregroundMs: config().get<number>("foregroundPollSeconds", 60) * 1000,
      backgroundMs: config().get<number>("backgroundPollSeconds", 300) * 1000,
    });
  poller.start();

  context.subscriptions.push(output, status, { dispose: () => poller.stop() },
    vscode.window.onDidChangeWindowState((state) => { if (state.focused) void poller.onFocus(); }),
    vscode.commands.registerCommand("sdlc.refreshTasks", async () => {
      try { await refresh(); } catch (error) { logger.error("refresh_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("SDLC refresh failed. Open Diagnostics for details."); }
    }),
    vscode.commands.registerCommand("sdlc.selectEpic", (epicId?: string) => {
      if (typeof epicId === "string" && epicId.length > 0) epicSelection.select(epicId);
    }),
    vscode.commands.registerCommand("sdlc.openTask", async (taskId?: string) => {
      const selected = taskId ?? await chooseTask(tasks);
      if (!selected) return;
      try {
        const task = await client().getTask(selected);
        const panel = vscode.window.createWebviewPanel("sdlcTask", `Task ${task.scope.ticketId}`, vscode.ViewColumn.Active, { enableScripts: false });
        panel.webview.html = shell(panel.webview, `Task ${task.scope.ticketId}`, `<pre class="card">${escapeHtml(JSON.stringify(task, null, 2))}</pre>`);
      } catch (error) { logger.error("open_task_failed", { message: safeMessage(error) }); }
    }),
    vscode.commands.registerCommand("sdlc.openReport", async () => {
      const artifactId = await vscode.window.showInputBox({ title: "Artifact ID", prompt: "Example: ART-1", ignoreFocusOut: true });
      if (!artifactId) return;
      const versionText = await vscode.window.showInputBox({ title: "Artifact version", value: "1", validateInput: positiveInteger });
      if (!versionText) return;
      try { openReportPanel(`${artifactId} v${versionText}`, await client().getReport(artifactId, Number(versionText))); }
      catch (error) { logger.error("open_report_failed", { message: safeMessage(error) }); }
    }),
    vscode.commands.registerCommand("sdlc.openJourneyReport", async () => {
      const picked = await vscode.window.showOpenDialog({ title: "Select a reviewed Journey manifest", canSelectMany: false, filters: { "Journey manifest": ["json"] } });
      if (!picked?.[0]) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        const manifest = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        openJourneyReportPanel(await client().renderJourneyReport(manifest));
      } catch (error) {
        logger.error("journey_report_failed", { message: safeMessage(error) });
        void vscode.window.showErrorMessage("Journey report failed. Validate the manifest and open Diagnostics.");
      }
    }),
    vscode.commands.registerCommand("sdlc.approve", async () => {
      const taskId = await vscode.window.showInputBox({ title: "Task ID" }); if (!taskId) return;
      const artifactId = await vscode.window.showInputBox({ title: "Artifact ID" }); if (!artifactId) return;
      const artifactVersion = await askVersion("Artifact version"); if (!artifactVersion) return;
      const taskVersion = await askVersion("Current task version", true); if (taskVersion === undefined) return;
      openApprovalPanel({ taskId, artifactId, artifactVersion, taskVersion }, async () => {
        await client().approve({ taskId, artifactId, artifactVersion, expectedTaskVersion: taskVersion });
        await refresh();
        void vscode.window.showInformationMessage(`Approved ${artifactId} version ${artifactVersion}.`);
      });
    }),
    vscode.commands.registerCommand("sdlc.copyCopilotCommand", async () => {
      const task = await chooseTask(tasks);
      const command = task ? `/resume-workflow ${task}` : "/start-ticket DEMO-123";
      await vscode.env.clipboard.writeText(command);
      void vscode.window.showInformationMessage(`Copied: ${command}`);
    }),
    vscode.commands.registerCommand("sdlc.copyTaskCopilotCommand", async (taskId?: unknown) => {
      const id = itemId(taskId, ["taskId"]);
      if (!id) return;
      try {
        const task = await client().getTask(id);
        const command = `/resume-workflow ${task.scope.ticketId}`;
        await vscode.env.clipboard.writeText(command);
        void vscode.window.showInformationMessage(`Copied: ${command}`);
      } catch (error) { logger.error("copy_task_command_failed", { message: safeMessage(error) }); }
    }),
    vscode.commands.registerCommand("sdlc.claimTask", (taskId?: unknown) => {
      const id = itemId(taskId, ["taskId"]); if (!id) return;
      return runAction("Claim task", () => client().claimTask(id));
    }),
    vscode.commands.registerCommand("sdlc.resumeTask", (taskId?: unknown) => {
      const id = itemId(taskId, ["taskId"]); if (!id) return;
      return runAction("Resume task", () => client().resumeTask(id));
    }),
    vscode.commands.registerCommand("sdlc.createEpic", async () => {
      const title = await vscode.window.showInputBox({ title: "Epic title", prompt: "e.g. Account opening", ignoreFocusOut: true });
      if (!title) return;
      const journeyId = await vscode.window.showInputBox({ title: "Journey ID", value: ACCOUNT_OPENING_JOURNEY, ignoreFocusOut: true });
      if (!journeyId) return;
      try {
        const epic = await client().createEpic({ title, journeyId });
        epicSelection.select(epic.epicId);
        await refresh();
        void vscode.window.showInformationMessage(`Created epic ${epic.epicId}.`);
      } catch (error) { logger.error("create_epic_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Create epic failed. Check Diagnostics."); }
    }),
    vscode.commands.registerCommand("sdlc.activateEpic", (epicId?: unknown) => {
      const id = itemId(epicId, ["epicId"]); if (!id) return;
      return runAction("Activate epic", () => client().activateEpic(id));
    }),
    vscode.commands.registerCommand("sdlc.createChangeRequest", async (epicId?: unknown) => {
      const id = itemId(epicId, ["epicId"]); if (!id) return;
      const title = await vscode.window.showInputBox({ title: "Change request title", prompt: "e.g. Add document verification step" });
      if (!title) return;
      return runAction("Create change request", () => client().createChangeRequest(id, { title }));
    }),
    vscode.commands.registerCommand("sdlc.approveChangeRequest", async (epicId?: unknown, changeRequestId?: unknown) => {
      const id = itemId(epicId, ["epicId"]); if (!id) return;
      const changeId = itemId(changeRequestId, ["changeRequestId"]);
      if (!changeId) { void vscode.window.showWarningMessage("Select a change request to approve."); return; }
      return runAction("Approve change request", () => client().approveChangeRequest(id, changeId));
    }),
    vscode.commands.registerCommand("sdlc.addEpicDependency", async (epicId?: unknown) => {
      const id = itemId(epicId, ["epicId"]); if (!id) return;
      const dependsOn = await vscode.window.showInputBox({ title: "Depends on epic ID", prompt: "e.g. EPIC-M2-0" });
      if (!dependsOn) return;
      return runAction("Add dependency", () => client().addEpicDependency(id, { dependsOnEpicId: dependsOn }));
    }),
    vscode.commands.registerCommand("sdlc.advanceTicket", (ticketId?: unknown) => {
      const id = itemId(ticketId, ["ticketId"]); if (!id) return;
      return runAction("Advance ticket", () => client().advanceTicket(id));
    }),
    vscode.commands.registerCommand("sdlc.requestApproval", (ticketId?: unknown) => {
      const id = itemId(ticketId, ["ticketId"]); if (!id) return;
      return runAction("Request approval", () => client().requestApproval(id));
    }),
    vscode.commands.registerCommand("sdlc.skipTicket", async (ticketId?: unknown) => {
      const id = itemId(ticketId, ["ticketId"]); if (!id) return;
      const reason = await vscode.window.showInputBox({ title: "Skip reason", prompt: "Why is this ticket skipped?" });
      if (!reason) return;
      return runAction("Skip ticket", () => client().skipTicket(id, reason));
    }),
    vscode.commands.registerCommand("sdlc.openTicketArtifact", async (ticketId?: unknown) => {
      const id = itemId(ticketId, ["ticketId"]);
      const artifactId = await vscode.window.showInputBox(id === undefined
        ? { title: "Artifact ID", prompt: "Example: ART-1", ignoreFocusOut: true }
        : { title: "Artifact ID", value: id, prompt: "Example: ART-1", ignoreFocusOut: true });
      if (!artifactId) return;
      const versionText = await vscode.window.showInputBox({ title: "Artifact version", value: "1", validateInput: positiveInteger });
      if (!versionText) return;
      try { openReportPanel(`${artifactId} v${versionText}`, await client().getReport(artifactId, Number(versionText))); }
      catch (error) { logger.error("open_artifact_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Artifact report failed. Check Diagnostics."); }
    }),
    vscode.commands.registerCommand("sdlc.importPodRoster", async () => {
      const picked = await vscode.window.showOpenDialog({ title: "Select pod roster CSV", canSelectMany: false, filters: { "Pod roster": ["csv"] } });
      if (!picked?.[0]) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        const members = parseRosterCsv(new TextDecoder().decode(bytes));
        if (members.length === 0) { void vscode.window.showWarningMessage("No valid roster rows in the selected CSV."); return; }
        const validation = await client().validatePodMembers(ACCOUNT_OPENING_JOURNEY, members);
        if (!validation.valid) {
          void vscode.window.showErrorMessage(`Roster validation failed: ${validation.errors.join("; ")}`);
          return;
        }
        const confirm = await vscode.window.showQuickPick([
          { label: `Import ${members.length} members`, description: "Validated roster", value: "import" },
          { label: "Cancel", description: "Keep the current pod", value: "cancel" },
        ], { title: "Confirm pod roster import" });
        if (!confirm || confirm.value === "cancel") return;
        await client().importPodMembers(ACCOUNT_OPENING_JOURNEY, members);
        await refresh();
        void vscode.window.showInformationMessage(`Imported ${members.length} pod members.`);
      } catch (error) {
        logger.error("roster_import_failed", { message: safeMessage(error) });
        void vscode.window.showErrorMessage("Pod roster import failed. Check Diagnostics.");
      }
    }),
    vscode.commands.registerCommand("sdlc.copyStandupDigest", async (epicId?: unknown) => {
      const id = itemId(epicId, ["epicId"]) ?? epicSelection.selectedEpicId();
      if (!id) { void vscode.window.showWarningMessage("Select an epic first."); return; }
      try {
        const resume = await client().getEpicResume(id);
        await vscode.env.clipboard.writeText(buildStandupDigest(resume));
        void vscode.window.showInformationMessage("Standup digest copied.");
      } catch (error) { logger.error("copy_standup_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Standup digest failed. Check Diagnostics."); }
    }),
    vscode.commands.registerCommand("sdlc.installCustomizationBundle", async () => {
      try { await installCustomizationBundle(context); await customizationProvider.refresh(); }
      catch (error) { logger.error("customization_install_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Customization bundle validation or installation failed. No bundle was activated."); }
    }),
    vscode.commands.registerCommand("sdlc.rollbackCustomizationBundle", async () => {
      try { await rollbackCustomizationBundle(context); await customizationProvider.refresh(); }
      catch (error) { logger.error("customization_rollback_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Customization rollback failed. No bundle was changed."); }
    }),
    vscode.commands.registerCommand("sdlc.rollbackBundleTo", (version?: unknown) => {
      const target = itemId(version, ["version"]); if (!target) return;
      void (async () => {
        try { await rollbackBundleToVersion(context, target); await customizationProvider.refresh(); }
        catch (error) { logger.error("rollback_to_failed", { message: safeMessage(error) }); void vscode.window.showErrorMessage("Rollback failed. No bundle was changed."); }
      })();
    }),
    vscode.commands.registerCommand("sdlc.openMcpCenter", () => openMcpCenter()),
    vscode.commands.registerCommand("sdlc.checkMcpHealth", async () => {
      const results = await checkMcpHealth(client(), hasMcpConfig());
      const panel = vscode.window.createWebviewPanel("sdlcDiagnostics", "SDLC Diagnostics", vscode.ViewColumn.Active, { enableScripts: false });
      panel.webview.html = shell(panel.webview, "Diagnostics", results.map((result) =>
        `<section class="card"><h2>${result.ok ? "PASS" : "ACTION REQUIRED"} · ${escapeHtml(result.name)}</h2><p>${escapeHtml(result.detail)}</p></section>`).join(""));
      logger.info("diagnostics_completed", { passing: results.filter((result) => result.ok).length, total: results.length });
    }),
    vscode.commands.registerCommand("sdlc.checkMcpHealthLatency", async () => {
      const result = await client().healthLatency();
      mcpCenterProvider.setHealth(result);
      void vscode.window.showInformationMessage(result.ok ? `MCP health OK (${result.latencyMs}ms).` : `MCP health FAIL (${result.latencyMs}ms).`);
    }));

  logger.info("extension_activated", { views: viewIds.length });
}

export function deactivate(): void {}

async function chooseTask(tasks: WorkflowTask[]): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(tasks.map((task) => ({
    label: `${task.scope.ticketId} · ${task.status}`, description: task.scope.repositoryAlias, taskId: task.taskId,
  })), { title: "Select persisted workflow task" });
  return picked?.taskId;
}

async function askVersion(title: string, allowZero = false): Promise<number | undefined> {
  const value = await vscode.window.showInputBox({ title, value: allowZero ? "0" : "1", validateInput: (text) => positiveInteger(text, allowZero) });
  return value === undefined ? undefined : Number(value);
}

function positiveInteger(value: string, allowZero = false): string | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number >= (allowZero ? 0 : 1) ? undefined : "Enter a valid version number";
}

/** Coerces a command argument — a raw id string or a tree item carrying it — into an id. */
function itemId(arg: unknown, keys: string[]): string | undefined {
  if (typeof arg === "string" && arg.length > 0) return arg;
  if (arg && typeof arg === "object") {
    for (const key of keys) {
      const value = (arg as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

function hasMcpConfig(): boolean {
  return vscode.workspace.workspaceFolders?.some((folder) => existsSync(join(folder.uri.fsPath, ".vscode", "mcp.json"))) ?? false;
}

function openMcpCenter(): void {
  const panel = vscode.window.createWebviewPanel("sdlcMcpCenter", "Local MCP Center", vscode.ViewColumn.Active, { enableScripts: true });
  const example = JSON.stringify({ servers: { "sdlc-workflow": { type: "stdio", command: "node", args: ["<central-repo>/apps/workflow-mcp/dist/index.js"], env: { WORKFLOW_SERVICE_URL: "http://127.0.0.1:8080" } } } }, null, 2);
  const rows = [
    ["Workflow MCP", "Required", "Persist and resume SDLC state"],
    ["Jira MCP", "Internal adapter", "Ticket context and milestone comments"],
    ["Confluence MCP", "Internal adapter", "Read approved team knowledge"],
    ["GitHub MCP", "Internal adapter", "Repository, PR, and checks context"],
    ["Code graph / Understand Anything", "Optional experiment", "Local architecture and call relationships"],
  ];
  panel.webview.html = shell(panel.webview, "Local MCP Center", rows.map(([name, state, purpose]) =>
    `<section class="card"><h2>${escapeHtml(name!)}</h2><p><strong>${escapeHtml(state!)}</strong> — ${escapeHtml(purpose!)}</p></section>`).join("") +
    `<h2>Workspace configuration</h2><pre class="card">${escapeHtml(example)}</pre><button id="copy">Copy reviewed example</button>`,
    `const vscode=acquireVsCodeApi();document.getElementById('copy').addEventListener('click',()=>vscode.postMessage({type:'copy'}));`);
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === "copy") { await vscode.env.clipboard.writeText(example); void vscode.window.showInformationMessage("MCP example copied. Review paths and secrets before saving."); }
  });
}

function safeMessage(error: unknown): string { return error instanceof Error ? error.message.replace(/(token|password|secret)=[^\s]+/gi, "$1=[redacted]") : "Unknown error"; }
