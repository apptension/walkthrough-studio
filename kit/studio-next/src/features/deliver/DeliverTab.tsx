import { FormatsSection } from './FormatsSection';
import { HandoffPack } from './HandoffPack';

/** Handoff pack and social formats, hosted on the left Deliver panel. */
export function DeliverSections() {
  return (
    <>
      <HandoffPack />
      <FormatsSection />
    </>
  );
}
