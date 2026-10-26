import { useState, type CSSProperties } from 'react';

import { Icon } from '@/ui/icons';

import { captureBrief, useBriefLive } from './briefSignals';
import { useWizard, type BrandPack } from './wizard';

const SWATCHES = ['ink', 'surface', 'gold', 'amber', 'text'] as const;

function choose(name: string, value: string): void {
  const form = document.getElementById('projectForm');
  if (!(form instanceof HTMLFormElement)) return;
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLSelectElement) el.value = value;
  else {
    const radio = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${CSS.escape(value)}"]`);
    if (radio) radio.checked = true;
  }
  form.dispatchEvent(new Event('change', { bubbles: true }));
  captureBrief();
}

function BrandTile({ pack, selected }: { pack: BrandPack; selected: boolean }) {
  const [broken, setBroken] = useState(false);
  const [mark, setMark] = useState(false);
  const c = pack.colors;
  const style = {
    '--bt-bg': c.ink || c.surface || '#101210',
    '--bt-a': pack.accent || c.gold || 'var(--accent)',
    '--bt-fg': c.text || '#f4f6f3',
  } as CSSProperties;
  return (
    <button type="button" className={`wz-brand${selected ? ' is-selected' : ''}`} style={style} aria-pressed={selected} onClick={() => choose('brandId', pack.id)}>
      <span className={`wz-brand-face${mark ? ' is-mark' : ''}`}>
        {broken ? null : (
          <img
            src={`/api/brands/${encodeURIComponent(pack.id)}/lockup`}
            alt=""
            loading="lazy"
            onLoad={(e) => setMark(e.currentTarget.naturalWidth < e.currentTarget.naturalHeight * 1.8)}
            onError={() => setBroken(true)}
          />
        )}
        {broken || mark ? <b style={pack.font ? { fontFamily: `'${pack.font}', system-ui` } : undefined}>{pack.name}</b> : null}
        {selected ? (
          <span className="wz-brand-check" aria-hidden="true">
            <Icon name="ui-check" size={10} />
          </span>
        ) : null}
      </span>
      <span className="wz-brand-meta">
        <strong>{pack.name}</strong>
        <span className="wz-brand-swatches" aria-hidden="true">
          {SWATCHES.map((k) => (c[k] ? <i key={k} style={{ background: c[k] || undefined }} /> : null))}
        </span>
        <em>{pack.placeholder ? 'Placeholder pack' : pack.font || 'Ready'}</em>
      </span>
    </button>
  );
}

/** Visual brand-pack tiles over the `brandId` select, which stays the form's source of truth. */
export function BrandPicker() {
  const packs = useWizard((s) => s.brandPacks);
  const brandId = useBriefLive((s) => s.brief.brandId);
  if (!packs.length) {
    return (
      <div className="wz-brand-empty">
        <Icon name="ui-palette" size={16} />
        <div>
          <strong>No brand packs yet</strong>
          <em>Discovery harvests the logo, colours and type from the product's website.</em>
        </div>
        <button type="button" className="btn ghost" onClick={() => choose('brandMode', 'new')}>
          Discover a brand
        </button>
      </div>
    );
  }
  return (
    <div className="wz-brands" role="group" aria-label="Brand packs">
      {packs.map((p) => (
        <BrandTile key={p.id} pack={p} selected={p.id === brandId} />
      ))}
      <button type="button" className="wz-brand wz-brand-new" onClick={() => choose('brandMode', 'new')}>
        <span className="wz-brand-face">
          <Icon name="ui-plus" size={16} />
        </span>
        <span className="wz-brand-meta">
          <strong>New brand</strong>
          <em>Discover from a website</em>
        </span>
      </button>
    </div>
  );
}
