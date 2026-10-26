# Studio desk

The Walkthrough Studio desk, in React and TypeScript. `./studio` serves this
app. It talks to the kit server over the same routes the CLI uses.

## Running it

The desk has no backend of its own. It reads the studio server the CLI starts
on `127.0.0.1:4747`.

From the repo root:

```bash
./studio                 # installs, builds dist/ when sources changed, serves it on :4747
./studio --dev           # server on :4747 + Vite desk with hot reload on :4748
```

`./studio` stamps `node_modules/.walkthrough-lock` with the lockfile hash and
`dist/.walkthrough-build` with a hash of the build inputs, and reinstalls or
rebuilds only when those change (`scripts/studioDesk.mjs`). The kit server
serves `dist/`, then `public/` for the mark and the icon sprite
(`kit/lib/deskAssets.mjs`).

Or manually in two terminals:

```bash
node cli.mjs studio      # the server (and the built desk) on :4747, from kit/
cd kit/studio && npm ci && npm run dev   # desk on :4748
```

Point the proxy somewhere else with `STUDIO_ORIGIN=http://127.0.0.1:5000 npm run dev`.

Building and serving the desk works on Node 20+. The test toolchain needs Node
20.19+.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on 4748, proxying the studio |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run serve` | Serve `dist/` and proxy the studio (`--port`, `--origin`) |
| `npm test` | The unit and component suite |
| `npm run test:coverage` | The same, with v8 coverage and its thresholds |
| `npm run e2e` | Playwright against Vite plus a stub studio |
| `npm run verify` | typecheck → lint → test → build, the gate before a merge |

## How it is laid out

```
src/
  main.tsx           mounts <App /> in StrictMode
  app/               App.tsx: the desk regions in index.html order, plus the boot test
  api/               client.ts (the only fetch), the server's types
  desk/              the desk runtime: store, engine modules (video, monitor, jobs…), bridges
  logic/             pure, DOM-free ports of the legacy modules, each with its test suite
  ui/                shared markup primitives: Icon, Zen, HelpTip, and their stores
  lib/               tiny generic helpers (cn)
  styles/studio.css  the desk stylesheet, and the only visual layer
  features/          one directory per desk region (see below)
  test/              factories, MSW handlers, jsdom setup, and the icon-table check
server/              the static and proxy server for a built bundle
e2e/                 Playwright specs and the stub studio they run against
```

`src/features/` is split the way the desk is on screen:

| Directory | Region |
| --- | --- |
| `chrome` | the header: video picker, brand mark, actions, agent runner |
| `stages` | the stage bar (Brief, Script, Direction, Record, Cut, Deliver) |
| `project-panel` | the left panel's Render tab: bay, guided take, pipeline, queue |
| `branch`, `cut`, `script`, `project-wizard` | the stage and header sheets |
| `monitor`, `timeline`, `editor` | the Program and Editor monitor, the lanes, the plate editor |
| `tools-panel` | the right panel shell; `feedback`, `direction`, `review`, `deliver` are its tabs |
| `command`, `help` | the command menu and the studio guide |
| `shell` | the cross-cutting pieces: boot loader, busy veil, toasts, ask dialog, shortcuts |

### Layering

Imports flow one way: `features` → `desk`, `logic`, `ui`, `api`, `lib`. Nothing
outside `src/features/` imports a feature, and features reach each other only
through the store or a bridge. Logic shared by two features belongs in `logic/`
(pure) or `desk/` (stateful). Within a feature, components sit beside their
`actions.ts` (handlers that call the engine), `model.ts` or `view.ts` (pure view
models) and tests.

### Why the markup matches the stylesheet

`src/styles/studio.css` is the desk's stylesheet. Components render the same
tags, ids, classes, attributes and text the selectors expect. There is no
second styling system.

### Where state lives

`src/desk/store.ts` is one Zustand store that mirrors the legacy controller's
`state` object, plus the view state the legacy code wrote straight into the DOM
(the bay headline, the live preview, the toasts and so on). Components select
narrow slices with `useDesk`. Engine code reads and writes the store through
`desk.get()` and `desk.set()`.

The engine modules in `src/desk/` (`video`, `monitor`, `jobs`, `layout`, `boot`
and others) are ports of the controller functions in `kit/studio/app.js`. They
keep the legacy names, order of effects and timings: the 700 ms job poll, the
3.2 s toast, the 160 ms busy-veil grace. Components call them from handlers, the
way the legacy `wire()` did.

Handles that should never trigger a render, such as the `<video>` elements,
AbortControllers and timers, live in `src/desk/runtime.ts`. Media elements are
uncontrolled: the engine points them at a source, exactly as before.

### Seams between regions

The Editor, the plate HTML preview, the Feedback rail, the guided-take cards and
the stage-bar sheets each own a runtime of their own. They register an
implementation in `src/desk/bridge.ts` when they mount. The engine calls through
it (`bridges.editor?.onEnter(...)`), the same way the legacy controller called
`editor?.onEnter()`.

### The network boundary

`src/api/client.ts` is the only place that calls `fetch`; ESLint fails the build
on a bare `fetch` anywhere else. Desk code goes through `api()` in
`src/desk/api.ts`, which keeps the legacy `api(path, { method, body, signal })`
signature.

## Testing

- **Icons.** `src/test/parity/parity.test.ts` checks the generated icon tables
  against `kit/lib/shared/icons.js`.
- **Unit and component.** Vitest in jsdom, Testing Library and MSW. Components
  are asserted on their markup (ids, classes, text) and on their behaviour:
  store changes, engine calls and requests.
- **Server.** A separate Vitest project in node covers `server/serve.mjs`.
- **End to end.** Playwright drives a real browser against Vite and
  `e2e/fixtures/stub-studio.ts`.

## Extending it

A new region is a directory under `src/features/`. It holds the components, any
engine helpers that write to the store, and tests beside them. Keep the markup
in the legacy vocabulary so `studio.css` styles it. Put the class rules in the
stylesheet, not in components.

The conventions the port follows:

- Strict TypeScript (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), no `any`.
- Icons are `<Icon name size />`, section icons `<SecIcon>`, empty states `<Zen>`
  (all in `src/ui/`). Where legacy built an HTML string, use `icon()` from `ui/iconString`.
- Dialogs are native `<dialog>`s opened with `showModal()`. Other features ask
  for one with `openDialog(id, open)` from the store.
- Prompts go through `ask()` (`@/desk/ask`), notices through `toast()`
  (`@/desk/toast`), and status through `setStatus()` and `setButtonBusy()`.
- `<select>`s stay plain. The global enhancer in `logic/selects.ts` adds the
  custom chrome and keeps the visible label in step with the selected option.
- A feature with its own runtime registers it in `desk/bridge.ts` on mount and
  clears it on unmount.
- Shared engine modules live in `kit/lib/shared/`. The icon tables in
  `src/ui/icons.gen.ts` stay in step with `kit/lib/shared/icons.js`.
