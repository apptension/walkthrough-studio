# Security Policy

## Supported versions

This project is under active development. Please use the latest `main` branch.

## Reporting a vulnerability

If you discover a security issue (credential leakage, unsafe defaults, remote code paths, etc.):

1. **Do not** open a public GitHub issue.
2. Email **security@apptension.com** with a description, impact, and steps to reproduce.
3. Allow a reasonable window for a fix before public disclosure.

## Secrets hygiene

- Put API keys and demo passwords only in `kit/.env` (gitignored).
- Never commit rendered media from `tmp/` that may contain product data from private apps.
- Prefer env-var placeholders in `video.config.json` (`"$SLUG_PASSWORD"`).
