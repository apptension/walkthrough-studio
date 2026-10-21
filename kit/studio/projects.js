/**
 * New-video wizard: brief → POST /api/projects → (brand discovery) → product map (analyze) →
 * agent first draft → script review. Nothing is recorded until the script is approved.
 */
import { paintAgentStream } from './agentStream.js';
import { createCreationView } from './creation.js';

const $ = (id) => document.getElementById(id);
const STEPS = 5;

export function initProjects(ctx) {
  const { api, toast, escapeHtml, openVideo, openScript, watchJob } = ctx;
  const form = $('projectForm');
  const dialog = $('projectDialog');
  const creation = createCreationView({ dialog, escapeHtml });
  let step = 0;
  let created = null;
  let creationStage = null;
  let creating = false;
  let currentJobId = null;
  let stopRequested = false;

  const val = (name) => form.elements[name]?.value?.trim() || '';
  const checked = (name) => Boolean(form.elements[name]?.checked);
  const radio = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || '';

  function clearError() {
    $('wizardError').hidden = true;
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function showError(message, field) {
    $('wizardError').textContent = message;
    $('wizardError').hidden = false;
    const el = field && form.elements[field];
    if (el && !(el instanceof RadioNodeList)) {
      el.setAttribute('aria-invalid', 'true');
      el.focus();
    }
    form.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showStep(n, { focus = true } = {}) {
    step = Math.max(0, Math.min(STEPS - 1, n));
    form.querySelectorAll('fieldset[data-step]').forEach((fs) => (fs.hidden = Number(fs.dataset.step) !== step));
    document.querySelectorAll('#wizardSteps li').forEach((li) => {
      const i = Number(li.dataset.step);
      li.classList.toggle('active', i === step);
      li.classList.toggle('done', i < step);
      const btn = li.querySelector('button');
      if (i === step) btn?.setAttribute('aria-current', 'step');
      else btn?.removeAttribute('aria-current');
    });
    $('btnWizardBack').disabled = step === 0;
    $('btnWizardBack').lastChild.textContent = 'Back';
    $('btnWizardNext').textContent = step === STEPS - 1 ? (checked('runDraft') ? 'Create & draft' : 'Create project') : 'Continue';
    $('wizardStepMeta').textContent = `Step ${step + 1} of ${STEPS}`;
    $('wizardProgressBar').style.width = `${((step + 1) / STEPS) * 100}%`;
    clearError();
    form.scrollTop = 0;
    if (step === STEPS - 1) renderSummary();
    if (focus && step !== 3) {
      form
        .querySelector(`fieldset[data-step="${step}"] input:not([type=radio]):not([type=checkbox]), fieldset[data-step="${step}"] textarea`)
        ?.focus({ preventScroll: true });
    }
  }

  function syncConditional() {
    const isNew = radio('brandMode') === 'new';
    form.querySelector('[data-brand="existing"]').hidden = isNew;
    form.querySelector('[data-brand="new"]').hidden = !isNew;
    $('wizardDiscoverRow').hidden = !isNew;
    form.querySelectorAll('[data-login]').forEach((el) => (el.hidden = !checked('loginRequired')));
    if (step === STEPS - 1) showStep(step, { focus: false });
  }

  /** Per-step validation; returns [message, fieldName] or null. */
  function validate(n) {
    const url = (s) => {
      try {
        return /^https?:$/.test(new URL(s).protocol);
      } catch {
        return false;
      }
    };
    if (n === 0) {
      if (!val('title')) return ['Give the video a title.', 'title'];
      if (val('slug') && !/^[a-z0-9-]+$/.test(val('slug'))) return ['Slug: lowercase letters, digits and dashes only.', 'slug'];
      if (!val('audience')) return ['Say who watches — the agent writes for them.', 'audience'];
      if (radio('brandMode') === 'new') {
        if (!val('brandName')) return ['Name the new brand.', 'brandName'];
        if (!url(val('brandUrl') || val('marketingUrl'))) return ['Brand website must be a full https:// URL.', 'brandUrl'];
      } else if (!val('brandId')) return ['Pick a brand pack, or discover a new one.', 'brandId'];
    }
    if (n === 1) {
      if (!url(val('startUrl'))) return ['Start URL must be a full https:// URL.', 'startUrl'];
      for (const k of ['appUrl', 'marketingUrl']) {
        if (val(k) && !url(val(k))) return [`${k === 'appUrl' ? 'App' : 'Marketing'} URL must be a full https:// URL.`, k];
      }
    }
    if (n === 2 && !val('mustShow')) return ['List what the tour should show — one item per line.', 'mustShow'];
    return null;
  }

  function payload() {
    const isNew = radio('brandMode') === 'new';
    return {
      title: val('title'),
      slug: val('slug') || undefined,
      product: val('product'),
      audience: val('audience'),
      outcome: val('outcome'),
      purpose: radio('purpose') || 'overview',
      brand: isNew ? { mode: 'new', name: val('brandName'), url: val('brandUrl') || val('marketingUrl') } : { mode: 'existing', id: val('brandId') },
      app: {
        startUrl: val('startUrl'),
        appUrl: val('appUrl'),
        marketingUrl: val('marketingUrl'),
        loginRequired: checked('loginRequired'),
        email: checked('loginRequired') ? val('email') : '',
        password: checked('loginRequired') ? form.elements.password.value : '',
        sourcePath: val('sourcePath'),
        notes: val('notes'),
      },
      story: {
        lengthSec: Number(radio('lengthSec') || 120),
        tone: val('tone'),
        mustShow: val('mustShow'),
        keyMessages: val('keyMessages'),
        mustSay: val('mustSay'),
        avoid: val('avoid'),
      },
      proof: {
        plates: [...form.querySelectorAll('input[name="plates"]:checked')].map((i) => i.value),
        stats: val('stats'),
        quotes: val('quotes'),
        logos: val('logos'),
      },
    };
  }

  function renderSummary() {
    const p = payload();
    const show = p.story.mustShow.split('\n').map((s) => s.trim()).filter(Boolean);
    const brandOpt = form.elements.brandId?.selectedOptions?.[0];
    const brandLabel = (() => {
      if (!brandOpt) return '';
      const attr = (brandOpt.getAttribute?.('label') || '').trim();
      if (attr) return attr;
      const clone = brandOpt.cloneNode(true);
      clone.querySelectorAll?.('*').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    })();
    const brandName = p.brand.mode === 'new' ? p.brand.name : brandLabel || p.brand.id;
    const groups = [
      {
        title: 'Video',
        step: 0,
        rows: [
          ['Title', p.title],
          ['Audience', p.audience],
          ['Outcome', p.outcome],
          ['Story', form.querySelector('input[name="purpose"]:checked')?.dataset.label || p.purpose],
          ['Length · tone', `~${Math.round(p.story.lengthSec / 60 * 10) / 10} min${p.story.tone ? ` · ${p.story.tone}` : ''}`],
          ['Brand', p.brand.mode === 'new' ? `${brandName} — discovered from ${p.brand.url}` : brandName],
        ],
      },
      {
        title: 'App access',
        step: 1,
        rows: [
          ['Starts at', p.app.startUrl],
          ['Sign-in', p.app.loginRequired ? (p.app.email ? `Demo account · ${p.app.email}` : 'Yes — add credentials to kit/.env') : 'Not needed'],
          ['Source', p.app.sourcePath],
        ],
      },
      {
        title: 'Story',
        step: 2,
        rows: [
          ['Chapters', show.length ? show.map((s, i) => `${i + 1}. ${s}`).join('\n') : ''],
          ['Key messages', p.story.keyMessages],
        ],
      },
      {
        title: 'Proof',
        step: 3,
        rows: [['Plates', p.proof.plates.map((x) => x[0].toUpperCase() + x.slice(1)).join(', ') || 'None — open and close only']],
      },
    ];
    $('wizardSummary').innerHTML = groups
      .map(
        (g) => `<section class="ws-group">
          <header><h4>${escapeHtml(g.title)}</h4><button type="button" class="link-btn" data-goto="${g.step}">Edit</button></header>
          ${g.rows
            .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd${v ? '' : ' class="is-empty"'}>${escapeHtml(v || 'Not set')}</dd></div>`)
            .join('')}
        </section>`
      )
      .join('');
  }

  function paintCreation(stage, detail) {
    creationStage = stage;
    creation.stage(stage, detail);
  }

  /** Watch one job inside the creation view; the stream, live line and artifacts all follow it. */
  async function follow(jobId, onUpdate) {
    currentJobId = jobId;
    try {
      return await watchJob(jobId, {
        onUpdate: (job) => {
          onUpdate?.(job);
          creation.fromJob(job);
          paintAgentStream($('wizardStream'), job, { variant: 'wizard' });
        },
      });
    } finally {
      currentJobId = null;
    }
  }

  const ensureNotStopped = () => {
    if (stopRequested) throw new Error('Stopped. The brief is saved — retry when ready.');
  };

  async function create() {
    const btn = $('btnWizardNext');
    btn.disabled = true;
    $('btnWizardBack').disabled = true;
    $('wizardError').hidden = true;
    creating = true;
    stopRequested = false;
    dialog.classList.add('is-running');
    creation.start({ resume: Boolean(created) });
    let brandName = '';
    try {
      const p = payload();
      paintCreation(creationStage && creationStage !== 'ready' ? creationStage : 'project', created ? 'Resuming preparation…' : 'Pinning the brief and secure app references…');
      const r = created || (await api('/api/projects', { method: 'POST', body: p }));
      if (!created) {
        creation.artifact(`f:${r.slug}/brief.json`, { name: `${r.slug}/brief.json`, note: 'story, audience, proof' });
        creation.artifact(`f:${r.slug}/video.config.json`, { name: `${r.slug}/video.config.json`, note: `brand ${r.brand}` });
        if (r.envVars?.length) creation.artifact('env', { name: 'kit/.env', note: `${r.envVars.length} credential refs`, kind: 'lock' });
      }
      created = r;
      ensureNotStopped();
      const draft = checked('runDraft');
      if (r.needsDiscovery) {
        paintCreation('brand', 'Opening the official website and inspecting its visual system…');
        const d = await api(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'discover' } });
        await follow(d.job.id, () => creation.stage('brand', 'Capturing logo, colors and type from the official site…'));
        ensureNotStopped();
      } else {
        creation.stage('brand', 'Checking the existing brand pack…');
      }
      const prepared = await api(`/api/video/${r.slug}`);
      if (!prepared.brandFoundation?.ready) {
        throw new Error(`Brand capture is incomplete: ${(prepared.brandFoundation?.issues || ['unknown brand issue']).join('; ')}`);
      }
      created.needsDiscovery = false;
      brandName = prepared.brandFoundation.name;
      creation.brand(r.slug, prepared.brandFoundation);
      creation.note(`${brandName} lockup, palette and type verified`);
      await openVideo(r.slug);
      if (draft) {
        paintCreation('analyze', 'Opening the product and mapping how to move through it…');
        try {
          const a = await api(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'analyze' } });
          await follow(a.job.id, () =>
            creation.stage('analyze', 'Probing controls and WebGL/canvas pointer interactions…')
          );
          creation.artifact(`f:${r.slug}/flow-analysis.md`, {
            name: `${r.slug}/flow-analysis.md`,
            note: 'DOM + canvas interaction map',
          });
          creation.note('Product map ready for the draft');
        } catch (err) {
          // Analysis is best-effort — draft can still proceed with TODO(verify selector) guards.
          creation.note(`Product map skipped: ${err.message || err}`);
        }
        ensureNotStopped();
        paintCreation('draft', `${brandName} mapped · the agent is writing the first script…`);
        const j = await api(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: {} });
        if (j.job.status === 'needs-agent') throw new Error(j.job.message || 'Agent sign-in is required to draft');
        paintAgentStream($('wizardStream'), j.job, { variant: 'wizard' });
        await follow(j.job.id);
        ensureNotStopped();
      }
      paintCreation('ready', `${brandName} is ready. Opening the script for review…`);
      await openVideo(r.slug);
      const watching = dialog.open;
      toast('Video ready for review', `${brandName} · brand and script are in sync`, 'ok');
      if (watching) await new Promise((resolve) => setTimeout(resolve, 650));
      finishCreation();
      if (watching) openScript();
    } catch (raw) {
      const err = stopRequested ? new Error('Stopped. The brief is saved — retry when ready.') : raw;
      creation.fail(err.message);
      btn.textContent = created ? 'Retry preparation' : 'Try again';
      $('btnWizardBack').lastChild.textContent = 'Edit brief';
      if (!dialog.open) {
        toast('New video needs attention', err.message, 'error');
        dialog.showModal();
      }
    } finally {
      creating = false;
      dialog.classList.remove('is-running');
      btn.disabled = false;
      btn.classList.remove('busy');
      $('btnWizardBack').disabled = false;
    }
  }

  function finishCreation() {
    if (dialog.open) dialog.close();
    form.reset();
    created = null;
    creationStage = null;
    creation.reset();
    paintAgentStream($('wizardStream'), null);
    showStep(0);
  }

  $('btnCreationHide').onclick = () => {
    dialog.close();
    toast('Still preparing in the background', 'Studio will tell you when the script is ready.', 'info');
  };
  $('btnCreationStop').onclick = async () => {
    if (!creating) {
      creation.exit();
      showStep(STEPS - 1);
      return;
    }
    stopRequested = true;
    $('btnCreationStop').disabled = true;
    try {
      if (currentJobId) await api(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
    } catch {
      /* the job may have just finished */
    } finally {
      $('btnCreationStop').disabled = false;
    }
  };

  async function open() {
    if (creating || dialog.classList.contains('is-creating')) {
      dialog.showModal();
      return;
    }
    try {
      const { brands } = await api('/api/brands');
      $('wizardBrand').innerHTML = brands.length
        ? brands
            .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}${b.placeholder ? ' (placeholder)' : ''}</option>`)
            .join('')
        : '<option value="" disabled selected>No brand packs yet — discover one</option>';
    } catch {
      $('wizardBrand').innerHTML = '<option value="" disabled selected>Could not load brand packs</option>';
    }
    showStep(0);
    syncConditional();
    created = null;
    creationStage = null;
    creation.reset();
    paintAgentStream($('wizardStream'), null);
    dialog.showModal();
  }

  /** Validate every step before `target`; stops on the first failing one. */
  function goTo(target) {
    for (let i = Math.min(step, target); i < target; i++) {
      const err = validate(i);
      if (err) {
        showStep(i, { focus: false });
        showError(...err);
        return;
      }
    }
    showStep(target);
  }

  function next() {
    const err = validate(step);
    if (err) return showError(...err);
    if (step === STEPS - 1) {
      $('btnWizardNext').classList.add('busy');
      create();
    } else showStep(step + 1);
  }

  form.addEventListener('change', syncConditional);
  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') {
      e.target.removeAttribute('aria-invalid');
      $('wizardError').hidden = true;
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]):not([type=radio])')) {
      e.preventDefault();
      next();
    }
  });
  form.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) showStep(Number(go.dataset.goto));
  });
  $('btnWizardBack').onclick = () => {
    if (dialog.classList.contains('is-creating')) {
      creation.exit();
      showStep(STEPS - 1);
      return;
    }
    showStep(step - 1);
  };
  $('btnWizardNext').onclick = next;
  document.querySelectorAll('#wizardSteps li').forEach((li) => {
    li.onclick = () => goTo(Number(li.dataset.step));
  });
  $('btnNewVideo').onclick = open;

  return { open };
}
