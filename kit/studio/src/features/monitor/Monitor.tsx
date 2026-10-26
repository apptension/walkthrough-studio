import { useEffect } from 'react';

import { runtime } from '@/desk/runtime';
import { useDesk } from '@/desk/store';
import { EdTransport } from '@/features/editor/EdTransport';
import { PlateEditBar } from '@/features/editor/PlateEditBar';
import { PlatePane } from '@/features/editor/PlatePane';
import { PlatePicker } from '@/features/editor/PlatePicker';
import { SafeAreaOverlay } from '@/features/editor/SafeAreaOverlay';
import { SceneBar } from '@/features/editor/SceneBar';

import { selectEditor } from './actions';
import { MonitorHead } from './MonitorHead';
import { NoVideo } from './NoVideo';
import { CaptionOverlay, ChapterToast, PlayerCompare, PlayerSingle } from './Players';
import { StageOverlays } from './StageOverlays';
import { Transport } from './Transport';
import { useLiveFramePump } from './useLiveFrame';

const registerStage = (el: HTMLDivElement | null) => {
  runtime.stage = el;
  return () => {
    if (runtime.stage === el) runtime.stage = null;
  };
};

/** Any `[data-open-editor]` control on the desk opens the Editor tab (the `boot()` click delegate). */
function useOpenEditorDelegate(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.('[data-open-editor]')) void selectEditor();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

export function Monitor() {
  const mode = useDesk((s) => s.monitorMode);
  useOpenEditorDelegate();
  useLiveFramePump();
  return (
    <section className="monitor" aria-label="Program monitor" data-mode={mode}>
      <MonitorHead />
      <div className="stage-wrap">
        <div ref={registerStage} className="stage" id="stage">
          <StageOverlays />
          <PlayerSingle />
          <SafeAreaOverlay />
          <PlatePane />
          <PlayerCompare />
          <CaptionOverlay />
          <ChapterToast />
          <NoVideo />
        </div>
      </div>
      <Transport />
      <EdTransport />
      <SceneBar />
      <PlatePicker />
      <PlateEditBar />
    </section>
  );
}
