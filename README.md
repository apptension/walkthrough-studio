<p align="center">
  <img src="docs/assets/logo.svg?v=3" alt="Walkthrough Studio" width="88" height="88" />
</p>

<h1 align="center">Walkthrough Studio</h1>

<p align="center">
  <strong>Trailers, feature walkthroughs, help videos. From your live app.</strong><br />
  Describe the video. Studio records your real product, writes the script, narrates it in 84 languages, and hands you a 1080p master — landscape 16:9 or vertical 9:16. Record the desktop app, a laptop-sized window, your own screen size, or the mobile layout on a phone or tablet.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-42f272?style=flat-square&labelColor=0a0a0a" alt="MIT License" /></a>
  <a href="#agent-ready"><img src="https://img.shields.io/badge/Agent%20Ready-Cursor%20%C2%B7%20Claude%20Code-42f272?style=flat-square&labelColor=0a0a0a" alt="Agent Ready: Cursor and Claude Code" /></a>
  <a href="#84-languages-one-recording"><img src="https://img.shields.io/badge/languages-84-42f272?style=flat-square&labelColor=0a0a0a" alt="84 languages" /></a>
  <a href="kit/package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white&labelColor=0a0a0a" alt="Node.js 20+" /></a>
  <a href="https://github.com/apptension/walkthrough-studio/releases/tag/v1.0.0-beta.7"><img src="https://img.shields.io/badge/release-v1.0.0--beta.7-42f272?style=flat-square&labelColor=0a0a0a" alt="v1.0.0-beta.7" /></a>
  <a href="https://apptension.com/builders-toolkit/walkthrough-studio"><img src="https://img.shields.io/badge/site-apptension.com-0a0a0a?style=flat-square" alt="Product page" /></a>
</p>

<p align="center">
  <img src="docs/assets/hero.jpg?v=3" alt="Walkthrough Studio: trailers, walkthroughs, help videos from your live app" width="100%" />
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick start</strong></a> ·
  <a href="#what-you-can-make">What you can make</a> ·
  <a href="#agent-ready">Agent Ready</a> ·
  <a href="#84-languages-one-recording">84 languages</a> ·
  <a href="#the-desk">The desk</a> ·
  <a href="#browser-terminal-or-your-agent">CLI and skill</a> ·
  <a href="#faq">FAQ</a>
</p>

---

## Why

Shipping the feature is the easy part. The trailer, the walkthrough, and the help video wait for a video team you do not have, and go stale the next time the UI changes.

Walkthrough Studio is a local desk that treats your real product as the source of truth. You write a brief. An agent drafts the script, the clicks, and the narration. Playwright records the live app. Brand plates, voice, captions, and music are rendered into one master. When the product changes, you re-record. The voice is reused, not re-bought.

- **Your product plays the lead.** Live capture of the real app, not slides or mockups.
- **Show it or let the agent explore.** Walk the tour yourself in a guided session, or let the agent scout the signed-in product and draft the journey.
- **Agent Ready.** Cursor and Claude Code run the whole flow and edit the plain files in your repo.
- **84 languages from one recording.** ElevenLabs narration, captions, and plate copy follow the brief.
- **Runs on your machine.** Capture, renders, and the master never leave your disk. MIT licensed.

---

## Quick start

```bash
git clone --branch v1.0.0-beta.7 --depth 1 https://github.com/apptension/walkthrough-studio.git
cd walkthrough-studio
./studio
```

That checks out the current public beta, [v1.0.0-beta.7](https://github.com/apptension/walkthrough-studio/releases/tag/v1.0.0-beta.7). `main` is the development line. Run `./studio`. The launcher checks Node 20+, npm 11.17+, ffmpeg, and Chromium, installs what is missing, builds the desk, creates `kit/.env`, and opens Studio at [http://127.0.0.1:4747](http://127.0.0.1:4747). The browser tab and `./studio` both name the version you are running. Click **New video**, describe what you need, approve the script, and Studio records.

Voice and music need an `ELEVENLABS_API_KEY` in `kit/.env`. Agent jobs need a signed-in Cursor CLI (`agent`) or Claude Code (`claude`). Studio opens without either.

### Upgrading from 1.0.0-beta.6

```bash
git fetch --tags && git checkout v1.0.0-beta.7    # or: git pull on main
./studio
```

Your projects, brands, and `kit/.env` stay where they are. `./studio` rebuilds the desk when its sources change. `./studio --v2` still starts the same desk.

- **Stage a plate more than one way.** Open, close, features, stats, statement, and callout each have several compositions. A first draft fills anything left open, seeded by the video, so two videos for one brand rarely match.
- **On-screen copy follows one house style.** Sentence case, closing punctuation, and typography are applied at render. Brand names, acronyms, and camelCase names keep their own casing.
- **The score covers the picture.** Music is composed to the cut. A bed that is too short is recomposed instead of looped, and Review names a repeat or a silent tail.
- **New video shows the work.** While discovery runs you can pick a logo and tune the palette. The creation stage shows the screens the agent reached and the storyboard as it is written.
- **Pick the agent model** from a runner logo in the header. The choice is saved in `kit/.env` and used by every agent job.
- **Duplicate** (⌘D) copies the selected clip, plate, effect, card, voice line, or transition into the next sensible place.

Coming from an earlier beta? Check out this tag the same way, then run `./studio`. That serves the desk on [http://127.0.0.1:4747](http://127.0.0.1:4747). The classic desk is gone; `./studio --legacy` tells you so and exits.

---

## What you can make

<img src="docs/assets/video-kinds.jpg?v=3" alt="Trailer, feature walkthrough, and help video" width="100%" />

| Video | Length | Use it for | Story structure |
| --- | --- | --- | --- |
| **Trailer** | 45 to 90 s | Launch day, Product Hunt, the homepage hero | Problem, promise, proof plate, where to start |
| **Feature walkthrough** | 60 to 120 s | Changelog, sales deck, the follow-up email | The workaround today, the feature, the steps, what changes |
| **Help video** | 90 s to 3 min | Help center, onboarding, fewer tickets | What you will have done, the stops, one action per step, next habits |

Pick a purpose in the brief (`overview`, `feature`, `onboarding`, `launch`, `sales`). The chapter spine, the proof plates, and the length follow.

---

## Agent Ready

<img src="docs/assets/agent-ready.jpg?v=3" alt="Tell Cursor or Claude. It makes the video." width="100%" />

**New video → Create & draft**, **Improve**, **Branch**, and **Fix with AI** call a local agent. Both are supported. When both are installed, the header shows an **Agent Ready** switch.

| Agent | Setup |
| --- | --- |
| **Cursor CLI** | Install `agent`, then `agent login`, or set `CURSOR_API_KEY` |
| **Claude Code** | Install `claude`, then `/login`, or set `ANTHROPIC_API_KEY` |

What the agent does for you:

- **Discover brand.** Logo lockup, five-color scale, type, and a motion brief from your marketing URL. Never an invented mark.
- **Explore the live product.** A signed-in browser session (`browse`) maps controls screen by screen; the agent writes the must-show journey and hardens selectors before drafting the script.
- **Draft.** `video.config.json`, `flow.mjs`, and `narration.mjs` from a one-paragraph brief and that product map.
- **Improve with smart scope.** Plain-language notes. The agent picks the smallest safe scope: script, voice, plates, or brand and motion.
- **Re-record and branch.** Redesign shipped? Re-record. Need a focused feature video? Branch it from the overview.

Prefer to show the path yourself? Pick **I'll show it** in the New video wizard (or **Take over & record** in the Render bay). Studio opens a real browser with a dock — Start, Mark moment, Pause, Finish — films your take, and can keep it or replay the steps with the bot. Sign-in happens off camera so passwords never enter the recording.

Everything lands as plain files in `videos/<slug>/`. Every change is a diff you can read, revert, and commit. Nothing records or renders without your approval.

---

## 84 languages, one recording

<img src="docs/assets/languages.jpg?v=3" alt="84 languages: record once, speak to every market" width="100%" />

Choose the video language in the brief. Script, on-screen plate copy, captions, chapters, and the voice are created in that language. Numbers and must-say lines stay exactly as you wrote them. The recording of your product is reused, so the second language costs minutes, not a reshoot.

Narration and the music bed use **ElevenLabs Eleven v4** on your own key. Captions ship as SRT and VTT with YouTube chapter markers.

---

## The desk

One stage bar walks the approval chain: **Brief → Script → Direction → Record → Cut → Deliver**. Studio asks before recording an unapproved script or exporting an unapproved cut.

The desk is a React and TypeScript app (`kit/studio`). Fold either side panel, or the timeline, by dragging its splitter past the edge, and bring it back from the edge tab. Panel sections collapse and remember how you left them. The sequence picker groups branches under their overview and flags projects that still need setup. Every popover (help tips, the queue menu, plate tools) uses the same floating card, and every on-stage editor (zoom, magnifier, copy) uses the same panel.

### Brief

Describe the video in one paragraph, or fill five short steps: basics, app access, story, proof, review. Choose how capture learns the product: let the agent explore, or show the tour yourself. Demo logins go to `kit/.env`, never into the project file.

<p align="center">
  <img src="docs/assets/brief.jpg?v=3" alt="New video brief: describe the video, start URL, video language" width="760" />
</p>

### Program

The rendered master, playing. Brand plates are live compositions, not frame grabs, so they re-time with the motion energy you pick (Calm, Clear, Punchy).

<img src="docs/assets/desk-program.jpg?v=3" alt="Program monitor on a live chapter with the feedback panel" width="100%" />

### Direction

Your brand, not a template. The agent pulls logo, colors, and type from your site. You pick the atmosphere (39 live WebGL fields), title reveal, card depth, transitions, camera, and cursor — and the recording size: desktop, laptop, your own screen, or a phone or tablet for the mobile layout, delivered landscape or vertical.

Title reveals come in nine templates. Rise, Cascade, and Wipe move the type. Focus and Veil settle the line out of blur or haze. Ink, Slit, Iris, and Embers are WebGL masks in your brand colors. The type stays crisp and editable, and every reveal is stepped on the plate clock, so the Editor preview matches the render.

<img src="docs/assets/desk-direction.jpg?v=3" alt="Direction panel with transitions, effects, and plate previews" width="100%" />

### Editor

One playhead over plates and live takes. Speed, zoom, magnify, cut, voice, and music rows. Trim imperfect waits, cut dead air, retime a stretch, or aim a loupe — without a re-record. Hovering the timeline shows where a click will land, and it snaps to chapter starts.

### Review

**Run critic** reviews the cut as four viewers: the skeptic, the implementer, the buyer, and the onboarder. A quick rule pass runs first. With an agent signed in, the agent then watches the cut (narration, timeline, frame stills) and writes a scored review with concrete fixes, each tied to a line, a plate, or a chapter. Its findings lead the list, and the rule findings stay where the agent did not cover the same target. The critic only reviews: it never edits your sources.

<img src="docs/assets/desk-editor.jpg?v=3" alt="Editor timeline with speed, zoom, and mix rows" width="100%" />

### Plates

Open, proof, and close plates carry what the screencast alone cannot: capability grids, journey maps, metrics, quotes, logo walls. Eighteen plate kinds, all on your brand field.

| Open | Features | Close |
| :---: | :---: | :---: |
| <img src="docs/assets/plate-open.jpg?v=3" alt="Open plate" width="100%" /> | <img src="docs/assets/plate-features.jpg?v=3" alt="Features plate" width="100%" /> | <img src="docs/assets/plate-close.jpg?v=3" alt="Close plate" width="100%" /> |

### Deliver

One recording, every channel. The handoff pack includes the master, poster, captions, chapters, QC report, and a README.

| Export | Size | For |
| --- | --- | --- |
| Wide 16:9 master | 1920×1080 | Website, YouTube, stakeholder review |
| Square 1:1 | 1080×1080 | LinkedIn, X, feeds |
| Vertical 9:16 | 1080×1920 | Reels, Shorts |
| Light 720p | 1280×720 | Email, Slack, docs |
| GIF teaser | 960 wide, 10 s loop | READMEs |

---

## Browser, terminal, or your agent

<img src="docs/assets/ways-in.jpg?v=3" alt="Three ways in: browser, terminal, agent skill" width="100%" />

### In the browser

```bash
./studio                       # check → setup → build → launch → open
./studio <slug>               # open a project
./studio --port 4750          # another port
./studio --no-open            # start without opening a browser
./studio --dev                # live log, desk hot reload, server restart
./studio --v2                 # same as ./studio (older notes still work)
```

### From the terminal

Everything Studio does is a CLI command. Run from `kit/`:

```bash
node cli.mjs discover-brand --name Acme --url https://acme.com   # harvest site → agent authors brand pack
node cli.mjs new billing --title "Billing" --purpose launch      # scaffold videos/billing/
node cli.mjs size billing --preset iphone-15 --shape portrait    # record the mobile layout, deliver 9:16
node cli.mjs browse billing look                                 # agent-driven explore of the signed-in app
node cli.mjs guide billing                                       # you show the tour; Studio films + captures steps
node cli.mjs adopt-take billing                                  # keep your guided recording as the take
node cli.mjs all billing                                         # record → produce → audio → validate
node cli.mjs deliver billing                                     # poster, SRT/VTT, chapters, QC, handoff pack
node cli.mjs export billing --presets square,vertical,gif        # social cuts from the master
node cli.mjs branch billing --discover                           # focused follow-ups from one overview
```

`node cli.mjs --help` lists every command. [SKILL.md](SKILL.md) has the full workflow.

### From your agent

The repo is a portable skill. Copy it into any project and Cursor or Claude Code can make the video without opening the browser:

```bash
cp -R walkthrough-studio your-app/.cursor/skills/product-walkthrough-video
```

Then ask: *"Make a 90 second help video showing how to invite a teammate."* The agent follows [SKILL.md](SKILL.md): brief, brand, script, record, produce, narrate, validate, deliver.

---

## Requirements

| Tool | Why |
| --- | --- |
| **macOS or Linux** | Playwright capture and ffmpeg encode |
| **Node.js 20+** and **npm 11.17+** | Runs the kit (`kit/.npmrc` sets `engine-strict=true`) |
| **ffmpeg + ffprobe** | Plates, capture, mix, delivery (`brew install ffmpeg`) |
| **Chromium (Playwright)** | Recording and plate renders, installed by `./studio` |
| **ElevenLabs API key** | Narration and music bed, on your account |
| **Cursor CLI or Claude Code** | Agent jobs: draft, improve, branch, fix |

```bash
brew install node@20          # or: nvm install 20 && nvm use 20
npm install -g npm@latest     # 11.17+
brew install ffmpeg           # ffmpeg + ffprobe
./studio
```

Manual setup, if you prefer:

```bash
cd kit && npm install && npx playwright install chromium && cp .env.example .env
(cd studio && npm ci && npm run build)
node cli.mjs studio
```

`node cli.mjs studio` serves the desk from `kit/studio/dist`. Build the desk first; `./studio` does that for you.

---

## Project layout

```
walkthrough-studio/
├── studio                 # one-command launcher
├── SKILL.md               # agent workflow, portable to any repo
├── kit/                   # the engine
│   ├── cli.mjs            # every command
│   ├── studio/            # the desk: React + TypeScript, served at http://127.0.0.1:4747
│   ├── lib/shared/        # modules the engine and the desk share (easing, voice, icons, copy)
│   ├── brands/<name>/     # logo, five-color scale, motion brief — ships with apptension/ and walkthrough-studio/
│   ├── templates/         # plate and overlay HTML/CSS
│   └── .env               # ELEVENLABS_API_KEY, demo logins (gitignored)
├── videos/<slug>/         # one video: video.config.json, flow.mjs, narration.mjs
├── tmp/videos/<slug>/     # renders, captions, deliverables (gitignored)
└── docs/assets/           # README graphics
```

```bash
WALKTHROUGH_OUT=/path       # pin the output folder (default: <git root>/tmp/videos)
WALKTHROUGH_AUDIO_STUB=1    # exercise voice and mix without spending credits (never for delivery)
WALKTHROUGH_AGENT=cursor    # or claude; Studio writes this when you flip the Agent Ready switch
```

---

## FAQ

**Do I need video editing skills?**
No. You write a brief and approve a script. The cut, the plates, the voice, and the music are rendered for you. The Editor is there when you want to retime a stretch or swap a plate.

**Where does my product and data go?**
Nowhere. Capture, renders, and the master stay on your machine. Demo logins live in `kit/.env`, never in the project file. ElevenLabs is called only when you add a key, and only with the narration text.

**What does it cost?**
Studio is MIT licensed and free. ElevenLabs is pay as you go on your own key: a 3-minute video is about 1,300 characters of speech and 3 minutes of music.

**Can I use it without Cursor or Claude Code?**
Yes. Studio saves every agent prompt so you can run it with any model, and the CLI covers the whole pipeline by hand.

**What happens when the product changes?**
Re-record. The flow, the script, and the voice are reused. Studio marks the project out of date when sources change after the last render.

**Can I record the mobile app layout?**
Yes. Direction → Recording size (or `node cli.mjs size <slug>`) picks desktop, laptop, tablet, phone, or your screen. Phone presets use the mobile layout and touch; set the master to portrait for Reels and Shorts.

**Do passwords appear in the video?**
No. Studio signs in off camera and restores the session before the screencast. Guided tours never store password field values.

---

## Documentation

| Doc | What's inside |
| --- | --- |
| [SKILL.md](SKILL.md) | Full agent workflow and command list |
| [authoring.md](authoring.md) | Story, copy, and capture rules |
| [pipeline.md](pipeline.md) | Engine, encode, mix, delivery, motion tokens |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to hack on Studio |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |

Marketing graphics in `docs/assets/` are rendered by `scripts/render-readme-art.mjs` from the desk screenshots in the same folder. `docs/assets/social-preview.jpg` (1280×640) is the GitHub social preview.

---

## Contributing

Issues and pull requests are welcome.

1. Keep secrets out of git (`kit/.env`, credentials, API keys).
2. Prefer small, focused PRs with a short "why" in the description.
3. Run `./studio` and smoke the UI path you changed before opening a PR. For desk changes, run `npm run verify` in `kit/studio`.

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2026 [Apptension](https://apptension.com). Built by the team that ships the product and the film from the same desk. [Read the case study](https://apptension.com/case-study/walkthrough-studio).
