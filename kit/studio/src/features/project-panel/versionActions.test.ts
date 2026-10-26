import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ask } from '@/desk/ask';
import { playPlatePreview, setCompare } from '@/desk/monitor';
import { desk } from '@/desk/store';
import { toast } from '@/desk/toast';
import { loadVideo } from '@/desk/video';
import { makeVersion, makeVideo } from '@/test/factories';
import { server } from '@/test/msw/server';

import {
  cleanIntermediates,
  confirmFilePlan,
  deleteSelectedVersions,
  selectVersions,
  setVersionSelected,
  snapshotVersion,
  versionAction,
} from './versionActions';

vi.mock('@/desk/ask', () => ({ ask: vi.fn() }));
vi.mock('@/desk/toast', () => ({ toast: vi.fn() }));
vi.mock('@/desk/video', () => ({ loadVideo: vi.fn(() => Promise.resolve()) }));
vi.mock('@/desk/monitor', () => ({ playPlatePreview: vi.fn(), setCompare: vi.fn() }));

const askMock = vi.mocked(ask) as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
  desk.set({ slug: 'demo', video: makeVideo({ versions: [makeVersion({ id: 'v1', name: 'v1', title: 'First' }), makeVersion({ id: 'v2', name: 'v2' })] }) });
});

describe('snapshotVersion', () => {
  it('saves a named release, reloads and opens Versions', async () => {
    askMock.mockResolvedValue('  My cut  ');
    let body: unknown;
    server.use(
      http.post('/api/video/:slug/versions/snapshot', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ version: { name: 'v3', title: 'My cut' } });
      }),
    );
    await snapshotVersion();
    expect(askMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prompt', title: 'Save a version', value: 'Saved snapshot', ok: 'Save version' }));
    expect(body).toEqual({ title: 'My cut', trigger: 'manual', kind: 'release', note: 'manual save' });
    expect(loadVideo).toHaveBeenCalledWith('demo');
    expect(desk.get().leftTab).toBe('versions');
    expect(toast).toHaveBeenCalledWith('v3 saved', 'My cut');
  });

  it('does nothing when cancelled and toasts a failure', async () => {
    askMock.mockResolvedValue(null);
    await snapshotVersion();
    expect(loadVideo).not.toHaveBeenCalled();
    askMock.mockResolvedValue('');
    server.use(http.post('/api/video/:slug/versions/snapshot', () => HttpResponse.json({ error: 'disk full' }, { status: 500 })));
    await snapshotVersion();
    expect(toast).toHaveBeenCalledWith('Save failed', 'disk full', 'err');
  });
});

describe('selection', () => {
  it('adds and removes ids once', () => {
    setVersionSelected('v1', true);
    setVersionSelected('v1', true);
    expect(desk.get().versionSelection).toEqual(['v1']);
    selectVersions(['v1', 'v2'], true);
    expect(desk.get().versionSelection).toEqual(['v1', 'v2']);
    selectVersions(['v1'], false);
    expect(desk.get().versionSelection).toEqual(['v2']);
  });
});

describe('deleteSelectedVersions', () => {
  it('plans, confirms, deletes and reloads', async () => {
    desk.set({ versionSelection: ['v1'] });
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/video/:slug/versions/delete', async ({ request }) => {
        const b = (await request.json()) as { confirm: boolean };
        bodies.push(b);
        const versions = [{ id: 'v1', name: 'v1', title: 'First', kind: 'release', bytes: 2048 }];
        return HttpResponse.json(b.confirm ? { versions, totalLabel: '2 KB' } : { versions, totalBytes: 2048 });
      }),
    );
    askMock.mockResolvedValue(true);
    await deleteSelectedVersions();
    expect(bodies).toEqual([
      { confirm: false, ids: ['v1'] },
      { confirm: true, ids: ['v1'] },
    ]);
    expect(askMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete this version?',
        ok: 'Delete version',
        tone: 'warn',
        detail: '1 version · 2.0 KB\n\n· v1 · First · 2.0 KB\n\nRemoved from History permanently. The current master and live.mp4 stay.',
      }),
    );
    expect(desk.get().versionSelection).toEqual([]);
    expect(loadVideo).toHaveBeenCalledWith('demo');
    expect(toast).toHaveBeenCalledWith('Version deleted', '2 KB');
  });

  it('says nothing is left to delete', async () => {
    desk.set({ versionSelection: ['gone'] });
    server.use(http.post('/api/video/:slug/versions/delete', () => HttpResponse.json({ versions: [], missing: ['gone'] })));
    await deleteSelectedVersions();
    expect(toast).toHaveBeenCalledWith('Nothing to delete', 'Those versions are already gone');
    expect(desk.get().versionSelection).toEqual([]);
  });
});

describe('cleanIntermediates', () => {
  it('confirms the file plan, then deletes', async () => {
    let calls = 0;
    server.use(
      http.post('/api/video/:slug/cleanup', async ({ request }) => {
        calls += 1;
        const b = (await request.json()) as { confirm: boolean };
        return HttpResponse.json({ files: [{ name: 'a.mp4', bytes: 10 }], totalLabel: b.confirm ? '10 B' : '10 B' });
      }),
    );
    askMock.mockResolvedValue(true);
    await cleanIntermediates();
    expect(calls).toBe(2);
    expect(askMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Clean intermediate files?', ok: 'Delete files' }));
    expect(toast).toHaveBeenCalledWith('Intermediates deleted', '1 file · 10 B');
  });

  it('toasts when there is nothing to clean', async () => {
    server.use(http.post('/api/video/:slug/cleanup', () => HttpResponse.json({ files: [] })));
    await cleanIntermediates();
    expect(toast).toHaveBeenCalledWith('Nothing to clean', 'No plates, slices, or premaster audio on disk');
  });

  it('lists at most eight files', async () => {
    askMock.mockResolvedValue(false);
    const files = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, bytes: 1 }));
    await confirmFilePlan({ files, totalBytes: 10 }, { title: 'T', ok: 'Ok', keepNote: 'Keep' });
    const detail = (askMock.mock.calls[0]?.[0] as { detail: string }).detail;
    expect(detail.split('\n')).toEqual(['10 files · 10 B', '', ...files.slice(0, 8).map((f) => `· ${f.name} · 1 B`), '· …and 2 more', '', 'Keep']);
  });
});

describe('versionAction', () => {
  it('plays a version on Program', async () => {
    await versionAction('play', 'v1');
    expect(playPlatePreview).toHaveBeenCalledWith('/version-media/demo/v1/demo.mp4', 'Snapshot · v12 · Rendered sequence');
  });

  it('compares against a version', async () => {
    await versionAction('compare', 'v2');
    expect(desk.get().compareId).toBe('v2');
    expect(setCompare).toHaveBeenCalledWith(true);
    expect(toast).toHaveBeenCalledWith('Compare', 'Current vs v12 · Rendered sequence');
  });

  it('restores a version and reloads', async () => {
    let hit = '';
    server.use(
      http.post('/api/video/:slug/versions/:id/restore', ({ params }) => {
        hit = String(params['id']);
        return HttpResponse.json({ ok: true });
      }),
    );
    await versionAction('restore', 'v1');
    expect(hit).toBe('v1');
    expect(loadVideo).toHaveBeenCalledWith('demo');
    expect(toast).toHaveBeenCalledWith('v1 restored', 'Press Render to rebuild');
  });
});
