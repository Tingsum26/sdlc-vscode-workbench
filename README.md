# sdlc-vscode-workbench

A VS Code extension ("Local Copilot SDLC Workbench") that gives a human operator a UI-only
workbench over a local, human-controlled SDLC workflow. This is the `sdlc-vscode-workbench`
slice of the seven-repository platform split.

> **Provenance:** extracted from
> [Tingsum26/sdlc-agent-platform](https://github.com/Tingsum26/sdlc-agent-platform) at the
> `seven-repo-split-baseline` tag (commit `bf48e15`, branch `agent/mvp-vertical-slice`),
> source path `apps/vscode-extension`.

## What this extension is

The workbench is a **UI-only** VS Code extension. It renders SDLC state, reports, approvals,
MCP onboarding, and diagnostics into the Activity Bar, and it issues REST calls to a local
Workflow Service. It contains no model client of any kind.

- **Views** (8 registered, M6 model — Repo Task is nested under Ticket): My Work, Scrum
  Master, Epic, Ticket, Identity / Pod Configuration, Customization Center, MCP Center,
  and Diagnostics.
- Task freshness polling (foreground/background, with exponential backoff).
- Exact-version approval, safe HTML reports, Journey readiness reports.
- Reviewed customization-bundle install/rollback with symlink rejection and secret screening.
- Static MCP catalog mirror plus a loopback-restricted demo-actor guard.
- Fictional public data throughout (`DEMO-123`, `REPO_A`, `example.invalid`).

## No AI models

**This VSIX invokes NO AI models directly.** It never calls `vscode.lm`, `selectChatModels`,
`sendRequest`, or any language-model API. All AI reasoning runs in the interactive VS Code
GitHub Copilot Chat session the user starts and supervises, and all workflow tool access goes
through the **Local MCP Gateway** (`sdlc-workflow-mcp`), never from inside this extension.

## Platform BOM

This repository is one entry in the seven-repository split. See the platform BOM at
[`docs/platform-bom.yaml`](https://github.com/Tingsum26/sdlc-agent-platform/blob/seven-repo-split-baseline/docs/platform-bom.yaml)
in the platform repo for the full bill of materials (roles, versions, source paths, and
compatibility rules).

## Registered gap

The seven-repository gap audit records the VSIX entry as **PARTIAL**: the approved target is
8 semantically distinct view models and actions, while the current implementation registers
the 8 view IDs with mostly generic task providers. This repository is the vertical-slice
implementation, not the completed target.

## Develop

```bash
pnpm install
pnpm test       # vitest
pnpm package    # typecheck + esbuild + vsce package -> dist/sdlc-workbench.vsix
```

- Requires Node >= 20.19 and pnpm.
- `pnpm package` produces `dist/sdlc-workbench.vsix` (not committed).

## Hard boundaries

- No Docker, no embedded database, no credentials.
- No model client anywhere in this extension's source.
- Public fixtures use fictional identities and `example.invalid`-style domains.

## License

MIT. See [LICENSE](LICENSE).
