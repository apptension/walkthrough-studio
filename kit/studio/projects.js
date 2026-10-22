/**
 * New-video wizard: brief → POST /api/projects → (brand discovery) → product map (analyze) →
 * agent first draft → script review. Nothing is recorded until the script is approved.
 */
import { paintAgentStream } from './agentStream.js';
import { createCreationView } from './creation.js';
import { draftFromDescription } from './shortBrief.js';
import { hasStoredCredentials, maskCredentials, revisePlan } from './briefRevise.js';
import { VIDEO_LANGUAGES, resolveVideoLanguage, videoLanguage } from './languages.js';
import { ask } from './ask.js';

const $ = (id) => document.getElementById(id);
const STEPS = 5;

export function initProjects(ctx) {
  const { api, toast, escapeHtml, openVideo, openScript, watchJob, startRender } = ctx;
  const form = $('projectForm');
  const dialog = $('projectDialog');
  const creation = createCreationView({ dialog, escapeHtml });
  let step = 0;
  let settingsBrief = null;
  let created = null;
  let creationStage = null;
  let creating = false;
  let currentJobId = null;
  let stopRequested = false;
  /** One-description draft: the agent job that fills the brief, and what it returned. */
  let briefJobId = null;
  let briefDrafting = false;
  let briefCancelled = false;
  let agentBrief = null;
  /** Slug whose first script waits in the Ready view for Approve & render. */
  let readySlug = null;
  /** Project settings replan that stopped or failed: `{ slug, stages }` still to run, so Retry resumes. */
  let replanRun = null;

  const val = (name) => form.elements[name]?.value?.trim() || '';
  const checked = (name) => Boolean(form.elements[name]?.checked);
  const radio = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || '';

  function fillLanguageOptions() {
    const select = form.elements.language;
    if (!select || select.options.length) return;
    for (const lang of VIDEO_LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = lang.name;
      opt.title = lang.code;
      select.append(opt);
    }
    select.value = 'en';
  }

  /** The same control sits on the short brief and on Basics. */
  function placeLanguage() {
    const field = $('languageField');
    if (!field) return;
    const host = form.dataset.mode === 'short' ? $('languageSlotShort') : $('languageSlotBasics');
    if (host && field.parentElement !== host) host.append(field);
  }

  function filterLanguages() {
    const select = form.elements.language;
    const filter = $('languageFilter');
    if (!select || !filter || document.documentElement.classList.contains('has-custom-select')) return;
    const q = filter.value.trim().toLowerCase();
    for (const opt of select.options) {
      const hay = `${opt.textContent} ${opt.value}`.toLowerCase();
      opt.hidden = Boolean(q) && opt.value !== select.value && !hay.includes(q);
    }
  }

  fillLanguageOptions();

  const PROJECT_DIALOG_SUB_NEW =
    'The agent drafts the script from this brief. Nothing is recorded until you approve it.';
  const PROJECT_DIALOG_SUB_SETTINGS = 'Edit the brief, then save to replan the script from your changes.';

  function setProjectDialogMode(mode) {
    const settings = mode === 'settings';
    dialog.classList.toggle('is-project-settings', settings);
    const sub = $('projectDialogSub');
    if (sub) sub.textContent = settings ? PROJECT_DIALOG_SUB_SETTINGS : PROJECT_DIALOG_SUB_NEW;
  }

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
    if (form.dataset.mode !== 'settings') form.dataset.mode = 'steps';
    const stepsNav = $('wizardSteps');
    if (stepsNav) stepsNav.hidden = false;
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
    const settings = form.dataset.mode === 'settings';
    // On Basics of a new video, Back returns to the one-description form.
    $('btnWizardBack').disabled = step === 0 && settings;
    $('btnWizardBack').lastChild.textContent = step === 0 && !settings ? 'Description' : 'Back';
    const last = settings
      ? replanRun?.stages?.length
        ? 'Save and resume'
        : 'Save and replan'
      : created
        ? 'Retry preparation'
        : checked('runDraft')
          ? 'Create & draft'
          : 'Create project';
    $('btnWizardNext').textContent = step === STEPS - 1 ? last : 'Continue';
    $('wizardStepMeta').textContent = `Step ${step + 1} of ${STEPS}`;
    $('wizardProgressBar').style.width = `${((step + 1) / STEPS) * 100}%`;
    clearError();
    form.scrollTop = 0;
    if (step === 3) paintPlateStills();
    if (step === STEPS - 1) renderSummary();
    placeLanguage();
    if (focus && step !== 3) {
      form
        .querySelector(`fieldset[data-step="${step}"] input:not([type=radio]):not([type=checkbox]), fieldset[data-step="${step}"] textarea`)
        ?.focus({ preventScroll: true });
    }
  }

  function showShort() {
    form.dataset.mode = 'short';
    form.querySelectorAll('fieldset[data-step]').forEach((fs) => {
      fs.hidden = fs.dataset.step !== 'short';
    });
    const stepsNav = $('wizardSteps');
    if (stepsNav) stepsNav.hidden = true;
    $('btnWizardBack').disabled = true;
    $('btnWizardBack').lastChild.textContent = 'Back';
    $('btnWizardNext').textContent = 'Draft the video';
    $('wizardStepMeta').textContent = 'One description';
    $('wizardProgressBar').style.width = '8%';
    setDrafting(false);
    clearError();
    placeLanguage();
  }

  /** Rough fallback when no agent can read the description: a few regex guesses, then the form. */
  function applyDraft(draft) {
    form.elements.title.value = draft.title;
    if (draft.audience) form.elements.audience.value = draft.audience;
    form.elements.startUrl.value = draft.startUrl;
    form.elements.mustShow.value = draft.chapters.join('\n');
    const purpose = form.querySelector(`input[name="purpose"][value="${draft.purpose}"]`);
    if (purpose) purpose.checked = true;
    const length = form.querySelector(`input[name="lengthSec"][value="${draft.lengthSec}"]`);
    if (length) length.checked = true;
  }

  /** The agent's brief fills every field of the five steps; the reviewer only checks. */
  function applyAgentBrief(brief) {
    const set = (name, value) => {
      const el = form.elements[name];
      if (el && !(el instanceof RadioNodeList) && value != null) el.value = value;
    };
    const pick = (name, value) => {
      const el = form.querySelector(`input[name="${name}"][value="${value}"]`);
      if (el) el.checked = true;
    };
    set('title', brief.title);
    set('slug', brief.slug || '');
    set('product', brief.product || '');
    set('audience', brief.audience || '');
    set('outcome', brief.outcome || '');
    set('tone', brief.story?.tone || '');
    pick('purpose', brief.purpose || 'overview');
    pick('lengthSec', String(brief.story?.lengthSec || 120));
    const brand = brief.brand || {};
    if (brand.mode === 'existing' && brand.id && form.elements.brandId) {
      pick('brandMode', 'existing');
      form.elements.brandId.value = brand.id;
    } else {
      pick('brandMode', 'new');
      set('brandName', brand.name || brief.product || '');
      set('brandUrl', brand.url || brief.app?.marketingUrl || '');
    }
    const app = brief.app || {};
    set('startUrl', app.startUrl || val('shortStartUrl'));
    set('appUrl', app.appUrl || '');
    set('marketingUrl', app.marketingUrl || '');
    const login = form.querySelector('input[name="loginRequired"]');
    if (login) login.checked = Boolean(app.loginRequired);
    set('email', app.loginRequired ? app.email || '' : '');
    if (form.elements.password) form.elements.password.value = '';
    set('sourcePath', app.sourcePath || '');
    set('notes', app.notes || '');
    const story = brief.story || {};
    set('mustShow', (story.mustShow || []).join('\n'));
    set('keyMessages', (story.keyMessages || []).join('\n'));
    set('mustSay', (story.mustSay || []).join('\n'));
    set('avoid', (story.avoid || []).join('\n'));
    const proof = brief.proof || {};
    const plates = proof.plates || [];
    form.querySelectorAll('input[name="plates"]').forEach((input) => {
      input.checked = plates.includes(input.value);
    });
    set('stats', (proof.stats || []).join('\n'));
    set('quotes', (proof.quotes || []).join('\n'));
    set('logos', (proof.logos || []).join('\n'));
    syncConditional();
  }

  /** While the agent reads the description: the short form dims, the feed shows, Back cancels. */
  function setDrafting(on) {
    briefDrafting = on;
    form.classList.toggle('is-drafting', on);
    const box = $('shortDraft');
    if (box) {
      box.hidden = !on;
      box.classList.remove('is-failed');
    }
    const next = $('btnWizardNext');
    next.classList.toggle('busy', on);
    next.disabled = on;
    const back = $('btnWizardBack');
    if (on) {
      back.disabled = false;
      back.lastChild.textContent = 'Cancel';
      $('wizardStepMeta').textContent = 'Drafting the brief…';
      $('shortDraftTitle').textContent = 'Reading your description…';
      $('shortDraftLine').textContent = 'The agent finds the product, the audience, the beats to show, and the brand.';
      paintAgentStream($('shortDraftStream'), null);
      requestAnimationFrame(() => box?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    }
  }

  const httpOk = (s) => {
    try {
      return /^https?:$/.test(new URL(s).protocol);
    } catch {
      return false;
    }
  };

  /** No agent, or it failed: a rough regex draft so the reviewer is never left with empty fields. */
  function fallbackDraft(reason) {
    try {
      applyDraft(draftFromDescription({ description: val('description'), startUrl: val('shortStartUrl') }));
    } catch {
      /* the description was already validated; keep whatever is in the form */
    }
    showStep(0);
    showError(`${reason} The fields below were prefilled roughly from your description — check each step.`);
  }

  /** Draft the video: the agent deconstructs the description and fills every brief field. */
  async function draftBrief() {
    const description = val('description');
    const startUrl = val('shortStartUrl');
    if (!description) return showError('Describe what to show, for whom, and about how long', 'description');
    if (!httpOk(startUrl)) return showError('Start URL must be a full http(s) URL.', 'shortStartUrl');
    clearError();
    briefCancelled = false;
    agentBrief = null;
    setDrafting(true);
    const stream = $('shortDraftStream');
    try {
      const r = await api('/api/brief/draft', { method: 'POST', body: { description, startUrl, language: val('language') || 'en' } });
      const job = r.job;
      if (job.status === 'needs-agent') {
        fallbackDraft(job.message || 'No agent is signed in.');
        return;
      }
      briefJobId = job.id;
      paintAgentStream(stream, job, { variant: 'wizard' });
      const done = await watchJob(job.id, {
        onUpdate: (j) => {
          paintAgentStream(stream, j, { variant: 'wizard' });
          if (j.activity) $('shortDraftLine').textContent = j.activity;
          if (j.phase === 'tool') $('shortDraftTitle').textContent = 'Discovering the product and brand…';
          else if (j.phase === 'writing' || j.phase === 'finishing') $('shortDraftTitle').textContent = 'Writing the brief…';
        },
      });
      if (briefCancelled) return;
      if (!done?.brief) throw new Error('The agent finished without a brief.');
      agentBrief = done.brief;
      applyAgentBrief(done.brief);
      setDrafting(false);
      toast('Brief drafted', `${done.brief.title} · check the fields, then create the video`, 'ok');
      step = 0;
      goTo(STEPS - 1);
    } catch (err) {
      if (briefCancelled) {
        showShort();
        return;
      }
      fallbackDraft(err.message || 'The agent could not draft the brief.');
    } finally {
      briefJobId = null;
      if (briefDrafting) setDrafting(false);
    }
  }

  async function cancelBriefDraft() {
    briefCancelled = true;
    $('shortDraftTitle').textContent = 'Stopping…';
    if (briefJobId) await api(`/api/jobs/${briefJobId}/cancel`, { method: 'POST' }).catch(() => {});
  }

  /** Point each plate tile at a frozen still of that template in the chosen brand. */
  function paintPlateStills() {
    const brand = radio('brandMode') === 'existing' ? val('brandId') : '';
    form.querySelectorAll('.plate-picks .pick').forEach((pick) => {
      const type = pick.querySelector('input[name="plates"]')?.value;
      const img = pick.querySelector('.pick-still img');
      if (!img || !type) return;
      const src = brand ? `/api/plate-stills/${encodeURIComponent(brand)}/${encodeURIComponent(type)}.jpg` : '';
      if (img.getAttribute('src') === src) return;
      img.classList.remove('is-in');
      if (!src) {
        img.removeAttribute('src');
        return;
      }
      img.loading = 'eager';
      img.decoding = 'async';
      img.onload = () => img.classList.add('is-in');
      img.onerror = () => {
        img.classList.remove('is-in');
        // First paint often races a cold still render — one retry after the JPEG lands.
        if (!img.dataset.retried) {
          img.dataset.retried = '1';
          setTimeout(() => {
            img.src = `${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`;
          }, 900);
        }
      };
      img.src = src;
    });
  }

  function syncConditional() {
    const isNew = radio('brandMode') === 'new';
    form.querySelector('[data-brand="existing"]').hidden = isNew;
    form.querySelector('[data-brand="new"]').hidden = !isNew;
    $('wizardDiscoverRow').hidden = !isNew;
    form.querySelectorAll('[data-login]').forEach((el) => (el.hidden = !checked('loginRequired')));
    paintCredentialFields();
    if (step === 3) paintPlateStills();
    if (step === STEPS - 1) showStep(step, { focus: false });
  }

  /** Settings: never echo saved email/password — show on-file status and replace-only fields. */
  function paintCredentialFields() {
    const on = checked('loginRequired');
    const onFile = Boolean(settingsBrief?.app?.credentialsOnFile) || hasStoredCredentials(settingsBrief);
    const status = $('wizardCredStatus');
    const statusText = $('wizardCredStatusText');
    const email = form.elements.email;
    const password = form.elements.password;
    const emailLabel = $('wizardEmailLabel');
    const passwordLabel = $('wizardPasswordLabel');
    const noteText = $('wizardCredNoteText');
    if (status) status.hidden = !(on && onFile);
    if (statusText && on && onFile) {
      statusText.textContent = 'Credentials are saved for this project (in kit/.env). Values are not shown here.';
    }
    if (email) {
      email.placeholder = on && onFile ? 'Leave blank to keep the saved email' : 'demo@acme.com';
      email.autocomplete = 'off';
      if (onFile && form.dataset.mode === 'settings') email.value = '';
    }
    if (password) {
      password.placeholder = on && onFile ? 'Leave blank to keep the saved password' : '';
      password.value = '';
    }
    if (emailLabel) emailLabel.textContent = on && onFile ? 'New email (optional)' : 'Demo account email';
    if (passwordLabel) passwordLabel.textContent = on && onFile ? 'New password (optional)' : 'Password';
    if (noteText) {
      noteText.innerHTML =
        on && onFile
          ? 'Only fill a field to replace it. Blank keeps the saved secret in <code>kit/.env</code>.'
          : 'Stored only in <code>kit/.env</code> (gitignored); the project references it as <code>$VAR</code>.';
    }
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
        const site = val('brandUrl') || val('marketingUrl') || val('appUrl') || val('startUrl');
        if (val('brandUrl') && !url(val('brandUrl'))) return ['Brand website must be a full https:// URL.', 'brandUrl'];
        if (!url(site)) return ['Give a brand website, or a start URL in App access — discovery reads the brand from the live app.', 'brandUrl'];
      } else if (!val('brandId')) return ['Pick a brand pack, or discover a new one.', 'brandId'];
    }
    if (n === 0 && !videoLanguage(val('language'))) return ['Choose a video language.', 'language'];
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
      language: val('language') || 'en',
      slug: val('slug') || undefined,
      product: val('product'),
      audience: val('audience'),
      outcome: val('outcome'),
      purpose: radio('purpose') || 'overview',
      brand: isNew
        ? { mode: 'new', name: val('brandName'), url: val('brandUrl') || val('marketingUrl') || val('appUrl') || val('startUrl') }
        : { mode: 'existing', id: val('brandId') },
      app: {
        startUrl: val('startUrl'),
        appUrl: val('appUrl'),
        marketingUrl: val('marketingUrl'),
        loginRequired: checked('loginRequired'),
        sourcePath: val('sourcePath'),
        notes: val('notes'),
        // Only send credentials when the reviewer typed a replacement — blank keeps kit/.env.
        ...(checked('loginRequired') && val('email') ? { email: val('email') } : {}),
        ...(checked('loginRequired') && form.elements.password?.value
          ? { password: form.elements.password.value }
          : {}),
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
          ['Language', resolveVideoLanguage(p.language).name],
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
    if (agentBrief && form.dataset.mode !== 'settings') {
      const conf = { high: 'High — the description covered most of it', medium: 'Medium — a few fields are inferred', low: 'Low — check every step' };
      groups.push({
        title: 'Drafted from your description',
        step: 'short',
        rows: [
          ['Confidence', conf[agentBrief.confidence] || conf.medium],
          ['Assumptions', (agentBrief.assumptions || []).map((s) => `• ${s}`).join('\n') || 'None noted'],
          ['Open questions', (agentBrief.questions || []).map((s) => `• ${s}`).join('\n') || 'None'],
        ],
      });
    }
    if (form.dataset.mode === 'settings' && settingsBrief) {
      const plan = revisePlan(settingsBrief, p);
      groups.push({
        title: 'This save',
        step: 4,
        rows: [
          ['Changed', plan.changed.map((item) => item.label).join(', ') || 'Nothing'],
          ['Rerun', plan.stages.join(', ') || 'None'],
          ['Footage', plan.needsRecord ? 'Re-record before the next render' : 'Keep the current take'],
        ],
      });
    }
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

  const STOPPED_MESSAGE = 'Stopped. The brief is saved — retry when ready.';
  const ensureNotStopped = () => {
    if (stopRequested) throw new Error(STOPPED_MESSAGE);
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
        const host = (u) => {
          try {
            return new URL(u).host;
          } catch {
            return u;
          }
        };
        const site = host(p.brand.url);
        const app = host(p.app.appUrl || p.app.startUrl);
        const where = app && app !== site ? `${site} and the app at ${app}` : site;
        paintCreation('brand', `Opening ${where} in a browser to capture the lockup, palette and type…`);
        const d = await api(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'discover' } });
        if (d.job?.status === 'needs-agent') {
          throw new Error(d.job.message || 'Agent sign-in is required to discover the brand');
        }
        const discoverJob = await follow(d.job.id, (job) =>
          creation.stage('brand', job.activity || `Reading ${where}…`)
        );
        ensureNotStopped();
        if (discoverJob?.status === 'needs-agent') {
          throw new Error(discoverJob.message || 'Agent sign-in is required to discover the brand');
        }
        if (discoverJob?.status === 'failed' || discoverJob?.status === 'cancelled') {
          throw new Error(discoverJob.message || discoverJob.activity || 'Brand discovery failed');
        }
      } else {
        creation.stage('brand', `Reusing the ${p.brand.id} brand pack — no discovery needed`);
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
        paintCreation('analyze', 'Opening the product, signing in when needed, and exploring routes…');
        try {
          const a = await api(`/api/video/${r.slug}/draft-project`, { method: 'POST', body: { step: 'analyze' } });
          await follow(a.job.id, (job) =>
            creation.stage(
              'analyze',
              job.activity || 'Exploring the product — mapping routes and adapting the journey…'
            )
          );
          creation.artifact(`f:${r.slug}/flow-analysis.md`, {
            name: `${r.slug}/flow-analysis.md`,
            note: 'Explored routes + DOM/canvas map',
          });
          creation.note('Product map ready — journey crafted to what the crawl reached');
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
      await openVideo(r.slug);
      if (!draft) {
        // Project only, no script yet: the desk's stage bar takes over.
        toast('Project created', `${brandName} · draft the script when you are ready`, 'ok');
        finishCreation();
        return;
      }
      paintCreation('ready', `${brandName} · approve the script to record and render.`);
      let script = null;
      try {
        script = (await api(`/api/video/${r.slug}/script`)).script;
      } catch {
        /* the summary card is a convenience; approval still works without it */
      }
      readySlug = r.slug;
      creation.script(script, { brandName });
      if (!dialog.open) {
        // Prepared in the background: the desk shows the video; the Script stage asks for approval.
        toast('First script ready', `${brandName} · open Script, approve it, and Studio records and renders`, 'ok');
        finishCreation();
      }
    } catch (raw) {
      const msg = stopRequested
        ? STOPPED_MESSAGE
        : /^(cancelled|canceled)$/i.test(String(raw?.message || raw || '').trim())
          ? STOPPED_MESSAGE
          : raw?.message || String(raw);
      creation.fail(msg);
      $('btnCreationRetry').textContent = created ? 'Retry preparation' : 'Try again';
      if (!dialog.open) {
        toast('New video needs attention', msg, 'error');
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
    readySlug = null;
    if (dialog.open) dialog.close();
    form.reset();
    created = null;
    creationStage = null;
    agentBrief = null;
    creation.reset();
    paintAgentStream($('wizardStream'), null);
    showStep(0);
  }

  /** Approve the first script and start the first render: record → plates → produce → voice → deliver. */
  async function approveAndRender() {
    const slug = readySlug;
    if (!slug) return;
    const btn = $('btnCreationRender');
    btn.classList.add('busy');
    btn.disabled = true;
    $('btnCreationReview').disabled = true;
    try {
      try {
        await api(`/api/video/${encodeURIComponent(slug)}/script/approve`, { method: 'POST', body: { note: 'Approved from the new-video flow' } });
      } catch (err) {
        if (!/blocking/i.test(err.message)) throw err;
        const force = await ask({
          title: 'Approve with blocking issues?',
          detail: `${err.message}\n\nThe recorder may stop at the affected step. Review script first to fix them, or approve anyway.`,
          ok: 'Approve anyway',
          tone: 'warn',
        });
        if (!force) return;
        await api(`/api/video/${encodeURIComponent(slug)}/script/approve`, { method: 'POST', body: { note: 'Approved from the new-video flow', force: true } });
      }
      await openVideo(slug);
      finishCreation();
      toast('Script approved', 'Recording the app, then cutting, voicing and exporting. Watch the Render tab.', 'ok');
      startRender?.();
    } catch (err) {
      toast('Could not approve the script', err.message, 'err');
    } finally {
      btn.classList.remove('busy');
      btn.disabled = false;
      $('btnCreationReview').disabled = false;
    }
  }

  $('btnCreationRender').onclick = approveAndRender;
  $('btnCreationReview').onclick = async () => {
    const slug = readySlug;
    finishCreation();
    if (slug) await openVideo(slug);
    openScript();
  };
  // Closing the Ready view with X leaves the video open on the desk; the Script stage asks for approval.
  dialog.addEventListener('close', () => {
    if (readySlug && !creating) finishCreation();
  });
  /** After a stop or failure: run the same preparation again, resuming where it got to. */
  $('btnCreationRetry').onclick = () => {
    if (creating) return;
    $('wizardError').hidden = true;
    $('btnWizardNext').classList.add('busy');
    if (form.dataset.mode === 'settings') {
      const slug = form.elements.slug?.value;
      if (slug && !replanRun?.stages?.length) rememberReplan(slug, pendingFromCreationView());
      saveSettings();
    } else create();
  };
  /** Back to the Review step with the brief intact — change it, then Save / Create runs again. */
  $('btnCreationEdit').onclick = () => {
    if (creating) return;
    creation.exit();
    showStep(STEPS - 1);
  };
  $('btnCreationStop').onclick = async () => {
    // After a failure the Stop control is hidden; if it is still used, keep the resume list and go edit.
    if (!creating) {
      if (form.dataset.mode === 'settings' && form.elements.slug?.value && !replanRun?.stages?.length) {
        rememberReplan(form.elements.slug.value, pendingFromCreationView());
      }
      creation.exit();
      showStep(STEPS - 1);
      return;
    }
    stopRequested = true;
    $('btnCreationStop').disabled = true;
    $('btnCreationStop').textContent = 'Stopping…';
    try {
      if (currentJobId) await api(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
    } catch {
      /* the job may have just finished */
    } finally {
      $('btnCreationStop').disabled = false;
      $('btnCreationStop').textContent = 'Stop';
    }
  };

  function fillFromBrief(brief, slug, freshness = null) {
    const masked = maskCredentials(brief || {}, freshness);
    settingsBrief = masked;
    const set = (name, value) => {
      const el = form.elements[name];
      if (el && value != null) el.value = value;
    };
    set('title', masked.title || '');
    if (form.elements.language) form.elements.language.value = resolveVideoLanguage(masked.language).code;
    const filter = $('languageFilter');
    if (filter) filter.value = '';
    filterLanguages();
    set('product', masked.product || '');
    set('audience', masked.audience || '');
    set('outcome', masked.outcome || '');
    set('tone', masked.tone || '');
    set('slug', slug);
    if (form.elements.slug) form.elements.slug.disabled = true;
    const purpose = form.querySelector(`input[name="purpose"][value="${masked.purpose || 'overview'}"]`);
    if (purpose) purpose.checked = true;
    const length = form.querySelector(`input[name="lengthSec"][value="${masked.lengthSec || 120}"]`);
    if (length) length.checked = true;
    set('startUrl', masked.app?.startUrl || '');
    set('appUrl', masked.app?.appUrl || '');
    set('marketingUrl', masked.app?.marketingUrl || '');
    set('sourcePath', masked.app?.sourcePath || '');
    set('notes', masked.app?.notes || '');
    if (form.elements.email) form.elements.email.value = '';
    if (form.elements.password) form.elements.password.value = '';
    const login = form.querySelector('input[name="loginRequired"]');
    if (login) {
      login.checked = Boolean(masked.app?.loginRequired) || hasStoredCredentials(masked, freshness);
    }
    set('mustShow', (masked.story?.mustShow || []).join('\n'));
    set('keyMessages', (masked.story?.keyMessages || []).join('\n'));
    set('mustSay', (masked.story?.mustSay || []).join('\n'));
    set('avoid', (masked.story?.avoid || []).join('\n'));
    set('stats', (masked.proof?.stats || []).join('\n'));
    set('quotes', (masked.proof?.quotes || []).join('\n'));
    set('logos', (masked.proof?.logos || []).join('\n'));
    form.querySelectorAll('input[name="plates"]').forEach((input) => {
      input.checked = (masked.proof?.plates || []).includes(input.value);
    });
    if (masked.brand?.id && form.elements.brandId) form.elements.brandId.value = masked.brand.id;
    const existing = form.querySelector('input[name="brandMode"][value="existing"]');
    if (existing) existing.checked = true;
    syncConditional();
  }

  /** Preparation stages a brief save asked for, in pipeline order; shrinks as each one finishes so Retry resumes. */
  const REPLAN_ORDER = ['discover', 'analyze', 'planner'];
  const REPLAN_STAGE = {
    discover: { view: 'brand', detail: 'Re-reading the brand from the site and the app…', body: { step: 'discover' } },
    analyze: {
      view: 'analyze',
      detail: 'Exploring the product again — sign-in, routes, then recraft if must-show is unreachable…',
      body: { step: 'analyze' },
    },
    planner: { view: 'draft', detail: 'The agent is rewriting the script from your changes…', body: {} },
  };
  const VIEW_TO_REPLAN = { brand: 'discover', analyze: 'analyze', draft: 'planner' };

  /** Rebuild a resume list from the creation view when replanRun was cleared mid-failure. */
  function pendingFromCreationView() {
    const fromView = creation
      .unfinished()
      .map((view) => VIEW_TO_REPLAN[view])
      .filter(Boolean);
    const ordered = REPLAN_ORDER.filter((s) => fromView.includes(s));
    return ordered.length ? ordered : ['planner'];
  }

  function rememberReplan(slug, stages) {
    const list = [...new Set((stages || []).filter((s) => REPLAN_ORDER.includes(s)))];
    replanRun = { slug, stages: list.length ? list : ['planner'] };
    return replanRun;
  }

  async function saveSettings() {
    const btn = $('btnWizardNext');
    const slug = form.elements.slug.value;
    const resuming = Boolean(replanRun?.slug === slug && replanRun.stages?.length) || dialog.classList.contains('is-failed');
    creating = true;
    stopRequested = false;
    $('btnWizardBack').disabled = true;
    try {
      const p = payload();
      const plan = revisePlan(settingsBrief, p);
      let pending = replanRun?.slug === slug ? [...replanRun.stages] : [];
      if (!pending.length && resuming) pending = pendingFromCreationView();
      if (plan.changed.length) {
        const saved = await api(`/api/video/${encodeURIComponent(slug)}/brief`, { method: 'POST', body: p });
        settingsBrief = maskCredentials(p);
        for (const s of saved.plan?.stages || []) if (!pending.includes(s)) pending.push(s);
        toast('Brief saved', `${plan.changed.map((item) => item.label).join(', ')}. ${pending.join(', ') || 'No preparation to rerun.'}`, 'ok');
      } else if (!pending.length) {
        toast('No brief changes', 'Nothing to replan');
        return;
      }
      rememberReplan(slug, pending);
      pending = [...replanRun.stages];
      if (pending.length) {
        dialog.classList.add('is-running');
        creation.start({ resume: resuming });
        for (const stage of REPLAN_ORDER) {
          if (!replanRun.stages.includes(stage)) continue;
          ensureNotStopped();
          const { view, detail, body } = REPLAN_STAGE[stage];
          paintCreation(view, detail);
          const job = await api(`/api/video/${encodeURIComponent(slug)}/draft-project`, { method: 'POST', body });
          if (job.job?.status === 'needs-agent') throw new Error(job.job.message || 'Agent sign-in is required to redraft');
          if (job.job?.id) {
            const finished = await follow(job.job.id);
            if (finished?.status === 'needs-agent') {
              throw new Error(finished.message || 'Agent sign-in is required to redraft');
            }
            if (finished?.status === 'failed' || finished?.status === 'cancelled') {
              throw new Error(finished.message || finished.activity || 'Preparation stopped');
            }
          }
          ensureNotStopped();
          replanRun.stages = replanRun.stages.filter((s) => s !== stage);
        }
      }
      replanRun = null;
      creation.reset();
      paintAgentStream($('wizardStream'), null);
      if (dialog.open) dialog.close();
      if (form.elements.slug) form.elements.slug.disabled = false;
      $('projectDialogTitle').textContent = 'New video';
      setProjectDialogMode('new');
      await openVideo(slug);
      openScript();
    } catch (raw) {
      const msg = stopRequested
        ? STOPPED_MESSAGE
        : /^(cancelled|canceled)$/i.test(String(raw?.message || raw || '').trim())
          ? STOPPED_MESSAGE
          : raw?.message || String(raw);
      if (dialog.classList.contains('is-creating') || dialog.classList.contains('is-failed')) {
        if (!replanRun?.stages?.length) rememberReplan(slug, pendingFromCreationView());
        creation.fail(msg);
        $('btnCreationRetry').textContent = 'Retry preparation';
        if (!dialog.open) {
          toast('Replan needs attention', msg, 'error');
          dialog.showModal();
        }
      } else toast('Could not save the brief', msg, 'err');
    } finally {
      creating = false;
      dialog.classList.remove('is-running');
      btn.classList.remove('busy');
      btn.disabled = false;
      $('btnWizardBack').disabled = false;
    }
  }

  async function openSettings(video) {
    if (!video?.slug) return;
    if (creating || briefDrafting) {
      dialog.showModal();
      return;
    }
    if (dialog.classList.contains('is-creating')) {
      // A stopped preparation is still on screen. For this video it stays: Retry picks it up.
      if (created?.slug === video.slug || replanRun?.slug === video.slug) {
        dialog.showModal();
        return;
      }
      created = null;
      creationStage = null;
      replanRun = null;
      creation.reset();
      paintAgentStream($('wizardStream'), null);
    }
    try {
      const { brands } = await api('/api/brands');
      $('wizardBrand').innerHTML = brands.length
        ? brands.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('')
        : '<option value="" disabled>No brand packs yet</option>';
    } catch {
      /* keep the current options */
    }
    form.dataset.mode = 'settings';
    $('projectDialogTitle').textContent = 'Project settings';
    setProjectDialogMode('settings');
    // Refetch so a just-saved loginRequired / envVars is not missing from a stale desk payload.
    let brief = video.brief;
    let freshness = video.freshness;
    try {
      const fresh = await api(`/api/video/${encodeURIComponent(video.slug)}`);
      if (fresh?.brief) brief = fresh.brief;
      if (fresh?.freshness) freshness = fresh.freshness;
    } catch {
      /* use the desk copy */
    }
    fillFromBrief(
      brief || { title: video.title, audience: video.audience, app: { startUrl: freshness?.startUrl || '' } },
      video.slug,
      freshness
    );
    showStep(0);
    dialog.showModal();
  }

  async function open() {
    if (creating || briefDrafting || dialog.classList.contains('is-creating')) {
      dialog.showModal();
      return;
    }
    if (form.elements.slug) form.elements.slug.disabled = false;
    $('projectDialogTitle').textContent = 'New video';
    setProjectDialogMode('new');
    settingsBrief = null;
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
    // A brief the agent finished while the dialog was closed is still in the form: resume at Review.
    if (agentBrief) {
      if (agentBrief.brand?.mode === 'existing' && form.elements.brandId) form.elements.brandId.value = agentBrief.brand.id;
      step = 0;
      goTo(STEPS - 1);
    } else showShort();
    syncConditional();
    created = null;
    creationStage = null;
    replanRun = null;
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
    if (form.dataset.mode === 'short') {
      if (!briefDrafting) draftBrief();
      return;
    }
    const err = validate(step);
    if (err) return showError(...err);
    if (step === STEPS - 1) {
      $('btnWizardNext').classList.add('busy');
      if (form.dataset.mode === 'settings') saveSettings();
      else create();
    } else showStep(step + 1);
  }

  $('languageFilter')?.addEventListener('input', filterLanguages);
  form.addEventListener('change', syncConditional);
  form.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true') {
      e.target.removeAttribute('aria-invalid');
      $('wizardError').hidden = true;
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox]):not([type=radio])') && !e.target.classList.contains('sel-search') && !e.target.classList.contains('lang-filter')) {
      e.preventDefault();
      next();
    }
  });
  form.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      if (go.dataset.goto === 'short') showShort();
      else showStep(Number(go.dataset.goto));
    }
    if (e.target.closest('[data-full-brief]') && !briefDrafting) showStep(0);
  });
  $('btnWizardBack').onclick = () => {
    if (briefDrafting) {
      cancelBriefDraft();
      return;
    }
    if (dialog.classList.contains('is-creating')) {
      creation.exit();
      showStep(STEPS - 1);
      return;
    }
    if (step === 0 && form.dataset.mode !== 'settings') {
      showShort();
      return;
    }
    showStep(step - 1);
  };
  $('btnWizardNext').onclick = next;
  document.querySelectorAll('#wizardSteps li').forEach((li) => {
    li.onclick = () => goTo(Number(li.dataset.step));
  });
  $('btnNewVideo').onclick = open;

  return { open, openSettings };
}
