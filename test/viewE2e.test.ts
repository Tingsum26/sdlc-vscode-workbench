import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type { ReadinessRow } from "../src/views/readinessModel.js";
import type { TicketProvider } from "../src/views/ticketProvider.js";

// Extension-level E2E: activate the real extension.ts with a mocked vscode and
// a mocked global fetch, then assert the 8 registered tree providers, the
// Ticket -> Repo Task nesting, and the Diagnostics health rows produced by the
// fan-out refresh. The vi.mock factory is hoisted above module scope, so the
// shared helpers and the registration registry are created through vi.hoisted.
const { makeEventEmitter, makeDisposable, makeOutputChannel, makeStatusBarItem, registry, configValues } = vi.hoisted(() => ({
  makeEventEmitter: () => {
    const listeners = new Set<(value: void) => unknown>();
    return {
      event: vi.fn((listener: (value: void) => unknown) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      }),
      fire: vi.fn(() => { for (const listener of listeners) listener(); }),
    };
  },
  makeDisposable: () => ({ dispose: vi.fn() }),
  makeOutputChannel: () => ({ name: "Local Copilot SDLC", appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), hide: vi.fn(), clear: vi.fn(), dispose: vi.fn() }),
  makeStatusBarItem: () => ({ command: "", text: "", tooltip: "", show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
  registry: { treeProviders: new Map<string, unknown>(), commands: new Map<string, (...args: unknown[]) => unknown>() },
  configValues: {
    workflowServiceUrl: "http://127.0.0.1:8080",
    demoActorId: "DEMO-ACTOR",
    foregroundPollSeconds: 60,
    backgroundPollSeconds: 300,
  } as Record<string, unknown>,
}));

vi.mock("vscode", () => ({
  EventEmitter: vi.fn(function () { return makeEventEmitter(); }),
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
  ViewColumn: { Active: 1, Beside: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: {
    createOutputChannel: vi.fn(() => makeOutputChannel()),
    createStatusBarItem: vi.fn(() => makeStatusBarItem()),
    createWebviewPanel: vi.fn(() => ({ webview: { html: "", onDidReceiveMessage: vi.fn(() => makeDisposable()) } })),
    state: { focused: true },
    onDidChangeWindowState: vi.fn(() => makeDisposable()),
    registerTreeDataProvider: vi.fn((id: string, provider: unknown) => {
      registry.treeProviders.set(id, provider);
      return makeDisposable();
    }),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, fallback: unknown) => (key in configValues ? configValues[key] : fallback)),
    })),
    fs: { readFile: vi.fn() },
    workspaceFolders: [],
  },
  commands: {
    registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
      registry.commands.set(id, handler);
      return makeDisposable();
    }),
  },
  env: { clipboard: { writeText: vi.fn() } },
}));

import { activate } from "../src/extension.js";

const task = { taskId: "TASK-1", type: "REQUIREMENT_ANALYSIS", status: "WAITING_FOR_LOCAL_COPILOT", scope: { ticketId: "DEMO-123", repositoryAlias: "REPO_A", targetCommit: "0123456789abcdef0123456789abcdef01234567" }, version: 0, updatedAt: "2026-08-18T00:00:00Z" };
const epic = { epicId: "EPIC-M2-1", title: "Account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 };
const alternateEpic = { epicId: "EPIC-LIVE-2", title: "Card replacement", journeyId: "CARD_REPLACEMENT", status: "ACTIVE", version: 4 };
const ticket = { ticketId: "M2-API-1", epicId: "EPIC-M2-1", channel: "API", status: "PR_OPEN", pendingChangeConfirmation: false, version: 5 };
const alternateTicket = { ticketId: "LIVE-WEB-2", epicId: "EPIC-LIVE-2", channel: "WEB", status: "IN_PROGRESS", pendingChangeConfirmation: false, version: 6 };
const repoTask = { repoTaskId: "REPO-TASK-1", ticketId: "M2-API-1", repositoryAlias: "REPO_A", status: "MERGED", version: 2 };
const identity = { employeeId: "EMP-100", displayLabel: "Fictional Scrum Master", source: "ADMIN_BINDING" };
const member = { principalId: "PRINCIPAL-EMP-201", employeeId: "EMP-201", displayLabel: "Fictional Developer", role: "DEVELOPER", onboardingStatus: "ONBOARDED" };
const diagnostic = { provider: "WORKFLOW", status: "PASS", observedAt: "2026-08-18T00:00:00Z", source: "local", safeDetail: "ok" };
const nextValidation = { complete: true, status: "COMPLETE", instruction: "All configured internal validation actions are complete." };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Happy-path Workflow Service router: every endpoint the fan-out refresh touches. */
async function routeWorkflow(url: string): Promise<Response> {
  if (url.endsWith("/api/v1/tasks")) return jsonResponse([task]);
  if (url.endsWith("/api/v1/epics")) return jsonResponse([epic, alternateEpic]);
  if (url.endsWith("/api/v1/epics/EPIC-M2-1/resume")) return jsonResponse({ epic, tickets: [{ ticket, openTasks: [task], nextAction: "Open the PR" }], auditTrail: [] });
  if (url.endsWith("/api/v1/epics/EPIC-M2-1/tickets")) return jsonResponse([ticket]);
  if (url.endsWith("/api/v1/epics/EPIC-LIVE-2/resume")) return jsonResponse({ epic: alternateEpic, tickets: [{ ticket: alternateTicket, openTasks: [], nextAction: "Review browser flow" }], auditTrail: [] });
  if (url.endsWith("/api/v1/epics/EPIC-LIVE-2/tickets")) return jsonResponse([alternateTicket]);
  if (url.includes("/repo-tasks")) return jsonResponse([repoTask]);
  if (url.endsWith("/api/v1/internal-readiness/identity")) return jsonResponse(identity);
  if (url.endsWith("/api/v1/internal-readiness/integrations")) return jsonResponse([diagnostic]);
  if (url.endsWith("/api/v1/internal-readiness/next-validation")) return jsonResponse(nextValidation);
  if (url.endsWith("/api/v1/internal-readiness/pods/ACCOUNT_OPENING/members")) return jsonResponse([member]);
  return jsonResponse([]);
}

function happyFetcher(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request): Promise<Response> => routeWorkflow(String(input)));
}

function mockContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    globalState: { get: vi.fn(() => []), update: vi.fn() },
    globalStorageUri: { fsPath: tmpdir() },
  } as unknown as vscode.ExtensionContext;
}

function rootsOf(viewId: string): vscode.TreeItem[] {
  const provider = registry.treeProviders.get(viewId) as { getChildren(): vscode.TreeItem[] };
  return provider.getChildren();
}

function labelsOf(viewId: string): string[] {
  return rootsOf(viewId).map((item) => String(item.label));
}

describe("extension activation E2E", () => {
  beforeEach(() => {
    registry.treeProviders.clear();
    registry.commands.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("activates eight distinct views, nests repo tasks under tickets, and renders diagnostics health rows", async () => {
    const fetcher = happyFetcher();
    vi.stubGlobal("fetch", fetcher);
    // Fake only the poller's timers so activation's auto-refresh can be driven
    // deterministically without leaving a live 60s poll timer behind.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const context = mockContext();
    activate(context);
    // The TaskPoller schedules its first tick at 0ms; advancing fires it and
    // the whole fan-out refresh (all fetches resolve on the microtask queue).
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // Exactly 8 tree providers, one per view id, all distinct instances.
    const providers = [...registry.treeProviders.entries()];
    expect(providers).toHaveLength(8);
    const ids = providers.map(([id]) => id);
    expect(ids).toEqual([
      "sdlc.myWork", "sdlc.scrumMaster", "sdlc.epic", "sdlc.ticket",
      "sdlc.identityPod", "sdlc.customization", "sdlc.mcpCenter", "sdlc.diagnostics",
    ]);
    expect(ids).not.toContain("sdlc.developer");
    expect(ids).not.toContain("sdlc.repoTask");
    expect(new Set(providers.map(([, provider]) => provider)).size).toBe(8);
    expect(context.subscriptions.length).toBeGreaterThan(0);
    expect(registry.commands.has("sdlc.refreshTasks")).toBe(true);
    expect(registry.commands.has("sdlc.selectEpic")).toBe(true);

    // The fan-out refresh went through the real WorkflowClient + mocked fetch.
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/v1/tasks"), expect.anything());

    // Every view renders its own distinct content from the shared refresh.
    expect(labelsOf("sdlc.myWork")).toContain("DEMO-123 · WAITING_FOR_LOCAL_COPILOT");
    expect(labelsOf("sdlc.scrumMaster")).toContain("M2-API-1 · PR_OPEN");
    expect(labelsOf("sdlc.epic")).toContain("EPIC-M2-1 · Account opening");
    expect(labelsOf("sdlc.ticket")).toContain("M2-API-1 · PR_OPEN");
    expect(labelsOf("sdlc.identityPod").join("\n")).toContain("EMP-201");
    expect(labelsOf("sdlc.customization")).toContain("No installed bundles");
    expect(labelsOf("sdlc.mcpCenter")).toContain("workflow");
    expect(labelsOf("sdlc.mcpCenter")).toContain("Open MCP onboarding");

    // Ticket view nests Repo Task children under a ticket item.
    const ticketProvider = registry.treeProviders.get("sdlc.ticket") as unknown as TicketProvider;
    const ticketItems = ticketProvider.getChildren() as vscode.TreeItem[];
    expect(ticketItems).toHaveLength(1);
    const repoTaskItems = (await ticketProvider.getChildren(ticketItems[0]!)) as vscode.TreeItem[];
    expect(repoTaskItems.map((item) => String(item.label))).toContain("REPO-TASK-1 · MERGED");

    // Diagnostics renders the health rows set by the readiness fan-out, with
    // accessibility on each row item.
    const diagnostics = registry.treeProviders.get("sdlc.diagnostics") as unknown as {
      getChildren(): ReadinessRow[];
      getTreeItem(row: ReadinessRow): vscode.TreeItem;
    };
    const rows = diagnostics.getChildren();
    expect(rows.length).toBe(3);
    expect(rows[0]!.label).toBe("Identity · EMP-100");
    expect(rows.some((row) => row.label === "WORKFLOW · PASS")).toBe(true);
    expect(rows.some((row) => row.label === "Internal validation · Complete")).toBe(true);
    for (const row of rows) {
      expect(diagnostics.getTreeItem(row).accessibilityInformation).toBeDefined();
    }
  });

  it("selecting a live Epic refreshes Ticket and Scrum views without a fixture fallback", async () => {
    const fetcher = happyFetcher();
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    activate(mockContext());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(labelsOf("sdlc.ticket")).toContain("M2-API-1 · PR_OPEN");
    expect(labelsOf("sdlc.scrumMaster")).toContain("M2-API-1 · PR_OPEN");

    registry.commands.get("sdlc.selectEpic")!("EPIC-LIVE-2");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(labelsOf("sdlc.ticket")).toContain("LIVE-WEB-2 · IN_PROGRESS");
    expect(labelsOf("sdlc.scrumMaster")).toContain("LIVE-WEB-2 · IN_PROGRESS");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/v1/epics/EPIC-LIVE-2/tickets"), expect.anything());
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/v1/epics/EPIC-LIVE-2/resume"), expect.anything());
  });

  it("a failing pod-members endpoint does not break the other views or diagnostics", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      if (String(input).includes("/internal-readiness/pods/")) return new Response("{}", { status: 500 });
      return routeWorkflow(String(input));
    });
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    activate(mockContext());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // The identity/pod view degrades to its explicit error row…
    expect(labelsOf("sdlc.identityPod")[0]).toContain("Error: Workflow request failed (500)");
    // …while every other view still renders its data from the fan-out refresh.
    expect(labelsOf("sdlc.epic")).toContain("EPIC-M2-1 · Account opening");
    expect(labelsOf("sdlc.myWork")).toContain("DEMO-123 · WAITING_FOR_LOCAL_COPILOT");
    const rows = (registry.treeProviders.get("sdlc.diagnostics") as { getChildren(): ReadinessRow[] }).getChildren();
    expect(rows.some((row) => row.label === "WORKFLOW · PASS")).toBe(true);
  });

  it("attempts refresh with an empty demo actor and renders authentication state", async () => {
    configValues.demoActorId = "";
    const fetcher = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    activate(mockContext());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalled();
    expect(labelsOf("sdlc.myWork")[0]).toContain("Error: Workflow request failed (401)");
    configValues.demoActorId = "DEMO-ACTOR";
  });
});
