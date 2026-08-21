const allowedActions = new Set([
  "verify-workflow-context",
  "record-redacted-metadata",
  "guard-dangerous-operations",
  "format-and-record",
  "persist-checkpoint",
  "verify-stage-output",
]);

const [action, ...extraArguments] = process.argv.slice(2);
if (extraArguments.length !== 0 || !allowedActions.has(action)) process.exitCode = 1;
