import type { CSSProperties, MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { renderKey } from '@/features/tools-panel/renderKey';
import { HelpTip } from '@/ui/HelpTip';
import { SecIcon } from '@/ui/icons';
import { pickerOptions, shapeHint, stageBox, stageText, takeNote } from '@/logic/captureSize';

import { pickSize, saveCaptureSize, submitCustomSize } from './actions';
import { directionView, useDirectionView, type CaptureSettings, type SizeForm } from './view';

const SIZE_HELP =
  'The size sets the layout (CSS px); density sets sharpness. A take keeps the size it was recorded at, so changing it asks for a new take. Guided tours open at this size too.';

function SizeOptions({ settings, customOpen }: { settings: CaptureSettings | null; customOpen: boolean }) {
  const rows = settings ? pickerOptions(settings) : [];
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as Element).closest<HTMLElement>('.size-option');
    if (!btn) return;
    pickSize({
      size: btn.dataset.size ?? '',
      w: Number(btn.dataset.w),
      h: Number(btn.dataset.h),
      dpr: Number(btn.dataset.dpr),
    });
  };
  return (
    <div className="size-options" id="sizeOptions" role="radiogroup" aria-label="Recording size" onClick={onClick}>
      {settings ? (
        <>
          {rows.map((o, i) => (
            <button
              key={`${o.id}:${i}`}
              type="button"
              className="size-option"
              role="radio"
              aria-checked={String(o.selected && !customOpen) as 'true' | 'false'}
              data-size={o.id}
              data-w={o.width}
              data-h={o.height}
              data-dpr={o.dpr}
              title={o.reason || o.label}
            >
              {o.suggested ? <em className="size-badge">Suggested</em> : null}
              <strong>{o.title}</strong>
              <span>{o.line}</span>
            </button>
          ))}
          <button
            type="button"
            className="size-option"
            role="radio"
            aria-checked={customOpen ? 'true' : 'false'}
            data-size="custom-open"
          >
            <strong>Custom…</strong>
            <span>Any width × height</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function SizeCustom() {
  const { open, form, error } = useDirectionView(
    useShallow((s) => ({ open: s.customOpen, form: s.sizeForm, error: s.sizeError })),
  );
  const edit = (patch: Partial<SizeForm>) => directionView.set((s) => ({ sizeForm: { ...s.sizeForm, ...patch } }));
  return (
    <form
      className="size-custom"
      id="sizeCustom"
      hidden={!open}
      onSubmit={(e) => {
        e.preventDefault();
        submitCustomSize();
      }}
    >
      <label>
        Width{' '}
        <input
          type="number"
          id="sizeW"
          min="320"
          max="3840"
          step="2"
          required
          value={form.w}
          onChange={(e) => edit({ w: e.target.value })}
        />
      </label>{' '}
      <span aria-hidden="true">×</span>{' '}
      <label>
        Height{' '}
        <input
          type="number"
          id="sizeH"
          min="320"
          max="3840"
          step="2"
          required
          value={form.h}
          onChange={(e) => edit({ h: e.target.value })}
        />
      </label>{' '}
      <label>
        Density{' '}
        <select id="sizeDpr" value={form.dpr} onChange={(e) => edit({ dpr: e.target.value })}>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="3">3×</option>
        </select>
      </label>{' '}
      <label className="size-check">
        <input type="checkbox" id="sizeMobile" checked={form.mobile} onChange={(e) => edit({ mobile: e.target.checked })} />
        {' '}Mobile layout + touch
      </label>{' '}
      <button type="submit" className="btn tiny" id="sizeApply">
        Use this size
      </button>
      <p className="meta size-error" id="sizeError" hidden={!error}>
        {error || ''}
      </p>
    </form>
  );
}

function ShapeSeg({ settings }: { settings: CaptureSettings | null }) {
  const key = settings ? renderKey(settings) : 0;
  return (
    <div
      className="seg"
      id="shapeSeg"
      role="radiogroup"
      aria-label="Video shape"
      onChange={(e) => {
        const value = (e.target as HTMLInputElement).value;
        if (value) void saveCaptureSize({ output: value });
      }}
    >
      {settings
        ? settings.outputs.map((f) => (
            <label key={`${key}:${f.format}`} title={`${f.format === 'portrait' ? '9:16' : '16:9'} · ${f.width}×${f.height}`}>
              <input type="radio" name="shape" value={f.format} defaultChecked={f.format === settings.output?.format} />
              <span>{f.format === 'portrait' ? 'Vertical' : 'Landscape'}</span>
            </label>
          ))
        : null}
    </div>
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

export function SizeSection() {
  const { settings, hidden, customOpen } = useDirectionView(
    useShallow((s) => ({ settings: s.capture, hidden: s.sizeHidden, customOpen: s.customOpen })),
  );
  const cur = settings?.current;
  const rows = settings ? pickerOptions(settings) : [];
  const suggested = rows.find((r) => r.suggested);
  const hint = settings
    ? [
        stageText(settings.space),
        suggested && !suggested.selected && suggested.reason ? `Suggested: ${suggested.title} — ${suggested.reason}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  const sh = settings ? shapeHint(settings) : null;
  const note = settings ? takeNote(settings.space) : '';
  const box = boxStyle(settings);
  return (
    <section className="direction-section" id="sizeSection" hidden={hidden}>
      <div className="direction-section-head">
        <div>
          <strong data-ico="formats">
            <SecIcon name="formats" />
            Recording size
          </strong>
          <span>
            The browser size and device the product is recorded at — viewers see this layout. Pick a phone to record the mobile
            view.
          </span>
        </div>
        <span id="sizeMeta" data-help={SIZE_HELP} className="meta has-help">
          {settings ? `${cur?.width}×${cur?.height} @${cur?.dpr}x` : <HelpTip text={SIZE_HELP} label="" />}
        </span>
      </div>
      <SizeOptions settings={settings} customOpen={customOpen} />
      <SizeCustom />
      <div className="size-shape">
        <div className="size-shape-pick">
          <span className="meta">Video shape</span>
          <ShapeSeg settings={settings} />
        </div>
        <div className="size-preview" id="sizePreview" aria-hidden="true" style={box.style} data-mode={box.mode}>
          <i />
        </div>
      </div>
      <p className="meta size-hint" id="sizeHint">
        {hint}
      </p>
      <p className="meta size-note" id="sizeShapeHint" hidden={!sh}>
        <span>{sh?.text}</span>{' '}
        <button
          type="button"
          className="btn tiny"
          id="sizeShapeApply"
          data-output={sh?.output}
          onClick={(e) => {
            const output = e.currentTarget.dataset.output;
            if (output) void saveCaptureSize({ output });
          }}
        >
          {sh ? (sh.output === 'portrait' ? 'Make it vertical' : 'Make it landscape') : null}
        </button>
      </p>
      <p className="meta size-note" id="sizeNote" data-tone="warn" hidden={!note}>
        {note}
      </p>
    </section>
  );
}
