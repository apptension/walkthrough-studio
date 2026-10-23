import { useEffect, useRef } from 'react';

import type { Qc, QcFinding } from '@/api/types';
import { useDesk } from '@/desk/store';
import { cn } from '@/lib/cn';
import { listedQcFindings, qcFindingKey } from '@/logic/qcFindings';
import { Icon } from '@/ui/icons';
import { PanelSection } from '@/ui/PanelSection';
import { Zen } from '@/ui/Zen';

import { applyQcWithAi, setAllQcKeys, toggleQcKey } from './qc';

const QC_HELP =
  'Automatic quality checks from the last render: narration pace, timing drift, missing captions, frozen frames. Pick findings and apply them with AI, or send all.';

function QcSummary({ qc, listed }: { qc: Qc; listed: QcFinding[] }) {
  const fail = qc.summary?.fail ?? listed.filter((f) => f.severity === 'fail').length;
  const warn = qc.summary?.warn ?? listed.filter((f) => f.severity === 'warn').length;
  const info = qc.summary?.info ?? listed.filter((f) => f.severity === 'info').length;
  const n = listed.length;
  return (
    <div className="qc-summary" aria-label="Quality summary">
      <div className="qc-summary-main">
        <strong>{n ? `${n} finding${n === 1 ? '' : 's'}` : 'All clear'}</strong>
        <span className="qc-summary-meta">From the last render · apply with AI</span>
      </div>
      {n ? (
        <div className="qc-summary-counts" aria-label="By severity">
          {fail ? <span className="qc-count fail">{fail} fail</span> : null}
          {warn ? <span className="qc-count warn">{warn} warn</span> : null}
          {info ? <span className="qc-count info">{info} info</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function QcToolbar({ selected, total }: { selected: number; total: number }) {
  return (
    <div className="qc-toolbar">
      <label className="qc-select-all">
        <input
          type="checkbox"
          checked={selected === total && total > 0}
          ref={(el) => {
            if (el) el.indeterminate = selected > 0 && selected < total;
          }}
          onChange={(e) => setAllQcKeys(e.currentTarget.checked)}
        />
        <span className={cn('qc-select-label', selected > 0 && 'is-on')}>
          {selected ? `${selected} selected` : 'Select findings'}
        </span>
      </label>
      <div className="qc-actions">
        <button
          type="button"
          id="btnQcApplySelected"
          className={cn('btn primary qc-apply', !selected && 'is-idle')}
          disabled={!selected}
          onClick={() => applyQcWithAi('selected')}
        >
          <Icon name="check" size={13} />
          Apply selected
        </button>
        <button type="button" id="btnQcApplyAll" className="btn qc-apply-all" onClick={() => applyQcWithAi('all')}>
          Apply all
        </button>
      </div>
    </div>
  );
}

function QcFindingCard({ finding, index, on }: { finding: QcFinding; index: number; on: boolean }) {
  const key = qcFindingKey(finding, index);
  return (
    <label className={cn('qc-item', 'qc-pick', finding.severity, on && 'is-on')}>
      <input type="checkbox" checked={on} onChange={() => toggleQcKey(key)} />
      <span className="qc-item-body">
        <span className="qc-item-head">
          <span className="tag">{finding.severity}</span>
          {finding.code ? <span className="qc-code">{finding.code}</span> : null}
        </span>
        <span className="qc-msg">{finding.message}</span>
      </span>
    </label>
  );
}

/** `renderQc(qc)`: selectable quality findings with Apply selected / Apply all. */
export function QualityChecks() {
  const qc = useDesk((s) => s.video?.qc ?? null);
  const keys = useDesk((s) => s.qcKeys);
  const focus = useDesk((s) => s.qcFocus);
  const sectionRef = useRef<HTMLDetailsElement>(null);
  const findings = listedQcFindings(qc?.findings);
  const selected = findings.filter((f, i) => keys.includes(qcFindingKey(f, i))).length;
  const hasList = Boolean(qc && findings.length);

  useEffect(() => {
    if (!focus) return;
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focus]);

  return (
    <PanelSection
      ref={sectionRef}
      id="qc"
      htmlId="qcSection"
      icon="check"
      title="Quality checks"
      help={QC_HELP}
      className="qc-section"
      preferOpen={Boolean(focus)}
      data-qc-focus={focus || undefined}
      badge={
        <span id="qcBadge" className={qc ? `badge ${qc.status}` : 'badge'}>
          {qc ? qc.status : '—'}
        </span>
      }
    >
      <div className="qc-shell">
        {hasList ? <QcSummary qc={qc!} listed={findings} /> : null}
        {hasList ? <QcToolbar selected={selected} total={findings.length} /> : null}
        <div
          id="qcBox"
          className={cn(
            'qc-findings',
            hasList && 'qc-list',
            !qc && 'is-empty',
            qc && !findings.length && 'is-clean',
          )}
        >
          {!qc ? (
            <Zen art="checklist" title="No checks yet ✅" sub="Render or Export once and the quality report lands here." />
          ) : findings.length ? (
            findings.map((f, i) => (
              <QcFindingCard key={qcFindingKey(f, i)} finding={f} index={i} on={keys.includes(qcFindingKey(f, i))} />
            ))
          ) : (
            <Zen art="checklist" title="All clear 🎉" sub="Nothing to flag in the last render." mini />
          )}
        </div>
      </div>
    </PanelSection>
  );
}
