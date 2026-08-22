import { describe, expect, it, vi } from "vitest";
import { WorkflowClient } from "../src/api/workflowClient.js";

describe("WorkflowClient", () => {
  it("reuses ETag and correlation data without exposing a backend", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("[]", { status: 200, headers: { ETag: "v1" } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher, "developer-1");
    expect(await client.listTasks()).toEqual([]);
    expect(await client.listTasks()).toEqual([]);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual(expect.objectContaining({ "If-None-Match": "v1" }));
  });

  it("reads evidence-labelled readiness and renders Journey reports through the service", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ employeeId: "EMP-100" }))
      .mockResolvedValueOnce(Response.json([{ provider: "JIRA", status: "SIMULATED_PASS" }]))
      .mockResolvedValueOnce(Response.json({ complete: false, provider: "JIRA" }))
      .mockResolvedValueOnce(new Response("<!doctype html><title>Journey</title>", { status: 200, headers: { "content-type": "text/html" } }));
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher, "PRINCIPAL-EMP-100");

    expect(await client.getIdentity()).toEqual({ employeeId: "EMP-100" });
    expect(await client.getIntegrationDiagnostics()).toHaveLength(1);
    expect(await client.getNextInternalValidation()).toEqual({ complete: false, provider: "JIRA" });
    expect(await client.renderJourneyReport({ schemaVersion: "1.0" })).toContain("<!doctype html>");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8080/api/v1/internal-readiness/identity",
      "http://127.0.0.1:8080/api/v1/internal-readiness/integrations",
      "http://127.0.0.1:8080/api/v1/internal-readiness/next-validation",
      "http://127.0.0.1:8080/api/v1/journeys/report",
    ]);
  });
});

describe("M6 workflow client", () => {
  it("lists epics", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await client.listEpics();
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8080/api/v1/epics", expect.objectContaining({ method: "GET" }));
  });

  it("loads an epic resume with tickets and repo tasks", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/resume")) return new Response(JSON.stringify({ epic: {}, tickets: [], auditTrail: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (path.includes("/repo-tasks")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    const resume = await client.getEpicResume("EPIC-M2-1");
    expect(resume.tickets).toEqual([]);
  });

  it("loads pod members", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await client.getPodMembers("ACCOUNT_OPENING");
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8080/api/v1/internal-readiness/pods/ACCOUNT_OPENING/members", expect.objectContaining({ method: "GET" }));
  });
});

describe("M6 workflow mutations and diagnostics", () => {
  const jsonFetcher = (): ReturnType<typeof vi.fn<typeof fetch>> =>
    vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

  it("posts task claim and resume to task-scoped endpoints", async () => {
    const fetcher = jsonFetcher();
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await client.claimTask("TASK-1");
    await client.resumeTask("TASK-1");
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8080/api/v1/tasks/TASK-1/claim");
    expect(fetcher.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
    expect(fetcher.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8080/api/v1/tasks/TASK-1/resume");
  });

  it("posts ticket advance, request-approval, and skip-with-reason with a body", async () => {
    const fetcher = jsonFetcher();
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await client.advanceTicket("M2-API-1");
    await client.requestApproval("M2-API-1");
    await client.skipTicket("M2-API-1", "blocked upstream");
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8080/api/v1/tickets/M2-API-1/advance");
    expect(fetcher.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8080/api/v1/tickets/M2-API-1/request-approval");
    expect(fetcher.mock.calls[2]?.[0]).toBe("http://127.0.0.1:8080/api/v1/tickets/M2-API-1/skip");
    expect((fetcher.mock.calls[2]?.[1] as RequestInit).body).toBe(JSON.stringify({ reason: "blocked upstream" }));
  });

  it("drives epic create/activate/change-request/dependency and pod roster endpoints", async () => {
    const fetcher = jsonFetcher();
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await client.createEpic({ title: "Account opening", journeyId: "ACCOUNT_OPENING" });
    await client.activateEpic("EPIC-1");
    await client.createChangeRequest("EPIC-1", { title: "Add step" });
    await client.approveChangeRequest("EPIC-1", "CR-1");
    await client.addEpicDependency("EPIC-1", { dependsOnEpicId: "EPIC-0" });
    await client.validatePodMembers("ACCOUNT_OPENING", [{ employeeId: "EMP-1", displayLabel: "A", role: "DEVELOPER" }]);
    await client.importPodMembers("ACCOUNT_OPENING", [{ employeeId: "EMP-1", displayLabel: "A", role: "DEVELOPER" }]);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8080/api/v1/epics",
      "http://127.0.0.1:8080/api/v1/epics/EPIC-1/activate",
      "http://127.0.0.1:8080/api/v1/epics/EPIC-1/change-requests",
      "http://127.0.0.1:8080/api/v1/epics/EPIC-1/change-requests/CR-1/approve",
      "http://127.0.0.1:8080/api/v1/epics/EPIC-1/dependencies",
      "http://127.0.0.1:8080/api/v1/internal-readiness/pods/ACCOUNT_OPENING/members/validate",
      "http://127.0.0.1:8080/api/v1/internal-readiness/pods/ACCOUNT_OPENING/members/import",
    ]);
  });

  it("reads the MCP catalog and overall journey freshness from diagnostics endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("[{\"id\":\"workflow\",\"name\":\"Workflow MCP\",\"required\":true,\"skills\":[]}]", { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("{\"ACCOUNT_OPENING\":\"LIVE\"}", { status: 200, headers: { "content-type": "application/json" } }));
    const client = new WorkflowClient("http://127.0.0.1:8080", fetcher);
    await expect(client.getMcpCatalog()).resolves.toEqual([{ id: "workflow", name: "Workflow MCP", required: true, skills: [] }]);
    await expect(client.listJourneyFreshness()).resolves.toEqual({ ACCOUNT_OPENING: "LIVE" });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "http://127.0.0.1:8080/api/v1/diagnostics/mcp-catalog",
      "http://127.0.0.1:8080/api/v1/journeys/freshness",
    ]);
  });

  it("reports health latency without throwing on an unreachable service", async () => {
    const okClient = new WorkflowClient("http://127.0.0.1:8080", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(okClient.healthLatency()).resolves.toMatchObject({ ok: true });
    const downClient = new WorkflowClient("http://127.0.0.1:8080", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    await expect(downClient.healthLatency()).resolves.toMatchObject({ ok: false });
  });
});
