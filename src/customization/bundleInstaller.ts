import { cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { accessSync, constants, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as vscode from "vscode";
import { loadAndValidateBundle, rejectBundleSymlinks, safeResolve } from "./bundleManifest.js";

interface InstalledBundle { version: string; root: string; installedAt: string }
const stateKey = "sdlc.installedCustomizationBundles";
const activeLocationsKey = "sdlc.activeCustomizationLocations";
const activeHookSettingsKey = "sdlc.activeCustomizationHookSettings";

// Content directories shipped wholesale with the bundle. The 2.0 manifest
// walker derives agents/skills/instructions/policies/evals lists as the
// manifest surface, but the installed bundle carries the full platform
// configuration, so every content directory is copied as-is.
const shippedContentDirs = ["mcp", "policies", "templates", "evals"] as const;

interface HookEvent { event: string; action: string }

class BundleActivationRecoveryError extends Error {
  constructor(cause: unknown) {
    super("Customization activation failed and recovery was incomplete; the published bundle was retained", { cause });
    this.name = "BundleActivationRecoveryError";
  }
}

export async function installCustomizationBundle(context: vscode.ExtensionContext): Promise<void> {
  const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    title: "Select an extracted, reviewed SDLC customization bundle" });
  if (!selected?.[0]) return;
  const sourceRoot = selected[0].fsPath;
  const manifestPath = "central/manifests/bundle-manifest.json";
  const storageRoot = context.globalStorageUri.fsPath;
  await mkdir(storageRoot, { recursive: true });
  const sourceStaging = await mkdtemp(join(storageRoot, "customization-source-"));
  const stagedRoot = join(sourceStaging, "bundle");
  let candidate: string | undefined;
  let destination: string | undefined;
  let destinationCreatedByThisAttempt = false;

  try {
    // The selected source is untrusted. Copy it once without dereferencing
    // links; all later parsing and copying use this extension-owned snapshot,
    // closing the gap between validation and use of that filesystem tree.
    // globalStorage is trusted against same-user writers: such a writer can
    // already alter VS Code settings directly. We still check the final bundle
    // immediately before activation to catch accidental local corruption.
    await cp(sourceRoot, stagedRoot, { recursive: true, dereference: false });
    await rejectBundleSymlinks(stagedRoot);
    const manifest = loadAndValidateBundle(stagedRoot, manifestPath);
    const customizationsRoot = join(storageRoot, "customizations");
    await mkdir(customizationsRoot, { recursive: true });
    destination = join(customizationsRoot, manifest.bundleVersion);
    if (existsSync(destination)) {
      // Published versions are immutable. Preserve the already published copy
      // rather than deleting it for a conflicting reinstallation attempt.
      await rejectBundleSymlinks(destination);
      const installed = context.globalState.get<InstalledBundle[]>(stateKey, []).filter((entry) => entry.version !== manifest.bundleVersion);
      installed.unshift({ version: manifest.bundleVersion, root: destination, installedAt: new Date().toISOString() });
      await activateBundleTransaction(context, destination, installed.slice(0, 5));
      void vscode.window.showInformationMessage(`Activated SDLC customization bundle ${manifest.bundleVersion}. Verify it in Chat Customizations diagnostics.`);
      return;
    }
    candidate = await mkdtemp(join(customizationsRoot, ".bundle-install-"));
    const agentsRoot = join(candidate, "agents");
    const skillsRoot = join(candidate, "skills");
    const instructionsRoot = join(candidate, "instructions");
    await Promise.all([mkdir(agentsRoot, { recursive: true }), mkdir(skillsRoot, { recursive: true }), mkdir(instructionsRoot, { recursive: true })]);

    for (const path of manifest.agents) await cp(safeResolve(stagedRoot, path), join(agentsRoot, basename(path)), { force: true });
    for (const path of manifest.skills) {
      const target = join(skillsRoot, skillInstallPath(path));
      await mkdir(dirname(target), { recursive: true });
      await cp(safeResolve(stagedRoot, path), target, { recursive: true, force: true });
    }
    for (const path of manifest.instructions.filter((value) => value.endsWith(".instructions.md"))) {
      await cp(safeResolve(stagedRoot, path), join(instructionsRoot, basename(path)), { force: true });
    }
    await mkdir(dirname(join(candidate, manifestPath)), { recursive: true });
    await cp(safeResolve(stagedRoot, manifestPath), join(candidate, manifestPath), { force: true });
    for (const dir of shippedContentDirs) {
      const sourceDir = safeResolve(stagedRoot, `central/${dir}`);
      if (!existsSync(sourceDir)) continue;
      const targetDir = join(candidate, dir);
      await mkdir(dirname(targetDir), { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }
    const hooksManifest = safeResolve(stagedRoot, "central/hooks/hooks-manifest.json");
    if (existsSync(hooksManifest)) {
      const targetHooks = join(candidate, "hooks");
      await mkdir(targetHooks, { recursive: true });
      // A selected bundle contributes declarations only. Its executable files
      // never cross into the installed destination.
      await cp(hooksManifest, join(targetHooks, "hooks-manifest.json"), { force: true });
    }
    await rejectBundleSymlinks(candidate);

    await rename(candidate, destination);
    candidate = undefined;
    destinationCreatedByThisAttempt = true;
    await rejectBundleSymlinks(destination);

    const installed = context.globalState.get<InstalledBundle[]>(stateKey, []).filter((entry) => entry.version !== manifest.bundleVersion);
    installed.unshift({ version: manifest.bundleVersion, root: destination, installedAt: new Date().toISOString() });
    await activateBundleTransaction(context, destination, installed.slice(0, 5));
    destinationCreatedByThisAttempt = false;
    void vscode.window.showInformationMessage(`Activated SDLC customization bundle ${manifest.bundleVersion}. Verify it in Chat Customizations diagnostics.`);
  } catch (error) {
    if (candidate) await rm(candidate, { recursive: true, force: true });
    if (destinationCreatedByThisAttempt && destination && !(error instanceof BundleActivationRecoveryError)) {
      await rm(destination, { recursive: true, force: true });
    }
    throw error;
  } finally {
    await rm(sourceStaging, { recursive: true, force: true });
  }
}

export async function rollbackCustomizationBundle(context: vscode.ExtensionContext): Promise<void> {
  const installed = context.globalState.get<InstalledBundle[]>(stateKey, []);
  if (installed.length < 2) { void vscode.window.showInformationMessage("No previous SDLC customization bundle is available."); return; }
  const choice = await vscode.window.showQuickPick(installed.slice(1).map((entry) => ({ label: entry.version, description: entry.installedAt, entry })),
    { title: "Select last-known-good customization bundle" });
  if (!choice) return;
  const reordered = [choice.entry, ...installed.filter((entry) => entry.version !== choice.entry.version)];
  await activateBundleTransaction(context, choice.entry.root, reordered);
  void vscode.window.showInformationMessage(`Rolled back SDLC customizations to ${choice.entry.version}.`);
}

async function activateBundleTransaction(
  context: vscode.ExtensionContext,
  root: string,
  installed: InstalledBundle[],
): Promise<void> {
  const agents = join(root, "agents");
  const skills = join(root, "skills");
  const instructions = join(root, "instructions");
  const chat = vscode.workspace.getConfiguration("chat");
  const chatAgent = vscode.workspace.getConfiguration("chat.agent");
  const previousLocations = context.globalState.get<Record<string, string>>(activeLocationsKey, {});
  const previousHookSettings = context.globalState.get<Record<string, unknown>>(activeHookSettingsKey, {});
  const previousInstalled = context.globalState.get<InstalledBundle[] | undefined>(stateKey, undefined);
  const previousActiveLocations = context.globalState.get<Record<string, string> | undefined>(activeLocationsKey, undefined);
  const previousActiveHooks = context.globalState.get<Record<string, unknown> | undefined>(activeHookSettingsKey, undefined);
  const priorConfig = {
    agentFilesLocations: chat.get<Record<string, boolean>>("agentFilesLocations", {}),
    agentSkillsLocations: chat.get<Record<string, boolean>>("agentSkillsLocations", {}),
    instructionsFilesLocations: chat.get<Record<string, boolean>>("instructionsFilesLocations", {}),
    hooks: chatAgent.get<Record<string, unknown>>("hooks", {}),
  };
  const hookEntries = await readHookEntries(root);
  const nextLocations = {
    agentFilesLocations: agents, agentSkillsLocations: skills, instructionsFilesLocations: instructions,
  };
  const nextHooks = nextHookSettings(
    priorConfig.hooks, previousHookSettings, context.extensionUri.fsPath, hookEntries,
  );

  try {
    await chat.update("agentFilesLocations", nextLocation(priorConfig.agentFilesLocations, agents, previousLocations.agentFilesLocations), vscode.ConfigurationTarget.Global);
    await chat.update("agentSkillsLocations", nextLocation(priorConfig.agentSkillsLocations, skills, previousLocations.agentSkillsLocations), vscode.ConfigurationTarget.Global);
    await chat.update("instructionsFilesLocations", nextLocation(priorConfig.instructionsFilesLocations, instructions, previousLocations.instructionsFilesLocations), vscode.ConfigurationTarget.Global);
    await chatAgent.update("hooks", nextHooks.live, vscode.ConfigurationTarget.Global);
    await context.globalState.update(activeLocationsKey, nextLocations);
    await context.globalState.update(activeHookSettingsKey, nextHooks.recorded);
    await context.globalState.update(stateKey, installed);
  } catch (error) {
    // Configuration and Memento have no shared transaction primitive. Restore
    // every participant from its pre-activation snapshot. If any compensation
    // fails, retain the published files and report a recovery-required error.
    const recovery = await Promise.allSettled([
      chat.update("agentFilesLocations", priorConfig.agentFilesLocations, vscode.ConfigurationTarget.Global),
      chat.update("agentSkillsLocations", priorConfig.agentSkillsLocations, vscode.ConfigurationTarget.Global),
      chat.update("instructionsFilesLocations", priorConfig.instructionsFilesLocations, vscode.ConfigurationTarget.Global),
      chatAgent.update("hooks", priorConfig.hooks, vscode.ConfigurationTarget.Global),
      context.globalState.update(activeLocationsKey, previousActiveLocations),
      context.globalState.update(activeHookSettingsKey, previousActiveHooks),
      context.globalState.update(stateKey, previousInstalled),
    ]);
    if (recovery.some((result) => result.status === "rejected")) {
      // A surviving configuration value may still reference the new bundle.
      // Retaining the immutable destination prevents a dangling path and gives
      // diagnostics a recoverable state on the next activation.
      throw new BundleActivationRecoveryError(error);
    }
    throw error;
  }
}

// The exact command recorded for a validated hook entry. JSON string quoting is
// accepted by both cmd.exe and POSIX shells, so paths with spaces cannot alter
// the command that invokes the extension-owned Node no-op shim.
export function resolveNodeRuntime(
  executable = process.execPath,
  pathValue = process.env.PATH ?? "",
  platform: NodeJS.Platform = process.platform,
): string {
  if (/^node(?:\.exe)?$/i.test(basename(executable))) return executable;
  const filename = platform === "win32" ? "node.exe" : "node";
  const separator = platform === "win32" ? ";" : ":";
  for (const rawDirectory of pathValue.split(separator)) {
    const directory = rawDirectory.trim().replace(/^"|"$/g, "");
    if (!directory) continue;
    const candidate = join(directory, filename);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue to the next reviewed PATH entry.
    }
  }
  throw new Error("A real Node runtime is required to activate customization hooks");
}

export function hookCommand(extensionRoot: string, action: string, runtime = resolveNodeRuntime()): string {
  return `${JSON.stringify(runtime)} ${JSON.stringify(join(extensionRoot, "media", "trusted-hook.mjs"))} ${JSON.stringify(action)}`;
}

const hookEventNames = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "Stop"] as const;
const hookActionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const trustedHookActions = new Set([
  "verify-workflow-context", "record-redacted-metadata", "guard-dangerous-operations",
  "format-and-record", "persist-checkpoint", "verify-stage-output",
]);

function isValidHookEntry(entry: unknown): entry is HookEvent {
  if (typeof entry !== "object" || entry === null) return false;
  const { event, action } = entry as Record<string, unknown>;
  return typeof event === "string" && (hookEventNames as readonly string[]).includes(event)
    && typeof action === "string" && hookActionPattern.test(action) && trustedHookActions.has(action);
}

// Reads and validates the target bundle's hooks manifest. A missing manifest,
// unparseable JSON, or a non-array `events` field yields no entries rather than
// aborting activation; invalid entries are skipped individually.
async function readHookEntries(root: string): Promise<HookEvent[]> {
  try {
    const manifest = JSON.parse(await readFile(join(root, "hooks", "hooks-manifest.json"), "utf8")) as { events?: unknown };
    if (!Array.isArray(manifest.events)) return [];
    return manifest.events.filter(isValidHookEntry);
  } catch {
    return [];
  }
}

// TODO(INTERNAL): INTERNAL-HOOKS-001 — Confirm the company Copilot policy
// allows VS Code agent hooks; replace the local Node no-op actions with the
// approved deterministic hook commands, and only then enable real hook
// execution. The declared events are still recorded in chat.agent.hooks so the
// activation surface is visible, but every command is a local no-op today.
// The extension-owned Node shim is invoked through a real node/node.exe
// resolved from the local PATH when the extension host executable is
// Electron/Code; real actions must preserve this invocation boundary.
function nextHookSettings(
  liveValue: Record<string, unknown>,
  recorded: Record<string, unknown>,
  extensionRoot: string,
  entries: HookEvent[],
): { live: Record<string, unknown>; recorded: Record<string, unknown> } {
  // Merge/stale semantics: chat.agent.hooks is the user's live config and may
  // hold user-managed keys that must never be touched. The installer manages
  // only the keys it recorded in globalState (activeHookSettingsKey) for the
  // previously active bundle; every activation recomputes them for the target
  // bundle: start from the LIVE config, delete the previously recorded keys,
  // add this bundle's validated entries, and write back. Stale installer
  // entries are therefore removed on rollback or when a bundle declares no
  // events, while user-managed keys are preserved.
  const hookSettings: Record<string, unknown> = liveValue && typeof liveValue === "object" && !Array.isArray(liveValue) ? { ...liveValue } : {};
  for (const key of Object.keys(recorded)) delete hookSettings[key];

  const nextRecorded: Record<string, unknown> = {};
  for (const { event, action } of entries) {
    hookSettings[event] = hookCommand(extensionRoot, action);
    nextRecorded[event] = hookCommand(extensionRoot, action);
  }

  return { live: hookSettings, recorded: nextRecorded };
}

function nextLocation(current: Record<string, boolean>, path: string, previous: string | undefined): Record<string, boolean> {
  const next = { ...current };
  if (previous) delete next[previous];
  next[path] = true;
  return next;
}

// Skills install relative to the skills root, keeping each skill's unique
// group/skill directory. Derived 2.0 paths are relative to the bundle source
// root (e.g. `central/skills/workflow/start-ticket/SKILL.md`), so take the
// substring after the first `skills/` segment; legacy 1.0 paths fall back to
// the basename exactly as before.
export function skillInstallPath(path: string): string {
  const marker = "/skills/";
  const index = path.indexOf(marker);
  if (index === -1) return basename(path);
  const relative = path.slice(index + marker.length);
  if (relative.length === 0 || /^[\\/]/.test(relative) || relative.split(/[\\/]/).some((segment) => segment === "..")) {
    throw new Error("Unsafe skill install path");
  }
  return relative;
}
