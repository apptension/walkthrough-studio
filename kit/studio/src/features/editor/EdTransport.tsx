import { useEffect } from 'react';

import { Icon } from '@/ui/icons';

import { wireTransport } from './engine/lifecycle';

/** `#edTransport` — the engine paints play state, the clip chip and the toggles (`paintTransport`). */
export function EdTransport() {
  useEffect(() => {
    const ac = new AbortController();
    wireTransport(ac.signal);
    return () => ac.abort();
  }, []);

  return (
    <div className="ed-transport" id="edTransport">
      <button type="button" id="edToStart" className="ed-btn" title="Back to the start (Home)" aria-label="Back to the start">
        <Icon name="ui-to-start" size={14} />
      </button>
      {' '}
      <button type="button" id="edPlay" className="ed-play" title="Play / pause (Space)" aria-label="Play" />
      {' '}
      <button type="button" id="edReplay" className="ed-btn" title="Replay this clip (R)" aria-label="Replay this clip">
        <Icon name="ui-replay" size={15} />
      </button>
      {' '}
      <span id="edClipChip" className="ed-clip-chip" />
      {' '}
      <span className="transport-spacer" />
      {' '}
      <button type="button" id="edEditText" className="ed-btn labeled" hidden title="Edit the words on this plate" aria-pressed="false">
        <Icon name="ui-text" size={14} />
        <span>
          Edit text
        </span>
      </button>
      {' '}
      <button type="button" id="edLoop" className="ed-btn labeled" title="Loop the clip under the playhead (L)">
        <Icon name="ui-loop" size={14} />
        <span>
          Loop
        </span>
      </button>
      {' '}
      <button type="button" id="edFx" className="ed-btn labeled is-on" title="Preview zooms and transitions while you watch">
        <Icon name="ui-eye" size={14} />
        <span>
          Effects
        </span>
      </button>
      {' '}
      <button type="button" id="edSound" className="ed-btn labeled is-on" title="Play narration and music with the cut">
        <Icon name="ui-sound" size={14} />
        <span>
          Sound
        </span>
      </button>
      {' '}
      <button type="button" id="edFullscreen" className="ed-btn" title="Fullscreen" aria-label="Fullscreen">
        <Icon name="ui-fullscreen" size={14} />
      </button>
    </div>
  );
}
