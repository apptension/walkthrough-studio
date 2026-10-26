# Contributing to Walkthrough Studio

Thanks for helping improve Walkthrough Studio.

## Development

```bash
./studio --dev
# → desk with hot reload on http://127.0.0.1:4748/, server on :4747
```

Kit source lives under `kit/`. The desk is the React and TypeScript app in `kit/studio/`. In dev mode it runs on Vite with hot reload and proxies the kit server. Saving `kit/lib/` or `kit/cli.mjs` restarts the server. Server logs stay in the terminal. A normal `./studio` serves the built desk from `kit/studio/dist` and rebuilds it when its sources change. Changing `scripts/studio.mjs` needs a new `./studio` process.

The desk has its own gate. Run it from `kit/studio/` before opening a PR that touches the desk (the test toolchain needs Node 20.19+):

```bash
npm run verify     # typecheck → lint → test → build
```

[kit/studio/README.md](kit/studio/README.md) covers the desk's layout, state, and conventions.

Modules the engine and the desk share (`easing.js`, `copyEdit.js`, `briefRevise.js`, `shortBrief.js`, `voiceHold.js` and others) live in `kit/lib/shared/`.

Kit tests run with Node's test runner from the repo root:

```bash
node --test kit/lib/*.test.mjs kit/lib/shared/*.test.js scripts/*.test.mjs
```

```bash
cd kit
node cli.mjs list
node cli.mjs --help
```

## Rules of the road

- **Never commit secrets.** `kit/.env`, API keys, and real passwords stay local. Video configs should reference env vars (`"$MY_APP_PASSWORD"`), not literals.
- **Don’t commit renders.** `tmp/`, `kit/tmp/`, and media binaries (`*.mp4`, `*.wav`, …) are gitignored — regenerate with the pipeline.
- **Keep PRs focused.** One concern per PR; say *why* the change exists in the description.
- **Preserve the product voice.** README, Studio copy, and authoring docs should stay clear and operator-friendly.

## Pull requests

1. Branch from `main`.
2. Smoke the path you touched (`./studio`, open the relevant project, click through the stage).
3. Open a PR against `main` with a short summary and test notes.

## Reporting issues

Include:

- OS and Node / npm / ffmpeg versions (`./studio` prints the check card)
- The slug and command or Studio action that failed
- `./studio` or `./studio --dev`
- Relevant log lines (redact keys)

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
