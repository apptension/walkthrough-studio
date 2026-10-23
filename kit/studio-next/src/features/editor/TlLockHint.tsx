import { useDesk } from '@/desk/store';

/** `#tlLockHint` — shown while the Editor owns the stage (`syncTimelineLock`). */
export function TlLockHint() {
  const locked = useDesk((s) => s.monitorMode === 'plate');
  return (
    <span id="tlLockHint" className="tl-lock-hint" hidden={!locked}>
      Editor · scrub locked · click a plate or live clip to switch · Program to scrub
    </span>
  );
}
