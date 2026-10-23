// A small question in Studio's own dialog chrome — replaces window.prompt / window.confirm.
//   await ask({ title, detail, ok })                      → true | false
//   await ask({ kind: 'prompt', title, label, value, ok }) → string | null
//   await ask({ kind: 'choice', title, options, value })   → string | null  (option value)

import { icon } from '@/ui/iconString';
import { asText } from './text';

const ICON = {
  tag: icon('ask-tag', { size: 16 }),
  ask: icon('ask-ask', { size: 16 }),
  warn: icon('ask-warn', { size: 16 }),
  grid: icon('ask-grid', { size: 16 }),
};

export type AskKind = 'confirm' | 'prompt' | 'choice';

export interface AskChoiceOption {
  value: string;
  label?: string;
  hint?: string;
  still?: string;
}

export interface AskOptions {
  kind?: AskKind;
  title?: string;
  detail?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  options?: (string | AskChoiceOption)[];
  ok?: string;
  cancel?: string;
  tone?: string;
  secret?: boolean;
  job?: boolean;
  toast?: boolean;
}

interface PendingAsk {
  kind: AskKind;
  resolve: (value: string | boolean | null) => void;
  job: boolean;
}

export interface AskPlanInput {
  pending?: { job?: boolean; kind?: string } | null;
  incoming?: { job?: boolean; toast?: boolean } | null;
}

export interface AskPlan {
  dismiss: boolean;
  show: boolean;
}

let dialog: HTMLDialogElement | null = null;
let pending: PendingAsk | null = null;

/** A job question stays up. A toast or a later confirm must not dismiss it. */
export function planAsk({ pending: current, incoming }: AskPlanInput = {}): AskPlan {
  if (current?.job && (incoming?.toast || !incoming?.job)) return { dismiss: false, show: false };
  return { dismiss: Boolean(current), show: true };
}

export function noteToast(): AskPlan {
  return planAsk({ pending, incoming: { toast: true } });
}

function mount(): HTMLDialogElement {
  if (dialog) return dialog;
  const d = document.createElement('dialog');
  dialog = d;
  d.className = 'sheet-dialog ask';
  d.id = 'askDialog';
  d.setAttribute('aria-labelledby', 'askTitle');
  d.innerHTML = `
    <form method="dialog" class="sheet-form">
      <header class="sheet-head">
        <span class="sheet-icon" id="askIcon" aria-hidden="true"></span>
        <div class="sheet-titles">
          <h2 id="askTitle"></h2>
          <p class="sheet-sub" id="askSub"></p>
        </div>
      </header>
      <div class="sheet-body" id="askBody"></div>
      <footer class="sheet-foot">
        <div class="sheet-actions">
          <button type="submit" class="btn ghost" id="askCancel" value="cancel">Cancel</button>
          <button type="submit" class="btn primary" id="askOk" value="ok">Continue</button>
        </div>
      </footer>
    </form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => {
    const p = pending;
    pending = null;
    if (!p) return;
    const ok = d.returnValue === 'ok';
    if (p.kind === 'prompt') p.resolve(ok ? (d.querySelector<HTMLInputElement>('#askInput')?.value ?? '') : null);
    else if (p.kind === 'choice') {
      const picked = d.querySelector<HTMLElement>('#askBody .ask-choice.is-on')?.dataset.value;
      p.resolve(ok && picked != null ? picked : null);
    } else p.resolve(ok);
  });
  return d;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const text = (s: unknown): string => asText(s ?? '').replace(/[&<>"]/g, (c) => ESC[c] ?? c);

function el<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector<T>(selector) as T;
}

export function ask(opts: AskOptions & { kind: 'prompt' | 'choice' }): Promise<string | null>;
export function ask(opts?: AskOptions & { kind?: 'confirm' }): Promise<boolean>;
export function ask(opts?: AskOptions): Promise<string | boolean | null>;
export function ask({
  kind = 'confirm',
  title,
  detail = '',
  label = '',
  value = '',
  placeholder = '',
  options = [],
  ok = 'Continue',
  cancel = 'Cancel',
  tone = 'accent',
  secret = false,
  job = false,
  toast = false,
}: AskOptions = {}): Promise<string | boolean | null> {
  const d = mount();
  const plan = planAsk({ pending, incoming: { job, toast } });
  if (!plan.show) return Promise.resolve(kind === 'confirm' ? false : null);
  if (plan.dismiss && pending) {
    d.returnValue = 'cancel';
    d.close();
  }
  const warn = tone === 'warn';
  el(d, '#askIcon').className = `sheet-icon${warn ? ' warn' : ''}`;
  el(d, '#askIcon').innerHTML =
    kind === 'choice' ? ICON.grid : kind === 'prompt' ? ICON.tag : warn ? ICON.warn : ICON.ask;
  el(d, '#askTitle').textContent =
    title || (kind === 'prompt' ? 'Name it' : kind === 'choice' ? 'Pick one' : 'Are you sure?');
  const sub = el(d, '#askSub');
  sub.textContent = kind === 'confirm' ? '' : detail;
  sub.hidden = !sub.textContent;
  const body = el(d, '#askBody');
  if (kind === 'prompt') {
    body.innerHTML = `<label class="field-label" for="askInput">${text(label || 'Title')}</label><input id="askInput" type="${secret ? 'password' : 'text'}" value="${text(value)}" placeholder="${text(placeholder)}" autocomplete="off" spellcheck="false" />`;
  } else if (kind === 'choice') {
    const first = options[0];
    const firstValue = typeof first === 'string' ? undefined : first?.value;
    const list = (options || [])
      .map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label || o.value;
        const hint = typeof o === 'string' ? '' : o.hint || '';
        const still = typeof o === 'string' ? '' : o.still || '';
        const on = asText(v) === asText(value || firstValue || first || '');
        const frame = still
          ? `<span class="ask-still"><img alt="" src="${text(still)}" decoding="async" /></span><span class="ask-copy"><strong>${text(lab)}</strong>${hint ? `<span>${text(hint)}</span>` : ''}</span>`
          : `<strong>${text(lab)}</strong>${hint ? `<span>${text(hint)}</span>` : ''}`;
        return `<button type="button" class="ask-choice${still ? ' has-still' : ''}${on ? ' is-on' : ''}" data-value="${text(v)}" role="option" aria-selected="${on}">
          ${frame}
        </button>`;
      })
      .join('');
    body.innerHTML = `<div class="ask-choices" role="listbox">${list}</div>`;
    body.querySelectorAll<HTMLElement>('.ask-choice').forEach((btn) => {
      btn.onclick = () => {
        body.querySelectorAll('.ask-choice').forEach((b) => {
          b.classList.toggle('is-on', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
      };
      btn.ondblclick = () => {
        el(d, '#askOk').click();
      };
    });
  } else {
    body.innerHTML = detail ? `<p class="ask-detail">${text(detail)}</p>` : '';
  }
  const okBtn = el<HTMLButtonElement>(d, '#askOk');
  okBtn.textContent = ok;
  okBtn.className = `btn ${warn ? 'warn' : 'primary'}`;
  el(d, '#askCancel').textContent = cancel;
  d.returnValue = 'cancel';
  return new Promise((resolve) => {
    pending = { kind, resolve, job: Boolean(job) };
    d.showModal();
    const input = d.querySelector<HTMLInputElement>('#askInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          okBtn.click();
        }
      });
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else
      requestAnimationFrame(() => {
        okBtn.focus();
      });
  });
}
