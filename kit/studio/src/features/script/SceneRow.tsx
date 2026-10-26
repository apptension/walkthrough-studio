import { Icon } from '@/ui/icons';

import { canDragScene, sceneClassName, sceneIssues, sceneKindLabel, scenePreviewTitle, sceneRole, sectionOf, speedOptions, timingView } from './model';
import { ScreenCall, ScreenClose, ScreenOpen, ScreenPlate } from './SceneScreens';
import type { ScriptScene } from './types';

/** `timingStrip(s)` — hold chip for live cards, a fitted length for everything else. */
function TimingStrip({ s }: { s: ScriptScene }) {
  const t = timingView(s);
  if (t.card) {
    return (
      <div className="ss-meta" data-timing="card">
        <div className={`ss-chips${t.tight ? ' is-tight' : ''}`}>
          <label className="ss-chip ss-chip-hold" title="Seconds the card stays on screen">
            <span>Hold</span>{' '}
            <input
              type="number"
              min="0.4"
              max="12"
              step="0.1"
              data-struct-field="call.hold"
              data-flow-index={s.flowIndex ?? undefined}
              defaultValue={t.hold.toFixed(1)}
              aria-label="Card hold in seconds"
            />{' '}
            <em>s</em>
          </label>{' '}
          <button
            type="button"
            className="ss-chip-btn"
            data-struct-action="hold-reset"
            data-flow-index={s.flowIndex ?? undefined}
            title={`Use default ${Number(s.holdDefault || 0).toFixed(1)}s`}
            disabled={!s.holdExplicit}
          >
            Default
          </button>{' '}
          {t.vo > 0 ? (
            <span className="ss-chip quiet" title="Estimated voice length">
              VO {t.vo.toFixed(1)}s
            </span>
          ) : null}{' '}
          {t.tight ? <span className="ss-chip warn">Voice longer than hold</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="ss-meta" data-timing={s.timingKind || 'plate'}>
      <div className="ss-chips">
        <span className="ss-chip strong" title="On-screen duration for this beat">
          ~{t.fit.toFixed(1)}s
        </span>{' '}
        <span className="ss-chip quiet">{s.timingKind === 'plate' ? 'Plate' : 'Beat'}</span>
      </div>
    </div>
  );
}

function Screen({ s, chapters }: { s: ScriptScene; chapters: string[] }) {
  if (s.kind === 'open') return <ScreenOpen s={s} />;
  if (s.kind === 'close') return <ScreenClose s={s} />;
  if (s.kind === 'plate') return <ScreenPlate s={s} chapters={chapters} />;
  return <ScreenCall s={s} />;
}

interface SceneRowProps {
  s: ScriptScene;
  index: number;
  scaffold: boolean;
  /** Script-level chapters, for plates that don't carry their own list. */
  chapters: string[];
  hidden: boolean;
  sectionCollapsed: boolean;
}

/** `sceneRow(s, i)` — one beat in `#scriptScenes`. */
export function SceneRow({ s, index, scaffold, chapters, hidden, sectionCollapsed }: SceneRowProps) {
  const issues = sceneIssues(s, scaffold);
  const hasVo = Boolean((s.narration || '').trim());
  const draggable = canDragScene(s);
  const role = sceneRole(s);
  return (
    <li
      className={`${sceneClassName(s, scaffold)}${sectionCollapsed ? ' is-section-collapsed' : ''}`}
      data-key={s.key}
      data-kind={s.kind}
      data-section-group={sectionOf(s.kind)}
      data-issues={issues.length}
      data-flow-index={s.flowIndex ?? undefined}
      data-flow-count={s.flowCount ?? undefined}
      data-plate-id={s.plateId || undefined}
      data-before={s.before || undefined}
      data-can-drag={draggable ? '1' : undefined}
      hidden={hidden}
    >
      <div className="ss-rail" aria-hidden="true">
        <span className="ss-num">{String(index + 1).padStart(2, '0')}</span>{' '}
        <span className="ss-rail-line" />{' '}
        <span className="ss-rail-dot" />
      </div>{' '}
      <article className="ss-card">
        <header className="ss-card-head">
          {draggable ? (
            <button type="button" className="ss-drag" data-drag-handle="" title="Drag to reorder" aria-label={`Drag to reorder ${role}`}>
              <Icon name="grip" size={14} />
            </button>
          ) : null}{' '}
          <span className="ss-kind" title={sceneKindLabel(s)}>
            {role}
          </span>{' '}
          {s.kind === 'plate' && s.plate?.typeLabel ? <span className="ss-type-chip">{s.plate.typeLabel}</span> : null}{' '}
          <strong className="ss-card-title">{scenePreviewTitle(s)}</strong>{' '}
          <span className="ss-head-spacer" />{' '}
          <TimingStrip s={s} />
        </header>{' '}
        <div className="ss-screen">
          <span className="ss-block-label">On screen</span> <Screen s={s} chapters={chapters} />
        </div>{' '}
        <div className="ss-vo">
          <div className="ss-vo-head">
            <span className="ss-vo-label">Spoken</span>{' '}
            <em>{hasVo ? `${s.narrationWords} words · ~${(s.narrationSec || 0).toFixed(1)}s` : 'Carries previous line'}</em>{' '}
            {s.editable?.speed !== false ? (
              <label className="ss-pace">
                <span>Pace</span>{' '}
                <select
                  data-voice-speed=""
                  data-nk={s.narrationKind}
                  data-nkey={s.narrationKey}
                  aria-label="Speaking pace"
                  defaultValue={String(speedOptions(s.narrationSpeed).find((o) => o.selected)?.value ?? '')}
                >
                  {speedOptions(s.narrationSpeed).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>{' '}
          <textarea
            rows={2}
            data-nk={s.narrationKind}
            data-nkey={s.narrationKey}
            placeholder={s.kind === 'step' ? 'Optional — leave empty to carry the previous line' : 'What the voiceover says on this beat…'}
            defaultValue={s.narration || ''}
          />
        </div>{' '}
        {issues.length ? (
          <ul className="ss-issues">
            {issues.map((x, i) => (
              <li key={i} className={`lvl-${x.level}`}>
                {x.message}
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </li>
  );
}
