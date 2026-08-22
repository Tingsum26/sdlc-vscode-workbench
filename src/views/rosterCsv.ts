import type { PodMemberImportInput } from "../api/workflowClient.js";

/**
 * Parses a pod roster CSV into member import inputs. The first non-empty row
 * is a header naming the columns (employeeId, displayLabel, role, and an
 * optional principalId). Rows missing any required column are skipped; a fully
 * headerless or empty file yields an empty list so the caller can reject it.
 */
export function parseRosterCsv(text: string): PodMemberImportInput[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((cell) => cell.trim().toLowerCase());
  const indexOf = (name: string): number => header.indexOf(name);
  const employeeIndex = indexOf("employeeid");
  const labelIndex = indexOf("displaylabel");
  const roleIndex = indexOf("role");
  const principalIndex = indexOf("principalid");
  if (employeeIndex < 0 || labelIndex < 0 || roleIndex < 0) return [];

  const members: PodMemberImportInput[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    const employeeId = cells[employeeIndex] ?? "";
    const displayLabel = cells[labelIndex] ?? "";
    const role = cells[roleIndex] ?? "";
    if (!employeeId || !displayLabel || !role) continue;
    const member: PodMemberImportInput = { employeeId, displayLabel, role };
    const principalId = principalIndex >= 0 ? cells[principalIndex] : undefined;
    if (principalId) member.principalId = principalId;
    members.push(member);
  }
  return members;
}
