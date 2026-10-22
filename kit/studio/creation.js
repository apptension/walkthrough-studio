/**
 * The new-video creation view: replaces the wizard form while a project is prepared, so the
 * wait always shows what is happening (stage, live line, clock), what exists already (files,
 * logo, palette, type) and what comes next. It reads only the job payloads the wizard already
 * polls, so it adds no server traffic.
 */
const $ = (id) => document.getElementById(id);

export const CREATE_ORDER = ['project', 'brand', 'analyze', 'draft', 'ready'];
/** Typical seconds per stage; used for the progress curve and the "usually" hint, never as a deadline. */
const EXPECTED = { project: 2, brand: 45, analyze: 35, draft: 200, ready: 2 };
const WEIGHT = { project: 0.04, brand: 0.26, analyze: 0.12, draft: 0.54, ready: 0.04 };
const WRITE_TOOLS = /^(write|edit|multi ?edit|str ?replace|delete|notebook ?edit)$/i;

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const about = (sec) => (sec < 60 ? `~${Math.round(sec / 5) * 5 || 5} s` : `~${Math.round(sec / 60)} min`);
const fileName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');

export function createCreationView({ dialog, escapeHtml }) {
  const view = $('wizardCreation');
  let timer = 0;
  let startedAt = 0;
  let stage = null;
  let failed = false;
  const stageStart = {};
  const stageEnd = {};
  const artifacts = new Map();
  const swatches = new Set();

  function tick() {
    const now = Date.now();
    $('wizardCreationElapsed').textContent = clock((now - startedAt) / 1000);
    let progress = 0;
    for (const s of CREATE_ORDER) {
      if (stageEnd[s]) progress += WEIGHT[s];
      else if (s === stage && stageStart[s]) {
        const t = (now - stageStart[s]) / 1000;
        progress += WEIGHT[s] * (1 - Math.exp(-t / EXPECTED[s])) * 0.95;
      }
      const time = view.querySelector(`[data-create-stage="${s}"] [data-stage-time]`);
      if (time && stageStart[s]) time.textContent = clock(((stageEnd[s] || now) - stageStart[s]) / 1000);
    }
    $('wizardCreationBar').style.width = `${Math.min(100, progress * 100).toFixed(1)}%`;
    if (stage && !failed && stage !== 'ready') {
      const spent = (now - (stageStart[stage] || now)) / 1000;
      const typical = EXPECTED[stage];
      $('wizardCreationEta').textContent =
        spent > typical * 1.6 ? 'taking longer than usual — still working' : `this step usually takes ${about(typical)}`;
    }
  }

  function paintArtifacts() {
    const list = $('wizardArtifacts');
    if (!artifacts.size) {
      list.innerHTML = '<li class="is-empty">Files appear here as they are written.</li>';
      return;
    }
    list.innerHTML = [...artifacts.values()]
      .map(
        (a) =>
          `<li class="${a.fresh ? 'is-fresh' : ''}"><span class="ca-ico ca-${escapeHtml(a.kind)}" aria-hidden="true"></span>` +
          `<span class="ca-name">${escapeHtml(a.name)}</span><em>${escapeHtml(a.note || '')}</em></li>`
      )
      .join('');
    for (const a of artifacts.values()) a.fresh = false;
    list.scrollTop = list.scrollHeight;
  }

  function addArtifact(key, { name, note = '', kind = 'file' }) {
    const prev = artifacts.get(key);
    if (prev && prev.note === note) return false;
    artifacts.set(key, { name, note, kind, fresh: !prev });
    return true;
  }

  function paintSwatches() {
    const host = $('wizardBrandSwatches');
    host.innerHTML = [...swatches]
      .slice(0, 6)
      .map((c) => `<i style="background:${escapeHtml(c)}" title="${escapeHtml(c)}"></i>`)
      .join('');
    host.hidden = !swatches.size;
    $('wizardBrandCard').hidden = false;
  }

  return {
    get active() {
      return Boolean(timer);
    },

    start({ resume = false } = {}) {
      failed = false;
      if (!resume || !startedAt) {
        startedAt = Date.now();
        for (const k of Object.keys(stageStart)) delete stageStart[k];
        for (const k of Object.keys(stageEnd)) delete stageEnd[k];
        artifacts.clear();
        swatches.clear();
        paintArtifacts();
        $('wizardBrandCard').hidden = true;
        $('wizardBrandPreview').hidden = true;
        $('wizardBrandFont').hidden = true;
        view.querySelectorAll('[data-stage-time]').forEach((t) => (t.textContent = ''));
      }
      dialog.classList.add('is-creating');
      dialog.classList.remove('is-ready', 'is-failed');
      view.classList.remove('is-ready');
      const script = $('wizardScript');
      if (script) script.hidden = true;
      view.hidden = false;
      clearInterval(timer);
      timer = setInterval(tick, 500);
      tick();
    },

    stage(next, detail) {
      if (stage && stage !== next && stageStart[stage] && !stageEnd[stage]) stageEnd[stage] = Date.now();
      stage = next;
      stageStart[next] ||= Date.now();
      if (next === 'ready') stageEnd.ready = Date.now();
      failed = false;
      $('wizardCreationTitle').textContent = next === 'ready' ? 'Ready for review' : 'Preparing your video';
      if (detail) $('wizardCreationDetail').textContent = detail;
      const at = CREATE_ORDER.indexOf(next);
      view.querySelectorAll('[data-create-stage]').forEach((li) => {
        const i = CREATE_ORDER.indexOf(li.dataset.createStage);
        li.classList.toggle('done', i < at || (next === 'ready' && i <= at));
        li.classList.toggle('active', i === at && next !== 'ready');
        li.classList.remove('failed');
      });
      view.classList.toggle('is-ready', next === 'ready');
      tick();
    },

    /** Live sub-line under the active stage — the newest thing the job reported. */
    note(text) {
      const em = stage && view.querySelector(`[data-create-stage="${stage}"] [data-stage-note]`);
      if (em && text) em.textContent = text;
    },

    artifact(key, info) {
      if (addArtifact(key, info)) paintArtifacts();
    },

    /** Pull the live line, files and brand findings out of a polled job. */
    fromJob(job) {
      const entries = job?.stream?.entries || [];
      let changed = false;
      let latest = '';
      for (const e of entries) {
        const text = String(e.text || '').trim();
        if (e.kind === 'tool' && WRITE_TOOLS.test(e.title || '') && text) {
          const name = fileName(text.split('\n')[0]);
          changed = addArtifact(`f:${name}`, { name, note: /delete/i.test(e.title) ? 'removed' : e.done ? 'written' : 'writing…' }) || changed;
        }
        if (e.kind === 'line' || e.kind === 'system') {
          for (const line of text.split('\n')) {
            const msg = line.replace(/^›\s*/, '').trim();
            if (!msg) continue;
            const saved = msg.match(/^(?:Saved|Wrote) (.+?)(?: \((\w+)\))?$/);
            if (saved) {
              for (const part of saved[1].split(/,| and /).map((s) => s.trim()).filter(Boolean)) {
                changed = addArtifact(`f:${part}`, { name: part, note: saved[2] ? `logo ${saved[2]}` : 'brand pack', kind: /logo/.test(part) ? 'logo' : 'file' }) || changed;
              }
            }
            if (/^Palette:/.test(msg)) {
              for (const hex of msg.match(/#[0-9a-f]{6}\b/gi) || []) swatches.add(hex);
              paintSwatches();
            }
            const font = msg.match(/^Typeface:\s*(.+)$/);
            if (font) {
              $('wizardBrandFont').textContent = font[1];
              $('wizardBrandFont').hidden = false;
              $('wizardBrandCard').hidden = false;
            }
          }
        }
        if (text && e.kind !== 'think') latest = (e.kind === 'tool' ? `${e.title} ${fileName(text.split('\n')[0])}` : text.split('\n').filter(Boolean).at(-1) || '').replace(/^›\s*/, '');
      }
      if (latest) this.note(latest.length > 140 ? `${latest.slice(0, 137)}…` : latest);
      if (changed) paintArtifacts();
    },

    brand(slug, foundation) {
      const colors = foundation?.colors || {};
      swatches.clear();
      [colors.ink, colors.surface, colors.gold, colors.amber, colors.teal].filter(Boolean).forEach((c) => swatches.add(c));
      paintSwatches();
      const preview = $('wizardBrandPreview');
      if (foundation?.logo) {
        preview.src = `/api/video/${encodeURIComponent(slug)}/brand-file/${encodeURIComponent(foundation.logo)}?t=${Date.now()}`;
        preview.hidden = false;
      }
      if (foundation?.font?.family) {
        $('wizardBrandFont').textContent = foundation.font.family;
        $('wizardBrandFont').hidden = false;
      }
    },

    /** The finished first script, summarised in place of the progress grid. */
    script(script, { brandName = '' } = {}) {
      const host = $('wizardScript');
      if (!host) return;
      const scenes = script?.scenes || [];
      const totals = script?.totals || {};
      const minutes = totals.estSec ? `${Math.max(1, Math.round(totals.estSec / 60 * 10) / 10)} min` : '';
      $('wizardScriptMeta').textContent = [
        brandName,
        `${totals.chapters || 0} chapters`,
        `${totals.plates || 0} plates`,
        totals.words ? `${totals.words} words of narration` : '',
        minutes ? `~${minutes}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      let n = 0;
      $('wizardScriptScenes').innerHTML = scenes
        .filter((s) => ['open', 'chapter', 'plate', 'close'].includes(s.kind))
        .map((s) => {
          const mark = s.kind === 'open' ? 'Open' : s.kind === 'close' ? 'Close' : s.kind === 'plate' ? 'Plate' : String(++n);
          const line = (s.narration || s.onScreen || '').toString().trim();
          return `<li class="is-${escapeHtml(s.kind)}"><b>${escapeHtml(mark)}</b><div><strong>${escapeHtml(s.title || s.plateId || '')}</strong>${
            line ? `<em>${escapeHtml(line)}</em>` : ''
          }</div></li>`;
        })
        .join('');
      const lint = $('wizardScriptLint');
      const errors = totals.errors || 0;
      const warnings = totals.warnings || 0;
      lint.hidden = !errors && !warnings;
      lint.classList.toggle('is-error', errors > 0);
      lint.textContent = errors
        ? `${errors} blocking issue${errors === 1 ? '' : 's'} — Review script first to see and fix ${errors === 1 ? 'it' : 'them'}.`
        : `${warnings} note${warnings === 1 ? '' : 's'} from the script check — safe to render; review when you like.`;
      host.hidden = false;
      $('wizardCreationTitle').textContent = 'Your first script is ready';
      $('wizardCreationEta').textContent = 'done';
      dialog.classList.add('is-ready');
      view.classList.add('is-ready');
      clearInterval(timer);
      timer = 0;
      tick();
    },

    /** Stopped or failed: the footer offers Retry preparation / Edit brief until the next start() or exit(). */
    fail(message) {
      failed = true;
      dialog.classList.add('is-failed');
      $('wizardCreationTitle').textContent = 'Preparation needs attention';
      $('wizardCreationDetail').textContent = message;
      $('wizardCreationEta').textContent = 'stopped';
      view.querySelectorAll('[data-create-stage]').forEach((li) => {
        li.classList.toggle('failed', li.dataset.createStage === stage);
        if (li.dataset.createStage === stage) li.classList.remove('active');
      });
      clearInterval(timer);
      timer = 0;
      tick();
    },

    /** Leave creating mode (back to the form, e.g. to fix the brief after a failure). */
    exit() {
      clearInterval(timer);
      timer = 0;
      dialog.classList.remove('is-creating', 'is-ready', 'is-failed');
      view.hidden = true;
    },

    reset() {
      this.exit();
      stage = null;
      startedAt = 0;
      view.classList.remove('is-ready');
      const script = $('wizardScript');
      if (script) script.hidden = true;
    },
  };
}
