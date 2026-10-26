import { useDesk } from '@/desk/store';

/** `buttonBusy(btn, on)` as a read: the button carries `.busy` and is disabled while on. */
export function useBusy(id: string): boolean {
  return useDesk((s) => Boolean(s.busy[id]));
}
