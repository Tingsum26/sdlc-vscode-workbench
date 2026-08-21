import { describe, expect, it } from "vitest";
import { buildReadinessRows } from "../src/views/readinessModel.js";

describe("readiness view model", () => {
  it("shows identity, evidence text, source, observation time, and next validation without color-only meaning", () => {
    const rows = buildReadinessRows(
      { employeeId: "EMP-100", displayLabel: "Fictional Scrum Master", source: "ADMIN_BINDING" },
      [{ provider: "JIRA", status: "SIMULATED_PASS", observedAt: "2026-08-16T00:00:00Z", source: "deterministic-fake", safeDetail: "No enterprise call." }],
      { complete: false, provider: "JIRA", status: "SIMULATED_PASS", instruction: "Validate internally." },
    );
    expect(rows.map((row) => row.label)).toEqual(["Identity · EMP-100", "JIRA · SIMULATED_PASS", "Next validation · JIRA"]);
    expect(rows[1]?.description).toContain("deterministic-fake");
    expect(rows[1]?.tooltip).toContain("2026-08-16");
  });
});
