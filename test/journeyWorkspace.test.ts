import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findJourneyWorkspace, readJourneySnapshot } from "../src/mvp/journeyWorkspace.js";

describe("GitHub-only Journey workspace", () => {
  it("reads stage, artifacts and receipt health without a Workflow Service", () => {
    const root = join(tmpdir(), `sdlc-journey-${Date.now()}`);
    try {
      mkdirSync(join(root, ".sdlc", "context-receipts"), { recursive: true });
      mkdirSync(join(root, "docs", "01-context"), { recursive: true });
      writeFileSync(join(root, "docs", "01-context", "baseline.md"), "baseline");
      const receipt = JSON.stringify({ schemaVersion: "v1", stage: "REQUIREMENTS", role: "requirement-analyst" });
      const receiptHash = createHash("sha256").update(receipt).digest("hex");
      writeFileSync(join(root, ".sdlc", "context-receipts", "requirements-requirement-analyst.json"), receipt);
      writeFileSync(join(root, "docs", "01-context", "code-context.md"), `---\ncontextReceipt: .sdlc/context-receipts/requirements-requirement-analyst.json\ncontextReceiptSha256: ${receiptHash}\n---\ncode`);
      writeFileSync(join(root, ".sdlc", "workflow.json"), JSON.stringify({
        workflowId: "AO-123", journeyId: "account-opening", branch: "journey/AO-123-open-account", currentStage: "REQUIREMENTS", status: "IN_PROGRESS",
        sourceTickets: ["AO-123"], affectedRepositories: [{ name: "account-opening-api" }], stageOrder: ["REQUIREMENTS", "DESIGN"], artifacts: {
          JOURNEY_BASELINE: { path: "docs/01-context/baseline.md", status: "BASELINE" },
          CODE_CONTEXT: { path: "docs/01-context/code-context.md", status: "APPROVED" },
          REQUIREMENT_CONTRACT: { path: "docs/02-requirements/requirement-contract.md", status: "DRAFT" },
        }, stages: { REQUIREMENTS: { role: "requirement-analyst", output: "REQUIREMENT_CONTRACT" }, DESIGN: { role: "solution-architect" } },
      }));
      expect(findJourneyWorkspace([join(root, "missing"), root])).toBe(root);
      const snapshot = readJourneySnapshot(root);
      expect(snapshot.currentStage).toBe("REQUIREMENTS");
      expect(snapshot.nextRole).toBe("requirement-analyst");
      expect(snapshot.nextAgent).toBe("requirement-analyst");
      expect(snapshot.gateState).toBe("WAITING_FOR_APPROVAL");
      expect(snapshot.currentOutputStatus).toBe("DRAFT");
      expect(snapshot.artifacts.map((artifact) => artifact.receipt)).toEqual(["NOT_REQUIRED", "OK", "MISSING"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives the next Agent only after the current output is approved", () => {
    const root = join(tmpdir(), `sdlc-journey-approved-${Date.now()}`);
    try {
      mkdirSync(join(root, ".sdlc"), { recursive: true });
      writeFileSync(join(root, ".sdlc", "workflow.json"), JSON.stringify({
        workflowId: "AO-124", journeyId: "account-opening", branch: "journey/AO-124",
        currentStage: "REQUIREMENTS", stageOrder: ["REQUIREMENTS", "DESIGN"], status: "IN_PROGRESS",
        artifacts: { REQUIREMENT_CONTRACT: { path: "docs/requirement.md", status: "APPROVED" } },
        stages: { REQUIREMENTS: { role: "requirement-analyst", output: "REQUIREMENT_CONTRACT" }, DESIGN: { role: "solution-architect", output: "SOLUTION_DESIGN" } },
      }));
      const snapshot = readJourneySnapshot(root);
      expect(snapshot.gateState).toBe("READY_FOR_NEXT_AGENT");
      expect(snapshot.nextStage).toBe("DESIGN");
      expect(snapshot.nextAgent).toBe("solution-architect");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
