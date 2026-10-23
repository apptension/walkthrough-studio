import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useBusy } from '@/features/tools-panel/busy';
import { HelpTip } from '@/ui/HelpTip';
import { cn } from '@/lib/cn';

import { applyOverlaysLook } from './actions';
import { directionView, useDirectionView, type OverlayDraft, type OverlaySelect, type SelectChoice } from './view';

const LIVE_CARDS_HELP =
  'Chapter cards and caption panels use kit templates (like plates). Pick a preset, then refine caption seat and atmosphere. Changes rebuild live HTML for Program preview and the next recording.';
const BACKDROP_HELP =
  "Solid fill behind the chapter atmosphere. Auto picks black or white from the brand so the card stays opaque. None lets the take show through. Fine-tune colour and opacity per card in the Editor's Look & reveal.";

const ATMOSPHERES: SelectChoice[] = [
  { id: 'waves', label: 'Waves' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'blobs', label: 'Blobs' },
  { id: 'none', label: 'None' },
];
const BACKDROPS: SelectChoice[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'none', label: 'None' },
];

function edit(key: keyof OverlayDraft, value: string) {
  directionView.set((s) => ({ overlay: { ...s.overlay, [key]: value } }));
}

function Options({ choices }: { choices: SelectChoice[] }) {
  return (
    <>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </>
  );
}

interface OverlaySelectProps {
  id: string;
  label: string;
  aria: string;
  field: OverlaySelect;
  fallback: SelectChoice[];
  /** The HTML's own options carry this (a `[data-help]` the help decorator attached inside). */
  help?: string;
}

function OverlaySelectField({ id, label, aria, field, fallback, help }: OverlaySelectProps) {
  const value = useDirectionView((s) => s.overlay[field]);
  const filled = useDirectionView((s) => s.overlayOptions[field]);
  let body: ReactNode = <Options choices={filled ?? fallback} />;
  if (!filled && help) {
    body = (
      <>
        <Options choices={fallback} />
        <HelpTip text={help} label="Auto None" />
      </>
    );
  }
  return (
    <label className="effects-select">
      <span>{label}</span>{' '}
      <select
        id={id}
        aria-label={aria}
        value={value}
        onChange={(e) => edit(field, e.target.value)}
        {...(help ? { 'data-help': help, className: 'has-help' } : {})}
      >
        {body}
      </select>
    </label>
  );
}

export function LiveCardsField() {
  const { preset, seat, align } = useDirectionView(
    useShallow((s) => ({ preset: s.overlay.preset, seat: s.overlay.seat, align: s.overlay.align })),
  );
  const busy = useBusy('btnOverlaysApply');
  return (
    <div className="field live-cards-field">
      <span data-help={LIVE_CARDS_HELP} className="has-help">
        Live cards
        <HelpTip text={LIVE_CARDS_HELP} label="Live cards" />
      </span>{' '}
      <label className="effects-select">
        <span>Preset</span>{' '}
        <select id="overlayPreset" aria-label="Live card preset" value={preset} onChange={(e) => edit('preset', e.target.value)}>
          <option value="plateMatch">Match plates</option>
          <option value="editorial">Editorial</option>
          <option value="punchy">Punchy</option>
          <option value="minimal">Minimal</option>
          <option value="spotlight">Spotlight</option>
        </select>
      </label>
      <div className="effects-row" style={{ marginTop: '10px' }}>
        <OverlaySelectField id="overlayChapterAtm" label="Chapter atm." aria="Chapter atmosphere" field="chapterAtm" fallback={ATMOSPHERES} />{' '}
        <OverlaySelectField id="overlayCaptionAtm" label="Caption atm." aria="Caption atmosphere" field="captionAtm" fallback={ATMOSPHERES} />
      </div>
      <div className="effects-row" style={{ marginTop: '8px' }}>
        <OverlaySelectField
          id="overlayChapterBackdrop"
          label="Chapter backdrop"
          aria="Chapter backdrop colour behind the atmosphere"
          field="chapterBackdrop"
          fallback={BACKDROPS}
          help={BACKDROP_HELP}
        />{' '}
        <OverlaySelectField
          id="overlayCaptionBackdrop"
          label="Caption backdrop"
          aria="Caption backdrop colour behind the atmosphere"
          field="captionBackdrop"
          fallback={BACKDROPS}
        />
      </div>
      <div className="effects-row" style={{ marginTop: '8px' }}>
        <label className="effects-select">
          <span>Caption seat</span>{' '}
          <select id="overlayCaptionSeat" aria-label="Caption seat" value={seat} onChange={(e) => edit('seat', e.target.value)}>
            <option value="bottom-center">Bottom center</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </label>{' '}
        <label className="effects-select">
          <span>Text</span>{' '}
          <select id="overlayCaptionAlign" aria-label="Caption text align" value={align} onChange={(e) => edit('align', e.target.value)}>
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        id="btnOverlaysApply"
        className={cn('btn tiny', busy && 'busy')}
        disabled={busy}
        style={{ marginTop: '10px' }}
        title="Save live-card look and rebuild previews"
        onClick={() => void applyOverlaysLook()}
      >
        Apply live cards
      </button>
    </div>
  );
}
