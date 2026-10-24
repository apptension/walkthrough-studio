import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { Icon } from '@/ui/icons';

import { BRIEF_EXAMPLES, descriptionSignals, hostOf, lengthLabel, type BriefExample } from './briefSignals';
import { agentPulse } from './creationFeed';
import { ThoughtCaption } from './CreationStage';
import { LanguageField } from './LanguageField';
import { next, useWizard, type BrandPack } from './wizard';
import { WizardStream } from './WizardStream';

/** The brief fields the agent fills while it reads the description, in the order it usually gets to them. */
const FILLS = [
  { icon: 'ui-text', label: 'Title & product' },
  { icon: 'ui-target', label: 'Audience & outcome' },
  { icon: 'ui-story', label: 'Story spine & length' },
  { icon: 'ui-chapters', label: 'Chapters to show' },
  { icon: 'ui-palette', label: 'Brand pack' },
  { icon: 'ui-open', label: 'App access' },
] as const;

const HOW = [
  { icon: 'ui-pencil', title: 'The agent drafts your brief', line: 'Title, audience, chapters and brand in about 30 seconds. You check every field.' },
  { icon: 'ui-palette', title: 'Brand and product map', line: 'It verifies logo, colours and type, then walks the live product.' },
  { icon: 'ui-story', title: 'A first script', line: 'Chapters, voice-over and plates written for your audience.' },
  { icon: 'ui-render', title: 'You approve, then it records', line: 'Nothing is recorded or rendered until you say so.' },
] as const;

function useElapsed(on: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!on) return;
    const start = Date.now();
    setSec(0);
    const t = window.setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return on ? sec : 0;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function PackChip({ pack }: { pack: BrandPack }) {
  return (
    <span className="lp-pack" style={{ '--pk-a': pack.accent || 'var(--accent)' } as CSSProperties}>
      <i aria-hidden="true" />
      {pack.name}
    </span>
  );
}

function Drafting({ elapsed }: { elapsed: number }) {
  const title = useWizard((s) => s.shortDraftTitle);
  const line = useWizard((s) => s.shortDraftLine);
  const job = useWizard((s) => s.shortJob);
  const pulse = useMemo(() => agentPulse(job?.stream?.entries), [job]);
  const writing = job?.phase === 'writing' || job?.phase === 'finishing';
  const active = Math.min(FILLS.length - 1, Math.max(writing ? 3 : 0, Math.floor(elapsed / 12)));
  return (
    <>
      <header className="short-draft-head lp-draft-head">
        <span className="lp-mark" aria-hidden="true">
          <span className="activity-spinner" />
        </span>
        <div>
          <strong id="shortDraftTitle">{title}</strong> <em id="shortDraftLine">{line}</em>
        </div>
        <time className="lp-clock" aria-label="Elapsed">
          {clock(elapsed)}
        </time>
      </header>
      <ol className="lp-fill" aria-label="Brief fields">
        {FILLS.map((f, i) => (
          <li key={f.label} className={i < active ? 'done' : i === active ? 'active' : undefined} style={{ '--i': i } as CSSProperties}>
            <span className="lp-fill-ico">
              <Icon name={i < active ? 'ui-check' : f.icon} size={12} />
            </span>
            <span>{f.label}</span>
            <i className="lp-fill-bar" aria-hidden="true" />
          </li>
        ))}
      </ol>
      <ThoughtCaption thought={pulse.thought} label="Agent" />
      {pulse.actions.length ? (
        <ul className="lp-moves" aria-label="Agent activity">
          {pulse.actions.slice(0, 3).map((a, i) => {
            const running = i === 0 && !a.done && job?.status === 'running';
            return (
              <li key={a.id} className={running ? 'is-running' : undefined}>
                {running ? <span className="activity-spinner" /> : <Icon name={a.icon} size={11} />} <b>{a.verb}</b> {a.object}
              </li>
            );
          })}
        </ul>
      ) : null}
      <details className="lp-log">
        <summary>Live output</summary>
        <WizardStream id="shortDraftStream" job={job} label="Live output" />
      </details>
    </>
  );
}

/** The New video launchpad: one description the agent turns into the five steps. */
export function ShortStep() {
  const shown = useWizard((s) => s.mode === 'short');
  const drafting = useWizard((s) => s.drafting);
  const packs = useWizard((s) => s.brandPacks);
  const rev = useWizard((s) => s.formRev);
  const area = useRef<HTMLTextAreaElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const elapsed = useElapsed(drafting);
  const sig = useMemo(() => descriptionSignals(text), [text]);
  const host = hostOf(url);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  };

  useEffect(() => {
    setText(area.current?.value || '');
    setUrl(urlRef.current?.value || '');
    grow();
  }, [rev, shown]);

  useEffect(() => {
    if (shown && !drafting) area.current?.focus({ preventScroll: true });
  }, [shown, drafting]);

  const applyExample = (ex: BriefExample) => {
    const el = area.current;
    if (!el) return;
    el.value = ex.text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setText(ex.text);
    grow();
    el.focus();
    el.setSelectionRange(ex.text.length, ex.text.length);
    if (!hostOf(urlRef.current?.value || '')) urlRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      next();
    }
  };

  const signals = [
    { id: 'who', on: Boolean(sig.audience), icon: 'ui-target', text: sig.audience ? `For ${sig.audience}` : 'Who watches' },
    { id: 'goal', on: sig.goal, icon: 'ui-eye', text: 'What to show' },
    { id: 'len', on: sig.lengthSec != null, icon: 'ui-pace', text: sig.lengthSec ? `About ${lengthLabel(sig.lengthSec)}` : 'How long' },
    { id: 'beats', on: sig.beats >= 2, icon: 'ui-chapters', text: sig.beats >= 2 ? `${sig.beats} moments` : 'The moments' },
  ];

  return (
    <fieldset data-step="short" hidden={!shown} className={`lp${drafting ? ' is-drafting' : ''}`}>
      <div className="lp-main">
        <div className="wz-head lp-head">
          <span className="lp-eyebrow">
            <Icon name="ui-sparkle" size={12} /> One description, one finished walkthrough
          </span>
          <h3>What should we make?</h3>
          <p>Brief it like you would a producer: what to show, for whom, and about how long. The draft stays editable. Nothing records until you approve it.</p>
        </div>

        <label className="wf lp-composer">
          <span className="field-label lp-label">
            Description <b>*</b>
          </span>
          <textarea
            ref={area}
            name="description"
            rows={4}
            placeholder="Show a new admin how to invite a teammate in about a minute, then the settings that decide who can change it."
            onInput={(e) => {
              setText(e.currentTarget.value);
              grow();
            }}
            onKeyDown={onKey}
          />
          <span className="lp-composer-bar">
            <span className="lp-signals" aria-label={`The agent can already tell ${sig.score} of 4`}>
              {signals.map((s) => (
                <span key={s.id} className={`lp-signal${s.on ? ' is-on' : ''}`}>
                  <Icon name={s.on ? 'ui-check' : s.icon} size={11} />
                  {s.text}
                </span>
              ))}
            </span>
            <span className="lp-kbd" aria-hidden="true">
              <kbd>⌘</kbd>
              <kbd>↵</kbd>
            </span>
          </span>
          <span className="lp-meter" aria-hidden="true">
            <i style={{ width: `${Math.max(sig.words ? 8 : 0, sig.score * 25)}%` }} />
          </span>
        </label>

        <div className="lp-examples" hidden={drafting}>
          <span className="lp-examples-label">Try an example</span>
          {BRIEF_EXAMPLES.map((ex) => (
            <button key={ex.id} type="button" className="lp-example" title={ex.text} onClick={() => applyExample(ex)}>
              <Icon name={ex.icon} size={12} />
              {ex.label}
            </button>
          ))}
        </div>

        <div className="lp-row">
          <label className="wf lp-url">
            <span className="field-label">
              Start URL <b>*</b>
            </span>
            <span className={`lp-input${host ? ' is-valid' : ''}`}>
              <Icon name="ui-open" size={13} />
              <input ref={urlRef} name="shortStartUrl" type="url" placeholder="https://app.example.com" spellCheck="false" onInput={(e) => setUrl(e.currentTarget.value)} />
              {host ? (
                <span className="lp-host" title={host} aria-label={`Opens ${host}`}>
                  <Icon name="ui-check" size={10} />
                </span>
              ) : null}
            </span>
            <small>Where the recorder opens your app. Sign-in details come later.</small>
          </label>
          <div id="languageSlotShort" className="lang-slot">
            {shown ? <LanguageField /> : null}
          </div>
        </div>

        <button type="button" className="lp-full" data-full-brief="">
          Prefer a form? <b>Fill each field instead</b>
          <Icon name="ui-chevron" size={11} />
        </button>

        <section id="shortDraft" className="short-draft lp-draft" role="status" aria-live="polite" hidden={!drafting}>
          {drafting ? (
            <Drafting elapsed={elapsed} />
          ) : (
            <>
              <strong id="shortDraftTitle" hidden />
              <em id="shortDraftLine" hidden />
              <WizardStream id="shortDraftStream" job={null} label="Live output" />
            </>
          )}
        </section>
      </div>

      <aside className="lp-aside" aria-label="How it works">
        <h4>How it works</h4>
        <ol className="lp-how">
          {HOW.map((h, i) => (
            <li key={h.title} className={drafting && i === 0 ? 'is-active' : undefined}>
              <span className="lp-how-ico">
                <Icon name={h.icon} size={14} />
              </span>
              <div>
                <strong>{h.title}</strong>
                <em>{h.line}</em>
              </div>
            </li>
          ))}
        </ol>
        {packs.length ? (
          <div className="lp-packs">
            <span>
              {packs.length} brand pack{packs.length === 1 ? '' : 's'} ready to reuse
            </span>
            <div className="lp-pack-row">
              {packs.slice(0, 6).map((p) => (
                <PackChip key={p.id} pack={p} />
              ))}
            </div>
          </div>
        ) : null}
        <p className="lp-promise">
          <Icon name="ui-lock" size={12} /> Credentials stay on this machine. Every step is reviewable.
        </p>
      </aside>
    </fieldset>
  );
}
