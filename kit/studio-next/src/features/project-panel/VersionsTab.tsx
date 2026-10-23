import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Version } from '@/api/types';
import { fmtShort } from '@/desk/format';
import { desk, useDesk } from '@/desk/store';
import { HelpTip } from '@/ui/HelpTip';
import { Icon } from '@/ui/icons';
import { Zen } from '@/ui/Zen';

import { openQcReview } from '@/features/review/qc';

import {
  cleanIntermediates,
  deleteSelectedVersions,
  selectVersions,
  setVersionSelected,
  snapshotVersion,
  versionAction,
} from './versionActions';
import {
  versionCountText,
  versionMetaBits,
  versionNoteShown,
  versionQcLabel,
  versionsToolbar,
  visibleVersions,
  type VersionsToolbarView,
} from './versions';

const CHECKPOINT_HELP =
  'Every render saves a checkpoint automatically. Named versions are the ones you saved or approved; checkpoints are hidden unless you need to roll back further.';

const NO_VERSIONS: Version[] = [];

const TOOLBAR_DEFAULT: VersionsToolbarView = {
  hasSelection: false,
  meta: 'Nothing selected',
  deleteDisabled: true,
  deleteText: 'Delete',
  allChecked: false,
  allIndeterminate: false,
  allDisabled: false,
};

function useVersions() {
  return useDesk(
    useShallow((s) => ({
      versions: s.video?.versions ?? NO_VERSIONS,
      showCheckpoints: s.showCheckpoints,
      selection: s.versionSelection,
    })),
  );
}

/** `#leftVersions` body — History: the count, the checkpoint filter, manage tools and the cards. */
export function VersionsBody() {
  const { versions, showCheckpoints } = useVersions();
  return (
    <>
      <div className="versions-head panel-head">
        <span className="panel-head-ico" aria-hidden="true">
          <Icon name="ui-history" size={18} />
        </span>
        <div className="versions-head-text">
          <h2 className="versions-title">History</h2>
          <p className="versions-sub" id="versionCount">
            {versionCountText(versions, showCheckpoints)}
          </p>
        </div>
        <button type="button" id="btnSnapshotSide" className="btn tiny icon-text" title="Save a named version" onClick={() => void snapshotVersion()}>
          <Icon name="ui-plus-fill" size={12} /> Save version
        </button>
      </div>
      <label className="versions-filter tog compact">
        <input
          type="checkbox"
          id="togShowCheckpoints"
          checked={showCheckpoints}
          onChange={(e) => desk.set({ showCheckpoints: e.currentTarget.checked })}
        />{' '}
        <span>Show pipeline checkpoints</span>{' '}
        <span data-help={CHECKPOINT_HELP} className="help-anchor has-help">
          <HelpTip text={CHECKPOINT_HELP} label="" />
        </span>
      </label>
      <VersionsManage />
      <VersionList />
    </>
  );
}

function VersionsManage() {
  const hasVideo = useDesk((s) => Boolean(s.slug));
  const painted = useDesk((s) => s.video != null);
  const { versions, showCheckpoints, selection } = useVersions();
  const visible = useMemo(() => visibleVersions(versions, showCheckpoints), [versions, showCheckpoints]);
  // Before the first summary the toolbar keeps its markup defaults.
  const view = painted ? versionsToolbar(versions, visible, selection) : TOOLBAR_DEFAULT;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = view.allIndeterminate;
  }, [view.allIndeterminate]);

  return (
    <div id="versionsManage" className={view.hasSelection ? 'versions-manage has-selection' : 'versions-manage'} hidden={!hasVideo}>
      <div className="versions-manage-row">
        <label className="tog compact versions-select-all">
          <input
            ref={allRef}
            type="checkbox"
            id="togSelectAllVersions"
            checked={view.allChecked}
            disabled={view.allDisabled}
            onChange={(e) =>
              selectVersions(
                visible.map((ver) => ver.id),
                e.currentTarget.checked,
              )
            }
          />{' '}
          <span>Select all</span>
        </label>{' '}
        <span id="versionsSelectionMeta" className="versions-selection-meta">
          {view.meta}
        </span>
      </div>
      <div className="versions-manage-actions">
        <button
          type="button"
          id="btnDeleteVersions"
          className="btn tiny versions-delete"
          disabled={view.deleteDisabled}
          title="Delete selected versions from History"
          onClick={() => void deleteSelectedVersions()}
        >
          {view.deleteText}
        </button>{' '}
        <button
          type="button"
          id="btnCleanIntermediates"
          className="btn tiny ghost"
          title="Remove regenerable plates, slices, and premaster audio"
          onClick={() => void cleanIntermediates()}
        >
          Clean intermediates
        </button>
      </div>
    </div>
  );
}

function VersionList() {
  const hasVideo = useDesk((s) => s.video != null);
  const { versions, showCheckpoints, selection } = useVersions();
  const visible = useMemo(() => visibleVersions(versions, showCheckpoints), [versions, showCheckpoints]);
  const latestRelease = versions.find((ver) => ver.kind !== 'checkpoint')?.id;
  const picked = new Set(selection);

  let body;
  if (!hasVideo) body = null;
  else if (!versions.length) {
    body = (
      <li className="version-empty">
        <Zen
          art="clapper"
          title="No versions yet 🎬"
          sub={
            <>
              Finish a Render or click <strong>Save version</strong>. Every render also leaves a checkpoint.
            </>
          }
        />
      </li>
    );
  } else if (!visible.length) {
    body = (
      <li className="version-empty">
        <Zen art="clapper" title="Only checkpoints so far 🎬" sub="Turn on “Show pipeline checkpoints” or save a named version." />
      </li>
    );
  } else {
    body = visible.map((ver) => (
      <VersionCard key={ver.id} ver={ver} latest={ver.kind !== 'checkpoint' && ver.id === latestRelease} selected={picked.has(ver.id)} />
    ));
  }
  return (
    <ul id="versions" className="version-list">
      {body}
    </ul>
  );
}

function VerButton({ act, ver, iconName }: { act: string; ver: Version; iconName: string }) {
  const label = `${act === 'play' ? 'Play' : act === 'compare' ? 'Compare' : 'Restore'} ${ver.name || ''}`;
  return (
    <button
      type="button"
      className="btn icon-only"
      data-ver={ver.id}
      data-act={act}
      title={label}
      aria-label={label}
      onClick={() => void versionAction(act, ver.id)}
    >
      <Icon name={iconName} size={14} />
    </button>
  );
}

function VersionCard({ ver, latest, selected }: { ver: Version; latest: boolean; selected: boolean }) {
  const { metaBits, size } = versionMetaBits(ver, fmtShort);
  const qcLabel = versionQcLabel(ver.qcStatus);
  const checkpoint = ver.kind === 'checkpoint';
  const chips = [
    checkpoint ? (
      <span key="cp" className="ver-chip muted">
        Checkpoint
      </span>
    ) : null,
    latest ? (
      <span key="latest" className="ver-chip accent">
        Latest
      </span>
    ) : null,
    ver.hasAudio ? null : (
      <span key="silent" className="ver-chip muted">
        Silent
      </span>
    ),
    ver.hasCaptions ? null : (
      <span key="nocap" className="ver-chip muted">
        No captions
      </span>
    ),
  ].filter(Boolean);
  const pickLabel = `Select ${ver.name || ver.id}`;

  return (
    <li
      className={`version-card ${checkpoint ? 'is-checkpoint' : ''} ${latest ? 'is-latest' : ''} ${selected ? 'is-selected' : ''}`}
      data-ver-id={ver.id}
    >
      <div className="version-card-top">
        <label className="version-pick" title={pickLabel}>
          <input
            type="checkbox"
            data-ver-select={ver.id}
            checked={selected}
            aria-label={pickLabel}
            onChange={(e) => setVersionSelected(ver.id, e.currentTarget.checked)}
          />
        </label>
        <span className="version-badge" title="Version number">
          {ver.name || `v${ver.number || '?'}`}
        </span>
        <div className="version-card-titles">
          <strong className="version-card-title">{ver.title || ver.label || 'Snapshot'}</strong>
          <span className="version-card-meta" title={size}>
            {metaBits}
          </span>
        </div>
      </div>
      {chips.length || qcLabel ? (
        <div className="version-chips">
          {chips}
          {qcLabel ? (
            <button
              type="button"
              className={`ver-chip ver-chip-btn qc-${ver.qcStatus}`}
              title="Open quality findings in Review"
              onClick={() => openQcReview({ selectAll: true })}
            >
              {qcLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {versionNoteShown(ver.note) ? <p className="version-note">{ver.note}</p> : null}
      <div className="version-actions icon-actions">
        <VerButton act="play" ver={ver} iconName="play-fill" />
        <VerButton act="compare" ver={ver} iconName="compare" />
        <VerButton act="restore" ver={ver} iconName="restore" />
      </div>
    </li>
  );
}
