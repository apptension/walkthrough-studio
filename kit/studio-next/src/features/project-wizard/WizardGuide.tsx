import { useCallback, useEffect, useRef, useState } from 'react';

import { api, enc } from '@/desk/api';
import { NeonButton } from '@/ui/NeonButton';
import { ACTIONS, STATE_COPY, clock, guideJourney, guideLive, guideStates, guideStatusLine, type GuideStatus } from '@/features/project-panel/guideModel';

import { useWizardGuide } from './guideSession';

/**
 * `#wizardGuide` — the live card for a guided session inside the creation
 * view (`createGuideCard` in `kit/studio/guideCard.js`). Status comes from
 * GET /guide; buttons go through POST /guide/control.
 */
export function WizardGuide() {
  const slug = useWizardGuide((s) => s.slug);
  const gen = useWizardGuide((s) => s.gen);
  const [lastState, setLastState] = useState<string | undefined>(undefined);
  if (!slug) return <section id="wizardGuide" className="guide-card" aria-live="polite" hidden data-state={lastState} />;
  return <WizardGuideLive key={gen} slug={slug} onState={setLastState} />;
}

function WizardGuideLive({ slug, onState }: { slug: string; onState: (state: string) => void }) {
  const [status, setStatus] = useState<GuideStatus | null>(null);
  const [pending, setPending] = useState('');
  const [marking, setMarking] = useState(false);
  const [, setNow] = useState(0);
  const lastFetch = useRef(0);
  const pendingRef = useRef('');
  pendingRef.current = pending;
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (!force && now - lastFetch.current < 900) return;
      lastFetch.current = now;
      try {
        const r = await api<{ tour?: { status?: GuideStatus | null } | null }>(`/api/video/${enc(slug)}/guide`);
        setStatus(r.tour?.status || null);
        if (pendingRef.current && pendingRef.current !== 'finish') setPending('');
      } catch {
        /* the card is advisory; the job stream still shows progress */
      }
    },
    [slug],
  );

  useEffect(() => {
    const polling = setInterval(() => void refresh(), 1200);
    const ticking = setInterval(() => setNow(Date.now()), 250);
    void refresh(true);
    return () => {
      clearInterval(polling);
      clearInterval(ticking);
    };
  }, [refresh]);

  useEffect(() => {
    if (marking) inputRef.current?.focus();
  }, [marking]);

  const send = async (action: string, extra: Record<string, unknown> = {}) => {
    setPending(action);
    try {
      if (action === 'finish') await api(`/api/video/${enc(slug)}/guide/finish`, { method: 'POST' });
      else await api(`/api/video/${enc(slug)}/guide/control`, { method: 'POST', body: { action, ...extra } });
      setTimeout(() => void refresh(true), 450);
    } catch {
      setPending('');
    }
  };

  const { raw, state } = guideStates(status, pending);
  useEffect(() => onState(state), [onState, state]);
  const [title, hint] = STATE_COPY[state] ?? STATE_COPY['capturing'] ?? ['', ''];
  const actions = ACTIONS[raw] ?? [];
  const { rec, count } = guideLive(status);

  const onMark = () => {
    const titleText = inputRef.current?.value.trim() || '';
    setMarking(false);
    void send('mark', { title: titleText });
  };

  return (
    <section id="wizardGuide" className="guide-card" aria-live="polite" data-state={state}>
      <div className="guide-card-head">
        <span className="guide-rec" aria-hidden="true">
          <i />
        </span>
        <div className="guide-card-titles">
          <strong>
            {title}
            {state === 'countdown' ? (
              <>
                {' '}
                <span className="guide-count" data-guide-count="">
                  {String(count)}
                </span>
              </>
            ) : null}
          </strong>
          <em>{hint}</em>
        </div>
        <span className="guide-timer" data-guide-timer="" aria-label="Recorded time">
          {status?.recording ? clock(rec) : ''}
        </span>
      </div>
      <ol className="guide-journey">
        {guideJourney(status).map((s) => (
          <li key={s.id} data-step={s.id} className={`is-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
            <span dangerouslySetInnerHTML={{ __html: s.html }} />
          </li>
        ))}
      </ol>
      {state === 'connecting' || state === 'finishing' || state === 'done' ? null : (
        <div className="guide-card-live">
          <b>{guideStatusLine(status)}</b>
          {status?.last && (raw === 'capturing' || raw === 'paused') ? (
            <>
              {' '}
              <span>Last: {status.last}</span>
            </>
          ) : null}
        </div>
      )}
      {marking ? (
        // A <form> cannot nest inside #projectForm; the legacy innerHTML parser dropped it too.
        <div
          className="guide-mark"
          data-guide-mark=""
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.target !== inputRef.current) return;
            e.preventDefault();
            e.stopPropagation();
            onMark();
          }}
        >
          <input ref={inputRef} type="text" maxLength={60} placeholder="Chapter title — e.g. Plan the week (optional)" aria-label="Chapter title" autoComplete="off" />{' '}
          <NeonButton className="btn primary" onClick={onMark}>
            Add chapter
          </NeonButton>{' '}
          <button type="button" className="btn ghost" data-guide-mark-cancel="" onClick={() => setMarking(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      {actions.length ? (
        <>
          <div className="guide-actions">
            {actions.map(([a, label, cls]) => (
              <NeonButton
                key={a}
                className={cls}
                data-guide-action={a}
                disabled={Boolean(pending)}
                onClick={() => {
                  if (a === 'mark') setMarking(true);
                  else void send(a);
                }}
              >
                {label}
              </NeonButton>
            ))}
          </div>
          <p className="guide-card-foot">
            The same controls are in the <b>Recorder</b> window beside the browser.
          </p>
        </>
      ) : null}
    </section>
  );
}
