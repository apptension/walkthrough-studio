import { useState } from 'react';

import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';

import { setRate, skip, toggleFullscreen, toggleMute, togglePlay } from './actions';

function PlayButton() {
  const playing = useDesk((s) => s.transport.playing);
  return (
    <button type="button" id="btnPlay" className={playing ? 'play-btn is-playing' : 'play-btn'} title="Space" aria-label="Play" onClick={togglePlay}>
      <Icon name="ui-play-fill" size={16} className="ico-play" />
      {' '}
      <Icon name="ui-pause-fill" size={16} className="ico-pause" />
    </button>
  );
}

function MuteButton() {
  const [muted, setMuted] = useState(false);
  const label = muted ? 'Unmute' : 'Mute';
  return (
    <button
      type="button"
      id="btnMute"
      className={muted ? 'btn icon is-muted' : 'btn icon'}
      aria-label={label}
      title={label}
      onClick={() => setMuted(toggleMute())}
    >
      <Icon name="ui-volume" size={16} className="ico-vol" />
      {' '}
      <Icon name="ui-mute" size={16} className="ico-mute" hidden />
    </button>
  );
}

/** The Program transport bar under the stage. */
export function Transport() {
  return (
    <div className="transport">
      <button type="button" id="btnSkipBack" className="btn icon" aria-label="Back 5 seconds" title="J −5s" onClick={() => skip(-5)}>
        <Icon name="ui-skip-back" size={16} />
      </button>
      {' '}
      <PlayButton />
      {' '}
      <button type="button" id="btnSkipFwd" className="btn icon" aria-label="Forward 5 seconds" title="L +5s" onClick={() => skip(5)}>
        <Icon name="ui-skip-fwd" size={16} />
      </button>
      {' '}
      <span className="transport-spacer" />
      {' '}
      <select id="rateSelect" aria-label="Speed" className="rate" defaultValue="1" onChange={(e) => setRate(e.currentTarget.value)}>
        <option value="0.75">
          0.75×
        </option>
        <option value="1">
          1×
        </option>
        <option value="1.25">
          1.25×
        </option>
        <option value="1.5">
          1.5×
        </option>
        <option value="2">
          2×
        </option>
      </select>
      {' '}
      <MuteButton />
      {' '}
      <button type="button" id="btnFs" className="btn icon" aria-label="Fullscreen" title="Fullscreen" onClick={() => void toggleFullscreen()}>
        <Icon name="ui-fullscreen-fill" size={16} />
      </button>
    </div>
  );
}
