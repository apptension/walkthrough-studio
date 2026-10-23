import type { MouseEvent } from 'react';

import { playPlatePreview } from '@/desk/monitor';
import { useDesk } from '@/desk/store';
import { Icon } from '@/ui/icons';
import { PanelSection } from '@/ui/PanelSection';

const PLATES_HELP =
  'Rendered brand plates plus live chapter/caption cards. Click one to preview and edit copy in the monitor.';

function onBinClick(e: MouseEvent<HTMLUListElement>) {
  const btn = (e.target as Element).closest<HTMLElement>('button[data-plate-url]');
  if (!btn) return;
  playPlatePreview(btn.dataset.plateUrl ?? '', btn.closest('li')?.querySelector('strong')?.textContent || 'plate');
}

/** `renderPlateBin(assets)`: rendered plate and brand files, each with a Preview button. */
export function PlateBin() {
  const assets = useDesk((s) => s.video?.assets ?? null);
  const plates = (assets || []).filter((a) => a.kind === 'plate' || a.kind === 'brand');
  return (
    <PanelSection
      id="plates"
      icon="plates"
      title="Plate & card previews"
      help={PLATES_HELP}
      defaultOpen={false}
      badge={
        <span id="plateCount" className="meta">
          {plates.length ? `${plates.length}` : ''}
        </span>
      }
    >
      <ul id="plateBin" className="bin-list plate-bin" onClick={onBinClick}>
        {assets == null ? null : plates.length ? (
          plates.map((a, i) => (
            <li key={`${a.url}:${i}`}>
              <div className="who">
                <strong>{a.name}</strong>{' '}
                <span>{`${a.sizeMB} MB · ${a.kind}`}</span>
              </div>{' '}
              <div className="row">
                <button
                  type="button"
                  className="btn icon-only"
                  data-plate-url={a.url}
                  data-act="preview"
                  title="Preview"
                  aria-label="Preview"
                >
                  <Icon name="preview" size={14} />
                </button>
              </div>
            </li>
          ))
        ) : (
          <li className="hint">No plate renders yet — Preview plates.</li>
        )}
      </ul>
    </PanelSection>
  );
}
