---
name: product-walkthrough-video
description: >-
  Produce a client-facing, branded product walkthrough MP4 for any feature or
  business area: frame-rendered brand opening/closing, a live Playwright
  screencast of the real app with chapter cards and captions, and a
  single-encode delivery master with chapters. Use when the user asks for a
  demo video, walkthrough, explainer, tutorial or onboarding recording,
  feature showcase, or motion design for a product video.
---

# Product Walkthrough Video

Everything lives in this folder and is portable: copy it to another repo's
`.cursor/skills/` and it works there (see "Use in another project").

```
product-walkthrough-video/
├── SKILL.md            ← this file: workflow + hard rules
├── authoring.md        ← how to plan a video: story, copy, flow patterns, selectors
├── pipeline.md         ← engine reference: rendering, capture, encode, gotchas
├── kit/                ← the engine (do not fork per video)
│   ├── cli.mjs         ← single entry point
│   ├── lib/            ← motion, plates, record, produce, validate, mail, audio/ (voice, music, mix)
│   ├── templates/      ← plate HTML/CSS + new-video scaffold
│   ├── brands/<name>/  ← brand.json + logo.html (+ official logo sources) + motion-brief.md
│   └── .env            ← ELEVENLABS_API_KEY (gitignored; see .env.example)
└── videos/<slug>/      ← one folder per video: video.config.json + flow.mjs + narration.mjs
```

Delivery canvas is **1920×1080 (Full HD)** for plates and live capture unless a video overrides
`record.viewport`.

Output goes to `<repo>/tmp/videos/<slug>/` (gitignored): `<slug>.mp4`,
`review.html`, `validate/contact-sheet.jpg`, plus the intermediate files.

A video is a sequence of brand plates and live slices, joined in one encode, with narration and a music bed:

```
open → [live… → interstitial plate → live…]* → close
intro ─── chapter/caption lines ─── plate lines ─── outro
music at plate level on every brand plate; bed level under live; ducks under speech
```

Interstitial plates (`features`, `stats`, `callout`, `testimonials`, `logos`, `journey`, `compare`,
`quote`, `metric`, `orbit`) carry facts the screencast alone cannot sell — capability grids, logo walls,
quote floods, journey maps, ratings, before/after columns, one hero quote, one hero number, logos orbiting
the product — inserted *before* a named chapter. Decide them from the motion brief; do not ship
title-only open/close when the story needs belief, proof, or a first-user map.

Every plate sits on a brand **atmosphere**: a WebGL field painted from the five-colour scale
(`motion.atmosphere` — `none` / `schedule` / `aurora` / `mesh` / `particles` / `grid` / `waves`), plus an
effects layer (title reveal `rise` / `cascade` / `wipe`, 3D card depth `flat` / `soft` / `deep`, sheen
sweep, count-up numbers, light flare on the open). Brand defaults live in `brand.json → motion`; a video
overrides them in `video.config.json → direction.motion`; a single plate in `interstitials[].motion`.

## Workflow

Run all commands from `kit/` (`cd .cursor/skills/product-walkthrough-video/kit`).
Before the first run, install with `npm install && npx playwright install chromium`; ffmpeg is also required.

```
- [ ] 1. Brand pack: if missing, discover from the live site/app
        node cli.mjs discover-brand --name Brand --url https://… [--app-url https://…]
        Then read brands/<name>/motion-brief.md and confirm logo.html is the official lockup
        (never invent a mark). Refine motion-brief for audience, tone, and motion language.
- [ ] 2. Plan: read authoring.md + the brand motion-brief, then write the story
        (audience, outcome, 4–7 chapters, 3 recap steps, **which interstitial plates**)
- [ ] 3. node cli.mjs new <slug> --title "…" --purpose overview|feature|onboarding|launch|sales
        → videos/<slug>/ scaffold; `node cli.mjs story <slug>` prints the spine + messaging rules
- [ ] 4. Fill video.config.json (open/close, `interstitials[]`, startUrl, env; FHD by default)
- [ ] 5. node cli.mjs plates <slug>               → review open, close, *and* every interstitial
- [ ] 6. Stack up (app + worker + Mailcatcher if emails are involved)
- [ ] 7. node cli.mjs analyze <slug>              → map DOM controls + WebGL/canvas pointer recipes
- [ ] 8. node cli.mjs smoke <slug>                → overlays and capture timing (drift must be < 0.5s)
- [ ] 9. Write flow.mjs; iterate with node cli.mjs record <slug> [--headed] [--pace brisk]
        Too slow? Set `direction.pace` (Studio → Direction → Live pace, or `direction --pace`) before
        trimming waits by hand; heed `⚠ narration held the tour` — that time is the voice, not the flow.
- [ ] 10. node cli.mjs produce <slug>             → <slug>.mp4 (stale plates are re-rendered automatically)
- [ ] 11. Write narration.mjs (one line per chapter/caption title; see authoring.md §Narration)
- [ ] 12. node cli.mjs audio <slug>               → voice → music → mix; fix every ⚠
- [ ] 13. node cli.mjs validate <slug>            → Read contact-sheet.jpg (logo + joins) and listen to the mix
- [ ] 14. node cli.mjs critic <slug>              → one-shot persona review (narration / plates / pacing / story spine)
        Adjust from critic-report.md; re-run only with `--force`. Optional `--apply` for safe rewrites.
        `node cli.mjs story <slug> --check` is the fast story-only pass (no fingerprint, no report).
- [ ] 15. node cli.mjs deliver <slug>             → poster + SRT/VTT + YouTube chapters + QC + deliverables/
- [ ] 16. node cli.mjs studio [slug]              → review timeline, captions, QC, A/B versions, handoff
- [ ] 17. Hand off: zip or share `tmp/videos/<slug>/deliverables/` (README + master + captions + poster)
```

**From Studio (recommended for new videos).** `node cli.mjs studio` → **New video** opens a five-step brief:
basics (title, audience, outcome, length, tone), app access (start URL; login credentials go only to `kit/.env` as
`<SLUG>_EMAIL` / `<SLUG>_PASSWORD`, referenced from the config as `$VAR`), brand (an existing pack or discover one from
the marketing site), story (must-show flows, key messages, must-say, avoid) and proof (plates, stats, quotes, logos).
For a new brand, Studio keeps the wizard open while it captures and validates the official lockup, five-color palette,
type and motion brief. It reloads that completed foundation before the first agent draft. A placeholder brand cannot be
selected, drafted against or rendered, so the first script and first plate pass use the same verified identity.
**Create & draft** writes `videos/<slug>/brief.json` + a scaffold, optionally runs brand discovery, then maps the live
product (`analyze` → `flow-analysis.md`: DOM controls plus WebGL/canvas pointer probes), then starts an agent job that
drafts `video.config.json`, `flow.mjs` and `narration.mjs` from the brief and that map (unverified selectors are marked
`TODO(verify selector)`). The stage bar then walks the approval chain:

| Stage | Done when |
| --- | --- |
| Brief | `brief.json` or a config exists |
| Script | Script sheet approved (hash pinned in `review.json`; edits reopen it) |
| Direction | Color scale, logo, feature focus, camera and cursor, motion and transitions are approved |
| Record | a live capture exists and is newer than the flow and approved direction |
| Cut | Review cut approved — pins the delivered file as a saved version ("Approved cut") |
| Deliver | handoff pack built from the approved cut; `deliverables/README.md` + `manifest.json` record both approvals |

Studio asks before recording an unapproved script or exporting an unapproved cut.

**Branch (feature deep-dives).** From a finished overview, **Branch** proposes focused follow-ups
(chapters / must-show / plates, optional agent pass), copies the project into the same folder, and
rewrites flow + narration + plates for that angle. CLI: `node cli.mjs branch <slug> [--discover|--title "…"]`.

`node cli.mjs all <slug>` runs record → produce → audio (when `narration.mjs` exists) → validate.
`node cli.mjs all <slug> --critic` also runs the persona critic once after validate.
`node cli.mjs all <slug> --deliver` builds the handoff package after validate.
`node cli.mjs captions <slug>` writes SRT + WebVTT + transcript from fitted `voice/voice.json`.
`node cli.mjs qc <slug>` runs soft pacing QC → `qc-report.json` (dead air, WPM, long live segments).
`node cli.mjs deliver <slug>` is the professional handoff: poster frame, captions, YouTube chapter paste,
QC report, and a flat `deliverables/` folder with README + manifest.
`node cli.mjs suggest-plates <slug> [--apply]` proposes the interstitials the story spine still needs.
`node cli.mjs story <slug> [--purpose …] [--check]` shows or sets the spine; `--check` lists story findings.
`node cli.mjs motion <slug> [--energy …] [--atmosphere …] [--presence 0–1] [--reveal …] [--depth …] [--sheen on|off]`
sets the video's motion tokens; add `--plate <id|open|close>` for a per-plate accent, `--reset` to clear it.
`node cli.mjs studio [slug]` opens **Walkthrough Studio** at `http://127.0.0.1:4747` — timeline seek,
live captions overlay, chapter strip, QC panel, A/B version compare, handoff, motion, critic, and
**Improve** jobs via Cursor CLI (`agent -p`). Shortcuts: Space, J/L, ←/→, C, R. The **Review** panel
carries the story spine (purpose switch, beat coverage) and critic findings with one-click **Fix with
AI**. The **Editor** mode (monitor tab) is the cut editor: one stage, one transport and one
timeline. The timeline holds every clip (plates and recording slices, laid out with their transition overlaps), a
marker on each join, a **speed** row and a **zoom** row; the stage plays the whole cut in place — plates step through
their own motion, the recording plays with simulated speed ramps and zooms, transitions are drawn between the two —
so **Space** plays, **R** replays the clip under the playhead and **Loop** repeats it. Click a clip, a join marker
or a block to edit it in the **Inspector**; drag across the speed or zoom row to pick a stretch (quick actions:
1.5× / 2× / 3× / 0.5×, Zoom, Magnify, No zoom); drag a block to move it, its ends to retime it (dragging an auto zoom takes
it over); the stage shows the push-in live as you change strength, and you drag on it to aim. Magnifiers (recorded `magnify()` loupes and your own) sit on the zoom row and are drawn live on the stage exactly as the render draws them; drag the loupe to aim it, take over or switch off a recorded one. A plate clip exposes **Edit text** (type on the stage, in the plate's own type — select words and press **Accent** or ⌘B for the gradient), its own
look (atmosphere / reveal / depth / sheen) and every CSS variable the templates read — palette, motion timing, card
depth, sheen, open lockup — as live controls (the stage repaints as you drag; values save to `open.style` /
`interstitials[].style`). Direction’s video-wide atmosphere, depth, sheen and energy paint the Editor the same way
(the plate HTML rebuilds behind the pick). A recording clip offers whole-clip speed, auto-zoom strength, its joins, and cursor style
and pace for the next take. Shortcuts: S speed, Z zoom, M magnify, ←/→ step (⇧ = 1 s), ⌫ remove, Esc clear, ⌘Z / ⇧⌘Z undo / redo.
The **voice** and **music** rows sit under the picture and follow the cut: shorten the picture with a ramp and every line re-places itself with the render's own rules (a dashed line moves on the next render, an amber one runs past its window). Drag a line anywhere along the voice row — dropping it past another line reorders them — and drag its ends to trim it; **Regenerate** speaks one line again (rewritten, re-paced, or as a fresh take — the block says **Speaking…** meanwhile, then wears the take number; **Takes** chips switch between takes and **Revert** goes back to the script) and plays it at once. Drag a plate or a recording block to a new gap and the whole cut reorders, on the stage immediately and in the next render. A ride on the music bar makes a stretch softer or louder; **Mix** opens the master (narration, music on titles, music under the demo, dip under the voice, loudness, true peak) and the **Narrator** picker — the ElevenLabs voices on the account, with a sample, stored per video. **Sound** plays that mix while you edit. The status pill offers **Mix** when only the sound is behind, and **Render** still runs the mix after the picture.
Everything lands in `video.config.json` → `edit` (speed ramps, zooms, zoom-free windows, pinned joins, and `edit.audio`) and the next
produce renders it; the status pill in the monitor head says when the video is behind and offers **Render**. `node cli.mjs edit <slug>` prints or edits the same deck from the terminal.
Produce/audio auto-snapshot into `tmp/videos/<slug>/versions/` (includes captions + deliverables when present).
`node cli.mjs direction <slug> [--pace calm|steady|brisk|quick|<0.6–2>]` sets the live pace (one tempo over
every authored hold; the voice is never sped up). For a stretch that is still slow after the take, use a speed ramp:
`node cli.mjs edit <slug> --speed 40-70@2.5` plays recording seconds 40–70 at 2.5× in the cut (times are always in
the recording's clock, so re-cutting never moves them). `--zoom 100+4@1.8:600,400` adds a 4 s 1.8× push-in on that
point, `--keep-whole 120-130` blocks auto zoom there, `--lens 55+2.5:568,961:140x24@2` adds a magnifier on that
target (centre, area, optional strength), `--lens-off 55.158` switches off a recorded one, `--join live>capabilities=push:0.4`
pins one transition, and `--style open --set --gold=#ff5a36 --card-tilt=20deg` writes plate CSS variables.
`--clear speed|zooms|keep-whole|lenses|joins|style:<plate>|all`
removes them.
`node cli.mjs direction <slug> [--look studio|cinematic|social|minimal] [--zoom off|subtle|bold]
[--frame full|inset] [--background brand|ink|accent] [--padding tight|balanced|roomy]
[--corners square|soft|round] [--shadow off|soft|deep] [--cursor classic|arrow|dot]
[--cursor-size s|m|l] [--glide on|off] [--hide-idle on|off] [--loop on|off] [--keys on|off]
[--scale …] [--logo …] [--focus …]
[--approve]` prints or changes the video's direction; Studio's Direction panel writes the same fields.
`node cli.mjs export <slug> [--presets square,vertical,lite,gif]` builds social and light formats from the master into
`exports/`; the next `deliver` copies the fresh ones into `deliverables/exports/`.
`node cli.mjs list` shows every video and its output.

### Camera, cursor and formats

These give a recorded take the polish of a dedicated screen-recording tool. All of them are per-video and opt-in:
existing projects keep zoom off, a full-bleed frame and Playwright's own cursor. New projects start with subtle zoom,
an inset frame, the arrow cursor and keystrokes on.

| Setting | Applies on | What it does |
| --- | --- | --- |
| Looks (`direction.look`) | both | Studio, Cinematic, Social and Minimal apply a coherent camera/cursor/keys starting point. Tuning any setting makes it a custom look. They are video-local and never mutate the brand pack. |
| Auto + manual zoom (`camera.zoom`, `ctx.zoom`) | next produce | Eased push-ins on clicks, plus authored locator-based zooms for important areas without a click. Clicks less than 2.8 s apart pan in one shot. Cards, captions and lenses stay full frame. |
| Frame (`camera.frame`, `background`, `padding`, `corners`, `shadow`) | next produce | `inset` shows the app as a rounded window on a color-scale background; spacing, radius and shadow depth are independently tunable. |
| Cursor (`cursor.style`, `size`, `glide`, `hideIdle`, `loop`) | next record | `arrow`/`dot` glide on an eased arc, pulse on click, can fade while idle and return to their opening seat for looping clips. |
| Keystrokes (`keys`) | next record | Shortcuts the flow presses (⌘K, Enter, Esc) appear as keycaps. Plain typing is not shown. |
| Privacy (`ctx.privacy.mask`) | next record | Covers a live DOM target with an adaptive solid mask before any screencast frame can contain the sensitive value. |
| Formats (`export`) | on demand | Square 1:1 and Vertical 9:16 (the master in a rounded window on the brand background), Light 720p, and a 10 s GIF teaser that starts on the first live chapter. Video variants hold CRF ≤ 16 and copy the master's audio. |

Studio includes a live look preview, a 9:16 Reel safe-area overlay, and a searchable **⌘K** command menu. These are
preview/navigation tools only; they never alter the product UI or the rendered master.
`node cli.mjs manual` builds `tmp/videos/manuals/<set>.html`, one page per manual set, from every video whose config
has a `manual` block. Set titles and intros live in `videos/manuals.json`. Each page has a player, clickable chapters,
the close-plate takeaways and the narration transcript. Shared demo data seeds live in `videos/_demo-data/`.
`node cli.mjs publish` puts the delivered lessons into the webapp's Help Center (profile menu → Help Center,
route `/help`): MP4s and posters go to `packages/webapp/public/help/videos/<slug>/` (committed, 40–55 MB each,
shipped to every environment by the normal webapp build and deploy; keep each MP4 under GitHub's 100 MB limit)
and `packages/webapp/src/routes/helpCenter/helpCenter.content.json` gets the sets, lessons, chapters with their
captions, takeaways, transcripts and the quick answers from `videos/manuals.json`. Marina users see the `gm` set;
Admiral staff (the `admin` role) see both. Re-run `publish` after every new take.

Plate render: ~40 s for seven plates on an Apple Silicon Mac (GPU raster through Metal, four plates at a time;
`WALKTHROUGH_PLATE_GPU=0` forces software, about 8× slower). Unchanged plates are reused, so a make never redraws
them. Live record: the length of the flow. Produce: ~50 s, ~35 s when the recording is unchanged (the cleaned
reel is cached in `live-clean.json`).
Audio: ~1–2 min live (ElevenLabs), seconds when cached; a 3-minute video costs about 1,300 TTS characters and 3 music minutes.

### Audio set-up (once per machine)

1. `cp kit/.env.example kit/.env` and set `ELEVENLABS_API_KEY` — a pay-as-you-go or Creator+ key (commercial rights
   are needed for client-facing videos). Shell env wins over the file; never commit the key.
2. No key yet? `WALKTHROUGH_AUDIO_STUB=1 node cli.mjs audio <slug>` runs the whole chain with the macOS voice and a
   synthesized pad so placements and levels can be checked. Stub output is never deliverable; `review.html` says so.
3. Voice, music style and mix levels live in `kit/brands/<name>/brand.json → audio`; a video may override any key in
   `video.config.json → audio` (e.g. a different voice, `pronunciations`, `maxFitSpeed`).

Voice clips are cached by content hash in `tmp/videos/.cache/voice/` (shared by all videos); editing one line
re-synthesizes one clip, and a re-take re-uses every clip (fitted locally). Music is composed once per style and
edited to each new take. Re-running `produce` invalidates the mix, not the clips. `WALKTHROUGH_AUDIO_OFFLINE=1`
guarantees a run spends nothing.

## Hard rules

1. **Client-facing only.** No PR, ticket, branch or engineering jargon on screen. Product words, outcomes, plain sentences.
2. **Real app, real DOM.** Live screencast with role/label selectors. Never use stills with a fake cursor. On a misclick, re-record; never patch it in ffmpeg.
3. **Every in has an out.** No element may vanish without an exit animation.
4. **Don't fork the engine.** Video-specific code belongs in `videos/<slug>/flow.mjs`; brand-specific assets belong in `kit/brands/<name>/`. If you improve `kit/`, every video gets the improvement.
5. **No grade** on the live reel; keep true UI color. **One** delivery encode.
6. **Validate with vision.** Read the contact sheet and the frames before calling it done: chapter cards readable, no overlay over important UI, no blank frames at the joins. `validate` must report `no flashes in the delivered file`.
7. **Isolate test data.** Unique emails/names per run (`Date.now().toString(36)`); poll for _this_ run's email, never "the latest".
8. **Video leads, voice follows.** Narration is fitted to the recorded pacing (≤ 1.15× speed, ≤ 1.2 s spill); a line that does not fit is rewritten shorter or the step is given more time in `flow.mjs` — never the other way round. The recorder paces each step to its cached line (it holds before the next card until the line is spoken), so with narration in the cache a take needs no fits; a ⚠ then means the line itself is wrong. Zero ⚠ in `voice.json` before hand-off.
   8b. **One recording at a time.** The screencast only captures what the browser can paint; several recordings (or heavy jobs) at once starve it and the result stutters. `record` prints `capture health` — distinct fps should be well above 8 and the p95 frame gap under 400 ms; a `⚠` there means re-record on a quiet machine, not re-encode. Do not edit webapp code while a take runs (Vite's reload overlay ends up in the frame).
9. **Mastered, not loud.** Delivery is −14 LUFS / −1 dBTP, narration −16 LUFS, music ducked under speech. Don't touch gains by ear in a single video; adjust `brand.json → audio.mix` so every video matches.
10. **Demo tenants look real.** A tenant on screen has its own logo, hero and about photos, colours and copy. The default Admiral brand on a client-facing frame is a bug.
11. **Official logo only.** Plates use the real brand lockup (SVG/PNG from the site or app). Harvest with `discover-brand` when sources are missing. Homemade wordmarks, wrong marks, or mis-scaled lockups are bugs — check open + close frames on the contact sheet.
12. **Full HD.** Default delivery is 1920×1080 for plates and live capture. Do not ship 1440×900 for client-facing videos.
13. **Motion brief is memory.** Every brand pack keeps `motion-brief.md` (audience, tone, visual system, motion language, audio, plate palette). Read it before every new video for that brand; update it when the product look or voice changes.
14. **Plate variety.** A proper walkthrough is not only title cards. Prefer 2–5 visual interstitials
    (`features` / `stats` / `callout` / `testimonials` / `logos` / `journey` / `compare` / `quote` /
    `metric` / `orbit`) — icons, assets, and real quotes — then prove them in the live app. Open + close
    alone is the minimum, not the target. Use `suggest-plates` when the set is thin; motion tokens in
    `brand.json → motion` craft plate energy. Pick one atmosphere per video and keep it (a per-plate
    switch — Studio **Accent** or `motion --plate` — is a deliberate accent, not a default); effects
    are brand-coloured, never brand-foreign. Type scales to the copy; when a render logs
    `type · … clip — shorten the copy`, shorten it rather than accept a smaller face.
15. **Story spine first.** `video.config.json → purpose` (overview / feature / onboarding / launch /
    sales; the wizard asks, Studio **Review** and `node cli.mjs story` switch it) picks the spine in
    `lib/narrative.mjs` — e.g. Problem → Promise → Proof → Path → Payoff. Draft, script, narration and
    plate agents receive it; `suggest-plates` fills its gaps; the critic checks the beats.
    Never fight it with org-chart opens, category adjectives or an ending without an ask.
16. **Critic once.** After a coherent preview (plates + narration at least), run `critic`. It embodies
    skeptic / implementer / buyer / onboarder personas and writes `critic-report.md` once per setup
    fingerprint. Adjust from that report; do not re-critic every produce. `--apply` only for high-
    confidence narration rewrites (+ `--apply-plates` for scaffolds).
17. **Render cache + motion QC.** Plates skip re-encode when HTML content-hash + pipeline match.
    Settle-hold reuse is allowed only after a motion/pixel probe proves the window is static; otherwise
    hold is shrunk or disabled. Every encode writes `.render.json` with `qc.ok` — failed QC aborts the
    job and Studio refuses to treat the plate as fresh. Pass `--force` on `plates` / `produce` to bust.
18. **Handoff is a package.** Ship `deliverables/` (master + poster + SRT/VTT + YouTube chapters + QC),
    not a bare MP4. Soft captions are a first pass — human-proof before accessibility publish.

## Choosing what to film

Open with the business outcome, not the feature. One video per user goal.
Good slugs: `create-booking`, `monthly-billing`, `invite-teammate`, `sso-setup`.
Different audiences (staff vs. invitee vs. finance) get chapters, not separate videos, when they share one journey.
See [authoring.md](authoring.md) for the story template, copy limits and flow patterns.

## Use in another project

1. Copy `product-walkthrough-video/` into the new repo's `.cursor/skills/`.
2. Add `kit/brands/<brand>/brand.json` + `logo.html` (see [pipeline.md](pipeline.md#brand-packs)), or set `WALKTHROUGH_BRANDS`.
3. Delete or replace `videos/*`, then `node cli.mjs new <slug>`.
4. Make sure `tmp/` (or `WALKTHROUGH_OUT`) is gitignored, and so is `node_modules`.

## Anti-patterns

| Never                                     | Do instead                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Copy `kit/lib` into a video folder        | Import nothing; `flow.mjs` receives everything through its context              |
| `screencast.start({ path })` WebM         | Kit recorder (JPEG q100 → timestamp-placed lossless x264)                       |
| Screen-recording the brand plates         | `cli.mjs plates` (deterministic per-frame render)                               |
| `await wait(ms)` right after `chapter()`  | `chapter()` already blocks for its duration                                     |
| Captions longer than one sentence         | Title ≤ 5 words, body ≤ ~12 words                                               |
| Glass/backdrop-blur overlays              | Opaque brand surfaces (backdrop-filter doesn't render)                          |
| Hard-coded secrets in `video.config.json` | `"$ENV_VAR"` values resolved at run time (local seed creds are fine)            |
| Inventing a logo / mark for plates        | `discover-brand` from the live site/app; keep official SVG/PNG in the brand pack |
| Delivering a stub-voice mix               | Set `ELEVENLABS_API_KEY` and re-run `audio`; `review.html` flags stub mode      |
| SSML `<break>` or emoji in narration      | Ellipses for pauses, `[tags]` for delivery (Eleven v4)                          |
| Speeding a line past 1.15× to make it fit | Shorter line, or a longer hold in `flow.mjs`                                    |
| Music that competes with the UI           | The bed sits 11 dB under plate level during the demo and ducks under every line |
