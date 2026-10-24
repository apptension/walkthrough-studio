import { stopAllWork } from './jobs';
import { useDesk } from './store';

/**
 * While a make pipeline runs, its button does not go inert — the same spot turns into an
 * active Stop control (`stopAllWork`). `busy` drives the swap, `stopping` is the brief window
 * between clicking Stop and the job actually settling, where it stays red but can't be clicked
 * twice.
 */
export function useRenderStop(id: string): { busy: boolean; stopping: boolean; stop: () => void } {
  const busy = useDesk((s) => Boolean(s.busy[id]));
  const stopRequested = useDesk((s) => s.stopRequested);
  return {
    busy,
    stopping: busy && stopRequested,
    stop: () => void stopAllWork({ reason: 'Stopped' }),
  };
}
