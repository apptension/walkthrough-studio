import { useMemo, type MouseEvent } from 'react';

import type { Deliver } from '@/api/types';
import { clockShort } from '@/desk/format';
import { useDesk } from '@/desk/store';
import { useBusy } from '@/features/tools-panel/busy';
import { NeonFx } from '@/ui/NeonButton';
import { PanelSection } from '@/ui/PanelSection';
import { Zen } from '@/ui/Zen';
import { cn } from '@/lib/cn';

import { copyYoutubeChapters, downloadHandoffZip, handoffZipLink } from './handoff';

const HANDOFF_HELP =
  'Everything a client needs: the master MP4, poster, captions, YouTube chapters, QC stills and a README. Export builds it; Download zip saves it.';

function HandoffSummary({ d }: { d: Deliver }) {
  const stillN = Array.isArray(d.stills) ? d.stills.length : 0;
  return (
    <div>
      <strong>{clockShort(d.durationSec)}</strong>
      {` · ${d.sizeMB} MB · ${d.chapterCount} chapters${stillN ? ` · ${stillN} stills` : ''}${
        d.posterSource === 'manual' ? ' · poster set in Studio' : ''
      }`}
    </div>
  );
}

/** `#linkHandoffZip`: no `href` yet (or `#`) means the zip still has to be built. */
function onZipClick(e: MouseEvent<HTMLAnchorElement>) {
  const href = e.currentTarget.href;
  if (!href || href.endsWith('#')) {
    e.preventDefault();
    void downloadHandoffZip({ buildIfMissing: true });
  }
}

function HandoffActions() {
  const loaded = useDesk((s) => s.video != null);
  const ytUrl = useDesk((s) => s.video?.youtubeChaptersUrl ?? null);
  const readmeUrl = useDesk((s) => s.video?.deliver?.readmeUrl ?? null);
  const zipUrl = useDesk((s) => s.video?.handoffZipUrl ?? null);
  const slug = useDesk((s) => s.video?.slug ?? '');
  const building = useBusy('btnBuildHandoffZip');
  const zip = useMemo(() => (zipUrl ? handoffZipLink(zipUrl, slug) : null), [zipUrl, slug]);
  return (
    <div className="tool-grid">
      <button type="button" id="btnCopyYt" className="btn" disabled={loaded ? !ytUrl : true} onClick={() => void copyYoutubeChapters()}>
        Copy chapters
      </button>{' '}
      <a id="linkReadme" className="btn linkbtn" hidden={!readmeUrl} href={readmeUrl ?? '#'} target="_blank" rel="noopener">
        README
      </a>{' '}
      <a
        id="linkHandoffZip"
        className="btn primary linkbtn"
        hidden={!zip}
        href={zip ? zip.href : loaded ? undefined : '#'}
        download={zip ? zip.download : ''}
        onClick={onZipClick}
      >
        <NeonFx />
        Download zip
      </a>{' '}
      <button
        type="button"
        id="btnBuildHandoffZip"
        className={cn('btn', building && 'busy')}
        disabled={building}
        title="Build or refresh the handoff zip"
        onClick={() => void downloadHandoffZip({ buildIfMissing: true })}
      >
        Build zip
      </button>
    </div>
  );
}

/** Deliver → Handoff pack: what `renderHandoff(v)` painted. */
export function HandoffPack() {
  const d = useDesk((s) => s.video?.deliver ?? null);
  return (
    <PanelSection
      id="handoff"
      icon="box"
      title="Handoff pack"
      help={HANDOFF_HELP}
      badge={
        <span id="handoffBadge" className={d ? 'badge ok' : 'badge'} hidden={!d}>
          Ready
        </span>
      }
    >
      <div id="handoffBox" className="findings">
        {d ? <HandoffSummary d={d} /> : <Zen art="box" title="No pack yet 📦" sub="Export builds the poster, captions, chapters and stills." />}
      </div>
      <HandoffActions />
    </PanelSection>
  );
}
