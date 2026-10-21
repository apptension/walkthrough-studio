// A small question in Studio's own dialog chrome — replaces window.prompt / window.confirm.
//   await ask({ title, detail, ok })                      → true | false
//   await ask({ kind: 'prompt', title, label, value, ok }) → string | null
//   await ask({ kind: 'choice', title, options, value })   → string | null  (option value)

const ICON = {
  tag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/></svg>',
  ask: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9"/><path d="M12 17h.01"/></svg>',
  warn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
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
