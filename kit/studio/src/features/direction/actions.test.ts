import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushPendingContent = vi.fn(() => Promise.resolve());
const editorBridge = { active: false, flushPendingContent };

vi.mock('@/desk/bridge', () => ({
  bridges: {
    get editor() {
      return editorBridge;
    },
    plate: {},
  },
}));

vi.mock('@/desk/api', () => ({
  api: vi.fn(() => Promise.resolve({ direction: {}, motion: {}, transitions: {} })),
  enc: (s: string) => encodeURIComponent(s),
}));

vi.mock('./view', () => ({
  renderDirection: vi.fn(),
  renderTransitions: vi.fn(),
  renderEffects: vi.fn(),
  directionView: { get: () => ({ direction: null, overlay: {} }), set: vi.fn() },
}));

const { desk } = await import('@/desk/store');
const { flushEditorBeforeDirectionMutation, saveDirection } = await import('./actions');

beforeEach(() => {
  desk.reset();
  desk.set({ slug: 'demo', video: { slug: 'demo', direction: {}, motion: {}, transitions: { style: 'fade', duration: 0.6 } } as never });
  flushPendingContent.mockClear();
  editorBridge.active = false;
});

describe('flushEditorBeforeDirectionMutation', () => {
  it('no-ops when the Editor is closed', async () => {
    await flushEditorBeforeDirectionMutation();
    expect(flushPendingContent).not.toHaveBeenCalled();
  });

  it('awaits editor content flush before direction saves', async () => {
    editorBridge.active = true;
    await saveDirection({ scale: 'brand' });
    expect(flushPendingContent).toHaveBeenCalledTimes(1);
  });
});
