import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test-only access to the shared icon modules in `kit/lib/shared`, so the
 * desk's generated tables stay byte-identical to the sprite source.
 */

// Tests run from the package root; jsdom gives `import.meta.url` an http scheme.
const STUDIO = `${resolve(process.cwd(), '../lib/shared')}/`;

function source(file: string): string {
  return readFileSync(`${STUDIO}${file}`, 'utf8');
}

/**
 * Evaluate a legacy ES module's top level and hand back the named bindings.
 * Vite will not serve files outside the package root to jsdom tests, so the
 * module's `import` lines are dropped and their bindings come from `deps`.
 */
export function legacyModule<T extends Record<string, unknown>>(
  file: string,
  names: readonly (keyof T & string)[],
  deps: Record<string, unknown> = {},
): T {
  const keys = Object.keys(deps);
  const body = source(file)
    .replace(/^import [^;]+;$/gm, '')
    .replace(/^export \{[^}]*\};?$/gm, '')
    .replace(/^export (?=(async )?(function|const|let|class) )/gm, '');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(...keys, `${body}\nreturn { ${names.join(', ')} };`) as (...values: unknown[]) => T;
  return factory(...keys.map((k) => deps[k]));
}
