import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';

import type { Direction } from '@/api/types';
import { useDesk } from '@/desk/store';
import { renderKey } from '@/features/tools-panel/renderKey';
import { Icon } from '@/ui/icons';
import { focusPreview, scalePreview } from '@/ui/look/previews';
import { LookTile, PaneNote, PaneSection, PaneSub, TileGrid } from '@/ui/pane';

import { pickFocus, pickLogo, pickPalette, setScaleColors, uploadLogo } from './actions';
import { rolesOf } from './model';
import { useNativeChange } from './useNativeChange';
import { useDirectionView } from './view';

const quietly = (p: Promise<unknown>) => void p.catch(() => {});

const SCALE_HELP =
  'Ink, surface, accent, secondary and support paint every plate, card and inset frame. Suggestions come from the brand pack, site and logo; editing a colour makes a custom scale for this video only.';
const LOGO_HELP = 'Captured lockups for this brand, or upload a new one. The choice stays on this video; the shared brand pack is unchanged.';
const FOCUS_HELP = 'How viewers are guided through the live interface while the tour plays.';

/** The brand pack this direction starts from: name, type, the five base colours. */
function FoundationCard() {
  const painted = useDirectionView((s) => s.direction != null);
  const foundation = useDesk((s) => s.video?.brandFoundation ?? null);
  const f = painted ? foundation : null;
  return (
    <section className="brand-foundation dir-foundation" aria-label="Brand foundation">
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
        <Icon name="lock" size={11} />
        Foundation
      </span>
    </section>
  );
}

function ScaleTiles({ direction }: { direction: Direction | null }) {
  const roles = rolesOf(direction);
  const scales = direction?.scales || [];
  const custom = direction?.scale === 'custom';
  return (
    <TileGrid label="Five-color scale" id="paletteGrid" cols={2}>
      {scales.map((scale) => {
        const on = scale.id === direction?.scale;
        return (
          <LookTile
            key={scale.id}
            preview={scalePreview(scale.colors, roles)}
            label={scale.label}
            hint={scale.hint || scale.label}
            badge={scale.recommended ? 'Best match' : undefined}
            on={on}
            data={{ 'data-palette': scale.id }}
            onSelect={() => {
              if (!on) quietly(pickPalette(scale.id));
            }}
          />
        );
      })}
      {custom && direction ? (
        <LookTile
          preview={scalePreview(direction.colors, roles)}
          label="Custom"
          hint="Your own five colours for this video"
          badge="This video"
          on
          data={{ 'data-palette-custom': 'custom' }}
        />
      ) : null}
    </TileGrid>
  );
}

/** `#scaleEditor`: one round picker per role. Paints while dragging, saves on the native `change`. */
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
    <div
      ref={ref}
      className="ins-swatches dir-roles"
      id="scaleEditor"
      aria-label="Set the five colors"
      onInput={(e) => {
        const input = e.target as HTMLInputElement;
        const label = input.closest<HTMLElement>('.sw');
        label?.style.setProperty('--sw', input.value);
        const hex = label?.querySelector('small');
        if (hex) hex.textContent = input.value;
      }}
    >
      {direction
        ? rolesOf(direction).map((role) => {
            const value = direction.colors[role.id] || '#000000';
            return (
              <label key={`${key}:${role.id}`} className="sw is-set" style={{ '--sw': value } as CSSProperties}>
                <input type="color" data-role={role.id} defaultValue={value} aria-label={role.label} />
                <i />
                <span>{role.label}</span>
                <small>{value}</small>
              </label>
            );
          })
        : null}
    </div>
  );
}

function ScaleSection() {
  const direction = useDirectionView((s) => s.direction);
  return (
    <PaneSection icon="palette" title="Color scale" help={SCALE_HELP} extra={<span className="dir-chip">Captured</span>}>
      <ScaleTiles direction={direction} />
      <PaneSub label="Fine-tune the five roles">
        <ScaleEditor direction={direction} />
      </PaneSub>
    </PaneSection>
  );
}

function LogoSection() {
  const direction = useDirectionView((s) => s.direction);
  const slug = useDesk((s) => s.slug ?? '');
  const fileRef = useRef<HTMLInputElement>(null);
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    void uploadLogo(file)
      .then(() => setRev(Date.now()))
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const lockups = direction?.lockups || [];
  return (
    <PaneSection icon="logo" title="Logo" help={LOGO_HELP}>
      <TileGrid label="Logo lockup" id="logoGrid">
        {direction
          ? lockups.map((lockup) => {
              const on = lockup.file === direction.logo;
              const src = `/api/video/${encodeURIComponent(slug)}/brand-file/${encodeURIComponent(lockup.file)}${rev ? `?v=${rev}` : ''}`;
              return (
                <LookTile
                  key={lockup.file}
                  preview={
                    <span className="lk-stage lk-logo">
                      {lockup.kind === 'html' ? <span className="logo-fallback">Plate</span> : <img src={src} alt="" />}
                    </span>
                  }
                  label={lockup.label}
                  hint={lockup.kind === 'html' ? `${lockup.label} — an animated plate lockup` : lockup.label}
                  on={on}
                  data={{ 'data-logo': lockup.file }}
                  onSelect={() => {
                    if (!on) quietly(pickLogo(lockup.file));
                  }}
                />
              );
            })
          : null}
        {direction ? (
          <button
            type="button"
            className="lk-tile lk-upload"
            id="logoUploadBtn"
            disabled={busy}
            title="Upload an SVG, PNG, JPEG or WebP for this video"
            onClick={() => fileRef.current?.click()}
          >
            <span className="lk-prev">
              <span className="lk-stage lk-upload-mark" aria-hidden="true">
                {busy ? <i className="lk-spin" /> : <Icon name="upload" size={16} />}
              </span>
            </span>
            <span className="lk-name">{busy ? 'Uploading' : 'Upload'}</span>
          </button>
        ) : null}
      </TileGrid>
      {direction && !lockups.length ? <PaneNote tone="subtle">No captured logo in this brand pack — upload one.</PaneNote> : null}
      <input
        ref={fileRef}
        id="logoUpload"
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp,.svg,.png,.jpg,.jpeg,.webp"
        hidden
        onChange={onFile}
      />
    </PaneSection>
  );
}

const FOCUS_OPTIONS = [
  { id: 'guided', title: 'Guided lens', hint: 'Follows the pointer across related features' },
  { id: 'spotlight', title: 'Spotlight', hint: 'Magnifies key proof without pointer travel' },
  { id: 'ring', title: 'Focus ring', hint: 'Minimal for dense or motion-heavy UI' },
];

function FocusSection() {
  const direction = useDirectionView((s) => s.direction);
  const active = direction ? direction.focus : 'guided';
  return (
    <PaneSection icon="focus" title="Feature focus" help={FOCUS_HELP}>
      <TileGrid label="Feature focus treatment" id="focusGrid">
        {FOCUS_OPTIONS.map((o) => {
          const on = o.id === active;
          return (
            <LookTile
              key={o.id}
              preview={focusPreview(o.id)}
              label={o.title}
              hint={`${o.title} — ${o.hint}`}
              on={on}
              data={{ 'data-focus': o.id }}
              onSelect={() => {
                if (!on) pickFocus(o.id);
              }}
            />
          );
        })}
      </TileGrid>
      <PaneNote tone="subtle">{FOCUS_OPTIONS.find((o) => o.id === active)?.hint}</PaneNote>
    </PaneSection>
  );
}

/** Brand tab: the foundation, the colour scale, the logo and how features are pointed at. */
export function BrandPane() {
  return (
    <>
      <FoundationCard />
      <ScaleSection />
      <LogoSection />
      <FocusSection />
    </>
  );
}
