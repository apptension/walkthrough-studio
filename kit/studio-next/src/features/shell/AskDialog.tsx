import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useAsk, type PendingAsk } from '@/desk/ask';
import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';

function iconFor(p: PendingAsk): string {
  const warn = p.tone === 'warn';
  return p.kind === 'choice' ? 'ask-grid' : p.kind === 'prompt' ? 'ask-tag' : warn ? 'ask-warn' : 'ask-ask';
}

function titleFor(p: PendingAsk): string {
  return p.title || (p.kind === 'prompt' ? 'Name it' : p.kind === 'choice' ? 'Pick one' : 'Are you sure?');
}

/** `#askDialog` from `kit/studio/ask.js`, rendering whatever `ask()` is waiting on. */
export function AskDialog() {
  const pending = useAsk((s) => s.pending);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAsk | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  pickedRef.current = picked;

  useLayoutEffect(() => {
    pendingRef.current = pending;
    const d = dialogRef.current;
    if (!d) return;
    if (!pending) {
      if (d.open) d.close();
      return;
    }
    const first = pending.options[0]?.value ?? '';
    setPicked(pending.kind === 'choice' ? String(pending.value || first) : null);
    d.returnValue = 'cancel';
    if (!d.open) d.showModal();
    const raf = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      } else okRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [pending]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const onClose = () => {
      const p = pendingRef.current;
      if (!p) return;
      const ok = d.returnValue === 'ok';
      if (p.kind === 'prompt') p.resolve(ok ? (inputRef.current?.value ?? '') : null);
      else if (p.kind === 'choice') p.resolve(ok && pickedRef.current != null ? pickedRef.current : null);
      else p.resolve(ok);
    };
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, []);

  const p = pending;
  const warn = p?.tone === 'warn';
  const sub = p && p.kind !== 'confirm' ? p.detail : '';

  return (
    <dialog ref={dialogRef} className="sheet-dialog ask" id="askDialog" aria-labelledby="askTitle">
      <form method="dialog" className="sheet-form">
        <header className="sheet-head">
          <span className={`sheet-icon${warn ? ' warn' : ''}`} id="askIcon" aria-hidden="true">
            {p ? <Icon name={iconFor(p)} size={16} /> : null}
          </span>
          <div className="sheet-titles">
            <h2 id="askTitle">{p ? titleFor(p) : ''}</h2>
            <p className="sheet-sub" id="askSub" hidden={!sub}>
              {sub}
            </p>
          </div>
        </header>
        <div className="sheet-body" id="askBody">
          {p?.kind === 'prompt' ? (
            <>
              <label className="field-label" htmlFor="askInput">
                {p.label || 'Title'}
              </label>
              <input
                key={p.id}
                ref={inputRef}
                id="askInput"
                type={p.secret ? 'password' : 'text'}
                defaultValue={p.value}
                placeholder={p.placeholder}
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    okRef.current?.click();
                  }
                }}
              />
            </>
          ) : p?.kind === 'choice' ? (
            <div className="ask-choices" role="listbox">
              {p.options.map((o) => {
                const on = String(o.value) === picked;
                const label = o.label || o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={`ask-choice${o.still ? ' has-still' : ''}${on ? ' is-on' : ''}`}
                    data-value={o.value}
                    role="option"
                    aria-selected={on}
                    onClick={() => setPicked(String(o.value))}
                    onDoubleClick={() => {
                      pickedRef.current = String(o.value);
                      okRef.current?.click();
                    }}
                  >
                    {o.still ? (
                      <>
                        <span className="ask-still">
                          <img alt="" src={o.still} decoding="async" />
                        </span>
                        <span className="ask-copy">
                          <strong>{label}</strong>
                          {o.hint ? <span>{o.hint}</span> : null}
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>{label}</strong>
                        {o.hint ? <span>{o.hint}</span> : null}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ) : p?.detail ? (
            <p className="ask-detail">{p.detail}</p>
          ) : null}
        </div>
        <footer className="sheet-foot">
          <div className="sheet-actions">
            <button type="submit" className="btn ghost" id="askCancel" value="cancel">
              {p?.cancel ?? 'Cancel'}
            </button>
            <NeonButton ref={okRef} type="submit" className={`btn ${warn ? 'warn' : 'primary'}`} id="askOk" value="ok">
              {p?.ok ?? 'Continue'}
            </NeonButton>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
