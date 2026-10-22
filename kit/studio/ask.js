// A small question in Studio's own dialog chrome — replaces window.prompt / window.confirm.
//   await ask({ title, detail, ok })                      → true | false
//   await ask({ kind: 'prompt', title, label, value, ok }) → string | null
//   await ask({ kind: 'choice', title, options, value })   → string | null  (option value)

import { icon } from './icons.js';

const ICON = {
  tag: icon('ask-tag', { size: 16 }),
  ask: icon('ask-ask', { size: 16 }),
  warn: icon('ask-warn', { size: 16 }),
  grid: icon('ask-grid', { size: 16 }),
};

let dialog = null;
let pending = null;

/** A job question stays up. A toast or a later confirm must not dismiss it. */
export function planAsk({ pending: current, incoming } = {}) {
  if (current?.job && (incoming?.toast || !incoming?.job)) return { dismiss: false, show: false };
  return { dismiss: Boolean(current), show: true };
}

export function noteToast() {
  return planAsk({ pending, incoming: { toast: true } });
}

function mount() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'sheet-dialog ask';
  dialog.id = 'askDialog';
  dialog.setAttribute('aria-labelledby', 'askTitle');
  dialog.innerHTML = `
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
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => {
    const p = pending;
    pending = null;
    if (!p) return;
    const ok = dialog.returnValue === 'ok';
    if (p.kind === 'prompt') p.resolve(ok ? dialog.querySelector('#askInput')?.value ?? '' : null);
    else if (p.kind === 'choice') {
      const picked = dialog.querySelector('#askBody .ask-choice.is-on')?.dataset.value;
      p.resolve(ok && picked != null ? picked : null);
    } else p.resolve(ok);
  });
  return dialog;
}

const text = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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
} = {}) {
  const d = mount();
  const plan = planAsk({ pending, incoming: { job, toast } });
  if (!plan.show) return Promise.resolve(kind === 'confirm' ? false : null);
  if (plan.dismiss && pending) {
    dialog.returnValue = 'cancel';
    d.close();
  }
  const warn = tone === 'warn';
  d.querySelector('#askIcon').className = `sheet-icon${warn ? ' warn' : ''}`;
  d.querySelector('#askIcon').innerHTML =
    kind === 'choice' ? ICON.grid : kind === 'prompt' ? ICON.tag : warn ? ICON.warn : ICON.ask;
  d.querySelector('#askTitle').textContent =
    title || (kind === 'prompt' ? 'Name it' : kind === 'choice' ? 'Pick one' : 'Are you sure?');
  const sub = d.querySelector('#askSub');
  sub.textContent = kind === 'confirm' ? '' : detail;
  sub.hidden = !sub.textContent;
  const body = d.querySelector('#askBody');
  if (kind === 'prompt') {
    body.innerHTML = `<label class="field-label" for="askInput">${text(label || 'Title')}</label><input id="askInput" type="${secret ? 'password' : 'text'}" value="${text(value)}" placeholder="${text(placeholder)}" autocomplete="off" spellcheck="false" />`;
  } else if (kind === 'choice') {
    const list = (options || [])
      .map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const lab = typeof o === 'string' ? o : o.label || o.value;
        const hint = typeof o === 'string' ? '' : o.hint || '';
        const still = typeof o === 'string' ? '' : o.still || '';
        const on = String(v) === String(value || options[0]?.value || options[0] || '');
        const frame = still
          ? `<span class="ask-still"><img alt="" src="${text(still)}" decoding="async" /></span><span class="ask-copy"><strong>${text(lab)}</strong>${hint ? `<span>${text(hint)}</span>` : ''}</span>`
          : `<strong>${text(lab)}</strong>${hint ? `<span>${text(hint)}</span>` : ''}`;
        return `<button type="button" class="ask-choice${still ? ' has-still' : ''}${on ? ' is-on' : ''}" data-value="${text(v)}" role="option" aria-selected="${on}">
          ${frame}
        </button>`;
      })
      .join('');
    body.innerHTML = `<div class="ask-choices" role="listbox">${list}</div>`;
    body.querySelectorAll('.ask-choice').forEach((btn) => {
      btn.onclick = () => {
        body.querySelectorAll('.ask-choice').forEach((b) => {
          b.classList.toggle('is-on', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
      };
      btn.ondblclick = () => d.querySelector('#askOk').click();
    });
  } else {
    body.innerHTML = detail ? `<p class="ask-detail">${text(detail)}</p>` : '';
  }
  const okBtn = d.querySelector('#askOk');
  okBtn.textContent = ok;
  okBtn.className = `btn ${warn ? 'warn' : 'primary'}`;
  d.querySelector('#askCancel').textContent = cancel;
  d.returnValue = 'cancel';
  return new Promise((resolve) => {
    pending = { kind, resolve, job: Boolean(job) };
    d.showModal();
    const input = d.querySelector('#askInput');
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
    } else requestAnimationFrame(() => okBtn.focus());
  });
}
