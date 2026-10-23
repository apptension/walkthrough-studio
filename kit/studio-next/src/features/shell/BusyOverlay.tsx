import { useDesk } from '@/desk/store';

export function BusyOverlay() {
  const busy = useDesk((s) => s.busyOverlay);
  return (
    <div
      id="busyOverlay"
      className={busy.leaving ? 'busy-overlay is-leaving' : 'busy-overlay'}
      hidden={!busy.shown}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="load-card">
        <div className="spinner" aria-hidden="true" />
        <div className="load-copy">
          <strong id="busyLabel">{busy.label}</strong> <span id="busyDetail">{busy.detail}</span>
        </div>
        <div className="load-track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
