# Changelog

## 1.0.0-beta.10 — 2026-10-28

Agents and the desk keep narration aligned with what is on screen, and the pipeline can recover when voice lines outlive a shorter cut. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.10 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

Upgrade from 1.0.0-beta.9:

```bash
git fetch --tags && git checkout v1.0.0-beta.10
./studio
```

Your projects, brands, and `kit/.env` stay where they are. `./studio` rebuilds the desk when its sources change.

### Agents & narration

- **Screen–voice craft.** `kit/lib/narrativeCraft.mjs` teaches draft, script, narration, take-recraft, and repair passes how to split jobs across titles, captions, plates, and VO — word budgets per beat, no reading on-screen copy aloud, tone from `video.config.json`.
- **Draft hygiene.** Invalid `layout` fields on single-composition plate types are stripped during draft enrichment so plate HTML always builds; agent layout guidance names which types may carry a layout.
- **Improve & pipeline fixes.** Failed audio steps that fail because narration runs past the picture offer **Auto fix** (reset stale desk voice positions) and **Fix with AI** notes that steer the agent at `narrativeCraft` and alignment.

### Desk / editor

- **Voice vs picture.** Shared voice placement respects a shorter delivery master; the Editor voice row re-places lines with the same rules as produce. Suppressed auto-zoom skips no longer show as duplicate dashed pills beside **No zoom** zones.
- **Zoom skip semantics.** Operator-drawn no-auto-zoom zones and suppressed auto zoom are stored separately (`zone` / `suppress`) so the timeline and inspector stay honest.

### Pipeline

- **Poster pick.** One helper chooses the delivery poster frame (open plate offset, first live chapter, or safe fallback) for deliver, validate, and produce.

## 1.0.0-beta.9 — 2026-10-27

Editor Content pane and plate copy stay in sync through scrub, timeline moves, and live typing — without wiping punctuation or losing fields on save. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.9 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

Upgrade from 1.0.0-beta.8:

```bash
git fetch --tags && git checkout v1.0.0-beta.9
./studio
```

Your projects, brands, and `kit/.env` stay where they are. `./studio` rebuilds the desk when its sources change.

### Desk / editor

- **Content live paint.** Typing in the Content pane updates config and the stage iframe in place; HTML bakes when you leave the plate or scrub away, not on every keystroke.
- **Copy stability.** Colons and URLs stay intact across Content ↔ stage edit; `data-edit-raw` tracks live source so re-arming edit does not revert to stale bake attrs.
- **Path mapping.** Stats and journey plates map schema paths (`stats.N`, `steps.N`) to generic `items.N` in baked HTML so live paint and inspector sync hit the right field.
- **Save ordering.** Content POSTs serialize per plate so parallel live saves cannot clobber `video.config.json`; flush batches multiple pending fields into one request.
- **Guards.** Deck saves and Content responses respect project epoch and sequence generation after slug/sequence switches; timeline reorder and Direction rebuilds flush pending copy first.

## 1.0.0-beta.8 — 2026-10-26

Custom plate layouts, storyboard stills from the video itself, and a stage that matches the encode. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.8 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

Upgrade from 1.0.0-beta.7:

```bash
git fetch --tags && git checkout v1.0.0-beta.8
./studio
```

Your projects, brands, and `kit/.env` stay where they are. `./studio` rebuilds the desk when its sources change.

### Plates

- **Custom layouts.** A plate can use `type: "custom"` with HTML under `videos/<slug>/templates/`. Copy `kit/templates/custom.html`, keep the `data-edit` attributes and stage scaffolding, and the agent is steered away from editing shared templates.
- **Storyboard stills.** The creation stage shows JPEGs of this video's open, plates, and close — not brand samples — so what you approve is what the encode produces. Brand picker stills no longer stall job polls while ffmpeg scales them.
- **One encode, one moov.** Restyled chapter plates no longer render the same `plate-<id>.mp4` twice in parallel (two `moov` atoms, unplayable delivery).

### Desk

- **Stage matches the master.** Shared `RENDER_CSS` drops grain and the black curtain in the editor, stills, and encode the same way. Title-reveal switches retarget in place; atmosphere presence and speed tune live on the stage.
- **Lens and look.** Loupes clear when the slide or source changes instead of keeping another plate's glass. Style saves no longer flash the plate twice on every slider drag.

## 1.0.0-beta.7 — 2026-10-26

The desk is `kit/studio`. The classic desk is gone. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.7 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

Upgrade from 1.0.0-beta.6:

```bash
git fetch --tags && git checkout v1.0.0-beta.7
./studio
```

Your projects, brands, and `kit/.env` stay where they are. `./studio` rebuilds the desk when its sources change. `./studio --v2` still starts the same desk.

### Desk

- **One desk.** `./studio` serves the React desk from `kit/studio`. `--legacy` and `WALKTHROUGH_DESK=legacy` exit with a short note. A desk that cannot be installed or built stops the launcher instead of opening another UI.
- **Shared modules** the engine still imports (`easing`, voice placement, copy editing, icons, the mark, and the rest) live in `kit/lib/shared/`.

### Plates

- **Content.** Each plate type has a content schema in the inspector: records, reorder, assets, icons. Showcase and bento are new. Logos, KPI, stats, testimonials, and journey have more layouts. Timeline captions sit on the Cards row.
- **Fit.** A frame-fit pass scales a composition into the safe area on 1920×1080 and 1080×1920, and a layout pass retunes type, spacing, and motion so plates hold together in both frames.

## 1.0.0-beta.6 — 2026-10-24

The v2 desk stays responsive with many neon primary buttons and during Program playback. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.6 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio --v2
```

Upgrade from 1.0.0-beta.5:

```bash
git fetch --tags && git checkout v1.0.0-beta.6
./studio --v2
```

Your projects, brands, and `kit/.env` stay where they are. `./studio --v2` rebuilds the desk when its sources change.

### Performance

- **Neon buttons:** Pointer glow runs only while the cursor is over a brand-gradient control, coalesced to one update per frame (no document-wide `closest` on every move).
- **Program transport:** `updateTransport` skips redundant `desk.set` when the readout is unchanged, so the timeline and caption overlay re-render less often during playback.

## 1.0.0-beta.5 — 2026-10-24

Produce works again for every video without a Duplicate replay, plate text editing lands on visible copy, and close-plate steps are clickable through the atmosphere layers. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.5 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio --v2
```

Upgrade from 1.0.0-beta.4:

```bash
git fetch --tags && git checkout v1.0.0-beta.5
./studio --v2
```

Your projects, brands, and `kit/.env` stay where they are. `./studio --v2` rebuilds the desk when its sources change.

### Fixes

- **Produce:** `buildEditPlan` no longer empties every segment when a video has no Duplicate replay (1.0.0-beta.4 regression).
- **Plate text:** Click-to-edit dispatches once, pins live animation frames before edit CSS freezes motion, and ignores pointer hits on decorative bloom/grid layers so close-plate steps receive clicks.
- **Edit text:** Generic “Edit text” seeks to the plate’s best-populated frame; field clicks stay in place on the current frame.
- **Voice regen:** Neon button labels update via `neonButtonLabel` so the water/glow layer is not wiped.
- **Desk:** Creation storyboard spacing and project-name validation check alignment.

## 1.0.0-beta.4 — 2026-10-24

Plates can be staged more than one way, drafts follow one house voice, and the score is composed to cover the picture. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.4 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio --v2
```

Upgrade from 1.0.0-beta.3:

```bash
git fetch --tags && git checkout v1.0.0-beta.4
./studio --v2
```

Your projects, brands, and `kit/.env` stay where they are. `./studio --v2` rebuilds the desk when its sources change.

### Plate layouts

- Open, close, features, stats, statement, and callout plates each have more than one composition. Leave `layout` unset and the plate keeps the classic look, so older videos do not change.
- Direction → Plate layouts picks the open and close. The plate inspector's Layout row picks an interstitial. The CLI is `motion <slug> --plate <id> --layout <id|default>`.
- After a first draft, Studio fills any layout, look, or join the agent left open. The pick is seeded by the slug and title, so the same video always draws the same combination and two videos for one brand rarely match.
- `node cli.mjs rhythm <slug> [--apply]` writes `draft-rhythm.md`: camera-accent pacing, caption density, monotone joins, and layout repeats.

### On-screen copy

- Sentence case, closing punctuation, and typography are applied at render. Titles, eyebrows, and labels drop a trailing period; bodies and captions stay sentences. Script lint and the critic show the rewrite before it is saved.
- Brand and product names, acronyms, and camelCase names keep their own casing. Eyebrows read in capitals through CSS, so authored copy is never typed in all caps.
- German (and Luxembourgish) keeps capitalised nouns. Every other rule is language-neutral. Curly quotes follow the video's language.

### Music and tone

- The music bed is composed to the picture plus a short headroom, then trimmed in the mix. A bed over ten minutes is composed in parts and joined. A cached bed that no longer covers the new picture is recomposed, not looped.
- A short bed (an upload, or offline) may repeat one passage. More than one repeat needs the desk's Loop. Every repeat or silent tail is a warning in Review and in `validate`.
- Narration, plate copy, the narrator, and the music brief come from one tone profile: the video, then the brief, then the brand, then the story purpose. An explicit voice or style still wins.

### New video

- While brand discovery runs, the creator shows the harvest as files land. Pick a logo candidate and tune the palette; those picks are kept and folded in when the agent finishes the pack.
- The creation stage shows what the agent is doing, the screens explore reached, and the storyboard as the draft is written.
- Target length is a hint for the script, from 30 seconds to an hour. It is not a render format.

### Drafts and recording

- `node cli.mjs check-flow <slug>` proves `flow.mjs`, `narration.mjs`, and `video.config.json` can be recorded: syntax, config shape, ctx members, and selectors the product map never saw. Studio runs the same check after every draft and sends the agent back while it fails (up to two repairs).
- `optional(label, fn)` wraps a step the story does not depend on, such as a cookie banner or a guessed selector. A miss is logged and the take continues. A capture stall is still a failure.

### Desk

- Click a runner logo in the header to pick its model. Cursor's list comes from `agent --list-models`; Claude Code offers its aliases; any id can be typed. The choice is saved in `kit/.env` and used by every agent job.
- Duplicate (⌘D) copies the selected timeline element into the next sensible place: a section plays again after itself, an effect or card takes the next free stretch, a voice line or music ride follows its original, and a transition is applied to the next join.
- While a make step runs, its button becomes Stop. A second click waits until the job has actually settled.

## 1.0.0-beta.3 — 2026-10-24

Each chapter can place the recording in the frame, and the header says whether the master is current. Pin this tag. `main` is the development line.

Install:

```bash
git clone --branch v1.0.0-beta.3 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio --v2
```

Upgrade from 1.0.0-beta.2:

```bash
git fetch --tags && git checkout v1.0.0-beta.3
./studio --v2
```

Your projects, brands, and `kit/.env` stay where they are. `./studio --v2` rebuilds the desk when its sources change.

### Section layouts

- Each stretch between chapters can place the recording in the delivered frame: Fill, Centre, Left, Right, Top, or Bottom, at small, medium, or large. A section you leave alone keeps the video's camera default.
- Left, right, top, and bottom can show a brand text panel beside the recording. The title and body start from the chapter's own words.
- The Editor stage and the master paint that backdrop from the same HTML template, so the preview matches the render.
- When a section leaves the default frame, chapter and caption cards cover the whole output. A chapter whose title is already the side text is not painted onto the picture again.

### Render status

- Render folds out into one status chip in the header. It shows a running job, a short notice when a step finishes, a review waiting on you, or why the cut is behind: not rendered yet, needs a re-record, a plate check, or which sources changed.
- The chip stays current after every save, when you come back to the tab, and on a slow poll. Nothing else in the desk writes its own "changed, render when ready" line.

### Review and jobs

- **Use critic findings** pastes the critic's summary and the highest-severity findings into the Feedback note. Edit it, then Apply. The critic still never edits your sources.
- **Stop** waits until the cancelled job has actually exited before the next step can use the same output files, so a quick re-click no longer fails because the lock is still held.
- Stopping a recording clears the live preview at once, so a poll already in flight cannot put the frozen frame back.

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
