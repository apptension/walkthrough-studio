import { useEffect, type ChangeEvent } from 'react';

import { useDesk } from '@/desk/store';

import { FloatingCard } from '@/ui/FloatingCard';

import { accentOverrideCount, chrome, useEditorChrome, type AccentValues } from './engine/chrome';
import { discardPlateCopyEdits, replayPlateButton, savePlateAccent, savePlateCopyEdits, togglePlateAccent } from './engine/plate';

const DIRTY_HINT = '<strong>Unsaved changes</strong> · Replay to preview · Save writes to video.config.json';
const CLEAN_HINT = 'Click text to edit · Replay previews motion · <kbd>*</kbd>word<kbd>*</kbd> for accent';

function AccentSelect({
  id,
  label,
  field,
  values,
  labels = {},
}: {
  id: string;
  label: string;
  field: Exclude<keyof AccentValues, 'sheen'>;
  values: string[];
  labels?: Record<string, string>;
}) {
  const value = useEditorChrome((s) => s.accentValues[field]);
  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    chrome.set({ accentValues: { ...chrome.get().accentValues, [field]: next } });
    void savePlateAccent({ [field]: next || null });
  };
  return (
    <select id={id} aria-label={label} value={value} onChange={onChange}>
      <option value="">Video default</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {labels[v] || v}
        </option>
      ))}
    </select>
  );
}

/** `#plateEditBar` — Replay / Discard / Save around the inline plate editor, plus the plate accent popover. */
export function PlateEditBar() {
  const dirty = useDesk((s) => s.plateDirty);
  const replayBusy = useDesk((s) => Boolean(s.busy['btnPlateReplay']));
  const saveBusy = useDesk((s) => Boolean(s.busy['btnPlateSaveCopy']));
  const painted = useEditorChrome((s) => s.editChromePainted);
  const open = useEditorChrome((s) => s.accentOpen);
  const options = useEditorChrome((s) => s.accentOptions);
  const sheen = useEditorChrome((s) => s.accentValues.sheen);
  const overrides = useEditorChrome((s) => accentOverrideCount(s.accentKeys));

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (chrome.get().accentOpen && !(e.target as Element | null)?.closest?.('#plateAccent')) togglePlateAccent(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const onSheen = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    chrome.set({ accentValues: { ...chrome.get().accentValues, sheen: v } });
    void savePlateAccent({ sheen: v ? v === 'on' : null });
  };

  return (
    <div id="plateEditBar" className={painted && dirty ? 'plate-edit-bar is-dirty' : 'plate-edit-bar'} hidden>
      {painted ? (
        <span className="plate-edit-hint" id="plateEditHint" dangerouslySetInnerHTML={{ __html: dirty ? DIRTY_HINT : CLEAN_HINT }} />
      ) : (
        <span className="plate-edit-hint" id="plateEditHint">
          Click any text on the plate to edit ·{' '}
          <kbd>
            *
          </kbd>
          word
          <kbd>
            *
          </kbd>
          {' '}for accent
        </span>
      )}
      <div className="plate-edit-actions">
        <div className="plate-accent" id="plateAccent" hidden>
          <button
            type="button"
            id="btnPlateAccent"
            className={overrides > 0 ? 'btn tiny is-on' : 'btn tiny'}
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Give this plate its own atmosphere or effects (the video default stays)"
            onClick={() => togglePlateAccent()}
          >
            Accent
          </button>
          <FloatingCard id="plateAccentPop" className="plate-accent-pop" size="lg" role="dialog" aria-label="Plate accent" hidden={!open}>
            <div className="plate-accent-head">
              <strong>
                This plate only
              </strong>
              <span id="plateAccentState" className="meta">
                {overrides ? `${overrides} override${overrides > 1 ? 's' : ''} on this plate` : 'Follows the video'}
              </span>
            </div>
            <label>
              <span>
                Atmosphere
              </span>
              <AccentSelect id="accentAtmosphere" label="Plate atmosphere" field="atmosphere" values={options.atmospheres} labels={options.atmosphereLabels} />
            </label>
            {' '}
            <label>
              <span>
                Title reveal
              </span>
              <AccentSelect id="accentReveal" label="Plate title reveal" field="titleReveal" values={options.titleReveals} labels={options.titleRevealLabels} />
            </label>
            {' '}
            <label>
              <span>
                Depth
              </span>
              <AccentSelect id="accentDepth" label="Plate card depth" field="depth" values={options.depths} />
            </label>
            {' '}
            <label>
              <span>
                Sheen
              </span>
              <select id="accentSheen" aria-label="Plate sheen" value={sheen} onChange={onSheen}>
                <option value="">
                  Video default
                </option>
                <option value="on">
                  On
                </option>
                <option value="off">
                  Off
                </option>
              </select>
            </label>
            {' '}
            <label>
              <span>
                Energy
              </span>
              <AccentSelect id="accentEnergy" label="Plate energy" field="energy" values={options.energies} />
            </label>
            <div className="plate-accent-actions">
              <button type="button" id="btnAccentReset" className="btn tiny" disabled={!overrides} onClick={() => void savePlateAccent({ reset: true })}>
                Follow video
              </button>
              {' '}
              <button type="button" id="btnAccentClose" className="btn tiny" onClick={() => togglePlateAccent(false)}>
                Done
              </button>
            </div>
          </FloatingCard>
        </div>
        <button
          type="button"
          id="btnPlateReplay"
          className={replayBusy ? 'btn tiny busy' : 'btn tiny'}
          disabled={replayBusy}
          title="Replay plate motion (keeps unsaved edits)"
          onClick={replayPlateButton}
        >
          Replay
        </button>
        {' '}
        <button
          type="button"
          id="btnPlateDiscardEdits"
          className="btn tiny"
          disabled={!dirty}
          title="Reload plate without saving"
          onClick={() => void discardPlateCopyEdits()}
        >
          Discard
        </button>
        {' '}
        <button
          type="button"
          id="btnPlateSaveCopy"
          className={saveBusy ? 'btn tiny primary busy' : 'btn tiny primary'}
          disabled={saveBusy || !dirty}
          title="Save copy to video.config.json and rebuild"
          onClick={() => void savePlateCopyEdits()}
        >
          Save
        </button>
        {' '}
        <button type="button" id="btnPlateExit" className="btn tiny" title="Back to Program monitor" onClick={() => document.getElementById('modeProgram')?.click()}>
          Program
        </button>
      </div>
    </div>
  );
}
