import { useDesk } from '@/desk/store';

export function Toasts() {
  const toasts = useDesk((s) => s.toasts);
  return (
    <div id="toasts" className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : t.kind === 'warn' ? 'warn' : ''}${t.out ? ' out' : ''}`}>
          <i className="dot" />
          <div>
            <b>{t.title}</b>
            {t.detail ? <span>{t.detail}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
