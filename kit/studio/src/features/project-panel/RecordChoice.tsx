import { requestMake } from '@/desk/jobs';
import { useDesk } from '@/desk/store';
import { HelpTip } from '@/ui/HelpTip';

/**
 * `#recordChoice` — re-record options: the bot replays the script, or the
 * reviewer takes over and shows the journey (`paintRecordChoice`).
 */

const HELP =
  'Agent-driven recording replays the current script with the bot. Record it yourself opens a browser and a Recorder window: press Start recording, show the journey (clicks, typing, drags, scrolls), then Finish recording. Then choose — keep your own recording, or let the bot re-record your steps at a steady pace. Narration is fitted to whichever take you keep.';

const n = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

function GoArrow() {
  return (
    <span className="rc-go" aria-hidden="true">
      Start
      <svg viewBox="0 0 12 12" fill="none">
        <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function RecordChoice() {
  const hasFlow = useDesk((s) => s.video?.hasFlow);
  const startUrl = useDesk((s) => s.video?.freshness?.startUrl);
  const captureMode = useDesk((s) => s.video?.captureMode);
  const steps = useDesk((s) => s.video?.guidedTour?.steps);
  const marks = useDesk((s) => s.video?.guidedTour?.marks);
  const hasVideo = useDesk((s) => s.video != null);
  const jobBusy = useDesk((s) => s.jobBusy);

  const canRecord = hasVideo && Boolean(hasFlow || startUrl);
  const preferred = captureMode === 'guided' ? 'guided' : 'full';
  const handText = steps ? `Last time: ${n(steps, 'step')}${marks ? ` · ${n(marks, 'chapter')}` : ''}` : 'Keep your take or hand it to the bot';
  const botText = !hasVideo || hasFlow ? 'The bot replays the current script' : 'The bot follows the brief';

  const pick = (mode: string) => () => requestMake(mode);

  return (
    <div id="recordChoice" className="record-choice" role="group" aria-labelledby="recordChoiceLabel" hidden={!canRecord || jobBusy}>
      <span id="recordChoiceLabel" data-help={HELP} className="record-choice-label has-help">
        Re-record
        <HelpTip text={HELP} label="Re-record" />
      </span>{' '}
      <button
        type="button"
        className={`record-choice-btn rc-opt--agent${hasVideo && preferred === 'full' ? ' is-preferred' : ''}`}
        data-record-choice="full"
        onClick={pick('full')}
      >
        <span className="rc-head">
          <span className="rc-ico" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M5.5 3.8v12.4L16 10 5.5 3.8Z" fill="currentColor" />
              <path d="M15.6 2.6l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" fill="currentColor" opacity=".7" />
            </svg>
          </span>{' '}
          <span className="rc-tag">Suggested</span>
        </span>{' '}
        <strong>Agent records</strong> <em>{botText}</em> <GoArrow />
      </button>{' '}
      <button
        type="button"
        className={`record-choice-btn rc-opt--self${hasVideo && preferred === 'guided' ? ' is-preferred' : ''}`}
        data-record-choice="guided"
        onClick={pick('guided')}
      >
        <span className="rc-head">
          <span className="rc-ico" aria-hidden="true">
            <i />
          </span>{' '}
          <span className="rc-tag">Suggested</span>
        </span>{' '}
        <strong>Record yourself</strong> <em>{handText}</em> <GoArrow />
      </button>
    </div>
  );
}
