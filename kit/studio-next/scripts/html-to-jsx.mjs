#!/usr/bin/env node
/**
 * Convert a region of the legacy `kit/studio/index.html` to JSX.
 *
 * The desk is ported markup-first: each component starts from the exact DOM the
 * legacy page ships, so the legacy stylesheet styles it identically. Runtime
 * decorations the legacy scripts apply on load are converted to the components
 * that reproduce them (`data-sprite` svgs, `data-ico`, `data-help`, `data-zen`,
 * `data-icon`, `.zen-slot`).
 *
 *   node scripts/html-to-jsx.mjs '#projectPanel'
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '../../studio/index.html'), 'utf8');
const { document, Node } = new JSDOM(html).window;

const ATTR = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  spellcheck: 'spellCheck',
  inputmode: 'inputMode',
  enterkeyhint: 'enterKeyHint',
  crossorigin: 'crossOrigin',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  datetime: 'dateTime',
  novalidate: 'noValidate',
  contenteditable: 'contentEditable',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity',
  'fill-rule': 'fillRule',
  'fill-opacity': 'fillOpacity',
  'clip-rule': 'clipRule',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'text-anchor': 'textAnchor',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'dominant-baseline': 'dominantBaseline',
};
const BOOLEAN = new Set(['hidden', 'disabled', 'checked', 'selected', 'readonly', 'multiple', 'required', 'open', 'autofocus', 'novalidate', 'playsinline', 'muted', 'controls', 'loop']);
const PHRASING = new Set(['span', 'a', 'strong', 'em', 'b', 'i', 'kbd', 'code', 'small', 'svg', 'img', 'abbr', 'mark', 'sup', 'sub', 'output', 'label', 'button', 'select', 'input', 'br']);
const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'col']);

const esc = (s) => s.replace(/[{}<>]/g, (c) => `{'${c}'}`);
const str = (s) => JSON.stringify(s);

function styleObject(css) {
  const entries = css
    .split(';')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      const [prop, ...rest] = rule.split(':');
      const value = rest.join(':').trim();
      const key = prop.trim().startsWith('--')
        ? str(prop.trim())
        : prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return `${key}: ${str(value)}`;
    });
  return `{{ ${entries.join(', ')} }}`;
}

function attrs(el, skip = new Set()) {
  const out = [];
  for (const { name, value } of [...el.attributes]) {
    if (skip.has(name)) continue;
    const key = ATTR[name] ?? name;
    if (name === 'style') out.push(`style=${styleObject(value)}`);
    else if (BOOLEAN.has(name) && (value === '' || value === name)) {
      if (name === 'checked') out.push('defaultChecked');
      else if (name === 'selected') continue;
      else if (name === 'playsinline') out.push('playsInline');
      else out.push(key);
    } else out.push(`${key}=${str(value)}`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}

function isPhrasing(node) {
  if (!node) return false;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim() !== '';
  return node.nodeType === Node.ELEMENT_NODE && PHRASING.has(node.localName);
}

function text(node, pad) {
  const raw = node.textContent;
  if (raw.trim() === '') {
    // Whitespace between inline content renders as a space; between blocks it
    // renders as nothing, and JSX drops it either way.
    return isPhrasing(node.previousSibling) && isPhrasing(node.nextSibling) ? `${pad}{' '}` : '';
  }
  const lead = /^\s/.test(raw) && isPhrasing(node.previousSibling) ? "{' '}" : '';
  const trail = /\s$/.test(raw) && isPhrasing(node.nextSibling) ? "{' '}" : '';
  return `${pad}${lead}${esc(raw.replace(/\s+/g, ' ').trim())}${trail}`;
}

function convert(node, depth = 0) {
  const pad = '  '.repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) return text(node, pad);
  if (node.nodeType === Node.COMMENT_NODE) return `${pad}{/* ${node.textContent.trim()} */}`;
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node;
  const tag = el.localName;

  if (tag === 'svg' && el.dataset.sprite) {
    const w = el.getAttribute('width');
    const h = el.getAttribute('height');
    const size = w === h ? ` size={${w}}` : ` width={${w}} height={${h}}`;
    const cls = el.getAttribute('class') ? ` className=${str(el.getAttribute('class'))}` : '';
    const hidden = el.hasAttribute('hidden') ? ' hidden' : '';
    return `${pad}<Icon name=${str(el.dataset.sprite)}${size}${cls}${hidden} />`;
  }

  if (el.dataset.zen && el.dataset.title) {
    const props = [`art=${str(el.dataset.zen)}`, `title=${str(el.dataset.title)}`];
    if (el.dataset.sub) props.push(`sub=${str(el.dataset.sub)}`);
    if (el.hasAttribute('data-mini')) props.push('mini');
    if (el.className) props.push(`className=${str(el.className)}`);
    if (el.id) props.push(`id=${str(el.id)}`);
    if (el.hidden) props.push('hidden');
    const kids = [...el.childNodes].map((c) => convert(c, depth + 1)).filter(Boolean);
    return kids.length
      ? `${pad}<Zen ${props.join(' ')}>\n${kids.join('\n')}\n${pad}</Zen>`
      : `${pad}<Zen ${props.join(' ')} />`;
  }

  if (el.classList.contains('zen-slot') && el.dataset.art) {
    const id = el.id ? ` id=${str(el.id)}` : '';
    return `${pad}<ZenSlot art=${str(el.dataset.art)}${id} />`;
  }

  const skip = new Set();
  const extraBefore = [];
  const extraAfter = [];
  if (el.dataset.ico) extraBefore.push(`${pad}  <SecIcon name=${str(el.dataset.ico)} />`);
  if (el.dataset.icon) {
    const size = el.dataset.size ? ` size={${el.dataset.size}}` : '';
    const w = el.dataset.width ? ` width={${el.dataset.width}}` : '';
    const h = el.dataset.height ? ` height={${el.dataset.height}}` : '';
    const cls = el.dataset.iconClass ? ` className=${str(el.dataset.iconClass)}` : '';
    extraBefore.push(`${pad}  <Icon name=${str(el.dataset.icon)}${size}${w}${h}${cls} />`);
  }
  if (el.dataset.help) {
    skip.add('class');
    const cls = [el.getAttribute('class'), 'has-help'].filter(Boolean).join(' ');
    extraAfter.push(
      `${pad}  <HelpTip text=${str(el.dataset.help)} label=${str(el.textContent.replace(/\s+/g, ' ').trim())} />`,
    );
    const a = attrs(el, skip);
    return wrap(el, tag, `${a} className=${str(cls)}`, depth, extraBefore, extraAfter);
  }
  return wrap(el, tag, attrs(el, skip), depth, extraBefore, extraAfter);
}

function wrap(el, tag, a, depth, before, after) {
  const pad = '  '.repeat(depth);
  if (VOID.has(tag)) return `${pad}<${tag}${a} />`;
  const kids = [...before, ...[...el.childNodes].map((c) => convert(c, depth + 1)).filter(Boolean), ...after];
  if (!kids.length) return `${pad}<${tag}${a} />`;
  return `${pad}<${tag}${a}>\n${kids.join('\n')}\n${pad}</${tag}>`;
}

const selector = process.argv[2];
if (!selector) {
  process.stderr.write('usage: html-to-jsx.mjs <css selector>\n');
  process.exit(1);
}
const target = document.querySelector(selector);
if (!target) {
  process.stderr.write(`no element matches ${selector}\n`);
  process.exit(1);
}
process.stdout.write(`${convert(target, Number(process.argv[3] ?? 0))}\n`);
