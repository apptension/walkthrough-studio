import { memo, useMemo, useState, type CSSProperties, type SyntheticEvent } from 'react';

import type { ExploreScreen } from '@/api/types';
import { Icon } from '@/ui/icons';

import { readableOn } from './brandStudio';
import { useCreation, type BrandIdentity } from './creation';
import { creationFeed, screenFor, useCreationFeed, type AgentAction, type StoryCard } from './creationFeed';
import { useCountUp, useTypewriter } from './creationMotion';
import { PlateStill, VideoPlateStill } from './PlateStill';

const imgIn = (e: SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in');
const hostPath = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
};

const NO_SCREENS: ExploreScreen[] = [];
const ROLE_LABEL: Record<string, string> = { ink: 'Ink', surface: 'Surface', gold: 'Accent', amber: 'Accent 2', teal: 'Support', text: 'Text' };
const PALETTE_ROLES = ['ink', 'surface', 'gold', 'amber', 'teal', 'text'];

export function Lockup({ identity, className = '' }: { identity: BrandIdentity | null; className?: string }) {
  const [broken, setBroken] = useState('');
  const src = identity?.logo || '';
  const name = identity?.name || 'Your brand';
  return src && broken !== src ? (
    <img key={src} className={`ct-lockup ${className}`} src={src} alt={`${name} lockup`} decoding="async" onLoad={imgIn} onError={() => setBroken(src)} />
  ) : (
    <span className={`ct-lockup ct-wordmark ${className}`} style={identity?.font ? { fontFamily: `'${identity.font}', system-ui` } : undefined}>
      {name}
    </span>
  );
}

/* ---------- agent voice ---------- */

export function ThoughtCaption({ thought, label = 'Agent' }: { thought: string; label?: string }) {
  const typed = useTypewriter(thought);
  if (!thought) return null;
  return (
    <p className="ct-thought" data-ct-thought="">
      <span className="ct-thought-who" aria-hidden="true">
        <i />
        {label}
      </span>
      <span className="ct-thought-text" aria-label={thought}>
        <span aria-hidden="true">{typed}</span>
        <span className="ct-caret" aria-hidden="true" />
      </span>
    </p>
  );
}

export const ActivityFeed = memo(function ActivityFeed({ actions, live }: { actions: AgentAction[]; live: boolean }) {
  return (
    <section className="ct-panel ct-activity" aria-label="What the agent is doing">
      <header className="ct-panel-head">
        <h5>Agent activity</h5>
        {live ? (
          <span className="ct-live" aria-hidden="true">
            <i />
            live
          </span>
        ) : null}
      </header>
      {actions.length ? (
        <ol>
          {actions.map((a, i) => {
            const running = i === 0 && live && !a.done;
            return (
              <li key={a.id} className={running ? 'is-running' : undefined}>
                <span className="ct-act-ico">{running ? <span className="activity-spinner" /> : <Icon name={a.icon} size={12} />}</span>
                <span className="ct-act-text">
                  <b>{a.verb}</b> {a.object}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="ct-empty">
          {live ? <span className="activity-spinner" /> : null}
          {live ? 'Warming up. The first moves appear here.' : 'No agent activity yet.'}
        </p>
      )}
    </section>
  );
});

/* ---------- brand ---------- */

export function BrandReveal({ title }: { title: string }) {
  const identity = useCreation((s) => s.identity);
  const detail = useCreation((s) => s.detail);
  const colors = identity?.colors || {};
  const swatches = PALETTE_ROLES.filter((r) => colors[r]);
  const font = identity?.font ? `'${identity.font}', system-ui` : undefined;
  return (
    <div className={`ct-scene ct-brand${identity ? ' is-set' : ''}`}>
      <div className="ct-brand-stage">
        <div className="ct-brand-glow" aria-hidden="true" />
        <div className="ct-brand-lockup">{identity ? <Lockup identity={identity} /> : <span className="ct-skel ct-skel-lockup" />}</div>
        <p className="ct-brand-title" style={font ? { fontFamily: font } : undefined}>
          {identity ? title || identity.name : detail}
        </p>
      </div>
      <div className="ct-brand-meta">
        <ol className="ct-palette" aria-label="Brand palette">
          {(swatches.length ? swatches : ['', '', '', '', '']).map((role, i) => (
            <li key={role || i} style={{ '--i': i } as CSSProperties} className={role ? '' : 'is-skeleton'}>
              <span className="ct-chip" style={role ? { background: colors[role], color: readableOn(colors[role] || '#000') } : undefined}>
                {role ? colors[role] : ''}
              </span>
              <em>{role ? ROLE_LABEL[role] || role : ''}</em>
            </li>
          ))}
        </ol>
        <div className="ct-specimen" style={font ? { fontFamily: font } : undefined}>
          <b>Aa</b>
          <span>
            <strong>{identity?.font || 'Typeface'}</strong>
            <em>The quick brown fox · 0123456789</em>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- product scout ---------- */

function Radar({ thought }: { thought: string }) {
  return (
    <div className="ct-radar" aria-hidden="true">
      <span className="ct-radar-ring" />
      <span className="ct-radar-ring" />
      <span className="ct-radar-ring" />
      <span className="ct-radar-sweep" />
      <span className="ct-radar-core">
        <Icon name="ui-open" size={18} />
      </span>
      <p>{thought ? 'Opening the product…' : 'Starting a browser for the explore agent…'}</p>
    </div>
  );
}

const Filmstrip = memo(function Filmstrip({ screens, focus, current, live }: { screens: ExploreScreen[]; focus: string; current: string | null; live: boolean }) {
  return (
    <ol className="ct-film" aria-label="Screens reached">
      {screens.map((s, i) => (
        <li key={s.id} style={{ '--i': i } as CSSProperties}>
          <button
            type="button"
            className={`ct-film-item${s.id === focus ? ' is-focus' : ''}${live && s.id === current ? ' is-current' : ''}`}
            aria-pressed={s.id === focus}
            onClick={() => creationFeed.pin(s.id)}
            title={s.title || s.label}
          >
            <span className="ct-film-shot">{s.shot ? <img src={s.shot} alt="" loading="lazy" decoding="async" onLoad={imgIn} /> : null}</span>
            <span className="ct-film-label">
              <b>{s.id}</b>
              {s.label}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
});

export function ScoutView({ thought, live, preview }: { thought: string; live: boolean; preview?: boolean }) {
  const explore = useCreationFeed((s) => s.explore);
  const pinned = useCreationFeed((s) => s.pinned);
  const screens = explore?.screens || [];
  const current = explore?.current || screens.at(-1)?.id || null;
  const focusId = (pinned && screens.some((s) => s.id === pinned) ? pinned : current) || '';
  const focus = screens.find((s) => s.id === focusId) || null;
  const note = [...(explore?.notes || [])].reverse().find((n) => n.screen === focusId)?.text || '';
  const moves = useCountUp(explore?.moves.length || 0);
  const count = useCountUp(screens.length);
  const notes = useCountUp(explore?.notes.length || 0);
  const frame = (preview && explore?.preview) || focus?.shot || explore?.preview || '';
  return (
    <div className="ct-scene ct-scout">
      <figure className={`ct-browser${live && !pinned ? ' is-live' : ''}`}>
        <div className="ct-browser-bar">
          <span className="ct-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="ct-url">
            <Icon name={explore?.signedIn ? 'ui-lock' : 'ui-search'} size={10} />
            {focus ? hostPath(focus.url) || focus.path : 'about:blank'}
          </span>
          {pinned ? (
            <button type="button" className="ct-follow" onClick={() => creationFeed.pin(null)}>
              Follow live
            </button>
          ) : null}
        </div>
        <div className="ct-browser-view">
          {frame ? <img key={frame} className="ct-shot" src={frame} alt={focus ? `Screen ${focus.id}: ${focus.label}` : 'Live product view'} decoding="async" onLoad={imgIn} /> : <Radar thought={thought} />}
          {frame && live && !pinned ? <span className="ct-scan" aria-hidden="true" /> : null}
          {focus ? (
            <figcaption className="ct-shot-cap" key={focus.id}>
              <b>{focus.id}</b>
              <span>
                <strong>{focus.label}</strong>
                {focus.reachedBy?.label ? <em>via “{focus.reachedBy.label}”</em> : focus.heading ? <em>{focus.heading}</em> : null}
              </span>
            </figcaption>
          ) : null}
          {note ? (
            <aside className="ct-note" key={note}>
              <Icon name="ui-note" size={11} />
              <span>{note}</span>
            </aside>
          ) : null}
        </div>
      </figure>
      <div className="ct-scout-foot">
        <dl className="ct-stats">
          <div>
            <dt>Screens</dt>
            <dd>{count}</dd>
          </div>
          <div>
            <dt>Moves</dt>
            <dd>{moves}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{notes}</dd>
          </div>
        </dl>
        {screens.length ? <Filmstrip screens={screens} focus={focusId} current={current} live={live} /> : <p className="ct-empty">Each screen the agent reaches lands here.</p>}
      </div>
    </div>
  );
}

/* ---------- storyboard ---------- */

const KIND_TAG: Record<StoryCard['kind'], string> = { open: 'Opener', chapter: 'Chapter', plate: 'Plate', close: 'Closer' };

/** A card is a plate the project itself builds — so its still can be the real frame. */
const videoPlateId = (card: StoryCard) => (card.kind === 'open' || card.kind === 'close' ? card.kind : card.kind === 'plate' ? card.key.replace(/^plate:/, '') : '');

const StoryCardView = memo(function StoryCardView({
  card,
  screen,
  brand,
  slug,
  index,
}: {
  card: StoryCard;
  screen?: ExploreScreen;
  brand: string;
  slug: string;
  index: number;
}) {
  const plateId = videoPlateId(card);
  return (
    <li className={`ct-card is-${card.kind}`} style={{ '--i': index } as CSSProperties}>
      <div className="ct-card-art">
        {card.kind === 'chapter' ? (
          screen?.shot ? (
            <img src={screen.shot} alt="" loading="lazy" decoding="async" onLoad={imgIn} />
          ) : (
            <span className="ct-card-num">{card.n}</span>
          )
        ) : plateId && slug ? (
          // Re-fetched whenever the copy changes, so the board keeps up with the rewrite.
          <VideoPlateStill slug={slug} plateId={plateId} rev={`${card.title}|${card.eyebrow}|${card.line}`} />
        ) : card.kind === 'plate' && card.plateType && brand ? (
          <PlateStill type={card.plateType} brand={brand} />
        ) : (
          <span className="ct-card-title-art">{card.title}</span>
        )}
        <span className="ct-card-tag">{card.kind === 'chapter' ? `${KIND_TAG.chapter} ${card.n}` : card.kind === 'plate' ? card.plateType.replace(/-/g, ' ') || KIND_TAG.plate : KIND_TAG[card.kind]}</span>
      </div>
      <div className="ct-card-body">
        <strong>{card.title}</strong>
        {card.line ? <em>{card.line}</em> : null}
        {card.beats ? <small>{card.beats === 1 ? '1 beat' : `${card.beats} beats`}</small> : null}
      </div>
    </li>
  );
});

/**
 * The scenes not written yet. They carry the screens exploration already captured, so the board
 * reads as the moments being written up rather than as a row of empty boxes.
 */
function GhostCards({ n, shots }: { n: number; shots: readonly ExploreScreen[] }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const shot = shots[i]?.shot;
        return (
          <li key={`ghost${i}`} className="ct-card is-ghost" aria-hidden="true" style={{ '--i': i } as CSSProperties}>
            <div className="ct-card-art">{shot ? <img src={shot} alt="" loading="lazy" decoding="async" onLoad={imgIn} /> : null}</div>
            <div className="ct-card-body">
              <span className="ct-skel" />
              <span className="ct-skel is-short" />
            </div>
          </li>
        );
      })}
    </>
  );
}

export function StoryStats() {
  const totals = useCreationFeed((s) => s.totals);
  const chapters = useCountUp(totals.chapters);
  const plates = useCountUp(totals.plates);
  const words = useCountUp(totals.words);
  const sec = useCountUp(totals.estSec);
  return (
    <dl className="ct-stats">
      <div>
        <dt>Chapters</dt>
        <dd>{chapters}</dd>
      </div>
      <div>
        <dt>Plates</dt>
        <dd>{plates}</dd>
      </div>
      <div>
        <dt>Words</dt>
        <dd>{words}</dd>
      </div>
      {sec ? (
        <div>
          <dt>Length</dt>
          <dd>
            {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function Storyboard({ live, id }: { live: boolean; id?: string }) {
  const story = useCreationFeed((s) => s.story);
  const screens = useCreationFeed((s) => s.explore?.screens);
  const brand = useCreationFeed((s) => s.brandId);
  const slug = useCreationFeed((s) => s.slug);
  const shots = useMemo(() => screenFor(story, screens || NO_SCREENS), [story, screens]);
  // Screens exploration found that no written card has claimed yet.
  const ghostShots = useMemo(() => {
    const taken = new Set([...shots.values()].map((s) => s.shot));
    return (screens || NO_SCREENS).filter((s) => s.shot && !taken.has(s.shot));
  }, [shots, screens]);
  return (
    <ol id={id} className={`ct-board${live ? ' is-live' : ''}`} aria-label="Storyboard">
      {story.map((c, i) => (
        <StoryCardView key={c.key} card={c} screen={shots.get(c.key)} brand={brand} slug={slug} index={i} />
      ))}
      {live ? <GhostCards n={story.length ? 1 : 4} shots={ghostShots} /> : null}
    </ol>
  );
}

export function StoryView() {
  const story = useCreationFeed((s) => s.story);
  const explored = useCreationFeed((s) => s.explore?.screens);
  const screens = explored || NO_SCREENS;
  const material = screens.filter((s) => s.shot).slice(0, 5);
  return (
    <div className="ct-scene ct-story">
      <header className="ct-story-head">
        <div>
          <h5>{story.length ? 'The story is taking shape' : 'Choosing the moments'}</h5>
          <p>
            {story.length
              ? 'Scenes appear as the agent writes them — openers, chapters, plates and the closer.'
              : material.length
                ? `Picking the strongest moments from ${screens.length} explored screen${screens.length === 1 ? '' : 's'}.`
                : 'The agent is reading the brief and planning the scenes.'}
          </p>
        </div>
        <StoryStats />
      </header>
      {!story.length && material.length ? (
        <ol className="ct-material" aria-label="Explored screens">
          {material.map((s, i) => (
            <li key={s.id} style={{ '--i': i } as CSSProperties}>
              <img src={s.shot || ''} alt="" loading="lazy" decoding="async" onLoad={imgIn} />
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <Storyboard live />
    </div>
  );
}
