import { useRef } from 'react';

import { updateTransport } from '@/desk/monitor';
import { runtime } from '@/desk/runtime';
import { useDesk } from '@/desk/store';
import { captionTrack } from '@/desk/video';
import { versionDisplayName } from '@/features/project-panel/versions';

import { chooseCompare, onProgramMetadata } from './actions';
import { cueAt } from './model';

/* The engine drives `src`, `currentTime` and playback through `runtime`; React never controls them. */
const registerPlayer = (el: HTMLVideoElement | null) => {
  runtime.player = el;
  return () => {
    if (runtime.player === el) runtime.player = null;
  };
};
const registerPlayerA = (el: HTMLVideoElement | null) => {
  runtime.playerA = el;
  return () => {
    if (runtime.playerA === el) runtime.playerA = null;
  };
};
const registerPlayerB = (el: HTMLVideoElement | null) => {
  // React sets `muted` as a property only; the attribute is part of the legacy markup.
  if (el) el.defaultMuted = true;
  runtime.playerB = el;
  return () => {
    if (runtime.playerB === el) runtime.playerB = null;
  };
};

const transportEvents = {
  onTimeUpdate: updateTransport,
  onPlay: updateTransport,
  onPause: updateTransport,
  onEnded: updateTransport,
};

/** The `<track>` `loadVideo` re-appends under `#player` for each master. */
function CaptionTrack() {
  const video = useDesk((s) => s.video);
  const loaded = useDesk((s) => s.programLoaded);
  const track = loaded ? captionTrack(video) : null;
  if (!track) return null;
  return <track key={track.src} kind="captions" label={track.label} srcLang={track.srclang} src={track.src} />;
}

export function PlayerSingle() {
  const mode = useDesk((s) => s.monitorMode);
  // Before the first sequence lands neither `hidden` nor `#noVideo.show` is set.
  const hide = useDesk((s) => s.video != null && !s.programLoaded);
  const cls = [hide ? 'hidden' : '', mode === 'live' ? 'is-live-covered' : ''].filter(Boolean).join(' ');
  return (
    <div id="playerSingle" className="player-mode" hidden={mode !== 'program' && mode !== 'live'}>
      <video
        ref={registerPlayer}
        id="player"
        className={cls || undefined}
        playsInline
        preload="metadata"
        {...transportEvents}
        onLoadedMetadata={onProgramMetadata}
      >
        <CaptionTrack />
      </video>
    </div>
  );
}

function CompareSelect() {
  const versions = useDesk((s) => s.video?.versions);
  const painted = useDesk((s) => s.video != null);
  const compareId = useDesk((s) => s.compareId);
  return (
    <select id="compareSelect" aria-label="Snapshot to compare" value={compareId} onChange={(e) => chooseCompare(e.currentTarget.value)}>
      {!painted ? null : versions?.length ? (
        versions.map((ver) => (
          <option key={ver.id} value={ver.id}>
            {`${versionDisplayName(ver)}${ver.kind === 'checkpoint' ? ' · checkpoint' : ''}`}
          </option>
        ))
      ) : (
        <option value="">No versions</option>
      )}
    </select>
  );
}

export function PlayerCompare() {
  const compare = useDesk((s) => s.monitorMode === 'compare');
  // `syncCompare()` flips these once Compare is on; before that they keep the markup defaults.
  const noSnapshot = useDesk((s) => s.compare && !s.compareId);
  return (
    <div id="playerCompare" className="player-mode compare-mode" hidden={!compare}>
      <div className="compare-pane">
        <span className="pane-tag">
          Current
        </span>
        <video ref={registerPlayerA} id="playerA" playsInline preload="metadata" {...transportEvents} />
      </div>
      <div className="compare-pane">
        <span className="pane-tag">
          Snapshot{' '}
          <CompareSelect />
        </span>
        <video ref={registerPlayerB} id="playerB" playsInline muted preload="metadata" hidden={noSnapshot} {...transportEvents} />
        <div id="compareEmpty" className="compare-empty" hidden={!noSnapshot}>
          <strong>
            No version
          </strong>
          <p>
            Save a version first, then compare.
          </p>
        </div>
      </div>
    </div>
  );
}

/** `#captionOverlay` — the cue under the playhead when CC is on (not in Compare). */
export function CaptionOverlay() {
  const cue = useDesk((s) => (s.captionsOn && !s.compare ? cueAt(s.cues, s.transport.t) : null));
  const covered = useDesk((s) => s.monitorMode === 'live' || s.monitorMode === 'plate');
  const text = useRef('');
  if (cue) text.current = cue.text;
  return (
    <div id="captionOverlay" className={cue ? 'caption-overlay on' : 'caption-overlay'} aria-live="polite" hidden={covered}>
      {text.current}
    </div>
  );
}

/** `#chapterToast` — the chapter title `updateTransport` flashes for 1.4 s on entry. */
export function ChapterToast() {
  const title = useDesk((s) => s.chapterToast.title);
  const on = useDesk((s) => s.chapterToast.on);
  return (
    <div id="chapterToast" className={on ? 'chapter-toast on' : 'chapter-toast'} aria-live="polite">
      {String(title)}
    </div>
  );
}
