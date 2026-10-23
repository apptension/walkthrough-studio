/**
 * After a guided session: keep the reviewer's own recording as the take, or let the bot
 * re-record the captured steps, or record again. Shows the recording (playable, chapters to
 * seek) with what the choice means, and resolves with 'own' | 'bot' | 'again'.
 */

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const PREF = (slug) => `wt.takeChoice.${slug}`;

export function rememberedTakeChoice(slug) {
  try {
    const v = localStorage.getItem(PREF(slug));
    return v === 'own' || v === 'bot' ? v : null;
  } catch {
    return null;
  }
}

export function rememberTakeChoice(slug, choice) {
  try {
    if (choice === 'own' || choice === 'bot') localStorage.setItem(PREF(slug), choice);
  } catch {
    /* private mode */
  }
}

/** One line on what the recording holds. */
export function takeFacts(tour) {
  const take = tour?.take;
  if (!take) return '';
  const bits = [clock(take.seconds), plural(take.chapters?.length || 0, 'chapter')];
  if (tour.steps) bits.push(plural(tour.steps, 'step'));
  if (take.cuts) bits.push(`${plural(take.cuts, 'pause')} cut (${Math.round(take.cutSec)}s)`);
  return bits.join(' · ');
}

export function createTakeChoice(host, { api, escapeHtml }) {
  let settle = null;
  let slug = null;

  function paint(tour) {
    const take = tour?.take;
    const replayable = Boolean(tour?.steps);
    const remembered = rememberedTakeChoice(slug);
    const preferred = !take ? 'bot' : !replayable ? 'own' : remembered || 'own';
    const option = (id, title, body, extra = '') => `
      <button type="button" class="take-opt${preferred === id ? ' is-preferred' : ''}" data-take-choice="${id}" ${extra}>
        <span class="take-opt-ico take-opt-ico--${id}" aria-hidden="true"></span>
        <span class="take-opt-copy"><strong>${title}</strong><em>${body}</em></span>
        ${id === 'own' ? '<span class="take-opt-tag">Your take</span>' : ''}
      </button>`;
    host.innerHTML = `
      <div class="take-choice-head">
        <strong>${take ? 'Your recording is ready' : 'Your steps are saved'}</strong>
        <em>${
          take
            ? 'How should this video use it? You can switch later by recording again.'
            : 'No recording was kept (it was under a second or stopped early). The bot can record your steps.'
        }</em>
      </div>
      ${
        take
          ? `<div class="take-choice-media">
        <video src="${escapeHtml(take.url)}" ${take.poster ? `poster="${escapeHtml(take.poster)}"` : ''} controls muted playsinline preload="metadata"></video>
        <div class="take-choice-facts">
          <b>${escapeHtml(takeFacts(tour))}</b>
          ${
            take.chapters?.length
              ? `<ol class="take-chapters">${take.chapters
                  .map((c) => `<li><button type="button" data-take-seek="${c.t}"><span>${clock(c.t)}</span>${escapeHtml(c.title)}</button></li>`)
                  .join('')}</ol>`
              : ''
          }
        </div>
      </div>`
          : ''
      }
      <div class="take-choice-options" role="group" aria-label="Which take to use">
        ${
          take
            ? option('own', 'Use my recording', 'Keep it exactly as you showed it — pauses are already cut. The agent writes the narration around your chapters. Fastest.')
            : ''
        }
        ${
          replayable
            ? option('bot', 'Let the bot re-record', 'The agent tidies your steps into a script and a bot records them at a steady pace with a smooth pointer. Adds a few minutes.')
            : option('bot', 'Let the bot re-record', 'Not available — no clicks or typing were captured, so there are no steps to replay. Record again and click through the product to use the bot.', 'disabled aria-disabled="true"')
        }
      </div>
      <button type="button" class="take-again" data-take-choice="again">Record again</button>`;
    host.hidden = false;
    host.querySelector('.take-opt.is-preferred')?.focus({ preventScroll: true });
  }

  host?.addEventListener('click', (e) => {
    const seek = e.target.closest('[data-take-seek]');
    if (seek) {
      const v = host.querySelector('video');
      if (v) {
        v.currentTime = Number(seek.dataset.takeSeek) || 0;
        void v.play().catch(() => {});
      }
      return;
    }
    const btn = e.target.closest('[data-take-choice]');
    if (!btn || btn.disabled || !settle) return;
    const choice = btn.dataset.takeChoice;
    rememberTakeChoice(slug, choice);
    const done = settle;
    settle = null;
    hide();
    done.resolve(choice);
  });

  function hide() {
    host.querySelector('video')?.pause();
    host.hidden = true;
    host.innerHTML = '';
  }

  return {
    /** Ask which take to use. Rejects with a cancel error when `signal` aborts. */
    async ask(nextSlug, { signal } = {}) {
      slug = nextSlug;
      const r = await api(`/api/video/${encodeURIComponent(slug)}/guide`).catch(() => null);
      paint(r?.tour || null);
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
        signal?.addEventListener(
          'abort',
          () => {
            if (!settle) return;
            settle = null;
            hide();
            reject(new Error('cancelled'));
          },
          { once: true }
        );
      });
    },
    hide,
  };
}
