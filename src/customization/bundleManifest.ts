import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface BundleManifest {
  schemaVersion: "1.0" | "2.0";
  bundleVersion: string;
  agents: string[];
  skills: string[];
  instructions: string[];
  policies?: string[];
  schemas?: string[];
  mcpCatalog?: string;
  evals?: string[];
}

export function loadAndValidateBundle(root: string, manifestPath: string): BundleManifest {
  const safeRoot = resolve(root);
  const manifestFile = safeResolve(safeRoot, manifestPath);
  const raw = readFileSync(manifestFile, "utf8");
  if (/"(?:token|password|cookie|secret|authorization)"\s*:/i.test(raw)) {
    throw new Error("Bundle manifest contains a secret-like field");
  }
  const parsed = JSON.parse(raw) as BundleManifest & { bundleId?: string };
  if (parsed.schemaVersion === "2.0") {
    if (typeof parsed.bundleId !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(parsed.bundleId)) {
      throw new Error("Unsupported bundle manifest version");
    }
    return summarizeBundle(safeRoot, manifestFile, parsed.bundleId);
  }
  if (parsed.schemaVersion !== "1.0" || !/^\d+\.\d+\.\d+$/.test(parsed.bundleVersion)) {
    throw new Error("Unsupported bundle manifest version");
  }
  for (const path of [...requiredArray(parsed.agents, "agents"), ...requiredArray(parsed.skills, "skills"),
    ...requiredArray(parsed.instructions, "instructions"), ...(parsed.policies ?? []), ...(parsed.schemas ?? []),
    ...(parsed.mcpCatalog ? [parsed.mcpCatalog] : [])]) {
    const target = safeResolve(safeRoot, path);
    if (!existsSync(target) || (!statSync(target).isFile() && !statSync(target).isDirectory())) {
      throw new Error(`Bundle entry does not exist: ${path}`);
    }
  }
  return parsed;
}

export function safeResolve(root: string, relativePath: string): string {
  if (!relativePath || /^([a-zA-Z]:|[\\/])/.test(relativePath)) throw new Error("Unsafe absolute bundle path");
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Unsafe bundle path traversal");
  return target;
}

// Bundle sources are untrusted until installed. Lexical path resolution alone
// cannot contain a symlink that points outside the selected directory, so
// reject all links before the installer creates any destination content.
export async function rejectBundleSymlinks(root: string): Promise<void> {
  const pending = [resolve(root)];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const status = await lstat(current);
    if (status.isSymbolicLink()) throw new Error(`Bundle contains a symbolic link: ${current}`);
    if (!status.isDirectory()) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      pending.push(join(current, entry.name));
    }
  }
}

function summarizeBundle(safeRoot: string, manifestFile: string, bundleId: string): BundleManifest {
  // The 2.0 manifest is a counts summary: file lists are derived by walking the
  // sibling `central/*` directories relative to `central/manifests`.
  const manifestDir = dirname(manifestFile);
  const centralDir = dirname(manifestDir);
  const relativeToRoot = (file: string): string => relative(safeRoot, file).split(sep).join("/");
  return {
    schemaVersion: "2.0",
    bundleVersion: bundleId,
    agents: walkFiles(join(centralDir, "agents"), (name) => name.endsWith(".agent.md"), false).map(relativeToRoot),
    skills: walkFiles(join(centralDir, "skills"), (name) => name === "SKILL.md", true).map(relativeToRoot),
    instructions: walkFiles(join(centralDir, "instructions"), (name) => name.endsWith(".instructions.md"), true).map(relativeToRoot),
    policies: walkFiles(join(centralDir, "policies"), (name) => name.endsWith(".json"), false).map(relativeToRoot),
    evals: walkFiles(join(centralDir, "evals"), (name) => name.endsWith(".md"), false).map(relativeToRoot),
  };
}

function walkFiles(dir: string, matches: (name: string) => boolean, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) pending.push(full);
      } else if (entry.isFile() && matches(entry.name)) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

function requiredArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`Invalid ${name} inventory`);
  return value;
}
