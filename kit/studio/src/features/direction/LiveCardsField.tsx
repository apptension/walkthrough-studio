import { useShallow } from 'zustand/react/shallow';

import { useDesk } from '@/desk/store';
import { useBusy } from '@/features/tools-panel/busy';
import { cn } from '@/lib/cn';
import { Icon } from '@/ui/icons';
import { cardPresetPreview, seatPreview } from '@/ui/look/previews';
import { LookTile, PaneSection, PaneSub, SegButtons, SelectRow, TileGrid } from '@/ui/pane';

import { applyOverlaysLook } from './actions';
import { directionView, overlayDirty, useDirectionView, type OverlayDraft, type OverlaySelect, type SelectChoice } from './view';

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
const PRESETS = [
  { id: 'plateMatch', label: 'Match plates', hint: 'Cards wear the plate look' },
  { id: 'editorial', label: 'Editorial', hint: 'Quiet type on a paper panel' },
  { id: 'punchy', label: 'Punchy', hint: 'Bold type, loud accent' },
  { id: 'minimal', label: 'Minimal', hint: 'Just the words' },
  { id: 'spotlight', label: 'Spotlight', hint: 'A lit panel over a dimmed take' },
];
const SEATS = [
  { id: 'bottom-left', label: 'Left' },
  { id: 'bottom-center', label: 'Center' },
  { id: 'bottom-right', label: 'Right' },
];
const ALIGNS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
];

function edit(key: keyof OverlayDraft, value: string) {
  directionView.set((s) => ({ overlay: { ...s.overlay, [key]: value } }));
}

function OverlaySelectField({ id, label, aria, field, fallback, help }: { id: string; label: string; aria: string; field: OverlaySelect; fallback: SelectChoice[]; help?: string }) {
  const value = useDirectionView((s) => s.overlay[field]);
  const filled = useDirectionView((s) => s.overlayOptions[field]);
  return (
    <SelectRow id={id} label={label} aria={aria} value={value} onChange={(v) => edit(field, v)} {...(help ? { help } : {})}>
      {(filled ?? fallback).map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </SelectRow>
  );
}

/** Apply saves the draft and rebuilds the cards; edits waiting on it are called out. */
function ApplyBar() {
  const busy = useBusy('btnOverlaysApply');
  const dirty = useDirectionView((s) => overlayDirty(s));
  const revert = () => directionView.set((s) => (s.overlaySaved ? { overlay: { ...s.overlaySaved } } : {}));
  return (
    <div className={cn('dir-apply', dirty && 'is-dirty')} role="group" aria-label="Live card changes">
      <span className="dir-apply-state" aria-live="polite">
        <i aria-hidden="true" />
        {dirty ? 'Unsaved changes' : 'Saved'}
      </span>
      {dirty ? (
        <button type="button" className="ins-link" onClick={revert}>
          Revert
        </button>
      ) : null}
      <button
        type="button"
        id="btnOverlaysApply"
        className={cn('ins-btn', dirty && 'primary', busy && 'busy')}
        disabled={busy}
        title="Save live-card look and rebuild previews"
        onClick={() => void applyOverlaysLook()}
      >
        <Icon name="check" size={13} />
        <span>Apply live cards</span>
      </button>
    </div>
  );
}

export function LiveCardsSection() {
  const { preset, seat, align } = useDirectionView(useShallow((s) => ({ preset: s.overlay.preset, seat: s.overlay.seat, align: s.overlay.align })));
  const catalog = useDesk((s) => s.video?.overlays?.catalog);
  const presets = PRESETS.map((p) => ({ ...p, ...catalog?.presets?.find((c) => c.id === p.id) }));
  const seats = catalog?.seats?.length ? SEATS.filter((s) => catalog.seats.includes(s.id)) : SEATS;
  return (
    <PaneSection icon="captions" title="Live cards" help={LIVE_CARDS_HELP} className="live-cards-field">
      <PaneSub label="Preset">
        <TileGrid label="Live card preset" id="overlayPreset">
          {presets.map((p) => (
            <LookTile
              key={p.id}
              preview={cardPresetPreview(p.id)}
              label={p.label}
              hint={`${p.label} — ${p.hint}`}
              on={p.id === preset}
              data={{ 'data-preset': p.id }}
              onSelect={() => edit('preset', p.id)}
            />
          ))}
        </TileGrid>
      </PaneSub>
      <PaneSub label="Chapter card">
        <div className="pane-selects">
          <OverlaySelectField id="overlayChapterAtm" label="Atmosphere" aria="Chapter atmosphere" field="chapterAtm" fallback={ATMOSPHERES} />
          <OverlaySelectField
            id="overlayChapterBackdrop"
            label="Backdrop"
            aria="Chapter backdrop colour behind the atmosphere"
            field="chapterBackdrop"
            fallback={BACKDROPS}
            help={BACKDROP_HELP}
          />
        </div>
      </PaneSub>
      <PaneSub label="Caption" aside={<SegButtons label="Caption text align" id="overlayCaptionAlign" choices={ALIGNS} current={align} onSelect={(v) => edit('align', v)} />}>
        <TileGrid label="Caption seat" id="overlayCaptionSeat">
          {seats.map((s) => (
            <LookTile
              key={s.id}
              preview={seatPreview(s.id, align)}
              label={s.label}
              hint={`Caption seat — bottom ${s.label.toLowerCase()}`}
              on={s.id === seat}
              data={{ 'data-seat': s.id }}
              onSelect={() => edit('seat', s.id)}
            />
          ))}
        </TileGrid>
        <div className="pane-selects">
          <OverlaySelectField id="overlayCaptionAtm" label="Atmosphere" aria="Caption atmosphere" field="captionAtm" fallback={ATMOSPHERES} />
          <OverlaySelectField
            id="overlayCaptionBackdrop"
            label="Backdrop"
            aria="Caption backdrop colour behind the atmosphere"
            field="captionBackdrop"
            fallback={BACKDROPS}
          />
        </div>
      </PaneSub>
      <ApplyBar />
    </PaneSection>
  );
}
