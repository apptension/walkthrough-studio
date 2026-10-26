import { useEffect, useRef } from 'react';

import { chooseTake, useBayCards } from './bayCards';
import { clock, preferredTakeChoice, takeFacts, type GuidedTour, type TakeChoice } from '@/logic/takeChoice';

/**
 * `#bayTake` — after a guided session: keep the reviewer's own recording, let the
 * bot re-record the captured steps, or record again (`createTakeChoice` in
 * `kit/studio/takeChoice.js`).
 */

function GoSvg() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5 8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlaySvg() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.5 3.8v12.4L16 10 5.5 3.8Z" fill="currentColor" />
    </svg>
  );
}

interface OptionProps {
  id: 'own' | 'bot';
  title: string;
  body: string;
  tag: string;
  preferred: boolean;
  disabled?: boolean;
}

function TakeOption({ id, title, body, tag, preferred, disabled }: OptionProps) {
  return (
    <button
      type="button"
      className={`take-opt take-opt--${id}${preferred ? ' is-preferred' : ''}`}
      data-take-choice={id}
      {...(disabled ? { disabled: true, 'aria-disabled': true } : {})}
      onClick={() => chooseTake(id)}
    >
      <span className="take-opt-head">
        <span className="take-opt-ico" aria-hidden="true">
          {id === 'own' ? <i /> : <PlaySvg />}
        </span>{' '}
        {tag ? <span className="take-opt-tag">{tag}</span> : <span />}
      </span>{' '}
      <strong>{title}</strong> <em>{body}</em>{' '}
      <span className="take-opt-go" aria-hidden="true">
        Continue
        <GoSvg />
      </span>
    </button>
  );
}

export function TakeChoiceCard() {
  const take = useBayCards((s) => s.take);
  if (!take) return <section id="bayTake" className="take-choice" aria-label="Choose your take" hidden />;
  return <TakeChoiceOpen key={take.slug} slug={take.slug} tour={take.tour} />;
}

function TakeChoiceOpen({ slug, tour }: { slug: string; tour: GuidedTour | null }) {
  const hostRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const t = tour?.take;
  const replayable = Boolean(tour?.steps);
  const preferred = preferredTakeChoice(tour, slug);

  useEffect(() => {
    hostRef.current?.querySelector<HTMLButtonElement>('.take-opt.is-preferred')?.focus({ preventScroll: true });
    const video = videoRef.current;
    return () => video?.pause();
  }, []);

  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Number(sec) || 0;
    void v.play().catch(() => {});
  };

  const again: TakeChoice = 'again';
  return (
    <section ref={hostRef} id="bayTake" className="take-choice" aria-label="Choose your take">
      <div className="take-choice-head">
        <strong>{t ? 'Your recording is ready' : 'Your steps are saved'}</strong>{' '}
        <em>
          {t
            ? 'Pick how this video uses it. You can switch later by recording again.'
            : 'No recording was kept (it was under a second or stopped early). The bot can record your steps.'}
        </em>
      </div>
      {t ? (
        <div className="take-choice-media">
          <video ref={videoRef} src={t.url} poster={t.poster || undefined} controls muted playsInline preload="metadata" />
          <div className="take-choice-facts">
            <b>{takeFacts(tour)}</b>
            {t.chapters?.length ? (
              <ol className="take-chapters">
                {t.chapters.map((c, i) => (
                  <li key={`${c.t}-${i}`}>
                    <button type="button" data-take-seek={c.t} onClick={() => seek(c.t)}>
                      <span>{clock(c.t)}</span>
                      {c.title}
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="take-choice-options" role="group" aria-label="Which take to use">
        {t ? (
          <TakeOption
            id="own"
            title="Use my recording"
            body="Keep it exactly as you showed it. Pauses are already cut; narration follows your chapters."
            tag="Your take"
            preferred={preferred === 'own'}
          />
        ) : null}
        {replayable ? (
          <TakeOption
            id="bot"
            title="Let the bot re-record"
            body="Tidies your steps into a script, then records at a steady pace with a smooth pointer."
            tag={preferred === 'bot' ? 'Suggested' : ''}
            preferred={preferred === 'bot'}
          />
        ) : (
          <TakeOption
            id="bot"
            title="Let the bot re-record"
            body="Not available — no clicks or typing were captured. Record again and walk the product to unlock this."
            tag=""
            preferred={preferred === 'bot'}
            disabled
          />
        )}
      </div>
      <button type="button" className="take-again" data-take-choice={again} onClick={() => chooseTake(again)}>
        Record again
      </button>
    </section>
  );
}
