import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushEditorContentPending = vi.fn(() => Promise.resolve());

vi.mock('./plateContentPane', () => ({
  flushEditorContentPending,
  kickContentPending: vi.fn(),
  settlePlateContent: vi.fn(() => Promise.resolve()),
  resetPlateContentPane: vi.fn(),
}));

vi.mock('./data', () => ({
  refresh: vi.fn(() => Promise.resolve(null)),
  validateSelection: vi.fn(),
}));
vi.mock('./overview', () => ({ undressOverview: vi.fn(), wireOverview: vi.fn(), toCut: (t: number) => t, toProgram: (t: number) => t }));
vi.mock('./stage', () => ({ ensureLiveCards: vi.fn(() => Promise.resolve(true)), paintFrame: vi.fn(), renderFrame: vi.fn(), syncLiveSource: vi.fn() }));
vi.mock('./timeline', () => ({ renderTimeline: vi.fn(), flashHint: vi.fn() }));
vi.mock('./timelineMorph', () => ({ playMorph: vi.fn() }));
vi.mock('./transport', () => ({ paintTransport: vi.fn() }));
vi.mock('./text', () => ({ paintTextMode: vi.fn() }));
vi.mock('./edits', () => ({ paintStatus: vi.fn(), showInspectorTab: vi.fn() }));
vi.mock('./inspector', () => ({ renderInspector: vi.fn() }));
vi.mock('./plateContentSave', () => ({ paintInspectorUnlessContentTyping: (fn: () => void) => fn() }));
vi.mock('./audio', () => ({ previewState: vi.fn(() => ({})), preview: { load: vi.fn() } }));
vi.mock('./state', () => ({
  ed: { active: false, deck: null, seq: [], sel: null, focus: null, total: 0, t: 0 },
  preview: { load: vi.fn() },
}));

const { onEnter } = await import('./lifecycle');

beforeEach(() => {
  flushEditorContentPending.mockClear();
});

describe('onEnter', () => {
  it('flushes debounced Content before the editor paints', async () => {
    await onEnter({ programT: 0 });
    expect(flushEditorContentPending).toHaveBeenCalledTimes(1);
  });
});
