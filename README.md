<p align="center">
  <img src="docs/assets/logo.svg?v=2" alt="Walkthrough Studio" width="96" height="96" />
</p>

<h1 align="center">Walkthrough Studio</h1>

<p align="center">
  <strong>Local studio for branded product walkthroughs.</strong><br />
  Brand plates · live Playwright capture · narration · music bed · one 1920×1080 master.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0A7A3E?style=flat-square" alt="MIT License" /></a>
  <a href="kit/package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 20+" /></a>
  <a href="kit/package.json"><img src="https://img.shields.io/badge/npm-%3E%3D11.17-CB3837?style=flat-square&logo=npm&logoColor=white" alt="npm 11.17+" /></a>
  <a href="https://github.com/apptension/walkthrough-studio"><img src="https://img.shields.io/badge/github-apptension%2Fwalkthrough--studio-181717?style=flat-square&logo=github" alt="GitHub" /></a>
</p>

<p align="center">
  <img src="docs/assets/studio-hero.jpg?v=2" alt="Walkthrough Studio Program monitor on a live chapter" width="100%" />
</p>

---

## Why Walkthrough Studio

Most product videos are either hand-edited screen recordings or slide decks pretending to be demos. Walkthrough Studio is a **local production suite** that treats the real app as the source of truth — brief, script, direction, record, cut, deliver.

Built by [Apptension](https://apptension.com) for client-ready walkthroughs.

---

## Production stages

One stage bar over the live cut — scrub past the dark open so the chapter under the playhead reads clearly.

<img src="docs/assets/feature-stages.jpg?v=2" alt="Stage bar over a mid-cut Program frame" width="100%" />

---

## Features

### Director notes

Plain-language feedback. The agent picks the smallest safe scope — story, brand, timing, plates, or voice — and waits for approval before rendering.

<p align="center">
  <img src="docs/assets/feature-director.jpg?v=2" alt="Director note panel with smart scope" width="420" />
</p>

### Atmosphere & motion energy

WebGL brand fields behind every plate, plus Calm / Clear / Punchy energy profiles.

| Atmosphere | Motion energy |
| :---: | :---: |
| <img src="docs/assets/feature-atmosphere.jpg?v=2" alt="Atmosphere presets: Aurora, Mesh, Waves…" width="100%" /> | <img src="docs/assets/feature-motion-energy.jpg?v=2" alt="Calm, Clear, Punchy motion energy" width="100%" /> |

### Plate effects & live cards

Title reveal, card depth, sheen — and chapter/caption card presets independent of the plates.

| Effects | Live cards |
| :---: | :---: |
| <img src="docs/assets/feature-effects.jpg?v=2" alt="Title reveal, depth, sheen" width="100%" /> | <img src="docs/assets/feature-live-cards.jpg?v=2" alt="Live card presets and caption seat" width="100%" /> |

### Scene transitions

Directed (per hand-off) or a fixed motif: dissolve, brand wipe, push, focus zoom, iris, blur, dip, radial, slice, diagonal.

<p align="center">
  <img src="docs/assets/feature-transitions.jpg?v=2" alt="Scene transition grid" width="420" />
</p>

### Camera & cursor

Auto zoom, inset frame, brand background, padding, corners, shadow — plus presentation cursor (arrow/dot), glide, idle hide, and keystroke keycaps.

<p align="center">
  <img src="docs/assets/feature-camera-cursor.jpg?v=2" alt="Camera and cursor direction controls" width="420" />
</p>

### Editor

One playhead over plates and live takes. Speed, zoom, magnify, voice, and music rows — drag a stretch to retime. Scrub into a product take (not the open plate) when you edit.

| Stage mid-cut | Timeline playhead on a live clip |
| :---: | :---: |
| <img src="docs/assets/feature-editor-stage.jpg?v=2" alt="Editor stage on a live product frame" width="100%" /> | <img src="docs/assets/feature-editor-timeline.jpg?v=2" alt="Editor timeline with playhead mid-cut" width="100%" /> |

### Render bay

Pipeline checklist with live progress — plates → clean → edit plan → encode — while Program stays on a real chapter frame.

<img src="docs/assets/feature-render-context.jpg?v=2" alt="Render bay encoding while Program shows a bright chapter" width="100%" />

| Progress card | Full render bay |
| :---: | :---: |
| <img src="docs/assets/feature-render-progress.jpg?v=2" alt="Encode progress while building the master" width="100%" /> | <img src="docs/assets/feature-render-bay.jpg?v=2" alt="Render bay with queue chips" width="100%" /> |

### New video brief

Five-step wizard: basics → app access → story → proof → review. The agent drafts; nothing records until you approve.

<p align="center">
  <img src="docs/assets/feature-new-video.jpg?v=2" alt="New video brief wizard" width="520" />
</p>

### Inspector

Click a plate or live clip — copy fields, place, look, and cards land in the Inspector.

<p align="center">
  <img src="docs/assets/feature-inspector.jpg?v=2" alt="Inspector for a selected plate" width="420" />
</p>

---

## Effects catalog

| Area | Options |
| --- | --- |
| **Motion energy** | Calm · Clear · Punchy |
| **Atmosphere** | None · Schedule · Aurora · Mesh · Particles · Grid · Waves |
| **Title reveal** | Rise · Cascade · Wipe |
| **Card depth** | Flat · Soft · Deep |
| **Sheen** | On / off highlight sweep |
| **Transitions** | Directed · Dissolve · Brand wipe · Push · Focus zoom · Iris · Blur · Dip · Radial · Slice · Diagonal |
| **Live cards** | Match plates · Editorial · Punchy · Minimal · Spotlight |
| **Camera** | Studio · Cinematic · Social · Minimal presets; auto zoom; frame / padding / corners / shadow |
| **Cursor** | Classic · Arrow · Dot — size, smooth glide, idle hide, loop seat, keystrokes |
| **Editor deck** | Speed ramps · zooms · lenses · per-join transitions · mix desk (voice / music / LUFS) |

---

## Quick start

```bash
git clone https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

The launcher:

1. Checks **Node 20+**, **npm 11.17+**, **ffmpeg**, and **ffprobe** — with install hints if anything is missing  
2. Runs `npm install` and Playwright Chromium when needed  
3. Creates `kit/.env` from `.env.example` if you don’t have one yet  
4. Starts Studio on [http://127.0.0.1:4747/](http://127.0.0.1:4747/) and opens it in your browser  

```bash
./studio                      # check → setup → launch → open
./studio walkthrough-studio   # open a project
./studio --port 4750          # another port
./studio --no-open            # start without opening a browser
./studio --dev                # live log, UI reload, server restart
./studio --help
```

Stop with `Ctrl+C`. If the port is taken, stop the other Studio or pass `--port`.

### Develop

```bash
./studio --dev
./studio --dev --no-open
```

Dev mode keeps the server log in the terminal, including browser warnings and errors.

- Saving a file in `kit/studio/` reloads the open Studio tab. CSS updates in place; HTML and JS reload the page.
- Saving `kit/lib/` or `kit/cli.mjs` restarts the server, then reloads the browser once it is back.
- Changing `scripts/studio.mjs` needs a fresh `./studio` process.

A normal `./studio` stays quiet after the Ready card. The card lists each check on its own row, including how to start dev mode.

---

## Requirements

| Tool | Why |
| --- | --- |
| **Node.js 20+** | Runs the kit |
| **npm 11.17+** | `kit/.npmrc` sets `engine-strict=true` |
| **ffmpeg + ffprobe** | Plates, capture, mix, delivery (`brew install ffmpeg`) |
| **Chromium (Playwright)** | Recording and plate renders — installed by `./studio` |
| **ElevenLabs API key** | Narration + music bed (commercial rights for client work) |
| **The product you film** | Reachable at the video’s start URL before analyze / smoke / record |

Studio opens without a key. Voice, music, and **Regenerate** need `ELEVENLABS_API_KEY` in `kit/.env` (shell env wins). **Improve** and **Create & draft** need a signed-in agent CLI (Cursor `agent` or Claude Code).

### If checks fail

```bash
brew install node@20          # or: nvm install 20 && nvm use 20
npm install -g npm@latest     # 11.17+
brew install ffmpeg           # ffmpeg + ffprobe
./studio
```

---

## Configuration

Open `kit/.env` and set `ELEVENLABS_API_KEY`. `kit/.env` and `kit/node_modules/` stay out of git.

```bash
# Optional: exercise voice/mix without spending credits (macOS say + synth pad — never for client delivery)
WALKTHROUGH_AUDIO_STUB=1
```

Manual setup (same steps `./studio` runs for you):

```bash
cd kit
npm install
npx playwright install chromium
cp .env.example .env
node cli.mjs studio
```

### Demo logins

Keep passwords in `kit/.env`. `video.config.json` only stores the name, as `"$EXAMPLE_EMAIL"`. Studio’s new-video brief writes `<SLUG>_EMAIL` and `<SLUG>_PASSWORD` into that file for you.

---

## Agent jobs

**New video → Create & draft** and **Improve** call a local agent.

| Agent | Setup |
| --- | --- |
| **Cursor CLI** | Install `agent`, then `agent login` — or set `CURSOR_API_KEY` |
| **Claude Code** | Install `claude`, `/login` — or set `ANTHROPIC_API_KEY` |

When both are available, Studio shows an **Agent Ready** switch in the header (writes `WALKTHROUGH_AGENT` in `kit/.env`). With neither, Studio still saves the prompt so you can run it yourself.

---

## Make a video

1. Start the app you want to film.  
2. In Studio, **New video** — or from `kit/`: `node cli.mjs new <slug> --title "…" --purpose overview`.  
3. Approve **Script**, then **Direction** (look / motion / transitions).  
4. `node cli.mjs all <slug>` records, produces, mixes audio when `narration.mjs` exists, and validates.  
5. Cut in **Editor**, then `node cli.mjs deliver <slug>` for the handoff pack.  

```
videos/<slug>/          story: video.config.json, flow.mjs, narration.mjs
kit/brands/<name>/      logo, colors, motion brief
tmp/videos/<slug>/      renders, review, captions, deliverables
```

`tmp/videos/` is resolved from the git root. Set `WALKTHROUGH_OUT` to pin it. From `kit/`: `node cli.mjs list` shows each video and whether a master exists.

---

## Documentation

| Doc | What’s inside |
| --- | --- |
| [authoring.md](authoring.md) | Story, copy, and capture rules |
| [pipeline.md](pipeline.md) | Engine, encode, mix, delivery, motion tokens |
| [SKILL.md](SKILL.md) | Full command list for agents & operators |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to hack on Studio |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

---

## Repository layout

```
walkthrough-studio/
├── studio                 # one-command launcher
├── scripts/               # studio.mjs bootstrap
├── kit/                   # CLI, Studio UI, brands, templates
│   ├── studio/            # local web UI (http://127.0.0.1:4747)
│   ├── brands/            # brand packs (logo, motion, colors)
│   ├── templates/         # plate + overlay HTML/CSS
│   └── cli.mjs            # walkthrough CLI
├── videos/                # video projects (configs + flows)
├── docs/assets/           # README images & logo
├── authoring.md
├── pipeline.md
└── SKILL.md
```

---

## Contributing

Issues and pull requests are welcome. Please:

1. Keep secrets out of git (`kit/.env`, credentials, API keys).  
2. Prefer small, focused PRs with a short “why” in the description.  
3. Run `./studio` and smoke the UI path you changed before opening a PR.  

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2026 [Apptension](https://apptension.com)
