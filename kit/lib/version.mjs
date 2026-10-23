import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json');

/** Semver of this Studio build. `kit/package.json` is the only place it is written. */
export const VERSION = pkg.version;
