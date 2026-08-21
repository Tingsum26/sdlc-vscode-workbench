import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// configUpdates records every config write (for last-write assertions);
// configState mirrors the live configuration so `get` returns what was last
// written, exactly like the real VS Code settings host.
const { configUpdates, configState } = vi.hoisted(() => {
  const configState = new Map<string, unknown>();
  return {
    configUpdates: [] as Array<{ section: string | undefined; key: string; value: unknown }>,
    configState,
  };
});

const sourceCopyMutation = vi.hoisted(() => ({
  sourceRoot: "",
  afterCopy: undefined as (() => void) | undefined,
  triggered: false,
  renameFailure: undefined as Error | undefined,
  renameCalls: 0,
  failConfigWriteAt: 0,
  failConfigWritesAt: [] as number[],
  configWriteCalls: 0,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    cp: async (source: string, destination: string, options?: Parameters<typeof actual.cp>[2]) => {
      await actual.cp(source, destination, options);
      if (source === sourceCopyMutation.sourceRoot && sourceCopyMutation.afterCopy) {
        sourceCopyMutation.triggered = true;
        const mutation = sourceCopyMutation.afterCopy;
        sourceCopyMutation.afterCopy = undefined;
        mutation();
      }
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      sourceCopyMutation.renameCalls++;
      if (sourceCopyMutation.renameFailure) throw sourceCopyMutation.renameFailure;
      return actual.rename(...args);
    },
  };
});

vi.mock("vscode", () => ({
  window: {
    showOpenDialog: vi.fn(),
    showInformationMessage: vi.fn(),
    showQuickPick: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn((section?: string) => ({
      get: vi.fn((key: string, fallback: unknown) => {
        const stateKey = `${section ?? ""}|${key}`;
        return configState.has(stateKey) ? configState.get(stateKey) : fallback;
      }),
      update: vi.fn((key: string, value: unknown) => {
        sourceCopyMutation.configWriteCalls++;
        if (sourceCopyMutation.failConfigWriteAt === sourceCopyMutation.configWriteCalls
            || sourceCopyMutation.failConfigWritesAt.includes(sourceCopyMutation.configWriteCalls)) {
          sourceCopyMutation.failConfigWriteAt = 0;
          return Promise.reject(new Error("forced configuration write failure"));
        }
        configUpdates.push({ section, key, value });
        configState.set(`${section ?? ""}|${key}`, value);
        return Promise.resolve();
      }),
    })),
  },
  ConfigurationTarget: { Global: 1 },
}));

import * as vscode from "vscode";
import { hookCommand, installCustomizationBundle, resolveNodeRuntime, rollbackCustomizationBundle, skillInstallPath } from "../src/customization/bundleInstaller.js";

beforeEach(() => {
  configUpdates.length = 0;
  configState.clear();
  sourceCopyMutation.sourceRoot = "";
  sourceCopyMutation.afterCopy = undefined;
  sourceCopyMutation.triggered = false;
  sourceCopyMutation.renameFailure = undefined;
  sourceCopyMutation.renameCalls = 0;
  sourceCopyMutation.failConfigWriteAt = 0;
  sourceCopyMutation.failConfigWritesAt = [];
  sourceCopyMutation.configWriteCalls = 0;
});

// The extension context's globalState must actually retain written values so a
// multi-step install → install → rollback scenario behaves like the real host.
function createStatefulContext(storageRoot: string, failStateWriteAt = 0): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  let stateWrites = 0;
  return {
    globalStorageUri: { fsPath: storageRoot },
    extensionUri: { fsPath: join(storageRoot, "trusted-extension") },
    globalState: {
      get: vi.fn((key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback)),
      update: vi.fn(async (key: string, value: unknown) => {
        stateWrites++;
        if (stateWrites === failStateWriteAt) throw new Error("forced global state write failure");
        store.set(key, value);
      }),
    },
  } as unknown as vscode.ExtensionContext;
}

// The last value written to a configuration section/key (the installer updates
// settings across installs, so the most recent write is the live one).
function writtenSetting(section: string, key: string): unknown {
  return configUpdates.filter((entry) => entry.section === section && entry.key === key).at(-1)?.value;
}

// A minimal 2.0 bundle source: one agent, one skill, one instruction, a hooks
// manifest with the given events, an mcp profiles file, and the counts summary.
function createSourceBundle(bundleId: string, events: Array<{ event: string; action: string }>): string {
  const sourceRoot = mkdtempSync(join(tmpdir(), `sdlc-${bundleId}-source-`));
  mkdirSync(join(sourceRoot, "central", "manifests"), { recursive: true });
  mkdirSync(join(sourceRoot, "central", "agents"), { recursive: true });
  mkdirSync(join(sourceRoot, "central", "instructions"), { recursive: true });
  mkdirSync(join(sourceRoot, "central", "skills", "workflow", "start-ticket"), { recursive: true });
  mkdirSync(join(sourceRoot, "central", "hooks"), { recursive: true });
  mkdirSync(join(sourceRoot, "central", "mcp"), { recursive: true });
  writeFileSync(join(sourceRoot, "central", "agents", "a.agent.md"), "a");
  writeFileSync(join(sourceRoot, "central", "instructions", "i.instructions.md"), "i");
  writeFileSync(join(sourceRoot, "central", "skills", "workflow", "start-ticket", "SKILL.md"), "s");
  writeFileSync(join(sourceRoot, "central", "hooks", "hooks-manifest.json"), JSON.stringify({ schemaVersion: "1.0", events }));
  writeFileSync(join(sourceRoot, "central", "hooks", "run-hook.mjs"), "process.exit(0);\n");
  writeFileSync(join(sourceRoot, "central", "mcp", "profiles.json"), JSON.stringify({ schemaVersion: "1.0", profiles: {} }));
  writeFileSync(join(sourceRoot, "central", "manifests", "bundle-manifest.json"), JSON.stringify({
    bundleId, schemaVersion: "2.0", agents: 1, skills: 1, instructions: 1, policies: 0, templates: 1, hooks: 1, profiles: 1,
  }));
  return sourceRoot;
}

describe("customization bundle installer", () => {
  it("keeps each 2.0 skill in its own group/skill directory instead of flattening SKILL.md names", async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), "sdlc-install-source-"));
    mkdirSync(join(sourceRoot, "central", "manifests"), { recursive: true });
    mkdirSync(join(sourceRoot, "central", "agents"), { recursive: true });
    mkdirSync(join(sourceRoot, "central", "instructions"), { recursive: true });
    mkdirSync(join(sourceRoot, "central", "skills", "workflow", "start-ticket"), { recursive: true });
    mkdirSync(join(sourceRoot, "central", "skills", "planning", "estimate"), { recursive: true });
    writeFileSync(join(sourceRoot, "central", "agents", "analyst.agent.md"), "analyst");
    writeFileSync(join(sourceRoot, "central", "instructions", "web.instructions.md"), "instructions");
    writeFileSync(join(sourceRoot, "central", "skills", "workflow", "start-ticket", "SKILL.md"), "start-ticket");
    writeFileSync(join(sourceRoot, "central", "skills", "planning", "estimate", "SKILL.md"), "estimate");
    writeFileSync(join(sourceRoot, "central", "manifests", "bundle-manifest.json"), JSON.stringify({
      bundleId: "test-bundle", schemaVersion: "2.0", agents: 1, skills: 2, instructions: 1, policies: 0, templates: 1,
    }));

    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-install-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);
    const context = {
      globalStorageUri: { fsPath: storageRoot },
      extensionUri: { fsPath: join(storageRoot, "trusted-extension") },
      globalState: { get: vi.fn((_key: string, fallback: unknown) => fallback), update: vi.fn().mockResolvedValue(undefined) },
    } as unknown as vscode.ExtensionContext;

    await installCustomizationBundle(context);

    const skillsRoot = join(storageRoot, "customizations", "test-bundle", "skills");
    expect(existsSync(join(skillsRoot, "workflow", "start-ticket", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsRoot, "planning", "estimate", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(skillsRoot, "workflow", "start-ticket", "SKILL.md"), "utf8")).toBe("start-ticket");
    expect(readFileSync(join(skillsRoot, "planning", "estimate", "SKILL.md"), "utf8")).toBe("estimate");

    const agentsRoot = join(storageRoot, "customizations", "test-bundle", "agents");
    const instructionsRoot = join(storageRoot, "customizations", "test-bundle", "instructions");
    expect(existsSync(join(agentsRoot, "analyst.agent.md"))).toBe(true);
    expect(existsSync(join(instructionsRoot, "web.instructions.md"))).toBe(true);
  });

  it("rejects a skill install path that traverses outside the skills root", () => {
    expect(() => skillInstallPath("central/skills/../../evil/SKILL.md")).toThrow(/unsafe/i);
  });

  it("rejects a selected bundle with a skill symlink before creating destination content", async () => {
    const sourceRoot = createSourceBundle("symlinked-skill", []);
    const outside = join(sourceRoot, "outside-skill");
    mkdirSync(outside);
    writeFileSync(join(outside, "outside.md"), "outside bundle boundary");
    symlinkSync(outside, join(sourceRoot, "central", "skills", "workflow", "start-ticket", "linked"), "junction");
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-symlink-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    await expect(installCustomizationBundle(createStatefulContext(storageRoot))).rejects.toThrow(/symbolic link|symlink/i);
    expect(existsSync(join(storageRoot, "customizations", "symlinked-skill"))).toBe(false);
  });

  it("rejects invalid newly staged manifest content without activating a destination", async () => {
    const sourceRoot = createSourceBundle("symlinked-manifest", []);
    const manifests = join(sourceRoot, "central", "manifests");
    const outside = join(sourceRoot, "outside-manifests");
    rmSync(manifests, { recursive: true, force: true });
    mkdirSync(outside);
    writeFileSync(join(outside, "bundle-manifest.json"), JSON.stringify({ token: "must-not-be-read" }));
    symlinkSync(outside, manifests, "junction");
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-manifest-link-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    await expect(installCustomizationBundle(createStatefulContext(storageRoot))).rejects.toThrow(/symbolic link|symlink/i);
    expect(existsSync(join(storageRoot, "customizations", "symlinked-manifest"))).toBe(false);
    expect(writtenSetting("chat", "agentFilesLocations")).toBeUndefined();
  });

  it("installs from the validated staging copy when the selected source changes after staging", async () => {
    const sourceRoot = createSourceBundle("staged-source", []);
    const manifests = join(sourceRoot, "central", "manifests");
    const outside = join(sourceRoot, "outside-manifests");
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-staged-source-dest-"));
    sourceCopyMutation.sourceRoot = sourceRoot;
    sourceCopyMutation.afterCopy = () => {
      rmSync(manifests, { recursive: true, force: true });
      mkdirSync(outside);
      writeFileSync(join(outside, "bundle-manifest.json"), JSON.stringify({ token: "swapped-after-staging" }));
      symlinkSync(outside, manifests, "junction");
    };
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    await installCustomizationBundle(createStatefulContext(storageRoot));

    expect(sourceCopyMutation.triggered).toBe(true);
    expect(readFileSync(join(storageRoot, "customizations", "staged-source", "agents", "a.agent.md"), "utf8")).toBe("a");
  });

  it("keeps and activates an existing verified bundle version without attempting a replacement rename", async () => {
    const sourceRoot = createSourceBundle("immutable-version", []);
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-existing-version-dest-"));
    const existingRoot = join(storageRoot, "customizations", "immutable-version");
    mkdirSync(existingRoot, { recursive: true });
    writeFileSync(join(existingRoot, "published-marker.txt"), "keep this published bundle");
    sourceCopyMutation.renameFailure = new Error("forced rename failure");
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    await installCustomizationBundle(createStatefulContext(storageRoot));

    expect(sourceCopyMutation.renameCalls).toBe(0);
    expect(readFileSync(join(existingRoot, "published-marker.txt"), "utf8")).toBe("keep this published bundle");
    expect(writtenSetting("chat", "agentFilesLocations")).toEqual({ [join(existingRoot, "agents")]: true });
  });

  it("uses Node to invoke the installed no-op hook shim without shell redirection", () => {
    const root = join("C:", "trusted extension");
    const command = hookCommand(root, "verify-stage-output");

    expect(command).toContain("node");
    expect(command).toContain(JSON.stringify(join(root, "media", "trusted-hook.mjs")));
    expect(command).toContain("verify-stage-output");
    expect(command).not.toMatch(/[>&|;]/);
  });

  it("resolves a real Node runtime when the extension host executable is Code", () => {
    const tools = mkdtempSync(join(tmpdir(), "sdlc-node-runtime-"));
    const node = join(tools, "node.exe");
    writeFileSync(node, "fictional node executable");

    const runtime = resolveNodeRuntime("C:\\Program Files\\Microsoft VS Code\\Code.exe", tools, "win32");
    const command = hookCommand("C:\\bundle", "verify-stage-output", runtime);
    expect(runtime).toBe(node);
    expect(command).toContain(JSON.stringify(node));
    expect(command).not.toContain("Code.exe");
    expect(command).not.toContain("electron-run-as-node");
  });

  it("compensates every partial configuration and global-state activation write", async () => {
    for (let failure = 1; failure <= 7; failure++) {
      configState.clear();
      configState.set("chat|agentFilesLocations", { "C:\\existing-agent": true });
      configState.set("chat|agentSkillsLocations", { "C:\\existing-skill": true });
      configState.set("chat|instructionsFilesLocations", { "C:\\existing-instruction": true });
      configState.set("chat.agent|hooks", { Stop: "user-hook" });
      sourceCopyMutation.configWriteCalls = 0;
      sourceCopyMutation.failConfigWriteAt = failure <= 4 ? failure : 0;
      const sourceRoot = createSourceBundle(`transaction-${failure}`, [{ event: "PreToolUse", action: "guard-dangerous-operations" }]);
      const storageRoot = mkdtempSync(join(tmpdir(), `sdlc-transaction-${failure}-`));
      vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);
      const stateFailure = failure > 4 ? failure - 4 : 0;
      const context = createStatefulContext(storageRoot, stateFailure);

      await expect(installCustomizationBundle(context)).rejects.toThrow(/forced/);

      expect(configState.get("chat|agentFilesLocations")).toEqual({ "C:\\existing-agent": true });
      expect(configState.get("chat|agentSkillsLocations")).toEqual({ "C:\\existing-skill": true });
      expect(configState.get("chat|instructionsFilesLocations")).toEqual({ "C:\\existing-instruction": true });
      expect(configState.get("chat.agent|hooks")).toEqual({ Stop: "user-hook" });
      expect(context.globalState.get("sdlc.activeCustomizationLocations", undefined)).toBeUndefined();
      expect(context.globalState.get("sdlc.activeCustomizationHookSettings", undefined)).toBeUndefined();
      expect(context.globalState.get("sdlc.installedCustomizationBundles", undefined)).toBeUndefined();
      expect(existsSync(join(storageRoot, "customizations", `transaction-${failure}`))).toBe(false);
    }
  });

  it("retains a newly published destination when activation compensation fails", async () => {
    const sourceRoot = createSourceBundle("recovery-required", [{ event: "PreToolUse", action: "guard-dangerous-operations" }]);
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-recovery-required-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);
    // Write four fails during activation; write five is the first compensating
    // write, so the live agent location can still reference the new bundle.
    sourceCopyMutation.failConfigWritesAt = [4, 5];

    await expect(installCustomizationBundle(createStatefulContext(storageRoot))).rejects.toThrow(/recovery/i);

    const destination = join(storageRoot, "customizations", "recovery-required");
    expect(existsSync(destination)).toBe(true);
    expect(configState.get("chat|agentFilesLocations")).toEqual({ [join(destination, "agents")]: true });
  });

  it("never installs or invokes a bundle-provided run-hook script", async () => {
    const sourceRoot = createSourceBundle("malicious-hook", [
      { event: "PreToolUse", action: "guard-dangerous-operations" },
    ]);
    writeFileSync(join(sourceRoot, "central", "hooks", "run-hook.mjs"), "throw new Error('MALICIOUS_BUNDLE_HOOK_EXECUTED');\n");
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-malicious-hook-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);
    const context = createStatefulContext(storageRoot);

    await installCustomizationBundle(context);

    const destination = join(storageRoot, "customizations", "malicious-hook");
    const command = writtenSetting("chat.agent", "hooks") as Record<string, string>;
    expect(existsSync(join(destination, "hooks", "run-hook.mjs"))).toBe(false);
    expect(command.PreToolUse).toContain(JSON.stringify(join(context.extensionUri.fsPath, "media", "trusted-hook.mjs")));
    expect(command.PreToolUse).not.toContain(destination);
  });

  it("installs hooks and profiles into the bundle and activates hook settings", async () => {
    const sourceRoot = createSourceBundle("hooks-bundle", [
      { event: "PreToolUse", action: "guard-dangerous-operations" },
    ]);
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-hooks-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    const context = createStatefulContext(storageRoot);
    await installCustomizationBundle(context);

    const bundleRoot = join(storageRoot, "customizations", "hooks-bundle");
    expect(existsSync(join(bundleRoot, "hooks", "hooks-manifest.json"))).toBe(true);
    expect(existsSync(join(bundleRoot, "mcp", "profiles.json"))).toBe(true);
    expect(writtenSetting("chat.agent", "hooks")).toEqual({
      PreToolUse: hookCommand(context.extensionUri.fsPath, "guard-dangerous-operations"),
    });
  });

  it("rolls back to a previous bundle and restores its hook and location settings", async () => {
    const v1Root = createSourceBundle("hooks-bundle-v1", [
      { event: "PreToolUse", action: "guard-dangerous-operations" },
      { event: "Stop", action: "verify-stage-output" },
    ]);
    const v2Root = createSourceBundle("hooks-bundle-v2", [
      { event: "PreToolUse", action: "format-and-record" },
    ]);
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-rollback-dest-"));
    const context = createStatefulContext(storageRoot);

    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([{ fsPath: v1Root } as vscode.Uri]);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([{ fsPath: v2Root } as vscode.Uri]);
    await installCustomizationBundle(context);
    await installCustomizationBundle(context);
    const v1RootPath = join(storageRoot, "customizations", "hooks-bundle-v1");

    // v2 recomputes the installer-managed hooks from the live config: the Stop
    // entry recorded by v1 is dropped (v2 does not declare it) and PreToolUse
    // points at v2's action.
    expect(writtenSetting("chat.agent", "hooks")).toEqual({
      PreToolUse: hookCommand(context.extensionUri.fsPath, "format-and-record"),
    });

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => items[0]);
    await rollbackCustomizationBundle(context);

    // Rolling back to v1 re-applies v1's hook settings, including the Stop
    // entry that v2's manifest does not declare.
    expect(writtenSetting("chat.agent", "hooks")).toEqual({
      PreToolUse: hookCommand(context.extensionUri.fsPath, "guard-dangerous-operations"),
      Stop: hookCommand(context.extensionUri.fsPath, "verify-stage-output"),
    });

    // The location settings are re-applied for the rolled-back root as well.
    expect(writtenSetting("chat", "agentFilesLocations")).toEqual({ [join(v1RootPath, "agents")]: true });
    expect(writtenSetting("chat", "agentSkillsLocations")).toEqual({ [join(v1RootPath, "skills")]: true });
    expect(writtenSetting("chat", "instructionsFilesLocations")).toEqual({ [join(v1RootPath, "instructions")]: true });
  });

  it("removes previously recorded installer hooks when the new bundle declares no hooks and preserves user-managed entries", async () => {
    const v1Root = createSourceBundle("hooks-bundle-empty-v1", [
      { event: "PreToolUse", action: "guard-dangerous-operations" },
    ]);
    const noHooksRoot = createSourceBundle("hooks-bundle-empty", []);
    // The bundle ships no hooks manifest at all.
    rmSync(join(noHooksRoot, "central", "hooks", "hooks-manifest.json"));
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-empty-hooks-dest-"));
    const context = createStatefulContext(storageRoot);

    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([{ fsPath: v1Root } as vscode.Uri]);
    await installCustomizationBundle(context);
    expect(writtenSetting("chat.agent", "hooks")).toEqual({ PreToolUse: hookCommand(context.extensionUri.fsPath, "guard-dangerous-operations") });

    // The user then adds their own entry directly to chat.agent.hooks.
    configState.set("chat.agent|hooks", {
      PreToolUse: hookCommand(context.extensionUri.fsPath, "guard-dangerous-operations"),
      UserPromptSubmit: "echo user-managed-prompt >/dev/null && exit 0",
    });

    vi.mocked(vscode.window.showOpenDialog).mockResolvedValueOnce([{ fsPath: noHooksRoot } as vscode.Uri]);
    await installCustomizationBundle(context);

    // The installer's previously recorded PreToolUse entry is removed; the
    // user-managed UserPromptSubmit entry is untouched.
    expect(writtenSetting("chat.agent", "hooks")).toEqual({
      UserPromptSubmit: "echo user-managed-prompt >/dev/null && exit 0",
    });
  });

  it("skips invalid hook events and actions instead of aborting activation", async () => {
    const sourceRoot = createSourceBundle("hooks-bundle-validated", [
      { event: "PreToolUse", action: "guard-dangerous-operations" },
    ]);
    writeFileSync(join(sourceRoot, "central", "hooks", "hooks-manifest.json"), JSON.stringify({
      schemaVersion: "1.0",
      events: [
        { event: "PreToolUse", action: "guard-dangerous-operations" },
        { event: "NotARealEvent", action: "bogus" },
        { event: "PreToolUse", action: "bad action!" },
        { event: 42, action: "not-a-string" },
        "not-an-object",
      ],
    }));
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-validated-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    const context = createStatefulContext(storageRoot);
    await installCustomizationBundle(context);

    // Only the valid entry is activated; unknown event names, invalid action
    // characters, and malformed entries are skipped without aborting.
    expect(writtenSetting("chat.agent", "hooks")).toEqual({
      PreToolUse: hookCommand(context.extensionUri.fsPath, "guard-dangerous-operations"),
    });
  });

  it("tolerates a non-array hooks events field without throwing", async () => {
    const sourceRoot = createSourceBundle("hooks-bundle-nonarray", []);
    writeFileSync(join(sourceRoot, "central", "hooks", "hooks-manifest.json"), JSON.stringify({ schemaVersion: "1.0", events: {} }));
    const storageRoot = mkdtempSync(join(tmpdir(), "sdlc-nonarray-dest-"));
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: sourceRoot } as vscode.Uri]);

    await installCustomizationBundle(createStatefulContext(storageRoot));

    // The {"events": {}} shape previously threw a TypeError while iterating;
    // it now yields no entries and writes an empty installer-managed hook set.
    expect(writtenSetting("chat.agent", "hooks")).toEqual({});
  });
});
