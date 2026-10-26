import { useEffect } from 'react';

import { bridges } from '@/desk/bridge';

import { ActivitySection } from './ActivityCard';
import { bayBridge } from './bayCards';
import { PipelineSection } from './PipelineSection';
import { QueueSection } from './QueueSection';
import { RenderBrief } from './RenderBrief';

/** `#leftRender` body: the brief, the pipeline, the activity card and the queue. Owns `bridges.bay`. */
export function RenderBayBody() {
  useEffect(() => {
    bridges.bay = bayBridge;
    return () => {
      if (bridges.bay === bayBridge) bridges.bay = null;
    };
  }, []);
  return (
    <>
      <RenderBrief />
      <PipelineSection />
      <ActivitySection />
      <QueueSection />
    </>
  );
}
