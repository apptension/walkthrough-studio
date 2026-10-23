import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { bridges } from '@/desk/bridge';
import { fmtShort } from '@/desk/format';
import { activePlayer, seekTo } from '@/desk/monitor';
import { desk, useDesk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { Icon } from '@/ui/icons';

import { chapterClips, chapterMarks, cueClips, fmtScrub, keySeek, playheadPct, regionViews, rulerTicks, scrubPoint } from './model';

/** `renderTimeline` runs once a sequence has loaded; before that the lanes keep the empty markup. */
function useTimelineDuration(): number | null {
  return useDesk((s) => (s.video ? s.duration || 1 : null));
}

function Ruler() {
  const d = useTimelineDuration();
  const ticks = useMemo(() => (d ? rulerTicks(d) : []), [d]);
  return (
    <div className="tl-ruler" id="timelineRuler" aria-hidden="true">
      {ticks.map((tick) => (
        <div key={tick.key} className={tick.className} style={{ left: tick.left }}>
          {tick.label != null ? <span>{tick.label}</span> : null}
        </div>
      ))}
    </div>
  );
}

function Regions() {
  const d = useTimelineDuration();
  const scenes = useDesk((s) => s.scenes);
  const chapters = useDesk((s) => s.chapters);
  const plateMode = useDesk((s) => s.monitorMode === 'plate');
  const activePlateId = useDesk((s) => s.activePlateId);
  const selection = bridges.editor?.selection;
  const liveSelectionId = selection?.kind === 'live' ? (selection.scene?.id ?? null) : null;
  const view = useMemo(
    () => (d ? regionViews(scenes, chapters, d, { plateMode, activePlateId, liveSelectionId }) : null),
    [d, scenes, chapters, plateMode, activePlateId, liveSelectionId],
  );

  // Click a plate tip on the timeline → open the plate editor (primary path).
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const region = (e.target as Element).closest<HTMLElement>('.tl-region.is-clickable');
    if (!region) return;
    const s = desk.get();
    const scene = s.scenes.find((sc) => sc.plateId === region.dataset['plateId'] || sc.id === region.dataset['sceneId']);
    if (!scene) return;
    // Live regions open the clip editor only once the Editor is up; in Program they just seek.
    if (!scene.editable && s.monitorMode !== 'plate') return;
    e.preventDefault();
    e.stopPropagation();
    bridges.plate?.editCurrentPlate?.(scene);
  };

  return (
    <div id="timelineRegions" className={view?.edit ? 'tl-regions is-edit' : 'tl-regions'} onClick={onClick}>
      {view?.regions.map((r) => (
        <div
          key={r.key}
          className={r.className}
          style={r.left != null ? { left: r.left, width: r.width } : { width: r.width }}
          title={r.title}
          data-scene-id={r.sceneId}
          data-plate-id={r.plateId}
        />
      ))}
    </div>
  );
}

function Marks() {
  const d = useTimelineDuration();
  const chapters = useDesk((s) => s.chapters);
  const marks = useMemo(() => (d ? chapterMarks(chapters, d) : []), [d, chapters]);
  return (
    <div id="timelineMarks" className="tl-marks">
      {marks.map((m) => (
        <div key={m.key} className="tl-mark" style={{ left: m.left }} title={m.title} />
      ))}
    </div>
  );
}

function Fill() {
  const pct = useDesk((s) => playheadPct(s.transport.t, s.transport.d));
  return <div id="timelineFill" className="tl-fill" style={{ width: `${pct}%` }} />;
}

function Buffered() {
  const pct = useDesk((s) => (s.transport.d > 0 ? (s.transport.buffered / s.transport.d) * 100 : 0));
  return <div id="timelineBuf" className="tl-buf" style={{ width: `${pct}%` }} />;
}

function ChapterLane() {
  const d = useTimelineDuration();
  const chapters = useDesk((s) => s.chapters);
  const clips = useMemo(() => (d ? chapterClips(chapters, d) : []), [d, chapters]);
  return (
    <div className="tl-lane-body tl-chapters" id="timelineChapters">
      {clips.map((c) => (
        <div key={c.key} className="tl-ch-clip" style={{ left: c.left, width: c.width }} title={c.title}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

function CueLane() {
  const d = useTimelineDuration();
  const cues = useDesk((s) => s.cues);
  const clips = useMemo(() => (d ? cueClips(cues, d) : []), [d, cues]);
  return (
    <div className="tl-lane-body tl-cues" id="timelineCues">
      {clips.map((c) => (
        <div key={c.key} className="tl-cue-clip" style={{ left: c.left, width: c.width }} title={c.title} />
      ))}
    </div>
  );
}

function Playhead() {
  const t = useDesk((s) => s.transport.t);
  const d = useDesk((s) => s.transport.d);
  const pct = playheadPct(t, d);
  return (
    <div id="timelinePlayhead" className={pct > 82 ? 'tl-head is-flip' : 'tl-head'} style={{ left: `${pct}%` }}>
      <i />
      <span id="clock" className="tl-time" aria-live="off">
        {fmtShort(t)}{' '}
        <span className="t-sep">
          /
        </span>
        {' '}{fmtShort(d)}
      </span>
    </div>
  );
}

/** The lanes re-render from their own store slices — never on a hover move over the scrubber. */
const Lanes = memo(function Lanes({ trackRef }: { trackRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="tl-lanes">
      <div className="tl-lane-label clips" title="Clips">
        <Icon name="ui-film" size={13} />
        <span className="sr-only">
          Clips
        </span>
      </div>
      <div className="tl-lane-body">
        <div ref={trackRef} id="timelineTrack" className="tl-track">
          <Regions />
          <Fill />
          <Buffered />
          <Marks />
        </div>
      </div>
      <div className="tl-lane-label chapters" title="Chapters">
        <Icon name="ui-chapters" size={13} />
        <span className="sr-only">
          Chapters
        </span>
      </div>
      <ChapterLane />
      <div className="tl-lane-label captions" title="Captions">
        <Icon name="ui-captions" size={13} />
        <span className="sr-only">
          Captions
        </span>
      </div>
      <CueLane />
    </div>
  );
});

const MemoRuler = memo(Ruler);

interface ScrubTip {
  shown: boolean;
  /** `hover` previews where a click would land; `scrub` follows the drag. */
  mode: 'hover' | 'scrub';
  text: string;
  chapter: string | null;
  left: number | null;
  ratio: number;
}

const HIDDEN_TIP: ScrubTip = { shown: false, mode: 'hover', text: '', chapter: null, left: null, ratio: 0 };

const durationNow = (): number => activePlayer()?.duration || desk.get().duration || 0;

/** `#timeline` — the Program scrubber: ruler, clip / chapter / caption lanes and the playhead. */
export function Timeline() {
  const locked = useDesk((s) => s.monitorMode === 'plate');
  const scrubbing = useDesk((s) => s.scrubbing);
  const valueNow = useDesk((s) => Math.floor(s.transport.t));
  const valueMax = useDesk((s) => Math.round(s.transport.d || s.duration || 0));
  const shellRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ScrubTip>(HIDDEN_TIP);
  const unbind = useRef<(() => void) | null>(null);

  useEffect(() => () => unbind.current?.(), []);

  /** Where `clientX` lands (snapped unless ⌥ is held), and the tip that shows it. */
  const pointAt = (clientX: number, free: boolean, mode: ScrubTip['mode']) => {
    const track = trackRef.current?.getBoundingClientRect();
    if (!track) return null;
    const point = scrubPoint(clientX, track, durationNow(), desk.get().chapters, { free });
    const shell = shellRef.current?.getBoundingClientRect();
    const next: ScrubTip = {
      shown: true,
      mode,
      text: mode === 'scrub' ? fmtScrub(point.sec) : fmtShort(point.sec),
      chapter: point.chapter,
      left: shell ? track.left - shell.left + point.ratio * track.width : null,
      ratio: point.ratio,
    };
    return { point, tip: next };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Plate editor locks scrubbing — only plate tips remain interactive.
    if (desk.get().monitorMode === 'plate') {
      if ((e.target as Element).closest('.tl-region.is-clickable')) return;
      toast('Timeline locked', 'Exit Plate HTML (Program) to scrub · or click another plate tip', 'warn');
      e.preventDefault();
      return;
    }
    if (e.button > 0) return;
    desk.set({ scrubbing: true });
    const first = pointAt(e.clientX, e.altKey, 'scrub');
    seekTo(first ? first.point.sec : 0);
    if (first) setTip(first.tip);
    const onMove = (ev: PointerEvent) => {
      if (!desk.get().scrubbing) return;
      const at = pointAt(ev.clientX, ev.altKey, 'scrub');
      if (!at) return;
      seekTo(at.point.sec);
      setTip(at.tip);
    };
    const onUp = () => {
      desk.set({ scrubbing: false });
      setTip(HIDDEN_TIP);
      unbind.current?.();
    };
    unbind.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onUp);
    unbind.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onUp);
      unbind.current = null;
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || desk.get().scrubbing || e.pointerType === 'touch') return;
    const at = pointAt(e.clientX, e.altKey, 'hover');
    if (at) setTip(at.tip);
  };

  const onPointerLeave = () => {
    if (!desk.get().scrubbing) setTip(HIDDEN_TIP);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const s = desk.get();
    const next = keySeek(e.key, s.transport.t, durationNow(), s.chapters, { big: e.shiftKey });
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    seekTo(next);
  };

  const tipClass = ['scrub-tip', `is-${tip.mode}`, tip.chapter ? 'is-snap' : ''].filter(Boolean).join(' ');
  const shellClass = ['timeline', scrubbing && 'is-scrubbing', tip.shown && tip.mode === 'hover' && 'is-hovering'].filter(Boolean).join(' ');

  return (
    <div
      ref={shellRef}
      id="timeline"
      className={shellClass}
      role="slider"
      tabIndex={locked ? -1 : 0}
      aria-label="Seek timeline"
      aria-disabled={locked ? 'true' : 'false'}
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={Math.min(valueNow, valueMax)}
      aria-valuetext={`${fmtShort(valueNow)} of ${fmtShort(valueMax)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      <div id="scrubTip" className={tipClass} hidden={!tip.shown} {...(tip.left != null ? { style: { left: `${tip.left}px` } } : {})}>
        <span className="scrub-tip-time">{tip.text}</span>
        {tip.chapter ? (
          <span className="scrub-tip-chapter">
            <i aria-hidden="true" />
            {tip.chapter}
          </span>
        ) : null}
      </div>
      <MemoRuler />
      <div className="tl-lanes-wrap">
        <Lanes trackRef={trackRef} />
        {/* Full-height scrubber over every Program lane (clips + chapters + captions). */}
        <div className="tl-scrubber" aria-hidden="true">
          <div
            className={tip.chapter ? 'tl-ghost is-snap' : 'tl-ghost'}
            hidden={!(tip.shown && tip.mode === 'hover')}
            style={{ left: `${tip.ratio * 100}%` }}
          />
          <Playhead />
        </div>
      </div>
    </div>
  );
}
