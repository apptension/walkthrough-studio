import { Fragment, useRef, type CSSProperties, type MouseEvent } from 'react';

import type { Direction } from '@/api/types';
import { useDesk } from '@/desk/store';
import { renderKey } from '@/features/tools-panel/renderKey';
import { Icon, SecIcon } from '@/ui/icons';

import { pickFocus, pickLogo, pickPalette, setScaleColors } from './actions';
import { useNativeChange } from './useNativeChange';
import { useDirectionView } from './view';

const DEFAULT_ROLES = [
  { id: 'ink', label: 'Ink' },
  { id: 'surface', label: 'Surface' },
  { id: 'gold', label: 'Accent' },
  { id: 'amber', label: 'Secondary' },
  { id: 'teal', label: 'Support' },
];

const quietly = (p: Promise<unknown>) => void p.catch(() => {});

const roles = (direction: Direction) => direction.roles || DEFAULT_ROLES;

export function DirectionHead() {
  const direction = useDirectionView((s) => s.direction);
  return (
    <div className="direction-head panel-head">
      <span className="panel-head-ico" aria-hidden="true">
        <Icon name="ui-palette-sec" size={18} />
      </span>
      <div>
        <span className="direction-kicker">Visual direction</span>
        <p className="panel-lede">Set once per video · suggestions come from the brand pack</p>
      </div>
      <span
        id="directionStatus"
        className="review-pill"
        data-tone={direction ? (direction.approvedAt ? 'ok' : 'warn') : undefined}
      >
        {direction?.approvedAt ? 'Approved' : 'Needs approval'}
      </span>
    </div>
  );
}

export function BrandFoundation() {
  const painted = useDirectionView((s) => s.direction != null);
  const foundation = useDesk((s) => s.video?.brandFoundation ?? null);
  const f = painted ? foundation : null;
  return (
    <section className="brand-foundation" aria-label="Brand foundation">
      <span
        id="directionBrandAccent"
        className="brand-accent"
        aria-hidden="true"
        style={f ? ({ '--brand-accent': f.accent } as CSSProperties) : undefined}
      />
      <div>
        <strong id="directionBrandName">{f ? f.name : 'Brand pack'}</strong>{' '}
        <span id="directionBrandMeta">{f ? `${f.font} · base colors · logo chosen below` : 'Official logo · type · base colors'}</span>
      </div>
      <span
        className="foundation-lock"
        title="Type and the official five colors come from the brand pack. This video can choose another scale or logo."
      >
        Foundation
      </span>
    </section>
  );
}

function PaletteGrid({ direction }: { direction: Direction | null }) {
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-palette]');
    if (btn?.dataset.palette) quietly(pickPalette(btn.dataset.palette));
  };
  return (
    <div className="scale-list" id="paletteGrid" role="radiogroup" aria-label="Five-color scale" onClick={onClick}>
      {direction
        ? (direction.scales || []).map((scale) => {
            const on = scale.id === direction.scale;
            return (
              <button
                key={scale.id}
                type="button"
                className={on ? 'scale-option active' : 'scale-option'}
                data-palette={scale.id}
                role="radio"
                aria-checked={on ? 'true' : 'false'}
              >
                <span className="scale-copy">
                  <strong>{scale.label}</strong>
                  {scale.recommended ? <em>Best match</em> : null}
                  <span>{scale.hint || ''}</span>
                </span>{' '}
                <span className="scale-swatches">
                  {roles(direction).map((role) => (
                    <i key={role.id} style={{ '--swatch': scale.colors[role.id] } as CSSProperties} title={role.label} />
                  ))}
                </span>
              </button>
            );
          })
        : null}
    </div>
  );
}

/** `#scaleEditor`: rebuilt on every `renderDirection`, saved on the pickers' `change`. */
function ScaleEditor({ direction }: { direction: Direction | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useNativeChange(ref, (e) => {
    const input = (e.target as Element).closest<HTMLInputElement>('input[data-role]');
    const host = ref.current;
    if (!input || !host) return;
    const colors: Record<string, string> = {};
    host.querySelectorAll<HTMLInputElement>('input[data-role]').forEach((el) => {
      colors[el.dataset.role ?? ''] = el.value;
    });
    quietly(setScaleColors(colors));
  });
  const key = direction ? renderKey(direction) : 0;
  return (
    <div ref={ref} className="scale-editor" id="scaleEditor" aria-label="Set the five colors">
      {direction
        ? roles(direction).map((role) => (
            <label key={`${key}:${role.id}`}>
              <span>{role.label}</span>
              <input type="color" data-role={role.id} defaultValue={direction.colors[role.id]} aria-label={role.label} />
            </label>
          ))
        : null}
    </div>
  );
}

export function ColorScaleSection() {
  const direction = useDirectionView((s) => s.direction);
  return (
    <section className="direction-section">
      <div className="direction-section-head">
        <div>
          <strong data-ico="palette">
            <SecIcon name="palette" />
            Color scale
          </strong>
          <span>Ink, surface, accent, secondary and support. Suggestions come from the brand pack, site and logo.</span>
        </div>
        <span className="recommend-chip">Captured</span>
      </div>
      <PaletteGrid direction={direction} />
      <ScaleEditor direction={direction} />
    </section>
  );
}

export function LogoSection() {
  const direction = useDirectionView((s) => s.direction);
  const slug = useDesk((s) => s.slug ?? '');
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-logo]');
    if (btn?.dataset.logo) quietly(pickLogo(btn.dataset.logo));
  };
  const lockups = direction?.lockups || [];
  return (
    <section className="direction-section">
      <div className="direction-section-head">
        <div>
          <strong data-ico="logo">
            <SecIcon name="logo" />
            Logo
          </strong>
          <span>Captured lockups for this brand. The choice stays on this video.</span>
        </div>
      </div>
      <div className="logo-picks" id="logoGrid" role="radiogroup" aria-label="Logo lockup" onClick={onClick}>
        {direction ? (
          lockups.length ? (
            lockups.map((lockup) => {
              const on = lockup.file === direction.logo;
              const src = `/api/video/${encodeURIComponent(slug)}/brand-file/${encodeURIComponent(lockup.file)}`;
              return (
                <button
                  key={lockup.file}
                  type="button"
                  className={on ? 'logo-option active' : 'logo-option'}
                  data-logo={lockup.file}
                  role="radio"
                  aria-checked={on ? 'true' : 'false'}
                >
                  {lockup.kind === 'html' ? <span className="logo-fallback">Plate</span> : <img src={src} alt="" />}
                  <strong>{lockup.label}</strong>
                </button>
              );
            })
          ) : (
            <p className="meta">No captured logo in this brand pack.</p>
          )
        ) : null}
      </div>
    </section>
  );
}

const FOCUS_OPTIONS = [
  { id: 'guided', title: 'Guided lens', hint: 'Follows the pointer across related features' },
  { id: 'spotlight', title: 'Spotlight', hint: 'Magnifies key proof without pointer travel' },
  { id: 'ring', title: 'Focus ring', hint: 'Minimal for dense or motion-heavy UI' },
];

export function FocusSection() {
  const direction = useDirectionView((s) => s.direction);
  const active = direction ? direction.focus : 'guided';
  return (
    <section className="direction-section">
      <div className="direction-section-head">
        <div>
          <strong data-ico="focus">
            <SecIcon name="focus" />
            Feature focus
          </strong>
          <span>How viewers are guided through the live interface.</span>
        </div>
      </div>
      <div className="focus-options" id="focusGrid" role="radiogroup" aria-label="Feature focus treatment">
        {FOCUS_OPTIONS.map((o, i) => {
          const on = o.id === active;
          return (
            <Fragment key={o.id}>
              {i > 0 ? ' ' : null}
              <button
                type="button"
                className={on ? 'focus-option active' : 'focus-option'}
                data-focus={o.id}
                role="radio"
                aria-checked={direction ? (on ? 'true' : 'false') : on ? 'true' : undefined}
                onClick={() => pickFocus(o.id)}
              >
                <span
                  className={`focus-glyph ${o.id}`}
                  aria-hidden="true"
                  data-icon={`focus-${o.id}`}
                  data-width="44"
                  data-height="34"
                >
                  <Icon name={`focus-${o.id}`} width={44} height={34} />
                </span>{' '}
                <span>
                  <strong>{o.title}</strong>
                  <em>{o.hint}</em>
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
