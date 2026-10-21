# Authoring a walkthrough

## 1. Story first

Answer these in plain language before touching code:

| Question                                         | Becomes                                     |
| ------------------------------------------------ | ------------------------------------------- |
| Who watches? (operator, staff, finance, invitee) | `audience` in config; tone of every caption |
| What can they do after watching?                 | Opening title + subtitle                    |
| What are the 4–7 moments that get them there?    | `chapter()` calls                           |
| What 2–4 things should they remember?            | `close.steps`                               |
| What is the video for?                           | `purpose` → the story spine below           |

### Story spines (`purpose`)

Pick the purpose first; it decides the order of beats, where each one lives and which plates carry it.
The draft / script / narration / plate agents get the spine in their prompt, and `critic` checks it
(`kit/lib/narrative.mjs` is the single source).

| `purpose` | Framework | Beats (where) |
| --------- | --------- | ------------- |
| `overview` | Problem → Promise → Proof → Path → Payoff | viewer's job and its cost (open) · the one outcome, on screen (first chapter) · a number, peers or a quote (plate) · 2–4 jobs done in day order (chapters) · promise restated as the new normal + one next step (close) |
| `feature` | Before → After → Bridge | today's workaround and where it breaks · the same moment with the feature · the 2–3 steps between · the difference quantified (`compare` / `metric`) · where to find it, first thing to try |
| `onboarding` | Goal → Map → Steps → First win | what they will have done by the end · the stops ahead (`journey`) · one action per step, control named before the click · pause on the result · three numbered habits + where to get help |
| `launch` | Shift → What's new → Why now → Try it | what changed in the world or workflow · most valuable change first, as "you can now" · beta numbers / quote · who gets it, when, what to try first |
| `sales` | Problem → Agitate → Solve → Prove → Ask | the problem in the buyer's numbers · the cost of the old way (`compare`) · shortest path, value first, setup last · peers, ratings, outcomes before the ask · one low-friction call to action |

**Messaging rules** (enforced by the critic):

- Open on the viewer, never the company — no "Hi, I'm…", "Welcome to…", "X is a platform that…".
- Outcome before mechanism; say *why*, not the click the screen already shows.
- Second person, present tense; concrete UI nouns and the brief's real numbers.
- No category adjectives (seamless, powerful, robust, leverage, unlock, streamline…). Replace with what happens.
- Vary sentence openings; cut hedges (just, simply, really, very).
- Proof before the ask; one call to action; three numbered takeaways.
- The close echoes the open: the noun that named the problem returns in the last line.

Structure that works for every business area:

```
Opening plate        promise: "<Outcome> / <for whom or where>"
Live chapters        where it lives + the steps (real app)
Interstitial plates  facts / proof / “why it matters” between live beats
Closing plate        recap headline + 2–4 numbered steps + brand
```

### Interstitial plates (decide while planning)

The skill should not default to title plates only. After the story outline, pick **2–5**
visual interstitials that a screencast cannot show cleanly (or would waste time proving live).
First-user / overview videos should feel like a proper walkthrough: capabilities, logos,
testimonials, and a journey map — not only mid-title cards.

| Type | Use when | Config shape |
| ---- | -------- | ------------ |
| `features` | Capability set, pillars, “what’s included” (3–6 cards, optional `icon`) | `{ type, id, before, title, items:[{label,note,icon?}] }` |
| `stats` | Social proof, KPIs, ratings (2–4 figures; optional `logo` asset) | `{ type, id, before, title, stats:[{value,label,note,logo?}] }` |
| `callout` | One thesis + 2–4 bullets before a hard live turn | `{ type, id, before, title, body, bullets:[] }` |
| `testimonials` | Quote flood (3–8) or carousel rollout (`motion.carousel`, 6–16) | `{ type, id, before, title, quotes:[{quote,author,role}], motion? }` — type autoscales; carousel = 3-up waves |
| `logos` | Client / integration wall (3–10 assets from `brands/<name>/assets/`) | `{ type, id, before, title, sub?, logos:[{asset,label,bg?}] }` |
| `journey` | First-user path / “what we’ll cover” (3–6 steps) | `{ type, id, before, title, steps:[{label,note,icon?}] }` |
| `compare` | The shift the product makes — before vs after, 2–5 lines each; ✕ marks draw on the left, ✓ on the right | `{ type, id, before, title, left:{label?,title?,items:[]}, right:{label?,title?,items:[]} }` |
| `quote` | One hero quote on the full stage (12–260 chars; size autoscales), avatar initials or a `logo` asset, optional stars | `{ type, id, before, quote, author, role?, company?, stars?:true\|1–5, logo?/asset? }` |
| `metric` | One number worth remembering — counts up inside a progress ring with ticks; 0–4 pills | `{ type, id, before, title, value, unit?, note?, progress?:0–1, pills:[] }` — `progress` defaults from a `%` value, else 0.76 |
| `orbit` | 3–8 logos circling the brand lockup (≤4 on the inner ring, the rest outside), legend chips | `{ type, id, before, title, sub?, logos:[{asset,label?,bg?}] }` |

`before` is the **chapter title** the plate precedes (must match a `chapter()` in the take).
Narration for plates goes in `narration.mjs → plates: { <id>: '…' }`.
Logo / badge files live in `kit/brands/<brand>/assets/` and are referenced by filename
(`"asset": "client-ntt.png"`); the kit embeds them as data URIs at render time.
Each logo tile (and stats badge) gets an automatic **contrast tile**: dark / mid / colorful
marks sit on a light panel; near-white marks sit on a dark panel. Override with
`"bg": "light"` or `"bg": "dark"` when harvest or analysis is wrong.

**Decision rule:** if the viewer must *believe* something before they *see* it (capabilities,
trust, social proof, integrations), use a plate; if they must *learn a click path*, stay in live UI.
Never invent charts or quotes — harvest from the site, app, case studies, or brief.

**Auto suggestions:** `node cli.mjs suggest-plates <slug>` proposes the types the video's story spine
still lacks (an overview wants features → logos → journey → testimonials/stats; a feature spotlight
wants compare / metric; ≤5). Review, then `--apply` and replace scaffold copy with real brief/site
material.

**Story check:** `node cli.mjs story <slug> --check` (or Studio → Review → Story) lists spine findings —
intro not about the viewer, no ask at the close, hedges, buzzwords, unused brief stats, beats without a
plate. Switch the spine with `--purpose <id>` or the Review panel; every agent pass follows it.

**Per-plate accents:** the video keeps one atmosphere; a single plate may deviate on purpose via Studio
→ Editor → Inspector → **Look**, or `node cli.mjs motion <slug> --plate <id> --atmosphere particles`. A
palette dot on the timeline clip marks plates with their own look or style; `--reset` / **Video default** clears the accent.

**Plate style variables:** every template reads its colours, timing and depth from CSS variables, so one
plate can be re-skinned without touching HTML. Studio → Editor → click the plate → **Colours & motion** lists
them with live controls (the stage repaints as you drag); the CLI form is
`node cli.mjs edit <slug> --style <plate|open|close> --set --gold=#ff5a36 --card-tilt=20deg`. Values
save to `open.style`, `close.style` or `interstitials[].style` and are injected after the template's own
`:root` so they win. Groups: palette (`--ink --surface --gold --amber --teal --text --muted --on-accent`),
motion (`--motion-enter --motion-stagger --motion-exit` seconds, `--motion-push --motion-pop --motion-drift`),
depth (`--card-tilt` deg, `--card-lift` px, `--sheen` on/off) and, on the open plate, the lockup
(`--open-logo-top` %, `--open-logo-width` px, `--open-lift-scale`, `--open-lift-y` %). Keep palette
changes to an accent or two — the brand scale still carries the video.

**Persona critic:** `node cli.mjs critic <slug>` reviews narration + plates + timeline once (skeptic,
implementer, buyer, onboarder). Standards: outcome early, narrate *why* not clicks, ≤28 words/line,
social proof before close, visual change ~every 3–4s in live. Adjust from `critic-report.md`;
`--force` only when the setup fingerprint changed on purpose.

**Layout:** every interstitial is a single centered composition that fills the 1080p frame —
no empty lower third. Prefer 2-row logo walls, tall feature cards, and journey cards with min-height.

### Atmosphere and effects (`motion` tokens)

Plates are brand-coloured at three levels: `brand.json → motion` (the pack default), `video.config.json →
direction.motion` (this video; Studio's Motion & transitions panel writes here), `interstitials[].motion`
(one plate; `open` and `close` take a `motion` object too). Picking an `energy` at the video or plate level
swaps in that profile's timing even when `brand.json` spelled the old numbers out; pin `enterMs` and
friends in the same override to keep custom timing. In the Editor a Look pick shows on the stage the
moment it is made, and the render follows the saved value. Keys:

| Key | Values | What it does |
| --- | ------ | ------------ |
| `energy` | `calm` / `clear` / `punchy` | Timing profile: enter, stagger, push scale, exit |
| `atmosphere` | `none` plus every id in `ATMOSPHERE_IDS` (`kit/lib/plateMotion.mjs`) | WebGL field behind the plate, painted from ink / surface / accent / secondary / support. The original set is `schedule` (resource-timeline bars), `aurora`, `mesh`, `particles`, `grid`, `waves`. Accepted lab fields extend it: `contour`, `signal`, `halftone`, `iridescent`, `silk`, `ridgelines`, `interference`, `warpstripes`, `bend`, `traces`, `isometric`, `sonar`, `constellation`, `cells`, `dunes`, `caustics`, `smoke`, `marble`, `tide`, `rain`, `embers`, `orbit`, `circuit`, `horizon`, `shaft`, `eclipse`, `tunnel`, `meters`, `hex`, `spiral`, `frost`, `braid`. Every field is painted only from the five brand colours (accent / secondary / support / ink / surface), so a palette swap recolours it with no shader edit |
| `atmosphereOpacity` / `atmosphereSpeed` | 0–1 / 0.3–2 | Presence and tempo of the field (defaults per field) |
| `titleReveal` | `rise` / `cascade` / `wipe` | Words lift out of a mask / characters flip in one by one / the line unmasks left to right. Applies to interstitial titles and the open plate |
| `depth` | `flat` / `soft` / `deep` | Cards land from a 3D tilt (`rotateX`, lift); `flat` keeps the pre-effects motion |
| `sheen` | `true` / `false` | A highlight sweeps each card once after it settles |
| `cardPop`, `enterMs`, `staggerMs`, `pushScale`, `exitMs`, `blobDrift` | numbers | Fine timing; see `kit/lib/plateMotion.mjs` |

`stats` values and the `metric` value count up from zero on the plate clock, keeping their own
typography (`4.8★`, `+30%`, `12,000`, `€1.2M`); `count: false` on a stat opts it out. One atmosphere
per video reads as a brand; switch per plate only as a deliberate accent. Legacy `scheduleField: true`
still works and maps to `atmosphere: "schedule"`.

**Joins:** produce fades live ↔ plate through black (matching plate black-outs). Do not soft-dissolve
the same UI across a plate — that reads as a rewind. After `page.goto` / nav, call `ctx.settle(locator)`
so blank SPA paints never sit under a chapter card.

**Narration steers the pointer:** write lines that name the control *before* the click
(“Open Add filter — then pick…”), then click during/after the paced hold. Keep VO and focus on the
same element in the same beat.

Target **2–5 min** of live reel for a first-user overview (plus ~5–6s per interstitial).
Feature-depth videos may run longer; product-area clips stay closer to 90–180s live.

**Music** must cover the full delivery length (open + live + interstitials + close). In the Editor:
**Upload MP3** for your own bed, or **Compose to fit** / **Compose music** for an ElevenLabs bed
sized to the cut (or `node cli.mjs music <slug> --force` then `mix`). If a bed is short, turn on
**Loop to fill**.

## Branching feature videos from an overview

Film one strong overview, then **Branch** in Studio (or `node cli.mjs branch <slug>`):

1. Ideas appear from chapters / must-show / plates; **Ask agent for more** writes richer `branch-ideas.json`.
2. Pick a card (or define a title + angle) → **Create branch**.
3. Studio copies config, brief, flow, narration and flow-analysis into a new slug under the same
   **project folder**, then the agent rewrites for that feature angle (shorter journey, new plates).
4. Approve the script, record, produce — same pipeline as any video.

Folders live in `videos/_library.json`; each video carries `lineage` in `video.config.json`. The
sequence picker groups branches under the folder title.

## 2. Copy limits

| Element              | Limit                                             | Example                                              |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `open.eyebrow`       | 1–3 words                                         | `Product walkthrough`, `Finance`, `New in Admiral`   |
| `open.title`         | 2 lines, ≤ 4 words each; one `*accent*`           | `["Inviting people", "to your *workspace*"]`         |
| `open.sub`           | 3 short outcomes joined by `·`; first in `*bold*` | `*One invite* · the access they need · in minutes`   |
| Chapter title        | ≤ 5 words                                         | `Invite a teammate`                                  |
| Chapter body         | 1 sentence, ≤ 10 words                            | `One person, one email — access in minutes`          |
| Caption title        | ≤ 5 words, imperative or outcome                  | `Create user`, `Invitations created`                 |
| Caption body         | 1 sentence, ≤ 14 words                            | `One action invites them with the access they need.` |
| `close.title`        | 2 lines, punchy; one `*accent*`                   | `["Invite once.", "They're *in.*"]`                  |
| `close.steps[].note` | ≤ 40 characters                                   | `Pick the access they need in one go`                |

`*text*` becomes the accent gradient in every plate field (titles, eyebrows, bodies, notes, values, pills,
quotes, labels); in `open.sub` it becomes bold. In the Editor's **Edit text** mode fields render with the plate's
own CSS — the gradient, the weights, one block per title line — and you type straight into them: select words and
press **Accent** on the stage bar (or ⌘B / Ctrl+B) to mark or unmark them, or type `*word*` and the markers turn
into the accent as you go. Save writes the `*…*` source back to the config, so the editor and the render agree.

**Type scales with the copy.** The limits above are targets, not cliffs. Each plate title has a line
budget (2, or 3 on `metric` / `orbit`, one per line on open/close) and steps down toward its floor rather
than overflowing; a row of stats values or two compare column heads always share one size. Short copy
earns size: a ≤24-character callout title grows to 80px, a short quote to 76px, two-line compares set
items at 30px. Headings balance their lines and copy never ends on a single word. If a plate still
reads small, the copy is too long — cut it, don't fight the fit.
Never put emojis, ticket keys or internal names on screen.

### Narration (`narration.mjs`)

```js
export default {
  intro: 'One sentence over the opening plate.',
  outro: 'One sentence over the closing plate.',
  lines: {
    '<chapter or caption title>': 'What to say while that step is on screen.',
  },
};
```

- **Keys are the on-screen titles** — the first argument of `ctx.chapter()` / `ctx.say()`, verbatim. A line whose key
  matches nothing in the take is reported as unused.
- **Write to the time.** Matilda on Eleven v4 at 1.05× speaks ~2.4 words per second (measured; the stub voice is
  faster, so re-check after the live pass). Budget ≈ 2.3 × the step's seconds: a 4-second step takes nine words.
  Lines that run late push every following line later — fix the first warning, not the last.
- **Let it breathe.** Aim for speech over ~65% of the running time; the music carries the rest.
- **The outro has no spill.** It must end before the video does (the fitter enforces this); echo the close title.
  Read `voice/voice.json` after `cli.mjs voice`: every clip shows its window and a note when it ran long or started late.
- **Skip, don't cram.** A caption without a line is covered by the line before it, and its screen time is given to
  that line. Use this for 1–2 s confirmations ("Approved", "Signed").
- **Say the why, show the what.** The caption already names the step; the voice adds the outcome or the reason
  ("…so the rate is right"). Don't read the caption aloud.
- **Pauses are ellipses** (`...`); delivery hints are Eleven v4 audio tags in brackets (`[warm]`, `[slightly faster]`).
  No SSML, no emoji. A line may be `{ text, speed }` to pin a speed; otherwise the fitter picks ≤ `maxFitSpeed`.
- **Names and products** go in `audio.voice.pronunciations` (`"Lanier": "ləˈnɪər"`) rather than respelled in the text.
- **Intro and outro** are the only lines not tied to the picture: intro starts 1.1 s into the open plate; outro
  starts 0.9 s into the close plate and must finish 0.4 s before the end.

## 3. Flow patterns

### Product map (`analyze`)

Before guessing selectors — especially on WebGL / 3D / map canvases that expose no DOM children — run:

```bash
node cli.mjs analyze <slug>            # uses record.startUrl
node cli.mjs analyze <slug> --url https://app.example/… --headed
```

Studio **Create & draft** runs this automatically after brand capture. It writes `flow-analysis.json` + `flow-analysis.md`:

| Section | What you get |
| --- | --- |
| DOM controls | Visible buttons, links, tabs, inputs with `getByRole` / `getByLabel` hints |
| Forms & fills | Every field with required/pattern/min/max, empty-validation messages, and a **suggested fill** that should pass HTML validity (unique `walkthrough+…@example.com`, env refs for login, selectOption values, checkboxes) |
| Canvases | Context type (webgl / 2d), frameworks (Three, Babylon, Mapbox, …), cursor, registered pointer listeners |
| Pointer probes | Gentle drag / wheel / click on each visible canvas — reports whether pixels actually change |
| Recommendations | Capture tips (`deviceScaleFactor: 1`), fill order for required fields, `actions.hide()` drag recipes, selector preferences |

Use the map when drafting `flow.mjs`. Fill required fields with the suggested values (or env refs) before any submit so the take does not stall on validation. A canvas that reacts to drag is driven with `page.mouse` on its box, not `getByRole`. Re-run analyze after login or a deeper route if the first pass only saw the marketing shell.

`flow.mjs` exports `default async function flow(ctx)`. Context:

| Key                                              | Use                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`, `context`                                | Playwright. Prefer `getByRole` / `getByLabel` with a regex `name`                                                                                                                                                                     |
| `chapter(title, body, ms=2800)`                  | Full-frame card; blocks. Call **before** navigating to the next area so the cut hides the page load. Markup from `kit/templates/chapter.html` — look via `direction.overlays`. New takes leave the card out of `live.mp4` (clean); Studio shows it live; Produce bakes it.                                                                                                                                |
| `say(title, body, ms=2400)`                      | Caption; returns after ~0.95 s while the card stays up. Call it right **before** the action it describes. Template: `kit/templates/caption.html`. Default seat is bottom-center. With narration cached, the next `say`/`chapter` waits until this line has been spoken, so `ms` is a minimum, not the pacing |
| `wait(ms)`                                       | Reading time, authored at **steady** pace: ~400 ms after typing, ~1000 ms after navigation, ~1800 ms on a payoff screen. The video's live pace scales it (see §Live pace)                                                              |
| `sleep(ms)`                                      | Raw sleep the pace never touches — for app timing (debounce, polling), not for the viewer                                                                                                                                             |
| `pace(value?)`                                   | Shift the live pace from here on: `pace('brisk')` for a routine form, `pace(0.9)` on a dense screen, `pace()` back to the video's setting                                                                                             |
| `mark(id, label)`                                | Extra timeline marks (useful for QC)                                                                                                                                                                                                  |
| `env`                                            | `video.config.json` `env`; `"$VAR"` values are resolved from `process.env`                                                                                                                                                            |
| `mail`                                           | `waitFor({ to, subject })`, `link(msg, /re/)`, `htmlUrl(msg)`, `url`                                                                                                                                                                  |
| `out`                                            | Folder for debug artifacts                                                                                                                                                                                                            |
| `actions.hide()` / `actions.show()`              | Switch the pointer decoration and the focus ring off around free-hand input (signature strokes, drags); it animates ~0.35 s per mouse event otherwise                                                                                 |
| `focus(locator, holdMs=1400)`                    | Land the focus ring on an element without acting on it (a value, a status)                                                                                                                                                            |
| `magnify(locator, { holdMs=2400, zoom, label })` | Magnifier over one payoff. In Guided lens direction, the real pointer glides into it and the post lens follows that path. Spotlight keeps the pointer restrained; Ring skips the lens. |
| `follow(targets, { holdMs=1400, travelMs=520, zoom, label })` | One continuous guided lens across 2–6 related features. Pass locators, or `{ locator, holdMs }` objects for per-target pacing. Prefer one meaningful “signal → detail → action” route over several disconnected magnifiers. |
| `brand`                                          | The loaded brand pack, for flows that draw their own overlays                                                                                                                                                                         |
| `pointer.moveTo(x, y)` / `pointer.position()`    | Move the presentation cursor to a point with the same eased glide clicks use (for hovering a chart or pointing at a value without acting on it)                                                                                        |
| `zoom(locator, { holdMs=2200, level='bold', zoom, label })` | Author a post-production push-in around a DOM target without clicking it. `zoom` may be 1.1–2.2; otherwise `level` is subtle/bold. The flow holds while the shot is being shown.                                             |
| `privacy.mask(locator, { label='Private' })`     | Cover a sensitive value before it reaches the screencast. Returns `{ clear() }`; keep the controller and clear it only when the value is no longer on screen. `privacy.clearAll()` removes every active mask.                         |

Every press action (`click`, `dblclick`, `check`, `selectOption`, …) and typing action (`fill`, `pressSequentially`)
writes a `click` or `type` mark with the target's centre to `timeline.json`. Auto zoom builds its shots from those marks,
so a take recorded before this kit version has none: re-record to get zoom. Keep clicks that belong together within
about 2.8 s of each other and the camera pans between them in one shot instead of zooming out and back in. With
`direction.keys` on, `page.keyboard.press('Meta+K')` and `locator.press('Enter')` show keycaps; plain typing is not
shown, so shortcuts read as shortcuts.

Manual zoom and privacy examples:

```js
const secret = await privacy.mask(page.getByLabel('API key'), { label: 'SECRET' });
await zoom(page.getByRole('region', { name: /usage chart/i }), {
  holdMs: 2600,
  level: 'bold',
  label: 'Usage trend',
});
await secret.clear();
```

Mask first, then reveal or scroll the sensitive target into view. Do not rely on post blur for credentials: a live
mask prevents the source pixels from entering the take at all.

Rhythm for one step:

```js
await say(
  'Create user',
  'One action invites them with the access they need.',
  1800
);
await page.getByRole('button', { name: /^create user$/i }).click();
await page.getByText(/user created/i).waitFor({ timeout: 45000 });
await wait(1600); // let the result land
await say('Invitations created', 'Each person shows as invited.', 2000);
```

Every `click`, `fill`, `check`, `selectOption`, `hover` (and `scrollIntoViewIfNeeded`) first frames the element
into view (nearest-edge, skip if already ≥85% visible; large canvases are never recentered), waits for settle,
then draws a gold ring that follows the element's own border radius; the action runs once the ring has landed.
Scroll behavior defaults to `auto` so capture FPS stays high — set `record.scroll.behavior: "smooth"` only when
you want a leisurely camera move. Use `ctx.frame(locator)` for a camera seat without the ring, and
`record.deviceScaleFactor: 1` on WebGL/3D UIs (keeps JPEG q100 → lossless x264 quality; DPR 2 paints 4× pixels and
starves distinct FPS).

Patterns that matter:

- **Form fields**: use `ctx.typeInto(locator, value)` (or `ctx.fillField(patterns, value)`) instead of `getByPlaceholder(…).click()` then `.fill()`. Many marketing forms clear the placeholder on focus; the original locator then matches nothing and capture hangs until the action timeout. Prefer `input[name="…"]` / `textarea[name="…"]` when the analysis lists them.
- **Capture stalls**: if a step makes no progress (~45s idle, or one action >35s), record aborts, writes `capture-stall.json` + `error.png`, and Studio auto-runs Improve (`capture-repair`) once then re-records. CLI: `node cli.mjs record <slug> --repair`. If it still fails, fix `flow.mjs` from the stall report by hand.
- **Switching persons** (staff → invitee/customer): `await context.clearCookies()` before opening their link. Otherwise the app may sign the first user out asynchronously and race the script.
- **Emails sent by a worker**: start `mail.waitFor(...)` _before_ a chapter card, then `await` it after, so the card covers the wait. Match on this run's unique address.
- **Optional UI**: `if (await el.isVisible().catch(() => false))` for anything that can be absent; `throw` for anything the story depends on, so a broken recording fails loudly.
- **Unique data per run**: `walkthrough+${Date.now().toString(36)}@example.com`. Earlier takes leave records behind, so find this run's record by search, not by its position in a paged list.
- **Dropdowns inside dialogs**: Esc usually closes the whole dialog. Close a dropdown by toggling its trigger.
- **Return** the data the video showed (names, ids): it is saved to `live-meta.json`.
- **Backend helpers**: when the story needs something the local stack cannot do on its own (a carrier receipt, a cleanup before the take), keep small scripts next to `flow.mjs` and run them from the flow; they are part of the video, not the kit.
- **Stray toasts**: the webapp's toaster is `[data-testid="toaster"]` with a "Dismiss notification" button (not `[toast-close]`). A page that throws a local-only error toast on mount (Integrations does) is best hidden with `page.addStyleTag` for that chapter, or dismissed before the caption.
- **Freeze the code while recording**: a saved edit anywhere in `packages/webapp` makes Vite reload, and a half-saved import puts its red error overlay on screen. Record on a quiet tree, and check `03-live-first.jpg` for the overlay.
- **Scoping card actions**: when several cards carry the same button, anchor on the record's name and walk up to the nearest ancestor that contains that button.

Debug with `node cli.mjs record <slug> --headed`. On failure the kit writes
`error.png` and `error.txt` to the output folder.

### Live pace

Author every hold at **steady** pace and let one setting decide how fast the tour moves:

| Where | How |
| ----- | --- |
| Config | `video.config.json → direction.pace`: `calm` 0.85× · `steady` 1× · `brisk` 1.25× · `quick` 1.5× · or a multiplier 0.6–2 |
| CLI | `node cli.mjs direction <slug> --pace brisk` (stored) · `node cli.mjs record <slug> --pace 1.4` (this take only) |
| Studio | Direction → **Live pace** |
| Flow | `pace('brisk')` … `pace()` around one routine stretch |

The tempo multiplies `wait()`, the default and explicit holds of `focus` / `frame` / `settle` / `magnify` /
`follow` / `zoom`, chapter and caption minimums (floors keep the card motion intact), pointer glide and
Playwright `slowMo`. It never speeds up the voice: with narration cached, a step still waits for its line.
When that waiting reaches ~20% of the take, `record` prints `⚠ narration held the tour …` and QC adds a
`narration-bound` finding — shorten those lines or raise `audio.voice.settings.speed` (or a line's own
`speed`) instead of pushing the pace further. Pick `brisk` for audiences who know the product and for
launch / social cuts; stay `steady` or `calm` for onboarding and dense screens.

### Cutting the take (`edit` deck)

Pace shapes the *next* recording; the edit deck shapes the recording you already have, without a re-take.
Studio → **Editor** → the speed and zoom rows under the clips (the zoom row also holds magnifiers) (or `node cli.mjs edit <slug>`). All times are seconds in `live.mp4`
(the recording's own clock), so a re-cut never moves them; only a re-record resets the deck.

| Tool | Studio | CLI | Rendered as |
| ---- | ------ | --- | ----------- |
| Speed ramp | drag across the speed row → 1.5× / 2× / 3× / 0.5× (or **Speed**, S); drag the block's ends to retime, the Inspector slider for 0.5–3× | `--speed 40-70@2.5` | that stretch of the cleaned reel plays at the rate; chapter cards, captions and zooms inside it keep their place (Studio warns when a ramp covers a card — cards shorter than ~1.5 s look cut) |
| Zoom shot | **Zoom** (Z) at the playhead or over a selected stretch; the stage shows the push-in as you change strength. Drag to aim, corners for the level, the block's ends for the length | `--zoom 100+4@1.8:600,400` | an eased push-in like a click zoom, pinned to the point you set |
| Edit an auto shot | drag the striped auto block (or **Take over this zoom**) | — | the auto push-in becomes a manual one you can move, resize or remove |
| Keep whole | drag across the zoom row → **No zoom** | `--keep-whole 120-130` | no auto zoom lands inside that window |
| Magnifier | **Magnify** (M) at the playhead or over a selected stretch — it aims at the nearest click; drag the loupe on the stage to aim, the Inspector for strength (Auto / 1.2–2.4×) and the magnified area, the block's ends for the length. The stage draws the same loupe the render does | `--lens 55+2.5:568,961:140x24@2` | a loupe like `magnify()`: iris in and out, brand rim, sheen, shadow; auto zoom keeps clear of it |
| Edit a recorded magnifier | drag its striped block (or **Take over this magnifier**); ⌫ switches it off, the faded **Off** block turns it back on | `--lens-off 55.158` | the recorded `magnify` mark is left out (and replaced by your copy when you take it over) |
| Pin a transition | click the join marker between two clips → style tile and length; **Watch the transition** replays it | `--join live>capabilities=push:0.4` | that one join uses its own style/length; the rest follow `transitions.style`. Live slices are keyed `live`, plates by id |
| Cursor and pace | **Cursor & pace** | `direction --cursor … --pace …` | applied on the next take; the Inspector offers **Record again** |
| Voice | drag a line anywhere on the voice row (past another line changes the order); the Inspector nudges that spot by a few seconds, sets the level (−18…+12 dB), and can send the line back to where it belongs | `--voice-gain intro=-3` · `--voice-nudge "Meet Studio=0.4"` · `--voice-mute intro` | that line plays where you dropped it, louder, or left out of the mix |
| Reorder the cut | drag a plate or a recording block — the bricks it passes slide aside to open its slot — and let go, or **Earlier** / **Later** | `edit.order` — the segment ids in the order they should play | the stage follows at once; the next render plays that sequence, and the narration that belongs to a clip follows it |
| Shape a line | drag the ends of a line to trim its head or tail (the head trim keeps the remaining words in place); **Shape** sets the trims and a fade in / fade out (0–2 s); the pill shades its faded ends | `edit.audio.voice[].trimStart/trimEnd/fadeIn/fadeOut` | the mix plays only that stretch of the clip (`atrim` + `afade`); at least 0.3 s of speech stays |
| Speak a line again | **Line** · edit the words, pick a pace (0.8–1.3×), **Regenerate** (⌘↵ in the text) for ElevenLabs, or **Upload MP3** / **Record** for your own take. The same words again become a new take. While the narrator speaks, the line's block on the voice row says **Speaking…**; afterwards the block wears the take number. **Takes** chips switch between takes (solid chips are ready; upload/mic takes are marked), **Revert** goes back to the script's words, natural pace and take 1 | `edit.audio.voice[].text/speed/take/takes/takeSources` | one clip in `voice/voice.json` is replaced; custom takes live under `voice/custom/<key>/`; a respoken line starts from the whole clip (trims reset, fades and level stay) |
| Add a voice line | Empty inspector **Add voice**, or click the empty voice lane · optional words, then **Speak** (ElevenLabs), **Upload MP3**, or **Record** at the playhead | `edit.audio.voice[]` with `at` + ad-lib clip in `voice/voice.json` | free-standing line on the cut; no `narration.mjs` entry required |
| Narrator | **Mix** · **Narrator** lists the ElevenLabs voices on the account with a sample; **Use voice** stores it for this video, **Brand voice** goes back | `video.config.json → audio.voice.{voiceId,name}` | the next **Mix** speaks every line with that voice (clip cache keys include the voice); the panel says so until it does |
| Music | drag the music bar to slip it, its ends to fade; **Softer** / **Louder** adds a ride; **Upload MP3** attaches your own bed; write a **Prompt** then **Compose to fit** / **Compose music** for an ElevenLabs bed sized to this cut (brand styles still apply); when the bed is short, **Loop to fill** | `--music-gain -3` · `--music-offset 1.2` · `--ride 40-70@-6` · `--music-mute` · `music --force --prompt "…"` | the bed slips, dips, or drops out; Upload writes `music/music.mp3` (source `upload`); Compose saves `audio.music.prompt` and rewrites the bed to this cut's length |
| Master | **Mix** · narration, music on titles, music under the demo, dip under the voice, loudness, true peak | `--master voice=-18,bed=-28,target=-16,duck=4` | `mix` uses these instead of the brand defaults; **Mix** on the status pill rebuilds the soundtrack |

Ramps multiply the hold you authored, so use them for stretches that are slow *in this take* (a long form
fill, a worker wait that the card did not cover). A stretch that is slow in every take is a flow or pace
problem — fix it there. The Editor plays every change straight away; the status pill reads **Not in the video yet** until the
deck has been rendered, and its **Render** button re-runs produce only.

### Bridging plates and live footage

The edit dissolves every join (see pipeline.md §Delivery encode), but the footage on either side decides whether it reads as one film:

- **Open each chapter that follows a plate with `chapter()`.** The live slice starts on the card, so the plate dissolves into a designed frame and the UI is revealed by the card's exit.
- **End a slice before navigating away.** The last 1–2 s before a plate should be a settled page, not a click that starts a load (the scene-cut trim rescues a late load, but it costs footage).
- **Let the plate copy hand over.** The narration on the line before a plate should set up its claim ("…and it does more than scheduling"), and the plate line should land it.
- **Keep one style per video.** `dissolve` is the default; `dip` suits a formal or chaptered lesson; `wipe` and `zoom` are for energetic marketing cuts only.

### Script approval

Studio's **Script** sheet (stage bar → Script) lists every plate, chapter and caption with its on-screen copy and
narration, word counts and a spoken-length estimate (2.4 words/s). Lint flags missing narration, lines over 28 words,
titles over 5 words, bodies over 12, click-language ("click", "press"), orphan narration keys, and plates whose
`before` names no chapter. Edit narration in place (saved on blur), or write a note and **Ask agent to revise**.
**Approve script** records the sources' hash in `videos/<slug>/review.json`; any later edit to the config, flow or
narration turns the approval into "changed" until it is approved again. Record only an approved script — re-recording
is the expensive step.

## 4. Review checklist (from validate frames)

- [ ] Opening and closing plates: copy fits, nothing clipped, accent on the right word
- [ ] Every `chN-hold` frame shows the chapter card cleanly; every `chN-after` frame shows UI with no card ghosting
- [ ] Captions never cover the element being clicked (move the action or shorten the caption)
- [ ] `02-join-open-live` and `91-join-live-close` are clean fades, not frozen or half-loaded UI
- [ ] Every `x-<prev>-<id>` mid-join frame mixes two finished pictures — no exiting copy over UI, no blank page
- [ ] No spinner or skeleton screens held on screen for more than about 1 s
- [ ] Real-looking data: no "test123", no lorem ipsum
