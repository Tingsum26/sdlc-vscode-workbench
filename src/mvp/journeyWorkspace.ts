import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type ReceiptState = "OK" | "STALE" | "MISSING" | "INVALID" | "NOT_REQUIRED";
export interface JourneyArtifactSnapshot { id: string; path: string; status: string; receipt: ReceiptState; }
export type JourneyGateState = "DRAFT" | "WAITING_FOR_APPROVAL" | "READY_FOR_NEXT_AGENT" | "COMPLETED" | "BLOCKED" | "INVALID";
export interface JourneySnapshot {
  root: string; workflowId: string; journeyId: string; branch: string; currentStage: string; status: string;
  artifacts: JourneyArtifactSnapshot[]; currentOutputId?: string; currentOutputPath?: string; currentOutputStatus: string; gateState: JourneyGateState;
  nextRole?: string; nextStage?: string; nextAgent?: string; sourceTickets: string[];
  affectedRepositories: string[]; updatedAt: number;
  diagnostic?: string;
}

const hash = (value: Buffer | string): string => createHash("sha256").update(value).digest("hex");
function frontMatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1]!.split(/\r?\n/).map((line) => {
    const separator = line.indexOf(":");
    return separator === -1 ? [line, ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safePath(root: string, candidate: string): string | undefined {
  if (!candidate || isAbsolute(candidate)) return undefined;
  const absolute = resolve(root, candidate);
  const fromRoot = relative(resolve(root), absolute);
  return !fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot) ? undefined : absolute;
}
function receiptState(root: string, artifactPath: string, status: string): ReceiptState {
  if (status === "BASELINE") return "NOT_REQUIRED";
  const absoluteArtifact = safePath(root, artifactPath);
  if (!absoluteArtifact) return "INVALID";
  if (!existsSync(absoluteArtifact)) return "MISSING";
  const fields = frontMatter(readFileSync(absoluteArtifact, "utf8"));
  if (!fields.contextReceipt || !fields.contextReceiptSha256) return "MISSING";
  const receiptPath = safePath(root, fields.contextReceipt);
  if (!receiptPath) return "INVALID";
  if (!existsSync(receiptPath)) return "MISSING";
  return hash(readFileSync(receiptPath)) === fields.contextReceiptSha256 ? "OK" : "STALE";
}
export function findJourneyWorkspace(workspaceRoots: string[]): string | undefined {
  return workspaceRoots.find((root) => existsSync(join(root, ".sdlc", "workflow.json")));
}
export function readJourneySnapshot(root: string): JourneySnapshot {
  const invalid = (diagnostic: string): JourneySnapshot => ({ root, workflowId: "INVALID", journeyId: "INVALID", branch: "UNKNOWN", currentStage: "UNKNOWN", status: "INVALID", artifacts: [], currentOutputStatus: "INVALID", gateState: "INVALID", sourceTickets: [], affectedRepositories: [], updatedAt: Date.now(), diagnostic });
  let state: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, ".sdlc", "workflow.json"), "utf8"));
    if (!isRecord(parsed)) return invalid("workflow.json must contain an object");
    state = parsed;
  } catch (error) { return invalid(`Cannot read workflow.json: ${error instanceof Error ? error.message : String(error)}`); }
  if (state.artifacts !== undefined && !isRecord(state.artifacts)) return invalid("workflow.json artifacts must be an object");
  if (state.stages !== undefined && !isRecord(state.stages)) return invalid("workflow.json stages must be an object");
  const artifactState = (state.artifacts ?? {}) as Record<string, unknown>;
  const artifacts = Object.entries(artifactState).map(([id, value]) => {
    const artifact = isRecord(value) ? value : {};
    const path = typeof artifact.path === "string" ? artifact.path : "";
    const status = typeof artifact.status === "string" ? artifact.status : "UNKNOWN";
    return { id, path, status, receipt: receiptState(root, path, status) };
  });
  const stageOrder = Array.isArray(state.stageOrder) ? state.stageOrder.map(String) : [];
  const currentStage = String(state.currentStage ?? "UNKNOWN");
  const stages = (state.stages ?? {}) as Record<string, unknown>;
  const stage = isRecord(stages[currentStage]) ? stages[currentStage] : undefined;
  const currentOutputId = typeof stage?.output === "string" ? stage.output : undefined;
  const currentArtifact = currentOutputId && isRecord(artifactState[currentOutputId]) ? artifactState[currentOutputId] : undefined;
  const currentOutputStatus = typeof currentArtifact?.status === "string" ? currentArtifact.status : "UNKNOWN";
  const currentIndex = stageOrder.indexOf(currentStage);
  const outputApproved = currentOutputStatus === "APPROVED" || currentOutputStatus === "SKIPPED_WITH_EVIDENCE";
  const hasNextStage = currentIndex >= 0 && currentIndex < stageOrder.length - 1;
  const nextStage = outputApproved && hasNextStage ? stageOrder[currentIndex + 1] : undefined;
  const gateState: JourneyGateState = state.status === "COMPLETED" || (!hasNextStage && outputApproved)
    ? "COMPLETED"
    : outputApproved ? "READY_FOR_NEXT_AGENT" : currentOutputStatus === "BLOCKED" ? "BLOCKED" : currentOutputStatus === "DRAFT" ? "DRAFT" : "WAITING_FOR_APPROVAL";
  const nextAgent = gateState === "READY_FOR_NEXT_AGENT" && nextStage
    ? String((isRecord(stages[nextStage]) ? stages[nextStage].role : undefined) ?? "UNKNOWN")
    : typeof stage?.role === "string" ? stage.role : undefined;
  return {
    root, workflowId: String(state.workflowId ?? "UNKNOWN"), journeyId: String(state.journeyId ?? "UNKNOWN"),
    branch: String(state.branch ?? "UNKNOWN"), currentStage, status: String(state.status ?? "UNKNOWN"),
    artifacts, ...(currentOutputId ? { currentOutputId } : {}), ...(currentOutputId && typeof currentArtifact?.path === "string" ? { currentOutputPath: currentArtifact.path } : {}), currentOutputStatus, gateState,
    ...(typeof stage?.role === "string" ? { nextRole: stage.role } : {}), ...(nextStage ? { nextStage } : {}), ...(nextAgent ? { nextAgent } : {}),
    sourceTickets: Array.isArray(state.sourceTickets) ? state.sourceTickets.map(String) : [],
    affectedRepositories: Array.isArray(state.affectedRepositories)
      ? state.affectedRepositories.map((repo: unknown) => typeof repo === "string" ? repo : isRecord(repo) ? String(repo.name ?? repo.alias ?? "UNKNOWN") : "UNKNOWN") : [],
    updatedAt: Date.now(),
  };
}
