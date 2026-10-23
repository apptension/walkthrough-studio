/**
 * The Recorder window of a guided session: what is happening, what to do next, and the controls
 * (Start recording · Mark chapter · Pause · Undo · Finish). It is its own browser window in its
 * own context, beside the app window, so nothing in it is ever filmed or captured as a step, and
 * the app's scripts never see it. Closing it by accident brings it back.
 */

export const PANEL = { width: 360, height: 700 };

/** Self-contained (serialised into the panel page). `send(action, extra)` goes to the session. */
function panelScript() {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  let s = { mode: 'connecting' };
  let got = Date.now();
  let flashTimer = 0;
  const send = (action, extra = {}) => window.__wtRecorder?.(action, extra);
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const COPY = {
    connecting: { pill: 'Not recording', title: 'Opening the app…', body: (x) => `Loading ${x.host || 'the start page'} in the browser window.`, todo: [] },
    ready: {
      pill: 'Not recording',
      title: (x) => (x.needsSignIn ? 'Sign in first' : 'Get ready'),
      body: (x) => (x.needsSignIn ? 'Nothing is being recorded. Your sign-in never reaches the video.' : 'Nothing is being recorded yet — look around freely.'),
      todo: (x) => [
        ...(x.needsSignIn ? ['Sign in in the browser window.'] : []),
        'Go to the screen your video should open on.',
        'Press <b>Start recording</b>. A 3-second countdown follows.',
      ],
    },
    countdown: { pill: 'Starting…', title: 'Recording starts in', body: () => 'Take your hand off the mouse. The first screen holds while the opening card plays.', todo: [] },
    capturing: {
      pill: 'REC',
      title: 'Recording',
      body: () => 'Everything in the browser window is filmed. Show the tour the way you would present it.',
      todo: () => [
        'Click, type and scroll at a calm pace.',
        '<b>Mark chapter</b> when a new part of the story starts, then hold still while its card shows.',
        '<b>Pause</b> to set something up off camera — that stretch is cut.',
        '<b>Finish recording</b> when you are done.',
      ],
    },
    paused: {
      pill: 'Paused',
      title: 'Paused — not recording',
      body: () => 'Set up the next screen. Everything you do now is cut from the video and left out of the steps.',
      todo: () => ['Press <b>Resume recording</b> when the screen is ready.', 'Or <b>Finish recording</b> if the tour is complete.'],
    },
    finishing: { pill: 'Saving', title: 'Saving your recording…', body: () => 'Keep this window open for a moment.', todo: [] },
    done: {
      pill: 'Saved',
      title: 'Saved',
      body: (x) =>
        x.take
          ? `Your recording (${clock(x.take.seconds)}) and its steps are in Studio. Choose there: use your recording, or let the bot re-record the steps.`
          : 'Your steps are in Studio. This browser closes now.',
      todo: [],
    },
  };
  const BUTTONS = {
    ready: [
      ['start', 'Start recording', 'rec'],
      ['cancel', 'Cancel', 'ghost'],
    ],
    countdown: [['stop-countdown', 'Not yet', 'ghost']],
    capturing: [
      ['mark', 'Mark chapter', ''],
      ['pause', 'Pause', ''],
      ['undo', 'Undo last step', 'ghost'],
      ['finish', 'Finish recording', 'primary'],
    ],
    paused: [
      ['resume', 'Resume recording', 'rec'],
      ['finish', 'Finish recording', ''],
      ['undo', 'Undo last step', 'ghost'],
    ],
  };
  const TITLES = {
    start: 'Start filming the browser window after a 3-second countdown',
    cancel: 'Close the browser without recording',
    mark: 'Start a new chapter here — its card appears in the video',
    pause: 'Stop filming while you set something up; the pause is cut',
    undo: 'Drop the last step from the bot’s script (your recording still shows it)',
    finish: 'Save the recording and close the browser',
    resume: 'Film again from the screen as it is now',
  };

  const pick = (v) => (typeof v === 'function' ? v(s) : v);
  let shape = '';
  const paint = () => {
    const c = COPY[s.mode] || COPY.connecting;
    const since = (Date.now() - got) / 1000;
    main.dataset.mode = s.mode;
    $('pill').textContent = pick(c.pill);
    const rec = s.mode === 'capturing' ? (s.recSec || 0) + since : s.recSec || 0;
    $('timer').textContent = s.mode === 'capturing' || s.mode === 'paused' || (s.mode === 'done' && s.take) ? clock(s.mode === 'done' ? s.take.seconds : rec) : '';
    $('title').textContent = pick(c.title);
    $('body').textContent = pick(c.body);
    const left = Math.max(0, (s.countdownMs || 0) / 1000 - since);
    $('count').textContent = s.mode === 'countdown' ? String(Math.max(1, Math.ceil(left))) : '';
    const hold = Math.max(0, (s.holdMs || 0) / 1000 - since);
    $('hold').hidden = !(s.mode === 'capturing' && hold > 0);
    if (!$('hold').hidden) {
      $('holdSec').textContent = String(Math.ceil(hold));
      $('holdArc').style.strokeDashoffset = String(100 - (hold / Math.max(0.1, (s.holdTotalMs || 2600) / 1000)) * 100);
      $('holdWhat').textContent = s.holdWhat || 'Chapter card on screen';
    }
    const next = `${s.mode}|${s.needsSignIn}|${s.steps > 0}`;
    if (next !== shape) {
      shape = next;
      $('todo').innerHTML = pick(c.todo)
        .map((t) => `<li><span>${t}</span></li>`)
        .join('');
      const buttons = BUTTONS[s.mode] || [];
      $('actions').innerHTML = buttons.map(([a, label, kind]) => `<button type="button" data-a="${a}" class="${kind}" title="${TITLES[a] || ''}">${label}</button>`).join('');
      if (s.mode !== 'capturing') $('markForm').hidden = true;
    }
    const undo = $('actions').querySelector('[data-a="undo"]');
    if (undo) undo.disabled = !s.steps;
    const bits = [];
    if (s.mode !== 'connecting') bits.push(plural(s.steps || 0, 'step'), plural(s.marks || 0, 'chapter'));
    if (s.cuts) bits.push(`${plural(s.cuts, 'pause')} cut${s.cutSec >= 1 ? ` (${Math.round(s.cutSec)}s)` : ''}`);
    $('stats').textContent = bits.join(' · ');
    $('last').textContent = s.last && (s.mode === 'capturing' || s.mode === 'paused') ? `Last: ${s.last}` : '';
  };
  window.__wtPanel = (next) => {
    s = next;
    got = Date.now();
    if (next.flash) {
      const f = $('flash');
      f.textContent = next.flash;
      f.classList.add('on');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => f.classList.remove('on'), 3200);
    }
    paint();
  };
  setInterval(paint, 200);

  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const a = b.dataset.a;
    if (a === 'mark') {
      $('markForm').hidden = false;
      $('markTitle').focus();
      return;
    }
    send(a);
  });
  $('markForm').addEventListener('submit', (e) => {
    e.preventDefault();
    send('mark', { title: $('markTitle').value.trim() });
    $('markTitle').value = '';
    $('markForm').hidden = true;
  });
  $('markCancel').addEventListener('click', () => ($('markForm').hidden = true));
  $('markTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('markForm').hidden = true;
  });
  paint();
}

const PANEL_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Recorder · Walkthrough Studio</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0f110f;color:#f2f3f1;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;-webkit-font-smoothing:antialiased}
  main{position:relative;display:flex;flex-direction:column;gap:16px;min-height:100%;padding:18px 20px 16px}
  header{display:flex;align-items:center;gap:9px}
  .dot{width:10px;height:10px;border-radius:50%;background:#7c807c;flex:none}
  main[data-mode=capturing] .dot{background:#ff4b4b;box-shadow:0 0 0 0 rgba(255,75,75,.55);animation:pulse 1.4s ease-out infinite}
  main[data-mode=paused] .dot,main[data-mode=countdown] .dot{background:#f3b23a}
  main[data-mode=done] .dot{background:#5ad18a}
  @keyframes pulse{to{box-shadow:0 0 0 10px rgba(255,75,75,0)}}
  .pill{font:650 11px/1 ui-sans-serif,system-ui;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,243,241,.7)}
  main[data-mode=capturing] .pill{color:#ff6b6b}
  main[data-mode=paused] .pill{color:#f3b23a}
  .timer{margin-left:auto;font:600 20px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;color:#f2f3f1}
  main[data-mode=paused] .timer{color:rgba(242,243,241,.5)}
  .hero{display:flex;flex-direction:column;gap:6px}
  .count{font:700 64px/1 ui-sans-serif,system-ui;letter-spacing:-.03em;color:#f3b23a}
  .count:empty{display:none}
  h1{margin:0;font-size:21px;line-height:1.2;font-weight:700;letter-spacing:-.015em}
  p{margin:0;color:rgba(242,243,241,.72)}
  ol{margin:0;padding:0;list-style:none;counter-reset:n;display:flex;flex-direction:column;gap:9px}
  ol:empty{display:none}
  li{counter-increment:n;display:grid;grid-template-columns:22px 1fr;gap:10px;color:rgba(242,243,241,.88)}
  li::before{content:counter(n);display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.08);font:650 11.5px/1 ui-sans-serif,system-ui;color:rgba(242,243,241,.8)}
  b{font-weight:650;color:#fff}
  .hold{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(243,178,58,.1);border:1px solid rgba(243,178,58,.35)}
  .hold[hidden]{display:none}
  .hold div:last-child{display:flex;flex-direction:column}
  .hold span{color:rgba(242,243,241,.72);font-size:12.5px}
  .ring{position:relative;width:40px;height:40px;flex:none}
  .ring svg{transform:rotate(-90deg)}
  .ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:14px}
  form{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
  form[hidden]{display:none}
  label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:rgba(242,243,241,.7)}
  input{all:unset;padding:9px 11px;border-radius:9px;background:rgba(255,255,255,.08);color:#f2f3f1;font-size:14px}
  input:focus{outline:2px solid rgba(255,255,255,.35)}
  .row{display:flex;gap:8px}
  .actions{position:sticky;bottom:0;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto;padding-top:8px;background:linear-gradient(to bottom,rgba(15,17,15,0),#0f110f 10px)}
  .actions:empty{display:none}
  button{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:9px 12px;border-radius:10px;font-weight:650;font-size:13.5px;text-align:center;color:#f2f3f1;background:rgba(255,255,255,.09);transition:background .15s,transform .05s}
  button:hover{background:rgba(255,255,255,.15)}
  button:active{transform:translateY(1px)}
  button:focus-visible{outline:2px solid rgba(255,255,255,.5);outline-offset:2px}
  button[disabled]{opacity:.38;cursor:default}
  button.primary{background:#f2f3f1;color:#0f110f}
  button.primary:hover{background:#fff}
  button.rec{grid-column:1/-1;min-height:48px;font-size:15px;background:#e5383b;color:#fff}
  button.rec::before{content:'';width:10px;height:10px;border-radius:50%;background:#fff}
  button.rec:hover{background:#f04446}
  button.ghost{background:transparent;color:rgba(242,243,241,.7);border:1px solid rgba(255,255,255,.12)}
  button.ghost:hover{background:rgba(255,255,255,.06);color:#f2f3f1}
  main[data-mode=ready] button.ghost,main[data-mode=countdown] button.ghost{grid-column:1/-1}
  footer{display:flex;flex-direction:column;gap:3px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(242,243,241,.55)}
  footer span:empty{display:none}
  #last{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .flash{max-height:0;margin:-8px 0;overflow:hidden;padding:0 12px;border-radius:10px;background:#232723;border:1px solid transparent;font-size:12.5px;line-height:1.4;color:rgba(242,243,241,.9);opacity:0;transition:max-height .25s,opacity .2s,padding .25s,margin .25s}
  .flash.on{max-height:90px;margin:0;padding:9px 12px;border-color:rgba(255,255,255,.12);opacity:1}
</style></head><body><main data-mode="connecting">
  <header><span class="dot"></span><span class="pill" id="pill">Not recording</span><span class="timer" id="timer"></span></header>
  <section class="hero"><div class="count" id="count"></div><h1 id="title">Opening the app…</h1><p id="body"></p></section>
  <div class="hold" id="hold" hidden>
    <div class="ring"><svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(243,178,58,.25)" stroke-width="4"/><circle id="holdArc" cx="20" cy="20" r="16" fill="none" stroke="#f3b23a" stroke-width="4" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg><b id="holdSec">3</b></div>
    <div><strong id="holdWhat">Chapter card on screen</strong><span>Hold still — no clicks or scrolling.</span></div>
  </div>
  <ol id="todo"></ol>
  <form id="markForm" hidden><label>Chapter title<input id="markTitle" maxlength="60" placeholder="e.g. Plan the week (optional)" autocomplete="off"></label>
    <div class="row"><button type="submit" class="primary">Add chapter</button><button type="button" id="markCancel" class="ghost">Cancel</button></div></form>
  <div class="flash" id="flash" role="status"></div>
  <div class="actions" id="actions"></div>
  <footer><span id="stats"></span><span id="last"></span></footer>
</main></body></html>`;

/**
 * Open the Recorder window. `onAction(action, extra)` receives every button press.
 * @returns {{ page: () => import('playwright').Page | null, update: (state: object) => Promise<void>, place: (bounds: object) => Promise<void>, close: () => Promise<void> }}
 */
export async function openRecorderPanel(browser, { headless = false, onAction, say = () => {} }) {
  const context = await browser.newContext(headless ? { viewport: PANEL } : { viewport: null });
  await context.exposeBinding('__wtRecorder', (_src, action, extra) => onAction(String(action || ''), extra || {}));
  let page = null;
  let last = null;
  let bounds = null;
  let closing = false;
  const fitWindow = async () => {
    if (headless || !bounds || !page) return;
    try {
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds });
    } catch {
      /* the launch size still works */
    }
  };
  /** A popup window: no tab strip or address bar, and narrower than a browser window may be. */
  const popup = async () => {
    const opener = await context.newPage();
    if (headless) return opener;
    const at = bounds || { left: 20, top: 20, width: PANEL.width, height: PANEL.height };
    const [win] = await Promise.all([
      context.waitForEvent('page', { timeout: 5000 }),
      opener.evaluate(
        (b) => void window.open('about:blank', 'wt-recorder', `popup,width=${b.width},height=${b.height},left=${b.left},top=${b.top}`),
        at
      ),
    ]).catch(() => [null]);
    if (!win) return opener;
    await opener.close().catch(() => {});
    return win;
  };
  const open = async () => {
    page = await popup();
    page.on('close', () => {
      if (closing) return;
      say('the Recorder window was closed — reopening it');
      void open().catch(() => {});
    });
    await page.setContent(PANEL_HTML);
    await page.evaluate(panelScript);
    await fitWindow();
    if (last) await page.evaluate((s) => window.__wtPanel?.(s), { ...last, flash: '' }).catch(() => {});
    await page.bringToFront().catch(() => {});
  };
  await open();
  return {
    page: () => page,
    async update(state) {
      last = state;
      if (!page || page.isClosed()) return;
      await page.evaluate((s) => window.__wtPanel?.(s), state).catch(() => {});
    },
    async place(next) {
      bounds = next;
      await fitWindow();
      await page?.bringToFront().catch(() => {});
    },
    async close() {
      closing = true;
      await context.close().catch(() => {});
    },
  };
}
