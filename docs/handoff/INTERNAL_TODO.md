# INTERNAL TODO Registry

Every internal-network configuration point in public code carries a
`TODO(INTERNAL): INTERNAL-XXX` marker and MUST be listed here. M8 adds CI
enforcement so an unregistered marker fails the build.

| ID | Component | File | Internal agent action | Evidence required | Rollback |
|---|---|---|---|---|---|


| INTERNAL-HOOKS-001 | vscode-extension | `customization/bundleInstaller.ts` | Confirm company Copilot policy allows VS Code agent hooks; replace the local Node no-op actions with approved deterministic hook commands | Sanitized hook activation log | Disable hook activation (bundle still installs) |
