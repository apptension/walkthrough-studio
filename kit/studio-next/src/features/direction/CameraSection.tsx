import { Fragment, type CSSProperties, type MouseEvent } from 'react';

import type { CameraSettings, CursorSettings, Direction } from '@/api/types';
import { HelpTip } from '@/ui/HelpTip';
import { SecIcon } from '@/ui/icons';

import { CURSOR_TOGGLES, pickCamera, pickLook, toggleCursor, toggleKeys } from './actions';
import { directionView, useDirectionView, type CursorToggles } from './view';

const quietly = (p: Promise<unknown>) => void p.catch(() => {});

const DEFAULT_CAMERA: Partial<CameraSettings> = {
  zoom: 'off',
  frame: 'full',
  background: 'brand',
  padding: 'balanced',
  corners: 'soft',
  shadow: 'soft',
};
const DEFAULT_CURSOR: Partial<CursorSettings> = { style: 'classic', size: 'm', glide: false, hideIdle: false, loop: false };

interface SegChoice {
  value: string;
  label: string;
  title?: string;
  chip?: boolean;
}

interface SegRowDef {
  group: { camera?: keyof CameraSettings; cursor?: 'style' | 'size' };
  label: string;
  aria: string;
  help?: string;
  rowId?: string;
  rowClass?: 'frameDetailRow';
  swatch?: boolean;
  choices: SegChoice[];
}

const ROWS: SegRowDef[] = [
  {
    group: { camera: 'zoom' },
    label: 'Auto zoom',
    aria: 'Auto zoom',
    help: 'Pushes in on each click and follows the pointer between clicks, then eases back out. Chapter cards, captions and lenses always stay full frame.',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'subtle', label: 'Subtle' },
      { value: 'bold', label: 'Bold' },
    ],
  },
  {
    group: { camera: 'curve' },
    label: 'Motion curve',
    aria: 'Motion curve',
    help: "The easing every camera move follows: the push-in, the pan between clicks and the magnifier's open and close. The Editor stage previews the same curve the render uses.",
    choices: [
      { value: 'glide', label: 'Glide', title: 'Quick start, long silky settle' },
      { value: 'smooth', label: 'Smooth', title: 'Eases in and out equally' },
      { value: 'cinematic', label: 'Cinematic', title: 'Weighty start and end — a dolly move' },
      { value: 'snappy', label: 'Snappy', title: 'Lands fast and sticks' },
    ],
  },
  {
    group: { camera: 'motion' },
    label: 'Move length',
    aria: 'Move length',
    help: 'How long camera moves and the magnifier take to land. Unhurried is about a third longer, Swift a quarter shorter.',
    choices: [
      { value: 'unhurried', label: 'Unhurried' },
      { value: 'natural', label: 'Natural' },
      { value: 'swift', label: 'Swift' },
    ],
  },
  {
    group: { camera: 'frame' },
    label: 'Frame',
    aria: 'Frame',
    help: 'Inset shows the app as a rounded window with a soft shadow on a background built from the color scale.',
    choices: [
      { value: 'full', label: 'Full bleed' },
      { value: 'inset', label: 'Inset' },
    ],
  },
  {
    group: { camera: 'background' },
    label: 'Background',
    aria: 'Frame background',
    rowId: 'backgroundRow',
    swatch: true,
    choices: [
      { value: 'brand', label: 'Brand', title: 'Surface to ink with an accent glow', chip: true },
      { value: 'ink', label: 'Ink', title: 'Flat ink', chip: true },
      { value: 'accent', label: 'Accent', title: 'Accent to secondary', chip: true },
    ],
  },
  {
    group: { camera: 'padding' },
    label: 'Padding',
    aria: 'Frame padding',
    rowClass: 'frameDetailRow',
    choices: [
      { value: 'tight', label: 'Tight' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'roomy', label: 'Roomy' },
    ],
  },
  {
    group: { camera: 'corners' },
    label: 'Corners',
    aria: 'Frame corners',
    rowClass: 'frameDetailRow',
    choices: [
      { value: 'square', label: 'Square' },
      { value: 'soft', label: 'Soft' },
      { value: 'round', label: 'Round' },
    ],
  },
  {
    group: { camera: 'shadow' },
    label: 'Shadow',
    aria: 'Frame shadow',
    rowClass: 'frameDetailRow',
    choices: [
      { value: 'off', label: 'Off' },
      { value: 'soft', label: 'Soft' },
      { value: 'deep', label: 'Deep' },
    ],
  },
  {
    group: { cursor: 'style' },
    label: 'Cursor',
    aria: 'Cursor style',
    help: "Classic keeps Playwright's pointer. Arrow and Dot are drawn for video, glide between targets and pulse on click.",
    choices: [
      { value: 'classic', label: 'Classic' },
      { value: 'arrow', label: 'Arrow' },
      { value: 'dot', label: 'Dot' },
    ],
  },
  {
    group: { cursor: 'size' },
    label: 'Size',
    aria: 'Cursor size',
    rowId: 'cursorSizeRow',
    choices: [
      { value: 's', label: 'S' },
      { value: 'm', label: 'M' },
      { value: 'l', label: 'L' },
    ],
  },
];

const TOGGLE_HELP: Record<string, { label: string; help: string; aria: string }> = {
  glideToggle: {
    label: 'Smooth glide',
    help: 'Moves between action targets on a smooth curved path.',
    aria: 'Smooth cursor glide',
  },
  handToggle: {
    label: 'Hand on click',
    help: 'Just before a click the arrow turns into a pointing hand that pushes down on the press, so viewers see the click happen.',
    aria: 'Pointing hand on clicks',
  },
  idleToggle: {
    label: 'Hide when idle',
    help: 'Fades the presentation cursor after 1.5 seconds without movement.',
    aria: 'Hide cursor when idle',
  },
  loopToggle: {
    label: 'Loop cursor',
    help: 'Returns the pointer to its opening seat before capture ends, useful for looping clips.',
    aria: 'Loop cursor position',
  },
};
const KEYS_HELP =
  'Shows shortcuts the flow presses (⌘K, Enter, Esc) as keycaps at the bottom of the frame. Plain typing is not shown.';

interface CameraView {
  camera: Partial<CameraSettings>;
  cursor: Partial<CursorSettings>;
  chips: Record<string, string | undefined>;
}

function cameraView(direction: Direction): CameraView {
  const c = direction.colors || {};
  return {
    camera: direction.camera || DEFAULT_CAMERA,
    cursor: direction.cursor || DEFAULT_CURSOR,
    chips: {
      brand: `radial-gradient(circle at 80% 15%, ${c.gold}66, transparent 55%), linear-gradient(135deg, ${c.surface}, ${c.ink})`,
      ink: c.ink,
      accent: `linear-gradient(135deg, ${c.gold}, ${c.amber})`,
    },
  };
}

function markedValue(row: SegRowDef, view: CameraView): string | undefined {
  if (row.group.camera === 'curve') return view.camera.curve || 'glide';
  if (row.group.camera === 'motion') return view.camera.motion || 'natural';
  if (row.group.camera) return view.camera[row.group.camera];
  return row.group.cursor ? view.cursor[row.group.cursor] : undefined;
}

function LookPreview({ direction, view }: { direction: Direction | null; view: CameraView | null }) {
  const camera = view?.camera;
  const style =
    view && camera
      ? ({
          '--look-bg': view.chips[camera.background ?? ''] || view.chips.brand,
          '--look-accent': direction?.colors?.gold || '#42f272',
        } as CSSProperties)
      : undefined;
  return (
    <div
      className="look-preview"
      id="lookPreview"
      aria-label="Frame style preview"
      data-frame={camera?.frame}
      data-cursor={view?.cursor.style}
      data-keys={direction ? (direction.keys ? 'on' : 'off') : undefined}
      data-padding={camera?.padding}
      data-corners={camera?.corners}
      data-shadow={camera?.shadow}
      style={style}
    >
      <div className="look-preview-window">
        <i />
        <i />
        <i />
        <span />
        <b />
      </div>
      <div className="look-preview-cursor" aria-hidden="true" />
      <div className="look-preview-keys" aria-hidden="true">
        <i>⌘</i>
        <i>K</i>
      </div>
    </div>
  );
}

function LookPresets({ direction }: { direction: Direction | null }) {
  return (
    <div className="look-presets" id="lookPresets" role="radiogroup" aria-label="Look presets">
      {direction
        ? Object.entries(direction.looks || {}).map(([id, look]) => (
            <button
              key={id}
              type="button"
              data-look={id}
              className={direction.look === id ? 'active' : ''}
              role="radio"
              aria-checked={direction.look === id ? 'true' : 'false'}
            >
              <i aria-hidden="true" />
              <span>
                <strong>{look.label}</strong>
                <em>{look.hint}</em>
              </span>
            </button>
          ))
        : null}
    </div>
  );
}

function SegRow({ row, view }: { row: SegRowDef; view: CameraView | null }) {
  const value = view ? markedValue(row, view) : undefined;
  const inset = view ? view.camera.frame === 'inset' : true;
  const hidden =
    view == null
      ? undefined
      : row.rowId === 'backgroundRow' || row.rowClass === 'frameDetailRow'
        ? !inset
        : row.rowId === 'cursorSizeRow'
          ? view.cursor.style === 'classic'
          : undefined;
  return (
    <div className={row.rowClass ? `seg-row ${row.rowClass}` : 'seg-row'} id={row.rowId} hidden={hidden}>
      {row.help ? (
        <span data-help={row.help} className="seg-label has-help">
          {row.label}
          <HelpTip text={row.help} label={row.label} />
        </span>
      ) : (
        <span className="seg-label">{row.label}</span>
      )}
      <div
        className={row.swatch ? 'seg swatch-seg' : 'seg'}
        role="radiogroup"
        aria-label={row.aria}
        data-camera={row.group.camera}
        data-cursor={row.group.cursor}
      >
        {row.choices.map((c, i) => {
          const on = view != null && c.value === value;
          return (
            <Fragment key={c.value}>
              {i > 0 ? ' ' : null}
              <button
                type="button"
                role="radio"
                data-value={c.value}
                title={c.title}
                className={on ? 'active' : undefined}
                aria-checked={view ? (on ? 'true' : 'false') : undefined}
              >
                {c.chip ? (
                  <i className="bg-chip" data-bg={c.value} style={view ? { background: view.chips[c.value] || '' } : undefined} />
                ) : null}
                {c.label}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  help,
  aria,
  checked,
  detail,
  hidden,
  onToggle,
}: {
  id: string;
  label: string;
  help: string;
  aria: string;
  checked: boolean;
  detail: boolean;
  hidden: boolean | undefined;
  onToggle: (on: boolean) => void;
}) {
  return (
    <label className={detail ? 'seg-row switch-row cursorDetailRow' : 'seg-row switch-row'} hidden={hidden}>
      <span data-help={help} className="seg-label has-help">
        {label}
        <HelpTip text={help} label={label} />
      </span>{' '}
      <input
        type="checkbox"
        id={id}
        className="switch"
        role="switch"
        aria-label={aria}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
      />
    </label>
  );
}

function setToggle(key: keyof CursorToggles, on: boolean) {
  directionView.set((s) => ({ toggles: { ...s.toggles, [key]: on } }));
}

/** `#cameraSection`: look presets, camera and cursor rows, the render toggles. */
export function CameraSection() {
  const direction = useDirectionView((s) => s.direction);
  const toggles = useDirectionView((s) => s.toggles);
  const view = direction ? cameraView(direction) : null;
  const detailHidden = view ? view.cursor.style === 'classic' : undefined;

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as Element;
    const look = target.closest<HTMLElement>('[data-look]');
    if (look && !look.classList.contains('active')) {
      quietly(pickLook(look.dataset.look ?? ''));
      return;
    }
    const btn = target.closest<HTMLElement>('[data-value]');
    const group = btn?.closest<HTMLElement>('[data-camera],[data-cursor]');
    if (!btn || !group || btn.classList.contains('active')) return;
    const which = group.dataset.camera ? { camera: group.dataset.camera } : { cursor: group.dataset.cursor ?? '' };
    quietly(pickCamera(which, btn.dataset.value ?? ''));
  };

  return (
    <section className="direction-section" id="cameraSection" onClick={onClick}>
      <div className="direction-section-head">
        <div>
          <strong data-ico="camera">
            <SecIcon name="camera" />
            Camera & cursor
          </strong>
          <span>Start with a look, then tune it. Render settings are non-destructive.</span>
        </div>
      </div>
      <LookPreview direction={direction} view={view} />
      <LookPresets direction={direction} />
      <div className="seg-rows">
        {ROWS.map((row) => (
          <SegRow key={row.label} row={row} view={view} />
        ))}
        {CURSOR_TOGGLES.map((t) => {
          const copy = TOGGLE_HELP[t.id];
          if (!copy) return null;
          return (
            <Fragment key={t.id}>
              <SwitchRow
                id={t.id}
                label={copy.label}
                help={copy.help}
                aria={copy.aria}
                checked={toggles[t.toggle]}
                detail
                hidden={detailHidden}
                onToggle={(on) => {
                  setToggle(t.toggle, on);
                  quietly(toggleCursor(t.key, t.label, on));
                }}
              />{' '}
            </Fragment>
          );
        })}
        <SwitchRow
          id="keysToggle"
          label="Keystrokes"
          help={KEYS_HELP}
          aria="Show keystrokes"
          checked={toggles.keys}
          detail={false}
          hidden={undefined}
          onToggle={(on) => {
            setToggle('keys', on);
            quietly(toggleKeys(on));
          }}
        />
      </div>
    </section>
  );
}
