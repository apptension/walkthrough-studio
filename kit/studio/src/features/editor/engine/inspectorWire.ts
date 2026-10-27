import type { Overlays, VideoSummary } from '@/api/types';
import { api } from '@/desk/api';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { cardMarkKey } from '@/logic/liveCardStage';
import { lensLoupe, lensZoomCeiling } from '@/logic/livePreview';

import { neonButtonLabel } from '@/ui/neonFx';
import { paintRange } from '@/ui/rangeFill';

import { aimSpace, deckLens, lensPatchFor, lensTarget, paintLensBox, paintZoomBox, recenterZoom, selectedShot } from './aim';
import {
  addVoiceLine,
  listenLine,
  pickMusicFile,
  pickVoiceFile,
  postAudio,
  previewState,
  regenerateLine,
  setNarrator,
  toggleMicRecord,
  voiceClip,
  withMaster,
  withMusic,
  withVoice,
} from './audio';
import { requestMake, requestMusicFit, saveDirection } from './ctx';
import { postDeck, refresh } from './data';
import { detachPlate, duplicateSelected } from './duplicate';
import { layoutRow, layoutText, sectionForClip, upsertLayout } from './layoutPreview';
import { addCut, addLensAt, addRamp, addZoomAt, adoptLens, adoptShot, removeSelected, restoreOmitted, select, selectFx, toolCaption, toolLens, toolZoom } from './edits';
import { liveCardRow, loadNarrators, renderInspector } from './inspector';
import { applyVar, changeLook, plateApi, previewRange, queueStyle, refreshPlatePreview, resetVar } from './look';
import { P } from './plateCtl';
import { flushEditorContentPending } from './plateContentPane';
import { beginEditOrigin, endEditOrigin, paintInspectorUnlessContentTyping } from './plateContentSave';
import { edToRec, lensByKey, selectedLens, shotKey } from './seq';
import { wireSlideInspector } from './slideInspectorWire';
import { renderFrame, requestPlate } from './stage';
import { audioDesk, deckEdit, ed, preview, setHtmlPlates, slug, type LensAim } from './state';
import { enterLiveCard, enterText, enterTextFor, exitText, paintFieldChips, paintTextMode } from './text';
import { cutBlocks, fxSegments } from './timeline';
import { moveClip, saveCardTiming } from './timelineWire';
import { pause } from './transport';
import type { DeckLens, DeckSection, LayoutRow, PlateRow, Trim, VoiceDesk } from './types';
import { $, clamp, errMessage, fmtRate, r3 } from './util';

/** `wireInspector()` from `kit/studio/editor.js` — binds the controls `renderInspector` just painted. */

const SIDE_PLACEMENTS = new Set(['left', 'right', 'top', 'bottom']);
let layoutCopyTimer: ReturnType<typeof setTimeout> | 0 = 0;

function wireLayout(
  root: HTMLElement,
  on: (sel: string, ev: string, fn: (el: Field, e: Event) => void) => void,
  act: (name: string, fn: () => unknown) => void,
  selClip: () => { kind?: string; id?: string } | null | undefined,
): void {
  clearTimeout(layoutCopyTimer);
  const selected = (): DeckSection | null => {
    const clip = selClip();
    return clip?.kind === 'live' ? sectionForClip(clip as Parameters<typeof sectionForClip>[0]) : null;
  };
  const copyOf = (section: DeckSection) => {
    const title = root.querySelector<HTMLInputElement>('[data-layout-title]')?.value ?? section.layout?.text?.title ?? section.copy?.title ?? '';
    const body = root.querySelector<HTMLTextAreaElement>('[data-layout-body]')?.value ?? section.layout?.text?.body ?? section.copy?.body ?? '';
    return { title, body };
  };
  const save = (row: LayoutRow | null, hint: string) => {
    const section = selected();
    if (!section) return;
    void postDeck({ layouts: upsertLayout(deckEdit().layouts, section.key, row) }, { hint });
  };
  on('[data-layout-place]', 'click', (el) => {
    const section = selected();
    if (!section) return;
    const placement = el.dataset['layoutPlace'] || 'fill';
    if (placement === 'fill') {
      save(null, 'Section fills the frame');
      return;
    }
    const cur = layoutRow(section);
    const copy = copyOf(section);
    const side = SIDE_PLACEMENTS.has(placement);
    save(
      {
        key: section.key,
        placement,
        size: cur.placement === 'fill' ? 'medium' : cur.size,
        text: layoutText(side ? (cur.placement === 'fill' ? true : cur.text.on) : false, copy.title, copy.body, section.source),
      },
      'Section layout',
    );
  });
  on('[data-layout-size]', 'click', (el) => {
    const section = selected();
    if (!section) return;
    const cur = layoutRow(section);
    const placement = cur.placement === 'fill' ? 'center' : cur.placement;
    const copy = copyOf(section);
    save(
      {
        key: section.key,
        placement,
        size: el.dataset['layoutSize'] || 'medium',
        text: layoutText(SIDE_PLACEMENTS.has(placement) && cur.text.on, copy.title, copy.body, section.source),
      },
      'Section size',
    );
  });
  on('[data-layout-text]', 'change', (el) => {
    const section = selected();
    if (!section?.layout || !SIDE_PLACEMENTS.has(section.layout.placement)) return;
    const copy = copyOf(section);
    save(
      {
        key: section.key,
        placement: section.layout.placement,
        size: section.layout.size,
        text: layoutText(el.checked, copy.title, copy.body, section.source),
      },
      el.checked ? 'Side text on' : 'Side text off',
    );
  });
  const commitCopy = () => {
    const section = selected();
    if (!section?.layout || !section.layout.text.on || !SIDE_PLACEMENTS.has(section.layout.placement)) return;
    const copy = copyOf(section);
    save(
      {
        key: section.key,
        placement: section.layout.placement,
        size: section.layout.size,
        text: layoutText(true, copy.title, copy.body, section.source),
      },
      'Side text',
    );
  };
  on('[data-layout-title], [data-layout-body]', 'input', () => {
    clearTimeout(layoutCopyTimer);
    layoutCopyTimer = setTimeout(commitCopy, 400);
  });
  on('[data-layout-title], [data-layout-body]', 'change', () => {
    clearTimeout(layoutCopyTimer);
    commitCopy();
  });
  act('layout-all', () => {
    const section = selected();
    const pack = ed.deck?.layouts;
    if (!section || !pack) return;
    const cur = layoutRow(section);
    if (cur.placement === 'fill') {
      void postDeck({ layouts: [] }, { hint: 'Every section fills the frame' });
      return;
    }
    const rows = pack.sections.map((s) => ({
      key: s.key,
      placement: cur.placement,
      size: cur.size,
      text: layoutText(
        Boolean(cur.text.on) && SIDE_PLACEMENTS.has(cur.placement),
        s.layout?.text?.title || s.source?.title || '',
        s.layout?.text?.body || s.source?.body || '',
        s.source,
      ),
    }));
    void postDeck({ layouts: rows }, { hint: 'Layout applied to every section' });
  });
  act('layout-reset', () => save(null, 'Section follows the video'));
}

/** `wireInspector()` from `kit/studio/editor.js` — binds the controls `renderInspector` just painted. */

/** The legacy added the delegated `[data-var-reset]` listener to the persistent root on every render; one is enough. */
let rootClicks: AbortController | null = null;

type Field = HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;

export function wireInspector(): void {
  const root = $('inspectorRoot');
  if (!root) return;
  const s = ed.sel;
  const d = deckEdit();
  const on = (sel: string, ev: string, fn: (el: Field, e: Event) => void) =>
    root.querySelectorAll<Field>(sel).forEach((el) => el.addEventListener(ev, (e) => fn(el, e)));
  const act = (name: string, fn: () => unknown) => root.querySelector(`[data-act="${name}"]`)?.addEventListener('click', () => void fn());
  const key = s?.key ?? '';
  const selClip = () => (ed.sel?.type === 'clip' ? ed.seq.find((c) => c.id === ed.sel?.id) : null);
  wireLayout(root, on, act, selClip);

  on('input[type="range"]', 'input', (el) => paintRange(el));
  act('remove', removeSelected);
  act('duplicate', duplicateSelected);
  act('detach-plate', () => {
    const c = selClip();
    return c && detachPlate(c);
  });
  on('[data-act="restore-omit"]', 'click', (el) => void restoreOmitted(el.dataset['omitId'] || ''));
  act('voice-mute', () => {
    const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === s?.key);
    if (clip) void withVoice(clip.key, { mute: !clip.mute }, clip.mute ? 'Line back in' : 'Line muted');
  });
  act('voice-reset', () => s?.key && withVoice(s.key, { nudge: 0, at: null }, 'Back to where the line belongs'));
  act('clip-earlier', () => ed.sel?.type === 'clip' && moveClip(ed.sel.id ?? '', -1));
  act('clip-later', () => ed.sel?.type === 'clip' && moveClip(ed.sel.id ?? '', 1));
  const setLiveTrim = (id: string, patch: Partial<Trim>) => {
    const clip = ed.seq.find((c) => c.id === id && c.kind === 'live');
    if (!clip) return Promise.resolve();
    const cur: Partial<Trim> = { ...(d.trims || []).find((t) => t.id === id) };
    const next: Trim = { id, trimStart: cur.trimStart || 0, trimEnd: cur.trimEnd || 0, ...patch };
    if (!next.trimStart) delete next.trimStart;
    if (!next.trimEnd) delete next.trimEnd;
    const trims = (d.trims || []).filter((t) => t.id !== id);
    if (next.trimStart || next.trimEnd) trims.push(next);
    return postDeck({ trims }, { hint: 'Recording clip trimmed' });
  };
  on('[data-live-trim]', 'input', (el) => {
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = `${Number(el.value).toFixed(2)}s`;
  });
  on('[data-live-trim]', 'change', (el) => {
    const k = el.dataset['liveTrim'] || '';
    const clip = selClip();
    if (!clip || clip.kind !== 'live') return;
    void setLiveTrim(clip.id, { [k]: r3(Number(el.value) || 0) });
  });
  on('[data-live-trim-reset]', 'click', (el) => {
    const clip = selClip();
    if (!clip || clip.kind !== 'live') return;
    void setLiveTrim(clip.id, { [el.dataset['liveTrimReset'] || '']: 0 });
  });
  act('trim-head-playhead', () => {
    const clip = selClip();
    if (!clip || clip.kind !== 'live') return;
    const cur: Partial<Trim> = (d.trims || []).find((t) => t.id === clip.id) || {};
    const rawFrom = clip.recFrom - (cur.trimStart || 0);
    const recT = edToRec(clip, ed.t);
    const head = r3(Math.max(0, Math.min(recT - rawFrom, clip.recTo + (cur.trimEnd || 0) - rawFrom - 0.4)));
    void setLiveTrim(clip.id, { trimStart: head });
  });
  act('trim-tail-playhead', () => {
    const clip = selClip();
    if (!clip || clip.kind !== 'live') return;
    const cur: Partial<Trim> = (d.trims || []).find((t) => t.id === clip.id) || {};
    const rawTo = clip.recTo + (cur.trimEnd || 0);
    const recT = edToRec(clip, ed.t);
    const tail = r3(Math.max(0, Math.min(rawTo - recT, rawTo - (clip.recFrom - (cur.trimStart || 0)) - 0.4)));
    void setLiveTrim(clip.id, { trimEnd: tail });
  });
  act('music-mute', () => withMusic({ mute: !audioDesk().music.mute }, audioDesk().music.mute ? 'Music back in' : 'Music muted'));
  act('music-compose', () => {
    const prompt = root.querySelector<HTMLTextAreaElement>('[data-music-prompt]')?.value ?? '';
    void requestMusicFit({ prompt });
  });
  act('music-upload', () => pickMusicFile());
  on('[data-music-loop]', 'change', (el) => void withMusic({ loop: el.checked }, el.checked ? 'Music loops to fill the cut' : 'Music ends with the bed'));
  act('master-reset', () => postAudio({ ...audioDesk(), master: {} }, 'Back to the brand mix'));
  act('ride-remove', () => {
    const rides = audioDesk().music.rides.filter((_, i) => i !== s?.i);
    void withMusic({ rides }, 'Ride removed').then(() => select({ type: 'music' }));
  });
  root.querySelectorAll<HTMLElement>('[data-act="ride"]').forEach((el) =>
    el.addEventListener('click', () => {
      const db = Number(el.dataset['rideDb']);
      const from = r3(ed.t);
      const to = r3(Math.min(ed.total, from + 4));
      if (to - from < 0.4) return;
      const rides = [...audioDesk().music.rides, { from, to, gainDb: db }];
      void withMusic({ rides }, db < 0 ? 'Softer there' : 'Louder there');
    }),
  );
  act('record', () => requestMake('full'));
  // Generic entry (not a click on a specific field already in view) — jump to the plate's
  // best-populated frame first so the editor doesn't land on a mid-reveal or empty one.
  act('text', () => (ed.textMode ? exitText() : enterText(null, { seekToPeak: true })));
  on('[data-edit-card]', 'click', (el) => {
    if (ed.textMode && ed.liveCardId && ed.liveCardId === el.dataset['editCard']) exitText();
    else void enterLiveCard(el.dataset['editCard'] || null, el.dataset['markT'] ?? null, el.dataset['markKey'] || null);
  });
  act('field-focus', () => ed.plateField?.path && enterTextFor(ed.plateField.path));
  act('field-accent', () => {
    if (!ed.textMode) void enterText(ed.plateField?.path ?? null);
    else P.accent?.();
  });
  on('[data-field]', 'click', (el) => void enterTextFor(el.dataset['field'] ?? null));
  on('[data-field-src]', 'input', (el) => {
    const path = ed.plateField?.path;
    if (!path || !ed.plateField) return;
    beginEditOrigin('pane');
    try {
      P.setField?.(path, el.value);
      ed.plateField = { ...ed.plateField, source: el.value, dirty: true };
      paintTextMode();
      paintFieldChips();
    } finally {
      queueMicrotask(() => endEditOrigin());
    }
  });
  act('add-zoom', toolZoom);
  act('adopt', () => {
    const shot = selectedShot();
    return shot && adoptShot(shot);
  });
  act('zoom-center', recenterZoom);
  act('add-lens', toolLens);
  act('add-caption', toolCaption);
  act('adopt-lens', () => {
    const l = selectedLens();
    return l && adoptLens(l);
  });
  act('lens-on', () => {
    const l = selectedLens();
    if (l)
      void postDeck({ lensOff: d.lensOff.filter((t) => Math.abs(Number(t) - l.t) > 0.0005) }, { hint: 'Recorded magnifier back on' }).then(
        (r) => r && select({ type: 'lens', key: `auto:${l.t}` }),
      );
  });
  act('preview-sel', () => {
    if (s?.type === 'ramp') {
      const r = d.speed[s.i ?? -1];
      const seg = r && fxSegments(r.from, r.to)[0];
      if (seg) previewRange(seg.a, seg.b);
    } else if (s?.type === 'voice') {
      const clip = (ed.deck?.audio?.voiceClips || []).find((c) => c.key === s.key);
      if (clip) previewRange(clip.start, clip.start + clip.dur);
    } else if (s?.type === 'ride') {
      const ride = audioDesk().music.rides[s.i ?? -1];
      if (ride) previewRange(ride.from, ride.to);
    } else if (s?.type === 'lens') {
      const l = selectedLens();
      const seg = l && fxSegments(l.t, l.t + l.dur, l.clip)[0];
      if (seg) previewRange(seg.a, seg.b);
    } else if (s?.type === 'zoom') {
      const shot = selectedShot();
      const seg = shot && fxSegments(shot.start, shot.end, shot.clip)[0];
      if (seg) {
        ed.sel = { ...s };
        previewRange(seg.a, seg.b);
      }
    }
  });
  act('preview-join', () => {
    const c = ed.seq[s?.i ?? -1];
    if (c) previewRange(c.at - 0.6, c.at + c.overlap + 0.4);
  });
  on('[data-goto-join]', 'click', (el) => {
    const c = ed.seq[Number(el.dataset['gotoJoin'])];
    if (c?.join) select({ type: 'join', key: c.join.key, i: c.i });
  });
  on('[data-goto-ramp]', 'click', (el) => select({ type: 'ramp', i: Number(el.dataset['gotoRamp']) }));
  on('[data-goto-lens]', 'click', (el) => {
    const l = lensByKey(el.dataset['gotoLens']);
    if (l) selectFx({ kind: 'lens', key: l.key, lens: l, from: l.t, to: l.t + l.dur, min: 0 });
  });
  on('[data-goto-shot]', 'click', (el) => {
    const shot = (ed.deck?.zoomShots || []).find((x) => shotKey(x) === el.dataset['gotoShot']);
    if (shot) selectFx({ kind: 'zoom', key: shotKey(shot), shot, from: shot.start, to: shot.end, min: 0 });
  });

  // Live clip
  on('[data-clip-rate]', 'click', (el) => {
    const c = ed.seq.find((x) => x.id === s?.id);
    if (!c) return;
    const rate = Number(el.dataset['clipRate']);
    const speed = d.speed.filter((r) => r.to <= c.recFrom + 0.001 || r.from >= c.recTo - 0.001);
    if (rate !== 1) speed.push({ from: r3(c.recFrom), to: r3(c.recTo), rate });
    void postDeck({ speed }, { hint: rate === 1 ? 'Normal speed' : `Whole clip at ${fmtRate(rate)}` });
  });
  const camera = (patch: Record<string, string | undefined>) => async () => {
    await saveDirection({ camera: patch }, { quiet: true });
    await refresh();
  };
  on('[data-cam-zoom]', 'click', (el) => void camera({ zoom: el.dataset['camZoom'] })().catch(() => undefined));
  on('[data-cam-curve]', 'click', (el) => void camera({ curve: el.dataset['camCurve'] })().catch(() => undefined));
  on('[data-cam-motion]', 'click', (el) => void camera({ motion: el.dataset['camMotion'] })().catch(() => undefined));
  on('[data-cursor-style]', 'click', (el) => void saveDirection({ cursor: { style: el.dataset['cursorStyle'] } }, { quiet: true }).then(refresh, () => undefined));
  on('[data-cursor-size]', 'click', (el) => void saveDirection({ cursor: { size: el.dataset['cursorSize'] } }, { quiet: true }).then(refresh, () => undefined));
  on('[data-pace]', 'click', (el) => void saveDirection({ pace: el.dataset['pace'] }, { quiet: true }).then(refresh, () => undefined));

  // Ramp
  const setRampRate = (rate: number) => postDeck({ speed: d.speed.map((r, i) => (i === s?.i ? { ...r, rate } : r)) });
  on('[data-ramp-rate]', 'input', (el) => {
    const out = $('insRateOut');
    if (out) out.textContent = fmtRate(el.value);
  });
  on('[data-ramp-rate]', 'change', (el) => void setRampRate(Number(el.value)));
  on('[data-ramp-preset]', 'click', (el) => void setRampRate(Number(el.dataset['rampPreset'])));

  // Zoom — strength paints the stage at once; the save lands when the slider settles.
  const shot = selectedShot();
  const setZoom = (zoom: number) => (shot ? postDeck({ zooms: d.zooms.map((z) => (z.id === shot.id ? { ...z, zoom } : z)) }) : null);
  on('[data-shot-zoom]', 'input', (el) => {
    const out = $('insZoomOut');
    if (out) out.textContent = `${Number(el.value).toFixed(2)}×`;
    ed.aimZoom = Number(el.value);
    paintZoomBox();
    renderFrame();
  });
  on('[data-shot-zoom]', 'change', (el) => {
    // Keep aimZoom until the deck save lands — clearing early flashes the old strength on stage.
    const zoom = Number(el.value);
    ed.aimZoom = zoom;
    void setZoom(zoom)?.finally(() => {
      ed.aimZoom = null;
    });
  });
  on('[data-zoom-preset]', 'click', (el) => {
    const zoom = Number(el.dataset['zoomPreset']);
    ed.aimZoom = zoom;
    const out = $('insZoomOut');
    if (out) out.textContent = `${zoom.toFixed(2)}×`;
    paintZoomBox();
    renderFrame();
    void setZoom(zoom)?.finally(() => {
      ed.aimZoom = null;
    });
  });

  // Magnifier
  const lens = selectedLens();
  const own = lens?.source === 'edit' ? deckLens(lens) : null;
  const [lensLo, lensHi] = ed.deck?.ranges?.lensZoom || [1.2, 2.4];
  // A plate's magnifier stores its area as fractions of the frame; the rows here speak pixels.
  const saveLens = (patch: Partial<DeckLens>) =>
    own && lens ? postDeck({ lenses: d.lenses.map((l) => (l.id === own.id ? { ...l, ...lensPatchFor(lens, patch) } : l)) }, { hint: 'Magnifier saved' }) : null;
  // The aim carries every pending slider value, so strength and area preview together.
  const previewLens = (patch: Partial<LensAim>) => {
    if (!own || !lens) return;
    const base: LensAim = ed.lensAim || { ...lensTarget(lens), zoom: own.zoom };
    ed.lensAim = { ...base, ...patch };
    renderFrame();
    paintLensBox();
    syncLensStrength();
  };
  const lensSizeNow = () => {
    const a = ed.lensAim;
    return Math.max(a?.w ?? own?.w ?? lens?.rect.w ?? 24, a?.h ?? own?.h ?? lens?.rect.h ?? 24);
  };
  const lensFrame = aimSpace(lens?.clip);
  const lensCeiling = () => r3(clamp(lensZoomCeiling(lensSizeNow(), lensFrame), lensLo, lensHi));
  /** Strength slider, readout, presets and the cap note follow the area the loupe has to cover. */
  function syncLensStrength() {
    const zoomEl = root!.querySelector<HTMLInputElement>('[data-lens-zoom]');
    if (!zoomEl || !own) return;
    const ceiling = lensCeiling();
    const want = ed.lensAim ? ed.lensAim.zoom : own.zoom;
    const loupe = lensLoupe(lensSizeNow(), want, lensFrame);
    zoomEl.max = String(ceiling);
    zoomEl.disabled = ceiling - lensLo < 0.05;
    if (want != null && Number(zoomEl.value) !== Math.min(want, ceiling)) zoomEl.value = String(Math.min(want, ceiling));
    const out = $('insLensOut');
    if (out) out.textContent = `${loupe.zoom.toFixed(2)}×${want == null ? ' auto' : ''}`;
    root!.querySelectorAll<HTMLButtonElement>('[data-lens-preset]').forEach((b) => {
      const v = Number(b.dataset['lensPreset']);
      b.disabled = Boolean(v) && v > ceiling + 1e-6;
    });
    const cap = root!.querySelector('[data-lens-cap]');
    if (cap) {
      cap.textContent =
        ceiling < lensHi - 1e-6 ? `Up to ${ceiling.toFixed(2)}× for a ${Math.round(lensSizeNow())}px area — shrink the area for a stronger loupe.` : '';
    }
  }
  on('[data-lens-zoom]', 'input', (el) => previewLens({ zoom: Number(el.value) }));
  on('[data-lens-zoom]', 'change', (el) => {
    const zoom = Math.min(Number(el.value), lensCeiling());
    previewLens({ zoom });
    void saveLens({ zoom })?.finally(() => {
      ed.lensAim = null;
    });
  });
  on('[data-lens-preset]', 'click', (el) => {
    const zoom = el.dataset['lensPreset'] ? Number(el.dataset['lensPreset']) : undefined;
    if (zoom) {
      if (zoom > lensCeiling() + 1e-6) return;
      previewLens({ zoom });
      void saveLens({ zoom })?.finally(() => {
        ed.lensAim = null;
      });
    } else if (own) {
      const rest = { ...own };
      delete rest.zoom;
      previewLens({ zoom: undefined });
      void postDeck({ lenses: d.lenses.map((l) => (l.id === own.id ? rest : l)) }).finally(() => {
        ed.lensAim = null;
      });
    }
  });
  on('[data-lens-size]', 'input', (el) => {
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = `${el.value}px`;
    previewLens({ [el.dataset['lensSize'] || 'w']: Number(el.value) });
  });
  on('[data-lens-size]', 'change', (el) => {
    const patch: Partial<DeckLens> = { [el.dataset['lensSize'] || 'w']: Number(el.value) };
    previewLens(patch);
    // A wider area lowers the ceiling; keep the stored strength at a value the loupe can draw.
    const ceiling = lensCeiling();
    if (own?.zoom != null && own.zoom > ceiling + 1e-6) patch.zoom = ceiling;
    void saveLens(patch)?.finally(() => {
      ed.lensAim = null;
    });
  });

  // Join
  const joinC = s?.type === 'join' ? ed.seq[s.i ?? -1] : null;
  const saveJoin = (entry: Record<string, unknown>) => {
    const transitions = { ...(d.transitions || {}) };
    const joinKey = joinC?.join?.key ?? '';
    if (Object.keys(entry).length) transitions[joinKey] = entry;
    else delete transitions[joinKey];
    return postDeck({ transitions });
  };
  on('[data-join-style]', 'click', (el) => {
    if (!joinC?.join) return;
    const pinned: { style?: string; duration?: number } = { ...(joinC.join.pinned || {}) };
    if (el.dataset['joinStyle']) pinned.style = el.dataset['joinStyle'];
    else delete pinned.style;
    void saveJoin(pinned).then(() => {
      const c = ed.seq[s?.i ?? -1];
      if (c) previewRange(c.at - 0.6, c.at + c.overlap + 0.4);
    });
  });
  on('[data-join-dur]', 'input', (el) => {
    const out = $('insJoinOut');
    if (out) out.textContent = `${Number(el.value).toFixed(2)}s`;
  });
  on('[data-join-dur]', 'change', (el) => void (joinC?.join && saveJoin({ ...(joinC.join.pinned || {}), duration: Number(el.value) })));
  act('join-reset', () => joinC && saveJoin({}));

  // Card on-screen length (same edit.cards path as timeline edge drags).
  const cardSel = s?.type === 'card' ? s : null;
  const cardKind = (() => {
    if (!cardSel?.key) return null;
    const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === cardSel.key);
    return mark?.kind === 'chapter' ? 'chapter' : mark?.kind === 'caption' ? 'caption' : null;
  })();
  on('[data-card-dur]', 'input', (el) => {
    const out = $('insCardDurOut');
    if (out) out.textContent = `${Number(el.value).toFixed(1)}s`;
  });
  on('[data-card-dur]', 'change', (el) => {
    if (!cardSel?.key) return;
    const mark = (ed.deck?.marks || []).find((m) => (m.key || cardMarkKey(m)) === cardSel.key);
    void saveCardTiming(
      { key: cardSel.key, t: cardSel.markT ?? mark?.t ?? 0, dur: Number(el.value) },
      { cardId: cardSel.cardId ?? null, clipId: cardSel.clipId ?? null, hint: 'Card length changed' },
    );
  });

  async function saveCardOverlays(patch: Record<string, unknown>, hint: string) {
    const current = slug();
    if (!current) return;
    try {
      await flushEditorContentPending();
      const r = await api<{ plates?: PlateRow[]; overlays?: Overlays; direction?: VideoSummary['direction'] }>(
        `/api/video/${encodeURIComponent(current)}/overlays`,
        { method: 'POST', body: patch },
      );
      if (r?.plates) setHtmlPlates(r.plates, { video: false });
      const v = desk.get().video;
      if (v) {
        desk.set({
          video: {
            ...v,
            ...(r.overlays !== undefined ? { overlays: r.overlays } : {}),
            direction: r.direction || v.direction,
            htmlPlates: (r.plates as unknown as VideoSummary['htmlPlates']) || v.htmlPlates,
          },
        });
      }
      for (const p of r.plates || (desk.get().htmlPlates) || []) {
        if (p.liveCard || String(p.id || '').startsWith('overlay:')) ed.stalePlates.add(p.id);
      }
      const activeId = ed.liveCardId || ed.compositeCardId || cardSel?.cardId || null;
      ed.compositeCardId = null;
      ed.compositeSeekMs = null;
      if (activeId) await requestPlate(activeId, { reason: 'show' });
      toast('Live card look', hint || r.overlays?.preset || 'saved');
      paintInspectorUnlessContentTyping(renderInspector);
    } catch (err) {
      toast('Live cards failed', errMessage(err), 'err');
    }
  }

  // Background trio (atmosphere · backdrop · opacity) saves for the card's chapter unless the
  // scope is "All chapters"; preset, entrance, ornaments, seat and text are always video-wide.
  const lookChapterNo = Number(liveCardRow(cardSel)?.chapterNo) || 0;
  const chapterScoped = () => Boolean(lookChapterNo) && ed.lookScope !== 'video';
  const scopeHint = () => (chapterScoped() ? `chapter ${lookChapterNo}` : 'all chapters');
  const backgroundPatch = (slotPatch: Record<string, unknown>) =>
    chapterScoped() ? { chapterNo: lookChapterNo, [cardKind ?? '']: slotPatch } : { [cardKind ?? '']: slotPatch };

  on('[data-look-scope]', 'click', (el) => {
    ed.lookScope = el.dataset['lookScope'] === 'video' ? 'video' : 'chapter';
    paintInspectorUnlessContentTyping(renderInspector);
  });
  act('look-apply-all', () => {
    if (!cardKind || !lookChapterNo) return;
    return saveCardOverlays({ applyToAll: true, chapterNo: lookChapterNo, slot: cardKind }, `Chapter ${lookChapterNo} ${cardKind} background → all chapters`);
  });
  act('look-follow-video', () => {
    if (!cardKind || !lookChapterNo) return;
    return saveCardOverlays({ reset: true, chapterNo: lookChapterNo, slot: cardKind }, `Chapter ${lookChapterNo} ${cardKind} · follows the video`);
  });

  on('[data-overlay-preset]', 'change', (el) => {
    if (!cardKind) return;
    void saveCardOverlays({ preset: el.value }, `Preset · ${el.value}`);
  });
  on('[data-overlay]', 'change', (el) => {
    if (!cardKind) return;
    const k = el.dataset['overlay'];
    if (!k) return;
    if (k === 'atmosphere') {
      void saveCardOverlays(backgroundPatch({ atmosphere: el.value }), `${cardKind} · background ${el.value} · ${scopeHint()}`);
      return;
    }
    void saveCardOverlays({ [cardKind]: { [k]: el.value } }, `${cardKind} · ${k}`);
  });
  on('[data-overlay-backdrop]', 'change', (el) => {
    if (!cardKind) return;
    const v = el.value;
    if (v === 'custom') {
      // Hand off to the swatch; the colour input's change saves the hex.
      const picker = root.querySelector<HTMLInputElement>('[data-overlay-backdrop-color]');
      if (picker) {
        picker.click();
        return;
      }
    }
    // Video-wide "auto" is the default (cleared); for one chapter it is an explicit choice that
    // can override a coloured video backdrop, so it is stored as-is.
    const backdrop = v === 'auto' && !chapterScoped() ? null : v;
    void saveCardOverlays(backgroundPatch({ backdrop }), `${cardKind} · backdrop ${v} · ${scopeHint()}`);
  });
  on('[data-overlay-backdrop-color]', 'input', (el) => {
    const sw = el.closest<HTMLElement>('.ins-swatch');
    if (sw) {
      sw.style.setProperty('--sw', el.value);
      sw.classList.remove('is-off');
    }
  });
  on('[data-overlay-backdrop-color]', 'change', (el) => {
    if (!cardKind) return;
    void saveCardOverlays(backgroundPatch({ backdrop: el.value }), `${cardKind} · backdrop ${el.value} · ${scopeHint()}`);
  });
  on('[data-overlay-backdrop-opacity]', 'input', (el) => {
    const out = el.parentElement?.querySelector('output');
    if (out) out.textContent = `${el.value}%`;
  });
  on('[data-overlay-backdrop-opacity]', 'change', (el) => {
    if (!cardKind) return;
    void saveCardOverlays(backgroundPatch({ backdropOpacity: Number(el.value) }), `${cardKind} · backdrop ${el.value}% · ${scopeHint()}`);
  });
  on('[data-overlay-bool]', 'click', (el) => {
    if (!cardKind) return;
    const k = el.dataset['overlayBool'];
    if (!k) return;
    const forced = el.dataset['bool'];
    const isOn = forced != null ? forced === 'on' : !el.classList.contains('on');
    void saveCardOverlays({ [cardKind]: { [k]: isOn } }, `${cardKind} · ${k} ${isOn ? 'on' : 'off'}`);
  });

  // Range
  const rangeC = s?.type === 'range' ? s : null;
  const rFrom = rangeC?.from ?? 0;
  const rTo = rangeC?.to ?? 0;
  on('[data-range-rate]', 'click', (el) => void (rangeC && addRamp(rFrom, rTo, Number(el.dataset['rangeRate']))));
  on('[data-range-zoom]', 'click', () => void (rangeC && addZoomAt(rFrom, rTo - rFrom)));
  on('[data-range-cut]', 'click', () => void (rangeC && addCut(rFrom, rTo)));
  act('preview-cut', () => {
    const cut = ed.sel?.type === 'cut' ? cutBlocks().find((c) => c.i === ed.sel?.i) : null;
    if (cut) previewRange(Math.max(0, cut.splice - 0.2), cut.splice + 0.9);
  });
  on('[data-range-lens]', 'click', () => void (rangeC && addLensAt(rFrom, rTo - rFrom)));
  on('[data-range-skip]', 'click', () => {
    if (!rangeC) return;
    void postDeck({ zoomSkips: [...d.zoomSkips, { from: rFrom, to: rTo }] }, { hint: 'No auto zoom in that stretch' }).then((r) => {
      if (r) select(null);
    });
  });

  // Audio desk. Sliders preview while dragging and save when released.
  const outOf = (el: HTMLElement) => el.parentElement?.querySelector('output');
  const setOut = (el: HTMLElement, text: string) => {
    const out = outOf(el);
    if (out) out.textContent = text;
  };
  on('[data-voice-gain]', 'input', (el) => {
    setOut(el, `${Number(el.value).toFixed(1)} dB`);
    ed.hear = { voice: { key, gainDb: Number(el.value) } };
    if (ed.playing) preview.play(previewState(), ed.t);
    else preview.sync(previewState(), ed.t, false);
  });
  on('[data-voice-gain]', 'change', (el) => void withVoice(key, { gainDb: Number(el.value) }));
  on('[data-voice-nudge]', 'input', (el) => setOut(el, `${Number(el.value) > 0 ? '+' : ''}${Number(el.value).toFixed(2)}s`));
  on('[data-voice-nudge]', 'change', (el) => void withVoice(key, { nudge: Number(el.value) }, 'Line moved'));

  // Per-line shape: trims and fades. Trim keeps at least ranges.voiceMinSec of speech.
  on('[data-voice-shape]', 'input', (el) => setOut(el, `${Number(el.value).toFixed(2)}s`));
  on('[data-voice-shape]', 'change', (el) => {
    const clip = voiceClip(key);
    if (!clip) return;
    const k = el.dataset['voiceShape'] || '';
    let v = Number(el.value);
    const minSec = ed.deck?.ranges?.voiceMinSec || 0.3;
    if (k === 'trimStart') v = clamp(v, 0, r3(clip.full - clip.trimEnd - minSec));
    if (k === 'trimEnd') v = clamp(v, 0, r3(clip.full - clip.trimStart - minSec));
    const patch: Partial<VoiceDesk> = { [k]: r3(v) };
    // The head trim moves the start by the same amount, so the words that stay keep their place.
    if (k === 'trimStart') patch.nudge = r3((clip.nudge || 0) + (v - clip.trimStart));
    const hints: Record<string, string> = { trimStart: 'Head trimmed', trimEnd: 'Tail trimmed', fadeIn: 'Fade in set', fadeOut: 'Fade out set' };
    void withVoice(key, patch, hints[k]).then(() => listenLine(voiceClip(key)));
  });
  on('[data-voice-shape-reset]', 'click', (el) => {
    const clip = voiceClip(key);
    const k = el.dataset['voiceShapeReset'] || '';
    const patch: Partial<VoiceDesk> = { [k]: 0 };
    if (k === 'trimStart' && clip) patch.nudge = r3((clip.nudge || 0) - clip.trimStart);
    void withVoice(key, patch);
  });
  act('voice-shape-reset', () => {
    const clip = voiceClip(key);
    return withVoice(key, { trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0, nudge: r3((clip?.nudge || 0) - (clip?.trimStart || 0)) }, 'Whole take');
  });

  // The line itself: rewrite, pace, takes. Regenerate sends the textarea as it stands.
  const lineBody = () => {
    const clip = voiceClip(key);
    const text = root.querySelector<HTMLTextAreaElement>('[data-voice-text]')?.value.replace(/\s+/g, ' ').trim() || '';
    const speed = Number(root.querySelector<HTMLSelectElement>('[data-voice-speed]')?.value || clip?.speed || 1);
    const body: { speed: number; text?: string } = { speed };
    const written = (clip?.written || '').replace(/\s+/g, ' ').trim();
    const effective = (clip?.textOverride || clip?.text || '').replace(/\s+/g, ' ').trim();
    // Matching the script clears a rewrite. Matching what already speaks leaves the desk alone
    // (do not invent a text override — that would remint every take's cache key).
    if (written && text === written) body.text = '';
    else if (text !== effective) body.text = text;
    return body;
  };
  const markDirty = () => {
    const clip = voiceClip(key);
    if (!clip) return;
    const b = lineBody();
    const effective = (clip.textOverride || clip.text || '').replace(/\s+/g, ' ').trim();
    const written = (clip.written || '').replace(/\s+/g, ' ').trim();
    const nextText = Object.prototype.hasOwnProperty.call(b, 'text') ? b.text : effective;
    const dirty = (nextText || written) !== effective || Math.abs(b.speed - (clip.speed || clip.spokenSpeed || 1)) > 0.01;
    root.querySelector('[data-act="voice-regen"]')?.classList.toggle('is-dirty', dirty);
    const label = neonButtonLabel(root.querySelector('[data-act="voice-regen"]'));
    if (label && !ed.regenerating) label.textContent = dirty ? 'Regenerate with changes' : 'Regenerate';
  };
  on('[data-voice-text]', 'input', markDirty);
  on('[data-voice-text]', 'keydown', (_el, e) => {
    const ke = e as KeyboardEvent;
    if ((ke.metaKey || ke.ctrlKey) && ke.key === 'Enter') {
      ke.preventDefault();
      root.querySelector<HTMLElement>('[data-act="voice-regen"]')?.click();
    }
  });
  on('[data-voice-speed]', 'change', markDirty);
  act('voice-text-written', () => {
    const ta = root.querySelector<HTMLTextAreaElement>('[data-voice-text]');
    const clip = voiceClip(key);
    if (ta && clip) {
      ta.value = clip.written ?? '';
      markDirty();
      ta.focus();
    }
  });
  act('voice-regen', () => {
    const clip = voiceClip(key);
    if (!clip || ed.regenerating) return;
    const b = lineBody();
    const effective = (clip.textOverride || clip.text || '').trim();
    const written = (clip.written || '').trim();
    const nextText = Object.prototype.hasOwnProperty.call(b, 'text') ? b.text : effective;
    const changed = (nextText || written) !== effective || Math.abs(b.speed - (clip.speed || clip.spokenSpeed || 1)) > 0.01;
    // Every Regenerate adds a take — same words or a rewrite — so prior performances stay a click away.
    return regenerateLine(key, { ...b, newTake: true }, changed ? 'New take with your changes' : 'New take ready');
  });
  on('[data-take]', 'click', (el) => {
    const clip = voiceClip(key);
    if (!clip || ed.regenerating) return;
    const take = clamp(Number(el.dataset['take']), 1, Math.max(clip.take || 1, clip.takes || 1));
    if (take !== (clip.take || 1)) void regenerateLine(key, { take }, `Take ${take}`);
  });
  // Back to the script: its words, natural pace, take 1. Those takes stay in the cache, so this is free.
  act('voice-revert', () => {
    const clip = voiceClip(key);
    if (!clip || ed.regenerating) return;
    return regenerateLine(key, { text: '', speed: 1, take: 1 }, 'Back to the script');
  });
  act('voice-upload', () => {
    if (!s?.key || ed.regenerating || ed.micRecord) return;
    pickVoiceFile(s.key);
  });
  act('voice-mic', () => {
    if (!s?.key || ed.regenerating) return;
    return toggleMicRecord(s.key);
  });

  // Add a free-standing line from the empty inspector (or after deselecting).
  const addText = () => (root.querySelector<HTMLTextAreaElement>('[data-voice-add-text]')?.value || '').replace(/\s+/g, ' ').trim();
  act('voice-add-eleven', async () => {
    const text = addText();
    if (!text) {
      toast('Nothing to speak', 'Write the line first, or use Upload / Record instead.', 'warn');
      return;
    }
    await addVoiceLine({ text, via: 'eleven' });
  });
  act('voice-add-upload', async () => {
    const r = await addVoiceLine({ text: addText() });
    const k = r?.['key'];
    if (typeof k === 'string' && k) pickVoiceFile(k);
  });
  act('voice-add-mic', async () => {
    const r = await addVoiceLine({ text: addText() });
    const k = r?.['key'];
    if (typeof k === 'string' && k) await toggleMicRecord(k);
  });

  // Narrator (in the Mix panel).
  on('[data-narrator]', 'change', (el) => {
    ed.narratorPick = el.value;
    paintInspectorUnlessContentTyping(renderInspector);
  });
  act('narrator-listen', () => {
    const n = ed.deck?.audio?.narrator;
    const picked = Array.isArray(ed.voices) ? ed.voices.find((v) => v.voiceId === (ed.narratorPick || n?.voiceId)) : null;
    if (!picked?.previewUrl) return;
    if (ed.sample) {
      ed.sample.pause();
      if (ed.sample.src === picked.previewUrl) {
        ed.sample = null;
        return;
      }
    }
    if (ed.playing) pause();
    ed.sample = new Audio(picked.previewUrl);
    ed.sample.play().catch(() => toast('Sample did not play', 'The browser blocked the preview; click once more.', 'warn'));
  });
  act('narrators-reload', () => loadNarrators(true));
  act('narrator-use', async () => {
    const n = ed.deck?.audio?.narrator;
    const picked = Array.isArray(ed.voices) ? ed.voices.find((v) => v.voiceId === ed.narratorPick) : null;
    if (!picked || picked.voiceId === n?.voiceId) return;
    await setNarrator({ voiceId: picked.voiceId, name: picked.name }, `${picked.name} narrates this video`);
  });
  act('narrator-brand', () => setNarrator({ reset: true }, 'Back to the brand narrator'));
  on('[data-music-gain]', 'input', (el) => {
    setOut(el, `${Number(el.value).toFixed(1)} dB`);
    ed.hear = { music: { gainDb: Number(el.value) } };
    preview.audition(previewState(), ed.t);
  });
  on('[data-music-gain]', 'change', (el) => {
    if (!ed.playing) preview.pause();
    void withMusic({ gainDb: Number(el.value) });
  });
  on('[data-fade]', 'input', (el) => setOut(el, `${Number(el.value).toFixed(1)}s`));
  on('[data-fade]', 'change', (el) => void withMusic({ [el.dataset['fade'] || 'fadeIn']: Number(el.value) }));
  on('[data-music-offset]', 'input', (el) => {
    const n = Number(el.value);
    setOut(el, `${n > 0 ? '+' : ''}${n.toFixed(1)}s`);
  });
  on('[data-music-offset]', 'change', (el) => void withMusic({ offset: Number(el.value) }, 'Music slipped'));
  on('[data-ride-gain]', 'input', (el) => setOut(el, `${Number(el.value).toFixed(1)} dB`));
  on('[data-ride-gain]', 'change', (el) => {
    const rides = audioDesk().music.rides.map((r, i) => (i === s?.i ? { ...r, gainDb: Number(el.value) } : r));
    void withMusic({ rides });
  });
  on('[data-master]', 'input', (el) => {
    const n = Number(el.value);
    const m = el.dataset['master'] || '';
    const unit = m === 'duckRatio' ? '×' : m === 'truePeakDb' ? ' dB' : ' LUFS';
    setOut(el, `${n.toFixed(1)}${unit}`);
    ed.hear = { master: { [m]: n } };
    preview.audition(previewState(), ed.t);
  });
  on('[data-master]', 'change', (el) => {
    if (!ed.playing) preview.pause();
    void withMaster({ [el.dataset['master'] || '']: Number(el.value) }, 'Master updated');
  });

  wireSlideInspector(root);

  // Plate
  rootClicks?.abort();
  rootClicks = null;
  const plateC = s?.type === 'clip' ? ed.seq.find((x) => x.id === s.id && x.kind === 'plate') : null;
  if (!plateC) return;
  const id = plateC.plateId || '';
  act('look-reset', () => changeLook(id, { reset: true }));
  act('style-reset', async () => {
    await plateApi(id, 'style', { reset: true }, 'Back to the brand values');
    refreshPlatePreview(id);
  });
  on('[data-var-color]', 'input', (el) => {
    const swatch = el.nextElementSibling as HTMLElement | null;
    if (swatch) swatch.style.background = el.value;
    applyVar(el.dataset['varColor'] || '', el.value);
    queueStyle(id, el.dataset['varColor'] || '', el.value);
  });
  on('.sw', 'contextmenu', (el, e) => {
    e.preventDefault();
    if (el.classList.contains('is-set')) void resetVar(id, el.dataset['var'] || '');
  });
  on('[data-var-range]', 'input', (el) => {
    const v = `${el.value}${el.dataset['unit'] || ''}`;
    setOut(el, v);
    applyVar(el.dataset['varRange'] || '', v);
    queueStyle(id, el.dataset['varRange'] || '', v);
  });
  on('[data-var-toggle]', 'change', (el) => {
    const v = el.checked ? '1' : '0';
    applyVar(el.dataset['varToggle'] || '', v);
    queueStyle(id, el.dataset['varToggle'] || '', v);
  });
  rootClicks = new AbortController();
  root.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-var-reset]');
      if (btn) void resetVar(id, btn.dataset['varReset'] || '');
    },
    { signal: rootClicks.signal },
  );
}
