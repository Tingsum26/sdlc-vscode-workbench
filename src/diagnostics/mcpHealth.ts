import type { WorkflowClient } from "../api/workflowClient.js";

export interface DiagnosticResult { name: string; ok: boolean; detail: string }

export async function checkMcpHealth(client: WorkflowClient, mcpConfigured: boolean): Promise<DiagnosticResult[]> {
  return [
    { name: "Workflow Service", ok: await client.health(), detail: "REST health endpoint" },
    { name: "Local Workflow MCP", ok: mcpConfigured, detail: mcpConfigured ? "Workspace MCP configuration found" : "Copy mcp.example.json to .vscode/mcp.json and review it" },
  ];
}
