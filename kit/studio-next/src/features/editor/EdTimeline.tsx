import { useEffect } from 'react';

import { toggleTl } from '@/desk/layout';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { Scrubber } from '@/ui/Scrubber';

import { wireTimelineBar } from './engine/lifecycle';

/** `#edTimeline` — the engine renders the ruler, tracks, selection and context (`renderTimeline`). */
export function EdTimeline() {
  const collapsed = useDesk((s) => s.tlCollapsed);

  useEffect(() => {
    const ac = new AbortController();
    wireTimelineBar(ac.signal);
    return () => ac.abort();
  }, []);

  return (
    <div id="edTimeline" className="etl" aria-label="Editor timeline">
      <div className="etl-bar">
          <button
            type="button"
            id="etlToggle"
            className="etl-toggle"
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand the timeline' : 'Collapse the timeline'}
            aria-label="Collapse or expand the timeline"
            onClick={toggleTl}
          >
          <Icon name="ui-chevron" size={13} className="etl-toggle-chevron" />
          {' '}
          <span>
            Timeline
          </span>
        </button>
        {' '}
        <span className="etl-sep" aria-hidden="true" />
        <div className="etl-tools" role="toolbar" aria-label="Edit tools">
          <button type="button" id="etlAddSpeed" className="etl-tool speed">
            <Icon name="ui-speed" size={14} />
            Speed
          </button>
          {' '}
          <button type="button" id="etlAddZoom" className="etl-tool zoom">
            <Icon name="ui-zoom" size={14} />
            Zoom
          </button>
          {' '}
          <button type="button" id="etlAddLens" className="etl-tool lens">
            <Icon name="ui-lens" size={14} />
            Magnify
          </button>
          {' '}
          <button type="button" id="etlAddCut" className="etl-tool cut" title="Cut a stretch out of the recording">
            <Icon name="ui-cut" size={14} />
            Cut
          </button>
          {' '}
          <button type="button" id="etlAddVoice" className="etl-tool voice" title="Add a voice line at the playhead">
            <Icon name="ui-mic" size={14} />
            Voice
          </button>
          {' '}
          <button type="button" id="etlMix" className="etl-tool mix">
            <Icon name="ui-music" size={14} />
            Mix
          </button>
          {' '}
          <span className="etl-sep" aria-hidden="true" />
          {' '}
          <button type="button" id="etlUndo" className="etl-icon" title="Undo (⌘Z)" aria-label="Undo" disabled>
            <Icon name="ui-undo" size={14} />
          </button>
          {' '}
          <button type="button" id="etlRedo" className="etl-icon" title="Redo (⇧⌘Z)" aria-label="Redo" disabled>
            <Icon name="ui-redo" size={14} />
          </button>
        </div>
        <div id="etlContext" className="etl-context" />
        <div className="etl-scale">
          <button type="button" id="etlFit" className="etl-icon" title="Fit the whole cut" aria-label="Fit the whole cut">
            <Icon name="ui-fullscreen" size={14} />
          </button>
          {' '}
          <Scrubber id="etlScale" min="0" max="4.5" step="0.05" defaultValue="0" aria-label="Timeline zoom" title="Timeline zoom (⌘ + scroll)" />
          {' '}
          <span id="etlDur" className="etl-dur">
            0:00.0
          </span>
        </div>
      </div>
      <div className="etl-body">
        <div id="etlScroll" className="etl-scroll">
          <div className="etl-scroll-row">
            <div className="etl-heads" aria-hidden="true">
              <div className="etl-head ruler" />
              <div className="etl-head clips" title="Clips">
                <Icon name="ui-film" size={13} />
              </div>
              <div className="etl-head chapters" id="etlHeadChapters" title="Chapters">
                <Icon name="ui-chapters" size={12} />
              </div>
              <div className="etl-head captions" id="etlHeadCaptions" title="Captions">
                <Icon name="ui-captions" size={12} />
              </div>
              <div className="etl-head speed" title="Speed">
                <Icon name="ui-speed" size={12} />
              </div>
              <div className="etl-head zoom" title="Zoom">
                <Icon name="ui-zoom" size={12} />
              </div>
              <div className="etl-head cut" title="Cut">
                <Icon name="ui-cut" size={12} />
              </div>
              <div className="etl-head voice" title="Voice">
                <Icon name="ui-mic" size={12} />
              </div>
              <div className="etl-head music" title="Music">
                <Icon name="ui-music-sm" size={12} />
              </div>
            </div>
            <div id="etlCanvas" className="etl-canvas">
              <div id="etlRuler" className="etl-ruler" />
              <div id="etlClips" className="etl-track clips" />
              <div id="etlChapters" className="etl-track fxrow cards chapters" data-empty="" />
              <div id="etlCaptions" className="etl-track fxrow cards captions" data-empty="" />
              <div id="etlSpeed" className="etl-track fxrow speed" />
              <div id="etlZoom" className="etl-track fxrow zoom" />
              <div id="etlCuts" className="etl-track fxrow cut" />
              <div id="etlVoice" className="etl-track fxrow voice" />
              <div id="etlMusic" className="etl-track fxrow music" />
              <div id="etlSel" className="etl-sel" hidden />
              <div id="etlPlayhead" className="etl-playhead">
                <i />
                <span id="edClock" className="etl-time" aria-live="off">
                  0:00.0{' '}
                  <span className="t-sep">
                    /
                  </span>
                  {' '}0:00.0
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
