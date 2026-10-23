import { http, HttpResponse } from 'msw';

import { endpoints } from '@/test/msw/endpoints';

import {
  makeBrand,
  makeBranchIdea,
  makeHealth,
  makeIndex,
  makeJob,
  makeScript,
  makeVideo,
} from '../factories';

let jobSeq = 0;

/**
 * Default happy-path server. Tests that need a different answer override the one
 * route they care about with `server.use(...)`.
 */
export const handlers = [
  http.get(endpoints.health, () => HttpResponse.json(makeHealth())),
  http.get(endpoints.videos, () => HttpResponse.json(makeIndex())),
  http.get(endpoints.brands, () => HttpResponse.json({ brands: [makeBrand()] })),
  http.get(endpoints.captureOptions, () => HttpResponse.json({ options: [] })),
  // No capture size or editor deck until a test provides one; both panels fall back.
  http.get('/api/video/:slug/capture', () => HttpResponse.json({ error: 'not found' }, { status: 404 })),
  http.get('/api/video/:slug/edit', () => HttpResponse.json({ error: 'no deck' }, { status: 404 })),
  http.post(endpoints.projects, () =>
    HttpResponse.json({
      ok: true,
      slug: 'new-video',
      brand: 'walkthrough-studio',
      needsDiscovery: false,
      envVars: [],
    }),
  ),

  http.get('/api/video/:slug/script', () => HttpResponse.json(makeScript())),

  http.get('/api/video/:slug', ({ params }) =>
    HttpResponse.json(makeVideo({ slug: String(params.slug) })),
  ),
  http.get('/api/video/:slug/captions', () => HttpResponse.json({ clips: [] })),
  http.get('/api/video/:slug/scenes', ({ params }) =>
    HttpResponse.json({ scenes: makeVideo({ slug: String(params.slug) }).scenes }),
  ),
  http.get('/api/video/:slug/plates', () => HttpResponse.json({ plates: [] })),
  http.get('/api/video/:slug/branch/ideas', () =>
    HttpResponse.json({ agent: false, ideas: [makeBranchIdea()] }),
  ),
  http.post('/api/video/:slug/branch/discover', () =>
    HttpResponse.json({ ok: true, ideas: [makeBranchIdea()], job: { id: 'job-branch-ideas' } }),
  ),
  http.post('/api/video/:slug/branch', () =>
    HttpResponse.json({ ok: true, slug: 'demo-desk-home', title: 'Desk home', job: null }),
  ),
  http.get('/api/video/:slug/versions', () =>
    HttpResponse.json({ versions: makeVideo().versions }),
  ),

  // A job is working by default. Tests that care about an outcome say so.
  http.get('/api/jobs/:id', ({ params }) =>
    HttpResponse.json(makeJob({ id: String(params.id), status: 'running' })),
  ),
  http.post('/api/jobs/:id/cancel', () => HttpResponse.json({ ok: true })),
  http.post('/api/jobs/:id/answer', () => HttpResponse.json({ ok: true, continue: true })),
  http.post(endpoints.jobsCancelAll, () => HttpResponse.json({ ok: true })),

  // Each submission gets its own job id, as the real server does.
  http.post('/api/video/:slug/run', () =>
    HttpResponse.json({ job: { id: `job-run-${++jobSeq}` } }),
  ),
  http.post('/api/video/:slug/improve', () =>
    HttpResponse.json({ job: { id: `job-improve-${++jobSeq}` } }),
  ),
  http.post('/api/video/:slug/script/approve', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/script/request-changes', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/cut/review', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/versions/snapshot', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/poster', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/deliverables/zip', () => HttpResponse.json({ ok: true })),
  http.post('/api/video/:slug/motion', () => HttpResponse.json({ ok: true })),
  http.post(endpoints.agentPreference, () => HttpResponse.json({ ok: true })),

  http.put('/api/video/:slug/direction', () => HttpResponse.json({ ok: true })),
  http.put('/api/video/:slug/transitions', () => HttpResponse.json({ ok: true })),
  http.put('/api/video/:slug/record-target', () => HttpResponse.json({ ok: true })),

  // The live-frame pump polls this while a take is marked recording. Absent in tests.
  http.get('/media/:slug/live-preview.jpg', () => new HttpResponse(null, { status: 404 })),
  http.get('/media/:slug/live-preview.json', () => new HttpResponse(null, { status: 404 })),
];
