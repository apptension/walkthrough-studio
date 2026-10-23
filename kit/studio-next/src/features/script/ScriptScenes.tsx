import { Fragment, useMemo, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent, type SyntheticEvent } from 'react';

import { Icon } from '@/ui/icons';

import { sceneListItems, sceneVisibility, type SectionId } from './model';
import { SceneRow } from './SceneRow';
import { focusSpecOf, onStructAction, saveLine, saveSpeed, saveStructField, toggleSection, useScriptSheet } from './sheet';
import { useScriptDrag } from './useScriptDrag';

function SectionHeader({ id, label, hint, count, collapsed, hidden }: { id: SectionId; label: string; hint: string; count: number; collapsed: boolean; hidden: boolean }) {
  return (
    <li className={`script-section${collapsed ? ' is-collapsed' : ''}`} id={`script-sec-${id}`} data-section={id} hidden={hidden}>
      <button type="button" className="script-section-toggle" data-section-toggle={id} aria-expanded={collapsed ? 'false' : 'true'}>
        <span className="script-section-mark" aria-hidden="true" />{' '}
        <span className="script-section-copy">
          <span>{label}</span> {hint ? <em>{hint}</em> : null}
        </span>{' '}
        {count ? (
          <b className="script-section-count">{count}</b>
        ) : (
          <span className="script-section-count is-empty" aria-hidden="true" />
        )}{' '}
        <span className="script-section-chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </button>
    </li>
  );
}

function ComposerBar({ hidden }: { hidden: boolean }) {
  return (
    <li className="script-composer" aria-label="Add to scenario" hidden={hidden}>
      <div className="script-composer-inner">
        <div className="script-composer-copy">
          <strong>Continue the story</strong> <span>Add the next beat in delivery order</span>
        </div>{' '}
        <div className="script-composer-actions">
          <button type="button" className="ss-compose" data-struct-action="add-chapter">
            <i>+</i>
            <span>Chapter</span>
          </button>{' '}
          <button type="button" className="ss-compose" data-struct-action="add-caption">
            <i>+</i>
            <span>Caption</span>
          </button>{' '}
          <button type="button" className="ss-compose accent" data-struct-action="add-plate">
            <i>+</i>
            <span>Plate</span>
          </button>
        </div>
      </div>
    </li>
  );
}

function Waiting() {
  return (
    <li className="script-waiting">
      <span className="activity-spinner" />{' '}
      <div>
        <strong>Building your first script</strong>{' '}
        <span>The agent is writing the config, flow and narration from the brief. This sheet fills in when it finishes.</span>
      </div>
    </li>
  );
}

function SceneList() {
  const script = useScriptSheet((s) => s.script);
  const rev = useScriptSheet((s) => s.rev);
  const collapsed = useScriptSheet((s) => s.collapsed);
  const onlyIssues = useScriptSheet((s) => s.onlyIssues);
  const items = useMemo(() => (script ? sceneListItems(script.scenes) : []), [script]);
  if (!script) return null;
  const vis = sceneVisibility(items, collapsed, onlyIssues, script.scaffold);
  return (
    <>
      {items.map((item) =>
        item.type === 'section' ? (
          <SectionHeader
            key={`${rev}:sec:${item.id}`}
            id={item.id}
            label={item.label}
            hint={item.hint}
            count={item.count}
            collapsed={Boolean(collapsed[item.id])}
            hidden={Boolean(vis.sectionHidden.get(item.id))}
          />
        ) : (
          <SceneRow
            key={`${rev}:${item.scene.key}`}
            s={item.scene}
            index={item.index}
            scaffold={script.scaffold}
            chapters={script.chapters || []}
            hidden={Boolean(vis.sceneHidden.get(item.scene.key))}
            sectionCollapsed={Boolean(vis.sceneCollapsed.get(item.scene.key))}
          />
        ),
      )}
      <ComposerBar key={`${rev}:composer`} hidden={vis.composerHidden} />
      {vis.empty ? (
        <li className="scenes-empty">
          <strong>No issues</strong>
          <span>Every beat passes the script checks.</span>
        </li>
      ) : null}
    </>
  );
}

type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const isField = (t: EventTarget | null): t is FieldEl =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

function onBlur(e: FocusEvent<HTMLOListElement>) {
  const t = e.target;
  if (t instanceof HTMLTextAreaElement && t.matches('textarea[data-nk]')) void saveLine(t);
  else if (isField(t) && t.matches('[data-struct-field]') && t.tagName !== 'SELECT') {
    void saveStructField(t, { restore: focusSpecOf(e.relatedTarget instanceof Element ? e.relatedTarget : null) });
  }
}

function onChange(e: SyntheticEvent<HTMLOListElement>) {
  const t = e.target;
  if (!(t instanceof HTMLSelectElement)) return;
  if (t.matches('select[data-struct-field]')) void saveStructField(t);
  else if (t.matches('select[data-voice-speed]')) void saveSpeed(t);
}

function onClick(e: MouseEvent<HTMLOListElement>) {
  const target = e.target as Element;
  const toggle = target.closest<HTMLElement>('[data-section-toggle]');
  if (toggle) {
    toggleSection(toggle.dataset.sectionToggle || '');
    return;
  }
  const btn = target.closest<HTMLButtonElement>('[data-struct-action]');
  if (btn && !btn.disabled) void onStructAction(btn);
}

function onKeyDown(e: KeyboardEvent<HTMLOListElement>) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.matches('textarea[data-nk]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) t.blur();
  // Single-line struct inputs: Enter saves (blur). Avoid dialog default-button quirks.
  if (t.matches('input[data-struct-field]') && e.key === 'Enter') {
    e.preventDefault();
    t.blur();
  }
  if (t.matches('textarea[data-struct-field]') && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) t.blur();
}

/** `#scriptScenes` — sections, beats and the composer, with the delegated edit handlers. */
export function ScriptScenes() {
  const ref = useRef<HTMLOListElement>(null);
  const load = useScriptSheet((s) => s.load);
  const waiting = useScriptSheet((s) => Boolean(s.draftJob) && Boolean(s.script?.scaffold));
  useScriptDrag(ref);
  return (
    <ol id="scriptScenes" className="script-scenes" ref={ref} onBlur={onBlur} onChange={onChange} onClick={onClick} onKeyDown={onKeyDown}>
      {load?.kind === 'loading' ? (
        <li className="meta">Loading script…</li>
      ) : load?.kind === 'error' ? (
        <li className="lvl-error">{load.message}</li>
      ) : waiting ? (
        <Waiting />
      ) : (
        <Fragment>
          <SceneList />
        </Fragment>
      )}
    </ol>
  );
}
