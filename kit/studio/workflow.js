/**
 * Production stages (Brief → Script → Record → Cut → Deliver), script review with inline
 * narration edits, and the two approval gates (script, cut). State comes from the video summary
 * (`review`, `freshness`, `deliver`) — the server owns approval truth.
 */
import { paintAgentStream } from './agentStream.js';
import { ask } from './ask.js';
import { SCENARIO_EDITABLE_NOTE, defaultSectionCollapsed } from './scriptSections.js';
import { finishScriptApproval, planScriptApproval, scriptApproveLabel } from './scriptApproval.js';

const $ = (id) => document.getElementById(id);

/** Centered dismiss glyph — text × sits off-optical-center in square buttons. */
const ICON_X =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const KIND_LABEL = { open: 'Open', plate: 'Plate', chapter: 'Chapter', step: 'Caption', close: 'Close' };
/** Mirrors kit/lib/plateTypes.mjs — used only until the script payload (which carries the catalog) loads. */
const PLATE_TYPE_FALLBACK = [
  { type: 'features', label: 'Features', hint: 'Capability grid' },
  { type: 'journey', label: 'Journey', hint: 'Ordered tour path' },
  { type: 'process', label: 'Process', hint: 'How it works' },
  { type: 'timeline', label: 'Timeline', hint: 'Milestones on a rail' },
  { type: 'checklist', label: 'Checklist', hint: 'Outcomes ticked off' },
  { type: 'logos', label: 'Logos', hint: 'Integration wall' },
  { type: 'orbit', label: 'Orbit', hint: 'Orbiting logos' },
  { type: 'testimonials', label: 'Testimonials', hint: 'Quote flood' },
  { type: 'quote', label: 'Quote', hint: 'Hero quote' },
  { type: 'stats', label: 'Stats', hint: 'Hard numbers' },
  { type: 'kpi', label: 'KPI board', hint: 'Dashboard tiles' },
  { type: 'metric', label: 'Metric', hint: 'One number' },
  { type: 'callout', label: 'Callout', hint: 'Thesis + bullets' },
  { type: 'statement', label: 'Statement', hint: 'Kinetic type' },
  { type: 'compare', label: 'Compare', hint: 'Before / after' },
  { type: 'faq', label: 'FAQ', hint: 'Questions answered' },
  { type: 'pricing', label: 'Pricing', hint: 'Plans side by side' },
  { type: 'team', label: 'People', hint: 'Roles with avatars' },
];
/** Row-editor placeholders by column; `<type>.<column>` wins over the plain column name. */
const PLATE_ROW_PLACEHOLDER = {
  label: 'Label',
  note: 'Note',
  icon: 'Icon',
  asset: 'Asset file',
  quote: 'Quote',
  author: 'Author',
  role: 'Role',
  value: 'Value',
  text: 'Bullet',
  date: 'Date (Q2 · 2025 · Now)',
  delta: 'Delta (+12% · −3)',
  period: 'per user / month',
  lines: 'Lines · separated · by dots',
  'pricing.label': 'Plan name',
  'pricing.value': 'Price ($12)',
  'pricing.note': 'Who it is for',
  'team.label': 'Name or role',
  'team.note': 'What they get',
  'team.asset': 'Photo file (optional)',
  'kpi.label': 'Metric name',
  'timeline.label': 'Milestone',
};
const STATUS_LABEL = {
  draft: 'Needs approval',
  approved: 'Approved',
  changed: 'Changed since approval',
  'changes-requested': 'Changes requested',
  none: 'Not reviewed',
};

export function initWorkflow(ctx) {
  const { api, toast, escapeHtml, getState, reload, watchJob, onStageAction, setFaviconMode, onPreviewLiveCard } = ctx;
  let script = null;
  let draftJob = null;

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  /* ---------- stage bar ---------- */

  function stages(v) {
    const f = v.freshness || {};
    const script = v.review?.script || { effective: 'draft' };
    const cut = v.review?.cut || { effective: 'none' };
    const scriptOk = script.effective === 'approved';
    const directionOk = Boolean(v.direction?.approvedAt);
    const out = {};
    out.brief = v.brief
      ? { tone: 'done', meta: `Pinned ${when(v.brief.createdAt)}` }
      : { tone: 'done', meta: 'From config' };
    out.script = {
      tone: scriptOk ? 'done' : script.effective === 'draft' ? 'active' : 'warn',
      meta: scriptOk ? `Approved ${when(script.approvedAt)}` : STATUS_LABEL[script.effective] || 'Needs approval',
    };
    out.direction = directionOk
      ? { tone: 'done', meta: `${v.direction.palette} · ${v.transitions?.style || 'directed'}` }
      : { tone: scriptOk ? 'active' : 'idle', meta: scriptOk ? 'Choose visual language' : 'After script' };
    if (!f.liveAt) {
      out.record = {
        tone: scriptOk && directionOk ? 'active' : 'idle',
        meta: scriptOk && directionOk ? 'Ready to record' : directionOk ? 'After script' : 'After direction',
      };
    }
    else if (f.needsRecord) out.record = { tone: 'warn', meta: 'Flow changed — re-record' };
    else out.record = { tone: 'done', meta: `Recorded ${when(new Date(f.liveAt).toISOString())}` };
    if (!v.hasDelivery) out.cut = { tone: 'idle', meta: 'No render yet' };
    else if (f.stale) out.cut = { tone: 'warn', meta: 'Out of date' };
    else if (cut.effective === 'approved') out.cut = { tone: 'done', meta: `Approved ${cut.versionName || ''}`.trim() };
    else if (cut.effective === 'changed') out.cut = { tone: 'warn', meta: 'New render since approval' };
    else if (cut.effective === 'changes-requested') out.cut = { tone: 'warn', meta: 'Changes requested' };
    else out.cut = { tone: 'active', meta: 'Awaiting review' };
    const delivered = v.deliver?.generatedAt && v.freshness?.deliveryAt && Date.parse(v.deliver.generatedAt) >= v.freshness.deliveryAt - 5000;
    out.deliver = delivered
      ? { tone: 'done', meta: `Exported ${when(v.deliver.generatedAt)}` }
      : { tone: cut.effective === 'approved' ? 'active' : 'idle', meta: cut.effective === 'approved' ? 'Ready to export' : 'After cut approval' };
    return out;
  }

  function hintFor(v, s) {
    // Out of date lives on the right of the stages stripe (not under Cut).
    if (s.cut.tone === 'warn' && s.cut.meta === 'Out of date') {
      return { text: 'Out of date — sources changed since the last render. Use Render to catch up.', tone: 'warn' };
    }
    if (s.script.tone !== 'done') {
      return { text: 'Review and approve the script before recording — narration and on-screen copy are cheap to change now.', tone: '' };
    }
    if (s.direction.tone !== 'done') {
      return { text: 'Choose the palette, guided focus and transition language before recording.', tone: '' };
    }
    // Re-record is explained by the Render bay, next to the button that fixes it.
    if (s.record.tone === 'warn') return { text: '', tone: '' };
    if (s.cut.tone === 'active') {
      return { text: 'Watch the cut, then approve it. Approval pins this exact file as a release version.', tone: '' };
    }
    if (s.cut.tone === 'warn') return { text: 'The cut changed after approval. Review it again.', tone: 'warn' };
    if (s.deliver.tone === 'active') {
      return { text: 'Approved. Export the handoff pack (MP4, captions, chapters, review notes).', tone: '' };
    }
    return { text: '', tone: '' };
  }

  function renderStageBar(v) {
    const s = stages(v);
    const order = ['brief', 'script', 'direction', 'record', 'cut', 'deliver'];
    const current = order.find((k) => s[k].tone === 'active' || s[k].tone === 'warn') || null;
    for (const key of order) {
      const btn = document.querySelector(`#stageBar .pstage[data-stage="${key}"]`);
      if (!btn) continue;
      btn.dataset.tone = s[key].tone;
      btn.classList.toggle('current', key === current);
      btn.setAttribute('aria-current', key === current ? 'step' : 'false');
      const meta = document.querySelector(`[data-stage-meta="${key}"]`);
      if (meta) {
        // "Out of date" is shown on the right-hand stage hint instead of under Cut.
        meta.textContent = key === 'cut' && s[key].meta === 'Out of date' ? 'Needs render' : s[key].meta;
      }
    }
    const hint = hintFor(v, s);
    const hintEl = $('stageHint');
    hintEl.textContent = hint.text;
    if (hint.tone) hintEl.dataset.tone = hint.tone;
    else delete hintEl.dataset.tone;
  }

  /* ---------- script sheet ---------- */

  function pill(el, effective) {
    el.textContent = STATUS_LABEL[effective] || effective;
    el.dataset.tone = effective === 'approved' ? 'ok' : effective === 'draft' || effective === 'none' ? 'neutral' : 'warn';
  }

  function chapterOptions(selected, chapters) {
    const list = chapters?.length ? chapters : script?.chapters || [];
    if (!list.length) return `<option value="">No chapters yet</option>`;
    return list
      .map((t) => `<option value="${escapeHtml(t)}"${t === selected ? ' selected' : ''}>${escapeHtml(t)}</option>`)
      .join('');
  }

  function screenOpen(s) {
    const title = (s.titleLines || []).join('\n') || s.title || '';
    return `
      <label class="ss-field"><span>Eyebrow</span><input type="text" data-struct-field="open.eyebrow" value="${escapeHtml(s.eyebrow || '')}" placeholder="Product · Brand" /></label>
      <label class="ss-field"><span>Title <i>one line per row</i></span><textarea rows="2" data-struct-field="open.title" placeholder="See the team.">${escapeHtml(title)}</textarea></label>
      <label class="ss-field"><span>Sub</span><input type="text" data-struct-field="open.sub" value="${escapeHtml(s.sub || s.onScreen || '')}" placeholder="One supporting line" /></label>`;
  }

  function screenClose(s) {
    const title = (s.titleLines || []).join('\n') || s.title || '';
    const steps = s.steps || [];
    return `
      <label class="ss-field"><span>Title <i>one line per row</i></span><textarea rows="2" data-struct-field="close.title" placeholder="See the team.">${escapeHtml(title)}</textarea></label>
      <div class="ss-steps" data-close-steps>
        <div class="ss-steps-head"><span>Close steps</span><button type="button" class="ss-mini" data-struct-action="close-step-add">+ Step</button></div>
        ${
          steps.length
            ? steps
                .map(
                  (st, si) => `<div class="ss-step" data-step-index="${si}">
              <input type="text" data-struct-field="close.step.label" data-step-index="${si}" value="${escapeHtml(st.label || '')}" placeholder="Step label" />
              <input type="text" data-struct-field="close.step.note" data-step-index="${si}" value="${escapeHtml(st.note || '')}" placeholder="Note (optional)" />
              <button type="button" class="ss-icon-btn" data-struct-action="close-step-remove" data-step-index="${si}" aria-label="Remove step">${ICON_X}</button>
            </div>`
                )
                .join('')
            : '<p class="ss-empty-steps">No steps yet — add the recap beats for the closing plate.</p>'
        }
      </div>`;
  }

  function plateRowFields(s, row, ri) {
    const fields = s.plate?.fields || ['label', 'note'];
    const pid = escapeHtml(s.plateId || '');
    const faq = s.plateType === 'faq';
    const cells = fields
      .map((f) => {
        const ph =
          PLATE_ROW_PLACEHOLDER[`${s.plateType}.${f}`] ||
          (faq && f === 'label' ? 'Question' : faq && f === 'note' ? 'Answer' : PLATE_ROW_PLACEHOLDER[f] || f);
        const val = escapeHtml(row?.[f] ?? '');
        return `<input type="text" data-struct-field="plate.row.${f}" data-plate-id="${pid}" data-row-index="${ri}" value="${val}" placeholder="${ph}" />`;
      })
      .join('');
    return `<div class="ss-plate-row" data-row-index="${ri}">
      ${cells}
      <button type="button" class="ss-icon-btn" data-struct-action="plate-row-remove" data-plate-id="${pid}" data-row-index="${ri}" aria-label="Remove row">${ICON_X}</button>
    </div>`;
  }

  function screenPlate(s) {
    const pid = escapeHtml(s.plateId || '');
    const p = s.plate || {};
    const typeLabel = escapeHtml(p.typeLabel || s.plateType || 'Plate');
    let extra = '';
    if (s.plateType === 'callout') {
      extra += `<label class="ss-field"><span>Body</span>
        <textarea rows="2" data-struct-field="plate.body" data-plate-id="${pid}" placeholder="The thesis line">${escapeHtml(p.body || '')}</textarea>
      </label>`;
    }
    if (p.listKey && p.fields?.length) {
      const rows = p.rows || [];
      const listLabel = p.listKey === 'bullets' ? 'Bullets' : p.listKey;
      extra += `<div class="ss-plate-list" data-plate-list="${escapeHtml(p.listKey)}">
        <div class="ss-steps-head"><span>${escapeHtml(listLabel)}</span>
          <button type="button" class="ss-mini" data-struct-action="plate-row-add" data-plate-id="${pid}">+ ${p.listKey === 'bullets' ? 'Bullet' : 'Row'}</button>
        </div>
        ${rows.length ? rows.map((row, ri) => plateRowFields(s, row, ri)).join('') : '<p class="ss-empty-steps">No rows yet — add the content this plate shows.</p>'}
      </div>`;
    } else if (s.plateType === 'quote') {
      extra = `
        <label class="ss-field"><span>Quote</span>
          <textarea rows="2" data-struct-field="plate.quote" data-plate-id="${pid}">${escapeHtml(p.quote || '')}</textarea>
        </label>
        <div class="ss-plate-pair">
          <label class="ss-field"><span>Author</span><input type="text" data-struct-field="plate.author" data-plate-id="${pid}" value="${escapeHtml(p.author || '')}" /></label>
          <label class="ss-field"><span>Role</span><input type="text" data-struct-field="plate.role" data-plate-id="${pid}" value="${escapeHtml(p.role || '')}" /></label>
        </div>`;
    } else if (s.plateType === 'metric') {
      extra = `
        <div class="ss-plate-pair">
          <label class="ss-field"><span>Value</span><input type="text" data-struct-field="plate.value" data-plate-id="${pid}" value="${escapeHtml(p.value || '')}" placeholder="94%" /></label>
          <label class="ss-field"><span>Unit</span><input type="text" data-struct-field="plate.unit" data-plate-id="${pid}" value="${escapeHtml(p.unit || '')}" placeholder="of teams" /></label>
        </div>
        <label class="ss-field"><span>Note</span><input type="text" data-struct-field="plate.note" data-plate-id="${pid}" value="${escapeHtml(p.note || '')}" /></label>
        <label class="ss-field"><span>Progress <i>0–1 ring fill</i></span>
          <input type="number" min="0" max="1" step="0.01" data-struct-field="plate.progress" data-plate-id="${pid}" value="${p.progress != null ? p.progress : ''}" />
        </label>`;
    } else if (s.plateType === 'compare') {
      const leftItems = (p.left?.items || []).join('\n');
      const rightItems = (p.right?.items || []).join('\n');
      extra = `
        <div class="ss-plate-pair">
          <label class="ss-field"><span>Before label</span><input type="text" data-struct-field="plate.left.label" data-plate-id="${pid}" value="${escapeHtml(p.left?.label || 'Before')}" /></label>
          <label class="ss-field"><span>After label</span><input type="text" data-struct-field="plate.right.label" data-plate-id="${pid}" value="${escapeHtml(p.right?.label || 'After')}" /></label>
        </div>
        <div class="ss-plate-pair">
          <label class="ss-field"><span>Before lines <i>one per row</i></span><textarea rows="3" data-struct-field="plate.left.items" data-plate-id="${pid}">${escapeHtml(leftItems)}</textarea></label>
          <label class="ss-field"><span>After lines <i>one per row</i></span><textarea rows="3" data-struct-field="plate.right.items" data-plate-id="${pid}">${escapeHtml(rightItems)}</textarea></label>
        </div>`;
    }
    return `
      <div class="ss-plate-head">
        <span class="ss-plate-bits">${typeLabel}</span>
        <button type="button" class="ss-mini danger" data-struct-action="plate-remove" data-plate-id="${pid}" data-title="${escapeHtml(s.plateTitle || s.title || '')}">Remove</button>
      </div>
      <label class="ss-field"><span>Eyebrow</span>
        <input type="text" data-struct-field="plate.eyebrow" data-plate-id="${pid}" value="${escapeHtml(s.eyebrow || '')}" placeholder="Section label" />
      </label>
      <label class="ss-field"><span>Title</span>
        <input type="text" data-struct-field="plate.title" data-plate-id="${pid}" value="${escapeHtml(s.plateTitle || s.title || '')}" placeholder="Plate headline" />
      </label>
      <label class="ss-field"><span>Sub</span>
        <input type="text" data-struct-field="plate.sub" data-plate-id="${pid}" value="${escapeHtml(s.sub || '')}" placeholder="Supporting line (optional)" />
      </label>
      ${extra}
      <label class="ss-field ss-place">
        <span>Appears before chapter</span>
        <select data-struct-field="plate.before" data-plate-id="${pid}">
          ${chapterOptions(s.before, s.chapters)}
        </select>
      </label>`;
  }

  function screenCall(s) {
    const editable = s.editable?.screen !== false && !s.dynamic;
    const canMove = s.editable?.move && s.flowIndex != null;
    const atStart = s.flowIndex === 0;
    const atEnd = s.flowCount != null && s.flowIndex === s.flowCount - 1;
    if (!editable) {
      return `
        <strong class="ss-title">${escapeHtml(s.title || '—')}</strong>
        ${s.onScreen ? `<span class="ss-body">${escapeHtml(s.onScreen)}</span>` : ''}
        ${s.dynamic ? `<span class="ss-src">Dynamic title — edit in flow.mjs</span>` : ''}
        ${s.flowLine ? `<span class="ss-src" title="Source in flow.mjs">flow.mjs:${s.flowLine}</span>` : ''}`;
    }
    return `
      <label class="ss-field"><span>${s.kind === 'chapter' ? 'Chapter title' : 'Caption title'}</span>
        <input type="text" data-struct-field="call.title" data-flow-index="${s.flowIndex}" value="${escapeHtml(s.title || '')}" placeholder="Short title" />
      </label>
      <label class="ss-field"><span>On screen</span>
        <textarea rows="2" data-struct-field="call.body" data-flow-index="${s.flowIndex}" placeholder="What appears under the title">${escapeHtml(s.onScreen || '')}</textarea>
      </label>
      <div class="ss-call-tools">
        ${s.flowLine ? `<span class="ss-src" title="Source in flow.mjs">flow.mjs:${s.flowLine}</span>` : '<span></span>'}
        <div class="ss-call-actions">
          ${
            canMove
              ? `<button type="button" class="ss-mini" data-struct-action="call-move" data-delta="-1" data-flow-index="${s.flowIndex}" ${atStart ? 'disabled' : ''} title="Move earlier">↑</button>
                 <button type="button" class="ss-mini" data-struct-action="call-move" data-delta="1" data-flow-index="${s.flowIndex}" ${atEnd ? 'disabled' : ''} title="Move later">↓</button>`
              : ''
          }
          <button type="button" class="ss-mini" data-struct-action="preview-card" data-kind="${s.kind === 'chapter' ? 'chapter' : 'caption'}" data-flow-index="${s.flowIndex}" title="Open live card in Program">Preview</button>
          ${
            s.kind === 'chapter'
              ? `<button type="button" class="ss-mini" data-struct-action="add-caption-after" data-flow-index="${s.flowIndex}">+ Caption</button>`
              : ''
          }
          <button type="button" class="ss-mini danger" data-struct-action="call-remove" data-flow-index="${s.flowIndex}" data-title="${escapeHtml(s.title || '')}">Remove</button>
        </div>
      </div>`;
  }

  function speedOptions(selected) {
    const cur = selected == null ? 1 : Number(selected);
    const speeds = [];
    for (let s = 0.8; s <= 1.3 + 1e-6; s = Math.round((s + 0.05) * 100) / 100) speeds.push(s);
    return speeds
      .map((s) => {
        const on = Math.abs(s - cur) < 0.01;
        const label = s < 0.97 ? `${s.toFixed(2)}× slower` : s > 1.03 ? `${s.toFixed(2)}× quicker` : `${s.toFixed(2)}× natural`;
        return `<option value="${s}"${on ? ' selected' : ''}>${label}</option>`;
      })
      .join('');
  }

  function timingStrip(s) {
    const hold = Number(s.holdSec || 0);
    const vo = Number(s.narrationSec || 0);
    const tight = vo > 0 && hold > 0 && vo > hold + 0.6;
    const fit = Math.max(hold, vo);
    if (s.timingKind === 'card' && s.editable?.hold) {
      const holdVal = hold.toFixed(1);
      return `
        <div class="ss-meta" data-timing="card">
          <div class="ss-chips${tight ? ' is-tight' : ''}">
            <label class="ss-chip ss-chip-hold" title="Seconds the card stays on screen">
              <span>Hold</span>
              <input type="number" min="0.4" max="12" step="0.1" data-struct-field="call.hold" data-flow-index="${s.flowIndex}" value="${holdVal}" aria-label="Card hold in seconds" />
              <em>s</em>
            </label>
            <button type="button" class="ss-chip-btn" data-struct-action="hold-reset" data-flow-index="${s.flowIndex}" title="Use default ${Number(s.holdDefault || 0).toFixed(1)}s" ${s.holdExplicit ? '' : 'disabled'}>Default</button>
            ${vo > 0 ? `<span class="ss-chip quiet" title="Estimated voice length">VO ${vo.toFixed(1)}s</span>` : ''}
            ${tight ? '<span class="ss-chip warn">Voice longer than hold</span>' : ''}
          </div>
        </div>`;
    }
    const kindHint = s.timingKind === 'plate' ? 'Plate' : 'Beat';
    return `
      <div class="ss-meta" data-timing="${escapeHtml(s.timingKind || 'plate')}">
        <div class="ss-chips">
          <span class="ss-chip strong" title="On-screen duration for this beat">~${fit.toFixed(1)}s</span>
          <span class="ss-chip quiet">${kindHint}</span>
        </div>
      </div>`;
  }

  function canDragScene(s) {
    if (s.kind === 'plate') return Boolean(s.editable?.place && s.plateId);
    if (s.kind === 'chapter' || s.kind === 'step') return Boolean(s.editable?.move && s.flowIndex != null);
    return false;
  }

  function sceneRow(s, i) {
    const issues = (script?.scaffold ? (s.issues || []).filter((x) => !x.message.startsWith('No narration')) : s.issues) || [];
    const worst = issues.some((x) => x.level === 'error') ? 'error' : issues.some((x) => x.level === 'warn') ? 'warn' : issues.length ? 'info' : '';
    const hasVo = Boolean((s.narration || '').trim());
    const speed = s.narrationSpeed == null ? 1 : s.narrationSpeed;
    const screen =
      s.kind === 'open' ? screenOpen(s) : s.kind === 'close' ? screenClose(s) : s.kind === 'plate' ? screenPlate(s) : screenCall(s);
    const kindLabel =
      s.kind === 'plate' && s.plate?.typeLabel
        ? s.plate.typeLabel
        : KIND_LABEL[s.kind] || s.kind;
    const role =
      s.kind === 'chapter' ? 'Chapter' : s.kind === 'step' ? 'Caption' : s.kind === 'open' ? 'Open' : s.kind === 'close' ? 'Close' : 'Plate';
    const draggable = canDragScene(s);
    const previewTitle =
      s.kind === 'plate'
        ? s.plateTitle || s.title || s.plateId || 'Plate'
        : s.kind === 'open' || s.kind === 'close'
          ? s.title || role
          : s.title || role;
    const sectionGroup =
      s.kind === 'open' ? 'opening' : s.kind === 'close' ? 'closing' : 'story';
    return `<li class="script-scene kind-${s.kind}${s.plateType ? ` plate-${escapeHtml(s.plateType)}` : ''}${worst ? ` has-${worst}` : ''}${hasVo ? ' has-vo' : ' no-vo'}${draggable ? ' is-draggable' : ''}" data-key="${escapeHtml(s.key)}" data-kind="${escapeHtml(s.kind)}" data-section-group="${sectionGroup}" data-issues="${issues.length}"${
      s.flowIndex != null ? ` data-flow-index="${s.flowIndex}"` : ''
    }${s.flowCount != null ? ` data-flow-count="${s.flowCount}"` : ''}${
      s.plateId ? ` data-plate-id="${escapeHtml(s.plateId)}"` : ''
    }${s.before ? ` data-before="${escapeHtml(s.before)}"` : ''}${draggable ? ` data-can-drag="1"` : ''}>
      <div class="ss-rail" aria-hidden="true">
        <span class="ss-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="ss-rail-line"></span>
        <span class="ss-rail-dot"></span>
      </div>
      <article class="ss-card">
        <header class="ss-card-head">
          ${
            draggable
              ? `<button type="button" class="ss-drag" data-drag-handle title="Drag to reorder" aria-label="Drag to reorder ${escapeHtml(role)}">
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="5" cy="4" r="1.35" fill="currentColor"/><circle cx="11" cy="4" r="1.35" fill="currentColor"/><circle cx="5" cy="8" r="1.35" fill="currentColor"/><circle cx="11" cy="8" r="1.35" fill="currentColor"/><circle cx="5" cy="12" r="1.35" fill="currentColor"/><circle cx="11" cy="12" r="1.35" fill="currentColor"/></svg>
                </button>`
              : ''
          }
          <span class="ss-kind" title="${escapeHtml(kindLabel)}">${escapeHtml(role)}</span>
          ${s.kind === 'plate' && s.plate?.typeLabel ? `<span class="ss-type-chip">${escapeHtml(s.plate.typeLabel)}</span>` : ''}
          <strong class="ss-card-title">${escapeHtml(previewTitle)}</strong>
          <span class="ss-head-spacer"></span>
          ${timingStrip(s)}
        </header>
        <div class="ss-screen">
          <span class="ss-block-label">On screen</span>
          ${screen}
        </div>
        <div class="ss-vo">
          <div class="ss-vo-head">
            <span class="ss-vo-label">Spoken</span>
            <em>${hasVo ? `${s.narrationWords} words · ~${(s.narrationSec || 0).toFixed(1)}s` : 'Carries previous line'}</em>
            ${
              s.editable?.speed !== false
                ? `<label class="ss-pace">
                    <span>Pace</span>
                    <select data-voice-speed data-nk="${escapeHtml(s.narrationKind)}" data-nkey="${escapeHtml(s.narrationKey)}" aria-label="Speaking pace">
                      ${speedOptions(speed)}
                    </select>
                  </label>`
                : ''
            }
          </div>
          <textarea rows="2" data-nk="${escapeHtml(s.narrationKind)}" data-nkey="${escapeHtml(s.narrationKey)}" placeholder="${
            s.kind === 'step' ? 'Optional — leave empty to carry the previous line' : 'What the voiceover says on this beat…'
          }">${escapeHtml(s.narration || '')}</textarea>
        </div>
        ${issues.length ? `<ul class="ss-issues">${issues.map((x) => `<li class="lvl-${x.level}">${escapeHtml(x.message)}</li>`).join('')}</ul>` : ''}
      </article>
    </li>`;
  }

  /** Session collapse state for Opening / Story / Closing. A new scenario starts folded. */
  const sectionCollapsed = defaultSectionCollapsed();

  function sectionHeader(id, label, hint, count = 0) {
    const collapsed = Boolean(sectionCollapsed[id]);
    return `<li class="script-section${collapsed ? ' is-collapsed' : ''}" id="script-sec-${escapeHtml(id)}" data-section="${escapeHtml(id)}">
      <button type="button" class="script-section-toggle" data-section-toggle="${escapeHtml(id)}" aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="script-section-mark" aria-hidden="true"></span>
        <span class="script-section-copy">
          <span>${escapeHtml(label)}</span>
          ${hint ? `<em>${escapeHtml(hint)}</em>` : ''}
        </span>
        ${count ? `<b class="script-section-count">${count}</b>` : '<span class="script-section-count is-empty" aria-hidden="true"></span>'}
        <span class="script-section-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </button>
    </li>`;
  }

  function syncSectionCollapseClasses() {
    const root = $('scriptScenes');
    if (!root) return;
    root.querySelectorAll('.script-section').forEach((sec) => {
      const id = sec.dataset.section;
      const collapsed = Boolean(sectionCollapsed[id]);
      sec.classList.toggle('is-collapsed', collapsed);
      const btn = sec.querySelector('[data-section-toggle]');
      if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      let next = sec.nextElementSibling;
      while (next && !next.classList.contains('script-section') && !next.classList.contains('script-composer')) {
        if (next.classList.contains('script-scene')) {
          next.classList.toggle('is-section-collapsed', collapsed);
        }
        next = next.nextElementSibling;
      }
    });
  }

  function toggleSection(id) {
    if (!(id in sectionCollapsed)) return;
    sectionCollapsed[id] = !sectionCollapsed[id];
    syncSectionCollapseClasses();
    applyIssueFilter();
  }

  function composerBar() {
    return `<li class="script-composer" aria-label="Add to scenario">
      <div class="script-composer-inner">
        <div class="script-composer-copy">
          <strong>Continue the story</strong>
          <span>Add the next beat in delivery order</span>
        </div>
        <div class="script-composer-actions">
          <button type="button" class="ss-compose" data-struct-action="add-chapter"><i>+</i><span>Chapter</span></button>
          <button type="button" class="ss-compose" data-struct-action="add-caption"><i>+</i><span>Caption</span></button>
          <button type="button" class="ss-compose accent" data-struct-action="add-plate"><i>+</i><span>Plate</span></button>
        </div>
      </div>
    </li>`;
  }

  function scenesHtml(scenes) {
    const parts = [];
    let openDone = false;
    let storyOpen = false;
    let closeDone = false;
    const storyCount = scenes.filter((s) => s.kind === 'chapter' || s.kind === 'step' || s.kind === 'plate').length;
    scenes.forEach((s, i) => {
      if (s.kind === 'open' && !openDone) {
        parts.push(sectionHeader('opening', 'Opening', 'Brand intro — first impression'));
        openDone = true;
      }
      if ((s.kind === 'chapter' || s.kind === 'step' || s.kind === 'plate') && !storyOpen) {
        parts.push(sectionHeader('story', 'Story', 'Chapters, captions and plates in cut order', storyCount));
        storyOpen = true;
      }
      if (s.kind === 'close' && !closeDone) {
        parts.push(sectionHeader('closing', 'Closing', 'Recap before the end card'));
        closeDone = true;
      }
      parts.push(sceneRow(s, i));
    });
    parts.push(composerBar());
    return parts.join('');
  }

  function syncScriptJump(drafting, scaffold) {
    const jump = $('scriptJump');
    if (!jump) return;
    const has = (id) => Boolean(document.getElementById(`script-sec-${id}`));
    jump.hidden = drafting || scaffold || !(has('opening') || has('story') || has('closing'));
    jump.querySelectorAll('[data-jump]').forEach((btn) => {
      const id = btn.dataset.jump;
      btn.hidden = !has(id);
      btn.classList.toggle('is-active', false);
    });
  }

  function jumpToSection(id) {
    if (sectionCollapsed[id]) {
      sectionCollapsed[id] = false;
      syncSectionCollapseClasses();
      applyIssueFilter();
    }
    const el = document.getElementById(`script-sec-${id}`);
    const body = document.querySelector('#scriptDialog .script-body');
    if (!el || !body) return;
    const top = el.offsetTop - 12;
    body.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    $('scriptJump')?.querySelectorAll('[data-jump]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.jump === id);
    });
  }

  /** Nearest chapter scene at or before this key (plates resolve via their `before`). */
  function chapterSceneNear(key) {
    const scenes = script?.scenes || [];
    const i = scenes.findIndex((s) => s.key === key);
    if (i < 0) return null;
    const at = scenes[i];
    if (at.kind === 'chapter') return at;
    if (at.kind === 'plate' && at.before) return scenes.find((s) => s.kind === 'chapter' && s.title === at.before) || null;
    for (let j = i; j >= 0; j--) if (scenes[j].kind === 'chapter') return scenes[j];
    return scenes.find((s) => s.kind === 'chapter') || null;
  }

  function callTargetIndex(from, to, edge) {
    if (from?.flowIndex == null) return null;
    let dest = to;
    if (to?.kind === 'plate') dest = chapterSceneNear(to.key);
    if (dest?.flowIndex == null) return null;
    let toIndex = dest.flowIndex;
    if (edge === 'after') toIndex = dest.flowIndex + 1;
    if (from.flowIndex < toIndex) toIndex -= 1;
    const max = Math.max(0, (from.flowCount || 1) - 1);
    return Math.max(0, Math.min(toIndex, max));
  }

  /** among index for plate-move (excludes the dragged plate, matching server clamp). */
  function plateAmongIndex(beforeTitle, dropPlateKey, edge, fromKey) {
    const siblings = (script?.scenes || []).filter((s) => s.kind === 'plate' && s.before === beforeTitle);
    let among;
    if (!dropPlateKey) {
      among = siblings.length;
    } else {
      const idx = siblings.findIndex((s) => s.key === dropPlateKey);
      among = idx < 0 ? siblings.length : edge === 'before' ? idx : idx + 1;
    }
    const fromIdx = siblings.findIndex((s) => s.key === fromKey);
    if (fromIdx >= 0 && fromIdx < among) among -= 1;
    return Math.max(0, among);
  }

  async function commitSceneDrop(fromKey, toKey, edge) {
    const from = script?.scenes?.find((s) => s.key === fromKey);
    const to = script?.scenes?.find((s) => s.key === toKey);
    if (!from || !to || from.key === to.key) return;
    if (from.kind === 'plate') {
      const chapter = to.kind === 'chapter' ? to : chapterSceneNear(to.key);
      if (!chapter?.title) {
        toast('Drop on a chapter', 'Plates sit before the chapter they introduce', 'warn');
        return;
      }
      const among = plateAmongIndex(
        chapter.title,
        to.kind === 'plate' ? to.key : null,
        to.kind === 'plate' ? edge : 'after',
        from.key
      );
      await applyStructure(
        { op: 'plate-move', plateId: from.plateId, before: chapter.title, among },
        { ok: 'Plate moved', detail: `Before “${chapter.title}”`, focusKey: from.key }
      );
      return;
    }
    if (from.flowIndex == null) return;
    const toIndex = callTargetIndex(from, to, edge);
    if (toIndex == null || toIndex === from.flowIndex) return;
    await applyStructure(
      { op: 'call-move-to', index: from.flowIndex, toIndex },
      { ok: 'Beat moved', detail: 'flow.mjs order updated', focusKey: from.key }
    );
  }

  function clearDropMarks() {
    document.querySelectorAll('#scriptScenes .script-scene').forEach((el) => {
      el.classList.remove('is-drop-before', 'is-drop-after', 'is-dragging');
    });
  }

  function wireScriptDrag() {
    const root = $('scriptScenes');
    if (!root || root.dataset.dragWired) return;
    root.dataset.dragWired = '1';
    let drag = null;
    let scrollRaf = 0;

    const scriptBody = () => document.querySelector('#scriptDialog .script-body');

    const stopScroll = () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    };

    const autoScroll = () => {
      if (!drag) return stopScroll();
      const body = scriptBody();
      if (!body) return;
      const r = body.getBoundingClientRect();
      const zone = 72;
      const y = drag.clientY;
      let dy = 0;
      if (y < r.top + zone) dy = -Math.max(4, Math.round((r.top + zone - y) / 6));
      else if (y > r.bottom - zone) dy = Math.max(4, Math.round((y - (r.bottom - zone)) / 6));
      if (dy) body.scrollTop += dy;
      scrollRaf = requestAnimationFrame(autoScroll);
    };

    const end = () => {
      if (!drag) return;
      stopScroll();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      drag.ghost?.remove();
      clearDropMarks();
      drag = null;
      root.classList.remove('is-reordering');
      document.body.classList.remove('ss-is-dragging');
    };

    const hitScene = (clientX, clientY) => {
      const hit = document.elementFromPoint(clientX, clientY);
      return hit?.closest?.('#scriptScenes .script-scene:not([hidden])');
    };

    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      drag.clientY = e.clientY;
      drag.ghost.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px)`;
      const el = hitScene(e.clientX, e.clientY);
      clearDropMarks();
      document.querySelector(`.script-scene[data-key="${CSS.escape(drag.key)}"]`)?.classList.add('is-dragging');
      if (!el || el.dataset.key === drag.key || el.dataset.kind === 'open' || el.dataset.kind === 'close') {
        drag.overKey = null;
        return;
      }
      const box = el.getBoundingClientRect();
      drag.edge = e.clientY < box.top + box.height / 2 ? 'before' : 'after';
      drag.overKey = el.dataset.key;
      el.classList.add(drag.edge === 'before' ? 'is-drop-before' : 'is-drop-after');
    };

    const onUp = async () => {
      if (!drag) return;
      const { key, overKey, edge } = drag;
      end();
      if (overKey && overKey !== key) {
        try {
          await commitSceneDrop(key, overKey, edge);
        } catch (err) {
          toast('Could not reorder', err.message, 'err');
        }
      }
    };

    const onCancel = () => end();

    root.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('[data-drag-handle]');
      if (!handle || e.button !== 0) return;
      const li = handle.closest('.script-scene[data-can-drag]');
      if (!li || !script || draftJob) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = li.getBoundingClientRect();
      const ghost = li.cloneNode(true);
      ghost.classList.add('ss-drag-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${rect.width}px`;
      document.body.appendChild(ghost);
      drag = {
        key: li.dataset.key,
        ghost,
        ox: e.clientX - rect.left,
        oy: e.clientY - rect.top,
        clientY: e.clientY,
        overKey: null,
        edge: 'before',
      };
      li.classList.add('is-dragging');
      root.classList.add('is-reordering');
      document.body.classList.add('ss-is-dragging');
      ghost.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px)`;
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      stopScroll();
      scrollRaf = requestAnimationFrame(autoScroll);
    });
  }

  function renderScript(review) {
    if (!script) return;
    const t = script.totals;
    const r = review?.script || getState().video?.review?.script || { effective: 'draft' };
    const drafting = Boolean(draftJob);
    const scaffold = Boolean(script.scaffold);
    pill($('scriptStatus'), drafting ? 'draft' : r.effective);
    if (drafting) $('scriptStatus').textContent = 'Drafting…';

    const mm = Math.floor(t.estSec / 60);
    const ss = String(t.estSec % 60).padStart(2, '0');
    $('scriptTotals').textContent = drafting
      ? 'Writing chapters, plates and narration from your brief…'
      : scaffold
        ? 'Starter template · waiting for a real draft'
        : `${t.chapters} chapters · ${t.plates} plates · ${t.words} words · ~${mm}:${ss}`;
    const editable = $('scriptEditableNote');
    if (editable) editable.textContent = drafting || scaffold ? '' : SCENARIO_EDITABLE_NOTE;

    $('scriptApprovedMeta').textContent =
      r.effective === 'approved'
        ? `Approved ${when(r.approvedAt)}${r.approvedBy ? ` by ${r.approvedBy}` : ''}`
        : r.effective === 'changed'
          ? `Approved ${when(r.approvedAt)} — sources changed since`
          : !drafting && t.errors
            ? `${t.errors} blocking issue(s)`
            : '';
    $('btnScriptApprove').disabled = drafting || r.effective === 'approved';
    $('btnScriptRequest').disabled = drafting;
    $('btnScriptApprove').textContent = scriptApproveLabel(r.effective);

    const guide = $('scriptGuide');
    const scaffoldEl = $('scriptScaffoldNote');
    const stats = $('scriptStats');
    if (guide) guide.hidden = drafting;
    if (scaffoldEl) scaffoldEl.hidden = !scaffold || drafting;
    if (stats) {
      if (drafting || scaffold) {
        stats.hidden = true;
        stats.innerHTML = '';
      } else {
        stats.hidden = false;
        stats.innerHTML = [
          `<div class="script-stat"><strong>${t.chapters}</strong><span>Chapters</span></div>`,
          `<div class="script-stat"><strong>${t.plates}</strong><span>Plates</span></div>`,
          `<div class="script-stat"><strong>${t.words}</strong><span>Words</span></div>`,
          `<div class="script-stat"><strong>~${mm}:${ss}</strong><span>Length</span></div>`,
        ].join('');
      }
    }

    const brief = getState().video?.brief;
    const global = drafting || scaffold
      ? []
      : script.lint.filter((l) => !script.scenes.some((s) => s.key === l.key));
    $('scriptLint').innerHTML = [
      brief && !drafting
        ? `<li class="lint-brief"><details><summary>Brief · ${escapeHtml(brief.audience || brief.title || 'Pinned')}</summary><p>${escapeHtml(
            [
              getState().video?.story && `Story: ${getState().video.story.label} — ${getState().video.story.framework}`,
              brief.outcome && `Outcome: ${brief.outcome}`,
              brief.story?.mustShow?.length && `Show: ${brief.story.mustShow.join(' → ')}`,
            ]
              .filter(Boolean)
              .join(' · ') || 'Pinned with the project.'
          )}</p></details></li>`
        : '',
      ...global.map((l) => `<li class="lvl-${l.level}">${escapeHtml(l.message)}</li>`),
    ].join('');

    if (drafting && scaffold) {
      $('scriptScenes').innerHTML = `<li class="script-waiting">
        <span class="activity-spinner"></span>
        <div>
          <strong>Building your first script</strong>
          <span>The agent is writing the config, flow and narration from the brief. This sheet fills in when it finishes.</span>
        </div>
      </li>`;
    } else {
      $('scriptScenes').innerHTML = scenesHtml(script.scenes);
      syncSectionCollapseClasses();
      applyIssueFilter();
    }
    syncScriptJump(drafting, scaffold);

    document.getElementById('scriptDialog')?.classList.toggle('is-drafting', drafting);
    document.getElementById('scriptDialog')?.classList.toggle('is-scaffold', scaffold && !drafting);
  }

  function applyIssueFilter() {
    const only = $('scriptOnlyIssues').checked;
    let shown = 0;
    document.querySelectorAll('#scriptScenes .script-scene').forEach((li) => {
      const byIssues = only && li.dataset.issues === '0';
      const byCollapse = li.classList.contains('is-section-collapsed');
      li.hidden = byIssues || byCollapse;
      if (!li.hidden) shown++;
    });
    document.querySelectorAll('#scriptScenes .script-section').forEach((sec) => {
      let next = sec.nextElementSibling;
      let anyMatch = false;
      while (next && !next.classList.contains('script-section') && !next.classList.contains('script-composer')) {
        if (next.classList.contains('script-scene') && !(only && next.dataset.issues === '0')) anyMatch = true;
        next = next.nextElementSibling;
      }
      sec.hidden = only && !anyMatch;
    });
    const composer = $('scriptScenes').querySelector('.script-composer');
    if (composer) composer.hidden = only;
    $('scriptScenes').querySelector('.scenes-empty')?.remove();
    if (only && !shown) {
      $('scriptScenes').insertAdjacentHTML(
        'beforeend',
        '<li class="scenes-empty"><strong>No issues</strong><span>Every beat passes the script checks.</span></li>'
      );
    }
    const jump = $('scriptJump');
    if (jump && !jump.hidden) {
      jump.querySelectorAll('[data-jump]').forEach((btn) => {
        const sec = document.getElementById(`script-sec-${btn.dataset.jump}`);
        btn.hidden = !sec || sec.hidden;
      });
    }
  }

  async function loadScript() {
    const slug = getState().slug;
    const r = await api(`/api/video/${slug}/script`);
    script = r.script;
    renderScript(r.review);
  }

  async function openScript() {
    $('scriptDialog').showModal();
    $('scriptScenes').innerHTML = '<li class="meta">Loading script…</li>';
    try {
      await loadScript();
    } catch (err) {
      $('scriptScenes').innerHTML = `<li class="lvl-error">${escapeHtml(err.message)}</li>`;
    }
  }

  async function saveLine(ta) {
    const text = ta.value.trim();
    const scene = script?.scenes.find((s) => s.narrationKey === ta.dataset.nkey && s.narrationKind === ta.dataset.nk);
    if (scene && (scene.narration || '') === text) return;
    ta.classList.add('saving');
    try {
      const r = await api(`/api/video/${getState().slug}/script/line`, {
        method: 'PUT',
        body: { kind: ta.dataset.nk, key: ta.dataset.nkey, text },
      });
      script = r.script;
      const focusKey = ta.closest('.script-scene')?.dataset.key;
      renderScript(r.review);
      toast('Narration saved', 'narration.mjs updated — re-run audio to hear it', 'ok');
      document.querySelector(`.script-scene[data-key="${CSS.escape(focusKey || '')}"] textarea[data-nk]`)?.classList.add('saved');
      reload({ quiet: true });
    } catch (err) {
      toast('Save failed', err.message, 'err');
    } finally {
      ta.classList.remove('saving');
    }
  }

  async function saveSpeed(sel) {
    const speed = Number(sel.value);
    const scene = script?.scenes.find((s) => s.narrationKey === sel.dataset.nkey && s.narrationKind === sel.dataset.nk);
    const cur = scene?.narrationSpeed == null ? 1 : scene.narrationSpeed;
    if (scene && Math.abs(cur - speed) < 0.01) return;
    if (!scene?.narration?.trim() && sel.dataset.nk === 'line') {
      toast('Add spoken words first', 'Pace applies to a narration line', 'warn');
      sel.value = String(cur);
      return;
    }
    sel.classList?.add?.('saving');
    try {
      const r = await api(`/api/video/${getState().slug}/script/line`, {
        method: 'PUT',
        body: { kind: sel.dataset.nk, key: sel.dataset.nkey, speed },
      });
      script = r.script;
      renderScript(r.review);
      toast('Pace saved', `${speed.toFixed(2)}× in narration.mjs — re-run audio to hear it`, 'ok');
      reload({ quiet: true });
    } catch (err) {
      toast('Pace not saved', err.message, 'err');
    } finally {
      sel.classList?.remove?.('saving');
    }
  }

  /** Serialize structure PUTs so tabbing across fields cannot interleave re-renders and drop edits. */
  let structureChain = Promise.resolve();
  function enqueueStructure(task) {
    const run = structureChain.then(task, task);
    structureChain = run.catch(() => {});
    return run;
  }

  function restoreStructFocus(spec) {
    if (!spec?.field) return;
    let sel = `#scriptScenes [data-struct-field="${CSS.escape(spec.field)}"]`;
    if (spec.step != null && spec.step !== '') sel += `[data-step-index="${CSS.escape(String(spec.step))}"]`;
    if (spec.flow != null && spec.flow !== '') sel += `[data-flow-index="${CSS.escape(String(spec.flow))}"]`;
    if (spec.row != null && spec.row !== '') sel += `[data-row-index="${CSS.escape(String(spec.row))}"]`;
    if (spec.plate != null && spec.plate !== '') sel += `[data-plate-id="${CSS.escape(String(spec.plate))}"]`;
    const el = document.querySelector(sel);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.selectionStart === 'number' && el.value != null) {
      const n = el.value.length;
      try {
        el.setSelectionRange(n, n);
      } catch {
        /* not a text control */
      }
    }
  }

  async function applyStructure(body, { ok = 'Script updated', detail = 'Sources saved', focusKey, restore } = {}) {
    return enqueueStructure(async () => {
      const r = await api(`/api/video/${getState().slug}/script/structure`, { method: 'PUT', body });
      script = r.script;
      renderScript(r.review);
      toast(ok, detail, 'ok');
      reload({ quiet: true });
      if (focusKey) {
        document.querySelector(`.script-scene[data-key="${CSS.escape(focusKey)}"]`)?.scrollIntoView({ block: 'nearest' });
      }
      restoreStructFocus(restore);
      return r;
    });
  }

  function openSceneFields(sceneEl) {
    const get = (name) => sceneEl.querySelector(`[data-struct-field="${name}"]`)?.value ?? '';
    return { eyebrow: get('open.eyebrow'), title: get('open.title'), sub: get('open.sub') };
  }

  async function saveStructField(el, { restore } = {}) {
    const field = el.dataset.structField;
    if (!field) return;
    const sceneEl = el.closest('.script-scene');
    const focusKey = sceneEl?.dataset.key;
    try {
      el.classList?.add?.('saving');
      if (field.startsWith('open.')) {
        const cur = script?.scenes.find((s) => s.kind === 'open');
        const next = openSceneFields(sceneEl);
        const same =
          (cur?.eyebrow || '') === next.eyebrow &&
          (cur?.titleLines || []).join('\n') === next.title.trim() &&
          (cur?.sub || '') === next.sub;
        if (same) {
          restoreStructFocus(restore);
          return;
        }
        await applyStructure({ op: 'open', ...next }, { ok: 'Opening plate saved', detail: 'video.config.json', focusKey, restore });
      } else if (field === 'close.title') {
        const cur = script?.scenes.find((s) => s.kind === 'close');
        const title = el.value;
        if ((cur?.titleLines || []).join('\n') === title.trim()) {
          restoreStructFocus(restore);
          return;
        }
        await applyStructure({ op: 'close', title }, { ok: 'Close title saved', detail: 'video.config.json', focusKey, restore });
      } else if (field === 'close.step.label' || field === 'close.step.note') {
        const index = Number(el.dataset.stepIndex);
        const row = el.closest('.ss-step');
        const label = row?.querySelector('[data-struct-field="close.step.label"]')?.value ?? '';
        const note = row?.querySelector('[data-struct-field="close.step.note"]')?.value ?? '';
        const cur = script?.scenes.find((s) => s.kind === 'close')?.steps?.[index];
        if (cur && cur.label === label.trim() && (cur.note || '') === note.trim()) {
          restoreStructFocus(restore);
          return;
        }
        await applyStructure(
          { op: 'close-steps', action: 'update', index, label, note },
          { ok: 'Close step saved', detail: 'video.config.json', focusKey, restore }
        );
      } else if (field === 'plate.before') {
        const plateId = el.dataset.plateId || sceneEl?.dataset.plateId;
        const before = el.value;
        const cur = script?.scenes.find((s) => s.plateId === plateId);
        if (cur?.before === before) return;
        await applyStructure(
          { op: 'plate-before', plateId, before },
          { ok: 'Plate placement saved', detail: `Before “${before}”`, focusKey, restore }
        );
      } else if (field?.startsWith('plate.')) {
        const plateId = el.dataset.plateId || sceneEl?.dataset.plateId;
        const cur = script?.scenes.find((s) => s.plateId === plateId);
        if (!plateId || !cur) return;
        const payload = { op: 'plate-update', plateId };
        const title = sceneEl?.querySelector('[data-struct-field="plate.title"]')?.value ?? '';
        const eyebrow = sceneEl?.querySelector('[data-struct-field="plate.eyebrow"]')?.value ?? '';
        const sub = sceneEl?.querySelector('[data-struct-field="plate.sub"]')?.value ?? '';
        payload.title = title;
        payload.eyebrow = eyebrow;
        payload.sub = sub;
        const bodyEl = sceneEl?.querySelector('[data-struct-field="plate.body"]');
        if (bodyEl) payload.body = bodyEl.value;
        const quoteEl = sceneEl?.querySelector('[data-struct-field="plate.quote"]');
        if (quoteEl) payload.quote = quoteEl.value;
        const authorEl = sceneEl?.querySelector('[data-struct-field="plate.author"]');
        if (authorEl) payload.author = authorEl.value;
        const roleEl = sceneEl?.querySelector('[data-struct-field="plate.role"]');
        if (roleEl) payload.role = roleEl.value;
        const valueEl = sceneEl?.querySelector('[data-struct-field="plate.value"]');
        if (valueEl) payload.value = valueEl.value;
        const unitEl = sceneEl?.querySelector('[data-struct-field="plate.unit"]');
        if (unitEl) payload.unit = unitEl.value;
        const noteEl = sceneEl?.querySelector('[data-struct-field="plate.note"]');
        if (noteEl) payload.note = noteEl.value;
        const progressEl = sceneEl?.querySelector('[data-struct-field="plate.progress"]');
        if (progressEl && progressEl.value !== '') payload.progress = Number(progressEl.value);
        const leftLabel = sceneEl?.querySelector('[data-struct-field="plate.left.label"]');
        const leftItems = sceneEl?.querySelector('[data-struct-field="plate.left.items"]');
        if (leftLabel || leftItems) {
          payload.left = {
            label: leftLabel?.value || 'Before',
            items: (leftItems?.value || '').split('\n').map((l) => l.trim()).filter(Boolean),
          };
        }
        const rightLabel = sceneEl?.querySelector('[data-struct-field="plate.right.label"]');
        const rightItems = sceneEl?.querySelector('[data-struct-field="plate.right.items"]');
        if (rightLabel || rightItems) {
          payload.right = {
            label: rightLabel?.value || 'After',
            items: (rightItems?.value || '').split('\n').map((l) => l.trim()).filter(Boolean),
          };
        }
        if (sceneEl?.querySelector('.ss-plate-row')) {
          payload.rows = [...sceneEl.querySelectorAll('.ss-plate-row')].map((row) => {
            const obj = {};
            row.querySelectorAll('[data-struct-field^="plate.row."]').forEach((inp) => {
              obj[inp.dataset.structField.replace('plate.row.', '')] = inp.value;
            });
            return obj;
          });
        }
        await applyStructure(payload, {
          ok: 'Plate saved',
          detail: 'video.config.json — re-render plates to bake it in',
          focusKey,
          restore,
        });
      } else if (field === 'call.hold') {
        const index = Number(el.dataset.flowIndex);
        const sec = Number(el.value);
        const cur = script?.scenes.find((s) => s.flowIndex === index);
        if (!Number.isFinite(sec)) throw new Error('Hold must be a number');
        const holdMs = Math.round(Math.max(0.4, Math.min(12, sec)) * 1000);
        if (cur && cur.holdExplicit && Math.abs((cur.holdSec || 0) * 1000 - holdMs) < 50) {
          restoreStructFocus(restore);
          return;
        }
        await applyStructure(
          { op: 'call-update', index, holdMs },
          { ok: 'Hold saved', detail: `${(holdMs / 1000).toFixed(1)}s on screen in flow.mjs`, focusKey, restore }
        );
      } else if (field === 'call.title' || field === 'call.body') {
        const index = Number(el.dataset.flowIndex);
        const scene = script?.scenes.find((s) => s.flowIndex === index);
        const titleEl = sceneEl?.querySelector('[data-struct-field="call.title"]');
        const bodyEl = sceneEl?.querySelector('[data-struct-field="call.body"]');
        const title = titleEl?.value ?? '';
        const body = bodyEl?.value ?? '';
        if (scene && scene.title === title.trim() && (scene.onScreen || '') === body.trim()) {
          restoreStructFocus(restore);
          return;
        }
        const nextKey =
          field === 'call.title' && title.trim() !== scene?.title ? `${scene?.kind}:${title.trim()}` : focusKey;
        await applyStructure(
          { op: 'call-update', index, title, body },
          {
            ok: scene?.kind === 'chapter' ? 'Chapter saved' : 'Caption saved',
            detail: 'flow.mjs updated',
            focusKey: nextKey,
            restore: restore
              ? {
                  ...restore,
                  // After a title rename the flow index is stable; keep the same field.
                  field: restore.field,
                  flow: String(index),
                }
              : null,
          }
        );
      }
    } catch (err) {
      toast('Could not save', err.message, 'err');
      restoreStructFocus(restore);
    } finally {
      el.classList?.remove?.('saving');
    }
  }

  async function onStructAction(btn) {
    const action = btn.dataset.structAction;
    if (!action) return;
    try {
      if (action === 'add-chapter' || action === 'add-caption') {
        const kind = action === 'add-chapter' ? 'chapter' : 'step';
        const label = kind === 'chapter' ? 'Chapter title' : 'Caption title';
        const title = await ask({
          kind: 'prompt',
          title: kind === 'chapter' ? 'Add chapter' : 'Add caption',
          detail: kind === 'chapter' ? 'Inserted at the end of the live story in flow.mjs.' : 'Inserted after the last beat in flow.mjs.',
          label,
          value: kind === 'chapter' ? 'New chapter' : 'New caption',
          ok: 'Add',
        });
        if (title == null || !String(title).trim()) return;
        const afterIndex = (script?.scenes || []).reduce((max, s) => (s.flowIndex != null ? Math.max(max, s.flowIndex) : max), -1);
        await applyStructure(
          { op: 'call-add', kind, title: String(title).trim(), afterIndex },
          { ok: kind === 'chapter' ? 'Chapter added' : 'Caption added', detail: 'flow.mjs · add narration next' }
        );
      } else if (action === 'add-caption-after') {
        const afterIndex = Number(btn.dataset.flowIndex);
        const title = await ask({
          kind: 'prompt',
          title: 'Add caption',
          detail: 'Placed right after this chapter in flow.mjs.',
          label: 'Caption title',
          value: 'New caption',
          ok: 'Add',
        });
        if (title == null || !String(title).trim()) return;
        await applyStructure(
          { op: 'call-add', kind: 'step', title: String(title).trim(), afterIndex },
          { ok: 'Caption added', detail: 'flow.mjs' }
        );
      } else if (action === 'preview-card') {
        const kind = btn.dataset.kind === 'chapter' ? 'chapter' : 'caption';
        const flowIndex = Number(btn.dataset.flowIndex);
        if (!Number.isInteger(flowIndex)) return;
        onPreviewLiveCard?.({ kind, flowIndex });
      } else if (action === 'call-remove') {
        const index = Number(btn.dataset.flowIndex);
        const title = btn.dataset.title || 'this beat';
        const ok = await ask({
          title: `Remove “${title}”?`,
          detail: 'Deletes the chapter()/say() call from flow.mjs. Live navigation code around it stays.',
          ok: 'Remove',
          tone: 'warn',
        });
        if (!ok) return;
        await applyStructure({ op: 'call-remove', index }, { ok: 'Removed', detail: 'flow.mjs updated' });
      } else if (action === 'call-move') {
        const index = Number(btn.dataset.flowIndex);
        const delta = Number(btn.dataset.delta);
        await applyStructure(
          { op: 'call-move', index, delta },
          { ok: delta < 0 ? 'Moved earlier' : 'Moved later', detail: 'flow.mjs order updated' }
        );
      } else if (action === 'hold-reset') {
        const index = Number(btn.dataset.flowIndex);
        await applyStructure(
          { op: 'call-update', index, holdMs: null },
          { ok: 'Hold reset', detail: 'Using the default card duration again' }
        );
      } else if (action === 'add-plate') {
        const types = script?.plateTypes?.length ? script.plateTypes : PLATE_TYPE_FALLBACK;
        const type = await ask({
          kind: 'choice',
          title: 'Add interstitial plate',
          detail: 'Inserts a brand plate before a chapter. Edit copy and rows inline after it lands.',
          options: types.map((t) => ({ value: t.type, label: t.label, hint: t.hint })),
          value: 'features',
          ok: 'Add plate',
        });
        if (!type) return;
        const chapters = script?.chapters || [];
        let before = chapters[0] || '';
        if (chapters.length > 1) {
          const pick = await ask({
            kind: 'choice',
            title: 'Place before which chapter?',
            detail: 'The plate appears immediately before this chapter in the cut.',
            options: chapters.map((c) => ({ value: c, label: c })),
            value: before,
            ok: 'Place here',
          });
          if (!pick) return;
          before = pick;
        }
        if (!before) {
          toast('Add a chapter first', 'Plates sit before a chapter in the story', 'warn');
          return;
        }
        await applyStructure(
          { op: 'plate-add', type, before },
          { ok: 'Plate added', detail: `${type} before “${before}” · re-render plates to preview` }
        );
      } else if (action === 'plate-remove') {
        const plateId = btn.dataset.plateId;
        const title = btn.dataset.title || plateId;
        const ok = await ask({
          title: `Remove plate “${title}”?`,
          detail: 'Deletes it from video.config.json and its narration plate line.',
          ok: 'Remove',
          tone: 'warn',
        });
        if (!ok) return;
        await applyStructure({ op: 'plate-remove', plateId }, { ok: 'Plate removed', detail: 'video.config.json updated' });
      } else if (action === 'plate-row-add') {
        const plateId = btn.dataset.plateId;
        const scene = script?.scenes.find((s) => s.plateId === plateId);
        if (!scene?.plate) return;
        const rows = [...(scene.plate.rows || [])];
        const blank = {};
        for (const f of scene.plate.fields || ['label']) blank[f] = '';
        rows.push(blank);
        await applyStructure(
          { op: 'plate-update', plateId, rows },
          { ok: 'Row added', detail: 'Fill it in, then blur to save', focusKey: scene.key }
        );
      } else if (action === 'plate-row-remove') {
        const plateId = btn.dataset.plateId;
        const index = Number(btn.dataset.rowIndex);
        const scene = script?.scenes.find((s) => s.plateId === plateId);
        if (!scene?.plate) return;
        const rows = [...(scene.plate.rows || [])];
        if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
        rows.splice(index, 1);
        await applyStructure(
          { op: 'plate-update', plateId, rows },
          { ok: 'Row removed', detail: 'video.config.json', focusKey: scene.key }
        );
      } else if (action === 'close-step-add') {
        const label = await ask({
          kind: 'prompt',
          title: 'Add close step',
          detail: 'Shown on the closing plate.',
          label: 'Step label',
          value: 'Next step',
          ok: 'Add',
        });
        if (label == null || !String(label).trim()) return;
        await applyStructure(
          { op: 'close-steps', action: 'add', label: String(label).trim() },
          { ok: 'Step added', detail: 'Closing plate', focusKey: 'close' }
        );
      } else if (action === 'close-step-remove') {
        const index = Number(btn.dataset.stepIndex);
        const ok = await ask({
          title: 'Remove this close step?',
          detail: 'It will disappear from the closing plate.',
          ok: 'Remove',
          tone: 'warn',
        });
        if (!ok) return;
        await applyStructure(
          { op: 'close-steps', action: 'remove', index },
          { ok: 'Step removed', detail: 'Closing plate', focusKey: 'close' }
        );
      }
    } catch (err) {
      toast('Could not update script', err.message, 'err');
    }
  }

  function showDraftBanner(job, title) {
    const banner = $('scriptDraftBanner');
    if (!job) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    $('scriptDraftTitle').textContent = title;
    paintAgentStream($('scriptDraftStream'), job, { variant: 'banner' });
  }

  /** Run an agent job that rewrites sources, keep the script sheet live while it works. */
  async function followAgentJob(job, title) {
    if (job.status === 'needs-agent') {
      toast('Agent sign-in needed', job.message || 'Run `agent login` (Cursor) or `claude` /login, then retry', 'warn');
      return false;
    }
    draftJob = job;
    showDraftBanner(job, title);
    if ($('scriptDialog').open) renderScript(getState().video?.review);
    setFaviconMode?.('draft');
    try {
      await watchJob(job.id, {
        surface: 'session',
        onUpdate: (j) => {
          showDraftBanner(j, title);
          if ($('scriptDialog').open) renderScript(getState().video?.review);
        },
      });
      setFaviconMode?.('ok');
      toast(title.replace('…', ''), 'Done — review the script', 'ok');
      return true;
    } catch (err) {
      setFaviconMode?.('err');
      toast('Agent stopped', err.message, 'err');
      return false;
    } finally {
      draftJob = null;
      showDraftBanner(null);
      if ($('scriptDialog').open) await loadScript().catch(() => {});
      reload({ quiet: true });
    }
  }

  async function requestChanges() {
    const revise = document.querySelector('#scriptDialog .script-revise');
    if (revise) revise.open = true;
    const note = $('scriptNote').value.trim();
    if (!note) {
      $('scriptNote').focus();
      toast('Add a note', 'Tell the agent what to change', 'warn');
      return;
    }
    try {
      const r = await api(`/api/video/${getState().slug}/script/request-changes`, { method: 'POST', body: { note } });
      $('scriptNote').value = '';
      if (r.job) await followAgentJob(r.job, 'Agent is revising the script…');
    } catch (err) {
      toast('Request failed', err.message, 'err');
    }
  }

  async function approveScript() {
    const slug = getState().slug;
    const note = $('scriptNote').value.trim();
    let review;
    try {
      const saved = await api(`/api/video/${slug}/script/approve`, { method: 'POST', body: { note } });
      review = saved.review;
    } catch (err) {
      if (!/blocking/i.test(err.message) || !(await ask({ title: 'Approve with blocking issues?', detail: err.message, ok: 'Approve anyway', tone: 'warn' }))) {
        toast('Not approved', err.message, 'warn');
        return;
      }
      try {
        const saved = await api(`/api/video/${slug}/script/approve`, { method: 'POST', body: { note, force: true } });
        review = saved.review;
      } catch (err2) {
        toast('Not approved', err2.message, 'warn');
        return;
      }
    }
    $('scriptNote').value = '';
    const totals = script?.totals || {};
    const plan = planScriptApproval({
      ok: true,
      chapters: totals.chapters || 0,
      plates: totals.plates || 0,
      approvedAt: review?.script?.approvedAt,
    });
    if ($('scriptApprovedMeta')) $('scriptApprovedMeta').textContent = plan.proof;
    toast('Script approved', plan.proof, 'ok');
    finishScriptApproval($('scriptDialog'), plan);
    await reload({ quiet: true });
  }

  /* ---------- cut sheet ---------- */

  function openCut() {
    const v = getState().video;
    if (!v?.hasDelivery) {
      toast('Nothing to review yet', 'Render the video first', 'warn');
      return;
    }
    const cut = v.review?.cut || { effective: 'none', history: [] };
    const scriptR = v.review?.script || { effective: 'draft' };
    pill($('cutStatus'), cut.effective);
    const latest = (v.versions || [])[0];
    const facts = [
      ['Duration', v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(Math.round(v.durationSec % 60)).padStart(2, '0')}` : '—'],
      ['Chapter markers', String((v.chapters || []).length)],
      ['Transitions', v.transitions ? `${v.transitions.style} · ${v.transitions.duration}s` : '—'],
      ['QC', v.qc?.status ? v.qc.status[0].toUpperCase() + v.qc.status.slice(1) : 'Not run'],
      ['Latest version', latest ? latest.displayName || latest.name : '—'],
      ['Script', STATUS_LABEL[scriptR.effective] || scriptR.effective],
    ];
    if (cut.effective === 'approved') facts.push(['Approved', `${cut.versionName || cut.version} · ${when(cut.approvedAt)}`]);
    $('cutFacts').innerHTML = facts.map(([k, val]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd></div>`).join('');
    const warn = [];
    if (scriptR.effective !== 'approved') warn.push('The script is not approved — approving the cut also signs off its copy.');
    if (v.freshness?.stale) warn.push(`Delivery is out of date: ${v.freshness.reason}.`);
    if (v.qc?.status === 'fail') warn.push('QC failed — check the Review tab before approving.');
    $('cutWarn').hidden = !warn.length;
    $('cutWarn').textContent = warn.join(' ');
    $('cutHistory').innerHTML = (cut.history || [])
      .slice()
      .reverse()
      .map(
        (h) =>
          `<li data-action="${escapeHtml(h.action)}"><strong>${escapeHtml(STATUS_LABEL[h.action] || h.action)}</strong><em>${escapeHtml(
            when(h.at)
          )}</em>${h.note ? `<p>${escapeHtml(h.note)}</p>` : ''}</li>`
      )
      .join('') || '<li class="is-empty">No reviews yet — approve or request changes below.</li>';
    $('btnCutApprove').disabled = cut.effective === 'approved';
    $('cutDialog').showModal();
  }

  async function cutDecision(status) {
    const note = $('cutNote').value.trim();
    if (status === 'changes-requested' && !note) {
      $('cutNote').focus();
      toast('Add a note', 'What should change before approval?', 'warn');
      return;
    }
    const btn = status === 'approved' ? $('btnCutApprove') : $('btnCutRequest');
    btn.disabled = true;
    try {
      await api(`/api/video/${getState().slug}/cut/review`, { method: 'POST', body: { status, note } });
      $('cutNote').value = '';
      $('cutDialog').close();
      toast(
        status === 'approved' ? 'Cut approved' : 'Changes requested',
        status === 'approved' ? 'Saved as a release version — export when ready' : 'Use Feedback to have the agent apply them',
        status === 'approved' ? 'ok' : 'warn'
      );
      if (status === 'changes-requested') onStageAction?.('feedback', { note });
      await reload({ quiet: true });
    } catch (err) {
      toast('Review failed', err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- wiring ---------- */

  document.querySelectorAll('dialog [data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
  $('scriptOnlyIssues').onchange = applyIssueFilter;
  $('scriptJump')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-jump]');
    if (btn) jumpToSection(btn.dataset.jump);
  });
  wireScriptDrag();
  $('scriptScenes').addEventListener('focusout', (e) => {
    if (e.target.matches('textarea[data-nk]')) saveLine(e.target);
    else if (e.target.matches('[data-struct-field]') && e.target.tagName !== 'SELECT') {
      const next = e.relatedTarget?.closest?.('[data-struct-field], [data-voice-speed]');
      const restore = next?.dataset?.structField
        ? {
            field: next.dataset.structField,
            step: next.dataset.stepIndex,
            flow: next.dataset.flowIndex,
            row: next.dataset.rowIndex,
            plate: next.dataset.plateId,
          }
        : null;
      saveStructField(e.target, { restore });
    }
  });
  $('scriptScenes').addEventListener('change', (e) => {
    if (e.target.matches('select[data-struct-field]')) saveStructField(e.target);
    else if (e.target.matches('select[data-voice-speed]')) saveSpeed(e.target);
  });
  $('scriptScenes').addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-section-toggle]');
    if (toggle) {
      toggleSection(toggle.dataset.sectionToggle);
      return;
    }
    const btn = e.target.closest('[data-struct-action]');
    if (btn && !btn.disabled) onStructAction(btn);
  });
  $('scriptScenes').addEventListener('keydown', (e) => {
    if (e.target.matches('textarea[data-nk]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.target.blur();
    // Single-line struct inputs: Enter saves (blur). Avoid dialog default-button quirks.
    if (e.target.matches('input[data-struct-field]') && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
    if (e.target.matches('textarea[data-struct-field]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.target.blur();
  });
  $('btnScriptRequest').onclick = requestChanges;
  $('btnScriptApprove').onclick = approveScript;
  $('btnCutApprove').onclick = () => cutDecision('approved');
  $('btnCutRequest').onclick = () => cutDecision('changes-requested');

  document.querySelectorAll('#stageBar .pstage').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.stage;
      if (key === 'brief' || key === 'script') openScript();
      else if (key === 'cut') openCut();
      else if (key === 'direction') onStageAction?.('direction');
      else onStageAction?.(key);
    };
  });

  return {
    render(v) {
      if (!v) return;
      renderStageBar(v);
    },
    openScript,
    openCut,
    followAgentJob,
  };
}
