import { useEffect } from 'react';

import { boot } from '@/desk/boot';
import { watchFreshness } from '@/desk/freshness';
import { wirePanelResize } from '@/desk/layout';
import { useDesk } from '@/desk/store';
import { BranchDialog } from '@/features/branch/BranchDialog';
import { CommandDialog } from '@/features/command/CommandDialog';
import { CutDialog } from '@/features/cut/CutDialog';
import { HelpDialog } from '@/features/help/HelpDialog';
import { Monitor } from '@/features/monitor/Monitor';
import { ProjectPanel } from '@/features/project-panel/ProjectPanel';
import { ProjectDialog } from '@/features/project-wizard/ProjectDialog';
import { ScriptDialog } from '@/features/script/ScriptDialog';
import { AskDialog } from '@/features/shell/AskDialog';
import { BodyClasses } from '@/features/shell/BodyClasses';
import { BootLoader } from '@/features/shell/BootLoader';
import { BusyOverlay } from '@/features/shell/BusyOverlay';
import { ChromeHeader } from '@/features/chrome/ChromeHeader';
import { Toasts } from '@/features/shell/Toasts';
import { useShortcuts } from '@/features/shell/useShortcuts';
import { StageBar } from '@/features/stages/StageBar';
import { TimelineShell } from '@/features/timeline/TimelineShell';
import { ToolsPanel } from '@/features/tools-panel/ToolsPanel';
import { HelpPop } from '@/ui/HelpTip';
import { Icon } from '@/ui/icons';

/**
 * A splitter. `wirePanelResize()` owns its behaviour and ARIA state; the tab shows
 * once its panel is folded (click or drag it to bring the panel back), the hint while
 * a drag would fold it.
 */
function PanelHandle({ id, side, label }: { id: string; side: 'left' | 'right' | 'bottom'; label: string }) {
  const horizontal = side === 'bottom';
  return (
    <div
      className={horizontal ? 'resize-handle resize-handle-h' : 'resize-handle'}
      id={id}
      data-side={side}
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-label={label}
      tabIndex={0}
    >
      <span className="resize-tab" aria-hidden="true">
        <Icon name="ui-chevron" size={12} />
      </span>
      <span className="resize-hint" aria-hidden="true">
        Release to hide
      </span>
    </div>
  );
}

/**
 * The desk, in the same DOM order as `kit/studio/index.html`, so the legacy
 * stylesheet lays it out unchanged.
 */
export function App() {
  const bootError = useDesk((s) => s.bootError);
  useEffect(() => wirePanelResize(), []);
  useEffect(() => watchFreshness(), []);
  useEffect(() => {
    void boot();
  }, []);
  useShortcuts();

  if (bootError) {
    return <pre style={{ color: '#f07178', padding: 40 }}>Studio failed: {bootError}</pre>;
  }

  return (
    <>
      <BodyClasses />
      <BootLoader />
      <ChromeHeader />
      <StageBar />
      <div className="workspace" id="workspace">
        <ProjectPanel />
        <PanelHandle id="resizeLeft" side="left" label="Resize left panel" />
        <Monitor />
        <PanelHandle id="resizeRight" side="right" label="Resize right panel" />
        <ToolsPanel />
      </div>
      <PanelHandle id="resizeTimeline" side="bottom" label="Resize timeline" />
      <TimelineShell />
      <Toasts />
      <CommandDialog />
      <HelpDialog />
      <ScriptDialog />
      <CutDialog />
      <ProjectDialog />
      <BranchDialog />
      <AskDialog />
      <BusyOverlay />
      <HelpPop />
    </>
  );
}
