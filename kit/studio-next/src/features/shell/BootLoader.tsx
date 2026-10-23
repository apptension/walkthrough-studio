import { useDesk } from '@/desk/store';

export function BootLoader() {
  const boot = useDesk((s) => s.boot);
  if (boot.gone) return null;
  return (
    <div
      id="bootLoader"
      className={boot.leaving ? 'boot-loader is-leaving' : 'boot-loader'}
      role="status"
      aria-live="polite"
      aria-busy={boot.leaving ? 'false' : 'true'}
    >
      <div className="load-card">
        <canvas id="bootMark" className="load-mark" width="192" height="192" aria-hidden="true" />
        <div className="load-copy">
          <strong>Walkthrough Studio</strong> <span id="bootStatus">{boot.status}</span>
        </div>
        <div className="load-track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
