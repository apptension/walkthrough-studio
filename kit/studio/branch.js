/**
 * Branch sheet — spin focused feature videos from an overview.
 * Instant heuristic ideas, optional agent enrich, then copy + draft.
 */
export function initBranch(ctx) {
  const { $, api, state, toast, escapeHtml, openVideo, watchJob } = ctx;
  const dialog = $('branchDialog');
  if (!dialog) return { open: () => toast('Branch unavailable', 'Reload Studio', 'err') };

  const els = {
    source: $('branchSource'),
    list: $('branchIdeas'),
    status: $('branchStatus'),
    title: $('branchTitle'),
    angle: $('branchAngle'),
    outcome: $('branchOutcome'),
    create: $('btnBranchCreate'),
    discover: $('btnBranchDiscover'),
    customBtn: $('btnBranchCustom'),
    brief: $('branchBrief'),
    mode: $('branchBriefMode'),
  };

  let ideas = [];
  let selectedId = null;
  let discovering = false;

  function sourceSlug() {
    return state.slug || $('slugSelect')?.value || '';
  }

  function paintMode() {
    if (!els.mode || !els.brief || !els.customBtn) return;
    const idea = selectedId ? ideas.find((i) => i.id === selectedId) : null;
    if (idea) {
      els.mode.textContent = 'From suggestion';
      els.brief.dataset.mode = 'idea';
      els.customBtn.classList.remove('is-on');
    } else if ((els.title?.value || '').trim()) {
      els.mode.textContent = 'Your own angle';
      els.brief.dataset.mode = 'custom';
      els.customBtn.classList.add('is-on');
    } else {
      els.mode.textContent = 'Pick a suggestion or write your own';
      els.brief.dataset.mode = '';
      els.customBtn.classList.remove('is-on');
    }
  }

  function paintIdeas() {
    if (!els.list) return;
    if (!ideas.length) {
      els.list.innerHTML = `<li class="branch-empty">No suggestions yet — write your own below, or ask the agent for feature deep-dives.</li>`;
      paintMode();
      return;
    }
    els.list.innerHTML = ideas
      .map((idea) => {
        const on = idea.id === selectedId;
        return `<li class="branch-idea${on ? ' is-on' : ''}" data-idea="${escapeHtml(idea.id)}" role="option" aria-selected="${on}">
          <button type="button" class="branch-idea-btn">
            <strong>${escapeHtml(idea.title)}</strong>
            <em>${escapeHtml(idea.angle || idea.outcome || 'Feature deep dive')} · ~${idea.lengthSec || 90}s</em>
            <span class="branch-idea-meta">${escapeHtml(idea.purpose || 'feature')}${idea.source === 'agent' ? ' · agent' : ''}</span>
          </button>
        </li>`;
      })
      .join('');
    paintMode();
  }

  function selectIdea(id) {
    selectedId = id;
    const idea = ideas.find((i) => i.id === id);
    if (idea) {
      if (els.title) els.title.value = idea.title;
      if (els.angle) els.angle.value = idea.angle || '';
      if (els.outcome) els.outcome.value = idea.outcome || '';
    }
    paintIdeas();
  }

  function startCustom({ focus = true } = {}) {
    selectedId = null;
    if (els.title) els.title.value = '';
    if (els.angle) els.angle.value = '';
    if (els.outcome) els.outcome.value = '';
    paintIdeas();
    if (focus) els.title?.focus();
  }

  /** Editing the brief after picking an idea turns it into a custom branch. */
  function markEdited() {
    if (!selectedId) {
      paintMode();
      return;
    }
    const idea = ideas.find((i) => i.id === selectedId);
    const title = (els.title?.value || '').trim();
    const angle = (els.angle?.value || '').trim();
    const outcome = (els.outcome?.value || '').trim();
    if (!idea || idea.title !== title || (idea.angle || '') !== angle || (idea.outcome || '') !== outcome) {
      selectedId = null;
      paintIdeas();
    } else {
      paintMode();
    }
  }

  async function loadIdeas() {
    const slug = sourceSlug();
    if (!slug) return;
    if (els.status) els.status.textContent = 'Loading ideas…';
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug)}/branch/ideas`);
      ideas = r.ideas || [];
      if (els.status) {
        els.status.textContent = ideas.length
          ? `${ideas.length} idea${ideas.length === 1 ? '' : 's'}${r.agent ? ' · includes agent' : ' · from this story'}`
          : 'No ideas yet — write your own';
      }
      if (!selectedId && ideas[0] && !(els.title?.value || '').trim()) selectIdea(ideas[0].id);
      else paintIdeas();
    } catch (err) {
      if (els.status) els.status.textContent = err.message;
      toast('Could not load ideas', err.message, 'err');
    }
  }

  async function discover() {
    const slug = sourceSlug();
    if (!slug || discovering) return;
    discovering = true;
    if (els.discover) els.discover.disabled = true;
    if (els.status) els.status.textContent = 'Discovering with the agent…';
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug)}/branch/discover`, { method: 'POST', body: {} });
      ideas = r.ideas?.ideas || r.ideas || ideas;
      paintIdeas();
      if (r.job?.id && watchJob) {
        toast('Agent exploring', 'Ideas will refresh when the pass finishes');
        await watchJob(r.job.id, { surface: 'session' }).catch(() => null);
        await loadIdeas();
      } else {
        await loadIdeas();
        toast('Ideas ready', `${ideas.length} feature angle${ideas.length === 1 ? '' : 's'}`);
      }
    } catch (err) {
      toast('Discover failed', err.message, 'err');
      if (els.status) els.status.textContent = err.message;
    } finally {
      discovering = false;
      if (els.discover) els.discover.disabled = false;
    }
  }

  async function create() {
    const slug = sourceSlug();
    if (!slug) return;
    const title = (els.title?.value || '').trim();
    if (!title) {
      toast('Name the video', 'Pick a suggestion or type a title below', 'warn');
      els.title?.focus();
      return;
    }
    const body = {
      title,
      angle: (els.angle?.value || '').trim(),
      outcome: (els.outcome?.value || '').trim(),
      purpose: 'feature',
    };
    if (selectedId && ideas.some((i) => i.id === selectedId && i.title === title)) {
      body.ideaId = selectedId;
    } else {
      body.idea = {
        title,
        angle: body.angle,
        outcome: body.outcome,
        purpose: 'feature',
        lengthSec: 90,
        mustShow: body.angle ? [body.angle] : [title],
        plates: ['features', 'callout'],
        source: 'custom',
      };
    }
    if (els.create) els.create.disabled = true;
    try {
      const r = await api(`/api/video/${encodeURIComponent(slug)}/branch`, { method: 'POST', body });
      dialog.close();
      toast('Branch created', `${r.title || r.slug} · drafting the focused script`);
      if (openVideo) await openVideo(r.slug);
      if (r.job?.id && watchJob) {
        watchJob(r.job.id, { surface: 'session' })
          .then(() => {
            toast('Branch draft ready', 'Review the script, then record');
            return openVideo?.(r.slug);
          })
          .catch((err) => {
            if (!/cancel/i.test(err.message || '')) toast('Branch draft', err.message, 'warn');
          });
      }
    } catch (err) {
      toast('Branch not created', err.message, 'err');
    } finally {
      if (els.create) els.create.disabled = false;
    }
  }

  function open() {
    const slug = sourceSlug();
    if (!slug) {
      toast('Open a video first', 'Branch copies the current project', 'warn');
      return;
    }
    if (els.source) els.source.textContent = state.video?.title || slug;
    selectedId = null;
    if (els.title) els.title.value = '';
    if (els.angle) els.angle.value = '';
    if (els.outcome) els.outcome.value = '';
    paintMode();
    dialog.showModal();
    loadIdeas();
  }

  els.list?.addEventListener('click', (e) => {
    const li = e.target.closest('[data-idea]');
    if (li) selectIdea(li.dataset.idea);
  });
  els.discover?.addEventListener('click', discover);
  els.customBtn?.addEventListener('click', () => startCustom());
  els.create?.addEventListener('click', create);
  for (const el of [els.title, els.angle, els.outcome]) {
    el?.addEventListener('input', markEdited);
  }
  dialog.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));

  $('btnBranch')?.addEventListener('click', open);

  return { open, loadIdeas };
}
