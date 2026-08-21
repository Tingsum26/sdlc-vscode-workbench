import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAndValidateBundle, rejectBundleSymlinks } from "../src/customization/bundleManifest.js";

describe("customization bundle manifest", () => {
  it("accepts a versioned inventory and resolves only files inside the bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "sdlc-bundle-"));
    mkdirSync(join(root, ".github", "agents"), { recursive: true });
    mkdirSync(join(root, ".github", "skills", "start-ticket"), { recursive: true });
    writeFileSync(join(root, ".github", "agents", "analyst.agent.md"), "safe");
    writeFileSync(join(root, ".github", "skills", "start-ticket", "SKILL.md"), "safe");
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      schemaVersion: "1.0", bundleVersion: "1.2.3",
      agents: [".github/agents/analyst.agent.md"], skills: [".github/skills/start-ticket"], instructions: [],
    }));
    expect(loadAndValidateBundle(root, "manifest.json").bundleVersion).toBe("1.2.3");
  });

  it("rejects traversal and secret-like manifest fields", () => {
    const root = mkdtempSync(join(tmpdir(), "sdlc-bundle-"));
    writeFileSync(join(root, "manifest.json"), JSON.stringify({
      schemaVersion: "1.0", bundleVersion: "1.0.0", agents: ["../escape.agent.md"], skills: [], instructions: [], token: "bad",
    }));
    expect(() => loadAndValidateBundle(root, "manifest.json")).toThrow(/unsafe|secret/i);
  });

  it("rejects symbolic links anywhere in a selected bundle source", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdlc-bundle-symlink-"));
    const skillDir = join(root, "central", "skills", "workflow", "start-ticket");
    mkdirSync(skillDir, { recursive: true });
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "outside.md"), "outside bundle boundary");
    symlinkSync(outside, join(skillDir, "linked"), "junction");

    await expect(rejectBundleSymlinks(root)).rejects.toThrow(/symbolic link|symlink/i);
  });

  it("derives file lists from sibling central directories for a 2.0 summary manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "sdlc-bundle-2-"));
    mkdirSync(join(root, "central", "manifests"), { recursive: true });
    mkdirSync(join(root, "central", "agents"), { recursive: true });
    mkdirSync(join(root, "central", "skills", "workflow", "start-ticket"), { recursive: true });
    mkdirSync(join(root, "central", "instructions"), { recursive: true });
    mkdirSync(join(root, "central", "policies"), { recursive: true });
    mkdirSync(join(root, "central", "evals"), { recursive: true });
    writeFileSync(join(root, "central", "agents", "analyst.agent.md"), "safe");
    writeFileSync(join(root, "central", "skills", "workflow", "start-ticket", "SKILL.md"), "safe");
    writeFileSync(join(root, "central", "instructions", "web.instructions.md"), "safe");
    writeFileSync(join(root, "central", "policies", "stage-gates.json"), "{}");
    writeFileSync(join(root, "central", "evals", "agents-behavior.md"), "safe");
    writeFileSync(join(root, "central", "manifests", "bundle-manifest.json"), JSON.stringify({
      bundleId: "test-bundle", schemaVersion: "2.0", agents: 1, skills: 1, instructions: 1, policies: 1, templates: 1,
    }));

    const manifest = loadAndValidateBundle(root, "central/manifests/bundle-manifest.json");
    expect(manifest.schemaVersion).toBe("2.0");
    expect(manifest.agents).toContain("central/agents/analyst.agent.md");
    expect(manifest.skills).toContain("central/skills/workflow/start-ticket/SKILL.md");
    expect(manifest.instructions).toContain("central/instructions/web.instructions.md");
    expect(manifest.policies ?? []).toContain("central/policies/stage-gates.json");
    expect(manifest.evals ?? []).toContain("central/evals/agents-behavior.md");
  });

  it("rejects a 2.0 manifest whose bundleId is missing or malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "sdlc-bundle-2-bad-"));
    mkdirSync(join(root, "central", "manifests"), { recursive: true });
    writeFileSync(join(root, "central", "manifests", "bundle-manifest.json"), JSON.stringify({
      bundleId: "../evil", schemaVersion: "2.0", agents: 0, skills: 0, instructions: 0,
    }));
    expect(() => loadAndValidateBundle(root, "central/manifests/bundle-manifest.json")).toThrow(/unsupported/i);
  });
});
