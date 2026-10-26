import { useEffect } from 'react';

import { bridges } from '@/desk/bridge';
import { activePlayer, ensureProgramMaster, seekTo, updateTransport } from '@/desk/monitor';
import { desk, openDialog } from '@/desk/store';
import { normalizeMonitorMode } from '@/logic/monitorMode';

/** The desk-wide keyboard map from the end of `wire()` in `kit/studio/app.js`. */
export function onDeskKeydown(e: KeyboardEvent): void {
  const s = desk.get();
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openDialog('command', !s.dialogs.command);
    return;
  }
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (target?.isContentEditable) return;
  if (document.querySelector('dialog[open]')) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && s.monitorMode === 'plate') {
    e.preventDefault();
    void bridges.plate?.savePlateCopyEdits();
    return;
  }
  if (e.key === 'Escape' && s.versionSelection.length && s.leftTab === 'versions') {
    e.preventDefault();
    desk.set({ versionSelection: [] });
    return;
  }
  const plate = normalizeMonitorMode(s.monitorMode) === 'plate';
  if (e.code === 'Space') {
    if (document.body.classList.contains('is-editor')) return;
    e.preventDefault();
    document.getElementById('btnPlay')?.click();
  } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
    if (plate) return;
    e.preventDefault();
    if (s.previewingPlate && s.video?.deliveryUrl) ensureProgramMaster({ preserveTime: false });
    seekTo((activePlayer()?.currentTime || 0) - (e.key === 'ArrowLeft' ? 2 : 5));
  } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
    if (plate) return;
    e.preventDefault();
    if (s.previewingPlate && s.video?.deliveryUrl) ensureProgramMaster({ preserveTime: false });
    seekTo((activePlayer()?.currentTime || 0) + (e.key === 'ArrowRight' ? 2 : 5));
  } else if (e.key === 'c' || e.key === 'C') {
    desk.set({ captionsOn: !s.captionsOn });
    updateTransport();
  } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    openDialog('help', true);
  }
}

export function useShortcuts(): void {
  useEffect(() => {
    document.addEventListener('keydown', onDeskKeydown);
    return () => document.removeEventListener('keydown', onDeskKeydown);
  }, []);
}
