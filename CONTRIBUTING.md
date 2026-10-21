# Contributing to Walkthrough Studio

Thanks for helping improve Walkthrough Studio.

## Development

```bash
./studio --no-open
# → http://127.0.0.1:4747/
```

Kit source lives under `kit/`. The Studio UI is static files in `kit/studio/` served by the CLI. After UI changes, refresh the browser (no rebuild step).

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
- Relevant log lines (redact keys)

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
