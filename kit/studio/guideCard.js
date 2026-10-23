/**
 * The live card for a guided session: the reviewer drives a real browser window beside a
 * Recorder window; this card mirrors it — where they are in the journey, what to do next, the
 * REC timer — and has the same controls. Status comes from GET /guide (written by the session on
 * every change); buttons go through POST /guide/control, which the session picks up in a moment.
 */

const STATE_COPY = {
  connecting: ['Opening the browser…', 'A browser window and a Recorder window open in a moment.'],
  ready: ['Get ready — not recording yet', 'Look around freely. Nothing is filmed until you press Start recording.'],
  signin: ['Sign in first — not recording', 'Your sign-in never reaches the video. Press Start recording once you are in.'],
  countdown: ['Recording starts…', 'Take your hand off the mouse — the first screen holds while the opening card plays.'],
  capturing: ['Recording', 'Everything in the browser window is filmed. Show the tour the way you would present it.'],
  paused: ['Paused — not recording', 'Set up the next screen. This stretch is cut from the video and left out of the steps.'],
  finishing: ['Saving your recording…', 'Your recording, steps and screenshots are being written.'],
  done: ['Saved', 'Choose how to use it below.'],
};

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function guideStatusLine(status) {
  if (!status) return '';
  const parts = [plural(status.steps || 0, 'step')];
  if (status.marks) parts.push(plural(status.marks, 'chapter'));
  if (status.cuts) parts.push(`${plural(status.cuts, 'pause')} cut`);
  return parts.join(' · ');
}

/** The reviewer's journey, with where they are now. */
export function guideJourney(status) {
  const state = status?.state || 'connecting';
  const steps = [
    ...(status?.needsSignIn ? [['signin', 'Sign in in the browser window']] : []),
    ['screen', 'Go to the screen your video opens on'],
    ['start', 'Press <b>Start recording</b> — a 3-second countdown follows'],
    ['show', 'Show the tour. <b>Mark chapter</b> for each part; <b>Pause</b> to set something up off camera'],
    ['finish', 'Press <b>Finish recording</b>'],
    ['choose', 'Choose: use your recording, or let the bot re-record'],
  ];
  const at =
    state === 'connecting' || state === 'ready'
      ? steps[0][0]
      : state === 'countdown'
        ? 'start'
        : state === 'capturing' || state === 'paused'
          ? 'show'
          : 'choose';
  const i = steps.findIndex(([id]) => id === at);
  return steps.map(([id, html], n) => ({ id, html, state: n < i ? 'done' : n === i ? 'now' : 'next' }));
}

const ACTIONS = {
  ready: [
    ['start', 'Start recording', 'btn guide-rec-btn'],
    ['cancel', 'Cancel', 'btn ghost'],
  ],
  countdown: [['stop-countdown', 'Not yet', 'btn ghost']],
  capturing: [
    ['mark', 'Mark chapter', 'btn'],
    ['pause', 'Pause', 'btn'],
    ['finish', 'Finish recording', 'btn primary'],
  ],
  paused: [
    ['resume', 'Resume recording', 'btn guide-rec-btn'],
    ['finish', 'Finish recording', 'btn'],
  ],
};

export function createGuideCard(host, { api, escapeHtml, onFinish = null }) {
  let slug = null;
  let polling = 0;
  let ticking = 0;
  let lastFetch = 0;
  let status = null;
  let pending = '';
  let marking = false;
  let shape = '';

  const live = () => {
    if (!status) return { rec: 0, count: 0 };
    const since = status.updatedAt ? Math.max(0, (Date.now() - Date.parse(status.updatedAt)) / 1000) : 0;
    return {
      rec: (status.recSec || 0) + (status.state === 'capturing' ? since : 0),
      count: Math.max(1, Math.ceil((status.countdownMs || 0) / 1000 - since)),
    };
  };

  function tick() {
    if (!host || !slug) return;
    const { rec, count } = live();
    const timer = host.querySelector('[data-guide-timer]');
    if (timer) timer.textContent = status?.recording ? clock(rec) : '';
    const c = host.querySelector('[data-guide-count]');
    if (c) c.textContent = String(count);
  }

  function paint() {
    if (!host || !slug) return;
    const raw = pending === 'finish' && !['finishing', 'done'].includes(status?.state) ? 'finishing' : status?.state || 'connecting';
    const state = raw === 'ready' && status?.needsSignIn ? 'signin' : raw;
    const next = `${state}|${status?.steps || 0}|${status?.marks || 0}|${status?.cuts || 0}|${status?.last || ''}|${pending}|${marking}`;
    if (next === shape) return tick();
    shape = next;
    const [title, hint] = STATE_COPY[state] || STATE_COPY.capturing;
    const counts = guideStatusLine(status);
    const actions = ACTIONS[raw] || [];
    const typed = host.querySelector('[data-guide-mark] input')?.value || '';
    host.dataset.state = state;
    host.innerHTML = `
      <div class="guide-card-head">
        <span class="guide-rec" aria-hidden="true"><i></i></span>
        <div class="guide-card-titles">
          <strong>${escapeHtml(title)}${state === 'countdown' ? ` <span class="guide-count" data-guide-count></span>` : ''}</strong>
          <em>${escapeHtml(hint)}</em>
        </div>
        <span class="guide-timer" data-guide-timer aria-label="Recorded time"></span>
      </div>
      <ol class="guide-journey">
        ${guideJourney(status)
          .map((s) => `<li data-step="${s.id}" class="is-${s.state}"${s.state === 'now' ? ' aria-current="step"' : ''}><span>${s.html}</span></li>`)
          .join('')}
      </ol>
      ${
        state === 'connecting' || state === 'finishing' || state === 'done'
          ? ''
          : `<div class="guide-card-live">
        <b>${escapeHtml(counts)}</b>
        ${status?.last && (raw === 'capturing' || raw === 'paused') ? `<span>Last: ${escapeHtml(status.last)}</span>` : ''}
      </div>`
      }
      ${
        marking
          ? `<form class="guide-mark" data-guide-mark>
        <input type="text" maxlength="60" placeholder="Chapter title — e.g. Plan the week (optional)" aria-label="Chapter title" autocomplete="off" />
        <button type="submit" class="btn primary">Add chapter</button>
        <button type="button" class="btn ghost" data-guide-mark-cancel>Cancel</button>
      </form>`
          : ''
      }
      ${
        actions.length
          ? `<div class="guide-actions">${actions
              .map(([a, label, cls]) => `<button type="button" class="${cls}" data-guide-action="${a}" ${pending ? 'disabled' : ''}>${escapeHtml(label)}</button>`)
              .join('')}</div>
      <p class="guide-card-foot">The same controls are in the <b>Recorder</b> window beside the browser.</p>`
          : ''
      }`;
    host.hidden = false;
    const input = marking ? host.querySelector('[data-guide-mark] input') : null;
    if (input) {
      input.value = typed;
      input.focus();
    }
    tick();
  }

  async function refresh(force = false) {
    if (!slug) return;
    const now = Date.now();
    if (!force && now - lastFetch < 900) return;
    lastFetch = now;
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug)}/guide`);
      status = r.tour?.status || null;
      if (pending && pending !== 'finish') pending = '';
      paint();
    } catch {
      /* the card is advisory; the job stream still shows progress */
    }
  }

  async function send(action, extra = {}) {
    if (!slug) return;
    pending = action;
    paint();
    try {
      if (action === 'finish') {
        await api(`/api/video/${encodeURIComponent(slug)}/guide/finish`, { method: 'POST' });
        onFinish?.(slug);
      } else {
        await api(`/api/video/${encodeURIComponent(slug)}/guide/control`, { method: 'POST', body: { action, ...extra } });
      }
      setTimeout(() => void refresh(true), 450);
    } catch {
      pending = '';
      paint();
    }
  }

  host?.addEventListener('click', (e) => {
    if (e.target.closest('[data-guide-mark-cancel]')) {
      marking = false;
      return paint();
    }
    const btn = e.target.closest('[data-guide-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.guideAction;
    if (action === 'mark') {
      marking = true;
      return paint();
    }
    void send(action);
  });
  host?.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-guide-mark]');
    if (!form) return;
    e.preventDefault();
    const title = form.querySelector('input')?.value.trim() || '';
    marking = false;
    void send('mark', { title });
  });

  return {
    show(nextSlug) {
      slug = nextSlug;
      status = null;
      pending = '';
      marking = false;
      shape = '';
      paint();
      clearInterval(polling);
      clearInterval(ticking);
      polling = setInterval(() => void refresh(), 1200);
      ticking = setInterval(tick, 250);
      void refresh(true);
    },
    refresh,
    hide() {
      clearInterval(polling);
      clearInterval(ticking);
      polling = 0;
      ticking = 0;
      slug = null;
      status = null;
      pending = '';
      marking = false;
      shape = '';
      if (host) {
        host.hidden = true;
        host.innerHTML = '';
      }
    },
    get slug() {
      return slug;
    },
  };
}
