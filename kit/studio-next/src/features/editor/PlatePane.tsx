import { useEffect } from 'react';

import { runtime } from '@/desk/runtime';
import { useDesk } from '@/desk/store';
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
          <iframe id="plateFrame" title="Plate HTML preview" sandbox="allow-same-origin allow-scripts" ref={registerFrame} />
        </div>
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
            <div id="liveZoomBox" className="live-zoom-box" hidden>
              <i className="zh nw" />
              <i className="zh ne" />
              <i className="zh sw" />
              <i className="zh se" />
              <div className="frame-editor stage-panel" data-frame-editor="zoom" data-tone="zoom" role="group" aria-label="Zoom controls">
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
                <span className="sp-keys" data-zoom-keys="" aria-hidden="true" />
                <span className="sp-sep" aria-hidden="true" />
                <button type="button" className="frame-editor-hit sp-icon-btn is-danger" data-frame-remove="zoom" title="Remove zoom" aria-label="Remove zoom">
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            <div id="liveLensBox" className="live-lens-box" hidden aria-hidden="true" />
          </div>
        </div>
      </div>
      <div id="liveLensHud" className="lens-stage-hud" data-tone="lens" hidden aria-label="Magnifier controls">
        <div className="lens-stage-hud__card stage-panel is-card" role="group">
          <header className="sp-head">
            <span className="sp-ico" aria-hidden="true">
              <Icon name="lens" size={14} />
            </span>
            <strong className="sp-title" data-lens-hud-title="">
              Magnifier
            </strong>
            <output className="sp-value" data-lens-hud-meta="" htmlFor="liveLensHudZoom">
              1.2×
            </output>
            <button type="button" className="sp-icon-btn is-danger" data-frame-remove="lens" title="Remove magnifier" aria-label="Remove magnifier">
              <Icon name="trash" size={14} />
            </button>
          </header>
          <div className="sp-rows" data-lens-hud-controls="">
            <label className="sp-row">
              <span className="sp-row-label">
                Strength
              </span>
              <Scrubber id="liveLensHudZoom" data-frame-lens-zoom="" min="1.2" max="2.4" step="0.05" aria-label="Magnifier strength" />
              <output className="sp-row-value" data-lens-zoom-value="">
                1.8×
              </output>
            </label>
            <label className="sp-row">
              <span className="sp-row-label">
                Size
              </span>
              <Scrubber data-frame-lens-size="" min="24" max="540" step="2" aria-label="Magnifier size" />
              <output className="sp-row-value" data-lens-size-value="">
                12%
              </output>
            </label>
          </div>
          <p className="sp-keys sp-foot" data-lens-hud-hint="" />
          <button type="button" className="ed-pill-btn primary sp-wide" data-lens-hud-take="" hidden>
            <Icon name="target" size={13} />
            <span>
              Take over
            </span>
          </button>
        </div>
      </div>
      <div id="edHud" className="ed-hud" aria-live="polite" />
      <div id="edLoading" className="ed-loading" hidden>
        <i />
      </div>
      <div id="edTextBar" className="ed-textbar stage-panel" data-tone="text" hidden />
    </div>
  );
}
