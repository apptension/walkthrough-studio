import { useDesk } from '@/desk/store';

/** `#statusLine` — `setStatus(kind, text)`. */
export function StatusLine() {
  const kind = useDesk((s) => s.status.kind);
  const text = useDesk((s) => s.status.text);
  return (
    <div id="statusLine" className="chrome-status" aria-live="polite" {...(kind ? { 'data-kind': kind } : {})}>
      <i id="statusDot" />
      {' '}
      <span id="statusText">
        {text}
      </span>
    </div>
  );
}
