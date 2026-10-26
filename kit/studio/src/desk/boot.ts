import { postKeepalive } from '@/api/client';
import { isVideoError, type AgentAuth, type Health } from '@/api/types';
import { initSelects } from '@/logic/selects';
import { asText } from '@/logic/text';

import { api } from './api';
import { stopAllWork } from './jobs';
import { getMarkMode, initFavicon, setFaviconMode } from './marks';
import { runtime } from './runtime';
import { desk, setStatus } from './store';
import { toast } from './toast';
import { dismissBoot, loadVideo, qsSlug, refreshVideoIndex, setBootStatus, setSlug } from './video';

/**
 * Start-up and sequence switching — `boot()` and the `#slugSelect` change
 * handler from `kit/studio/app.js`.
 */

/** Tab title, brand tooltip, and the Studio guide name the build people are running. */
function showBuildVersion(version: string | undefined): void {
  if (!version || document.documentElement.dataset.version) return;
  document.documentElement.dataset.version = version;
  document.title = `Walkthrough Studio · ${version}`;
  desk.set({ version });
}

export function setAgentAuth(auth: AgentAuth | null | undefined): void {
  desk.set({ agentAuth: auth ?? null });
}

let booted = false;

/** Tests re-run start-up. The desk itself calls `boot` once. */
export function resetBoot(): void {
  booted = false;
  delete document.documentElement.dataset.version;
}

export async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    initFavicon();
    initSelects();
    setFaviconMode('loading');
    document.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest?.('[data-open-editor]')) document.getElementById('modePlate')?.click();
    });
    setBootStatus('Starting…');
    const health = await api<Health>('/api/health');
    showBuildVersion(health.version);
    setAgentAuth(health.agentAuth);

    setBootStatus('Loading projects…');
    const index = await refreshVideoIndex();
    const { videos } = index;
    if (!videos.length) {
      setStatus('warn', 'No projects — create one with New video');
      setFaviconMode('idle');
      dismissBoot();
      return;
    }
    const q = qsSlug();
    const want =
      (q && videos.some((v) => v.slug === q) && q) || videos.find((v) => !isVideoError(v))?.slug || videos[0]?.slug;
    if (!want) return;
    setSlug(want);
    window.addEventListener('beforeunload', (e) => {
      if (!desk.get().plateDirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('pagehide', () => {
      const s = desk.get();
      if (!s.jobBusy && !s.queue.length) return;
      try {
        runtime.workAbort?.abort();
      } catch {
        /* ignore */
      }
      if (s.jobId) {
        navigator.sendBeacon?.(`/api/jobs/${s.jobId}/cancel`, new Blob([JSON.stringify({})], { type: 'application/json' }));
      }
      postKeepalive('/api/jobs/cancel-all');
    });
    await loadVideo(want);
    if (getMarkMode() === 'loading') setFaviconMode('idle');
    dismissBoot();
  } catch (err) {
    setFaviconMode('err');
    desk.set({ bootError: err instanceof Error ? err.message : String(err) });
  }
}

/** The sequence picker changed (`sel.onchange`). Returns false when the switch was refused. */
export async function switchSequence(next: string): Promise<boolean> {
  const s = desk.get();
  if (!next || next === s.slug) return true;
  if (s.plateDirty && !window.confirm('This sequence has unsaved plate text edits. Switch anyway and lose them?')) {
    return false;
  }
  if (s.jobBusy || s.queue.length) await stopAllWork({ reason: 'Stopped · sequence changed', silent: false });
  setSlug(next);
  try {
    await loadVideo(next);
  } catch {
    /* toast already shown in loadVideo */
  }
  return true;
}

/** Switch the agent runner from the header logos (`wireAgentSwitch` click). */
export async function chooseAgent(provider: string): Promise<void> {
  try {
    const r = await api<{ agentAuth?: AgentAuth & { active?: { label?: string } } }>('/api/agent/preference', {
      method: 'POST',
      body: { provider },
    });
    setAgentAuth(r.agentAuth ?? null);
    toast('Agent runner', r.agentAuth?.active?.label || provider, 'ok');
  } catch (err) {
    toast('Could not switch agent', err instanceof Error ? err.message : String(err), 'err');
    try {
      const health = await api<Health>('/api/health');
      setAgentAuth(health.agentAuth);
    } catch {
      setAgentAuth(null);
    }
  }
}

window.addEventListener('error', (ev) => {
  const msg = (ev.error instanceof Error ? ev.error.message : null) || ev.message || 'Unknown error';
  console.error('[studio]', msg, ev.error || ev);
  toast('Studio hitch', msg, 'err');
});
window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  const reason: unknown = ev.reason;
  const msg = reason instanceof Error ? reason.message : asText(reason || 'Unhandled rejection');
  console.error('[studio]', msg, reason);
  toast('Studio hitch', msg, 'err');
});
