import { randomUUID } from "node:crypto";

export interface WorkflowTask {
  taskId: string;
  type: string;
  status: string;
  /** Optional for older v1 responses; views default a missing value to REAL. */
  evidenceClassification?: EvidenceClassification;
  scope: { ticketId: string; repositoryAlias: string; targetCommit: string };
  version: number;
  updatedAt: string;
}

export type EvidenceClassification = "REAL" | "SIMULATED_PASS";

export interface EnterpriseIdentity { employeeId: string; displayLabel: string; source: string }
export interface IntegrationDiagnostic { provider: string; status: string; observedAt: string; source: string; safeDetail: string }
export interface NextInternalValidation { complete: boolean; provider?: string; status?: string; instruction?: string }

export interface EpicSummary { epicId: string; title: string; journeyId: string; status: string; version: number }
export interface TicketSummary { ticketId: string; epicId: string; channel: string; status: string; evidenceClassification?: EvidenceClassification; pendingChangeConfirmation: boolean; version: number }
export interface RepoTaskSummary { repoTaskId: string; ticketId: string; repositoryAlias: string; status: string; evidenceClassification?: EvidenceClassification; version: number }
export interface EpicResume { epic: EpicSummary; tickets: Array<{ ticket: TicketSummary; openTasks: WorkflowTask[]; nextAction: string }>; auditTrail: Array<{ action: string; actorId: string; occurredAt: string; evidenceClassification?: EvidenceClassification }> }
export interface PodMember { principalId: string; employeeId: string; displayLabel: string; role: string; onboardingStatus: string }
export interface JourneyFreshnessMap { [alias: string]: string }

export interface EpicChangeRequest { changeRequestId: string; epicId: string; title: string; status: string; requestedBy: string }
export interface HealthLatency { ok: boolean; latencyMs: number }
export interface PodMemberImportInput { employeeId: string; displayLabel: string; role: string; principalId?: string }
export interface PodMemberValidation { valid: boolean; errors: string[]; members: PodMember[] }
/** Shape of the MCP catalog returned by the workflow-service diagnostics endpoint. */
export interface McpCatalogServer { id: string; name: string; required: boolean; skills: string[] }

export class WorkflowClient {
  private static readonly REQUEST_TIMEOUT_MS = 15_000;
  private etag: string | undefined;
  private cachedTasks: WorkflowTask[] = [];
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch, private readonly demoActorId?: string) {
    const url = new URL(baseUrl);
    if (demoActorId && !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
      throw new Error("Demo actor is restricted to a loopback Workflow Service");
    }
    this.baseUrl = url.toString().replace(/\/$/, "");
  }

  async listTasks(signal?: AbortSignal): Promise<WorkflowTask[]> {
    const headers = this.headers();
    if (this.etag) headers["If-None-Match"] = this.etag;
    const response = await this.fetcher(`${this.baseUrl}/api/v1/tasks`, {
      headers,
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status === 304) return this.cachedTasks;
    await this.requireOk(response);
    this.etag = response.headers.get("ETag") ?? undefined;
    this.cachedTasks = await response.json() as WorkflowTask[];
    return this.cachedTasks;
  }

  async getTask(taskId: string): Promise<WorkflowTask> {
    return this.json(`/api/v1/tasks/${encodeURIComponent(taskId)}`) as Promise<WorkflowTask>;
  }

  async getReport(artifactId: string, version: number): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/api/v1/reports/${encodeURIComponent(artifactId)}/versions/${version}`, {
      headers: this.headers(),
    });
    await this.requireOk(response);
    return response.text();
  }

  async approve(input: { taskId: string; artifactId: string; artifactVersion: number; expectedTaskVersion: number }): Promise<WorkflowTask> {
    return this.json("/api/v1/approvals", { method: "POST", body: JSON.stringify(input) }) as Promise<WorkflowTask>;
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.fetcher(`${this.baseUrl}/actuator/health`, { headers: this.headers() });
      return response.ok;
    } catch { return false; }
  }

  getIdentity(): Promise<EnterpriseIdentity> {
    return this.json("/api/v1/internal-readiness/identity") as Promise<EnterpriseIdentity>;
  }

  getIntegrationDiagnostics(): Promise<IntegrationDiagnostic[]> {
    return this.json("/api/v1/internal-readiness/integrations") as Promise<IntegrationDiagnostic[]>;
  }

  getNextInternalValidation(): Promise<NextInternalValidation> {
    return this.json("/api/v1/internal-readiness/next-validation") as Promise<NextInternalValidation>;
  }

  async renderJourneyReport(manifest: unknown): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/api/v1/journeys/report`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(manifest),
    });
    await this.requireOk(response);
    return response.text();
  }

  async listEpics(signal?: AbortSignal): Promise<EpicSummary[]> {
    return (await this.json("/api/v1/epics", { method: "GET" }, signal)) as EpicSummary[];
  }

  async getEpicResume(epicId: string, signal?: AbortSignal): Promise<EpicResume> {
    return (await this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/resume`, { method: "GET" }, signal)) as EpicResume;
  }

  async listTickets(epicId: string, signal?: AbortSignal): Promise<TicketSummary[]> {
    return (await this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/tickets`, { method: "GET" }, signal)) as TicketSummary[];
  }

  async listRepoTasks(ticketId: string, signal?: AbortSignal): Promise<RepoTaskSummary[]> {
    return (await this.json(`/api/v1/tickets/${encodeURIComponent(ticketId)}/repo-tasks`, { method: "GET" }, signal)) as RepoTaskSummary[];
  }

  async getPodMembers(journeyId: string, signal?: AbortSignal): Promise<PodMember[]> {
    return (await this.json(`/api/v1/internal-readiness/pods/${encodeURIComponent(journeyId)}/members`, { method: "GET" }, signal)) as PodMember[];
  }

  async getJourneyFreshness(manifest: unknown, signal?: AbortSignal): Promise<JourneyFreshnessMap> {
    return (await this.json("/api/v1/journeys/freshness", { method: "POST", body: JSON.stringify(manifest) }, signal)) as JourneyFreshnessMap;
  }

  /** Overall per-journey freshness map (no manifest), for the Diagnostics overview. */
  listJourneyFreshness(signal?: AbortSignal): Promise<JourneyFreshnessMap> {
    return this.json("/api/v1/journeys/freshness", { method: "GET" }, signal) as Promise<JourneyFreshnessMap>;
  }

  async getTicket(ticketId: string): Promise<TicketSummary> {
    return this.json(`/api/v1/tickets/${encodeURIComponent(ticketId)}`) as Promise<TicketSummary>;
  }

  async claimTask(taskId: string): Promise<WorkflowTask> {
    return this.json(`/api/v1/tasks/${encodeURIComponent(taskId)}/claim`, { method: "POST" }) as Promise<WorkflowTask>;
  }

  async resumeTask(taskId: string): Promise<WorkflowTask> {
    return this.json(`/api/v1/tasks/${encodeURIComponent(taskId)}/resume`, { method: "POST" }) as Promise<WorkflowTask>;
  }

  async advanceTicket(ticketId: string): Promise<TicketSummary> {
    return this.json(`/api/v1/tickets/${encodeURIComponent(ticketId)}/advance`, { method: "POST" }) as Promise<TicketSummary>;
  }

  async requestApproval(ticketId: string): Promise<TicketSummary> {
    return this.json(`/api/v1/tickets/${encodeURIComponent(ticketId)}/request-approval`, { method: "POST" }) as Promise<TicketSummary>;
  }

  async skipTicket(ticketId: string, reason: string): Promise<TicketSummary> {
    return this.json(`/api/v1/tickets/${encodeURIComponent(ticketId)}/skip`, { method: "POST", body: JSON.stringify({ reason }) }) as Promise<TicketSummary>;
  }

  async createEpic(input: { title: string; journeyId: string }): Promise<EpicSummary> {
    return this.json("/api/v1/epics", { method: "POST", body: JSON.stringify(input) }) as Promise<EpicSummary>;
  }

  async activateEpic(epicId: string): Promise<EpicSummary> {
    return this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/activate`, { method: "POST" }) as Promise<EpicSummary>;
  }

  async createChangeRequest(epicId: string, input: { title: string }): Promise<EpicChangeRequest> {
    return this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/change-requests`, { method: "POST", body: JSON.stringify(input) }) as Promise<EpicChangeRequest>;
  }

  async approveChangeRequest(epicId: string, changeRequestId: string): Promise<EpicChangeRequest> {
    return this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/change-requests/${encodeURIComponent(changeRequestId)}/approve`, { method: "POST" }) as Promise<EpicChangeRequest>;
  }

  async addEpicDependency(epicId: string, input: { dependsOnEpicId: string }): Promise<EpicSummary> {
    return this.json(`/api/v1/epics/${encodeURIComponent(epicId)}/dependencies`, { method: "POST", body: JSON.stringify(input) }) as Promise<EpicSummary>;
  }

  async validatePodMembers(journeyId: string, members: PodMemberImportInput[]): Promise<PodMemberValidation> {
    return this.json(`/api/v1/internal-readiness/pods/${encodeURIComponent(journeyId)}/members/validate`, { method: "POST", body: JSON.stringify({ members }) }) as Promise<PodMemberValidation>;
  }

  async importPodMembers(journeyId: string, members: PodMemberImportInput[]): Promise<PodMember[]> {
    return this.json(`/api/v1/internal-readiness/pods/${encodeURIComponent(journeyId)}/members/import`, { method: "POST", body: JSON.stringify({ members }) }) as Promise<PodMember[]>;
  }

  async getMcpCatalog(signal?: AbortSignal): Promise<McpCatalogServer[]> {
    return (await this.json("/api/v1/diagnostics/mcp-catalog", { method: "GET" }, signal)) as McpCatalogServer[];
  }

  /** Actuator health probe with round-trip latency, never throws. */
  async healthLatency(): Promise<HealthLatency> {
    const started = Date.now();
    try {
      const response = await this.fetcher(`${this.baseUrl}/actuator/health`, { headers: this.headers() });
      return { ok: response.ok, latencyMs: Date.now() - started };
    } catch { return { ok: false, latencyMs: Date.now() - started }; }
  }

  private async json(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WorkflowClient.REQUEST_TIMEOUT_MS);
    const abortFromCaller = (): void => controller.abort();
    signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(),
        signal: controller.signal,
      });
      await this.requireOk(response);
      return response.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json", "Content-Type": "application/json", "X-Correlation-ID": randomUUID(),
    };
    if (this.demoActorId) headers["X-Demo-User"] = this.demoActorId;
    return headers;
  }

  private async requireOk(response: Response): Promise<void> {
    if (!response.ok) throw new Error(`Workflow request failed (${response.status})`);
  }
}
