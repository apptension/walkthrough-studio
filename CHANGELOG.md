# Changelog

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
