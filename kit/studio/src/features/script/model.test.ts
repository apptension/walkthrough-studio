import { describe, expect, it } from 'vitest';

import { makeScript, makeScriptScene } from '@/test/factories';

import {
  approvedMeta,
  briefDetail,
  callTargetIndex,
  canDragScene,
  chapterSceneNear,
  plateAmongIndex,
  rowPlaceholder,
  sceneClassName,
  sceneIssues,
  sceneListItems,
  scenePreviewTitle,
  sceneVisibility,
  speedOptions,
  timingView,
  totalsLength,
  totalsText,
  worstLevel,
} from './model';

const open = makeScriptScene({ kind: 'open', key: 'open', title: 'Hello' });
const ch1 = makeScriptScene({ key: 'c1', title: 'One', flowIndex: 0, flowCount: 3, editable: { title: true, narration: true, move: true } });
const plate = makeScriptScene({ kind: 'plate', key: 'p1', title: 'Proof', plateId: 'pl1', before: 'Two', editable: { title: true, narration: true, place: true } });
const ch2 = makeScriptScene({ key: 'c2', title: 'Two', flowIndex: 1, flowCount: 3, issues: [{ level: 'warn', message: 'Long line', key: 'c2' }] });
const ch3 = makeScriptScene({ key: 'c3', title: 'Three', flowIndex: 2, flowCount: 3 });
const close = makeScriptScene({ kind: 'close', key: 'close', title: 'Bye', narration: '' });
const scenes = [open, ch1, plate, ch2, ch3, close];

describe('scene helpers', () => {
  it('names plate row placeholders, with FAQ fallbacks', () => {
    expect(rowPlaceholder('kpi', 'label')).toBe('Metric name');
    expect(rowPlaceholder('faq', 'label')).toBe('Question');
    expect(rowPlaceholder('faq', 'note')).toBe('Answer');
    expect(rowPlaceholder('other', 'mystery')).toBe('mystery');
  });

  it('builds the legacy row class name', () => {
    expect(sceneClassName(ch2, false)).toBe('script-scene kind-chapter has-warn has-vo');
    expect(sceneClassName(close, false)).toBe('script-scene kind-close no-vo');
    expect(sceneClassName(ch1, false)).toContain('is-draggable');
    expect(canDragScene(plate)).toBe(true);
    expect(canDragScene(open)).toBe(false);
  });

  it('drops scaffold "No narration" notes and ranks the rest', () => {
    const s = makeScriptScene({ issues: [{ level: 'error', message: 'No narration yet', key: 'x' }, { level: 'info', message: 'Tip', key: 'x' }] });
    expect(sceneIssues(s, true).map((i) => i.message)).toEqual(['Tip']);
    expect(worstLevel(sceneIssues(s, false))).toBe('error');
    expect(worstLevel([])).toBe('');
  });

  it('offers paces from 0.80× to 1.30×', () => {
    const opts = speedOptions(1.1);
    expect(opts).toHaveLength(11);
    expect(opts[0]?.label).toBe('0.80× slower');
    expect(opts[4]?.label).toBe('1.00× natural');
    expect(opts.find((o) => o.selected)?.label).toBe('1.10× quicker');
  });

  it('prints a multi-line title the way the legacy template did', () => {
    const lines = ['It records your', '*real product*', 'in a browser.'] as unknown as string;
    expect(scenePreviewTitle(makeScriptScene({ title: lines }))).toBe('It records your,*real product*,in a browser.');
  });

  it('flags a voice-over that outruns its hold', () => {
    expect(timingView(makeScriptScene({ holdSec: 2, narrationSec: 3 })).tight).toBe(true);
    expect(timingView(makeScriptScene({ holdSec: 3, narrationSec: 3.2 })).tight).toBe(false);
  });
});

describe('scene list', () => {
  it('puts section headers before the first scene of each part', () => {
    const items = sceneListItems(scenes);
    expect(items.map((i) => (i.type === 'section' ? `#${i.id}` : i.scene.key))).toEqual(['#opening', 'open', '#story', 'c1', 'p1', 'c2', 'c3', '#closing', 'close']);
    const story = items.find((i) => i.type === 'section' && i.id === 'story');
    expect(story).toMatchObject({ count: 4 });
  });

  it('hides collapsed parts and, with the filter on, scenes without issues', () => {
    const items = sceneListItems(scenes);
    const collapsed = sceneVisibility(items, { opening: true, story: false, closing: false }, false, false);
    expect(collapsed.sceneHidden.get('open')).toBe(true);
    expect(collapsed.sceneCollapsed.get('open')).toBe(true);
    expect(collapsed.sceneHidden.get('c1')).toBe(false);
    const filtered = sceneVisibility(items, { opening: false, story: false, closing: false }, true, false);
    expect([...filtered.sceneHidden].filter(([, h]) => !h).map(([k]) => k)).toEqual(['c2']);
    expect(filtered.sectionHidden.get('opening')).toBe(true);
    expect(filtered.sectionHidden.get('story')).toBe(false);
    expect(filtered.composerHidden).toBe(true);
    expect(filtered.empty).toBe(false);
  });
});

describe('header text', () => {
  it('summarises the totals, or the draft state', () => {
    const { script } = makeScript({ script: { totals: { chapters: 3, plates: 1, words: 120, estSec: 65 } } });
    expect(totalsLength(65)).toBe('1:05');
    expect(totalsText(script, false)).toBe('3 chapters · 1 plates · 120 words · ~1:05');
    expect(totalsText(script, true)).toBe('Writing chapters, plates and narration from your brief…');
    expect(totalsText({ ...script, scaffold: true }, false)).toBe('Starter template · waiting for a real draft');
  });

  it('says who approved and when', () => {
    const when = () => '5 min ago';
    expect(approvedMeta({ effective: 'approved', approvedAt: 'x', approvedBy: 'Ada' }, 0, false, when)).toBe('Approved 5 min ago by Ada');
    expect(approvedMeta({ effective: 'changed', approvedAt: 'x' }, 0, false, when)).toBe('Approved 5 min ago — sources changed since');
    expect(approvedMeta({ effective: 'draft' }, 2, false, when)).toBe('2 blocking issue(s)');
    expect(approvedMeta({ effective: 'draft' }, 2, true, when)).toBe('');
  });

  it('pins the brief line, trimming the how-to from each beat', () => {
    expect(
      briefDetail({ outcome: 'Invite a teammate', story: { mustShow: ['People — see capacity · how: click People', 'Share'] } } as never, { label: 'Overview', framework: 'PPPPP' }),
    ).toBe('Story: Overview — PPPPP · Outcome: Invite a teammate · Show: People → Share');
    expect(briefDetail({} as never, null)).toBe('Pinned with the project.');
  });
});

describe('drag targets', () => {
  it('resolves a plate to the chapter it sits before', () => {
    expect(chapterSceneNear(scenes, 'p1')?.key).toBe('c2');
    expect(chapterSceneNear(scenes, 'c3')?.key).toBe('c3');
  });

  it('computes the flow index a chapter drops at', () => {
    expect(callTargetIndex(scenes, ch1, ch3, 'after')).toBe(2);
    expect(callTargetIndex(scenes, ch3, ch1, 'before')).toBe(0);
    expect(callTargetIndex(scenes, ch3, plate, 'before')).toBe(1);
    expect(callTargetIndex(scenes, open, ch1, 'before')).toBeNull();
  });

  it('counts a plate position among its siblings, excluding itself', () => {
    const p2 = makeScriptScene({ kind: 'plate', key: 'p2', before: 'Two' });
    const list = [...scenes, p2];
    expect(plateAmongIndex(list, 'Two', null, 'after', 'p9')).toBe(2);
    expect(plateAmongIndex(list, 'Two', 'p2', 'after', 'p1')).toBe(1);
    expect(plateAmongIndex(list, 'Two', 'p1', 'before', 'p2')).toBe(0);
  });
});
