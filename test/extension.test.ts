import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");

/** The exact 8 registered view ids (M6 model: Repo Task is nested under Ticket). */
const EXPECTED_VIEW_IDS = [
  "sdlc.myWork", "sdlc.scrumMaster", "sdlc.epic", "sdlc.ticket",
  "sdlc.identityPod", "sdlc.customization", "sdlc.mcpCenter", "sdlc.diagnostics",
];

// Minimal vscode mock for the provider-level refresh-isolation test below
// (same shape as views.test.ts). The factory is hoisted so vi.mock can use it.
const { makeEventEmitter } = vi.hoisted(() => ({
  makeEventEmitter: () => ({ event: vi.fn(), fire: vi.fn() }),
}));

vi.mock("vscode", () => ({
  EventEmitter: vi.fn(function () { return makeEventEmitter(); }),
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
}));

import * as vscode from "vscode";
import { CustomizationProvider } from "../src/views/customizationProvider.js";
import { EpicProvider } from "../src/views/epicProvider.js";
import { IdentityPodProvider } from "../src/views/identityPodProvider.js";
import { McpCenterProvider } from "../src/views/mcpCenterProvider.js";
import { MyWorkProvider } from "../src/views/myWorkProvider.js";
import { ScrumMasterProvider } from "../src/views/scrumMasterProvider.js";
import { TicketProvider } from "../src/views/ticketProvider.js";
import { EpicSelectionStore } from "../src/views/epicSelection.js";

describe("VSIX static boundaries", () => {
  it("declares exactly the 8 M6 views and no legacy ids", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const viewIds = manifest.contributes.views.sdlcWorkbench.map((view: { id: string }) => view.id);
    expect(viewIds).toEqual(EXPECTED_VIEW_IDS);
    expect(viewIds).not.toContain("sdlc.developer");
    expect(viewIds).not.toContain("sdlc.repoTask");
    expect(manifest.activationEvents).toContain("onStartupFinished");
  });

  it("wires the same 8 ids with one provider per view and no shared TaskTreeProvider", () => {
    const source = readFileSync(resolve(root, "src", "extension.ts"), "utf8");
    const declared = source.match(/const viewIds = (\[[^\]]*\])/)?.[1];
    expect(declared).toBeDefined();
    expect(JSON.parse(declared!)).toEqual(EXPECTED_VIEW_IDS);
    expect(source).not.toMatch(/TaskTreeProvider|taskTreeProvider/);
    for (const name of ["MyWorkProvider", "ScrumMasterProvider", "EpicProvider", "TicketProvider",
      "IdentityPodProvider", "CustomizationProvider", "McpCenterProvider", "ReadinessTreeProvider"]) {
      expect(source).toMatch(new RegExp(`new ${name}\\(`));
    }
    expect(source).toMatch(/Promise\.allSettled/);
  });

  it("mirrors the central MCP catalog server ids and required flags", () => {
    // The VSIX ships only dist/, so the static mirror in extension.ts cannot
    // read central/mcp/catalog.json at runtime; this guard turns the
    // "keep in sync by hand" note into a checked invariant. The central
    // catalog's `servers` array is vendored as a fixture (extracted from the
    // monorepo central/mcp/catalog.json at the seven-repo-split-baseline).
    const central = JSON.parse(readFileSync(resolve(root, "test", "fixtures", "mcp-catalog.json"), "utf8")) as {
      servers: Array<{ id: string; required: boolean }>;
    };
    const source = readFileSync(resolve(root, "src", "extension.ts"), "utf8");
    const mirror = source.match(/const mcpCatalog: McpCatalogEntry\[\] = (\[[\s\S]*?\]);/);
    expect(mirror, "static mcpCatalog literal in extension.ts").not.toBeNull();
    // The literal's object keys are unquoted and the array ends with a
    // trailing comma (valid TS, invalid JSON); normalize before parsing.
    const keyQuoted = mirror![1]!
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*\]$/, "]");
    const catalog = JSON.parse(keyQuoted) as Array<{ id: string; required: boolean }>;

    const byId = (entries: Array<{ id: string; required: boolean }>) =>
      Object.fromEntries(entries.map((entry) => [entry.id, entry.required]));
    expect(Object.keys(byId(catalog)).sort()).toEqual(Object.keys(byId(central.servers)).sort());
    expect(byId(catalog)).toEqual(byId(central.servers));
  });

  it("contains no model invocation or direct persistence integration", () => {
    const source = readdirSync(resolve(root, "src"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8")).join("\n");
    expect(source).not.toMatch(/vscode\.lm|selectChatModels|sendRequest|LanguageModelTool|MongoClient|GridFS|JiraClient/i);
  });
});

describe("per-view refresh isolation", () => {
  afterEach(() => vi.clearAllMocks());

  it("a client whose getPodMembers throws still lets the other views refresh", async () => {
    const task = { taskId: "TASK-1", type: "REQUIREMENT_ANALYSIS", status: "WAITING_FOR_LOCAL_COPILOT", scope: { ticketId: "DEMO-123", repositoryAlias: "REPO_A", targetCommit: "0123456789abcdef0123456789abcdef01234567" }, version: 0, updatedAt: "2026-08-18T00:00:00Z" };
    const epic = { epicId: "EPIC-M2-1", title: "Account opening", journeyId: "ACCOUNT_OPENING", status: "ACTIVE", version: 3 };
    const client = {
      listTasks: vi.fn().mockResolvedValue([task]),
      listEpics: vi.fn().mockResolvedValue([epic]),
      getEpicResume: vi.fn().mockResolvedValue({ epic, tickets: [], auditTrail: [] }),
      listTickets: vi.fn().mockResolvedValue([]),
      listRepoTasks: vi.fn().mockResolvedValue([]),
      getIdentity: vi.fn().mockResolvedValue({ employeeId: "EMP-100", displayLabel: "Fictional Scrum Master", source: "ADMIN_BINDING" }),
      getPodMembers: vi.fn().mockRejectedValue(new Error("pod members unavailable")),
    };
    const myWork = new MyWorkProvider(client as never);
    const selection = new EpicSelectionStore();
    selection.select(epic.epicId);
    const scrumMaster = new ScrumMasterProvider(client as never, selection);
    const epicView = new EpicProvider(client as never, selection);
    const ticketView = new TicketProvider(client as never, selection);
    const identity = new IdentityPodProvider(client as never);
    const customization = new CustomizationProvider({ get: vi.fn().mockReturnValue([]) } as never);
    const mcpCenter = new McpCenterProvider([]);
    const providers = [myWork, scrumMaster, epicView, ticketView, identity, customization, mcpCenter];

    // The same fan-out shape the extension uses: one view's failure never
    // rejects the aggregate and never blocks the other views' refreshes.
    const results = await Promise.allSettled(providers.map((provider) => provider.refresh()));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const labels = (items: vscode.TreeItem[]) => items.map((item) => String(item.label));
    expect(labels(myWork.getChildren() as vscode.TreeItem[])).toContain("DEMO-123 · WAITING_FOR_LOCAL_COPILOT");
    expect(labels(scrumMaster.getChildren() as vscode.TreeItem[])).toContain("No next actions");
    expect(labels(epicView.getChildren() as vscode.TreeItem[])).toContain("EPIC-M2-1 · Account opening");
    expect(labels(ticketView.getChildren() as vscode.TreeItem[])).toContain("No tickets");
    expect(labels(identity.getChildren() as vscode.TreeItem[])[0]).toContain("Error: pod members unavailable");
    expect(labels(customization.getChildren() as vscode.TreeItem[])).toContain("No installed bundles");
    expect(labels(mcpCenter.getChildren() as vscode.TreeItem[])).toContain("No catalog servers");
    expect(client.listTasks).toHaveBeenCalled();
    expect(client.getPodMembers).toHaveBeenCalledWith("ACCOUNT_OPENING");
  });
});
