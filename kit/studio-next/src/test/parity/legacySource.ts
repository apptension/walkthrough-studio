import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Test-only access to the legacy desk's source, so parity tests can run the
 * original function next to its port on the same inputs. `app.js` is a DOM
 * script, not a module, so a single top-level function is cut out of it by
 * brace matching and evaluated with the dependencies the test passes in.
 */

// Tests run from the package root; jsdom gives `import.meta.url` an http scheme.
const STUDIO = `${resolve(process.cwd(), '../studio')}/`;

export function legacyPath(file: string): string {
  return `${STUDIO}${file}`;
}

const cache = new Map<string, string>();
function source(file: string): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = readFileSync(legacyPath(file), 'utf8');
    cache.set(file, text);
  }
  return text;
}

/** The text of a top-level `function name(…) { … }` (or `async function`). */
export function legacyFunctionSource(name: string, file = 'app.js'): string {
  const text = source(file);
  const re = new RegExp(`^(async )?function ${name}\\(`, 'm');
  const match = re.exec(text);
  if (!match) throw new Error(`legacy ${file} has no top-level function ${name}`);
  let i = text.indexOf('{', text.indexOf(')', match.index));
  // Skip a destructured default parameter list: find the brace that opens the body.
  const header = text.slice(match.index, i);
  if ((header.match(/\(/g) ?? []).length !== (header.match(/\)/g) ?? []).length) {
    let depth = 0;
    for (let j = match.index; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) {
        i = text.indexOf('{', j);
        break;
      }
    }
  }
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && text[j + 1] === '/') j = text.indexOf('\n', j);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(match.index, j + 1);
  }
  throw new Error(`could not find the end of legacy function ${name}`);
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

/** Evaluate one legacy function with its free variables bound from `deps`. */
export function legacyFunction<F extends (...args: never[]) => unknown>(
  name: string,
  deps: Record<string, unknown> = {},
  file = 'app.js',
): F {
  const keys = Object.keys(deps);
  const body = `${legacyFunctionSource(name, file)}\nreturn ${name};`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(...keys, body) as (...values: unknown[]) => F;
  return factory(...keys.map((k) => deps[k]));
}
