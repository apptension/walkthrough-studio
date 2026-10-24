import { useState, type CSSProperties } from 'react';

import { VIDEO_LANGUAGES } from '@/logic/languages';
import { Icon } from '@/ui/icons';

import { briefChecks, hostOf, lengthLabel, purposeInfo, useBriefLive, type BriefCheck } from './briefSignals';
import { goTo, useWizard } from './wizard';

function jump(check: BriefCheck): void {
  if (useWizard.getState().step !== check.step) goTo(check.step);
  if (useWizard.getState().step !== check.step) return;
  const form = document.getElementById('projectForm');
  const el = form instanceof HTMLFormElement ? form.elements.namedItem(check.field) : null;
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (!(el instanceof HTMLSelectElement)) el.focus({ preventScroll: true });
  }
}

function PosterBrand({ id, name, font }: { id: string; name: string; font: string | null }) {
  const [broken, setBroken] = useState('');
  const [mark, setMark] = useState('');
  const wordmark = (
    <span className="wzp-wordmark" style={font ? { fontFamily: `'${font}', system-ui` } : undefined}>
      {name || 'Your brand'}
    </span>
  );
  if (!id || broken === id) return wordmark;
  return (
    <span className={`wzp-brand${mark === id ? ' is-mark' : ''}`}>
      <img
        key={id}
        className="wzp-logo"
        src={`/api/brands/${encodeURIComponent(id)}/lockup`}
        alt={name}
        onLoad={(e) => setMark(e.currentTarget.naturalWidth < e.currentTarget.naturalHeight * 1.8 ? id : '')}
        onError={() => setBroken(id)}
      />
      {mark === id ? wordmark : null}
    </span>
  );
}

const RING = 2 * Math.PI * 15;

/** "Prospects evaluating…" reads as "For prospects evaluating…"; acronyms ("CFOs") keep their case. */
const midSentence = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

/** The sticky preview beside the steps: the brief as a title card, its spine, chapters and what is still missing. */
export function BriefPreview() {
  const brief = useBriefLive((s) => s.brief);
  const packs = useWizard((s) => s.brandPacks);
  const settings = useWizard((s) => s.settings);
  const pack = brief.brandMode === 'existing' ? packs.find((p) => p.id === brief.brandId) : undefined;
  const purpose = purposeInfo(brief.purpose);
  const checks = briefChecks(brief);
  const done = checks.filter((c) => c.done).length;
  const missing = checks.find((c) => !c.done);
  const host = hostOf(brief.startUrl);
  const language = VIDEO_LANGUAGES.find((l) => l.code === brief.language)?.name || brief.language;
  const newBrand = brief.brandMode === 'new';
  const brandName = pack?.name || (newBrand ? brief.brandName || brief.product || (host ? host.replace(/^(app|www)\./, '') : '') : '');
  const c = pack?.colors || {};
  const style = {
    '--wzp-bg': c.ink || undefined,
    '--wzp-bg2': c.surface || undefined,
    '--wzp-a': pack?.accent || c.gold || undefined,
    '--wzp-fg': c.text || undefined,
  } as CSSProperties;

  return (
    <aside className="wz-preview" aria-label="Brief preview">
      {settings ? null : (
        <div className={`wzp-meter${missing ? '' : ' is-complete'}`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15" />
            <circle cx="18" cy="18" r="15" className="wzp-ring" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - done / checks.length) }} />
          </svg>
          <div>
            <strong>{missing ? `Brief ${Math.round((done / checks.length) * 100)}% ready` : 'Brief ready to draft'}</strong>
            {missing ? (
              <button type="button" className="wzp-next" onClick={() => jump(missing)}>
                Next: {missing.label}
              </button>
            ) : (
              <em>The agent has what it needs.</em>
            )}
          </div>
        </div>
      )}
      <div className="wzp-card" style={style}>
        <div className="wzp-poster">
          <div className="wzp-poster-top">
            <PosterBrand id={pack?.id || ''} name={brandName} font={pack?.font || null} />
            {newBrand ? <span className="wzp-tag">New brand</span> : null}
          </div>
          <span className="wzp-kicker">
            {purpose.label} · {lengthLabel(brief.lengthSec)}
          </span>
          <h4 className={brief.title ? undefined : 'is-empty'}>{brief.title || 'Untitled video'}</h4>
          <p className={brief.audience ? undefined : 'is-empty'}>{brief.audience ? `For ${midSentence(brief.audience)}` : 'Who watches?'}</p>
          {brief.outcome ? <p className="wzp-outcome">After watching, they can {midSentence(brief.outcome.replace(/^they can\s+/i, ''))}</p> : null}
          <span className="wzp-play" aria-hidden="true">
            <Icon name="ui-play-fill" size={12} />
          </span>
        </div>

        <ol className="wzp-spine" aria-label="Story spine">
          {purpose.spine.map((beat, i) => (
            <li key={beat} style={{ '--i': i } as CSSProperties}>
              {beat}
            </li>
          ))}
        </ol>

        <section className="wzp-section">
          <h5>
            <Icon name="ui-chapters" size={11} /> Chapters
            {brief.chapters.length ? <span>{brief.chapters.length}</span> : null}
          </h5>
          {brief.chapters.length ? (
            <ol className="wzp-chapters">
              {brief.chapters.slice(0, 5).map((ch, i) => (
                <li key={`${i}-${ch}`}>
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  {ch}
                </li>
              ))}
              {brief.chapters.length > 5 ? <li className="wzp-more">+{brief.chapters.length - 5} more</li> : null}
            </ol>
          ) : (
            <p className="wzp-empty">{brief.captureMode === 'guided' ? 'You show the tour; the chapters come from your walk.' : 'Each line under Story becomes a chapter.'}</p>
          )}
        </section>

        <dl className="wzp-facts">
          <div>
            <dt>
              <Icon name="ui-open" size={11} />
            </dt>
            <dd className={host ? undefined : 'is-empty'}>{host || 'No start URL yet'}</dd>
          </div>
          <div>
            <dt>
              <Icon name={brief.captureMode === 'guided' ? 'ui-cursor' : 'ui-walk'} size={11} />
            </dt>
            <dd>
              {brief.captureMode === 'guided' ? 'You show the journey' : 'The agent explores'}
              {brief.loginRequired ? ' · signs in' : ''}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name="ui-mic" size={11} />
            </dt>
            <dd>
              {language}
              {brief.tone ? ` · ${brief.tone}` : ''}
            </dd>
          </div>
          {brief.plates.length ? (
            <div>
              <dt>
                <Icon name="ui-plate" size={11} />
              </dt>
              <dd>
                {brief.plates.length} proof plate{brief.plates.length === 1 ? '' : 's'}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

    </aside>
  );
}
