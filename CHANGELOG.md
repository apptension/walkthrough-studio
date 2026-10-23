# Changelog

## 1.0.0-beta.2 — 2026-10-23

The desk is rebuilt in React and TypeScript and is now the default. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.2 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

Upgrade from 1.0.0-beta.1:

```bash
git fetch --tags && git checkout v1.0.0-beta.2
./studio
```

### The new desk

- `./studio` serves the new desk (`kit/studio-next`) on the same address, http://127.0.0.1:4747. Bookmarks and `?slug=` links keep working, and panel widths, timeline height, and take choices carry over.
- `./studio` installs the desk's packages when its lockfile changes and rebuilds it when its sources change. The first launch adds a few seconds. After a `git pull`, nothing else is needed.
- The desk keeps the classic desk's markup, copy, and behaviour, and talks to the same server over the same API. A parity suite runs both side by side and fails on drift.
- Fold either side panel, or the timeline, by dragging its splitter past the edge. An edge tab brings it back.
- Panel sections (Review, Deliver, Media and others) collapse and remember how you left them.
- The sequence picker groups branches under their overview with a connector, and flags projects that still need setup.
- The playhead is a needle with a grip. Hovering the timeline shows where a click lands, and it snaps to chapter starts.
- Help tips, the queue menu, and plate tools share one floating card. Zoom, magnifier, and copy editing share one on-stage panel.
- `./studio --dev` runs the desk on Vite with hot reload (`--ui-port`, default 4748).

### Retiring the classic desk

- `./studio --legacy` (or `WALKTHROUGH_DESK=legacy`) opens the classic desk in `kit/studio`. It will be removed in a later release, so please open an issue if something only works there.
- If the new desk can't be installed or built, `./studio` explains why and opens the classic desk instead of failing. `node cli.mjs studio` serves the classic desk until `kit/studio-next/dist` exists.
- `./studio --v2` still works. The new desk is now the default, so the flag isn't needed.

### Plates and review

- Six new title reveals: Focus and Veil, plus four WebGL masks in brand colors (Ink, Slit, Iris, Embers). The type stays crisp and editable, and every reveal is stepped on the plate clock, so the Editor preview matches the render. Open, statement, and close plates now honour the reveal too.
- **Run critic** can hand the cut to the agent. It watches the narration, timeline, and frame stills and writes a scored review with concrete fixes. Agent findings lead, and rule findings stay where the agent did not cover the same target. The critic never edits sources.

### Reliability

- **Stop** now ends the whole job: the agent or kit step, plus the Chromium and ffmpeg processes it started. Escalation to a kill signal fires when a process ignores the first one, and the job's output locks are released at once.
- The live preview no longer freezes on a click that navigates. Stalled frame grabs are abandoned and restarted, and frames are published by rename, so the monitor never shows a torn frame.
- Capture shutdown (cursor overlay, screencast, encoder flush, session save) runs every step under a deadline with a log line, so one hung call can't freeze the job.
- Script edits that would break `flow.mjs` are rejected with the syntax error, and nothing is saved. Removing a line no longer leaves a stray `await` behind.
- Changing a video's purpose no longer brings back the old value.
- When a port is busy, `./studio` names the process holding it and offers to stop it or pick another port.

## 1.0.0-beta.1 — 2026-10-23

First public beta. Pin this tag. `main` is the development line and will move ahead of it.

Install:

```bash
git clone --branch v1.0.0-beta.1 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

`./studio` checks Node 20+, npm 11.17+, ffmpeg, and Chromium, then opens Studio at http://127.0.0.1:4747. Voice and music need an `ELEVENLABS_API_KEY` in `kit/.env`. Agent jobs need a signed-in Cursor CLI or Claude Code. Capture, renders, and the master stay on your machine.

This beta includes the desk as documented in the README, plus:

- Camera moves use a 180° shutter. Holds, and frames outside a move, stay bit-identical.
- A zoom join is a lanczos cross zoom, not ffmpeg's nearest-neighbor `zoomin`.
- Dissolves and deflash no longer speckle from registers shared across frame threads.
- Narration that runs past the picture holds the last frame, up to 6 seconds. Longer overruns still fail and name the line.
- A guided recording asks before the window would shrink to fit the screen.
- After you show a tour, the take choice says which path continues.
