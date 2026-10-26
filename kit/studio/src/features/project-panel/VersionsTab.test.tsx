import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';
import { makeVersion, makeVideo } from '@/test/factories';

import type * as VersionActionsModule from './versionActions';
import { cleanIntermediates, deleteSelectedVersions, snapshotVersion, versionAction } from './versionActions';
import { VersionsBody } from './VersionsTab';

vi.mock('./versionActions', async (importOriginal) => ({
  ...(await importOriginal<typeof VersionActionsModule>()),
  snapshotVersion: vi.fn(),
  deleteSelectedVersions: vi.fn(),
  cleanIntermediates: vi.fn(),
  versionAction: vi.fn(),
}));

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const release = makeVersion({ id: 'r2', name: 'v2', title: 'Approved cut', kind: 'release', hasAudio: true, hasCaptions: true, qcStatus: 'warn', note: 'Sent to legal' });
const older = makeVersion({ id: 'r1', name: 'v1', title: 'First', kind: 'release', hasAudio: false, hasCaptions: false, note: 'studio make video' });
const checkpoint = makeVersion({ id: 'c1', name: 'v0', kind: 'checkpoint' });

function load(versions = [release, older, checkpoint]) {
  act(() => desk.set({ slug: 'demo', video: makeVideo({ versions }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  desk.reset();
});

describe('VersionsBody', () => {
  it('renders the head and hides the manage row without a sequence', () => {
    render(<VersionsBody />);
    expect(document.querySelector('.versions-title')).toHaveTextContent('History');
    expect($('togShowCheckpoints')).not.toBeChecked();
    expect($('versionsManage').hidden).toBe(true);
    expect($('versionsSelectionMeta')).toHaveTextContent('Nothing selected');
    expect($('btnDeleteVersions')).toBeDisabled();
    expect($('versions')).toBeEmptyDOMElement();
    fireEvent.click($('btnSnapshotSide'));
    expect(snapshotVersion).toHaveBeenCalled();
  });

  it('lists named versions with chips, notes and actions', () => {
    render(<VersionsBody />);
    load();
    const cards = $('versions').querySelectorAll('li.version-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('class', 'version-card  is-latest ');
    expect(cards[0]).toHaveAttribute('data-ver-id', 'r2');
    expect(cards[0]?.querySelector('.version-badge')).toHaveTextContent('v2');
    expect(cards[0]?.querySelector('.version-card-title')).toHaveTextContent('Approved cut');
    expect([...(cards[0]?.querySelectorAll('.ver-chip') ?? [])].map((c) => c.textContent)).toEqual(['Latest', 'QC warnings']);
    expect(cards[0]?.querySelector('button.ver-chip-btn')).toHaveTextContent('QC warnings');
    fireEvent.click(cards[0]!.querySelector('button.ver-chip-btn')!);
    expect(desk.get().rightTab).toBe('review');
    expect(cards[0]?.querySelector('.version-note')).toHaveTextContent('Sent to legal');
    expect([...(cards[1]?.querySelectorAll('.ver-chip') ?? [])].map((c) => c.textContent)).toEqual(['Silent', 'No captions']);
    expect(cards[1]?.querySelector('.version-note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play v2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore v1' }));
    expect(vi.mocked(versionAction).mock.calls).toEqual([
      ['play', 'r2'],
      ['compare', 'r1'],
      ['restore', 'r1'],
    ]);
  });

  it('shows checkpoints on demand', () => {
    render(<VersionsBody />);
    load();
    fireEvent.click($('togShowCheckpoints'));
    expect(desk.get().showCheckpoints).toBe(true);
    const cp = $('versions').querySelector('[data-ver-id="c1"]');
    expect(cp).toHaveClass('is-checkpoint');
    expect(cp?.querySelector('.ver-chip')).toHaveTextContent('Checkpoint');
  });

  it('selects, selects all and deletes', () => {
    render(<VersionsBody />);
    load();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select v1' }));
    expect(desk.get().versionSelection).toEqual(['r1']);
    expect($('versionsManage')).toHaveClass('has-selection');
    expect(($('togSelectAllVersions') as HTMLInputElement).indeterminate).toBe(true);
    expect($('versions').querySelector('[data-ver-id="r1"]')).toHaveClass('is-selected');
    fireEvent.click($('togSelectAllVersions'));
    expect(desk.get().versionSelection).toEqual(['r1', 'r2']);
    expect($('togSelectAllVersions')).toBeChecked();
    expect($('btnDeleteVersions')).toBeEnabled();
    fireEvent.click($('btnDeleteVersions'));
    fireEvent.click($('btnCleanIntermediates'));
    expect(deleteSelectedVersions).toHaveBeenCalled();
    expect(cleanIntermediates).toHaveBeenCalled();
  });

  it('shows the empty states', () => {
    render(<VersionsBody />);
    load([]);
    expect($('versions').querySelector('.version-empty')).toHaveTextContent('No versions yet 🎬');
    load([checkpoint]);
    expect($('versions').querySelector('.version-empty')).toHaveTextContent('Only checkpoints so far 🎬');
  });
});
