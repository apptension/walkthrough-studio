import { flushSync } from 'react-dom';
import { create } from 'zustand';

import type { Job, ReviewSummary } from '@/api/types';
import { api } from '@/desk/api';
import { ask } from '@/desk/ask';
import { bridges } from '@/desk/bridge';
import { requestMake, watchJob } from '@/desk/jobs';
import { setFaviconMode } from '@/desk/marks';
import { showRightTab } from '@/desk/panels';
import { desk, openDialog } from '@/desk/store';
import { toast } from '@/desk/toast';
import { refreshSummary } from '@/desk/video';
import { finishScriptApproval, planScriptApproval } from '@/logic/scriptApproval';
import { defaultSectionCollapsed, type SectionCollapsed } from '@/logic/scriptSections';

import { callTargetIndex, chapterSceneNear, PLATE_TYPE_FALLBACK, plateAmongIndex, type DropEdge, type SectionId } from './model';
import type { Script, ScriptPayload } from './types';

/** The script sheet (`#scriptDialog`) — the script half of `kit/studio/workflow.js`. */

export type ScriptLoad = { kind: 'loading' } | { kind: 'error'; message: string } | null;

interface ScriptSheetState {
  script: Script | null;
  /** The review the last render used (`renderScript(review)`). */
  review: ReviewSummary | null;
  /** Bumped every time `script` is replaced — the scene inputs are uncontrolled and remount. */
  rev: number;
  load: ScriptLoad;
  draftJob: Job | null;
  draftTitle: string;
  onlyIssues: boolean;
  /** Session collapse state for Opening / Story / Closing. A new scenario starts folded. */
  collapsed: SectionCollapsed;
  activeJump: SectionId | null;
  note: string;
  /** `#scriptApprovedMeta` written by a successful approve, until the next render. */
  approvedProof: string | null;
}

export const useScriptSheet = create<ScriptSheetState>()(() => ({
  script: null,
  review: null,
  rev: 0,
  load: null,
  draftJob: null,
  draftTitle: '',
  onlyIssues: false,
  collapsed: defaultSectionCollapsed(),
  activeJump: null,
  note: '',
  approvedProof: null,
}));

const sheet = useScriptSheet;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function slug(): string {
  return desk.get().slug ?? '';
}

function sheetOpen(): boolean {
  return Boolean(desk.get().dialogs.script);
}

const reload = () => refreshSummary();

/** `script = r.script; renderScript(r.review)`, committed before the caller touches the DOM. */
function setScript(payload: Pick<ScriptPayload, 'script'> & { review?: ReviewSummary | undefined }): void {
  flushSync(() => {
    sheet.setState((s) => ({
      script: payload.script,
      review: payload.review ?? null,
      rev: s.rev + 1,
      load: null,
      activeJump: null,
      approvedProof: null,
    }));
  });
}

function sceneEl(key: string | undefined): HTMLElement | null {
  if (!key) return null;
  return document.querySelector<HTMLElement>(`.script-scene[data-key="${CSS.escape(key)}"]`);
}

export async function loadScript(): Promise<void> {
  const r = await api<ScriptPayload>(`/api/video/${slug()}/script`);
  setScript(r);
}

export async function openScript(opts: { section?: string } = {}): Promise<void> {
  openDialog('script', true);
  sheet.setState({ load: { kind: 'loading' } });
  try {
    await loadScript();
    const section = opts.section;
    if (section === 'opening' || section === 'story' || section === 'closing') jumpToSection(section);
  } catch (err) {
    sheet.setState({ load: { kind: 'error', message: message(err) } });
  }
}

/* ---------- sections ---------- */

export function toggleSection(id: string): void {
  sheet.setState((s) => (id in s.collapsed ? { collapsed: { ...s.collapsed, [id]: !s.collapsed[id as SectionId] } } : {}));
}

export function jumpToSection(id: SectionId): void {
  flushSync(() => {
    sheet.setState((s) => ({ collapsed: s.collapsed[id] ? { ...s.collapsed, [id]: false } : s.collapsed, activeJump: id }));
  });
  const el = document.getElementById(`script-sec-${id}`);
  const body = document.querySelector<HTMLElement>('#scriptDialog .script-body');
  if (!el || !body) return;
  body.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' });
}

export function setOnlyIssues(on: boolean): void {
  sheet.setState({ onlyIssues: on });
}

/* ---------- narration ---------- */

export async function saveLine(ta: HTMLTextAreaElement): Promise<void> {
  const text = ta.value.trim();
  const { nk, nkey } = ta.dataset;
  const scene = sheet.getState().script?.scenes.find((s) => s.narrationKey === nkey && s.narrationKind === nk);
  if (scene && (scene.narration || '') === text) return;
  ta.classList.add('saving');
  try {
    const r = await api<ScriptPayload>(`/api/video/${slug()}/script/line`, { method: 'PUT', body: { kind: nk, key: nkey, text } });
    const focusKey = ta.closest<HTMLElement>('.script-scene')?.dataset.key;
    setScript(r);
    toast('Narration saved', 'narration.mjs updated — re-run audio to hear it', 'ok');
    sceneEl(focusKey)?.querySelector('textarea[data-nk]')?.classList.add('saved');
    void reload();
  } catch (err) {
    toast('Save failed', message(err), 'err');
  } finally {
    ta.classList.remove('saving');
  }
}

export async function saveSpeed(sel: HTMLSelectElement): Promise<void> {
  const speed = Number(sel.value);
  const { nk, nkey } = sel.dataset;
  const scene = sheet.getState().script?.scenes.find((s) => s.narrationKey === nkey && s.narrationKind === nk);
  const cur = scene?.narrationSpeed == null ? 1 : scene.narrationSpeed;
  if (scene && Math.abs(cur - speed) < 0.01) return;
  if (!scene?.narration?.trim() && nk === 'line') {
    toast('Add spoken words first', 'Pace applies to a narration line', 'warn');
    sel.value = String(cur);
    return;
  }
  sel.classList.add('saving');
  try {
    const r = await api<ScriptPayload>(`/api/video/${slug()}/script/line`, { method: 'PUT', body: { kind: nk, key: nkey, speed } });
    setScript(r);
    toast('Pace saved', `${speed.toFixed(2)}× in narration.mjs — re-run audio to hear it`, 'ok');
    void reload();
  } catch (err) {
    toast('Pace not saved', message(err), 'err');
  } finally {
    sel.classList.remove('saving');
  }
}

/* ---------- structure ---------- */

/** Where focus was heading when a struct field blurred, so a re-render can put it back. */
export interface FocusSpec {
  field: string;
  step?: string | undefined;
  flow?: string | undefined;
  row?: string | undefined;
  plate?: string | undefined;
}

export function focusSpecOf(next: Element | null): FocusSpec | null {
  const el = next?.closest<HTMLElement>('[data-struct-field], [data-voice-speed]');
  const field = el?.dataset.structField;
  if (!el || !field) return null;
  return { field, step: el.dataset.stepIndex, flow: el.dataset.flowIndex, row: el.dataset.rowIndex, plate: el.dataset.plateId };
}

export function restoreStructFocus(spec: FocusSpec | null | undefined): void {
  if (!spec?.field) return;
  let sel = `#scriptScenes [data-struct-field="${CSS.escape(spec.field)}"]`;
  if (spec.step != null && spec.step !== '') sel += `[data-step-index="${CSS.escape(spec.step)}"]`;
  if (spec.flow != null && spec.flow !== '') sel += `[data-flow-index="${CSS.escape(spec.flow)}"]`;
  if (spec.row != null && spec.row !== '') sel += `[data-row-index="${CSS.escape(spec.row)}"]`;
  if (spec.plate != null && spec.plate !== '') sel += `[data-plate-id="${CSS.escape(spec.plate)}"]`;
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(sel);
  if (!el) return;
  el.focus({ preventScroll: true });
  if ('selectionStart' in el && typeof el.selectionStart === 'number' && el.value != null) {
    const n = el.value.length;
    try {
      el.setSelectionRange(n, n);
    } catch {
      /* not a text control */
    }
  }
}

/** Serialize structure PUTs so tabbing across fields cannot interleave re-renders and drop edits. */
let structureChain: Promise<unknown> = Promise.resolve();
function enqueueStructure<T>(task: () => Promise<T>): Promise<T> {
  const run = structureChain.then(task, task);
  structureChain = run.catch(() => {});
  return run;
}

interface StructureOpts {
  ok?: string;
  detail?: string;
  focusKey?: string | undefined;
  restore?: FocusSpec | null | undefined;
}

export function applyStructure(body: Record<string, unknown>, { ok = 'Script updated', detail = 'Sources saved', focusKey, restore }: StructureOpts = {}): Promise<ScriptPayload> {
  return enqueueStructure(async () => {
    const r = await api<ScriptPayload>(`/api/video/${slug()}/script/structure`, { method: 'PUT', body });
    setScript(r);
    toast(ok, detail, 'ok');
    void reload();
    if (focusKey) sceneEl(focusKey)?.scrollIntoView({ block: 'nearest' });
    restoreStructFocus(restore);
    return r;
  });
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fieldValue(root: Element | null | undefined, name: string): string {
  return root?.querySelector<FieldEl>(`[data-struct-field="${name}"]`)?.value ?? '';
}

function fieldEl(root: Element | null | undefined, name: string): FieldEl | null {
  return root?.querySelector<FieldEl>(`[data-struct-field="${name}"]`) ?? null;
}

const splitLines = (v: string | undefined) =>
  (v || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export async function saveStructField(el: FieldEl, { restore }: { restore?: FocusSpec | null } = {}): Promise<void> {
  const field = el.dataset.structField;
  if (!field) return;
  const scene = el.closest<HTMLElement>('.script-scene');
  const focusKey = scene?.dataset.key;
  const script = sheet.getState().script;
  try {
    el.classList.add('saving');
    if (field.startsWith('open.')) {
      const cur = script?.scenes.find((s) => s.kind === 'open');
      const next = { eyebrow: fieldValue(scene, 'open.eyebrow'), title: fieldValue(scene, 'open.title'), sub: fieldValue(scene, 'open.sub') };
      const same =
        (cur?.eyebrow || '') === next.eyebrow && (cur?.titleLines || []).join('\n') === next.title.trim() && (cur?.sub || '') === next.sub;
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
      const label = fieldValue(row, 'close.step.label');
      const note = fieldValue(row, 'close.step.note');
      const cur = script?.scenes.find((s) => s.kind === 'close')?.steps?.[index];
      if (cur && cur.label === label.trim() && (cur.note || '') === note.trim()) {
        restoreStructFocus(restore);
        return;
      }
      await applyStructure(
        { op: 'close-steps', action: 'update', index, label, note },
        { ok: 'Close step saved', detail: 'video.config.json', focusKey, restore },
      );
    } else if (field === 'plate.before') {
      const plateId = el.dataset.plateId || scene?.dataset.plateId;
      const before = el.value;
      const cur = script?.scenes.find((s) => s.plateId === plateId);
      if (cur?.before === before) return;
      await applyStructure({ op: 'plate-before', plateId, before }, { ok: 'Plate placement saved', detail: `Before “${before}”`, focusKey, restore });
    } else if (field.startsWith('plate.')) {
      const plateId = el.dataset.plateId || scene?.dataset.plateId;
      const cur = script?.scenes.find((s) => s.plateId === plateId);
      if (!plateId || !cur) return;
      const payload: Record<string, unknown> = {
        op: 'plate-update',
        plateId,
        title: fieldValue(scene, 'plate.title'),
        eyebrow: fieldValue(scene, 'plate.eyebrow'),
        sub: fieldValue(scene, 'plate.sub'),
      };
      for (const key of ['body', 'quote', 'author', 'role', 'value', 'unit', 'note'] as const) {
        const input = fieldEl(scene, `plate.${key}`);
        if (input) payload[key] = input.value;
      }
      const progressEl = fieldEl(scene, 'plate.progress');
      if (progressEl && progressEl.value !== '') payload.progress = Number(progressEl.value);
      for (const side of ['left', 'right'] as const) {
        const labelEl = fieldEl(scene, `plate.${side}.label`);
        const itemsEl = fieldEl(scene, `plate.${side}.items`);
        if (labelEl || itemsEl) {
          payload[side] = { label: labelEl?.value || (side === 'left' ? 'Before' : 'After'), items: splitLines(itemsEl?.value) };
        }
      }
      const rows = scene ? [...scene.querySelectorAll('.ss-plate-row')] : [];
      if (rows.length) {
        payload.rows = rows.map((row) => {
          const obj: Record<string, string> = {};
          row.querySelectorAll<HTMLInputElement>('[data-struct-field^="plate.row."]').forEach((inp) => {
            obj[(inp.dataset.structField || '').replace('plate.row.', '')] = inp.value;
          });
          return obj;
        });
      }
      await applyStructure(payload, { ok: 'Plate saved', detail: 'video.config.json — re-render plates to bake it in', focusKey, restore });
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
      await applyStructure({ op: 'call-update', index, holdMs }, { ok: 'Hold saved', detail: `${(holdMs / 1000).toFixed(1)}s on screen in flow.mjs`, focusKey, restore });
    } else if (field === 'call.title' || field === 'call.body') {
      const index = Number(el.dataset.flowIndex);
      const cur = script?.scenes.find((s) => s.flowIndex === index);
      const title = fieldValue(scene, 'call.title');
      const body = fieldValue(scene, 'call.body');
      if (cur && cur.title === title.trim() && (cur.onScreen || '') === body.trim()) {
        restoreStructFocus(restore);
        return;
      }
      const nextKey = field === 'call.title' && title.trim() !== cur?.title ? `${cur?.kind}:${title.trim()}` : focusKey;
      await applyStructure(
        { op: 'call-update', index, title, body },
        {
          ok: cur?.kind === 'chapter' ? 'Chapter saved' : 'Caption saved',
          detail: 'flow.mjs updated',
          focusKey: nextKey,
          // After a title rename the flow index is stable; keep the same field.
          restore: restore ? { ...restore, flow: String(index) } : null,
        },
      );
    }
  } catch (err) {
    toast('Could not save', message(err), 'err');
    restoreStructFocus(restore);
  } finally {
    el.classList.remove('saving');
  }
}

/** `onPreviewLiveCard` — `previewLiveCard()` in `kit/studio/app.js`. */
export function previewLiveCard({ kind, flowIndex }: { kind: 'chapter' | 'caption'; flowIndex: number }): void {
  const id = `overlay:${kind}:${flowIndex}`;
  const card = desk.get().htmlPlates.find((p) => p.id === id);
  if (!card) {
    toast('Card not ready', 'Rebuild plates / open Direction → Apply live cards first', 'warn');
    return;
  }
  bridges.plate?.showPlateHtml(card.id);
  showRightTab('motion');
}

const lastFlowIndex = (script: Script | null) =>
  (script?.scenes || []).reduce((max, s) => (s.flowIndex != null ? Math.max(max, s.flowIndex) : max), -1);

export async function onStructAction(btn: HTMLElement): Promise<void> {
  const action = btn.dataset.structAction;
  if (!action) return;
  const script = sheet.getState().script;
  try {
    if (action === 'add-chapter' || action === 'add-caption') {
      const kind = action === 'add-chapter' ? 'chapter' : 'step';
      const title = await ask({
        kind: 'prompt',
        title: kind === 'chapter' ? 'Add chapter' : 'Add caption',
        detail: kind === 'chapter' ? 'Inserted at the end of the live story in flow.mjs.' : 'Inserted after the last beat in flow.mjs.',
        label: kind === 'chapter' ? 'Chapter title' : 'Caption title',
        value: kind === 'chapter' ? 'New chapter' : 'New caption',
        ok: 'Add',
      });
      if (title == null || !String(title).trim()) return;
      await applyStructure(
        { op: 'call-add', kind, title: String(title).trim(), afterIndex: lastFlowIndex(script) },
        { ok: kind === 'chapter' ? 'Chapter added' : 'Caption added', detail: 'flow.mjs · add narration next' },
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
      await applyStructure({ op: 'call-add', kind: 'step', title: String(title).trim(), afterIndex }, { ok: 'Caption added', detail: 'flow.mjs' });
    } else if (action === 'preview-card') {
      const kind = btn.dataset.kind === 'chapter' ? 'chapter' : 'caption';
      const flowIndex = Number(btn.dataset.flowIndex);
      if (!Number.isInteger(flowIndex)) return;
      previewLiveCard({ kind, flowIndex });
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
      await applyStructure({ op: 'call-move', index, delta }, { ok: delta < 0 ? 'Moved earlier' : 'Moved later', detail: 'flow.mjs order updated' });
    } else if (action === 'hold-reset') {
      const index = Number(btn.dataset.flowIndex);
      await applyStructure({ op: 'call-update', index, holdMs: null }, { ok: 'Hold reset', detail: 'Using the default card duration again' });
    } else if (action === 'add-plate') {
      const types = script?.plateTypes?.length ? script.plateTypes : PLATE_TYPE_FALLBACK;
      const brand = desk.get().video?.brand;
      const type = await ask({
        kind: 'choice',
        title: 'Add interstitial plate',
        detail: 'Inserts a brand plate before a chapter. Edit copy and rows inline after it lands.',
        options: types.map((t) => ({
          value: t.type,
          label: t.label,
          hint: t.hint,
          still: brand ? `/api/plate-stills/${encodeURIComponent(brand)}/${encodeURIComponent(t.type)}.jpg` : '',
        })),
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
      await applyStructure({ op: 'plate-add', type, before }, { ok: 'Plate added', detail: `${type} before “${before}” · re-render plates to preview` });
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
      const blank: Record<string, string> = {};
      for (const f of scene.plate.fields || ['label']) blank[f] = '';
      rows.push(blank);
      await applyStructure({ op: 'plate-update', plateId, rows }, { ok: 'Row added', detail: 'Fill it in, then blur to save', focusKey: scene.key });
    } else if (action === 'plate-row-remove') {
      const plateId = btn.dataset.plateId;
      const index = Number(btn.dataset.rowIndex);
      const scene = script?.scenes.find((s) => s.plateId === plateId);
      if (!scene?.plate) return;
      const rows = [...(scene.plate.rows || [])];
      if (!Number.isInteger(index) || index < 0 || index >= rows.length) return;
      rows.splice(index, 1);
      await applyStructure({ op: 'plate-update', plateId, rows }, { ok: 'Row removed', detail: 'video.config.json', focusKey: scene.key });
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
      await applyStructure({ op: 'close-steps', action: 'add', label: String(label).trim() }, { ok: 'Step added', detail: 'Closing plate', focusKey: 'close' });
    } else if (action === 'close-step-remove') {
      const index = Number(btn.dataset.stepIndex);
      const ok = await ask({ title: 'Remove this close step?', detail: 'It will disappear from the closing plate.', ok: 'Remove', tone: 'warn' });
      if (!ok) return;
      await applyStructure({ op: 'close-steps', action: 'remove', index }, { ok: 'Step removed', detail: 'Closing plate', focusKey: 'close' });
    }
  } catch (err) {
    toast('Could not update script', message(err), 'err');
  }
}

/** Drop a dragged scene on another: plates move between chapters, calls move in flow.mjs. */
export async function commitSceneDrop(fromKey: string, toKey: string, edge: DropEdge): Promise<void> {
  const scenes = sheet.getState().script?.scenes || [];
  const from = scenes.find((s) => s.key === fromKey);
  const to = scenes.find((s) => s.key === toKey);
  if (!from || !to || from.key === to.key) return;
  if (from.kind === 'plate') {
    const chapter = to.kind === 'chapter' ? to : chapterSceneNear(scenes, to.key);
    if (!chapter?.title) {
      toast('Drop on a chapter', 'Plates sit before the chapter they introduce', 'warn');
      return;
    }
    const among = plateAmongIndex(scenes, chapter.title, to.kind === 'plate' ? to.key : null, to.kind === 'plate' ? edge : 'after', from.key);
    await applyStructure(
      { op: 'plate-move', plateId: from.plateId, before: chapter.title, among },
      { ok: 'Plate moved', detail: `Before “${chapter.title}”`, focusKey: from.key },
    );
    return;
  }
  if (from.flowIndex == null) return;
  const toIndex = callTargetIndex(scenes, from, to, edge);
  if (toIndex == null || toIndex === from.flowIndex) return;
  await applyStructure({ op: 'call-move-to', index: from.flowIndex, toIndex }, { ok: 'Beat moved', detail: 'flow.mjs order updated', focusKey: from.key });
}

/* ---------- agent jobs ---------- */

/** Run an agent job that rewrites sources, keep the script sheet live while it works. */
export async function followAgentJob(job: Job, title: string): Promise<boolean> {
  if (job.status === 'needs-agent') {
    toast('Agent sign-in needed', job.message || 'Run `agent login` (Cursor) or `claude` /login, then retry', 'warn');
    return false;
  }
  sheet.setState({ draftJob: job, draftTitle: title, review: desk.get().video?.review ?? sheet.getState().review });
  setFaviconMode('draft');
  try {
    await watchJob(job.id, {
      surface: 'session',
      onUpdate: (j) => sheet.setState({ draftJob: j }),
    });
    setFaviconMode('ok');
    toast(title.replace('…', ''), 'Done — review the script', 'ok');
    return true;
  } catch (err) {
    setFaviconMode('err');
    toast('Agent stopped', message(err), 'err');
    return false;
  } finally {
    sheet.setState({ draftJob: null });
    if (sheetOpen()) await loadScript().catch(() => {});
    void reload();
  }
}

export function setScriptNote(note: string): void {
  sheet.setState({ note });
}

export async function requestChanges(): Promise<void> {
  const revise = document.querySelector<HTMLDetailsElement>('#scriptDialog .script-revise');
  if (revise) revise.open = true;
  const note = sheet.getState().note.trim();
  if (!note) {
    document.getElementById('scriptNote')?.focus();
    toast('Add a note', 'Tell the agent what to change', 'warn');
    return;
  }
  try {
    const r = await api<{ job?: Job | null }>(`/api/video/${slug()}/script/request-changes`, { method: 'POST', body: { note } });
    sheet.setState({ note: '' });
    if (r.job) await followAgentJob(r.job, 'Agent is revising the script…');
  } catch (err) {
    toast('Request failed', message(err), 'err');
  }
}

export async function approveScript(): Promise<void> {
  const s = slug();
  const note = sheet.getState().note.trim();
  let review: ReviewSummary | undefined;
  try {
    const saved = await api<{ review?: ReviewSummary }>(`/api/video/${s}/script/approve`, { method: 'POST', body: { note } });
    review = saved.review;
  } catch (err) {
    if (!/blocking/i.test(message(err)) || !(await ask({ title: 'Approve with blocking issues?', detail: message(err), ok: 'Approve anyway', tone: 'warn' }))) {
      toast('Not approved', message(err), 'warn');
      return;
    }
    try {
      const saved = await api<{ review?: ReviewSummary }>(`/api/video/${s}/script/approve`, { method: 'POST', body: { note, force: true } });
      review = saved.review;
    } catch (err2) {
      toast('Not approved', message(err2), 'warn');
      return;
    }
  }
  const totals = sheet.getState().script?.totals;
  const plan = planScriptApproval({
    ok: true,
    chapters: totals?.chapters || 0,
    plates: totals?.plates || 0,
    ...(review?.script?.approvedAt ? { approvedAt: review.script.approvedAt } : {}),
  });
  sheet.setState({ note: '', approvedProof: plan.proof });
  toast('Script approved', plan.proof, 'ok');
  finishScriptApproval({ close: () => openDialog('script', false) }, plan);
  await reload();
  // First approval of a video that was never recorded: offer the first render right here.
  const v = desk.get().video;
  const f = v?.freshness;
  if (!f?.liveAt && !v?.hasDelivery && !f?.deliveryAt) {
    const go = await ask({
      title: 'Record and render now?',
      detail: 'Studio records the app following this script, cuts in the plates, adds voice and music, and opens the result in the player.',
      ok: 'Render',
      cancel: 'Later',
    });
    if (go) requestMake('full');
  }
}
