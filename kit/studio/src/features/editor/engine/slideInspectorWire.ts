import { clipPlayback, platePlayback, type PlateTimingInput } from '@/logic/plateTiming';

import { paintAtmosphereThumbs } from '@/ui/look/atmosphereThumbs';
import { postDeck } from './data';
import { select, toolSpeed } from './edits';
import { renderInspector } from './inspector';
import { paintInspectorUnlessContentTyping } from './plateContentSave';
import { changeLook, commitHoverLook, endHoverLook, hoverLook, plateApi, previewRange } from './look';
import { timingBar } from '@/ui/look/previews';
import { wirePlateColors } from './plateColorsPane';
import { wirePlateContent } from './plateContentPane';
import { openAddLibrary, openSwapLibrary, revertPlate } from './plateLibrary';
import { openPacePop, plateRow, rateFromFrac, refreshPacePop, savePlateTiming, setPaceMode, setPlateLength, setPlateRate, timingForLength } from './platePace';
import { slidePalette } from './slideInspector';
import { deckEdit, ed, type InspectorTab } from './state';
import { plateInfo, renderTimeline } from './timeline';
import { commitOrder } from './timelineWire';
import { seek } from './transport';
import type { Clip, DeckPlate } from './types';
import { fmtRate, r3 } from './util';

/** Binds the slide inspector's tabs, look tiles, timing, transitions and arrange controls. */

type El = HTMLElement & { value: string };

export function wireSlideInspector(root: HTMLElement): void {
  const on = (sel: string, ev: string, fn: (el: El, e: Event) => void) => root.querySelectorAll<El>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
  const clip = (): Clip | null => (ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel?.id) || null : null);
  // A repaint under the pointer drops the hovered tiles without a pointerleave.
  endHoverLook();

  on('[data-ins-tab]', 'click', (el) => {
    ed.insTab = (el.dataset['insTab'] as InspectorTab) || 'design';
    renderInspector();
    root.scrollTop = 0;
  });
  on('[data-goto-clip]', 'click', (el) => {
    const c = ed.seq.find((x) => x.id === el.dataset['gotoClip']);
    if (!c) return;
    seek(c.at + Math.min(0.15, c.dur * 0.2));
    select({ type: 'clip', id: c.id });
  });
  on('[data-act="watch-slide"]', 'click', () => {
    const c = clip();
    if (c) previewRange(c.at + 0.8, c.at + c.dur - 0.8);
  });
  on('[data-goto-voice]', 'click', (el) => {
    const v = (ed.deck?.audio?.voiceClips || []).find((x) => x.key === el.dataset['gotoVoice']);
    if (!v) return;
    seek(v.start + 0.05);
    select({ type: 'voice', key: v.key });
  });
  on('[data-act="add-voice-here"]', 'click', () => {
    select(null);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#inspectorRoot [data-voice-add-text]')?.focus());
  });
  on('[data-act="add-ramp"]', 'click', () => void toolSpeed());
  on('[data-act="plate-add"]', 'click', (el) => openAddLibrary(el, clip()));
  on('[data-act="plate-swap"]', 'click', (el) => {
    const c = clip();
    if (c) openSwapLibrary(c, el);
  });
  on('[data-act="plate-revert"]', 'click', (el) => {
    const c = clip();
    if (!c?.plateId) return;
    el.closest('.pl-card')?.classList.add('is-reverting');
    void revertPlate(c.plateId);
  });
  on('[data-act="pace"]', 'click', (el) => {
    const c = clip();
    if (c) openPacePop(el, c);
  });

  // Arrange: first / last (earlier and later share the legacy buttons).
  on('[data-clip-move]', 'click', (el) => {
    const c = clip();
    if (!c) return;
    const ids = ed.seq.map((x) => x.id).filter((id) => id !== c.id);
    if (el.dataset['clipMove'] === 'first') ids.unshift(c.id);
    else ids.push(c.id);
    void commitOrder(ids, el.dataset['clipMove'] === 'first' ? 'Moved to the start' : 'Moved to the end');
  });

  wireTransitions(root, on);

  const c = clip();
  if (c?.kind === 'plate') wirePlate(root, on, c);
  if (c?.kind === 'plate') wirePlateColors(root, c);
  if (c?.kind === 'plate') wirePlateContent(root, c);
  paintAtmosphereThumbs(root, slidePalette(c));
}

function wireTransitions(root: HTMLElement, on: (sel: string, ev: string, fn: (el: El, e: Event) => void) => void): void {
  const saveJoin = (i: number, entry: Record<string, unknown>, hint: string) => {
    const x = ed.seq[i];
    if (!x?.join) return Promise.resolve(null);
    const transitions = { ...(deckEdit().transitions || {}) };
    if (Object.keys(entry).length) transitions[x.join.key] = entry;
    else delete transitions[x.join.key];
    return postDeck({ transitions }, { hint });
  };
  const watch = (i: number) => {
    const x = ed.seq[i];
    if (x) previewRange(x.at - 0.6, x.at + x.overlap + 0.4);
  };
  on('[data-tr-style]', 'click', (el) => {
    const i = Number(el.dataset['trI']);
    const x = ed.seq[i];
    if (!x?.join) return;
    const pinned: { style?: string; duration?: number } = { ...(x.join.pinned || {}) };
    const style = el.dataset['trStyle'] || '';
    if (style) pinned.style = style;
    else delete pinned.style;
    el.closest('.lk-grid')?.querySelectorAll('.lk-tile').forEach((t) => t.classList.toggle('on', t === el));
    void saveJoin(i, pinned, style ? `Transition · ${el.querySelector('.lk-name')?.textContent || style}` : 'Transition follows the video').then((r) => r && watch(i));
  });
  on('[data-tr-dur]', 'input', (el) => {
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = `${Number(el.value).toFixed(2)}s`;
  });
  on('[data-tr-dur]', 'change', (el) => {
    const i = Number(el.dataset['trDur']);
    const x = ed.seq[i];
    if (x?.join) void saveJoin(i, { ...(x.join.pinned || {}), duration: Number(el.value) }, 'Transition length');
  });
  on('[data-tr-reset]', 'click', (el) => void saveJoin(Number(el.dataset['trReset']), {}, 'Transition follows the video'));
  on('[data-tr-watch]', 'click', (el) => watch(Number(el.dataset['trWatch'])));
  void root;
}

function wirePlate(root: HTMLElement, on: (sel: string, ev: string, fn: (el: El, e: Event) => void) => void, c: Clip): void {
  const id = c.plateId || '';

  on('[data-look-key]', 'click', (el) => {
    const key = el.dataset['lookKey'] || '';
    const value = el.dataset['look'] || '';
    // Mark the pick at once; the save and the frame repaint follow.
    root.querySelectorAll<HTMLElement>(`[data-look-key="${key}"]`).forEach((t) => t.classList.toggle('on', t === el));
    commitHoverLook();
    void changeLook(id, { [key]: value === '' ? null : value });
  });
  on('[data-look-key]', 'pointerenter', (el) => hoverLook(id, el.dataset['lookKey'] || '', el.dataset['look'] || null));
  root.querySelectorAll<HTMLElement>('.lk-grid:has([data-look-key])').forEach((g) => g.addEventListener('pointerleave', () => endHoverLook()));
  on('button[data-plate-layout]', 'click', (el) => {
    const layout = el.dataset['plateLayout'] || '';
    root.querySelectorAll<HTMLElement>('button[data-plate-layout]').forEach((t) => t.classList.toggle('on', t === el));
    void plateApi(id, 'layout', { layout }, 'Layout updated').then((r) => {
      const info = plateInfo(id);
      if (info && r) info.swap = (r as { swap?: DeckPlate['swap'] }).swap ?? null;
      paintInspectorUnlessContentTyping(renderInspector);
    });
  });

  // Timing. Sliders redraw the strip and the length as they move; the save lands on release.
  const base = clipPlayback(c);
  const pad = c.padOut || 0;
  const paint = (t: PlateTimingInput) => {
    const pb = platePlayback(t, base.baseDur, base.holdAt);
    const bar = root.querySelector('[data-tm-bar]');
    if (bar) bar.innerHTML = timingBar(pb);
    const out = root.querySelector('[data-tm-dur]');
    if (out) out.textContent = `${(pb.dur + pad).toFixed(1)}s`;
    const sub = root.querySelector('[data-tm-sub]');
    if (sub) sub.textContent = `${pb.identity ? 'as designed' : `designed ${(pb.baseDur + pad).toFixed(1)}s`}${Math.abs(pb.rate - 1) > 0.001 ? ` · plays at ${fmtRate(pb.rate)}` : ''}`;
    return pb;
  };
  const save = (t: PlateTimingInput | null, hint: string) => savePlateTiming(c, t, hint);
  const setOut = (el: HTMLElement, text: string) => {
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = text;
  };

  on('[data-pace-mode]', 'click', (el) => {
    setPaceMode(el.dataset['paceMode'] === 'stretch' ? 'stretch' : 'hold');
    paintInspectorUnlessContentTyping(renderInspector);
    renderTimeline();
    refreshPacePop();
  });
  on('[data-plate-len]', 'input', (el) => {
    const pb = paint(timingForLength(c, Number(el.value)));
    setOut(el, `${Number(el.value).toFixed(2)}s${Math.abs(pb.rate - 1) > 0.001 ? ` · ${fmtRate(pb.rate)}` : ''}`);
  });
  on('[data-plate-len]', 'change', (el) => void setPlateLength(c, Number(el.value)));
  on('[data-plate-time]', 'input', (el) => {
    setOut(el, `${Number(el.value).toFixed(2)}s`);
    paint({ ...plateRow(c), [el.dataset['plateTime'] || '']: Number(el.value) });
  });
  on('[data-plate-time]', 'change', (el) => {
    const k = el.dataset['plateTime'] || '';
    const hints: Record<string, string> = { trimStart: 'Intro trimmed', trimEnd: 'Exit trimmed', hold: 'Hold set' };
    void save({ ...plateRow(c), [k]: r3(Number(el.value)) }, hints[k] || 'Timing set');
  });
  on('[data-plate-rate]', 'click', (el) => void setPlateRate(c, Number(el.dataset['plateRate'])));
  on('[data-plate-rate-dial]', 'input', (el) => {
    const rate = rateFromFrac(Number(el.value));
    el.parentElement?.style.setProperty('--f', el.value);
    setOut(el, fmtRate(rate));
    paint({ ...plateRow(c), rate });
  });
  on('[data-plate-rate-dial]', 'change', (el) => void setPlateRate(c, rateFromFrac(Number(el.value))));
  on('[data-plate-nudge]', 'click', (el) => void setPlateLength(c, Math.max(0.6, c.dur + Number(el.dataset['plateNudge']))));
  on('[data-plate-fit]', 'click', (el) => void setPlateLength(c, Number(el.dataset['plateFit'])));
  on('[data-act="plate-time-reset"]', 'click', () => void save(null, 'Slide plays as designed'));
}
