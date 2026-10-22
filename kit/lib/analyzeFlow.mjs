/**
 * Flow analyzer — map how to move through a live product before writing flow.mjs.
 *
 * DOM-first products get role/label inventories. Forms get field + HTML constraint
 * inventories with generated fill values that should pass validation. WebGL / canvas
 * surfaces get a pointer-interaction probe (listener spy, frameworks, drag/wheel/click).
 *
 * With --explore: sign in when credentials exist, crawl safe nav targets, score mustShow
 * coverage, go deeper if unmet, then recraft the brief journey to what was actually found.
 *
 *   node cli.mjs analyze <slug> [--headed] [--url https://…] [--explore]
 *
 * Writes videos/<slug>/flow-analysis.json + flow-analysis.md for the draft agent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import {
  applyJourneyRecraft,
  craftJourneyFromCoverage,
  scoreMustShowCoverage,
} from './mustShowCoverage.mjs';

/* ---------- form fill recipes (Node-side, testable) ---------- */

/** Infer what the field is for from label / name / autocomplete / type. */
export function inferFieldPurpose(field = {}) {
  const blob = [field.label, field.name, field.id, field.placeholder, field.autocomplete, field.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (field.type === 'password' || /password|passwd|hasło|passwort/.test(blob)) return 'password';
  if (field.type === 'email' || /e-?mail|correo|courriel/.test(blob)) return 'email';
  if (field.type === 'tel' || /phone|mobile|telefon|tel\.|cell/.test(blob)) return 'phone';
  if (field.type === 'url' || /website|homepage|url/.test(blob)) return 'url';
  if (/first.?name|given.?name|vorname|imię|prénom/.test(blob)) return 'firstName';
  if (/last.?name|family.?name|surname|nachname|nazwisko|nom/.test(blob)) return 'lastName';
  if (/full.?name|your.?name|display.?name|^name$|autocomplete":\s*"name"/.test(blob) || field.autocomplete === 'name')
    return 'fullName';
  if (/company|organization|organisation|firma|betrieb/.test(blob)) return 'company';
  if (/job|title|role|stanowisko/.test(blob)) return 'jobTitle';
  if (/city|miasto|stadt|ville/.test(blob)) return 'city';
  if (/zip|postal|post.?code|plz/.test(blob)) return 'postal';
  if (/address|straße|ulica|street/.test(blob)) return 'address';
  if (/country|land|kraj|pays/.test(blob)) return 'country';
  if (/quantity|qty|ilość|anzahl|count|amount/.test(blob)) return 'quantity';
  if (/search|szukaj|suche/.test(blob)) return 'search';
  if (field.type === 'number' || field.inputMode === 'numeric' || field.inputMode === 'decimal') return 'number';
  if (field.type === 'date' || field.type === 'datetime-local' || field.type === 'month' || field.type === 'week') return 'date';
  if (field.type === 'time') return 'time';
  if (field.type === 'checkbox') return 'checkbox';
  if (field.type === 'radio') return 'radio';
  if (field.type === 'file') return 'file';
  if (field.tag === 'select' || field.type === 'select-one' || field.type === 'select-multiple') return 'select';
  if (field.type === 'hidden' || field.hidden) return 'hidden';
  return 'text';
}

function matchesPattern(value, pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(String(value));
  } catch {
    try {
      return new RegExp(pattern).test(String(value));
    } catch {
      return true;
    }
  }
}

function clampNumber(n, field) {
  let v = Number(n);
  if (!Number.isFinite(v)) v = 1;
  if (field.min != null && field.min !== '' && Number.isFinite(Number(field.min))) v = Math.max(v, Number(field.min));
  if (field.max != null && field.max !== '' && Number.isFinite(Number(field.max))) v = Math.min(v, Number(field.max));
  if (field.step != null && field.step !== '' && field.step !== 'any') {
    const step = Number(field.step);
    const min = field.min != null && field.min !== '' ? Number(field.min) : 0;
    if (Number.isFinite(step) && step > 0 && Number.isFinite(min)) {
      v = min + Math.round((v - min) / step) * step;
    }
  }
  return v;
}

function padToMinLength(s, minLength) {
  const n = Number(minLength);
  if (!Number.isFinite(n) || n <= s.length) return s;
  return s + 'x'.repeat(n - s.length);
}

function trimToMaxLength(s, maxLength) {
  const n = Number(maxLength);
  if (!Number.isFinite(n) || n <= 0 || s.length <= n) return s;
  return s.slice(0, n);
}

/**
 * Suggest a value that should satisfy HTML constraints for a smooth recording fill.
 * Login credentials stay as env refs — never invent production secrets.
 */
export function suggestFieldFill(field = {}, { runId = Date.now().toString(36), slug = 'walkthrough' } = {}) {
  const purpose = field.purpose || inferFieldPurpose(field);
  const type = (field.type || 'text').toLowerCase();

  if (field.skip || type === 'hidden' || purpose === 'hidden') {
    return { skip: true, purpose, reason: 'hidden / not filled in the take' };
  }
  if (field.disabled || field.readOnly) {
    return { skip: true, purpose, reason: field.disabled ? 'disabled' : 'read-only' };
  }
  if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
    return { skip: true, purpose, reason: 'action control — click, do not fill' };
  }
  if (purpose === 'file' || type === 'file') {
    return {
      skip: true,
      purpose: 'file',
      reason: 'Do not open a file picker in the take — focus()/frame() the control only, or seed a test file via setInputFiles in beforeCapture',
    };
  }

  // Auth: recording should use kit/.env refs, not invented passwords for login screens.
  if (purpose === 'email' && field.formKind === 'login') {
    return {
      purpose,
      value: `$${String(slug).replace(/-/g, '_').toUpperCase()}_EMAIL`,
      strategy: 'env',
      notes: 'Resolve from video.config.json env / kit/.env — unique per tenant if needed',
      playwright: field.playwright,
    };
  }
  if (purpose === 'password' && field.formKind === 'login') {
    return {
      purpose,
      value: `$${String(slug).replace(/-/g, '_').toUpperCase()}_PASSWORD`,
      strategy: 'env',
      notes: 'Never hardcode. Prefer env; for signup use a generated password instead (formKind signup).',
      playwright: field.playwright,
    };
  }

  if (purpose === 'select' || field.tag === 'select') {
    const opt =
      (field.options || []).find((o) => o.value !== '' && !o.disabled && !o.placeholder) ||
      (field.options || []).find((o) => !o.disabled);
    if (!opt) return { skip: true, purpose, reason: 'select has no enabled options' };
    return {
      purpose,
      value: opt.value,
      label: opt.label,
      strategy: 'selectOption',
      notes: `selectOption('${opt.value}')` + (opt.label ? ` — visible “${opt.label}”` : ''),
      playwright: field.playwright,
    };
  }

  if (purpose === 'checkbox') {
    return {
      purpose,
      value: true,
      strategy: 'check',
      notes: field.required ? 'Required — check before submit' : 'Check only if the story needs it',
      playwright: field.playwright,
    };
  }

  if (purpose === 'radio') {
    return {
      purpose,
      value: field.value || true,
      strategy: 'check',
      notes: 'Select this radio if it matches the story beat; otherwise pick the labelled option the narration names',
      playwright: field.playwright,
    };
  }

  let value = '';
  let strategy = 'fill';
  let notes = '';

  if (purpose === 'email') {
    value = `walkthrough+${runId}@example.com`;
    notes = 'Unique per run so earlier takes do not collide in search / invites';
  } else if (purpose === 'password') {
    value = `Walkthrough!${runId}9`;
    notes = 'Meets common complexity (upper, lower, number, symbol). Prefer for signup; login uses env.';
  } else if (purpose === 'phone') {
    value = '+1555010' + String(runId.replace(/\D/g, '').slice(-4) || '1991').padStart(4, '0').slice(-4);
    notes = 'E.164-ish test number; adjust if pattern demands a local format';
  } else if (purpose === 'url') {
    value = 'https://example.com/walkthrough';
  } else if (purpose === 'firstName') {
    value = 'Alex';
  } else if (purpose === 'lastName') {
    value = 'Walker';
  } else if (purpose === 'fullName') {
    value = 'Alex Walker';
  } else if (purpose === 'company') {
    value = 'Walkthrough Demo Co';
  } else if (purpose === 'jobTitle') {
    value = 'Producer';
  } else if (purpose === 'city') {
    value = 'Berlin';
  } else if (purpose === 'postal') {
    value = field.pattern && matchesPattern('10115', field.pattern) ? '10115' : '10001';
  } else if (purpose === 'address') {
    value = '1 Demo Street';
  } else if (purpose === 'country') {
    value = 'DE';
  } else if (purpose === 'quantity' || purpose === 'number') {
    const n = clampNumber(purpose === 'quantity' ? 10 : 42, field);
    value = String(n);
    strategy = 'fill';
    notes = [field.min != null && `min ${field.min}`, field.max != null && `max ${field.max}`, field.step != null && `step ${field.step}`]
      .filter(Boolean)
      .join(' · ');
  } else if (purpose === 'date') {
    const d = new Date();
    if (type === 'month') value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    else if (type === 'week') {
      // ISO week approx — fine for recording demos
      value = `${d.getUTCFullYear()}-W${String(Math.ceil(d.getUTCDate() / 7)).padStart(2, '0')}`;
    } else if (type === 'datetime-local') {
      value = `${d.toISOString().slice(0, 16)}`;
    } else value = d.toISOString().slice(0, 10);
  } else if (purpose === 'time') {
    value = '09:30';
  } else if (purpose === 'search') {
    value = 'walkthrough';
  } else {
    value = 'Walkthrough demo';
  }

  // Honour length constraints
  if (field.minLength) value = padToMinLength(value, field.minLength);
  if (field.maxLength) value = trimToMaxLength(value, field.maxLength);

  // If a pattern is set, try a few candidates that usually pass, else keep best effort
  if (field.pattern && !matchesPattern(value, field.pattern)) {
    const candidates = [
      value,
      'Test1!',
      'Aa1!' + runId,
      'user@example.com',
      '12345',
      'abc',
      'https://example.com',
      '+4915123456789',
      '2026-06-15',
      'Walkthrough1',
    ];
    const hit = candidates.find((c) => matchesPattern(trimToMaxLength(padToMinLength(c, field.minLength), field.maxLength), field.pattern));
    if (hit) {
      value = trimToMaxLength(padToMinLength(hit, field.minLength), field.maxLength);
      notes = [notes, `adjusted to match pattern /${field.pattern}/`].filter(Boolean).join(' · ');
    } else {
      notes = [notes, `pattern /${field.pattern}/ — verify fill in a headed run`].filter(Boolean).join(' · ');
    }
  }

  return {
    purpose,
    value,
    strategy,
    notes: notes || (field.required ? 'Required field — fill before submit' : ''),
    playwright: field.playwright,
    constraints: {
      required: Boolean(field.required),
      type: field.type || null,
      pattern: field.pattern || null,
      minLength: field.minLength ?? null,
      maxLength: field.maxLength ?? null,
      min: field.min ?? null,
      max: field.max ?? null,
      step: field.step ?? null,
    },
  };
}

export function enrichFormsWithFills(forms, { runId, slug } = {}) {
  return (forms || []).map((form) => ({
    ...form,
    fields: (form.fields || []).map((f) => {
      const purpose = inferFieldPurpose(f);
      const field = { ...f, purpose, formKind: form.kind || 'unknown' };
      return { ...field, fill: suggestFieldFill(field, { runId, slug }) };
    }),
  }));
}

function scoreCanvas(canvas) {
  let score = 0;
  if (canvas.contexts?.includes('webgl') || canvas.contexts?.includes('webgl2')) score += 3;
  if (canvas.frameworks?.length) score += 2;
  if (canvas.interactions?.reactsToDrag) score += 4;
  if (canvas.interactions?.reactsToWheel) score += 2;
  if (canvas.interactions?.reactsToClick) score += 1;
  if (canvas.interactions?.listenerTypes?.length) score += Math.min(3, canvas.interactions.listenerTypes.length);
  if (/grab|move|crosshair|none/i.test(canvas.cursor || '')) score += 1;
  if (canvas.visible && canvas.box && canvas.box.w >= 200 && canvas.box.h >= 200) score += 1;
  return score;
}

/** Build director recommendations from a finished analysis object. */
export function buildRecommendations(report) {
  const out = [];
  const canvases = (report.canvases || []).filter((c) => c.visible && scoreCanvas(c) >= 3);
  const webgl = canvases.filter((c) => c.contexts?.some((x) => x.startsWith('webgl')));

  if (webgl.length) {
    out.push({
      kind: 'capture',
      text: 'Set record.deviceScaleFactor: 1 — WebGL/3D at DPR 2 starves distinct FPS while quality stays JPEG q100 → lossless x264 either way.',
    });
  }

  for (const c of canvases.slice(0, 4)) {
    const label = c.label || c.id || `canvas[${c.index}]`;
    if (c.interactions?.reactsToDrag) {
      out.push({
        kind: 'flow',
        text: `Orbit / pan “${label}” with page.mouse on the canvas box — actions.hide() during the drag, then actions.show(). Prefer frame(canvas) over focus(); never centre-scroll a large canvas.`,
      });
    } else if (c.interactions?.listenerTypes?.length || c.frameworks?.length) {
      out.push({
        kind: 'flow',
        text: `“${label}” looks interactive (${[...(c.frameworks || []), ...(c.interactions?.listenerTypes || []).slice(0, 3)].join(', ')}) but the probe did not see a pixel change — try a headed drag, or drive nearby DOM chrome and only seat the camera on the canvas.`,
      });
    }
    if (c.interactions?.reactsToWheel) {
      out.push({
        kind: 'flow',
        text: `Zoom “${label}” with page.mouse.wheel over the canvas centre (after move), not a DOM slider — unless a labelled zoom control exists beside it.`,
      });
    }
  }

  const controls = report.dom?.controls || [];
  if (controls.length) {
    const sample = controls.slice(0, 8).map((c) => c.playwright || c.name).filter(Boolean);
    out.push({
      kind: 'selectors',
      text: `Prefer getByRole / getByLabel from the inventory (${sample.join('; ')}${controls.length > 8 ? '; …' : ''}). Mark anything unverified with // TODO(verify selector) and guard with isVisible().`,
    });
  }

  if (!canvases.length && !controls.length && !(report.dom?.forms || []).length) {
    out.push({
      kind: 'warn',
      text: 'No clear controls, forms or canvases found — the page may need login, a cookie dismiss, or a deeper route. Re-run analyze after beforeCapture-style setup.',
    });
  }

  if (report.hints?.needsLogin) {
    out.push({
      kind: 'auth',
      text: 'Login form detected. Keep credentials as $ENV_VAR refs in video.config.json env; never hardcode secrets in flow.mjs.',
    });
  }

  const forms = report.dom?.forms || [];
  const fillable = forms.flatMap((f) => (f.fields || []).filter((x) => x.fill && !x.fill.skip));
  const required = fillable.filter((x) => x.required || x.fill?.constraints?.required);
  if (forms.length) {
    out.push({
      kind: 'forms',
      text: `${forms.length} form(s), ${fillable.length} fillable field(s)${required.length ? ` (${required.length} required)` : ''}. Use the fill recipes in flow-analysis.md — unique emails per run, env refs for login, never submit destructive actions in the take.`,
    });
  }
  for (const field of required.slice(0, 6)) {
    const label = field.label || field.name || field.id || field.purpose;
    const fill = field.fill;
    if (!fill || fill.skip) continue;
    out.push({
      kind: 'fill',
      text: `Required “${label}” → ${fill.strategy === 'env' ? fill.value : JSON.stringify(fill.value)} (${fill.strategy}${fill.notes ? ` · ${fill.notes}` : ''})`,
    });
  }
  const patterned = fillable.filter((x) => x.pattern || x.fill?.constraints?.pattern);
  if (patterned.length) {
    out.push({
      kind: 'validation',
      text: `${patterned.length} field(s) declare pattern/min/max constraints — prefer the suggested values; headed-check any still marked “verify fill”.`,
    });
  }

  return out;
}

export function analysisToMarkdown(report) {
  const lines = [];
  lines.push(`# Flow analysis — ${report.slug}`);
  lines.push('');
  lines.push(`Analyzed \`${report.url}\` at ${report.analyzedAt}.`);
  if (report.title) lines.push(`Page title: ${report.title}`);
  if (report.explore) {
    lines.push(
      `Explore: **${report.pages?.length || 1} page(s)** · signed-in: ${report.signedIn ? 'yes' : 'no'} · coverage: ${Math.round((report.coverage?.ratio || 0) * 100)}%`
    );
  }
  lines.push('');

  if (report.coverage) {
    lines.push('## Must-show coverage');
    lines.push(
      `${report.coverage.matched}/${report.coverage.total || 0} beats matched` +
        (report.coverage.complete ? ' (complete).' : '.')
    );
    for (const row of report.coverage.items || []) {
      lines.push(
        `- ${row.matched ? '✓' : '✗'} ${row.item}${row.page ? ` → \`${row.page}\`` : ''}${row.evidence ? ` (${row.evidence})` : ''}`
      );
    }
    if (report.journey?.adapted) {
      lines.push('');
      lines.push('### Recrafted journey (brief updated)');
      if (report.journey.dropped?.length) lines.push(`Dropped: ${report.journey.dropped.join('; ')}`);
      if (report.journey.added?.length) lines.push(`Added: ${report.journey.added.join('; ')}`);
      lines.push(`Use this order: ${(report.journey.mustShow || []).join(' → ')}`);
    }
    lines.push('');
  }

  if (report.pages?.length > 1) {
    lines.push('## Explored routes');
    for (const p of report.pages) {
      lines.push(
        `- hop ${p.hop}: \`${p.path || p.url}\`${p.title ? ` — ${p.title}` : ''}${p.via ? ` (via ${p.via})` : ''}`
      );
    }
    lines.push('');
  }

  if (report.recommendations?.length) {
    lines.push('## Recommendations for flow.mjs');
    for (const r of report.recommendations) lines.push(`- **${r.kind}:** ${r.text}`);
    lines.push('');
  }

  const canvases = report.canvases || [];
  if (canvases.length) {
    lines.push('## Canvases / WebGL');
    for (const c of canvases) {
      const bits = [
        c.contexts?.join('+') || 'no-context',
        c.frameworks?.length ? `frameworks: ${c.frameworks.join(', ')}` : null,
        c.interactions?.reactsToDrag ? 'reacts to drag' : null,
        c.interactions?.reactsToWheel ? 'reacts to wheel' : null,
        c.interactions?.reactsToClick ? 'reacts to click' : null,
        c.cursor ? `cursor: ${c.cursor}` : null,
        c.box ? `${c.box.w}×${c.box.h}` : null,
      ].filter(Boolean);
      lines.push(`### ${c.label || c.id || `canvas[${c.index}]`}`);
      lines.push(bits.join(' · '));
      if (c.interactions?.listenerTypes?.length) {
        lines.push(`Listeners: ${c.interactions.listenerTypes.join(', ')}`);
      }
      if (c.flowSnippet) {
        lines.push('```js');
        lines.push(c.flowSnippet);
        lines.push('```');
      }
      lines.push('');
    }
  }

  const controls = report.dom?.controls || [];
  if (controls.length) {
    lines.push('## Interactive controls (DOM)');
    lines.push('| Role / tag | Name | Playwright hint |');
    lines.push('| --- | --- | --- |');
    for (const c of controls.slice(0, 40)) {
      lines.push(`| ${c.role || c.tag} | ${String(c.name || '').replace(/\|/g, '/')} | \`${(c.playwright || '').replace(/\|/g, '\\|')}\` |`);
    }
    if (controls.length > 40) lines.push(`| … | ${controls.length - 40} more | |`);
    lines.push('');
  }

  const forms = report.dom?.forms || [];
  if (forms.length) {
    lines.push('## Forms & fill recipes');
    lines.push('Fill these in order before submit. Values are chosen to satisfy declared HTML validation so the recording does not stall on empty/invalid fields.');
    lines.push('');
    for (const form of forms) {
      lines.push(`### ${form.label || form.id || form.name || `Form ${form.index}`}${form.kind && form.kind !== 'unknown' ? ` · _${form.kind}_` : ''}`);
      if (form.action) lines.push(`Action: \`${form.method || 'GET'} ${form.action}\``);
      lines.push('| Field | Required | Constraints | Suggested fill |');
      lines.push('| --- | --- | --- | --- |');
      for (const f of form.fields || []) {
        if (f.fill?.skip && f.purpose === 'hidden') continue;
        const name = String(f.label || f.name || f.id || f.purpose || 'field').replace(/\|/g, '/');
        const req = f.required ? 'yes' : '';
        const constraints = [
          f.type && f.type !== 'text' ? `type=${f.type}` : null,
          f.pattern ? `pattern` : null,
          f.minLength != null ? `minLen=${f.minLength}` : null,
          f.maxLength != null ? `maxLen=${f.maxLength}` : null,
          f.min != null && f.min !== '' ? `min=${f.min}` : null,
          f.max != null && f.max !== '' ? `max=${f.max}` : null,
          f.validation?.emptyMessage ? `empty:“${String(f.validation.emptyMessage).slice(0, 40)}”` : null,
        ]
          .filter(Boolean)
          .join(', ');
        let suggested = '—';
        if (f.fill?.skip) suggested = `skip — ${f.fill.reason || ''}`.trim();
        else if (f.fill?.strategy === 'env') suggested = `\`${f.fill.value}\` (env)`;
        else if (f.fill?.strategy === 'selectOption') suggested = `select \`${f.fill.value}\`${f.fill.label ? ` (${f.fill.label})` : ''}`;
        else if (f.fill?.strategy === 'check') suggested = 'check';
        else if (f.fill?.value != null) suggested = `\`${String(f.fill.value).replace(/\|/g, '/')}\``;
        if (f.fill?.notes) suggested += ` — ${String(f.fill.notes).replace(/\|/g, '/').slice(0, 80)}`;
        if (f.playwright) suggested += `<br>\`${f.playwright.replace(/\|/g, '\\|')}\``;
        lines.push(`| ${name} | ${req} | ${constraints || '—'} | ${suggested} |`);
      }
      if (form.submit) {
        lines.push('');
        lines.push(`Submit control: **${form.submit.name || 'Submit'}** \`${form.submit.playwright || ''}\` — only click when the story should advance; never place a real order/payment.`);
      }
      lines.push('');
    }
  }

  if (report.dom?.headings?.length) {
    lines.push('## Headings');
    for (const h of report.dom.headings.slice(0, 20)) lines.push(`- h${h.level}: ${h.text}`);
    lines.push('');
  }

  lines.push(
    '_Source of truth: `flow-analysis.json`. Re-run `node cli.mjs analyze <slug> --explore` after login or route changes (Studio always explores)._'
  );
  lines.push('');
  return lines.join('\n');
}

function canvasFlowSnippet(c) {
  if (!c.interactions?.reactsToDrag && !c.interactions?.reactsToWheel) return null;
  return `const viewer = page.locator('canvas').nth(${c.index});
await frame(viewer, { holdMs: 350, align: 'nearest' });
const box = await viewer.boundingBox();
if (box) {
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.45;
  await actions.hide();
  try {
    await page.mouse.move(cx, cy);
${
  c.interactions.reactsToDrag
    ? `    await page.mouse.down();
    await page.mouse.move(cx + 110, cy - 20, { steps: 10 });
    await page.mouse.up();`
    : ''
}
${
  c.interactions.reactsToWheel
    ? `    await page.mouse.wheel(0, -120);`
    : ''
}
  } finally {
    await actions.show();
  }
}`;
}

/** Page-side inventory + canvas metadata (must be self-contained — Playwright serializes it). */
function inventoryInPage() {
  const POINTER = [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mousemove',
    'mouseup',
    'click',
    'dblclick',
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'contextmenu',
  ];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    return true;
  };
  const textOf = (el) =>
    (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  const controls = [];
  const seen = new Set();
  const push = (el, role, name) => {
    if (!name || name.length < 1 || name.length > 80) return;
    const key = `${role}|${name}|${el.tagName}`;
    if (seen.has(key)) return;
    seen.add(key);
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    let playwright = '';
    if (role && name) {
      playwright = `page.getByRole('${role}', { name: /${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}/i })`;
    } else if (el.getAttribute('aria-label')) {
      playwright = `page.getByLabel(/${String(el.getAttribute('aria-label')).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/i)`;
    }
    controls.push({
      tag,
      role: role || el.getAttribute('role') || null,
      name,
      playwright,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    });
  };

  for (const el of document.querySelectorAll(
    'button, [role="button"], a[href], input, select, textarea, [role="tab"], [role="menuitem"], [role="link"], [role="checkbox"], [role="switch"]'
  )) {
    if (!visible(el)) continue;
    const role =
      el.getAttribute('role') ||
      (el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' ? 'button' : el.tagName === 'INPUT' ? el.type : null);
    push(el, role, textOf(el) || el.getAttribute('placeholder') || el.getAttribute('name') || '');
  }

  const headings = [...document.querySelectorAll('h1,h2,h3')]
    .filter(visible)
    .map((el) => ({ level: Number(el.tagName[1]), text: textOf(el) }))
    .filter((h) => h.text);

  const nav = [...document.querySelectorAll('nav a, [role="navigation"] a, [role="menubar"] [role="menuitem"]')]
    .filter(visible)
    .map((el) => ({ name: textOf(el), href: el.href || null }))
    .filter((n) => n.name)
    .slice(0, 30);

  const loginHints = controls.some((c) => /log ?in|sign ?in|email|password|hasło|anmelden/i.test(c.name || ''));

  const labelFor = (el) => {
    const fromLabelEl = (lbl) => {
      if (!lbl) return '';
      // Strip nested controls so <label>Email <input></label> stays "Email",
      // and <label>Size <select>…options…</select></label> does not suck in every option.
      const clone = lbl.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
      return textOf(clone);
    };
    if (el.id) {
      const t = fromLabelEl(document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (t) return t;
    }
    const wrap = fromLabelEl(el.closest('label'));
    if (wrap) return wrap;
    const aria = el.getAttribute('aria-labelledby');
    if (aria) {
      return aria
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    }
    return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || '').slice(0, 80);
  };

  const describeField = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || tag).toLowerCase();
    const label = labelFor(el);
    const name = el.name || null;
    const id = el.id || null;
    let playwright = '';
    if (label) {
      playwright =
        type === 'checkbox' || type === 'radio'
          ? `page.getByRole('${type === 'radio' ? 'radio' : 'checkbox'}', { name: /${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}/i })`
          : `page.getByLabel(/${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}/i)`;
    } else if (id) playwright = `page.locator('#${CSS.escape(id)}')`;
    else if (name) playwright = `page.locator('[name="${String(name).replace(/"/g, '\\"')}"]')`;

    const options =
      tag === 'select'
        ? [...el.options].map((o) => ({
            value: o.value,
            label: (o.textContent || '').replace(/\s+/g, ' ').trim(),
            disabled: o.disabled,
            placeholder: o.disabled || o.value === '' || /select|choose|pick|wybierz/i.test(o.textContent || ''),
          }))
        : undefined;

    let emptyMessage = '';
    try {
      if (typeof el.checkValidity === 'function') {
        const prev = el.value;
        if (tag !== 'select' && type !== 'checkbox' && type !== 'radio' && type !== 'file') {
          el.value = '';
          el.checkValidity();
          emptyMessage = el.validationMessage || '';
          el.value = prev;
        } else if (el.required) {
          el.checkValidity();
          emptyMessage = el.validationMessage || '';
        }
      }
    } catch {
      /* ignore */
    }

    return {
      tag,
      type,
      name,
      id,
      label,
      placeholder: el.placeholder || null,
      autocomplete: el.autocomplete || el.getAttribute('autocomplete') || null,
      inputMode: el.inputMode || el.getAttribute('inputmode') || null,
      required: Boolean(el.required),
      disabled: Boolean(el.disabled),
      readOnly: Boolean(el.readOnly),
      multiple: Boolean(el.multiple),
      hidden: el.type === 'hidden' || !visible(el),
      pattern: el.getAttribute('pattern') || null,
      minLength: el.minLength >= 0 && el.hasAttribute('minlength') ? el.minLength : null,
      maxLength: el.maxLength >= 0 && el.maxLength < 100000 && el.hasAttribute('maxlength') ? el.maxLength : null,
      min: el.min !== undefined && el.min !== '' ? el.min : null,
      max: el.max !== undefined && el.max !== '' ? el.max : null,
      step: el.step !== undefined && el.step !== '' ? el.step : null,
      accept: el.accept || null,
      value: type === 'password' ? null : (el.value || null),
      options,
      playwright,
      validation: emptyMessage ? { emptyMessage } : null,
    };
  };

  const inferFormKind = (formEl, fields) => {
    const blob = [
      formEl?.id,
      formEl?.name,
      formEl?.getAttribute?.('action'),
      formEl?.getAttribute?.('aria-label'),
      ...fields.map((f) => `${f.label || ''} ${f.name || ''} ${f.type || ''}`),
    ]
      .join(' ')
      .toLowerCase();
    if (/sign[\s_-]?up|register|create account|dołącz|registr/i.test(blob)) return 'signup';
    if (/log[\s_-]?in|sign[\s_-]?in|anmelden|zaloguj|auth/i.test(blob) || (fields.some((f) => f.type === 'password') && fields.some((f) => /email|user/i.test(`${f.type} ${f.name} ${f.label}`))))
      return 'login';
    if (/search|szukaj/i.test(blob)) return 'search';
    if (/checkout|payment|pay|bestell|zamów/i.test(blob)) return 'checkout';
    if (/contact|newsletter|subscribe/i.test(blob)) return 'contact';
    return 'unknown';
  };

  const forms = [];
  const formEls = [...document.querySelectorAll('form')];
  formEls.forEach((formEl, index) => {
    const fieldEls = [...formEl.querySelectorAll('input, select, textarea')];
    const fields = fieldEls.map(describeField);
    const kind = inferFormKind(formEl, fields);
    const submitEl =
      formEl.querySelector('button[type="submit"], input[type="submit"], button:not([type])') ||
      formEl.querySelector('[type="submit"]');
    const submit = submitEl
      ? {
          name: textOf(submitEl) || submitEl.value || 'Submit',
          playwright: textOf(submitEl)
            ? `page.getByRole('button', { name: /${textOf(submitEl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)}/i })`
            : null,
        }
      : null;
    forms.push({
      index,
      id: formEl.id || null,
      name: formEl.name || null,
      label: formEl.getAttribute('aria-label') || formEl.getAttribute('name') || formEl.id || `form[${index}]`,
      action: formEl.getAttribute('action') || null,
      method: (formEl.getAttribute('method') || 'get').toUpperCase(),
      kind,
      fields,
      submit,
    });
  });

  // Loose fields (React / custom UI often omits <form>)
  const inForm = new Set(formEls.flatMap((f) => [...f.querySelectorAll('input, select, textarea')]));
  const loose = [...document.querySelectorAll('input, select, textarea')].filter((el) => !inForm.has(el) && visible(el) && el.type !== 'hidden');
  if (loose.length) {
    const fields = loose.map(describeField);
    forms.push({
      index: forms.length,
      id: null,
      name: null,
      label: 'Loose fields (no <form>)',
      action: null,
      method: null,
      kind: inferFormKind(null, fields),
      fields,
      submit: null,
    });
  }

  const frameworks = [];
  for (const f of [
    ['three', !!(window.THREE || window.__THREE__)],
    ['babylon', !!(window.BABYLON || window.Babylon)],
    ['playcanvas', !!(window.pc && window.pc.Application)],
    ['unity', !!(window.unityInstance || window.UnityLoader)],
    ['mapbox', !!(window.mapboxgl || window.Mapbox)],
    ['deck.gl', !!(window.deck || window.DeckGL)],
    ['cesium', !!window.Cesium],
    ['pixi', !!window.PIXI],
    ['fabric', !!window.fabric],
    ['konva', !!window.Konva],
    ['aframe', !!window.AFRAME],
  ]) {
    if (f[1]) frameworks.push(f[0]);
  }

  const listenerLog = Array.isArray(window.__wtListenerLog) ? window.__wtListenerLog.slice() : [];

  const canvases = [...document.querySelectorAll('canvas')].map((el, index) => {
    const r = el.getBoundingClientRect();
    const contexts = [];
    for (const type of ['webgl2', 'webgl', 'experimental-webgl', '2d', 'bitmaprenderer', 'webgpu']) {
      try {
        if (el.getContext(type)) contexts.push(type === 'experimental-webgl' ? 'webgl' : type);
      } catch {
        /* ignore */
      }
    }
    const uniqueCtx = [...new Set(contexts)];
    const id = el.id || null;
    const cls = (el.className && String(el.className).baseVal) || el.className || '';
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (id ? `#${id}` : null) ||
      (cls ? `.${String(cls).trim().split(/\s+/)[0]}` : null) ||
      `canvas[${index}]`;

    const propHandlers = POINTER.filter((t) => typeof el[`on${t}`] === 'function');
    const attrHandlers = POINTER.filter((t) => el.hasAttribute(`on${t}`));
    const logged = listenerLog
      .filter((e) => e.index === index || e.id === id)
      .map((e) => e.type);

    return {
      index,
      id,
      label,
      className: String(cls).slice(0, 120),
      visible: visible(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      widthAttr: el.width,
      heightAttr: el.height,
      contexts: uniqueCtx,
      cursor: getComputedStyle(el).cursor || '',
      tabindex: el.tabIndex,
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      listenerTypes: [...new Set([...propHandlers, ...attrHandlers, ...logged])],
      parentTag: el.parentElement?.tagName?.toLowerCase() || null,
      parentClass: (el.parentElement?.className && String(el.parentElement.className).slice(0, 80)) || null,
    };
  });

  return {
    title: document.title,
    url: location.href,
    frameworks,
    controls: controls.slice(0, 80),
    headings: headings.slice(0, 30),
    nav,
    loginHints,
    forms: forms.slice(0, 12),
    canvases,
    listenerLog: listenerLog.slice(0, 200),
  };
}

/** Init script: spy on canvas (and canvas-host) listener registration before app code runs. */
function listenerSpyInit() {
  window.__wtListenerLog = [];
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      const isCanvas = this instanceof HTMLCanvasElement;
      const host =
        this instanceof Element &&
        (this.querySelector?.('canvas') || (this.tagName === 'CANVAS' ? this : null));
      if (isCanvas || host) {
        const canvas = isCanvas ? this : host instanceof HTMLCanvasElement ? host : this.querySelector?.('canvas');
        const all = canvas ? [...document.querySelectorAll('canvas')] : [];
        window.__wtListenerLog.push({
          type: String(type),
          id: canvas?.id || null,
          index: canvas ? all.indexOf(canvas) : -1,
          on: isCanvas ? 'canvas' : 'host',
        });
      }
    } catch {
      /* ignore */
    }
    return orig.call(this, type, fn, opts);
  };
}

async function sampleCanvas(page, index) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll('canvas')[i];
    if (!el) return null;
    try {
      // Prefer 2d readback when possible; WebGL needs preserveDrawingBuffer or toDataURL
      return el.toDataURL('image/png').slice(0, 200) + el.toDataURL('image/png').length;
    } catch {
      return `opaque:${el.width}x${el.height}:${el.getBoundingClientRect().width}`;
    }
  }, index);
}

async function probeCanvasInteractions(page, canvas) {
  const result = {
    reactsToDrag: false,
    reactsToWheel: false,
    reactsToClick: false,
    listenerTypes: canvas.listenerTypes || [],
    confidence: 'low',
  };
  if (!canvas.visible || !canvas.box || canvas.box.w < 40 || canvas.box.h < 40) return result;

  const box = canvas.box;
  const cx = box.x + box.w * 0.55;
  const cy = box.y + box.h * 0.45;

  try {
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(80);
    const cursor = await page.evaluate((i) => {
      const el = document.querySelectorAll('canvas')[i];
      return el ? getComputedStyle(el).cursor : '';
    }, canvas.index);
    if (cursor) canvas.cursor = cursor;

    const before = await sampleCanvas(page, canvas.index);

    // Drag probe
    await page.mouse.down();
    await page.mouse.move(cx + Math.min(120, box.w * 0.2), cy - Math.min(40, box.h * 0.1), { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterDrag = await sampleCanvas(page, canvas.index);
    result.reactsToDrag = Boolean(before && afterDrag && before !== afterDrag);

    // Wheel probe
    const beforeWheel = await sampleCanvas(page, canvas.index);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(200);
    const afterWheel = await sampleCanvas(page, canvas.index);
    result.reactsToWheel = Boolean(beforeWheel && afterWheel && beforeWheel !== afterWheel);

    // Click probe (separate sample)
    const beforeClick = await sampleCanvas(page, canvas.index);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(150);
    const afterClick = await sampleCanvas(page, canvas.index);
    result.reactsToClick = Boolean(beforeClick && afterClick && beforeClick !== afterClick);
  } catch {
    /* probe best-effort */
  }

  const signals =
    (result.reactsToDrag ? 1 : 0) +
    (result.reactsToWheel ? 1 : 0) +
    (result.listenerTypes.length ? 1 : 0) +
    (canvas.contexts?.some((c) => c.startsWith('webgl')) ? 1 : 0) +
    (canvas.frameworks?.length ? 1 : 0);
  result.confidence = signals >= 3 ? 'high' : signals >= 2 ? 'medium' : 'low';
  return result;
}

async function dismissCookies(page) {
  const btn = page.getByRole('button', { name: /allow all|accept all|agree|akceptuj|zgadzam|zustimmen/i }).first();
  if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * Soft-validate suggested fills without submitting: empty → message, then suggested → valid?
 * Mutates form.fields[].validation in place.
 */
async function probeFormFills(page, forms) {
  return page.evaluate((formList) => {
    const findField = (form, field) => {
      const root = form.id
        ? document.getElementById(form.id)
        : form.index != null
          ? document.querySelectorAll('form')[form.index]
          : null;
      const scope = root || document;
      if (field.id) {
        const el = document.getElementById(field.id);
        if (el) return el;
      }
      if (field.name) {
        const el = scope.querySelector(`[name="${CSS.escape(field.name)}"]`);
        if (el) return el;
      }
      return null;
    };

    return formList.map((form) => {
      const fields = (form.fields || []).map((field) => {
        const fill = field.fill;
        if (!fill || fill.skip || fill.strategy === 'env' || fill.strategy === 'check' || fill.strategy === 'selectOption') {
          return field;
        }
        const el = findField(form, field);
        if (!el || typeof el.checkValidity !== 'function') return field;
        const validation = { ...(field.validation || {}) };
        try {
          const prev = el.value;
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          const emptyOk = el.checkValidity();
          validation.emptyValid = emptyOk;
          validation.emptyMessage = el.validationMessage || validation.emptyMessage || '';
          el.value = String(fill.value ?? '');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          const filledOk = el.checkValidity();
          validation.suggestedValid = filledOk;
          validation.suggestedMessage = filledOk ? '' : el.validationMessage || '';
          el.value = prev;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (err) {
          validation.probeError = String(err?.message || err);
        }
        return { ...field, validation };
      });
      return { ...form, fields };
    });
  }, forms);
}

const DANGEROUS_NAV =
  /log\s*out|sign\s*out|delete|remove account|destroy|cancel sub|unsubscribe|pay now|checkout|purchase|buy now|empty trash|permanently|wipe|reset password/i;

const NAV_BOOST =
  /nav|sidebar|menu|settings|dashboard|home|project|inbox|people|team|board|workspace|account|profile|docs|report|calendar|invite|billing|admin|overview|library|files|search/i;

function readMustShow(video) {
  const p = join(video.dir, 'brief.json');
  if (!existsSync(p)) return [];
  try {
    const brief = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(brief?.story?.mustShow) ? brief.story.mustShow.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url || '/';
  }
}

/** Inventory + form fills + canvas probes for the current page. */
export async function capturePageReport(page, video, { say = () => {}, runId, probeForms = true, probeCanvasesFull = true } = {}) {
  const inv = await page.evaluate(inventoryInPage);
  for (const c of inv.canvases) {
    c.frameworks = inv.frameworks.slice();
    const fromLog = (inv.listenerLog || [])
      .filter((e) => e.index === c.index || (c.id && e.id === c.id))
      .map((e) => e.type);
    c.listenerTypes = [...new Set([...(c.listenerTypes || []), ...fromLog])];
  }

  let forms = enrichFormsWithFills(inv.forms || [], { runId, slug: video.slug });
  const fillCount = forms.reduce((n, f) => n + (f.fields || []).filter((x) => x.fill && !x.fill.skip).length, 0);
  if (probeForms && fillCount) {
    say(`Probing ${fillCount} fill recipe(s) against HTML validity (no submit)`);
    try {
      forms = await probeFormFills(page, forms);
    } catch (err) {
      say(`Form validity probe skipped: ${err.message || err}`);
    }
  }

  const visible = inv.canvases.filter((c) => c.visible);
  if (probeCanvasesFull && visible.length) {
    say(`Probing ${visible.length} visible canvas(es) for pointer reactions`);
  }
  for (const c of inv.canvases) {
    if (!c.visible) {
      c.interactions = {
        reactsToDrag: false,
        reactsToWheel: false,
        reactsToClick: false,
        listenerTypes: c.listenerTypes || [],
        confidence: 'low',
      };
      continue;
    }
    if (probeCanvasesFull) {
      c.interactions = await probeCanvasInteractions(page, c);
    } else {
      c.interactions = {
        reactsToDrag: false,
        reactsToWheel: false,
        reactsToClick: false,
        listenerTypes: c.listenerTypes || [],
        confidence: c.listenerTypes?.length ? 'medium' : 'low',
      };
    }
    c.score = scoreCanvas(c);
    c.flowSnippet = canvasFlowSnippet(c);
  }

  const needsLogin =
    Boolean(inv.loginHints) ||
    forms.some((f) => f.kind === 'login' || (f.fields || []).some((x) => x.purpose === 'password' && f.kind !== 'signup'));

  return {
    url: inv.url || page.url(),
    path: pathOf(inv.url || page.url()),
    title: inv.title || '',
    dom: {
      controls: inv.controls,
      headings: inv.headings,
      nav: inv.nav,
      forms,
    },
    frameworks: inv.frameworks,
    canvases: inv.canvases.sort((a, b) => (b.score || 0) - (a.score || 0)),
    hints: {
      needsLogin,
      hasWebGL: inv.canvases.some((c) => c.contexts?.some((t) => String(t).startsWith('webgl'))),
      interactiveCanvasCount: inv.canvases.filter((c) => c.interactions?.reactsToDrag || c.interactions?.reactsToWheel).length,
      formCount: forms.length,
      fillableFieldCount: fillCount,
      requiredFieldCount: forms.reduce(
        (n, f) => n + (f.fields || []).filter((x) => x.required && x.fill && !x.fill.skip).length,
        0
      ),
    },
    loginHints: inv.loginHints || null,
  };
}

function pageHintsAggregate(pages) {
  return {
    needsLogin: pages.some((p) => p.hints?.needsLogin),
    hasWebGL: pages.some((p) => p.hints?.hasWebGL),
    interactiveCanvasCount: pages.reduce((n, p) => n + (p.hints?.interactiveCanvasCount || 0), 0),
    formCount: pages.reduce((n, p) => n + (p.hints?.formCount || 0), 0),
    fillableFieldCount: pages.reduce((n, p) => n + (p.hints?.fillableFieldCount || 0), 0),
    requiredFieldCount: pages.reduce((n, p) => n + (p.hints?.requiredFieldCount || 0), 0),
  };
}

function pickPrimaryPage(pages) {
  if (!pages.length) return null;
  // Prefer the richest signed-in page; else the last hop; else first.
  const scored = [...pages].sort((a, b) => {
    const ac = (a.dom?.controls?.length || 0) + (a.dom?.forms?.length || 0) * 3 + (a.canvases?.length || 0);
    const bc = (b.dom?.controls?.length || 0) + (b.dom?.forms?.length || 0) * 3 + (b.canvases?.length || 0);
    return bc - ac;
  });
  return scored[0];
}

function navCandidates(pageReport, triedKeys, { deeper = false } = {}) {
  const items = [];
  for (const c of pageReport.dom?.controls || []) {
    const name = String(c.name || '');
    const hint = String(c.playwright || '');
    if (DANGEROUS_NAV.test(name) || DANGEROUS_NAV.test(hint)) continue;
    const key = `${c.role}|${name}|${hint}`.toLowerCase();
    if (triedKeys.has(key)) continue;
    let score = 0;
    if (c.role === 'link') score += 3;
    if (c.role === 'tab') score += 4;
    if (c.role === 'menuitem') score += 4;
    if (c.tag === 'a') score += 2;
    if (NAV_BOOST.test(name)) score += 5;
    if (c.role === 'button' && NAV_BOOST.test(name)) score += 3;
    if (deeper && c.role === 'button') score += 1;
    if (score < (deeper ? 2 : 3)) continue;
    items.push({ ...c, key, score });
  }
  for (const n of pageReport.dom?.nav || []) {
    const name = String(n.text || n.name || n.label || '');
    const hint = String(n.playwright || n.href || '');
    if (!name || DANGEROUS_NAV.test(name)) continue;
    const key = `nav|${name}|${hint}`.toLowerCase();
    if (triedKeys.has(key)) continue;
    items.push({
      role: 'link',
      name,
      playwright: n.playwright || null,
      href: n.href || null,
      key,
      score: 6 + (NAV_BOOST.test(name) ? 2 : 0),
    });
  }
  return items.sort((a, b) => b.score - a.score).slice(0, deeper ? 16 : 12);
}

async function tryClickCandidate(page, candidate) {
  const before = page.url();
  try {
    if (candidate.playwright) {
      const loc = page.locator(candidate.playwright).first();
      if (await loc.isVisible({ timeout: 2500 }).catch(() => false)) {
        await loc.click({ timeout: 8000 });
        await page.waitForTimeout(900);
        return { ok: true, via: candidate.name || candidate.playwright, urlChanged: page.url() !== before };
      }
    }
    if (candidate.href && /^https?:/i.test(candidate.href)) {
      await page.goto(candidate.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(800);
      return { ok: true, via: candidate.name || candidate.href, urlChanged: page.url() !== before };
    }
    if (candidate.name) {
      const byRole = page.getByRole(candidate.role || 'link', { name: candidate.name }).first();
      if (await byRole.isVisible({ timeout: 2000 }).catch(() => false)) {
        await byRole.click({ timeout: 8000 });
        await page.waitForTimeout(900);
        return { ok: true, via: candidate.name, urlChanged: page.url() !== before };
      }
      const byText = page.getByText(candidate.name, { exact: true }).first();
      if (await byText.isVisible({ timeout: 1500 }).catch(() => false)) {
        await byText.click({ timeout: 8000 });
        await page.waitForTimeout(900);
        return { ok: true, via: candidate.name, urlChanged: page.url() !== before };
      }
    }
  } catch {
    /* candidate best-effort */
  }
  return { ok: false };
}

async function trySignIn(page, video, say) {
  const email = video.config.env?.email;
  const password = video.config.env?.password;
  if (!email || !password) {
    say('No demo credentials in env — exploring signed-out surface');
    return { ok: false, reason: 'no-credentials' };
  }
  const pwd = page.locator('input[type="password"]').first();
  if (!(await pwd.isVisible({ timeout: 3500 }).catch(() => false))) {
    return { ok: false, reason: 'no-login-form' };
  }
  say('Signing in with project demo credentials');
  const emailLoc = page
    .locator(
      'input[type="email"], input[name*="email" i], input[autocomplete="username"], input[autocomplete="email"], input[type="text"]'
    )
    .first();
  if (await emailLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailLoc.fill(String(email));
  }
  await pwd.fill(String(password));
  const submit = page.getByRole('button', { name: /log\s*in|sign\s*in|continue|submit|zaloguj|anmelden/i }).first();
  if (await submit.isVisible({ timeout: 2000 }).catch(() => false)) {
    await submit.click({ timeout: 10000 }).catch(() => pwd.press('Enter'));
  } else {
    await pwd.press('Enter');
  }
  await page.waitForTimeout(2800);
  await dismissCookies(page);
  const stillPwd = await pwd.isVisible({ timeout: 800 }).catch(() => false);
  if (stillPwd) {
    say('Sign-in may have failed — continuing with the current page');
    return { ok: false, reason: 'still-on-login' };
  }
  return { ok: true };
}

function writeAnalysisFiles(video, report, say) {
  mkdirSync(video.dir, { recursive: true });
  const jsonPath = join(video.dir, 'flow-analysis.json');
  const mdPath = join(video.dir, 'flow-analysis.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(mdPath, analysisToMarkdown(report));
  say(`Wrote ${jsonPath}`);
  return { jsonPath, mdPath };
}

/**
 * Analyze a video's start URL (or override) and write flow-analysis.json / .md.
 * Pass explore:true (or CLI --explore) to crawl, cover mustShow, and recraft the brief.
 * @param {object} video loadVideo() result
 * @param {{ headed?: boolean, url?: string, onProgress?: (msg: string) => void, explore?: boolean, maxPages?: number, maxMs?: number }} [opts]
 */
export async function analyzeFlow(video, opts = {}) {
  if (opts.explore) return exploreFlow(video, opts);

  const say = (msg) => {
    opts.onProgress?.(msg);
    console.log(`› ${msg}`);
  };

  const startUrl = opts.url || video.config.record?.startUrl || video.config.env?.appUrl || video.config.env?.marketingUrl;
  if (!startUrl) throw new Error('No URL to analyze — set record.startUrl or pass --url');

  const viewport = video.config.record?.viewport || { width: 1920, height: 1080 };
  const dpr = video.config.record?.deviceScaleFactor === 1 ? 1 : 2;
  const runId = Date.now().toString(36);

  say(`Opening ${startUrl}`);
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
    await context.addInitScript(listenerSpyInit);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await dismissCookies(page);
    await page.waitForTimeout(1200);

    say('Inventorying controls, forms and canvases');
    const snap = await capturePageReport(page, video, { say, runId });

    const report = {
      slug: video.slug,
      analyzedAt: new Date().toISOString(),
      url: snap.url || startUrl,
      title: snap.title || '',
      viewport,
      deviceScaleFactor: dpr,
      runId,
      dom: snap.dom,
      frameworks: snap.frameworks,
      canvases: snap.canvases,
      hints: snap.hints,
    };
    report.recommendations = buildRecommendations(report);
    writeAnalysisFiles(video, report, say);
    say(
      `${report.dom.controls.length} controls · ${report.hints.formCount} forms · ${report.hints.fillableFieldCount} fills · ${report.canvases.length} canvases · ${report.hints.interactiveCanvasCount} pointer-reactive · ${report.recommendations.length} tips`
    );
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Bounded signed-in explore: map multiple routes, score mustShow, deepen if unmet, recraft brief.
 */
export async function exploreFlow(
  video,
  { headed = false, url, onProgress, maxPages = 18, maxMs = 3 * 60 * 1000 } = {}
) {
  const say = (msg) => {
    onProgress?.(msg);
    console.log(`› ${msg}`);
  };

  const startUrl = url || video.config.record?.startUrl || video.config.env?.appUrl || video.config.env?.marketingUrl;
  if (!startUrl) throw new Error('No URL to analyze — set record.startUrl or pass --url');

  const mustShow = readMustShow(video);
  const viewport = video.config.record?.viewport || { width: 1920, height: 1080 };
  const dpr = video.config.record?.deviceScaleFactor === 1 ? 1 : 2;
  const runId = Date.now().toString(36);
  const t0 = Date.now();

  say(`Exploring ${startUrl} (up to ${maxPages} pages / ${Math.round(maxMs / 1000)}s)`);
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });

  const pages = [];
  const visitedPaths = new Set();
  const triedKeys = new Set();
  let signedIn = false;
  let deeper = false;

  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
    await context.addInitScript(listenerSpyInit);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await dismissCookies(page);
    await page.waitForTimeout(800);

    // First inventory — may be a login wall
    say('Inventorying start page');
    let snap = await capturePageReport(page, video, { say, runId, probeCanvasesFull: true });
    pages.push({ ...snap, hop: 0, via: null, signedIn: false });
    visitedPaths.add(snap.path);

    if (snap.hints?.needsLogin || snap.loginHints) {
      const login = await trySignIn(page, video, say);
      if (login.ok) {
        signedIn = true;
        await page.waitForTimeout(1000);
        say('Re-inventorying after sign-in');
        snap = await capturePageReport(page, video, { say, runId, probeCanvasesFull: true });
        pages.push({ ...snap, hop: pages.length, via: 'sign-in', signedIn: true });
        visitedPaths.add(snap.path);
      }
    }

    const queue = [];
    const enqueueFrom = (report) => {
      for (const c of navCandidates(report, triedKeys, { deeper })) {
        triedKeys.add(c.key);
        queue.push(c);
      }
    };
    enqueueFrom(snap);

    while (queue.length && pages.length < maxPages && Date.now() - t0 < maxMs) {
      // Prefer coverage gaps: if mustShow unmet, keep going; else stop early when rich enough
      let coverage = scoreMustShowCoverage(mustShow, pages);
      if (coverage.complete && pages.length >= Math.min(6, maxPages) && !deeper) break;

      const candidate = queue.shift();
      if (!candidate) break;
      say(`Following “${candidate.name || candidate.playwright || 'control'}”`);
      const clicked = await tryClickCandidate(page, candidate);
      if (!clicked.ok) continue;

      await dismissCookies(page);
      const path = pathOf(page.url());
      if (visitedPaths.has(path) && !clicked.urlChanged) {
        // Same URL — still capture if DOM likely changed (tabs)
        const same = pages.filter((p) => p.path === path);
        if (same.length >= 2) continue;
      }
      visitedPaths.add(path);

      const probeFull = pages.length < 4 || /canvas|webgl|3d|editor|viewer/i.test(candidate.name || '');
      say(`Inventorying ${path}`);
      snap = await capturePageReport(page, video, {
        say,
        runId,
        probeForms: pages.length < 5,
        probeCanvasesFull: probeFull,
      });
      pages.push({
        ...snap,
        hop: pages.length,
        via: clicked.via || candidate.name,
        signedIn,
      });
      enqueueFrom(snap);

      coverage = scoreMustShowCoverage(mustShow, pages);
      if (!coverage.complete && !deeper && pages.length >= Math.min(8, maxPages - 2) && Date.now() - t0 < maxMs * 0.7) {
        deeper = true;
        say(`Must-show incomplete (${coverage.matched}/${coverage.total}) — exploring deeper`);
        enqueueFrom(snap);
      }
    }

    // Final coverage + optional last deepen pass from best page
    let coverage = scoreMustShowCoverage(mustShow, pages);
    if (!coverage.complete && pages.length < maxPages && Date.now() - t0 < maxMs) {
      deeper = true;
      say(`Coverage ${coverage.matched}/${coverage.total} — one deeper sweep`);
      const primary = pickPrimaryPage(pages);
      if (primary?.url && page.url() !== primary.url) {
        await page.goto(primary.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      enqueueFrom(primary || snap);
      while (queue.length && pages.length < maxPages && Date.now() - t0 < maxMs) {
        coverage = scoreMustShowCoverage(mustShow, pages);
        if (coverage.complete) break;
        const candidate = queue.shift();
        if (!candidate) break;
        const clicked = await tryClickCandidate(page, candidate);
        if (!clicked.ok) continue;
        await dismissCookies(page);
        const path = pathOf(page.url());
        if (visitedPaths.has(path)) continue;
        visitedPaths.add(path);
        say(`Deeper: ${path}`);
        snap = await capturePageReport(page, video, {
          say,
          runId,
          probeForms: false,
          probeCanvasesFull: false,
        });
        pages.push({ ...snap, hop: pages.length, via: clicked.via, signedIn });
      }
      coverage = scoreMustShowCoverage(mustShow, pages);
    }

    const journey = craftJourneyFromCoverage(mustShow, coverage, pages);
    if (journey.adapted) {
      say(
        journey.dropped.length
          ? `Recrafting journey — could not reach: ${journey.dropped.join('; ')}`
          : 'Recrafting journey from explored routes'
      );
      applyJourneyRecraft(video, journey);
    }

    const primary = pickPrimaryPage(pages) || pages[0];
    const report = {
      slug: video.slug,
      analyzedAt: new Date().toISOString(),
      url: primary?.url || startUrl,
      title: primary?.title || '',
      viewport,
      deviceScaleFactor: dpr,
      runId,
      explore: true,
      signedIn,
      deeper,
      maxPages,
      pages: pages.map((p) => ({
        hop: p.hop,
        url: p.url,
        path: p.path,
        title: p.title,
        via: p.via,
        signedIn: p.signedIn,
        dom: p.dom,
        frameworks: p.frameworks,
        canvases: p.canvases,
        hints: p.hints,
      })),
      // Backward-compatible top-level fields = richest page
      dom: primary?.dom || { controls: [], headings: [], nav: [], forms: [] },
      frameworks: primary?.frameworks || [],
      canvases: primary?.canvases || [],
      hints: pageHintsAggregate(pages),
      coverage,
      journey,
    };
    report.recommendations = buildRecommendations(report);
    if (!coverage.complete) {
      report.recommendations.unshift({
        kind: 'explore',
        text: journey.adapted
          ? `Original must-show was partially unreachable. Brief journey recrafted to: ${(journey.mustShow || []).join(' → ')}. Author flow.mjs to this list only.`
          : `Must-show still incomplete (${coverage.unmet.join('; ')}). Prefer explored routes in flow.mjs and mark missing beats // TODO(verify selector).`,
      });
    } else if (report.explore) {
      report.recommendations.unshift({
        kind: 'explore',
        text: `Explored ${pages.length} page(s)${signedIn ? ' while signed in' : ''}. Prefer Playwright hints from the matching route hop when writing each chapter.`,
      });
    }

    writeAnalysisFiles(video, report, say);
    say(
      `${pages.length} pages · coverage ${coverage.matched}/${coverage.total || 0}` +
        (journey.adapted ? ' · brief recrafted' : '') +
        ` · ${report.dom.controls.length} controls on primary · ${report.recommendations.length} tips`
    );
    return report;
  } finally {
    await browser.close().catch(() => {});
  }
}

export function readFlowAnalysis(video) {
  const p = join(video.dir, 'flow-analysis.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
