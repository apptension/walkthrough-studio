# Agent guide — Walkthrough Studio

Persistent rules live in **`.cursor/rules/`** (`.mdc` files). Cursor loads them automatically; **`alwaysApply: true`** rules apply every session.

## Start here

| Rule | When |
|------|------|
| `walkthrough-agent-behavior.mdc` | Default execution style |
| `verification-and-testing.mdc` | Before claiming done |
| `common-regressions.mdc` | Bug fixes, editor, scrub, UI polish |
| `editor-render-parity.mdc` | Plate editor, magnifier, preview vs render |
| `plate-stage-engine.mdc` | `plate.ts`, `stage.ts`, iframes, lens |
| `copy-edit-content-pane.mdc` | Inline edit, Content pane, caret |
| `desk-architecture.mdc` | React desk structure & CSS |
| `timeline-monitor-jobs.mdc` | Timeline, transport, render bay, jobs |
| `direction-look-reveal.mdc` | Look & reveal, chapter vs all |
| `kit-pipeline-recording.mdc` | Record, capture, produce CLI |
| `render-quality-floor.mdc` | Encode/plates/bake optimizations |
| `authoring-and-agents.mdc` | Story, critic, brands, CLI agents |
| `release-workflow.mdc` | Commit / PR / tag (on request) |

## Repo map

- **`kit/studio/`** — production desk (React + TS + Zustand). Dev: `./studio --dev` → server **4747**, Vite **4748**.
- **`kit/lib/`** + **`kit/cli.mjs`** — pipeline, plates, record, agents.
- **`authoring.md`** — story, plates, critic rules (product voice).
- **`kit/.env`** — secrets; **never read, log, or commit**.

## Non‑negotiables (from recent sessions)

1. **Editor preview = render** (1:1): scrub back, magnifier, copy edit, resolution boxes, caption timing.
2. **No caret-killing remounts** while typing in Content pane or inline plate edit.
3. **Stop cancels work** — no zombie record/produce PIDs or frozen LIVE UI.
4. **Quality floor** on encode/plates — see `render-quality-floor.mdc` before pipeline perf work.
5. **Verify**: `cd kit/studio && npm run verify` + targeted browser repro on a real slug.
