# Motion brief — Walkthrough Studio

> Living brand + motion memory for every walkthrough of this product.
> This pack is also the showcase example for how Studio itself produces videos.
> Update when the site/app visual language changes. Agents must read this before plates or narration.

## Audience

People who need a tool to build walkthroughs of their products based on Cursor / Claude Code agents

## Product promise

- Hero line: From brief to master
- Supporting: Agent-drafted script, live app capture, brand plates, and a client-ready handoff — one studio

## Brand voice & tone

- Voice: clear, confident, energetic — outcomes over feature lists.
- Tone: modern SaaS with punch; showcase energy, not hype stack.
- Narration: ElevenLabs Brian (energetic product voice); no jargon, no internal ticket language.
- On-screen copy: short captions (≤ 5-word titles); chapter cards name the outcome.

## Visual system

| Token | Value | Notes |
| ----- | ----- | ----- |
| Accent start (gold) | #fffe25 | Brand yellow — start of the Studio's primary-button gradient |
| Accent end (amber) | #42f272 | Brand green — gradient end, focus rings, live markers |
| Counter-light (teal) | #3fe0cf | The lens/zoom teal from the Studio timeline, used sparingly |
| Ink / surface | #0c0e0c / #151715 | The Studio's graphite-green chrome (`--bg` / `--panel`) |
| Text / muted | #f4f6f3 / #7f8880 | Plate type (`--ink` / `--muted`) |
| On accent | #0a0a0a | Black type on the yellow→green chip, as on Studio buttons |

These mirror `kit/studio/styles.css :root`. When the UI palette changes, re-sync `brand.json → colors` — a stale pack
(the 2026-10-18 blue harvest) put off-brand blue on every plate.

- **Logo:** official mark in `logo.html` / `logo-source.svg` — same Rams isometric capture deck as `kit/studio/logo.svg` (graphite chassis, olive accent). Never invent a substitute or a wordmark.
- **Logo on plates:** square mark on dark ink; center horizontally; open plate `openLogoWidth` ~340–380 px (~hero mark), then lift. Because the mark is **square**, `openLiftY` must stay mild (~−90 to −120) — wide-lockup values like −195 / −285 send a square mark off the top of the frame. Prefer `openLogoTop` ~50, `openLiftScale` ~0.52. Close smaller via template corner/lockup.
- **Live reel:** true UI color — no grade. Focus ring uses the brand green.

## Plate palette

Decide 2–5 interstitials per video (not only open/close titles):

| Type | Use |
| ---- | --- |
| `features` | Capability pillars (3–6) before the live tour |
| `stats` | Ratings / KPIs / “in numbers” before the payoff |
| `callout` | One thesis + bullets before a hard live turn |
| `testimonials` | Quote flood for social proof |
| `logos` | Client / integration wall (assets under brands/<name>/assets/) |
| `journey` | First-user path map before the deep dive |

Facts must come from this brief or the live site — never invent metrics.

## Motion language

- Energy: **punchy** (snappy enters, stronger push).
- Plates: logo builds left→right (trace), then lifts; feature/stat cards rise; black-out into the next live slice.
- Live: chapter cards before navigation; captions right before the action they describe; every overlay exits.
- Pace: upbeat (~115–120 BPM techno bed); speech over ~65% of runtime.
- Avoid: fake cursors on stills, glass/blur overlays, emoji, stub audio on delivery, title-only edits.

## Audio bed

- Style: polished techno underscore — clean pulse, warm pads, instrumental; sits under speech without crowding.
- Voice: Brian, energetic direction tags, style ~0.48, speed ~1.08.
- Mix: narration −16 LUFS, plate music −20, bed −31, master −14 / −1 dBTP.

## Delivery

- Canvas: **1920×1080 (Full HD)** unless a video explicitly overrides `record.viewport`.
- Validate contact sheet before hand-off: logo legible, no cookie banners, joins clean.
- Showcase: the `walkthrough-studio` video is the reference cut for Studio itself.

## Sources

- http://localhost:4747
- kit/studio/logo.svg (official chrome mark — source of truth for plates)

---
_Generated/updated for Walkthrough Studio product branding. Keep factual._
