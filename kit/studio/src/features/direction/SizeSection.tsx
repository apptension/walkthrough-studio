import type { CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Icon } from '@/ui/icons';
import { devicePreview, shapePreview } from '@/ui/look/previews';
import { LookTile, PaneSection, PaneSub, TileGrid } from '@/ui/pane';
import { pickerOptions, shapeHint, stageBox, stageText, takeNote } from '@/logic/captureSize';

import { pickShape, pickSize, saveCaptureSize, submitCustomSize } from './actions';
import { directionView, useDirectionView, type CaptureSettings, type SizeForm } from './view';

const SIZE_HELP =
  'The browser size and device the product is recorded at — viewers see this layout. Pick a phone to record the mobile view. The size sets the layout (CSS px); density sets sharpness. A take keeps the size it was recorded at, so changing it asks for a new take. Guided tours open at this size too.';
const SHAPE_HELP = 'The finished video: landscape 16:9 or vertical 9:16. The recording sits inside it as a window when the proportions differ.';

function SizeOptions({ settings, customOpen }: { settings: CaptureSettings | null; customOpen: boolean }) {
  const rows = settings ? pickerOptions(settings) : [];
  return (
    <TileGrid label="Recording size" id="sizeOptions">
      {settings ? (
        <>
          {rows.map((o, i) => {
            const on = o.selected && !customOpen;
            return (
              <LookTile
                key={`${o.id}:${i}`}
                className="dir-size"
                preview={devicePreview(o.width ?? 16, o.height ?? 9, Boolean(o.mobile))}
                label={o.title}
                detail={o.line}
                hint={o.reason || o.label}
                badge={o.suggested ? 'Suggested' : undefined}
                on={on}
                data={{ 'data-size': o.id, 'data-w': o.width, 'data-h': o.height, 'data-dpr': o.dpr }}
                onSelect={() => {
                  if (!on) pickSize({ size: o.id ?? '', w: Number(o.width), h: Number(o.height), dpr: Number(o.dpr) });
                }}
              />
            );
          })}
          <LookTile
            className="dir-size"
            preview={
              <span className="lk-stage lk-custom-size" aria-hidden="true">
                <Icon name="plus" size={16} />
              </span>
            }
            label="Custom…"
            detail="Any width × height"
            hint="Set any width, height and density"
            on={customOpen}
            data={{ 'data-size': 'custom-open' }}
            onSelect={() => pickSize({ size: 'custom-open' })}
          />
        </>
      ) : null}
    </TileGrid>
  );
}

function SizeCustom() {
  const { open, form, error } = useDirectionView(useShallow((s) => ({ open: s.customOpen, form: s.sizeForm, error: s.sizeError })));
  const edit = (patch: Partial<SizeForm>) => directionView.set((s) => ({ sizeForm: { ...s.sizeForm, ...patch } }));
  return (
    <form
      className="dir-size-custom"
      id="sizeCustom"
      hidden={!open}
      onSubmit={(e) => {
        e.preventDefault();
        submitCustomSize();
      }}
    >
      <div className="dir-size-dims">
        <label>
          <span>Width</span>
          <input type="number" id="sizeW" min="320" max="3840" step="2" required value={form.w} onChange={(e) => edit({ w: e.target.value })} />
        </label>
        <span className="dir-size-x" aria-hidden="true">
          ×
        </span>
        <label>
          <span>Height</span>
          <input type="number" id="sizeH" min="320" max="3840" step="2" required value={form.h} onChange={(e) => edit({ h: e.target.value })} />
        </label>
        <label>
          <span>Density</span>
          <select id="sizeDpr" className="ins-select" value={form.dpr} onChange={(e) => edit({ dpr: e.target.value })}>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
          </select>
        </label>
      </div>
      <label className="pane-switch">
        <span className="pane-switch-copy">
          <b>Mobile layout + touch</b>
          <em>Records the phone view with touch events</em>
        </span>
        <span className="ins-switch">
          <input type="checkbox" id="sizeMobile" role="switch" checked={form.mobile} onChange={(e) => edit({ mobile: e.target.checked })} />
          <i />
        </span>
      </label>
      <p className="ins-warn" id="sizeError" hidden={!error} role="alert">
        {error || ''}
      </p>
      <div className="dir-size-actions">
        <button type="button" className="ins-link" onClick={() => directionView.set({ customOpen: false, sizeError: null })}>
          Cancel
        </button>
        <button type="submit" className="ins-btn primary" id="sizeApply">
          Use this size
        </button>
      </div>
    </form>
  );
}

function boxStyle(settings: CaptureSettings | null): { style?: CSSProperties; mode?: string } {
  const box = settings ? stageBox(settings.space) : null;
  if (!box) return {};
  return {
    style: {
      '--frame-aspect': box.aspect,
      '--box-l': box.left,
      '--box-t': box.top,
      '--box-w': box.width,
      '--box-h': box.height,
      '--box-r': box.radius,
    } as CSSProperties,
    mode: box.mode,
  };
}

function ShapeTiles({ settings }: { settings: CaptureSettings | null }) {
  const current = settings?.output?.format;
  return (
    <TileGrid label="Video shape" id="shapeSeg">
      {settings?.outputs.map((f) => {
        const on = f.format === current;
        const name = f.format === 'portrait' ? 'Vertical' : 'Landscape';
        const ratio = f.format === 'portrait' ? '9:16' : '16:9';
        return (
          <LookTile
            key={f.format}
            preview={shapePreview(f.format)}
            label={name}
            detail={`${ratio} · ${f.width}×${f.height}`}
            hint={`${name} — ${ratio} · ${f.width}×${f.height}`}
            on={on}
            data={{ 'data-shape': f.format }}
            onSelect={() => {
              if (!on) void pickShape(f.format);
            }}
          />
        );
      })}
    </TileGrid>
  );
}

export function SizeSection() {
  const { settings, hidden, customOpen } = useDirectionView(useShallow((s) => ({ settings: s.capture, hidden: s.sizeHidden, customOpen: s.customOpen })));
  const cur = settings?.current;
  const rows = settings ? pickerOptions(settings) : [];
  const suggested = rows.find((r) => r.suggested);
  const hint = settings
    ? [stageText(settings.space), suggested && !suggested.selected && suggested.reason ? `Suggested: ${suggested.title} — ${suggested.reason}.` : '']
        .filter(Boolean)
        .join(' ')
    : '';
  const sh = settings ? shapeHint(settings) : null;
  const note = settings ? takeNote(settings.space) : '';
  const box = boxStyle(settings);
  return (
    <>
      <PaneSection
        icon="formats"
        title="Recording size"
        help={SIZE_HELP}
        id="sizeSection"
        hidden={hidden}
        extra={
          <span id="sizeMeta" className="dir-val">
            {settings ? `${cur?.width}×${cur?.height} @${cur?.dpr}x` : ''}
          </span>
        }
      >
        <SizeOptions settings={settings} customOpen={customOpen} />
        <SizeCustom />
        <p className="ins-note dir-note" id="sizeNote" data-tone="warn" hidden={!note}>
          {note}
        </p>
      </PaneSection>
      <PaneSection icon="video" title="Video shape" help={SHAPE_HELP} hidden={hidden}>
        <ShapeTiles settings={settings} />
        <PaneSub label="How the recording sits in the video">
          <div className="dir-fit">
            <div className="size-preview" id="sizePreview" aria-hidden="true" style={box.style} data-mode={box.mode}>
              <i />
            </div>
            <p className="ins-note subtle" id="sizeHint">
              {hint}
            </p>
          </div>
        </PaneSub>
        <div className="dir-callout" id="sizeShapeHint" hidden={!sh}>
          <span>{sh?.text}</span>
          <button
            type="button"
            className="ins-btn"
            id="sizeShapeApply"
            data-output={sh?.output}
            onClick={(e) => {
              const output = e.currentTarget.dataset.output;
              if (output) void saveCaptureSize({ output });
            }}
          >
            {sh ? (sh.output === 'portrait' ? 'Make it vertical' : 'Make it landscape') : null}
          </button>
        </div>
      </PaneSection>
    </>
  );
}
