import { paintLensBox, paintZoomBox } from './aim';
import { previewState } from './audio';
import { refresh } from './data';
import { curClip, rateAt, recToEd } from './seq';
import { renderFrame } from './stage';
import { ed, preview, video } from './state';
import { exitText, paintTextMode } from './text';
import { $, ICONS, clamp, fmtT } from './util';

/** Transport (seek / play / pause / the rAF clock) and the playhead from `kit/studio/editor.js`. */

export function seek(t: number, { follow = false }: { follow?: boolean } = {}): void {
  if (ed.textMode) exitText();
  ed.t = clamp(t, 0, ed.total);
  if (ed.loop && ed.playing) ed.loopClip = curClip();
  renderFrame();
  paintHead(follow);
}

type FastSeekVideo = HTMLVideoElement & { fastSeek?: (t: number) => void };

/**
 * Start the recording once. Seeking on every frame aborts play() before the
 * first frame lands, so the timeline looks like it never started.
 */
export function armLive(v: HTMLVideoElement, rec: number, { outgoing = false }: { outgoing?: boolean } = {}): void {
  ed.wantRec = rec;
  const drift = Math.abs((v.currentTime || 0) - rec);
  if (v.paused || v.ended) {
    if (!ed.liveSeeked && !v.seeking && drift > 0.12 && v.readyState >= 1) {
      ed.liveSeeked = true;
      try {
        const fv = v as FastSeekVideo;
        if (typeof fv.fastSeek === 'function') fv.fastSeek(rec);
        else v.currentTime = rec;
      } catch {
        /* metadata still arriving */
      }
    }
    if (ed.liveKick) return;
    const start = () => {
      if (!ed.playing) return;
      ed.liveKick = true;
      const pending = v.play() as Promise<void> | undefined;
      const done = () => {
        ed.liveKick = false;
      };
      if (pending?.then) pending.then(done, done);
      else done();
    };
    if (v.readyState >= 2 && !v.seeking) start();
    else if (!ed.liveArm) {
      ed.liveArm = true;
      v.addEventListener(
        'canplay',
        () => {
          ed.liveArm = false;
          if (ed.playing) start();
        },
        { once: true },
      );
    }
    return;
  }
  ed.liveKick = false;
  // 0.18s, not 0.5s: a short cut jumps the recording clock by less than half a second
  // and must still seek, or playback rolls through the stretch that was removed.
  if (!outgoing && !v.seeking && drift > 0.18) {
    try {
      v.currentTime = rec;
    } catch {
      /* ignore */
    }
  }
  const rate = rateAt(v.currentTime);
  if (Math.abs(v.playbackRate - rate) > 0.01) v.playbackRate = rate;
}

export function play(): void {
  if (!ed.seq.length) {
    if (!ed.playWhenReady) {
      ed.playWhenReady = true;
      void refresh().finally(() => {
        ed.playWhenReady = false;
        if (ed.active && ed.seq.length && !ed.playing) play();
      });
    }
    return;
  }
  if (ed.textMode) exitText();
  if (ed.t >= ed.total - 0.03) ed.t = 0;
  ed.liveSeeked = false;
  ed.liveKick = false;
  ed.stallFor = 0;
  ed.playing = true;
  if (ed.sound) preview.play(previewState(), ed.t);
  ed.loopClip = ed.loop ? curClip() : null;
  ed.lastTs = performance.now();
  cancelAnimationFrame(ed.raf);
  ed.raf = requestAnimationFrame(tick);
  paintTransport();
  paintTextMode();
  paintZoomBox();
  paintLensBox();
}

export function pause(): void {
  ed.playing = false;
  ed.stopAt = null;
  preview.pause();
  cancelAnimationFrame(ed.raf);
  ed.liveKick = false;
  ed.liveArm = false;
  ed.stallFor = 0;
  const v = video();
  if (v && !v.paused) v.pause();
  renderFrame();
  paintHead();
  paintTransport();
  paintTextMode();
}

export const toggle = (): void => (ed.playing ? pause() : play());

export function replayClip(): void {
  const c = curClip();
  if (!c) return;
  seek(c.at);
  play();
}

export function tick(ts: number): void {
  if (!ed.playing) return;
  const dt = clamp((ts - ed.lastTs) / 1000, 0, 0.1);
  ed.lastTs = ts;
  const c = curClip();
  const v = video();
  // The recording is the master clock while it plays; the wall clock drives plates.
  if (c?.kind === 'live' && v && !v.paused && !v.seeking && v.readyState >= 2 && ed.t > c.at + c.overlap) {
    const tv = recToEd(c, v.currentTime);
    ed.t = Math.abs(tv - ed.t) < 0.8 ? Math.max(ed.t, tv) : ed.t + dt;
    if (v.currentTime >= c.recTo - 0.03) ed.t = Math.max(ed.t, c.at + c.dur - (ed.seq[c.i + 1]?.overlap || 0));
    ed.stallFor = 0;
  } else if (ed.stall && (ed.stallFor = (ed.stallFor || 0) + dt) < 1.2) {
    /* hold the clock briefly while a plate loads, then play on anyway */
  } else ed.t += dt;
  const lc = ed.loopClip;
  if (lc && ed.t >= lc.at + lc.dur - 0.02) ed.t = lc.at;
  if (ed.stopAt != null && ed.t >= ed.stopAt) {
    ed.t = ed.stopAt;
    pause();
    return;
  }
  if (ed.t >= ed.total) {
    ed.t = ed.total;
    pause();
    return;
  }
  renderFrame();
  paintHead(true);
  preview.sync(previewState(), ed.t, true);
  ed.raf = requestAnimationFrame(tick);
}

export function paintTransport(): void {
  const btn = $('edPlay');
  if (btn) {
    btn.innerHTML = (ed.playing ? ICONS['pause'] : ICONS['play']) ?? '';
    btn.setAttribute('aria-label', ed.playing ? 'Pause' : 'Play');
    btn.classList.toggle('is-playing', ed.playing);
  }
  $('edLoop')?.classList.toggle('is-on', ed.loop);
  $('edFx')?.classList.toggle('is-on', ed.fx);
  $('edSound')?.classList.toggle('is-on', ed.sound);
  $('stage')?.classList.toggle('is-ed-playing', ed.playing);
}

export function etlHeadWidth(scroll: HTMLElement | null): number {
  return (
    scroll?.querySelector<HTMLElement>('.etl-heads')?.offsetWidth ||
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--etl-head'), 10) ||
    34
  );
}

export function paintHead(follow = false): void {
  const x = ed.t * ed.pps;
  const head = $('etlPlayhead');
  if (head) head.style.transform = `translateX(${x}px)`;
  const clock = $('edClock');
  if (clock) clock.innerHTML = `${fmtT(ed.t)} <span class="t-sep">/</span> ${fmtT(ed.total)}`;
  const scroll = $('etlScroll');
  if (scroll && head) {
    const left = scroll.scrollLeft;
    const w = Math.max(80, scroll.clientWidth - etlHeadWidth(scroll));
    // Flip the time badge to the left when the pin is near the right edge of the viewport
    head.classList.toggle('is-flip', x > left + w - 96);
    if (follow && ed.playing) {
      if (x < left + 20 || x > left + w - 60) scroll.scrollLeft = Math.max(0, x - w * 0.2);
    }
  }
}
