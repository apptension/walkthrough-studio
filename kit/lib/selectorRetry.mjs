/**
 * One retry when a selector times out. The replacement comes from the live DOM or the
 * product map. A stall that is not a selector timeout stays on the existing repair path.
 */
import { readFlowAnalysis } from './analyzeFlow.mjs';

const ACTIONS = new Set([
  'click',
  'dblclick',
  'tap',
  'fill',
  'type',
  'press',
  'check',
  'uncheck',
  'hover',
  'focus',
  'selectOption',
  'setChecked',
  'pressSequentially',
]);

export function isSelectorTimeout(err) {
  if (!err || err.name === 'CaptureStallError') return false;
  return err.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(String(err.message || ''));
}

/** Repair runs only for a stall report. A selector retry is handled inside the take. */
export function usesStallRepair({ stall, selectorRetry, overlay } = {}) {
  if (selectorRetry) return false;
  return Boolean(stall || overlay);
}

function words(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function score(hint, blob) {
  const have = new Set(words(blob));
  return hint.filter((word) => have.has(word)).length;
}

function parsePlaywrightHint(hint) {
  const text = String(hint || '');
  const role = text.match(/getByRole\(\s*'([^']+)'\s*,\s*\{\s*name:\s*\/([^/]+)\//);
  if (role) return { method: 'getByRole', role: role[1], name: role[2] };
  const label = text.match(/getByLabel\(\s*\/([^/]+)\//);
  if (label) return { method: 'getByLabel', text: label[1] };
  const named = text.match(/\[name="([^"]+)"\]/);
  if (named) return { method: 'locator', selector: `[name="${named[1].replace(/"/g, '\\"')}"]` };
  return null;
}

export function pickSelector({ failed, dom, productMap } = {}) {
  const hint = words(failed?.text || failed?.name || '');
  if (!hint.length) return null;
  let best = null;
  let bestScore = 0;
  for (const item of productMap || []) {
    const next = score(hint, `${item.name || ''} ${item.playwright || ''} ${item.label || ''}`);
    if (next > bestScore) {
      best = { source: 'map', item, score: next };
      bestScore = next;
    }
  }
  for (const item of dom || []) {
    const next = score(hint, `${item.name || ''} ${item.nameAttr || ''} ${item.id || ''} ${item.placeholder || ''} ${item.label || ''}`);
    if (next > bestScore) {
      best = { source: 'dom', item, score: next };
      bestScore = next;
    }
  }
  if (!best) return null;
  if (best.source === 'map') {
    const parsed = parsePlaywrightHint(best.item.playwright);
    if (parsed) return { ...parsed, source: 'map' };
  }
  const item = best.item;
  if (item.nameAttr) return { method: 'locator', selector: `[name="${String(item.nameAttr).replace(/"/g, '\\"')}"]`, source: 'dom' };
  if (item.id && /^[\w-]+$/.test(item.id)) return { method: 'locator', selector: `#${item.id}`, source: 'dom' };
  const role = item.role === 'input' || item.role === 'textarea' ? 'textbox' : item.role;
  if (role && item.name) return { method: 'getByRole', role, name: item.name, source: 'dom' };
  return null;
}

export function productMapFromAnalysis(report) {
  if (!report) return [];
  const controls = report.dom?.controls || [];
  const fields = (report.forms || []).flatMap((form) => form.fields || []);
  return [...controls, ...fields].map((item) => ({
    name: item.name || item.label || '',
    playwright: item.playwright || '',
    label: item.label || '',
  }));
}

async function readDom(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button, a, input, textarea, select, [role], label')]
      .slice(0, 200)
      .map((el) => {
        if (el.tagName === 'LABEL') {
          const target = el.htmlFor ? document.getElementById(el.htmlFor) : el.querySelector('input, textarea, select');
          if (!target) return null;
          return {
            role: 'textbox',
            name: (el.innerText || '').trim().slice(0, 80),
            id: target.id || '',
            nameAttr: target.getAttribute('name') || '',
            placeholder: target.getAttribute('placeholder') || '',
            label: (el.innerText || '').trim().slice(0, 80),
          };
        }
        return {
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          name: (el.getAttribute('aria-label') || '').trim().slice(0, 80),
          id: el.id || '',
          nameAttr: el.getAttribute('name') || '',
          placeholder: el.getAttribute('placeholder') || '',
          label: '',
        };
      })
      .filter(Boolean)
  );
}

function hintFrom(method, args) {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first instanceof RegExp) return first.source;
  if (method === 'getByRole') {
    const name = args[1]?.name;
    if (typeof name === 'string') return name;
    if (name instanceof RegExp) return name.source;
    return String(first || '');
  }
  return '';
}

function withTimeout(args, timeout) {
  const copy = [...args];
  const last = copy[copy.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last)) copy[copy.length - 1] = { ...last, timeout };
  else copy.push({ timeout });
  return copy;
}

function locate(original, picked) {
  if (picked.method === 'locator') return original.locator(picked.selector);
  if (picked.method === 'getByRole') return original.getByRole(picked.role, { name: new RegExp(picked.name, 'i') });
  if (picked.method === 'getByLabel') return original.getByLabel(new RegExp(picked.text, 'i'));
  return null;
}

function wrapLocator(locator, page, hint, original, productMap) {
  return new Proxy(locator, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (prop === 'locator' || prop === 'filter' || prop === 'first' || prop === 'nth') {
        return (...args) => wrapLocator(value.apply(target, args), page, hint, original, productMap);
      }
      if (!ACTIONS.has(prop)) return value.bind(target);
      return async (...args) => {
        try {
          return await value.apply(target, args);
        } catch (err) {
          if (!isSelectorTimeout(err)) throw err;
          const dom = await readDom(page).catch(() => []);
          const picked = pickSelector({ failed: hint, dom, productMap });
          const next = picked ? locate(original, picked) : null;
          if (!next) {
            const failed = new Error(`Selector retry failed for ${hint.text || hint.method}. Screenshot: error.png`);
            failed.selectorRetry = true;
            failed.cause = err;
            throw failed;
          }
          try {
            return await next[prop](...withTimeout(args, 3000));
          } catch (retryErr) {
            const failed = new Error(`Selector retry failed for ${hint.text || hint.method}. Screenshot: error.png`);
            failed.selectorRetry = true;
            failed.cause = retryErr;
            throw failed;
          }
        }
      };
    },
  });
}

export function installSelectorRetry(page, { productMap = [] } = {}) {
  const original = {};
  for (const method of ['getByPlaceholder', 'getByLabel', 'getByRole', 'getByText', 'locator']) {
    original[method] = page[method].bind(page);
    page[method] = (...args) =>
      wrapLocator(original[method](...args), page, { method, text: hintFrom(method, args) }, original, productMap);
  }
  return page;
}

export function installRecordedSelectorRetry(page, video) {
  return installSelectorRetry(page, { productMap: productMapFromAnalysis(readFlowAnalysis(video)) });
}
