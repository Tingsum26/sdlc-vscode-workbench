import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ReceiptState = "OK" | "STALE" | "MISSING" | "NOT_REQUIRED";
export interface JourneyArtifactSnapshot { id: string; path: string; status: string; receipt: ReceiptState; }
export type JourneyGateState = "WAITING_FOR_APPROVAL" | "READY_FOR_NEXT_AGENT" | "COMPLETED" | "BLOCKED";
export interface JourneySnapshot {
  root: string; workflowId: string; journeyId: string; branch: string; currentStage: string; status: string;
  artifacts: JourneyArtifactSnapshot[]; currentOutputId?: string; currentOutputPath?: string; currentOutputStatus: string; gateState: JourneyGateState;
  nextRole?: string; nextStage?: string; nextAgent?: string; sourceTickets: string[];
  affectedRepositories: string[]; updatedAt: number;
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
function receiptState(root: string, artifactPath: string, status: string): ReceiptState {
  if (status === "BASELINE") return "NOT_REQUIRED";
  const absoluteArtifact = join(root, artifactPath);
  if (!existsSync(absoluteArtifact)) return "MISSING";
  const fields = frontMatter(readFileSync(absoluteArtifact, "utf8"));
  if (!fields.contextReceipt || !fields.contextReceiptSha256) return "MISSING";
  const receiptPath = join(root, fields.contextReceipt);
  if (!existsSync(receiptPath)) return "MISSING";
  return hash(readFileSync(receiptPath)) === fields.contextReceiptSha256 ? "OK" : "STALE";
}
export function findJourneyWorkspace(workspaceRoots: string[]): string | undefined {
  return workspaceRoots.find((root) => existsSync(join(root, ".sdlc", "workflow.json")));
}
export function readJourneySnapshot(root: string): JourneySnapshot {
  const state = JSON.parse(readFileSync(join(root, ".sdlc", "workflow.json"), "utf8")) as Record<string, any>;
  const artifacts = Object.entries((state.artifacts ?? {}) as Record<string, any>).map(([id, value]) => ({
    id, path: String(value.path), status: String(value.status ?? "UNKNOWN"), receipt: receiptState(root, String(value.path), String(value.status ?? "UNKNOWN")),
  }));
  const stageOrder = Array.isArray(state.stageOrder) ? state.stageOrder.map(String) : [];
  const currentStage = String(state.currentStage ?? "UNKNOWN");
  const stage = state.stages?.[currentStage];
  const currentOutputId = stage?.output ? String(stage.output) : undefined;
  const currentOutputStatus = currentOutputId ? String(state.artifacts?.[currentOutputId]?.status ?? "UNKNOWN") : "UNKNOWN";
  const currentIndex = stageOrder.indexOf(currentStage);
  const outputApproved = currentOutputStatus === "APPROVED" || currentOutputStatus === "SKIPPED_WITH_EVIDENCE";
  const hasNextStage = currentIndex >= 0 && currentIndex < stageOrder.length - 1;
  const nextStage = outputApproved && hasNextStage ? stageOrder[currentIndex + 1] : undefined;
  const gateState: JourneyGateState = state.status === "COMPLETED" || (!hasNextStage && outputApproved)
    ? "COMPLETED"
    : outputApproved ? "READY_FOR_NEXT_AGENT" : currentOutputStatus === "BLOCKED" ? "BLOCKED" : "WAITING_FOR_APPROVAL";
  const nextAgent = gateState === "READY_FOR_NEXT_AGENT" && nextStage
    ? String(state.stages?.[nextStage]?.role ?? "UNKNOWN")
    : stage?.role ? String(stage.role) : undefined;
  return {
    root, workflowId: String(state.workflowId ?? "UNKNOWN"), journeyId: String(state.journeyId ?? "UNKNOWN"),
    branch: String(state.branch ?? "UNKNOWN"), currentStage, status: String(state.status ?? "UNKNOWN"),
    artifacts, ...(currentOutputId ? { currentOutputId } : {}), ...(currentOutputId && state.artifacts?.[currentOutputId]?.path ? { currentOutputPath: String(state.artifacts[currentOutputId].path) } : {}), currentOutputStatus, gateState,
    ...(stage?.role ? { nextRole: String(stage.role) } : {}), ...(nextStage ? { nextStage } : {}), ...(nextAgent ? { nextAgent } : {}),
    sourceTickets: Array.isArray(state.sourceTickets) ? state.sourceTickets.map(String) : [],
    affectedRepositories: Array.isArray(state.affectedRepositories)
      ? state.affectedRepositories.map((repo: any) => typeof repo === "string" ? repo : String(repo.name ?? repo.alias ?? "UNKNOWN")) : [],
    updatedAt: Date.now(),
  };
}
