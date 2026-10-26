import { describe, expect, it } from 'vitest';

import { fmtShort } from '@/desk/format';
import { makeVersion } from '@/test/factories';

import {
  formatVersionWhen,
  versionBytes,
  versionCountText,
  versionDisplayName,
  versionMetaBits,
  versionNoteShown,
  versionQcLabel,
  versionsToolbar,
  visibleVersions,
} from './versions';

const release = makeVersion({ id: 'r1', name: 'v3', kind: 'release', sizeMB: 1 });
const checkpoint = makeVersion({ id: 'c1', name: 'v2', kind: 'checkpoint', sizeMB: 2 });

describe('version helpers', () => {
  it('formats the created time and tolerates junk', () => {
    expect(formatVersionWhen('')).toBe('');
    expect(formatVersionWhen('not a date')).toBe('');
    expect(formatVersionWhen('2026-10-20T09:00:00.000Z')).not.toBe('');
  });

  it('names a version the way the picker does', () => {
    expect(versionDisplayName({ displayName: 'v1 · Shown' })).toBe('v1 · Shown');
    expect(versionDisplayName({ name: 'v1', title: 'Cut' })).toBe('v1 · Cut');
    expect(versionDisplayName({ label: 'Label' })).toBe('Label');
    expect(versionDisplayName({ id: 'abc' })).toBe('abc');
  });

  it('reads bytes, then size in MB', () => {
    expect(versionBytes({ bytes: 10 })).toBe(10);
    expect(versionBytes({ sizeMB: 1 })).toBe(1024 * 1024);
    expect(versionBytes(null)).toBe(0);
  });

  it('hides checkpoints unless asked and counts them', () => {
    expect(visibleVersions([release, checkpoint], false)).toEqual([release]);
    expect(visibleVersions([release, checkpoint], true)).toHaveLength(2);
    expect(versionCountText([], false)).toBe('No versions yet');
    expect(versionCountText([release, checkpoint], false)).toBe('1 version · 1 checkpoint hidden');
    expect(versionCountText([release, checkpoint], true)).toBe('2 in history · latest v3');
  });

  it('builds the manage toolbar from the selection', () => {
    expect(versionsToolbar([], [], []).meta).toBe('Save a version to manage History');
    const none = versionsToolbar([release, checkpoint], [release], []);
    expect(none).toMatchObject({ meta: 'Nothing selected', deleteDisabled: true, deleteText: 'Delete', allChecked: false, allDisabled: false });
    const hidden = versionsToolbar([release, checkpoint], [release], ['c1']);
    expect(hidden.meta).toBe('1 selected · ~2.0 MB · 1 hidden');
    expect(hidden).toMatchObject({ hasSelection: true, deleteDisabled: false, deleteText: 'Delete (1)', allIndeterminate: false });
    const all = versionsToolbar([release, checkpoint], [release, checkpoint], ['r1']);
    expect(all.allIndeterminate).toBe(true);
    expect(versionsToolbar([release], [release], ['r1']).allChecked).toBe(true);
    expect(versionsToolbar([release], [], []).allDisabled).toBe(true);
  });

  it('writes the card meta, QC chip and note rules', () => {
    const { metaBits, size } = versionMetaBits(makeVersion({ durationSec: 65, sizeMB: 3.5, createdAt: '' }), fmtShort);
    expect(metaBits).toBe('1:05 · 3.5 MB');
    expect(size).toBe('3.5 MB');
    expect(versionMetaBits(makeVersion({ durationSec: null, sizeMB: null, createdAt: '' }), fmtShort).metaBits).toBe('—');
    expect(versionQcLabel('warn')).toBe('QC warnings');
    expect(versionQcLabel('bad')).toBe('QC failed');
    expect(versionQcLabel('pass')).toBeUndefined();
    expect(versionNoteShown('studio make video')).toBe(false);
    // The legacy prefix test also swallows notes that merely start with "cli…".
    expect(versionNoteShown('Client approved')).toBe(false);
    expect(versionNoteShown('Approved by the client')).toBe(true);
  });
});
