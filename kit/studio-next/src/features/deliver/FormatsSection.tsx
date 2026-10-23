import { useState } from 'react';

import { useDesk } from '@/desk/store';
import { PanelSection } from '@/ui/PanelSection';

import { DEFAULT_EXPORT_PICK, exportFormats, setReelSafeArea } from './handoff';

const FORMATS_HELP =
  'Cut from the finished master with its mixed audio: social sizes on a brand background, a light 720p, and a GIF teaser. Run Export again to add them to the handoff zip.';

function ExportPresets({ pick, onPick }: { pick: string[] | null; onPick: (next: string[]) => void }) {
  const presets = useDesk((s) => s.video?.exportPresets ?? null);
  const chosen = new Set(pick || DEFAULT_EXPORT_PICK);
  const entries = presets ? Object.entries(presets) : [];
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    onPick(entries.map(([key]) => key).filter((key) => next.has(key)));
  };
  return (
    <div id="exportPresets" className="export-presets" role="group" aria-label="Export formats">
      {entries.map(([id, p]) => (
        <label key={id} className={chosen.has(id) ? 'export-preset active' : 'export-preset'}>
          <input type="checkbox" value={id} checked={chosen.has(id)} onChange={(e) => toggle(id, e.target.checked)} />{' '}
          <span className="export-shape" data-shape={id} aria-hidden="true" />{' '}
          <span>
            <strong>{p.label}</strong>
            <em>{p.hint}</em>
          </span>
        </label>
      ))}
    </div>
  );
}

function ExportList() {
  const list = useDesk((s) => s.video?.exports ?? null);
  return (
    <ul id="exportList" className="export-list">
      {(list || []).map((item, i) => (
        <li key={`${item.id}:${i}`}>
          <a href={item.url} target="_blank" rel="noopener" download="">
            {item.label}
          </a>{' '}
          <span className="meta">{`${item.sizeMB} MB${item.stale ? ' · older than master' : ''}`}</span>
        </li>
      ))}
    </ul>
  );
}

/** Deliver → Formats: social cuts from the master (`renderExports(v)`), and the reel safe-area preview. */
export function FormatsSection() {
  const [pick, setPick] = useState<string[] | null>(null);
  const count = useDesk((s) => s.video?.exports.length ?? 0);
  const loaded = useDesk((s) => s.video != null);
  const deliveryUrl = useDesk((s) => s.video?.deliveryUrl ?? null);
  return (
    <PanelSection
      id="formats"
      icon="formats"
      title="Formats"
      help={FORMATS_HELP}
      badge={
        <span id="exportCount" className="meta">
          {count ? `${count} ready` : ''}
        </span>
      }
    >
      <label className="reel-mode">
        <span>
          <strong>Reel safe area</strong>
          <em>Preview Instagram / TikTok interface overlap</em>
        </span>{' '}
        <input
          type="checkbox"
          id="reelToggle"
          className="switch"
          role="switch"
          aria-label="Preview vertical safe area"
          onChange={(e) => setReelSafeArea(e.target.checked)}
        />
      </label>
      <ExportPresets pick={pick} onPick={setPick} />
      <button
        type="button"
        id="btnExportFormats"
        className="btn primary block"
        disabled={loaded && !deliveryUrl}
        onClick={() => exportFormats(pick)}
      >
        Export formats
      </button>
      <ExportList />
    </PanelSection>
  );
}
