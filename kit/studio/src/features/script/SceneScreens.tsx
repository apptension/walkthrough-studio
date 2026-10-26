import { Fragment } from 'react';

import { Icon } from '@/ui/icons';

import { rowPlaceholder } from './model';
import type { ScriptScene } from './types';

/**
 * The "On screen" half of a scene card — `screenOpen` / `screenClose` /
 * `screenPlate` / `screenCall` in `kit/studio/workflow.js`. Inputs are
 * uncontrolled: the sheet reads them back from the DOM on blur, as legacy did,
 * and every new script remounts them with fresh defaults.
 */

const X = () => <Icon name="x" size={14} />;

function ChapterOptions({ chapters, fallback }: { chapters: string[] | undefined; fallback: string[] }) {
  const list = chapters?.length ? chapters : fallback;
  if (!list.length) return <option value="">No chapters yet</option>;
  return (
    <>
      {list.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </>
  );
}

function titleText(s: ScriptScene): string {
  return (s.titleLines || []).join('\n') || s.title || '';
}

export function ScreenOpen({ s }: { s: ScriptScene }) {
  return (
    <>
      <label className="ss-field">
        <span>Eyebrow</span>
        <input type="text" data-struct-field="open.eyebrow" defaultValue={s.eyebrow || ''} placeholder="Product · Brand" />
      </label>{' '}
      <label className="ss-field">
        <span>
          Title <i>one line per row</i>
        </span>
        <textarea rows={2} data-struct-field="open.title" placeholder="See the team." defaultValue={titleText(s)} />
      </label>{' '}
      <label className="ss-field">
        <span>Sub</span>
        <input type="text" data-struct-field="open.sub" defaultValue={s.sub || s.onScreen || ''} placeholder="One supporting line" />
      </label>
    </>
  );
}

export function ScreenClose({ s }: { s: ScriptScene }) {
  const steps = s.steps || [];
  return (
    <>
      <label className="ss-field">
        <span>
          Title <i>one line per row</i>
        </span>
        <textarea rows={2} data-struct-field="close.title" placeholder="See the team." defaultValue={titleText(s)} />
      </label>{' '}
      <div className="ss-steps" data-close-steps="">
        <div className="ss-steps-head">
          <span>Close steps</span>
          <button type="button" className="ss-mini" data-struct-action="close-step-add">
            + Step
          </button>
        </div>{' '}
        {steps.length ? (
          steps.map((st, si) => (
            <div key={si} className="ss-step" data-step-index={si}>
              <input type="text" data-struct-field="close.step.label" data-step-index={si} defaultValue={st.label || ''} placeholder="Step label" />{' '}
              <input type="text" data-struct-field="close.step.note" data-step-index={si} defaultValue={st.note || ''} placeholder="Note (optional)" />{' '}
              <button type="button" className="ss-icon-btn" data-struct-action="close-step-remove" data-step-index={si} aria-label="Remove step">
                <X />
              </button>
            </div>
          ))
        ) : (
          <p className="ss-empty-steps">No steps yet — add the recap beats for the closing plate.</p>
        )}
      </div>
    </>
  );
}

const cellText = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

function PlateRow({ s, row, ri }: { s: ScriptScene; row: Record<string, unknown> | undefined; ri: number }) {
  const fields = s.plate?.fields || ['label', 'note'];
  const pid = s.plateId || '';
  return (
    <div className="ss-plate-row" data-row-index={ri}>
      {fields.map((f) => (
        <input
          key={f}
          type="text"
          data-struct-field={`plate.row.${f}`}
          data-plate-id={pid}
          data-row-index={ri}
          defaultValue={cellText(row?.[f])}
          placeholder={rowPlaceholder(s.plateType, f)}
        />
      ))}{' '}
      <button type="button" className="ss-icon-btn" data-struct-action="plate-row-remove" data-plate-id={pid} data-row-index={ri} aria-label="Remove row">
        <X />
      </button>
    </div>
  );
}

function PlateExtra({ s }: { s: ScriptScene }) {
  const pid = s.plateId || '';
  const p = s.plate || {};
  const callout =
    s.plateType === 'callout' ? (
      <label className="ss-field">
        <span>Body</span>{' '}
        <textarea rows={2} data-struct-field="plate.body" data-plate-id={pid} placeholder="The thesis line" defaultValue={p.body || ''} />
      </label>
    ) : null;
  if (p.listKey && p.fields?.length) {
    const rows = p.rows || [];
    const listLabel = p.listKey === 'bullets' ? 'Bullets' : p.listKey;
    return (
      <>
        {callout}
        <div className="ss-plate-list" data-plate-list={p.listKey}>
          <div className="ss-steps-head">
            <span>{listLabel}</span>{' '}
            <button type="button" className="ss-mini" data-struct-action="plate-row-add" data-plate-id={pid}>
              + {p.listKey === 'bullets' ? 'Bullet' : 'Row'}
            </button>
          </div>{' '}
          {rows.length ? (
            rows.map((row, ri) => <PlateRow key={ri} s={s} row={row} ri={ri} />)
          ) : (
            <p className="ss-empty-steps">No rows yet — add the content this plate shows.</p>
          )}
        </div>
      </>
    );
  }
  if (s.plateType === 'quote') {
    return (
      <>
        <label className="ss-field">
          <span>Quote</span>{' '}
          <textarea rows={2} data-struct-field="plate.quote" data-plate-id={pid} defaultValue={p.quote || ''} />
        </label>{' '}
        <div className="ss-plate-pair">
          <label className="ss-field">
            <span>Author</span>
            <input type="text" data-struct-field="plate.author" data-plate-id={pid} defaultValue={p.author || ''} />
          </label>{' '}
          <label className="ss-field">
            <span>Role</span>
            <input type="text" data-struct-field="plate.role" data-plate-id={pid} defaultValue={p.role || ''} />
          </label>
        </div>
      </>
    );
  }
  if (s.plateType === 'metric') {
    return (
      <>
        <div className="ss-plate-pair">
          <label className="ss-field">
            <span>Value</span>
            <input type="text" data-struct-field="plate.value" data-plate-id={pid} defaultValue={p.value || ''} placeholder="94%" />
          </label>{' '}
          <label className="ss-field">
            <span>Unit</span>
            <input type="text" data-struct-field="plate.unit" data-plate-id={pid} defaultValue={p.unit || ''} placeholder="of teams" />
          </label>
        </div>{' '}
        <label className="ss-field">
          <span>Note</span>
          <input type="text" data-struct-field="plate.note" data-plate-id={pid} defaultValue={p.note || ''} />
        </label>{' '}
        <label className="ss-field">
          <span>
            Progress <i>0–1 ring fill</i>
          </span>{' '}
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            data-struct-field="plate.progress"
            data-plate-id={pid}
            defaultValue={p.progress != null ? String(p.progress) : ''}
          />
        </label>
      </>
    );
  }
  if (s.plateType === 'compare') {
    return (
      <>
        <div className="ss-plate-pair">
          <label className="ss-field">
            <span>Before label</span>
            <input type="text" data-struct-field="plate.left.label" data-plate-id={pid} defaultValue={p.left?.label || 'Before'} />
          </label>{' '}
          <label className="ss-field">
            <span>After label</span>
            <input type="text" data-struct-field="plate.right.label" data-plate-id={pid} defaultValue={p.right?.label || 'After'} />
          </label>
        </div>{' '}
        <div className="ss-plate-pair">
          <label className="ss-field">
            <span>
              Before lines <i>one per row</i>
            </span>
            <textarea rows={3} data-struct-field="plate.left.items" data-plate-id={pid} defaultValue={(p.left?.items || []).join('\n')} />
          </label>{' '}
          <label className="ss-field">
            <span>
              After lines <i>one per row</i>
            </span>
            <textarea rows={3} data-struct-field="plate.right.items" data-plate-id={pid} defaultValue={(p.right?.items || []).join('\n')} />
          </label>
        </div>
      </>
    );
  }
  return callout;
}

export function ScreenPlate({ s, chapters }: { s: ScriptScene; chapters: string[] }) {
  const pid = s.plateId || '';
  const typeLabel = s.plate?.typeLabel || s.plateType || 'Plate';
  const list = s.chapters?.length ? s.chapters : chapters;
  return (
    <>
      <div className="ss-plate-head">
        <span className="ss-plate-bits">{typeLabel}</span>{' '}
        <button type="button" className="ss-mini danger" data-struct-action="plate-remove" data-plate-id={pid} data-title={s.plateTitle || s.title || ''}>
          Remove
        </button>
      </div>{' '}
      <label className="ss-field">
        <span>Eyebrow</span>{' '}
        <input type="text" data-struct-field="plate.eyebrow" data-plate-id={pid} defaultValue={s.eyebrow || ''} placeholder="Section label" />
      </label>{' '}
      <label className="ss-field">
        <span>Title</span>{' '}
        <input type="text" data-struct-field="plate.title" data-plate-id={pid} defaultValue={s.plateTitle || s.title || ''} placeholder="Plate headline" />
      </label>{' '}
      <label className="ss-field">
        <span>Sub</span>{' '}
        <input type="text" data-struct-field="plate.sub" data-plate-id={pid} defaultValue={s.sub || ''} placeholder="Supporting line (optional)" />
      </label>{' '}
      <PlateExtra s={s} />{' '}
      <label className="ss-field ss-place">
        <span>Appears before chapter</span>{' '}
        <select data-struct-field="plate.before" data-plate-id={pid} defaultValue={list.includes(s.before || '') ? s.before : undefined}>
          <ChapterOptions chapters={s.chapters} fallback={chapters} />
        </select>
      </label>
    </>
  );
}

export function ScreenCall({ s }: { s: ScriptScene }) {
  const editable = s.editable?.screen !== false && !s.dynamic;
  const canMove = Boolean(s.editable?.move) && s.flowIndex != null;
  const atStart = s.flowIndex === 0;
  const atEnd = s.flowCount != null && s.flowIndex === s.flowCount - 1;
  const src = s.flowLine ? (
    <span className="ss-src" title="Source in flow.mjs">
      flow.mjs:{s.flowLine}
    </span>
  ) : null;
  if (!editable) {
    return (
      <>
        <strong className="ss-title">{s.title || '—'}</strong>{' '}
        {s.onScreen ? <span className="ss-body">{s.onScreen}</span> : null}{' '}
        {s.dynamic ? <span className="ss-src">Dynamic title — edit in flow.mjs</span> : null}{' '}
        {src}
      </>
    );
  }
  const flow = s.flowIndex ?? undefined;
  return (
    <>
      <label className="ss-field">
        <span>{s.kind === 'chapter' ? 'Chapter title' : 'Caption title'}</span>{' '}
        <input type="text" data-struct-field="call.title" data-flow-index={flow} defaultValue={s.title || ''} placeholder="Short title" />
      </label>{' '}
      <label className="ss-field">
        <span>On screen</span>{' '}
        <textarea rows={2} data-struct-field="call.body" data-flow-index={flow} placeholder="What appears under the title" defaultValue={s.onScreen || ''} />
      </label>{' '}
      <div className="ss-call-tools">
        {src || <span />}{' '}
        <div className="ss-call-actions">
          {canMove ? (
            <Fragment>
              <button type="button" className="ss-mini" data-struct-action="call-move" data-delta="-1" data-flow-index={flow} disabled={atStart} title="Move earlier">
                ↑
              </button>{' '}
              <button type="button" className="ss-mini" data-struct-action="call-move" data-delta="1" data-flow-index={flow} disabled={atEnd} title="Move later">
                ↓
              </button>
            </Fragment>
          ) : null}{' '}
          <button
            type="button"
            className="ss-mini"
            data-struct-action="preview-card"
            data-kind={s.kind === 'chapter' ? 'chapter' : 'caption'}
            data-flow-index={flow}
            title="Open live card in Program"
          >
            Preview
          </button>{' '}
          {s.kind === 'chapter' ? (
            <button type="button" className="ss-mini" data-struct-action="add-caption-after" data-flow-index={flow}>
              + Caption
            </button>
          ) : null}{' '}
          <button type="button" className="ss-mini danger" data-struct-action="call-remove" data-flow-index={flow} data-title={s.title || ''}>
            Remove
          </button>
        </div>
      </div>
    </>
  );
}
