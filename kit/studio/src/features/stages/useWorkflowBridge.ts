import { useEffect } from 'react';

import { bridges, type WorkflowBridge } from '@/desk/bridge';
import { openBranch } from '@/features/branch/branch';
import { openCommandMenu } from '@/features/command/command';
import { openCut } from '@/features/cut/cut';
import { openHelp } from '@/features/help/guide';
import { openProjectNew, openProjectSettings } from '@/features/project-wizard/wizard';
import { followAgentJob, openScript } from '@/features/script/sheet';

import { onStageClick } from './actions';

/** `bridges.workflow` — what `initWorkflow`/`initProjects`/`initBranch` returned to `app.js`. */
export const workflowBridge: WorkflowBridge = {
  openScript: (opts) => void openScript(opts),
  openCut,
  openProjectNew: () => void openProjectNew(),
  openProjectSettings: () => void openProjectSettings(),
  openBranch,
  openCommandMenu,
  openHelp,
  followAgentJob,
  openStage: onStageClick,
};

/** Register `bridges.workflow` while the stage bar is mounted. */
export function useWorkflowBridge(): void {
  useEffect(() => {
    bridges.workflow = workflowBridge;
    return () => {
      if (bridges.workflow === workflowBridge) bridges.workflow = null;
    };
  }, []);
}
