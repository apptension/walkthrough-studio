import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';

import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';

import {
  agentCandidate,
  brandStudio,
  discoveryProgress,
  discoveryStages,
  effectiveLogo,
  logoUrl,
  paletteView,
  readableOn,
  ROLE_META,
  useBrandStudio,
  type BrandCandidate,
  type DiscoveryStage,
  type PaletteSwatch,
} from './brandStudio';
import { useFontStylesheet } from './fontSheet';
import { PlateStill } from './PlateStill';
import { retry } from './wizard';

const CANDIDATE_LIMIT = 9;
const LIGHT = '#f6f7f9';

const siteHost = (url: string | undefined) => {
  try {
    return url ? new URL(url).host : 'the site';
  } catch {
    return 'the site';
  }
};
const imgIn = (e: SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in');
const imgBroken = (e: SyntheticEvent<HTMLImageElement>) => e.currentTarget.closest('[data-bc-tile]')?.classList.add('is-broken');

function usePalette(): PaletteSwatch[] {
  const draft = useBrandStudio((s) => s.draft);
  const edits = useBrandStudio((s) => s.edits);
  return useMemo(() => paletteView(draft, edits), [draft, edits]);
}

function useStages(): DiscoveryStage[] {
  const signals = useBrandStudio((s) => s.signals);
  const draft = useBrandStudio((s) => s.draft);
  const phase = useBrandStudio((s) => s.phase);
  const message = useBrandStudio((s) => s.message);
  const logoPick = useBrandStudio((s) => s.logoPick);
  return useMemo(() => discoveryStages(signals, draft, phase, { message, logoPick }), [signals, draft, phase, message, logoPick]);
}

const StageList = memo(function StageList({ stages }: { stages: DiscoveryStage[] }) {
  return (
    <ol className="bc-stages" aria-label="Brand discovery stages">
      {stages.map((s, i) => (
        <li key={s.id} data-bc-stage={s.id} className={`is-${s.state}`} style={{ '--i': i } as CSSProperties}>
          <span className="bc-stage-dot" aria-hidden="true">
            {s.state === 'done' ? <Icon name="ui-check" size={10} /> : null}
          </span>
          <div>
            <strong>{s.title}</strong>
            <em>{s.note}</em>
          </div>
          <span className="sr-only">{s.state === 'done' ? 'done' : s.state === 'active' ? 'in progress' : s.state === 'failed' ? 'failed' : 'waiting'}</span>
        </li>
      ))}
    </ol>
  );
});

/** Announces each stage as it completes — one short line, not the whole list. */
function Announcer({ stages }: { stages: DiscoveryStage[] }) {
  const seen = useRef<Set<string> | null>(null);
  const [line, setLine] = useState('');
  useEffect(() => {
    const done = stages.filter((s) => s.state === 'done');
    const failed = stages.find((s) => s.state === 'failed');
    if (seen.current) {
      const fresh = done.filter((s) => !seen.current?.has(s.id));
      if (failed) setLine(`${failed.title} failed: ${failed.note}`);
      else if (fresh.length) setLine(fresh.map((s) => `${s.title} ready`).join('. '));
    }
    seen.current = new Set(done.map((s) => s.id));
  }, [stages]);
  return (
    <p className="sr-only" role="status" aria-live="polite" data-bc-announce="">
      {line}
    </p>
  );
}

function LockupArt({ src, name, font }: { src: string; name: string; font?: string }) {
  return src ? (
    <img key={src} src={src} alt={`${name} lockup`} decoding="async" onLoad={imgIn} />
  ) : (
    <span className="bc-wordmark" style={font ? { fontFamily: `'${font}', system-ui` } : undefined}>
      {name}
    </span>
  );
}

function LockupPreview({ palette }: { palette: PaletteSwatch[] }) {
  const slug = useBrandStudio((s) => s.slug);
  const draft = useBrandStudio((s) => s.draft);
  const pick = useBrandStudio((s) => s.logoPick);
  const logo = effectiveLogo(draft, pick);
  const src = logoUrl(slug, logo, draft);
  const name = draft?.name || 'Your brand';
  const hex = (role: PaletteSwatch['role']) => palette.find((p) => p.role === role)?.hex;
  const tiles = [
    { id: 'ink', label: 'Ink', bg: hex('ink') },
    { id: 'surface', label: 'Surface', bg: hex('surface') },
    { id: 'gold', label: 'Accent', bg: hex('gold') },
    { id: 'light', label: 'Light', bg: LIGHT },
  ];
  return (
    <section className="bc-panel bc-lockup" aria-labelledby="bcLockupTitle">
      <header className="bc-panel-head">
        <h5 id="bcLockupTitle">Lockup on brand backgrounds</h5>
        <span className="bc-panel-meta">{logo === 'logo.html' ? 'Studio lockup' : logo ? logo.replace(/^candidates\//, '') : 'waiting for a mark'}</span>
      </header>
      <div className="bc-lockup-row">
        {tiles.map((t) => (
          <figure key={t.id} className={`bc-lockup-tile${t.bg ? '' : ' is-skeleton'}`} style={t.bg ? { background: t.bg, color: readableOn(t.bg) } : undefined}>
            <LockupArt src={src} name={name} font={draft?.font?.family} />
            <figcaption>{t.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const CandidateTile = memo(function CandidateTile({
  value,
  src,
  label,
  meta,
  badge,
  checked,
}: {
  value: string;
  src: string;
  label: string;
  meta: string;
  badge?: string;
  checked: boolean;
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} data-bc-tile={value} className={`bc-cand${checked ? ' is-picked' : ''}`} onClick={() => brandStudio.pickLogo(value)}>
      <span className="bc-cand-art">
        <span className="bc-cand-light">
          <img src={src} alt="" loading="lazy" decoding="async" onLoad={imgIn} onError={imgBroken} />
        </span>
        <span className="bc-cand-dark">
          <img src={src} alt="" loading="lazy" decoding="async" onLoad={imgIn} />
        </span>
      </span>
      <span className="bc-cand-label">
        <strong>{label}</strong>
        <em>{meta}</em>
      </span>
      {badge ? <span className="bc-cand-badge">{badge}</span> : null}
      <span className="bc-cand-check" aria-hidden="true">
        <Icon name="ui-check" size={10} />
      </span>
    </button>
  );
});

const candidateMeta = (c: BrandCandidate) => [c.kind.replace(/-/g, ' '), c.w && c.h ? `${c.w}×${c.h}` : '', c.file.split('.').pop()?.toUpperCase()].filter(Boolean).join(' · ');

function CandidatePicker() {
  const slug = useBrandStudio((s) => s.slug);
  const draft = useBrandStudio((s) => s.draft);
  const pick = useBrandStudio((s) => s.logoPick);
  const phase = useBrandStudio((s) => s.phase);
  const [all, setAll] = useState(false);
  const selected = effectiveLogo(draft, pick);
  const agentFile = agentCandidate(draft);
  const candidates = draft?.candidates || [];
  const shown = all ? candidates : candidates.slice(0, CANDIDATE_LIMIT);
  const waiting = !draft?.harvested && phase === 'discovering';
  return (
    <section className="bc-panel bc-candidates" aria-labelledby="bcCandTitle">
      <header className="bc-panel-head">
        <h5 id="bcCandTitle">Pick the logo</h5>
        <span className="bc-panel-meta">{candidates.length ? `${candidates.length} found · shown on light and dark` : waiting ? 'harvesting…' : 'none found'}</span>
      </header>
      {waiting && !candidates.length ? (
        <div className="bc-cand-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="bc-cand is-skeleton" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
      ) : (
        <div className="bc-cand-grid" role="radiogroup" aria-labelledby="bcCandTitle">
          {draft?.lockup ? (
            <CandidateTile value="logo.html" src={logoUrl(slug, 'logo.html', draft)} label="Studio lockup" meta="authored by the agent" badge="Recommended" checked={selected === 'logo.html'} />
          ) : null}
          {shown.map((c) => (
            <CandidateTile
              key={c.file}
              value={`candidates/${c.file}`}
              src={logoUrl(slug, `candidates/${c.file}`, draft)}
              label={c.alt || c.file}
              meta={candidateMeta(c)}
              badge={c.file === agentFile ? "Agent's source" : undefined}
              checked={selected === `candidates/${c.file}`}
            />
          ))}
        </div>
      )}
      {candidates.length > CANDIDATE_LIMIT ? (
        <button type="button" className="bc-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${candidates.length}`}
        </button>
      ) : null}
    </section>
  );
}

function PaletteEditor({ palette }: { palette: PaletteSwatch[] }) {
  const hints = useBrandStudio((s) => s.draft?.hints);
  const focusRole = useBrandStudio((s) => s.focusRole);
  const site = useBrandStudio((s) => s.draft?.site?.url);
  const authored = palette.filter((p) => p.hex).length;
  return (
    <section className="bc-panel bc-palette" aria-labelledby="bcPaletteTitle">
      <header className="bc-panel-head">
        <h5 id="bcPaletteTitle">Palette</h5>
        <span className="bc-panel-meta">{authored === 5 ? 'click a swatch to tweak' : `${authored} of 5 roles`}</span>
      </header>
      <div className="bc-swatches">
        {palette.map((p, i) => (
          <div key={p.role} className={`bc-swatch${p.hex ? '' : ' is-skeleton'}${focusRole === p.role ? ' is-focus' : ''}`} style={{ '--i': i } as CSSProperties}>
            <label className="bc-swatch-chip" style={p.hex ? { background: p.hex, color: readableOn(p.hex) } : undefined}>
              <input
                type="color"
                aria-label={`${ROLE_META[p.role].label} colour`}
                value={p.hex || '#000000'}
                onFocus={() => brandStudio.focus(p.role)}
                onChange={(e) => brandStudio.setColor(p.role, e.target.value)}
              />
              <span aria-hidden="true">{p.source === 'edit' ? 'edited' : ''}</span>
            </label>
            <span className="bc-swatch-text">
              <strong>{ROLE_META[p.role].label}</strong>
              <code>{p.hex || '#······'}</code>
              <em>{ROLE_META[p.role].hint}</em>
            </span>
            {p.source === 'edit' ? (
              <button type="button" className="bc-swatch-reset" aria-label={`Reset ${ROLE_META[p.role].label}`} onClick={() => brandStudio.resetColor(p.role)}>
                <Icon name="ui-x" size={9} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {hints?.length ? (
        <div className="bc-hints">
          <span>
            Seen on {siteHost(site)} — use for <b>{ROLE_META[focusRole].label}</b>
          </span>
          {hints.map((h) => (
            <button key={h} type="button" className="bc-hint" style={{ background: h }} aria-label={`Use ${h} for ${ROLE_META[focusRole].label}`} title={h} onClick={() => brandStudio.setColor(focusRole, h)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TypeSpecimen({ accent }: { accent: string | null }) {
  const font = useBrandStudio((s) => s.draft?.font);
  const headline = useBrandStudio((s) => s.draft?.site?.headline || s.signals.headline);
  const brief = useBrandStudio((s) => s.draft?.motionBrief);
  useFontStylesheet(font?.css);
  const family = font ? `'${font.family}', system-ui, sans-serif` : undefined;
  return (
    <section className="bc-panel bc-type" aria-labelledby="bcTypeTitle">
      <header className="bc-panel-head">
        <h5 id="bcTypeTitle">Type & motion</h5>
        <span className="bc-panel-meta">{font?.family || 'matching…'}</span>
      </header>
      {font ? (
        <div className="bc-specimen" style={{ fontFamily: family }}>
          <b style={accent ? { color: accent } : undefined}>Aa</b>
          <p>{headline || 'The quick brown fox jumps over the lazy dog'}</p>
        </div>
      ) : (
        <div className="bc-specimen is-skeleton" aria-hidden="true">
          <b />
          <p />
        </div>
      )}
      {brief ? (
        <p className="bc-brief">
          <strong>{brief.title}</strong> {brief.excerpt}
        </p>
      ) : (
        <p className="bc-brief is-skeleton" aria-hidden="true" />
      )}
    </section>
  );
}

function PlatePreview() {
  const brand = useBrandStudio((s) => s.draft?.brand);
  const ready = useBrandStudio((s) => s.draft?.ready && s.phase === 'ready');
  const rev = useBrandStudio((s) => (s.draft ? `${s.draft.lockup?.rev ?? 0}-${Object.values(s.draft.colors).join('')}` : ''));
  if (!ready || !brand) return null;
  return (
    <figure className="bc-plate">
      <PlateStill type="statement" brand={brand} rev={rev} />
      <figcaption>A plate in your brand</figcaption>
    </figure>
  );
}

function BrandSummary({ palette }: { palette: PaletteSwatch[] }) {
  const slug = useBrandStudio((s) => s.slug);
  const draft = useBrandStudio((s) => s.draft);
  const pick = useBrandStudio((s) => s.logoPick);
  useFontStylesheet(draft?.font?.css);
  const ink = palette.find((p) => p.role === 'ink')?.hex || '#111';
  return (
    <div className="bc-summary">
      <span className="bc-summary-lockup" style={{ background: ink, color: readableOn(ink) }}>
        <LockupArt src={logoUrl(slug, effectiveLogo(draft, pick), draft)} name={draft?.name || ''} font={draft?.font?.family} />
      </span>
      <span className="bc-summary-swatches" aria-label="Palette">
        {palette.map((p) => (p.hex ? <i key={p.role} style={{ background: p.hex }} title={`${ROLE_META[p.role].label} ${p.hex}`} /> : null))}
      </span>
      {draft?.font ? (
        <span className="bc-summary-font" style={{ fontFamily: `'${draft.font.family}', system-ui` }}>
          {draft.font.family}
        </span>
      ) : null}
      <PlatePreview />
    </div>
  );
}

/** `#wizardBrandCreator` — the interactive brand foundation while discovery runs, then its ready summary. */
export function BrandCreator() {
  const slug = useBrandStudio((s) => s.slug);
  const phase = useBrandStudio((s) => s.phase);
  const name = useBrandStudio((s) => s.draft?.name);
  const expanded = useBrandStudio((s) => s.expanded);
  const saving = useBrandStudio((s) => s.saving);
  const saveError = useBrandStudio((s) => s.saveError);
  const message = useBrandStudio((s) => s.message);
  const stages = useStages();
  const palette = usePalette();
  if (!slug) return null;
  const progress = discoveryProgress(stages);
  const done = stages.filter((s) => s.state === 'done').length;
  const compact = phase === 'ready' && !expanded;
  const accent = palette.find((p) => p.role === 'gold')?.hex || null;
  const title =
    phase === 'ready' ? `${name || 'Brand'} brand ready` : phase === 'failed' ? 'Brand discovery stopped' : `Building the ${name || 'new'} brand`;
  const sub =
    phase === 'ready'
      ? 'Every pick is saved into the brand pack. Adjust any time — plates repaint from it.'
      : phase === 'failed'
        ? 'What was found is kept below. Retry runs discovery again.'
        : 'Pick the logo and tweak colours while discovery continues — your choices are kept.';
  return (
    <section id="wizardBrandCreator" className={`brand-creator is-${phase}${compact ? ' is-compact' : ''}`} aria-labelledby="bcTitle" style={accent ? ({ '--bc-accent': accent } as CSSProperties) : undefined}>
      <header className="bc-head">
        <span className="bc-mark" aria-hidden="true">
          <Icon name={phase === 'ready' ? 'ui-check' : phase === 'failed' ? 'ui-x' : 'ui-palette'} size={14} />
        </span>
        <div className="bc-titles">
          <h4 id="bcTitle">{title}</h4>
          <p>{sub}</p>
        </div>
        <span className="bc-status" aria-hidden={!saving && !saveError}>
          {saveError ? <span className="bc-save-error">{saveError}</span> : saving ? 'Saving…' : `${done} of ${stages.length}`}
        </span>
        {phase === 'ready' ? (
          <button type="button" className="btn ghost bc-toggle" aria-expanded={expanded} aria-controls="bcBody" onClick={() => brandStudio.toggleExpanded()}>
            {expanded ? 'Done' : 'Adjust'}
          </button>
        ) : null}
      </header>
      <div
        className="bc-meter"
        role="progressbar"
        aria-label="Brand discovery"
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${stages.length} stages done`}
      >
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
      <Announcer stages={stages} />
      {compact ? (
        <BrandSummary palette={palette} />
      ) : (
        <div id="bcBody" className="bc-body">
          <StageList stages={stages} />
          <div className="bc-canvas">
            <LockupPreview palette={palette} />
            <CandidatePicker />
            <PaletteEditor palette={palette} />
            <TypeSpecimen accent={accent} />
            {phase === 'ready' ? <PlatePreview /> : null}
          </div>
        </div>
      )}
      {phase === 'failed' ? (
        <div className="bc-failed" role="alert">
          <p>{message || 'Brand discovery stopped.'}</p>
          <NeonButton className="btn primary" onClick={retry}>
            Retry discovery
          </NeonButton>
        </div>
      ) : null}
    </section>
  );
}
