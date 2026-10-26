import { useEffect } from 'react';

import { runtime } from '@/desk/runtime';
import { useDesk } from '@/desk/store';
import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';
import { Scrubber } from '@/ui/Scrubber';

import { wireKeys, wireStage } from './engine/lifecycle';
import { registerEditorBridges } from './engine/mount';
import { disposeFhdFitObserver } from './engine/plate';

function registerFrame(el: HTMLIFrameElement | null): void {
  if (el) runtime.plateFrame = el;
  else runtime.plateFrame = null;
}

/** `#playerPlate` — the editor stage. Mounting it brings the editor up (`initStages`). */
export function PlatePane() {
  const hidden = useDesk((s) => s.monitorMode !== 'plate');

  useEffect(() => {
    const ac = new AbortController();
    const unregister = registerEditorBridges();
    wireStage(ac.signal);
    wireKeys(ac.signal);
    return () => {
      ac.abort();
      unregister();
      disposeFhdFitObserver();
    };
  }, []);

  return (
    <div id="playerPlate" className="player-mode plate-mode" hidden={hidden}>
      <div className="fhd-fit" id="fhdFit">
        <div className="fhd-canvas" id="fhdCanvas">
          {/* The background a continuous run of slides shares; the slide's copy paints over it. */}
          <iframe id="plateBackdrop" className="plate-backdrop" title="Slide background" sandbox="allow-same-origin allow-scripts" tabIndex={-1} aria-hidden="true" hidden />
          <iframe id="plateFrame" title="Plate HTML preview" sandbox="allow-same-origin allow-scripts" ref={registerFrame} />
          {/* The off-stage twin: the next slide or card arms here, then the two trade ids. */}
          <iframe id="plateFrameBack" title="" sandbox="allow-same-origin allow-scripts" tabIndex={-1} aria-hidden="true" />
        </div>
        {/* The magnifier's live picture: a mirror of the slide on stage, scaled up under the glass. */}
        <div id="plateLoupeGlass" className="plate-loupe-glass" aria-hidden="true" hidden>
          <iframe id="plateLoupeFrame" title="" sandbox="allow-same-origin allow-scripts" tabIndex={-1} />
        </div>
        {/* The loupe for a magnifier placed on this plate; sized onto the fitted frame as it paints. */}
        <canvas id="plateLens" className="plate-lens" aria-hidden="true" />
        <span className="fhd-badge" aria-hidden="true" />
      </div>
      <div id="plateEmpty" className="compare-empty" hidden>
        <strong>
          No plate HTML yet
        </strong>
        <p>
          Apply feedback or Preview plates to build a live preview.
        </p>
      </div>
      <div id="liveStage" className="live-stage" hidden aria-label="Recording preview">
        <div className="live-frame" id="liveFrame">
          <iframe id="liveBackdrop" className="live-backdrop" hidden title="Stage backdrop" />
          <div className="live-viewport" id="liveViewport">
            <video id="livePlayer" muted playsInline preload="auto" />
            <canvas id="liveLens" className="live-lens" aria-hidden="true" />
          </div>
        </div>
      </div>
      {/* Aim surfaces for the selected zoom or magnifier. Sized onto whichever surface is on
          stage — the recording's viewport or a plate's fitted frame — so the boxes work on both. */}
      <div id="stageAim" className="stage-aim">
          <div
            id="liveZoomBox"
            className="live-zoom-box"
            hidden
            tabIndex={0}
            role="group"
            aria-label="Zoom framing — drag to aim, scroll to push in, arrow keys nudge, plus and minus change strength"
          >
            <i className="zh nw" />
            <i className="zh ne" />
            <i className="zh sw" />
            <i className="zh se" />
          </div>
          <div
            id="liveLensBox"
            className="live-lens-box"
            hidden
            tabIndex={0}
            role="group"
            aria-label="Magnifier — drag to aim, arrow keys nudge, brackets resize, plus and minus change strength"
          >
            <i className="lens-grip" title="Drag to resize" aria-hidden="true" />
          </div>
      </div>
      <div className="ed-stage-corner">
        <div id="edLoading" className="ed-loading" role="status" aria-live="polite" hidden>
          <span className="ed-loading-mark" data-mark-spinner="" role="presentation" aria-hidden="true" />
          <span className="ed-loading-label">
            <span className="ed-loading-text" data-for="slide">
              Loading slide
            </span>
            <span className="ed-loading-text" data-for="card">
              Loading card
            </span>
          </span>
        </div>
        <div id="edHud" className="ed-hud" aria-live="polite" />
      </div>
      {/* The stage control panels. One family (see engine/stagePanels): each collapses into a
          pill, drags anywhere in the monitor area, docks on a rail or attaches to what it edits. */}
      <div id="edTextBar" className="ed-textbar stage-panel sp-dock" data-tone="text" data-panel="text" hidden />
      <div id="edZoomPanel" className="stage-panel sp-dock sp-bar" data-tone="zoom" data-panel="zoom" role="group" aria-label="Zoom controls" hidden>
        <div className="sp-full">
          <PanelGrip label="zoom controls" />
          <span className="sp-ico" aria-hidden="true">
            <Icon name="zoom" size={14} />
          </span>
          <strong className="sp-title" data-zoom-kind="">
            Focus zoom
          </strong>
          <label className="frame-editor-hit sp-slider" data-zoom-strength="">
            <Scrubber data-frame-zoom="" min="1.2" max="2.2" step="0.05" aria-label="Zoom strength" />
            <output className="sp-value" data-zoom-value="" aria-live="off">
              1.50×
            </output>
          </label>
          <button type="button" className="sp-icon-btn" data-zoom-center="" title="Centre the zoom" aria-label="Centre the zoom">
            <Icon name="target" size={14} />
          </button>
          <span className="sp-sep" aria-hidden="true" />
          <span className="sp-help" data-sp-help-slot="" />
          <PanelCollapse label="zoom controls" />
          <button type="button" className="sp-icon-btn is-danger" data-frame-remove="zoom" title="Remove zoom" aria-label="Remove zoom">
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="sp-mini">
          <PanelPill icon="zoom" label="Zoom" what="zoom controls" valueAttr="data-zoom-pill-value" value="1.50×" />
        </div>
      </div>
      <div id="edLensPanel" className="stage-panel sp-dock sp-bar" data-tone="lens" data-panel="lens" role="group" aria-label="Magnifier controls" hidden>
        <div className="sp-full">
          <PanelGrip label="magnifier controls" />
          <span className="sp-ico" aria-hidden="true">
            <Icon name="lens" size={14} />
          </span>
          <strong className="sp-title" data-lens-hud-title="">
            Magnifier
          </strong>
          <div className="sp-pair" data-lens-hud-controls="">
            <label className="sp-slider sp-slider--labelled">
              <span className="sp-slider-label">
                Strength
              </span>
              <Scrubber id="liveLensHudZoom" data-frame-lens-zoom="" min="1.2" max="2.4" step="0.05" aria-label="Magnifier strength" />
              <output className="sp-value" data-lens-zoom-value="">
                1.8×
              </output>
            </label>
            <label className="sp-slider sp-slider--labelled">
              <span className="sp-slider-label">
                Size
              </span>
              <Scrubber data-frame-lens-size="" min="24" max="540" step="2" aria-label="Magnifier size" />
              <output className="sp-value" data-lens-size-value="">
                12%
              </output>
            </label>
          </div>
          <NeonButton className="ed-pill-btn primary" data-lens-hud-take="" hidden>
            <Icon name="target" size={13} />
            <span>
              Take over
            </span>
          </NeonButton>
          <span className="sp-sep" aria-hidden="true" />
          <span className="sp-help" data-sp-help-slot="" />
          <PanelCollapse label="magnifier controls" />
          <button type="button" className="sp-icon-btn is-danger" data-frame-remove="lens" title="Remove magnifier" aria-label="Remove magnifier">
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="sp-mini">
          <PanelPill icon="lens" label="Magnifier" what="magnifier controls" valueAttr="data-lens-pill-value" value="1.8×" />
        </div>
      </div>
    </div>
  );
}

function PanelGrip({ label }: { label: string }) {
  return (
    <button type="button" className="sp-icon-btn is-grip" data-sp-grip="" title="Drag to move · edges dock · drop by its subject to attach · double-click to put it back" aria-label={`Move ${label} (arrow keys nudge, Home or End docks)`}>
      <Icon name="grip" size={12} />
    </button>
  );
}

function PanelCollapse({ label }: { label: string }) {
  return (
    <button type="button" className="sp-icon-btn sp-collapse" data-sp-collapse="" aria-expanded="true" title="Collapse to a pill" aria-label={`Collapse ${label} to a pill`}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path className="sp-chev-l" d="m4.5 7.5 4.5 4.5-4.5 4.5" />
        <path className="sp-chev-r" d="m19.5 7.5-4.5 4.5 4.5 4.5" />
      </svg>
    </button>
  );
}

function PanelPill({ icon, label, what, valueAttr, value }: { icon: 'zoom' | 'lens'; label: string; what: string; valueAttr: string; value: string }) {
  return (
    <button type="button" className="sp-pill" data-sp-expand="" aria-expanded="false" title={`Expand ${what} · drag to move`} aria-label={`Expand ${what}`}>
      <span className="sp-ico" aria-hidden="true">
        <Icon name={icon} size={14} />
      </span>
      <span className="sp-pill-label">
        {label}
      </span>
      <span className="sp-pill-value" {...{ [valueAttr]: '' }}>
        {value}
      </span>
    </button>
  );
}
