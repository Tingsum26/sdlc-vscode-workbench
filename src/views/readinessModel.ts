import type { EnterpriseIdentity, IntegrationDiagnostic, NextInternalValidation } from "../api/workflowClient.js";

export interface ReadinessRow { label: string; description: string; tooltip: string; status: string }

export function buildReadinessRows(
  identity: EnterpriseIdentity | undefined,
  diagnostics: IntegrationDiagnostic[],
  next: NextInternalValidation | undefined,
): ReadinessRow[] {
  const rows: ReadinessRow[] = [];
  if (identity) rows.push({
    label: `Identity · ${identity.employeeId}`,
    description: identity.source,
    tooltip: `${identity.displayLabel} — source: ${identity.source}`,
    status: "IDENTIFIED",
  });
  for (const diagnostic of diagnostics) rows.push({
    label: `${diagnostic.provider} · ${diagnostic.status}`,
    description: diagnostic.source,
    tooltip: `${diagnostic.safeDetail}\nObserved: ${diagnostic.observedAt}\nEvidence: ${diagnostic.status}`,
    status: diagnostic.status,
  });
  if (next) rows.push({
    label: next.complete ? "Internal validation · Complete" : `Next validation · ${next.provider ?? "Unknown"}`,
    description: next.status ?? "No pending action",
    tooltip: next.instruction ?? "All configured internal validation actions are complete.",
    status: next.status ?? "COMPLETE",
  });
  return rows;
}
