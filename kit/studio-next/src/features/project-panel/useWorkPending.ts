import { useDesk } from '@/desk/store';

/** Whether the Stop buttons show: a job runs or something waits (`updateStopButtons`). */
export function useWorkPending(): boolean {
  return useDesk((s) => s.jobBusy || s.queue.length > 0);
}
