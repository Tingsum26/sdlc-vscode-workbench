import { afterEach, describe, expect, it, vi } from "vitest";

// The vi.mock factory is hoisted above module-level consts, so the shared
// emitter helper must be created through vi.hoisted (same pattern as
// bundleInstaller.test.ts).
const { makeEventEmitter } = vi.hoisted(() => ({
  makeEventEmitter: () => {
    const listeners = new Set<(value: void) => unknown>();
    return {
      event: vi.fn((listener: (value: void) => unknown) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      }),
      fire: vi.fn(() => { for (const listener of listeners) listener(); }),
      dispose: vi.fn(() => listeners.clear()),
    };
  },
}));

vi.mock("vscode", () => ({
  EventEmitter: vi.fn(function () { return makeEventEmitter(); }),
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
}));

import * as vscode from "vscode";
import { MyWorkProvider } from "../src/views/myWorkProvider.js";
import { ScrumMasterProvider } from "../src/views/scrumMasterProvider.js";
import { EpicProvider } from "../src/views/epicProvider.js";
import { TicketProvider } from "../src/views/ticketProvider.js";
import { IdentityPodProvider } from "../src/views/identityPodProvider.js";
import { CustomizationProvider } from "../src/views/customizationProvider.js";
import { McpCenterProvider } from "../src/views/mcpCenterProvider.js";
import { EpicSelectionStore } from "../src/views/epicSelection.js";

const task = { taskId: "TASK-1", type: "REQUIREMENT_ANALYSIS", status: "WAITING_FOR_LOCAL_COPILOT", scope: { ticketId: "DEMO-123", repositoryAlias: "REPO_A", targetCommit: "0123456789abcdef0123456789abcdef01234567" }, version: 0, updatedAt: "2026-08-18T00:00:00Z" };

describe("view providers", () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it("my work shows only actionable tasks with freshness", async () => {
    const client = { listTasks: vi.fn().mockResolvedValue([{ ...task, evidenceClassification: "SIMULATED_PASS" }]) };
    const provider = new MyWorkProvider(client as never);
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items.length).toBe(1);
    expect(items[0]!.label).toContain("DEMO-123");
    expect(items[0]!.description).toContain("SIMULATED_PASS");
    expect(items[0]!.accessibilityInformation!.label).toContain("Simulated workflow evidence");
  });

  it("my work defaults an old v1 task without classification to REAL", async () => {
    const provider = new MyWorkProvider({ listTasks: vi.fn().mockResolvedValue([task]) } as never);
    await provider.refresh();

    const item = (provider.getChildren() as vscode.TreeItem[])[0]!;
    expect(item.description).toContain("REAL");
    expect(item.accessibilityInformation!.label).toContain("Non-simulated workflow record");
  });

  it("my work keeps last-known rows and visibly marks aged data after a failed refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-21T00:00:00Z"));
    const client = { listTasks: vi.fn().mockResolvedValueOnce([task]).mockRejectedValueOnce(new Error("offline")) };
    const provider = new MyWorkProvider(client as never);
    await provider.refresh();
    vi.setSystemTime(Date.parse("2026-08-21T00:16:00Z"));
    await provider.refresh();

    const items = provider.getChildren() as vscode.TreeItem[];
    expect(String(items[0]!.label)).toContain("showing STALE data: offline");
    expect(items.map((item) => String(item.label))).toContain("DEMO-123 · WAITING_FOR_LOCAL_COPILOT");
    vi.useRealTimers();
  });

  it("renders refresh warnings before empty states after an empty response is followed by a failure", async () => {
    const epic = { epicId: "EPIC-EMPTY", title: "Empty", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 1 };
    const selection = new EpicSelectionStore();
    selection.select(epic.epicId);
    const myWork = new MyWorkProvider({ listTasks: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline")) } as never);
    const epicView = new EpicProvider({ listEpics: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline")) } as never, new EpicSelectionStore());
    const scrum = new ScrumMasterProvider({ getEpicResume: vi.fn().mockResolvedValueOnce({ epic, tickets: [], auditTrail: [] }).mockRejectedValueOnce(new Error("offline")) } as never, selection);
    const ticket = new TicketProvider({ listTickets: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("offline")) } as never, selection);

    const emptyLabels = ["No actionable tasks", "No epics", "No next actions", "No tickets"];
    for (const [index, provider] of [myWork, epicView, scrum, ticket].entries()) {
      await provider.refresh();
      await provider.refresh();
      const items = provider.getChildren() as vscode.TreeItem[];
      expect(String(items[0]!.label)).toContain("Last refresh failed; showing LIVE data: offline");
      expect(items[0]!.accessibilityInformation!.label).toContain("Last refresh failed; showing LIVE data: offline");
      expect(items).toHaveLength(2);
      expect(String(items[1]!.label)).toBe(emptyLabels[index]);
      expect(items[1]!.accessibilityInformation!.label).toContain("No data. Refresh with SDLC: Refresh Tasks.");
    }
  });

  it("ticket and scrum views ask the user to select an epic instead of querying a fixture id", async () => {
    const selection = new EpicSelectionStore();
    const client = { listTickets: vi.fn(), getEpicResume: vi.fn() };
    const ticketProvider = new TicketProvider(client as never, selection);
    const scrumProvider = new ScrumMasterProvider(client as never, selection);

    await Promise.all([ticketProvider.refresh(), scrumProvider.refresh()]);

    expect(String((ticketProvider.getChildren() as vscode.TreeItem[])[0]!.label)).toBe("Select an epic in Epic View");
    expect(String((scrumProvider.getChildren() as vscode.TreeItem[])[0]!.label)).toBe("Select an epic in Epic View");
    expect(client.listTickets).not.toHaveBeenCalled();
    expect(client.getEpicResume).not.toHaveBeenCalled();
  });

  it("fires a tree refresh when Ticket and Scrum views enter the no-selection state", async () => {
    const selection = new EpicSelectionStore();
    const client = { listTickets: vi.fn(), getEpicResume: vi.fn() };
    const ticketProvider = new TicketProvider(client as never, selection);
    const scrumProvider = new ScrumMasterProvider(client as never, selection);
    const ticketChanged = vi.fn();
    const scrumChanged = vi.fn();
    ticketProvider.onDidChangeTreeData(ticketChanged);
    scrumProvider.onDidChangeTreeData(scrumChanged);

    await Promise.all([ticketProvider.refresh(), scrumProvider.refresh()]);

    expect(ticketChanged).toHaveBeenCalledOnce();
    expect(scrumChanged).toHaveBeenCalledOnce();
  });

  it("selects the first fetched epic and uses that live id in ticket and scrum queries", async () => {
    const selection = new EpicSelectionStore();
    const firstEpic = { epicId: "EPIC-LIVE-7", title: "Live account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 };
    const client = {
      listEpics: vi.fn().mockResolvedValue([firstEpic]),
      listTickets: vi.fn().mockResolvedValue([]),
      getEpicResume: vi.fn().mockResolvedValue({ epic: firstEpic, tickets: [], auditTrail: [] }),
    };
    const epicProvider = new EpicProvider(client as never, selection);
    const ticketProvider = new TicketProvider(client as never, selection);
    const scrumProvider = new ScrumMasterProvider(client as never, selection);

    await epicProvider.refresh();
    await Promise.all([ticketProvider.refresh(), scrumProvider.refresh()]);

    expect(selection.selectedEpicId()).toBe("EPIC-LIVE-7");
    expect(client.listTickets).toHaveBeenCalledWith("EPIC-LIVE-7");
    expect(client.getEpicResume).toHaveBeenCalledWith("EPIC-LIVE-7");
  });

  it("keeps an explicit epic selection when a later epic refresh returns a different first row", async () => {
    const selection = new EpicSelectionStore();
    const selected = { epicId: "EPIC-SELECTED", title: "Chosen", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 };
    const client = { listEpics: vi.fn().mockResolvedValue([{ epicId: "EPIC-OTHER", title: "Other", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 }]) };
    selection.select(selected.epicId);
    const provider = new EpicProvider(client as never, selection);

    await provider.refresh();

    expect(selection.selectedEpicId()).toBe(selected.epicId);
  });

  it("does not replace the current ticket view with a stale response after switching epics", async () => {
    const selection = new EpicSelectionStore();
    selection.select("EPIC-FIRST");
    let resolveFirst: ((tickets: Array<{ ticketId: string; epicId: string; channel: string; status: string; pendingChangeConfirmation: boolean; version: number }>) => void) | undefined;
    const firstResponse = new Promise<Array<{ ticketId: string; epicId: string; channel: string; status: string; pendingChangeConfirmation: boolean; version: number }>>((resolve) => { resolveFirst = resolve; });
    const secondTicket = { ticketId: "SECOND-TICKET", epicId: "EPIC-SECOND", channel: "WEB", status: "IN_PROGRESS", pendingChangeConfirmation: false, version: 2 };
    const client = { listTickets: vi.fn().mockReturnValueOnce(firstResponse).mockResolvedValueOnce([secondTicket]) };
    const provider = new TicketProvider(client as never, selection);

    const firstRefresh = provider.refresh();
    selection.select("EPIC-SECOND");
    await Promise.resolve();
    await Promise.resolve();
    resolveFirst!([{ ticketId: "FIRST-TICKET", epicId: "EPIC-FIRST", channel: "API", status: "PR_OPEN", pendingChangeConfirmation: false, version: 1 }]);
    await firstRefresh;

    expect(String((provider.getChildren() as vscode.TreeItem[])[0]!.label)).toContain("SECOND-TICKET");
  });

  it("does not replace current Ticket or Scrum state with a stale rejection", async () => {
    const selection = new EpicSelectionStore();
    selection.select("EPIC-FIRST");
    let rejectTickets: ((reason?: unknown) => void) | undefined;
    let rejectResume: ((reason?: unknown) => void) | undefined;
    const pendingTickets = new Promise<never>((_resolve, reject) => { rejectTickets = reject; });
    const pendingResume = new Promise<never>((_resolve, reject) => { rejectResume = reject; });
    const secondEpic = { epicId: "EPIC-SECOND", title: "Second", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 2 };
    const client = {
      listTickets: vi.fn().mockReturnValueOnce(pendingTickets).mockResolvedValueOnce([]),
      getEpicResume: vi.fn().mockReturnValueOnce(pendingResume).mockResolvedValueOnce({ epic: secondEpic, tickets: [], auditTrail: [] }),
    };
    const ticketProvider = new TicketProvider(client as never, selection);
    const scrumProvider = new ScrumMasterProvider(client as never, selection);

    const firstTicketRefresh = ticketProvider.refresh();
    const firstScrumRefresh = scrumProvider.refresh();
    selection.select("EPIC-SECOND");
    await Promise.resolve();
    await Promise.resolve();
    rejectTickets!(new Error("first ticket request failed"));
    rejectResume!(new Error("first resume request failed"));
    await Promise.all([firstTicketRefresh, firstScrumRefresh]);

    expect(String((ticketProvider.getChildren() as vscode.TreeItem[])[0]!.label)).toBe("No tickets");
    expect(String((scrumProvider.getChildren() as vscode.TreeItem[])[0]!.label)).toBe("No next actions");
  });

  it("disposes selection listeners when scoped providers are disposed", async () => {
    const selection = new EpicSelectionStore();
    const client = { listTickets: vi.fn(), getEpicResume: vi.fn() };
    const ticketProvider = new TicketProvider(client as never, selection);
    const scrumProvider = new ScrumMasterProvider(client as never, selection);

    ticketProvider.dispose();
    scrumProvider.dispose();
    selection.select("EPIC-AFTER-DISPOSE");
    await Promise.resolve();

    expect(client.listTickets).not.toHaveBeenCalled();
    expect(client.getEpicResume).not.toHaveBeenCalled();
  });

  it("ticket view nests repo tasks under tickets", async () => {
    const selection = new EpicSelectionStore();
    selection.select("EPIC-LIVE-7");
    const client = {
      listTickets: vi.fn().mockResolvedValue([{ ticketId: "M2-API-1", epicId: "EPIC-M2-1", channel: "API", status: "PR_OPEN", evidenceClassification: "SIMULATED_PASS", pendingChangeConfirmation: false, version: 5 }]),
      listRepoTasks: vi.fn().mockResolvedValue([{ repoTaskId: "REPO-TASK-1", ticketId: "M2-API-1", repositoryAlias: "REPO_A", status: "MERGED", evidenceClassification: "SIMULATED_PASS", version: 2 }]),
    };
    const provider = new TicketProvider(client as never, selection);
    await provider.refresh();
    const ticketItem = provider.getChildren() as vscode.TreeItem[];
    expect(ticketItem.length).toBe(1);
    expect(ticketItem[0]!.description).toContain("SIMULATED_PASS");
    const children = await provider.getChildren(ticketItem[0]);
    expect((children as vscode.TreeItem[])[0]!.label).toContain("REPO-TASK-1");
    expect((children as vscode.TreeItem[])[0]!.description).toContain("SIMULATED_PASS");
  });

  it("identity view lists pod members", async () => {
    const client = {
      getIdentity: vi.fn().mockResolvedValue({ employeeId: "EMP-100", displayLabel: "Fictional Scrum Master", source: "ADMIN_BINDING" }),
      getPodMembers: vi.fn().mockResolvedValue([{ principalId: "PRINCIPAL-EMP-201", employeeId: "EMP-201", displayLabel: "Fictional Developer", role: "DEVELOPER", onboardingStatus: "NOT_ONBOARDED" }]),
    };
    const provider = new IdentityPodProvider(client as never);
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items.some((item) => String(item.label).includes("EMP-201"))).toBe(true);
  });

  it("epic view lists epics with status and freshness text", async () => {
    const client = { listEpics: vi.fn().mockResolvedValue([{ epicId: "EPIC-M2-1", title: "Account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 }]) };
    const provider = new EpicProvider(client as never, new EpicSelectionStore());
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items[0]!.label).toContain("EPIC-M2-1");
    expect(items[0]!.description).toMatch(/^ACTIVE · (LIVE|DELAYED|STALE|OFFLINE)$/);
    expect(items[0]!.accessibilityInformation!.label).toMatch(/Freshness (LIVE|DELAYED|STALE|OFFLINE)/);
  });

  it("scrum master shows the selected epic's next actions", async () => {
    const selection = new EpicSelectionStore();
    selection.select("EPIC-LIVE-7");
    const client = {
      getEpicResume: vi.fn().mockResolvedValue({
        epic: { epicId: "EPIC-M2-1", title: "Account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 },
        tickets: [{ ticket: { ticketId: "M2-API-1", epicId: "EPIC-M2-1", channel: "API", status: "PR_OPEN", pendingChangeConfirmation: false, version: 5 }, openTasks: [], nextAction: "Open the PR" }],
        auditTrail: [],
      }),
    };
    const provider = new ScrumMasterProvider(client as never, selection);
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items[0]!.label).toContain("M2-API-1");
    expect(items[0]!.description).toMatch(/^Open the PR · (LIVE|DELAYED|STALE|OFFLINE)$/);
    expect(client.getEpicResume).toHaveBeenCalledWith("EPIC-LIVE-7");
  });

  it("customization view lists installed bundle versions plus commands", async () => {
    const store = { get: vi.fn().mockReturnValue([{ version: "2.0.0", root: "/bundles/2.0.0", installedAt: "2026-08-18T00:00:00Z" }]) };
    const provider = new CustomizationProvider(store as never);
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items.length).toBe(4);
    expect(items[0]!.label).toBe("2.0.0");
    expect(items[0]!.description).toMatch(/^2026-08-18T00:00:00Z · (LIVE|DELAYED|STALE|OFFLINE)$/);
    expect(store.get).toHaveBeenCalledWith("sdlc.installedCustomizationBundles", []);
  });

  it("mcp center lists catalog servers with skill counts", async () => {
    const provider = new McpCenterProvider([
      { id: "workflow-mcp", name: "Workflow MCP", required: true, skills: ["resume-workflow", "start-ticket"] },
      { id: "github-mcp", name: "GitHub MCP", required: false, skills: [] },
    ]);
    await provider.refresh();
    const items = provider.getChildren() as vscode.TreeItem[];
    expect(items.length).toBe(3);
    expect(items[0]!.label).toBe("workflow-mcp");
    expect(items[0]!.description).toMatch(/^required · (LIVE|DELAYED|STALE|OFFLINE)$/);
    expect(items[1]!.description).toMatch(/^optional · (LIVE|DELAYED|STALE|OFFLINE)$/);
  });

  it("every provider item carries accessibilityInformation with text status and freshness", async () => {
    const epic = { epicId: "EPIC-M2-1", title: "Account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 };
    const ticket = { ticketId: "M2-API-1", epicId: "EPIC-M2-1", channel: "API", status: "PR_OPEN", pendingChangeConfirmation: false, version: 5 };
    const client = {
      listTasks: vi.fn().mockResolvedValue([task]),
      listEpics: vi.fn().mockResolvedValue([epic]),
      getEpicResume: vi.fn().mockResolvedValue({ epic, tickets: [{ ticket, openTasks: [task], nextAction: "Open the PR" }], auditTrail: [] }),
      listTickets: vi.fn().mockResolvedValue([ticket]),
      listRepoTasks: vi.fn().mockResolvedValue([{ repoTaskId: "REPO-TASK-1", ticketId: "M2-API-1", repositoryAlias: "REPO_A", status: "MERGED", version: 2 }]),
      getIdentity: vi.fn().mockResolvedValue({ employeeId: "EMP-100", displayLabel: "Fictional Scrum Master", source: "ADMIN_BINDING" }),
      getPodMembers: vi.fn().mockResolvedValue([{ principalId: "P-1", employeeId: "EMP-201", displayLabel: "Fictional Developer", role: "DEVELOPER", onboardingStatus: "ONBOARDED" }]),
    };
    const selection = new EpicSelectionStore();
    selection.select(epic.epicId);
    const providers: Array<{ refresh(): Promise<void>; getChildren(): vscode.TreeItem[] | Thenable<vscode.TreeItem[]> }> = [
      new MyWorkProvider(client as never),
      new ScrumMasterProvider(client as never, selection),
      new EpicProvider(client as never, selection),
      new TicketProvider(client as never, selection),
      new IdentityPodProvider(client as never),
      new CustomizationProvider({ get: vi.fn().mockReturnValue([{ version: "2.0.0", root: "/bundles", installedAt: "2026-08-18T00:00:00Z" }]) } as never),
      new McpCenterProvider([{ id: "workflow-mcp", name: "Workflow MCP", required: true, skills: ["start-ticket"] }]),
    ];
    await Promise.all(providers.map((provider) => provider.refresh()));

    for (const provider of providers) {
      const items = (await provider.getChildren()) as vscode.TreeItem[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.accessibilityInformation, `a11y missing on "${String(item.label)}"`).toBeDefined();
        expect(item.accessibilityInformation!.label.length).toBeGreaterThan(0);
      }
    }

    // Freshness and status are conveyed as text, not only via icon/color.
    const epicItems = (await providers[2]!.getChildren()) as vscode.TreeItem[];
    expect(String(epicItems[0]!.description)).toMatch(/^ACTIVE · (LIVE|DELAYED|STALE|OFFLINE)$/);
    expect(epicItems[0]!.accessibilityInformation!.label).toContain("Status ACTIVE.");
    expect(epicItems[0]!.accessibilityInformation!.label).toMatch(/Freshness (LIVE|DELAYED|STALE|OFFLINE)/);

    // The Ticket view's nested Repo Task children carry accessibility too.
    const ticketProvider = providers[3] as unknown as { getChildren(element?: vscode.TreeItem): vscode.TreeItem[] | Thenable<vscode.TreeItem[]> };
    const ticketItems = (await ticketProvider.getChildren()) as vscode.TreeItem[];
    const repoTaskItems = (await ticketProvider.getChildren(ticketItems[0])) as vscode.TreeItem[];
    expect(String(repoTaskItems[0]!.label)).toContain("REPO-TASK-1");
    expect(repoTaskItems[0]!.accessibilityInformation).toBeDefined();
  });

  it("empty and error states render explicit labeled items with accessibility", async () => {
    const empty = new MyWorkProvider({ listTasks: vi.fn().mockResolvedValue([]) } as never);
    await empty.refresh();
    const emptyItems = empty.getChildren() as vscode.TreeItem[];
    expect(String(emptyItems[0]!.label)).toBe("No actionable tasks");
    expect(emptyItems[0]!.accessibilityInformation).toBeDefined();

    const failing = new MyWorkProvider({ listTasks: vi.fn().mockRejectedValue(new Error("boom")) } as never);
    await failing.refresh();
    const errorItems = failing.getChildren() as vscode.TreeItem[];
    expect(String(errorItems[0]!.label)).toBe("Error: boom · retry with SDLC: Refresh Tasks");
    expect(errorItems[0]!.accessibilityInformation).toBeDefined();
  });
});
