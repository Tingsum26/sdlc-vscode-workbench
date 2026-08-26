# sdlc-vscode-workbench

A VS Code extension ("Local Copilot SDLC Workbench") that gives a human operator a UI-only
workbench over a local, human-controlled SDLC workflow. This is the `sdlc-vscode-workbench`
slice of the seven-repository platform split.

> **Provenance:** extracted from
> [Tingsum26/sdlc-agent-platform](https://github.com/Tingsum26/sdlc-agent-platform) at the
> `seven-repo-split-baseline` tag (commit `bf48e15`, branch `agent/mvp-vertical-slice`),
> source path `apps/vscode-extension`.

## What this extension is

The workbench is a **UI-only** VS Code extension. In the accepted GitHub-only
MVP it renders checked-out Journey state, reports, next-step guidance and
diagnostics without calling a service. The older REST/Workflow-Service views
remain an explicitly Phase 2 compatibility path. It contains no model client
of any kind.

## GitHub-only MVP mode

When the opened workspace contains `.sdlc/workflow.json`, the extension enters
GitHub-only MVP mode. The eight views read the Journey branch directly from the
workspace and display its stage, artifacts, Context Receipt freshness, linked
repositories, and next Coordinator command. This mode does not require a
Workflow Service, Workflow MCP, MongoDB, or Jenkins. File changes under
`.sdlc/` and `docs/` refresh the views automatically. Every Journey artifact
Markdown row is clickable and opens a script-free HTML Agent Report; the
report panel watches that file and updates when an Agent, `git pull`, or a
human edits it. The report panel uses a narrowly scoped CSP-protected refresh
script; it does not execute report content. The previous REST-backed
views remain available when no Journey workspace is detected as a Phase 2
compatibility path.

GitHub Journey PR is the required shared human UI for the GitHub-only MVP. This
extension remains fully supported as an **optional local companion**: it keeps
the eight views, next-Agent guidance, suggested Copilot command, local report
rendering and automatic workspace refresh, but no participant must install it
to review a report or continue the workflow.

- **Views** (8 registered, M6 model — Repo Task is nested under Ticket): My Work, Scrum
  Master, Epic, Ticket, Identity / Pod Configuration, Customization Center, MCP Center,
  and Diagnostics.
- Task freshness polling (foreground/background, with exponential backoff).
- Exact-version approval, safe HTML reports, Journey readiness reports.
- Live, human-readable HTML rendering for every Agent artifact with missing/
  changed-file feedback; the VSIX never writes or approves the artifact.
- Reviewed customization-bundle install/rollback with symlink rejection and secret screening.
- Static MCP catalog mirror plus a loopback-restricted demo-actor guard.
- Fictional public data throughout (`DEMO-123`, `REPO_A`, `example.invalid`).

## No AI models

**This VSIX invokes NO AI models directly.** It never calls `vscode.lm`, `selectChatModels`,
`sendRequest`, or any language-model API. All AI reasoning runs in the interactive VS Code
GitHub Copilot Chat session the user starts and supervises. In GitHub-only MVP,
the extension neither calls Workflow MCP nor mutates workflow state; optional
local MCPs are user-run context connectors only. Workflow MCP is a Phase 2
deterministic integration option.

## Views

Eight activity-bar views, each with its own data model and inline actions (no shared generic
task provider):

- **My Work** — the actionable task backlog with status icons and per-item inline actions
  (*Claim Task*, *Resume Task*, *Copy Copilot Command for Task*).
- **Scrum Master View** — next-action hints per ticket, a blockers section, an epic resume
  summary node, and a *Copy Standup Digest* action built from the epic resume endpoint.
- **Epic View** — journey epics with lifecycle status; inline *Activate Epic*, *Create Change
  Request*, *Approve Change Request*, and *Add Dependency* actions, plus *Create Epic* via an
  InputBox flow. The selected epic live-drives the Ticket and Scrum views.
- **Ticket View** — the selected epic's tickets with nested Repo Tasks; inline *Advance*,
  *Request Approval*, *Skip with Reason*, and *Open Ticket Artifact Report* (HTML report
  reveal) actions.
- **Identity / Pod Configuration** — the bound identity card and the pod member table, plus a
  *Import Pod Roster* flow (CSV file pick → service validation → confirm import).
- **Customization Center** — installed bundle versions with dates, install/rollback actions,
  and a per-bundle *Roll Back to Bundle Version* action (reusing the bundle installer module).
- **MCP Center** — the MCP catalog fetched live from the workflow-service diagnostics endpoint
  (falling back to the bundled static catalog), plus a *Check MCP Health* action with
  round-trip latency display.
- **Diagnostics** — a self-refreshing readiness snapshot, integration diagnostics results, and
  a journey freshness overview with LIVE/DELAYED/STALE/OFFLINE badges.

## Platform BOM

This repository is one entry in the seven-repository split. See the platform BOM at
[`docs/platform-bom.yaml`](https://github.com/Tingsum26/sdlc-agent-platform/blob/seven-repo-split-baseline/docs/platform-bom.yaml)
in the platform repo for the full bill of materials (roles, versions, source paths, and
compatibility rules).

## Registered gap

The seven-repository gap audit records the VSIX entry as **PARTIAL**: the approved target is
8 semantically distinct view models and actions. This repository now registers the 8 views
with distinct data models and inline actions (see [Views](#views)); the audit entry is closed
by this slice's view work.

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
