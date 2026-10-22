# Walkthrough engine — reference

## Kit files

| File                           | Role                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kit/cli.mjs`                  | `list`, `new`, `plates`, `analyze`, `smoke`, `record`, `produce`, `bench`, `voice`, `music`, `mix`, `audio`, `validate`, `captions`, `qc`, `deliver`, `critic`, `story`, `motion`, `edit`, `studio`, `all`, `manual`, `publish` |
| `kit/lib/analyzeFlow.mjs`      | Product map before drafting flow.mjs: DOM controls, form fields with validation + fill recipes, WebGL/canvas pointer probes → `flow-analysis.md` |
| `kit/lib/captions.mjs`         | Fitted `voice/voice.json` → SRT + WebVTT + transcript under `captions/`                                                                                                           |
| `kit/lib/pacing.mjs`           | Soft tutorial QC (dead air, WPM, long live segments, missing captions) → `qc-report.json`                                                                                          |
| `kit/lib/deliver.mjs`          | Handoff package: poster.jpg, chapters (YouTube + MD), captions, QC, `deliverables/` + README                                                                                      |
| `kit/lib/studio.mjs`           | Local Walkthrough Studio web panel (timeline, captions, QC, A/B, versions, agent)                                                                                                 |
| `kit/lib/project.mjs`          | Paths, `loadVideo(slug)` (config defaults, `$ENV` resolution, output folder, `audio` = brand ⊕ video), `loadBrand`, `loadDotEnv` (`kit/.env`), staleness                            |
| `kit/lib/audio/elevenlabs.mjs` | ElevenLabs REST (`/v1/text-to-speech/{voice}/with-timestamps`, `/v1/music`), stub implementations, `audioMode()`                                                                    |
| `kit/lib/audio/voice.mjs`      | `narration.mjs` → per-line clips (cached by hash), fitted to `timeline.json` windows → `voice/voice.json`                                                                           |
| `kit/studio/voicePlace.js`     | The voice placement rules (lead, gap, overrun, intro / outro windows) shared by `voice.mjs` and the Editor, which re-places every line on the current cut                           |
| `kit/studio/copyEdit.js`       | Plate copy as chars with an accent flag: `*source*` ↔ chars ↔ edit markup, selection offsets, accent toggle — the Editor's in-place text editing                                      |
| `kit/lib/audio/music.mjs`      | Composition plan from the segment lengths (intro / bed sections / outro) → `music/music.mp3` + `plan.json`                                                                          |
| `kit/lib/audio/mix.mjs`        | Place clips, duck the bed, two-pass loudnorm, mux onto `<slug>.mp4` (video copied) → `audio-meta.json`                                                                              |
| `kit/lib/plates.mjs`           | Fills `templates/*.html` (open, close, ten interstitial types) from config + brand → deterministic frame render                                                                      |
| `kit/lib/atmosphere.mjs`       | WebGL brand atmosphere (the core fields plus every id promoted from `atmosphereLab.mjs`) + the plate runtime (clock, `renderAt`, per-frame hooks) injected into every plate                       |
| `kit/lib/typeFit.mjs`          | Scalable plate typography — `data-fit` line budgets, floors/ceilings and groups, run before the first frame                                                                         |
| `kit/lib/narrative.mjs`        | Purpose-based story spines (overview, feature, onboarding, launch, sales), messaging rules for the agents, story checks for the critic                                              |
| `kit/lib/countUp.mjs`          | Count-up numbers for `stats` / `metric` values — parse + format shared by Node and the inlined plate runtime                                                                          |
| `kit/lib/plateMotion.mjs`      | Motion tokens (energy profiles, atmosphere, title reveal, depth, sheen) → CSS custom properties; the one list of valid ids                                                            |
| `kit/lib/motion.mjs`           | `createStory` (`chapter`, `say`), `actionStyle`, `installBrandFonts`, `startFrameRecorder` — cards filled from `liveCards.mjs`                                                                                          |
| `kit/lib/liveCards.mjs`        | Chapter/caption templates + `direction.overlays` → Studio HTML under `out/overlays/` |
| `kit/lib/liveCardBake.mjs`     | Produce bakes clean-take cards onto `live-clean` (Studio always composites for preview/edit) |
| `kit/lib/record.mjs`           | Browser + screencast lifecycle, runs `flow.mjs`, writes `live.mp4`, `timeline.json`, `live-meta.json`                                                                               |
| `kit/lib/mail.mjs`             | Mailcatcher polling and link extraction                                                                                                                                             |
| `kit/lib/focus.mjs`            | Focus ring: patches Locator actions to frame (nearest, skip if visible), settle, then ring the element (radius-matched, tracked per frame)                                           |
| `kit/lib/direction.mjs`        | Per-video five-color scale (ink, surface, accent, secondary, support) and captured logo; never grades the live UI or mutates the shared brand pack                                 |
| `kit/lib/deflash.mjs`          | Finds blank/white frames in `live.mp4` (cached in `flashes.json`) and the filter that dissolves across them                                                                         |
| `kit/lib/lens.mjs`             | Magnifier lens geometry + `geq` graph for `magnify` marks                                                                                                                           |
| `kit/lib/editDeck.mjs`         | The edit deck (`video.config.json → edit`: speed ramps, manual zooms, zoom-free windows, pinned joins) and plate `style` variables — validation, the recording→clean time map, the `setpts` speed graph, the `STYLE_GROUPS` catalog and the `<style data-plate-style>` injection |
| `kit/studio/editor.js`         | Studio Editor mode: one playback engine over the whole cut (plates stepped on their own clock, `live.mp4` with simulated speed/zoom, transitions drawn between layers), the unified timeline (clips, join markers, speed and zoom rows, drag to select / move / retime, undo), text mode, and the Inspector (plate text / look / style variables / joins; recording speed / zoom / joins / cursor & pace) |
| `kit/lib/camera.mjs`           | Auto zoom planner (`planZooms`) and its per-frame scale/crop graph, inset frame geometry, background and rounded mask (cached in `out/camera/`)                                       |
| `kit/lib/cursor.mjs`           | Presentation cursor (arrow / dot, sizes, eased arc glide played in-page, arrow → pointing-hand morph with a push-down on clicks) and keystroke keycaps                                |
| `kit/lib/exports.mjs`          | Format presets (square, vertical, lite 720p, GIF teaser) built from the master into `exports/`                                                                                       |
| `kit/lib/produce.mjs`          | Single concat encode (deflash + lenses + fades) + chapters → `<slug>.mp4`, `produce-meta.json`                                                                                      |
| `kit/lib/validate.mjs`         | QC frames, contact sheet, flash re-scan of the delivered file, `review.html`                                                                                                        |
| `kit/lib/manual.mjs`           | `collectManual()`: sets from `videos/manuals.json` + lessons (chapters with their captions, takeaways, transcript); `buildManuals()` → `tmp/videos/manuals/<set>.html` review pages |
| `kit/lib/publish.mjs`          | Copies delivered MP4s/posters to `packages/webapp/public/help/videos/` and writes `packages/webapp/src/routes/helpCenter/helpCenter.content.json` for the in-app Help Center        |
| `kit/templates/plates.css`     | Plate design system: atmosphere (bg, blobs, grid, grain, vignette, WebGL field rules), logo-part animations, rises, exits, effects layer (depth tilt, sheen, title reveals, flare, ring) |

Output folder `tmp/videos/<slug>/`: `plates/` (filled HTML; open it in a browser to preview),
`brand-open.mp4`, `brand-close.mp4`, `live.mp4`, `timeline.json`, `<slug>.mp4`,
`validate/`, `review.html`, and `smoke.mp4` from the smoke test. Env overrides: `WALKTHROUGH_OUT`,
`WALKTHROUGH_VIDEOS`, `WALKTHROUGH_BRANDS`, and `WALKTHROUGH_HOST` (the product repo; set it when the skill is
installed from a marketplace outside the checkout — `tmp/videos` lands there).

## video.config.json

| Key                 | Meaning                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`, `audience` | Metadata title (`<brand> — <title>`), the planning note                                                                                                                                                            |
| `brand`             | Folder in `kit/brands/` (or an absolute path)                                                                                                                                                                      |
| `open`              | `eyebrow`, `title` (1–3 lines), `sub`                                                                                                                                                                              |
| `close`             | `title` (lines), `steps` (2–4 `{label, note}`), optional `tagline` (defaults to `brand.platform`)                                                                                                                  |
| `chapterLabels`     | MP4 chapter names for `intro`, `start` (the live segment before chapter 1), `summary`                                                                                                                              |
| `record`            | `startUrl` (required), `viewport` (**1920×1080** Full HD by default), `slowMo` (35), `timeoutMs` (600000), optional `waitUntil`, `timezone` (IANA) and `locale` |
| `env`               | Anything the flow needs; `"$NAME"` is read from `process.env`                                                                                                                                                      |
| `manual`            | Optional `{ set, order, summary }`: lists the video as a lesson in `node cli.mjs manual`                                                                                                                           |
| `audio`             | Optional deep-merge override of the brand's `audio` block (voice, music, mix) for this video                                                                                                                       |
| `edit`              | The edit deck written by Studio's Editor / `cli.mjs edit`: `speed [{from,to,rate}]`, `zooms [{id,t,dur,zoom,x,y}]`, `zoomSkips [{from,to}]`, `lenses [{id,t,dur,x,y,w,h,zoom?}]` (target centre + area in live px), `lensOff [t]` (recorded `magnify` start times left out), `transitions {"prev>next": {style, duration}}`, `audio` (the mix desk: `music` slip/level/mute/fades/rides, `voice` per-line `at` (an absolute place on the cut), nudge/level/mute plus shape `trimStart/trimEnd/fadeIn/fadeOut` and what to speak `text/speed/take/takes`, `master` LUFS and duck), `order` (segment ids in the sequence the cut plays; the render plan permutes its slices to match). Studio's `POST …/voice/line` saves a line's desk entry and re-synthesizes that one clip in `voice/voice.json` (`regenerateLine`); `POST …/narrator` writes `audio.voice.{voiceId,name}` into the video config, which `deepMerge`s over the brand voice. Picture times are recording seconds (`live.mp4`); audio times are delivery seconds. Live slices are keyed `live` in join names |
| `open.style`, `close.style`, `interstitials[].style` | CSS variable map for one plate (`{"--gold": "#ff5a36", "--card-tilt": "20deg"}`), injected after the template's `:root` — see `STYLE_GROUPS` in `lib/editDeck.mjs` for the catalog and units                                              |
| `direction.overlays` | Live chapter/caption look: `preset` (`plateMatch` \| `editorial` \| `punchy` \| `minimal` \| `spotlight`) plus `chapter` / `caption` overrides (`atmosphere` any plate field, or `blobs` / `none`, `energy`, `sheen`, caption `seat` bottom-center\|left\|right, `maxWidth`, `align`, `backdrop`, `backdropOpacity`). `chapters.<n>.chapter` / `.caption` hold one chapter's own background trio (`atmosphere`, `backdrop`, `backdropOpacity`) for its chapter card and the captions inside it; Studio's Look & reveal saves there by default, **Apply to all chapters** promotes a chapter's trio to the video slot and clears every chapter's copy, **Follow video** drops it. New records are **clean** (cards not burned into `live.mp4`); Studio composites HTML for edit/preview; Produce bakes cards. Set `recordMode: "burned"` only to debug legacy paint-into-screencast. |

## Brand packs

Two house packs ship with the kit: `kit/brands/apptension/` (Apptension — the company and its Builder's Toolkit) and
`kit/brands/walkthrough-studio/` (this product; the default for new videos and the pack the showcase video uses).
Any other pack you discover stays local (`.gitignore` only allows those two).

`kit/brands/<name>/brand.json`:

```json
{
  "name": "Apptension",
  "platform": "Enterprise-grade software. Startup speed.",
  "font": {
    "family": "Manrope",
    "css": "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=block"
  },
  "colors": {
    "ink": "#0a0a0a",
    "surface": "#141414",
    "gold": "#fffe25",
    "amber": "#42f272",
    "teal": "#6ef0a6",
    "text": "#fafafa",
    "muted": "#a3a3a3",
    "onAccent": "#0a0a0a"
  },
  "logo": "logo.html",
  "motionBrief": "motion-brief.md",
  "sources": { "marketing": "https://apptension.com", "app": null }
}
```

`gold` → `amber` is the accent gradient (start → end). `ink`/`surface` form the dark backdrop, `teal` is the cool counter-light,
and `onAccent` is the text color on accent chips.

`motion-brief.md` is the durable creative memory for the brand (audience, tone, logo rules, motion language, audio). Agents read it before every video.

Harvest a pack from a live site (Playwright collects candidates; the signed-in agent picks the official lockup,
palette and type — no regex ranking):

```
node cli.mjs discover-brand --name Acme --url https://acme.example --app-url https://app.acme.example
```

The Studio new-video bootstrap is ordered and gated: pin brief → discover brand (harvest + agent) → validate
logo/palette/type → reload the project → draft script → review. `brand.json` starts as `placeholder: true` after
harvest and stays blocked until the agent writes a real lockup and complete role palette. Draft and plate endpoints
reject that state; Studio then refreshes the Direction foundation before continuing.

### Interstitial plates

`video.config.json → interstitials[]` inserts brand plates *before* a named live chapter:

```json
"interstitials": [
  {
    "id": "capabilities",
    "type": "features",
    "before": "Open the live app",
    "title": "Everything in one place",
    "items": [{ "label": "Scheduling", "note": "…" }]
  }
]
```

Types: `features` (3–6 icon cards), `stats` (2–4 figures, optional logo badges, count-up values),
`callout`, `testimonials` (3–8 quote cards or a 6–16 carousel), `logos` (3–10 assets from
`brands/<name>/assets/`), `journey` (3–6 first-user steps), `compare` (before/after columns, 2–5 lines
each), `quote` (one hero quote), `metric` (one number in a progress ring), `orbit` (3–8 logos circling
the lockup), `process` (3–5 numbered steps), `timeline` (3–6 dated stops on a drawn rail), `checklist`
(3–6 outcomes ticking off), `kpi` (3–6 dashboard tiles with deltas and sparklines), `statement` (one
kinetic line), `faq` (2–4 question → answer pairs), `pricing` (2–3 tiers, one featured), `team` (3–6
people or roles). The catalog lives in `lib/plateTypes.mjs`; builder, Studio, wizard, branching and the
agent prompts all read it. Produce splits the live reel at those chapter timestamps and concatenates
`open → live… → plate → live… → close`. Narration: `narration.mjs → plates: { <id>: "…" }`.

**Logo tile contrast:** `lib/logoTone.mjs` samples opaque (non-mat) pixels and sets
`data-tone="light"|"dark"` on each logo frame / stats badge — light panels for dark marks,
dark panels for near-white marks. Override per item with `bg: "light"|"dark"`.

**Scalable type (`lib/typeFit.mjs`):** every plate carries `window.__fitType()`. Elements marked
`data-fit="<lines>"` get the largest size between `data-fit-min` and `data-fit-max` (default: the
stylesheet size, so shrink-only) that keeps them inside their line budget, their own width and an
optional `data-fit-box` ancestor. `data-fit-group` makes a row settle on its smallest member (stats
values, compare column heads). Count-up values are measured at their final text. Titles balance their
lines and copy avoids one-word last lines (`text-wrap` in `plates.css`). Density is decided at build
time too: compare items step 30 → 22px with count and length, quotes widen their measure past 120
characters, logo walls balance rows (7 → 4 + 3), and short callout titles may grow to 80px.

**Testimonial type fit:** `testimonials.html` exposes `window.__fitPlate()`, which binary-searches
the largest `--q` font size whose quote still fits the card box (wide heroes start higher).
`renderOne` awaits `__fitType` and then `__fitPlate` after fonts load, so every frame uses the fitted sizes.

**Brand motion:** `lib/plateMotion.mjs` injects `--motion-*` and `--t-*` from `brand.json → motion`
(energy: calm|clear|punchy). Shared `plates.css` defaults keep logo wipes/letters alive on feature
plates. Ambient push uses `--motion-push`. The effects tokens ride the same path: `depth` →
`--card-tilt` / `--card-lift` (card enter keyframes end on `rotateX(0)`), `sheen` → `--sheen` (a `::after`
gradient sweeps once after `--s + --card-in`), `titleReveal` → `data-reveal` on interstitial titles and
per-line markup on the open plate (`cascade` = per-character `.char` spans grouped in no-wrap `.cw` words).
Overrides merge brand → `direction.motion` → `interstitials[].motion` (`mergeMotion` in `plateMotion.mjs`,
via `applyDirection` and `interstitialBrandVars`), and the merged brand is what reaches the atmosphere, so
one plate may switch field or reveal. A new `energy` brings its own profile numbers: `enterMs`-style
values pinned in `brand.json` belong to the energy that wrote them and step aside unless the override pins
them again. The Editor paints a Look pick on the live plate in the same frame — `lookVarTable` ships every
choice's CSS variables in the summary (`motionOptions.lookVars`), the plate `/motion` response carries the
resolved `look`, and the frame reloads only when the markup changed (another atmosphere shader, cascade
letters, open/close lines). A plate rebuilt while the playhead sits elsewhere is marked stale and reloads
on its next visit.
Entrances live once in `plates.css` and each plate type picks its own: `fxLand` (cards, tiles, steps,
panels — blur clears, then the tilt settles), `fxHinge` (compare columns off the centre seam),
`fxSlideL` / `fxSlideR` (compare lines), `fxDraw` (marks and the metric ring, `pathLength` 1),
`fxTravel` (orbit seats ride out along their radius), `fxPop` (icons, close dots, avatars).
Testimonials keep their own spring and float. The newer families add one signature move each on top of
those: `process` draws its rail down between ghost numerals, `timeline` draws the rail left→right with a
running head and lands each stop as it passes, `checklist` fills boxes and draws the ticks while the bar
and counter step in time, `kpi` raises sparkline bars behind count-up values, `pricing` lands the quiet
tiers first and the featured one last, `faq` slides a question in and lands its answer a beat later,
`team` pops avatars on a halo, `statement` rises word by word behind a growing accent bar and a flare. Surfaces stay on the feature-card recipe: 28px radius,
gold wash plus `surface` at ~88% on the featured panel, muted border and `surface` at ~78% on the quiet one.

**Atmosphere (`lib/atmosphere.mjs`):** one fragment shader per field over a full-screen quad, time from
the plate clock (a 1 px Web Animation on `.plate-clock`), uniforms from the five-colour scale plus
`uOpacity`, `uDrift`, `uEnv` (an in/out envelope that fades the field over the first 0.9 s and dims it
through the black-out). Shaders write straight alpha; the canvas is `premultipliedAlpha: true`, so the
draw blends with `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)` over a
cleared buffer — colour gets premultiplied, alpha is written as-is (plain `SRC_ALPHA` on the alpha channel
squares it and the field vanishes). A `contentDim` term keeps the field quiet where the copy sits. The
field canvas replaces the CSS `.grid` and widens `.bg` so no centre oval shows through.

**Plate runtime:** `window.__plateRuntime = { field, renderAt(ms), hook(fn) }` (alias `__plateField`).
`renderOne` calls `renderAt(t)` after setting every animation's `currentTime`, so JS-driven effects are
as deterministic as CSS ones. `hook(fn)` registers per-frame callbacks — `countUp.mjs` uses it to tick
`[data-count]` elements (`data-count-start`, `data-count-dur`) from zero to their own text, keeping
prefix / suffix / grouping / decimals; the final frame writes the original string back. Studio's live
preview runs the same runtime from `requestAnimationFrame` while animations are playing.

**Plate render cache + motion QC (pipeline v16):** HTML is written only when content changes. Each
MP4 stores `<name>.render.json` with the HTML hash, the `plates.css` hash, JPEG quality, raster
backend, `msPerFrame`, hold window, snap/reuse counts, and `qc`. A plate is skipped when those match
and `qc.ok` is true. `video.config.json` mtime is not a key, so an Editor save that only touches
`edit.*` redraws no plates. A capture-path change bumps `RENDER_PIPELINE`.

Settle-hold (`--hold-from` / `--hold-until`, or a short pre-blackout default) reuses one JPEG only
after a **probe**: sample Web Animations progress across the window, shrink to the longest stable
run, then confirm start/mid/end pixels are identical. If anything still moves, hold is disabled.
`--hold-from: 0; --hold-until: 0` forces full-frame capture (open plate).

During encode, paint-stall detection retries when animations advance but pixels do not; repeated
stalls fail QC. Capture is 2× raster → 1080p JPEG q95 → x264 CRF 4 @ 30fps (near-lossless intermediate, still browser-playable for Studio). Encoder `abort()`
kills ffmpeg if a frame fails. Studio surfaces plate QC on the Render bay and plate picker.

**Critic / suggest-plates:** `lib/critic.mjs` + `lib/suggestPlates.mjs` — see SKILL workflow. Both read
the story spine (`lib/narrative.mjs`); the critic report carries `purpose` and a "Story spine" section.

**Type-fit probe:** `renderOne` seeks to the settled frame before encoding and records every `data-fit`
element's fitted size (`typeFit.fitted[] {el, px, base, atFloor}`) plus anything that still clips
(`typeFit.clipped[]`) in `.render.json`. Clips print `» plate · … · type · N element(s) clip — shorten the
copy` and surface in Studio (plate picker note + "Copy too long" banner); encode QC stays green.

**Live pace:** `lib/direction.mjs` `PACE_PRESETS` / `resolvePace` / `normalizePace` (stored on
`direction.pace`, patched through `patchDirection` by Studio and CLI). `recordLive` builds `hold(ms) =
wait(ms / tempo)` and hands it to the flow as `wait`; `createStory` and `createCursor` receive a `tempo()`
getter for caption/chapter minimums and glide speed; `slowMo` divides by it; `ctx.pace()` shifts it
mid-flow and leaves a `pace` mark. Narration holds are tallied into `live-meta.json → pace`
(`narrationHoldSec`, `narrationHoldShare`), printed after the take and raised by `runPacingQc` as
`narration-bound`. `record --pace` overrides for one take.

**Motion tokens:** `lib/plateMotion.mjs` — `resolveMotion(brand)` merges `brand.json → motion` with
`direction.motion`; `patchMotion(current, patch)` is the one validator for `POST /motion`,
`POST /plates/:id/motion` and `cli.mjs motion` (enums, 0–1 presence, 0.3–3 speed, `null` clears a key);
`motionOverrides(m)` lists the accent keys a plate overrides.

**Studio + versions:** `node cli.mjs studio [slug]` serves `kit/studio/` with APIs in `lib/studio.mjs`.
Timeline seek, chapter strip, live captions overlay, QC panel, A/B compare, and handoff controls.
`lib/versions.mjs` keeps a numbered history (`v1`, `v2`…) with human titles. **Releases** (Render
finish, Save version, CLI) show by default; **checkpoints** (auto after produce / mix) are optional.
Each entry stores delivery + captions/deliverables + sources. Restore rewrites sources; regenerate
restores then produce.
`lib/agentRunner.mjs` runs Cursor CLI `agent -p --trust --workspace <repo>` for narration/plates/motion/critic
improves; if `agent` is missing, a prompt file is saved under `tmp/videos/<slug>/studio-jobs/`.
Claude Code (`claude -p --output-format stream-json --verbose --include-partial-messages`) runs instead when
`WALKTHROUGH_AGENT=claude`, or when the Cursor CLI is not signed in.
**Live agent stream:** both agents run with partial output. `lib/agentStream.mjs` folds both JSON shapes, and every kit step's
lines, into one ordered `job.stream` of entries (`think`, `say`, `tool`, `line`, `error`, `system`). It keeps the full
text, merges deltas, and drops the full message each agent repeats after its deltas. `studio/agentStream.js` is the
one renderer, used in the render bay, the session rail, the script draft banner and the new-video wizard. It types new
characters in, catches up on a backlog within about half a second, keeps the feed pinned to the newest entry unless
the reader scrolls up, and never truncates.
**Smart-scope feedback:** the main Feedback action is whole-video capable. The agent infers the smallest sufficient
scope across story/flow, narration, video-local brand direction, pacing, plates, voice and mix. A broad note may
coordinate domains; naming a plate, scene, narration key, timestamp or setting makes the edit surgical. Merely
viewing a plate never pins a general note to it. Script, Voice, Plates and Brand & motion remain available as explicit
forced scopes. Studio snapshots config, narration and flow, detects the domains actually changed, rebuilds only the
relevant live preview, presents those domains in the approval tray, and restores all snapshotted sources on Discard.
Per-video feedback must write brand/audio overrides to `video.config.json`; it must never mutate the shared brand pack.

**Handoff:** `node cli.mjs deliver <slug>` writes `poster.jpg`, `captions/*`, `chapters-youtube.txt`,
`qc-report.json`, and a flat `deliverables/` folder with README + manifest ready to zip or upload.

`logo.html` is inlined into open/close plates. Prefer the official SVG/PNG from the site or app — never invent a mark.
For the full build animation, use an inline SVG whose parts carry these classes:

| Class                                                            | Animation                                                     | Timing var                |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| `piece wipe-l`                                                   | wipes in from the left                                        | `--t-wipe-l`              |
| `piece wipe-r`                                                   | wipes in from the right                                       | `--t-wipe-r`              |
| `piece draw` (path with `pathLength="1"`)                        | stroke draws, then fills with `--text`                        | `--t-draw`                |
| `piece letter` + `style="--i:N; --lx:±px"`                       | letters track in, staggered                                   | `--t-word`                |
| `piece trace` (paths with `pathLength="1"`) + `style="--px:0–1"` | outline traces, then fills, staggered left to right by `--px` | `--t-trace`, `--t-travel` |
| `rect.sweep` inside `<g clip-path="url(#logo-clip)">`            | light sweep across the mark                                   | `--t-sweep`               |

Fallback for a raster or simple logo: `<img class="logo-img" src="data:image/svg+xml;base64,…">` gets a masked wipe with a blur-in.
Logos must read on a dark background.

## Plate rendering

```js
document.getAnimations().forEach((a) => a.pause());
for (f of frames) {
  document.getAnimations().forEach((a) => (a.currentTime = (f * 1000) / 30));
  png = await page.screenshot({ type: 'png' }); // viewport 1920×1080, DSF 2
}
```

ffmpeg: `image2pipe -c:v png` → `scale=W:H:flags=lanczos+accurate_rnd+full_chroma_int` → x264 slow crf 10 `-tune grain`.
Plates re-render only when the config, the brand pack, the templates or `plates.mjs` are newer than the MP4 (`--force` overrides).
After `currentTime` is set, `renderOne` steps the plate runtime (`__plateRuntime.renderAt(t)`) so the WebGL
atmosphere and count-ups draw the same frame. `RENDER_PIPELINE` 14 introduced the atmosphere engine and the
effects layer, 15 the shared type fit; bump it whenever capture, shader or runtime behaviour changes so cached plates rebuild.

CSS rule for an entrance and an exit on one element: put the exit on a **wrapper** (`.lockup-exit`, `.copy-exit`) and the entrance on the child.
Two animations on the same property fight.

## Live capture

```js
recorder.begin(startedAt);
await page.screencast.start({
  size: viewport,
  quality: 100,
  onFrame: (f) => recorder.onFrame(f),
});
// … flow(ctx) …
await page.screencast.stop();
await recorder.finish(endedAt); // { frames, seconds }; must match wall time (smoke checks drift)
```

| Screencast behaviour                                                                            | Consequence                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frames are emitted only on pixel change                                                         | Each JPEG is placed by `timestamp` and repeated across gaps, giving a true constant 30 fps                                                                                                                                                                                                                                                                                  |
| Frame size is capped at the viewport                                                            | Default `deviceScaleFactor: 2` antialiases text UIs; set `record.deviceScaleFactor: 1` for WebGL/3D so the compositor keeps distinct FPS (encode quality stays JPEG q100 → lossless x264)                                                                                                                                                                                        |
| `screencast.showOverlay` re-injects overlays into every new document, replaying their entrances | Captions and chapter cards use `lib/overlays.mjs` instead: a shadow-root layer whose CSS delays are `calc(Xs - var(--el))`, mounted with the elapsed time, so a navigation resumes them mid-animation. One caption at a time: a new `say` retires the one on screen (0.45 s exit) and enters 0.3 s behind it. `chapter` blocks for its duration; `say` returns after 0.95 s |
| `backdrop-filter` doesn't render in overlays                                                    | Near-opaque surfaces only                                                                                                                                                                                                                                                                                                                                                   |
| Overlay fonts fall back to serif                                                                | `installBrandFonts` injects the brand font into every document                                                                                                                                                                                                                                                                                                              |
| Locator titles are shown by default                                                             | `actionStyle(brand).style.title` hides them                                                                                                                                                                                                                                                                                                                                 |
| The pointer decoration animates between actions (~0.35 s each)                                  | Wrap free-hand input (signature strokes, drags) in `ctx.actions.hide()` … `ctx.actions.show()`                                                                                                                                                                                                                                                                              |
| `html{zoom}` scales `getBoundingClientRect` but not canvas pointer math                         | On a zoomed page, divide pointer offsets from a canvas corner by the zoom                                                                                                                                                                                                                                                                                                   |
| Every CDP call queues behind the screencast's frames (~0.5 s per `mouse.move` at 57 fps)         | The presentation cursor animates its glide in the page on `requestAnimationFrame` in one `evaluate`, then makes one real `mouse.move` to land the pointer. A step-wise `mouse.move` glide would stretch a 15 s flow to almost 2 minutes                                                                                                                                     |
| Host CSS restyles `kbd`                                                                         | Keycaps are `span.wt-key` with `all: initial`                                                                                                                                                                                                                                                                                                                                 |

**Camera (clean pass).** `direction.camera` is applied while `live-clean.mp4` is built, so it costs one lossless pass
and no extra lossy generation. Order: deflash → auto zoom → lenses → inset frame. Auto zoom is a per-frame
`scale=…:eval=frame` (lanczos, BT.709 in and out) followed by `crop=W:H:x(t):y(t):exact=1`; crop's `iw` goes stale when
the input size changes per frame, so every offset is written as an explicit expression of `t`. Easing is smootherstep
(in 0.75 s, pan 0.65 s, out 0.85 s, hold 1.6 s after the last click). Zoom is 1.3× (subtle) or 1.65× (bold), and
the centre is clamped so the crop never leaves the frame. `ctx.zoom(locator)` emits an explicit `zoom` mark and works
even when automatic click zoom is off; nearby automatic shots yield to it. Shots never overlap a chapter card,
caption or lens. The inset frame overlays the take at tight (95%), balanced (90%) or roomy (82%) scale, with square,
soft (22 px) or round (42 px) corners and off/soft/deep shadow, on a looped background PNG (gradient from the color
scale plus accent glow) through a cached `geq` rounded mask. The cleaned reel's cache stamp includes camera inputs
only when they are set, so a video with camera off keeps its cache.

**Capture polish.** The page-side arrow/dot cursor owns its own compositor animation, click ripple and 1.5 s idle
timer. Clicks read as clicks: before a press action the recorder calls `cursor.arm()`, which morphs the arrow into a
pointing hand in the page and holds ~160 ms (÷ pace) so the change is on screen; the real `mousedown` then plays a
0.38 s push-down keyframe on the glyph plus the ripple; after the action `cursor.release()` keeps the hand ~340 ms and
eases back to the arrow (a following click cancels the release). `direction.cursor.hand` switches it — on for the
arrow, off for the dot unless set (`direction --hand on|off`, Studio → Direction → Hand on click). The hand's fingertip
sits on the hotspot, so the morph never moves the pointer. `cursor.loop` returns it to the opening seat before capture ends. `ctx.privacy.mask(locator)` inserts a fixed,
adaptive solid cover that follows the locator on each animation frame and is recorded instead of the sensitive source
pixels; backdrop blur is intentionally not used because Chromium screencast does not paint it reliably.

**Formats (`export`).** Square and vertical put the master in a rounded window on the brand background; lite is a
lanczos scale; video variants use the `variant` floor in `encode.mjs` (CRF ≤ 16, preset medium or slower, audio copied).
The GIF is 10 s from the first live chapter at 12 fps through `palettegen stats_mode=diff` and `sierra2_4a` dithering.
`deliver` copies only exports newer than the master. Burned-in captions are not offered: the Homebrew ffmpeg build has
neither `subtitles` (libass) nor `drawtext` (freetype); the SRT/VTT sidecars cover captions.

**Studio interaction.** Direction has a CSS-only 16:9 look preview and four built-in, video-local presets; no preview
ever grades the product. Deliver's Reel safe-area overlay visualizes the top, side and bottom controls that Instagram
or TikTok place over a 9:16 video. The global ⌘K command menu filters navigation and pipeline actions client-side.

## Delivery encode

```
[open] ─xfade─ [live slice] ─xfade─ [plate] ─xfade─ [live slice] … ─xfade─ [close]
fade up from black 0.6s at the head · fade out 0.8s at the tail · x264
-preset medium -crf 12 -x264-params aq-mode=3:aq-strength=0.9:deblock=-1,-1
-profile:v high -level 4.2 -pix_fmt yuv420p -g 60 -bf 2
-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv
-movflags +faststart -map_chapters <ffmetadata>
```

Live segments are read straight from `live-clean.mp4` with a frame-accurate input seek (`-ss … -t … -i`), so there
are no intermediate slice files. `live.mp4` and `live-clean.mp4` are lossless x264 (`ultrafast -qp 0`, faster than a
lossy preset; only ffmpeg reads them) and plates are near-lossless CRF 4, so the delivery encode is the one lossy
generation after the browser's JPEG. Those numbers live in `lib/encode.mjs`. Each ffmpeg spawn checks them first and
throws if a pass is softer (CRF above 12, a lossy intermediate, `-tune animation`, or a second encode while muxing
audio), and `validate` fails an older master until it is produced again. `node --test kit/lib/encode.test.mjs` guards
the floor. Colour: every pass (take, plates, clean, master) converts to BT.709 limited range with `toBt709()` and tags
it with `BT709_TAGS`. Chromium JPEGs are BT.601 full range; a bare `format=yuv420p` keeps the 601 matrix, players decode
HD as 709, and saturated UI colours drift green by up to 20 levels. The input matrix is read from each frame's tags, so
older takes are corrected when produce runs. Stills (QC frames, poster) are full-range BT.601 4:4:4 JPEG q1. `live-clean.mp4` is rebuilt only
when the take, its flash repairs, its lenses, or the card-bake stamp change. Both encodes report progress (`-progress pipe:1`), which
Studio shows as `» live · 42% · …` and `» encode · 56% · 1:53 of 3:21 · about 0:17 left`.

Plates are captured with Chromium on Metal with GPU rasterization (`RENDER_PIPELINE` 16): JPEG q95 via
`Page.captureScreenshot` at 1920×1080, two plates at a time (`WALKTHROUGH_PLATE_JOBS` can raise that to 4).
The capture forces a compositor frame, so the per-frame double `requestAnimationFrame` is gone; the one-shot
type-fit wait stays. A live atmosphere (`.plate-field` with a field other than `none`) skips the hold probe,
because that field never settles. `HeadlessExperimental.beginFrame` is a dead end on Playwright's Chromium
156 headless shell: with `--enable-begin-frame-control` the page target closes before the first frame.
The schedule field's sine hash differs slightly between GPU and software, so the same plate lays out its
background bars differently on each backend. Within one backend the render is deterministic.

**Card bake.** Clean-take cards are PNG-in-MOV with alpha. Captions are muxed with `-c:v copy`.
Chapter cards are encoded with `-c:v png`: a stream-copied full frame deadlocks ffmpeg's scheduler
on the second chapter.
The bake browser uses the same Metal flags as plates, four pages at a time (`WALKTHROUGH_BAKE_JOBS`).
Chapter cards stay full frame. Captions are cropped to the card's box plus a 64 px margin and overlaid at
that origin. Each clip has a `<name>.json` content key (html, overlays.css, motion, time, duration,
pipeline, raster). mtime does not invalidate a clip. Every plan carries that key and the clean-pass stamp hashes it, so a
card whose html changed at the same path and time (copy, a per-chapter backdrop) re-runs the clean pass. `produce` draws plates and bakes together, then the
clean pass. `live-clean.mp4` is lossless and has no `+faststart` (only ffmpeg reads it); the delivery
master keeps faststart. `produce-meta.json → timing` records plates, cards, clean and encode seconds, plus
the previous run. `node cli.mjs bench <slug>` prints that table, each plate's `msPerFrame`, and each bake
clip's seconds. Studio starts the plate job beside a re-record, because plates do not read the take.

**QC grabs.** `validate` seeks with `-ss` before `-i`. The frame matches an output-side seek and the grab
finishes in a fraction of the time. Version snapshots copy with `COPYFILE_FICLONE`, so the three checkpoints
per render stay and cost a clone instead of a full write.

**Edit plan (`lib/edit.mjs`).** Every join is an overlapping `xfade`, never a cut through black. `buildEditPlan`
gives each segment `at` (its start in the delivery), `dur`, `transitionIn { type, xfade, dur, card? }` and `padOut`;
`produce`, `audio`, `validate` and Studio all read the same plan (`edit-plan.json`, `produce-meta.json → edit`).

| Rule | Why |
| --- | --- |
| Plates render without `.black` (`RENDER_PIPELINE` 9) | The fade to black was baked into the plate; joins now come from the edit |
| A plate's outgoing dissolve starts after `--black-out` + 0.32 s; a short clean tail is extended with `tpad` (`padOut`) | No double exposure of exiting copy over the next shot |
| A live slice after a plate starts at its chapter card + 0.48 s | Plate → card is a dissolve between two designed frames, not into a half-loaded page |
| A live slice that cuts to a plate is trimmed before a late scene change (`scdet` ≥ 20 in the last 1.2 s, cached in `edit-trims.json`) | The edit never dissolves out of a blank loading page |
| Join length is capped at a third of either neighbour | Short slices keep their content on screen |

Transition style comes from `brand.motion.transitions`, overridden by `video.config.json → transitions`
(`{ "style": "directed" | "dissolve" | "wipe" | "push" | "zoom" | "iris" | "blur" | "dip" | "radial" | "slice" |
"diagonal", "duration": 0.2–1.2 }`; Studio → Direction). `directed` is the default and chooses by edit intent:
open→live zooms, live→proof plate wipes, plate→live dissolves, and the close dips. A chosen single motif maps to
ffmpeg `fade`, `smoothleft`, `slideleft`, `zoomin`, `circleopen`, `hblur`, `fadeblack`, `radial`, `hlslice`, or
`diagtl`. Joins onto a chapter card remain a dissolve unless the selected join is a dip.

The final time of a live mark comes from `liveToDelivery` in the edit plan (segment `at` + offset into the slice).

**Edit deck (`lib/editDeck.mjs`).** `video.config.json → edit` is resolved once per produce (`resolveEdit`) and
recorded in `produce-meta.json → editDeck`; Studio compares the compacted deck with that record to show the stale
banner. Everything in the deck is in the recording's clock. Speed ramps become one `setpts` expression (nested `if`
over `T`, then `fps=FPS`) appended as the **last** node of the clean pass, so deflash, zoom, lens and frame all keep
working on recording time and only the output clock changes; `liveTimeMap` (pieces → `toClean` / `fromClean`) then
moves every timeline mark, chapter and caption into the cleaned clock before `buildEditPlan` runs. Manual zooms
enter `planZooms` as `source: 'edit'` marks (same smootherstep easing as click zooms); `zoomSkips` add `nozoom`
blocked windows so an auto shot can be replaced by an editable one. `resolveLenses(timeline, deck)` is the list the
lens pass renders — recorded `magnify` marks not in `lensOff` plus the deck's lenses as `magnify` marks — and
`withEditLenses` feeds the same list to `planZooms`, so auto zoom keeps clear of exactly the lenses that render. Studio's
deck payload carries each resolved lens with its `lensGeometry` (zoom, diameter, S), and the Editor's canvas loupe uses
those numbers with the same iris curve, so the stage preview and the render agree. With `camera.frame: inset`
the stage also previews the frame (`insetGeometry` rect and radius over the brand backdrop). Pinned joins are looked up by `prev>next` key
(`joinKey`, live slices collapse to `live`) and set `transitionIn.pinned`. The clean cache key is the whole filter
graph, so a changed ramp or zoom rebuilds `live-clean.mp4` (camera is part of the clean pass); a pinned join only
changes the delivery encode, and a plate `style` change re-renders only that plate.

**Deflash.** Page loads and email views flash white or blank for a few frames. `deflash.mjs` measures luma entropy and
brightness per frame: a flat run (entropy < 0.012) always counts, and a near-flat run (< 0.15) counts when it is a
brightness spike above its neighbours (a blank page with only a toast on it). Runs up to 3 s are replaced with a
smoothstep dissolve between the frame before and the frame after (`freezeframes` + `blend`, enabled only inside the
gap), inside the same delivery encode. `validate` re-scans the final file and exits non-zero on any blank run that is
not a plate join.

**Lens.** Each `magnify` / `follow` mark adds `-ss t -t dur -i live.mp4`: a frame-evaluated crop follows the
recorded DOM-target path → lanczos scale (zoom 1.5–2.4, diameter 300–540 px) → `geq` iris (expo open 0.5 s,
cubic close 0.38 s), brand-accent rim, glass sheen and shadow → a matching moving overlay. `follow()` drives the
real pointer along the same path; Direction can choose Guided lens, static Spotlight, or Focus ring.

## Audio

### Voice (ElevenLabs Eleven v4, verified Oct 2026)

- `model_id: eleven_v4`, `POST /v1/text-to-speech/{voice_id}/with-timestamps` → `audio_base64` + character
  `alignment` (saved next to each clip). `voice_settings`: `stability`, `similarity_boost`, `style`,
  `use_speaker_boost`, `speed` (0.7–1.2). Pauses are ellipses; delivery is steered with inline audio tags
  (`[warm]`, `[whispers]`); SSML `<break>` is not supported. IPA in double quotes is read as pronunciation —
  `pronunciations` in the brand does this per word.
- Default brand voice is **Matilda** (`XrExE9yKIg1WjnnlVkGX`, premade, warm/clear). Alternatives for register:
  Brian `nPczCjzI2devNBz1zQrb`, George `JBFqnCBsd6RMkjVDRZzb`, Sarah `EXAVITQu4vr4xnSDxMaL`,
  Brian `nPczCjzI2devNBz1zQrb` (deep / energetic — used by Walkthrough Studio).
  Chris `iP95p4xoKVk53GoZ812B` is retired on many keys (`voice_not_found`); prefer Brian.
- Each line is prefixed with `voice.direction` (a tag, e.g. `[warm, confident narration]`; it costs ~0.2 s and is not
  spoken; avoid "unhurried", which slows every line) and cached in the shared `tmp/videos/.cache/voice/` as
  `<hash>.mp3` + `.norm.wav` (edge silence trimmed to 40 ms / 120 ms, then loudnorm to `mix.voiceLufs`, −2 dBTP). Hash
  covers text, voice id, model, settings, speed and mode, so edits re-synthesize only the changed line, and a re-take
  costs nothing. Each run logs `ElevenLabs: N new clip(s), C characters`.
- **Fitting**: a line's window starts `LEAD` after its mark (caption 0.3 s, chapter 0.9 s) and ends at the next mark that
  has a line (or the live end). Lines are placed in order, ≥ 0.45 s apart. When a clip exceeds its window + 1.2 s the
  fitter time-stretches the cached clip locally (`atempo`, pitch kept) if the total speed stays ≤ `maxFitSpeed` (1.15);
  otherwise it notes `long by` — rewrite the line.
- **Pacing at record time**: `record` loads the same cache (`narrationDurations`, synthesizing any missing line) and
  hands it to the story layer. `say`/`chapter` then hold before the next card until the previous line + 0.45 s gap has
  passed (logged as `hold Ns before "<title>"` marks, kind `hold`; a card without a line of its own never holds — the previous line covers it), keep a card up for at least its line, and `settle()`
  lets the last line finish before the live end. Scripted `ms` values stay as minimums. Result: the same cut on a fast or
  a loaded machine and no fits. Without narration or a key, steps keep their scripted times.
- **Capture health**: `record` prints distinct fps and the median/p95/max gap between screencast frames. A starved
  browser (parallel recordings) shows as low distinct fps and large p95; the fix is a quiet re-take, not post work.
- `WALKTHROUGH_AUDIO_OFFLINE=1` forbids every API call: a missing clip or track fails instead of being bought.
- PAYG pricing (Oct 2026): $0.08 / 1k characters; Creator $22 / mo includes 100k characters and commercial rights.

### Music (Eleven Music)

- `POST /v1/music?output_format=mp3_44100_128` with `model_id: music_v2_5` and a `composition_plan`
  (`chunks[].{text, duration_ms 3000–120000, positive_styles, negative_styles, context_adherence}`; ≤ 30 chunks, ≤ 10 min).
  `force_instrumental` exists only in prompt mode, so every chunk carries `instrumental` / `no vocals` in its styles.
- `music.mjs` builds the plan from `produce-meta.json`: intro = open plate + 2 s, bed split into ≤ 110 s sections, outro =
  close plate + 2 s, plus a 1 s tail; the result is longer than the picture and trimmed in the mix, never stretched.
  $0.15 / generated minute.
- **Composed once.** A re-take with the same music style reuses `music/music.mp3` when the length changed by ≤ 50 %:
  the mix cuts (shorter take) or repeats (longer take) the difference at the middle of the demo bed with a 2 s
  equal-power crossfade, where the music sits ducked, so the intro and outro stay locked to the plates. A style change
  or `music --force` recomposes.

### Mix (ffmpeg)

```
clips  → aresample 48k · stereo · highpass 70 Hz · adelay(start) → amix(normalize=0) → [vo]
music  → loudnorm to plateLufs (cached wav) · slip by edit.audio.music.offset · atrim(total)
         · afade from the desk (default in 1.2 / out 2.6)
         · volume envelope: plate level outside the demo, bed level inside, 1 s ramps, × rides × music gain → [mus]
voice   → each clip atrim(trimStart … full − trimEnd) · afade in/out from the desk · nudged, gained and (if muted) dropped before adelay
[mus] + [vo] key → sidechaincompress (ratio from the desk, else the brand) → [duck]
`edit.audio.master` replaces voice/plate/bed/target LUFS, true peak and the duck ratio before any of this.
The Editor previews the same curve (`studio/mixMath.js`) while Sound is on. `audio-meta.json → desk` is what the last mix used.

**Voice follows the cut.** Lines are placed in windows (`studio/voicePlace.js`): intro after the open lockup, a
caption or chapter line from its mark until the next lined mark, a plate line after the plate settles, the outro
before the close fades; each line starts a breath (`VOICE_GAP`) after the previous one ends and may run
`VOICE_OVERRUN` past its window. A speed ramp or trim moves every mark, so the Editor runs the same rules on the
current cut (`projectAudio` in `editor.js`) and paints the result: a dashed pill is a line that moves on the next
render (the tooltip and the inspector say where the mix has it), an amber pill runs past its window, and the
inspector flags a line that starts more than 1.5 s after its cue. Music rides are clamped to the cut's length.
[vo] + [duck] → amix(normalize=0) → premaster.wav → loudnorm 2-pass linear I=-14 TP=-1 LRA=11 → master.wav
mux: -c:v copy -c:a aac 192k 48 kHz -map_metadata 0 -map_chapters 0 +faststart
```

Levels (brand `audio.mix`): voice −16 LUFS, music −20 LUFS on the plates, −31 LUFS under the demo, master −14 LUFS /
−1 dBTP (web/social delivery standard). The first mix renames the produced file to `<slug>.silent.mp4` and keeps it as
the video-only source, so `mix` can run again without re-encoding; `produce` deletes it.

### Stub mode

`WALKTHROUGH_AUDIO_STUB=1` swaps ElevenLabs for macOS `say -v Samantha` and a synthesized pad with the same file
layout, so fitting and the mix can be checked without credits. Speech rate is close to Matilda's but not equal;
re-check `voice.json` after the live pass. `audioMode()` returns `stub` | `live` | `missing-key`; `all` skips audio
(with a message) when the key is missing.

## Dependencies

- ffmpeg/ffprobe with libx264 and libmp3lame (`aac` built in); `say` for stub mode (macOS)
- `ELEVENLABS_API_KEY` in `kit/.env` or the shell
- Node 20+; Playwright ≥ 1.64 (`kit/package.json`; Screencast API with `onFrame`)
- Network access to the brand font CSS
- The app under test running locally (plus a worker and a mail catcher when the story sends email)
