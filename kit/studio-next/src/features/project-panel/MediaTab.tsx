import { useMemo } from 'react';

import { clockShort } from '@/desk/format';
import { useDesk } from '@/desk/store';
import { PanelSection } from '@/ui/PanelSection';
import { Zen } from '@/ui/Zen';

import { DeliverSections } from '@/features/deliver/DeliverTab';

import { posterView, setPosterFromCurrentFrame } from './poster';

const POSTER_HELP =
  'The still shown before the video plays, on YouTube and in the handoff pack. Pause Program on a strong frame, then use it.';

/** `#leftDeliver` — sequence, poster, then the handoff pack and social formats. */
export function DeliverBody() {
  return (
    <>
      <MetaBits />
      <SequenceBlock />
      <PosterBlock />
      <DeliverSections />
    </>
  );
}

/** @deprecated Use {@link DeliverBody}. */
export const MediaBody = DeliverBody;

function MetaBits() {
  const video = useDesk((s) => s.video);
  const bits = video
    ? [video.durationSec != null ? clockShort(video.durationSec) : null, video.sizeMB != null ? `${video.sizeMB} MB` : null, video.brand].filter(
        (b): b is string => Boolean(b),
      )
    : [];
  return (
    <div id="metaBits" className="meta-stack">
      {bits.map((b, i) => (
        <span key={`${i}-${b}`} className="chip">
          {b}
        </span>
      ))}
    </div>
  );
}

function PosterBlock() {
  const video = useDesk((s) => s.video);
  const busy = useDesk((s) => Boolean(s.busy['btnSetPoster']));
  // Every repaint re-requests the still, so a re-grabbed poster.jpg shows at once.
  const view = useMemo(() => posterView(video, Date.now()), [video]);
  return (
    <PanelSection id="poster" icon="poster" title="Poster" help={POSTER_HELP} className="media-block">
      <img id="posterImg" alt="Poster" hidden={!view.src} src={view.src ?? undefined} />
      <Zen
        art="frame"
        title="No poster yet 🖼️"
        sub="Pause Program on a strong frame, then use it. Export picks one if you don’t."
        className="zen-card"
        id="posterEmpty"
        hidden={Boolean(view.src)}
      />
      <p className="meta" id="posterMetaLine" hidden={!view.metaLine}>
        {view.metaLine ?? ''}
      </p>
      <button
        type="button"
        id="btnSetPoster"
        className={busy ? 'btn block busy' : 'btn block'}
        title="Grab the current Program frame as poster.jpg"
        disabled={busy || (video != null && !video.hasDelivery)}
        onClick={() => void setPosterFromCurrentFrame()}
      >
        Use current frame
      </button>
    </PanelSection>
  );
}

function SequenceBlock() {
  const title = useDesk((s) => (s.video ? s.video.title || s.video.slug : 'Select a video'));
  const subtitle = useDesk((s) =>
    s.video ? (s.video.audience ? String(s.video.audience).slice(0, 80) : 'Delivery preview') : 'Delivery master',
  );
  return (
    <PanelSection id="sequence" icon="film" title="Sequence" className="media-block">
      <h1 id="title" className="seq-title">
        {title}
      </h1>
      <p id="subtitle" className="meta">
        {subtitle}
      </p>
    </PanelSection>
  );
}
