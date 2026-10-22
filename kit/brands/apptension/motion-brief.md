# Motion brief — Apptension

> Living brand + motion memory for every walkthrough made in Apptension's name — the company itself, its
> Builder's Toolkit (SaaS Boilerplate, SaaS P&L Model, Agentic SDLC) and client-facing case studies.
> Update when apptension.com changes its visual language. Agents must read this before plates or narration.

## Audience

Founders, CTOs and product leaders evaluating a senior software partner — people who read numbers before promises
and take the result into a board meeting.

## Product promise

- Hero line: Enterprise-grade software. Startup speed. Senior engineers only.
- Supporting: 360+ projects shipped since 2012. AI and SaaS, production-ready, without the hiring overhead.
- Section voice on the site: `_> Proof, not promises`, `>> Engineering Intelligence` — terminal-style eyebrows in a mono face.

## Brand voice & tone

- Voice: senior, direct, calm. Proof over hype; short declarative sentences; the stakes stated plainly.
- Tone: engineering-grade, not startup-loud. One idea per line. No exclamation marks.
- Narration: ElevenLabs Brian — confident, measured, slight forward lean (speed ~1.04, style ~0.32). "Apptension" is
  pronounced *app-TEN-shun*; "SaaS" as *sass*.
- On-screen copy: ≤ 5-word titles; chapter cards name the outcome; eyebrows may use the `_>` / `>>` prefix the site uses.

## Visual system

| Token | Value | Notes |
| ----- | ----- | ----- |
| Accent start (gold) | #fffe25 | Apptension yellow — CTA / highlight gradient start |
| Accent end (amber) | #42f272 | Apptension green — gradient end, focus rings |
| Counter-light (teal) | #6ef0a6 | Mint, used sparingly for cool glow |
| Ink / surface | #0a0a0a / #141414 | The site's dark mode blacks |
| Text / muted | #fafafa / #a3a3a3 | Neutral grays, never blue-tinted |
| On accent | #0a0a0a | Black type on the yellow→green chip, as on the site's buttons |

- **Typeface:** the site sets **Hellix** (licensed webfont, 400/600) with **Fira Code** for mono eyebrows. Hellix is
  not redistributable, so plates use **Manrope** — same geometric grotesque feel, same weights. Do not swap in a
  rounded or humanist face.
- **Logo:** the official full lockup (signet + wordmark) lives in `logo.html` / `logo-source.svg`, pulled from
  `apptension.com/logo/logo-full.svg`. The signet is the angular "A" monogram in a diamond; the wordmark is lowercase
  `apptension`. Never invent a substitute, never recolour the lockup with the gradient — it stays `--text` on ink.
- **Logo on plates:** wide lockup (≈ 3.9 : 1). Open plate `openLogoWidth` ~700–740 px then lift to ~0.6 scale,
  `openLiftY` ~ −215 (wide-lockup range). Close plate smaller via the template corner/lockup seat. Clear space
  ≈ 0.5× signet height.
- **Accent use:** the yellow→green gradient is a highlight marker on the site (a bar behind the key phrase, CTA fill).
  On plates use it the same way — one highlighted phrase, one accent chip, progress rings — never as a backdrop.
- **Live reel:** true UI color — no grade.

## Plate palette

Decide 2–5 interstitials per video (not only open/close titles):

| Type | Use |
| ---- | --- |
| `stats` / `kpi` | The due-diligence numbers: 360+ projects, 2012, CSAT, NPS, 3.5 y tenure — verbatim from the site |
| `features` | Service pillars: Generative AI, PoC/MVP, End-to-end, Prototype to Production, SaaS, Hybrid Teams |
| `callout` | One thesis + bullets before a hard live turn ("Senior engineers only.") |
| `process` | How an engagement runs — written plans, go/no-go gates, CI that enforces the process |
| `testimonials` / `quote` | Client words with attribution; CSAT/NPS are "scores from live engagements, not surveys" |
| `logos` | Client / partner wall (assets under `brands/apptension/assets/`) |
| `compare` | Before / after — hiring overhead vs. a senior team that ships month-to-month |

Facts must come from this brief or apptension.com — never invent metrics or client names.

## Motion language

- Energy: **clear** — confident, not punchy. Enters ~900 ms, stagger ~120 ms, soft card depth.
- Plates: lockup traces left→right (signet first, then each glyph), then lifts; stat cards rise in order; black-out
  into the next live slice.
- Atmosphere: default `none` or a quiet `grid` — the site's background is a faint topographic texture on near-white
  or black; keep plates calm so the yellow→green accent does the talking.
- Live: chapter cards before navigation; captions right before the action they describe; every overlay exits.
- Pace: steady (~100 BPM bed); speech over ~65% of runtime.
- Avoid: fake cursors on stills, glass/blur overlays, emoji, gradient-filled logos, stub audio on delivery.

## Audio bed

- Style: modern electronic underscore — clean pulse, warm pads, light percussion, instrumental, forward-moving.
- Voice: Brian, confident and calm; narration −16 LUFS.
- Mix: plate music −20, bed −31, master −14 / −1 dBTP.

## Delivery

- Canvas: **1920×1080 (Full HD)** unless a video explicitly overrides `record.viewport`.
- Validate contact sheet before hand-off: lockup legible on open and close, no cookie banner in frame, joins clean.

## Sources

- https://apptension.com — hero copy, palette, dark-mode blacks, Hellix / Fira Code
- https://apptension.com/logo/logo-full.svg — lockup (also `logo-signet.svg`, `logo-wordmark.svg`)

---
_Harvested by `cli.mjs discover-brand`, then curated by hand. Keep factual._
