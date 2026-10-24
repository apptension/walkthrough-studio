import { Fragment, type MouseEvent } from 'react';

/** The four sections of the Studio guide, verbatim from `#helpDialog` in `kit/studio/index.html`. */

const FLOW: ReadonlyArray<{ stage: string; title: string; body: string }> = [
  { stage: 'brief', title: 'Brief', body: 'Who it’s for and what they should walk away knowing.' },
  { stage: 'script', title: 'Script', body: 'Approve what’s said and shown — cheapest place to change course.' },
  { stage: 'direction', title: 'Direction', body: 'Palette, logo, focus lens, zoom, frame, cursor and transitions.' },
  { stage: 'record', title: 'Record', body: 'Playwright captures the live app, following the script.' },
  { stage: 'cut', title: 'Cut', body: 'Watch the render, leave feedback, then approve the take.' },
  { stage: 'deliver', title: 'Deliver', body: 'Export the master, captions, chapters, poster, and social cuts.' },
];

export function GuideHow({ onStage }: { onStage: (stage: string) => void }) {
  return (
    <section id="guideHow" className="guide-block" aria-labelledby="guideHowTitle">
      <h3 id="guideHowTitle" className="sheet-section first">
        How a video gets made
      </h3>
      <ol className="guide-flow">
        {FLOW.map((s) => (
          <li key={s.stage}>
            <button
              type="button"
              className="guide-stage"
              data-guide-stage={s.stage}
              onClick={(e: MouseEvent) => {
                e.preventDefault();
                onStage(s.stage);
              }}
            >
              <strong>{s.title}</strong> <span>{s.body}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="guide-callout" role="note">
        <span className="guide-callout-ico" aria-hidden="true">
          →
        </span>{' '}
        <span>
          The stage bar under the header tracks this video. The highlighted stage is next; any stage opens its sheet or panel.
        </span>
      </p>
    </section>
  );
}

const DESK_COLS: ReadonlyArray<{ label: string; items: string[]; centre?: boolean }> = [
  { label: 'Left', items: ['Render', 'Versions', 'Deliver'] },
  { label: 'Centre', items: ['Program', 'Editor'], centre: true },
  { label: 'Right', items: ['Feedback', 'Inspector', 'Direction', 'Review'] },
];

const DESK_MAP: ReadonlyArray<[string, string]> = [
  ['Left · Render', 'What needs doing, the primary action, live progress and the step queue.'],
  ['Left · Versions', 'Saved and approved cuts. Play, compare or restore any of them.'],
  ['Left · Deliver', 'Poster, handoff pack, captions, chapters and social formats.'],
  ['Centre · Program', ''],
  ['Right · Feedback', 'Plain-language director notes. The agent picks the smallest safe scope; you approve before it writes.'],
  ['Right · Inspector', 'Edit the selected clip, join, voice line or plate field from the Editor.'],
  ['Right · Direction', 'Visual language for this video: focus, zoom, frame, cursor, atmosphere, transitions.'],
  ['Right · Review', 'Story review, quality checks and chapters.'],
];

export function GuideDesk() {
  return (
    <section id="guideDesk" className="guide-block" aria-labelledby="guideDeskTitle">
      <h3 id="guideDeskTitle" className="sheet-section">
        The desk
      </h3>
      <div className="guide-desk" aria-hidden="true">
        {DESK_COLS.map((col) => (
          <div key={col.label} className={`guide-desk-col${col.centre ? ' guide-desk-centre' : ''}`}>
            <span className="guide-desk-label">{col.label}</span>
            <ul>
              {col.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <dl className="guide-map">
        {DESK_MAP.map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            {dt === 'Centre · Program' ? (
              <dd>
                The rendered master. Open <em>Editor</em> for one timeline — clips, joins, speed and zoom. Click a strip to edit it in
                Inspector.
              </dd>
            ) : (
              <dd>{dd}</dd>
            )}
          </div>
        ))}
      </dl>
      <p className="guide-tip">
        <span className="help-inline" aria-hidden="true">
          i
        </span>{' '}
        <span>
          Hover any{' '}
          <span className="help-inline" aria-hidden="true">
            i
          </span>{' '}
          next to a control for a short explanation. Click to pin it; <kbd>Esc</kbd> dismisses.
        </span>
      </p>
    </section>
  );
}

const TERMS: ReadonlyArray<[string, string]> = [
  ['Plate', 'A designed brand scene — opener, title cards, close.'],
  ['Chapter', 'A section of the live tour. Becomes a YouTube chapter.'],
  ['Out of date', 'Sources changed since the last render. Use Render to catch up.'],
  ['Checkpoint', 'Automatic save from each render. Hidden in Versions unless you need it.'],
  ['Handoff pack', 'Everything the client receives, as one zip.'],
  ['Smart scope', 'The agent chooses the smallest safe change from a director note.'],
];

export function GuideWords() {
  return (
    <section id="guideWords" className="guide-block" aria-labelledby="guideWordsTitle">
      <h3 id="guideWordsTitle" className="sheet-section">
        Words you’ll see
      </h3>
      <dl className="guide-terms">
        {TERMS.map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A keycap; `mod` is the platform modifier painted on `[data-mod]` caps. */
type Cap = string | { mod: true };

const KEY_GROUPS: ReadonlyArray<{ title: string; rows: ReadonlyArray<{ keys: Cap[]; what: string }> }> = [
  {
    title: 'Everywhere',
    rows: [
      { keys: [{ mod: true }, 'K'], what: 'Search commands and jump anywhere' },
      { keys: ['?'], what: 'Open this guide' },
      { keys: ['Esc'], what: 'Close a dialog, tip or selection' },
    ],
  },
  {
    title: 'Program',
    rows: [
      { keys: ['Space'], what: 'Play / pause' },
      { keys: ['J', 'L'], what: 'Back / forward 5 seconds' },
      { keys: ['←', '→'], what: 'Back / forward 2 seconds' },
      { keys: ['C'], what: 'Toggle captions' },
      { keys: [{ mod: true }, 'S'], what: 'Save plate copy edits' },
    ],
  },
  {
    title: 'Editor',
    rows: [
      { keys: ['R'], what: 'Replay the clip under the playhead' },
      { keys: ['S', 'Z', 'M', 'C'], what: 'Speed / zoom / magnify / cut at the playhead' },
      { keys: [{ mod: true }, 'Z'], what: '' },
    ],
  },
];

function Caps({ keys, mod }: { keys: Cap[]; mod: string }) {
  return (
    <>
      {keys.map((k, i) =>
        typeof k === 'string' ? (
          <kbd key={i}>{k}</kbd>
        ) : (
          <kbd key={i} data-mod="">
            {mod}
          </kbd>
        ),
      )}
    </>
  );
}

export function GuideKeys({ mod }: { mod: string }) {
  return (
    <section id="guideKeys" className="guide-block" aria-labelledby="guideKeysTitle">
      <h3 id="guideKeysTitle" className="sheet-section">
        Shortcuts
      </h3>
      <p className="guide-keys-lede">Ignored while typing in a field or when another dialog is open.</p>
      {KEY_GROUPS.map((group) => (
        <Fragment key={group.title}>
          <h4 className="guide-keys-group">{group.title}</h4>
          <dl className="keys">
            {group.rows.map((row, i) => (
              <div key={i}>
                <dt>
                  <Caps keys={row.keys} mod={mod} />
                </dt>
                {row.what ? (
                  <dd>{row.what}</dd>
                ) : (
                  <dd>
                    Undo · <Caps keys={['⇧', { mod: true }, 'Z']} mod={mod} /> redo
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </Fragment>
      ))}
    </section>
  );
}
