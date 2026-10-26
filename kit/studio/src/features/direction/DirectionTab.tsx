import type { CSSProperties, ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useDesk } from '@/desk/store';
import { takeNote } from '@/logic/captureSize';
import { PaneBody, PaneChrome, PaneHead, PaneTabs, type PaneTab } from '@/ui/pane';

import { BrandPane } from './BrandPane';
import { CameraPane } from './CameraSection';
import { LiveCardsSection } from './LiveCardsField';
import { AtmosphereSection, EffectsSection, EnergySection } from './MotionFields';
import { rolesOf } from './model';
import { PaceSection } from './PaceSection';
import { PlateBin } from './PlateBin';
import { PlateLayoutsField } from './PlateLayoutsField';
import { SizeSection } from './SizeSection';
import { TransitionsSection } from './TransitionsField';
import { useDirectionSync } from './useDirectionSync';
import { overlayDirty, setDirectionTab, useDirectionView, type DirectionTabId } from './view';

const BASE = 'dir';

/** The five roles as a conic mark: the brand at a glance, in the head's icon slot. */
function BrandMark({ colors }: { colors: string[] }) {
  const stops = colors.length ? colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ') : '';
  return <span className="dir-mark" style={stops ? ({ '--mark': `conic-gradient(${stops})` } as CSSProperties) : undefined} />;
}

function StatusPill() {
  const direction = useDirectionView((s) => s.direction);
  return (
    <span id="directionStatus" className="review-pill" data-tone={direction ? (direction.approvedAt ? 'ok' : 'warn') : undefined}>
      {direction?.approvedAt ? 'Approved' : 'Needs approval'}
    </span>
  );
}

/** One line under the title: what is set, each piece a jump to the tab that sets it. */
function HeadMeta() {
  const direction = useDirectionView((s) => s.direction);
  const capture = useDirectionView((s) => s.capture);
  const font = useDesk((s) => s.video?.brandFoundation?.font);
  if (!direction) return <span className="dir-meta-empty">Set once per video · suggestions come from the brand pack</span>;
  const swatches = rolesOf(direction).map((r) => direction.colors[r.id]).filter(Boolean);
  const look = direction.looks?.[direction.look]?.label;
  const cur = capture?.current;
  const chip = (tab: DirectionTabId, title: string, body: ReactNode) => (
    <button type="button" className="dir-meta-chip" title={title} onClick={() => setDirectionTab(tab)}>
      {body}
    </button>
  );
  return (
    <>
      {chip(
        'brand',
        'Colours and type — open Brand',
        <>
          <span className="dir-swatches" aria-hidden="true">
            {swatches.map((c, i) => (
              <i key={i} style={{ background: c }} />
            ))}
          </span>
          {font ? <b>{font}</b> : null}
        </>,
      )}
      {look ? chip('camera', 'Look — open Camera', <b>{look}</b>) : null}
      {chip('recording', 'Live pace — open Recording', <b>{`${direction.pace?.tempo ?? 1}×`}</b>)}
      {cur?.width ? chip('recording', 'Recording size — open Recording', <b>{`${cur.width}×${cur.height}`}</b>) : null}
    </>
  );
}

/** Tabs wear a dot when something in them is waiting: unsaved live cards, a take to redo. */
function useTabs(): Array<PaneTab<DirectionTabId>> {
  const livePace = useDesk((s) => s.video?.livePace?.id);
  const { dirty, retake } = useDirectionView(
    useShallow((s) => ({
      dirty: overlayDirty(s),
      retake: Boolean(s.capture && takeNote(s.capture.space)) || Boolean(livePace && s.direction?.pace && livePace !== s.direction.pace.id),
    })),
  );
  return [
    { id: 'brand', label: 'Brand', icon: 'palette', title: 'Colour scale, logo and feature focus' },
    { id: 'motion', label: 'Motion', icon: 'motion', title: 'Energy, backgrounds, effects, transitions and live cards', dot: dirty ? 'warn' : null },
    { id: 'camera', label: 'Camera', icon: 'camera', title: 'Look, camera moves, frame and cursor' },
    { id: 'recording', label: 'Record', icon: 'record', title: 'Live pace, recording size and video shape', dot: retake ? 'warn' : null },
  ];
}

/** `#rightMotion`: the video's visual direction in four tabs — brand, motion, camera, recording. */
export function DirectionTab() {
  useDirectionSync();
  const tab = useDirectionView((s) => s.tab);
  const swatches = useDirectionView(useShallow((s) => (s.direction ? rolesOf(s.direction).map((r) => s.direction?.colors[r.id] ?? '') : [])));
  const title = useDesk((s) => s.video?.title);
  const gold = useDirectionView((s) => s.direction?.colors.gold);
  const amber = useDirectionView((s) => s.direction?.colors.amber);
  const tabs = useTabs();
  const brandVars = gold ? ({ '--b-gold': gold, '--b-amber': amber || gold } as CSSProperties) : undefined;
  return (
    <div id="rightMotion" className="panel-body inspector dir-pane" data-branded={gold ? '' : undefined} style={brandVars} hidden>
      <div className="slide-ins dir-ins">
        <PaneChrome>
          <PaneHead
            icon={<BrandMark colors={swatches.filter(Boolean)} />}
            kind="Visual direction"
            title={title || 'This video'}
            actions={<StatusPill />}
            meta={<HeadMeta />}
          />
          <PaneTabs tabs={tabs} active={tab} onSelect={setDirectionTab} label="Direction" base={BASE} />
        </PaneChrome>
        <PaneBody base={BASE} id="brand" active={tab === 'brand'}>
          <BrandPane />
        </PaneBody>
        <PaneBody base={BASE} id="motion" active={tab === 'motion'}>
          <EnergySection />
          <AtmosphereSection />
          <EffectsSection />
          <TransitionsSection />
          <PlateLayoutsField />
          <LiveCardsSection />
          <PlateBin />
        </PaneBody>
        <PaneBody base={BASE} id="camera" active={tab === 'camera'}>
          <CameraPane />
        </PaneBody>
        <PaneBody base={BASE} id="recording" active={tab === 'recording'}>
          <PaceSection />
          <SizeSection />
        </PaneBody>
      </div>
    </div>
  );
}
