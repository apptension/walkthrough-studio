import { useMemo, type MouseEvent } from 'react';

import type { Critic, CriticFinding, Job } from '@/api/types';
import { useDesk } from '@/desk/store';
import { StreamHost } from '@/features/feedback/StreamHost';
import { useBusy } from '@/features/tools-panel/busy';
import { cn } from '@/lib/cn';
import { PanelSection } from '@/ui/PanelSection';
import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';
import { Zen } from '@/ui/Zen';

import { applyCriticFixes, cancelCriticReview, fixFindingWithAi, runCriticFromStudio } from './critic';

const REVIEW_HELP =
  'Run critic does an instant rule pass, then a critic agent watches the cut — brief, narration, flow, timeline and frame stills — as a skeptic, implementer, buyer and onboarder, and writes a scored review of what to improve. Each finding has a Fix button that hands it to the agent as a director note. The report is frozen until you run it again.';

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortFindings(findings: CriticFinding[]): CriticFinding[] {
  return [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? NaN) - (SEVERITY_ORDER[b.severity] ?? NaN));
}

function badgeView(critic: Critic | null): { text: string; className: string; title: string | undefined } {
  if (!critic) return { text: '—', className: 'badge', title: undefined };
  const n = critic.findings.length;
  return {
    text: critic.stale ? 'stale' : n ? `${critic.high ? `${critic.high} high · ` : ''}${n}` : 'clean',
    className: `badge ${critic.stale ? 'warn' : critic.high ? 'fail' : n ? 'warn' : 'ok'}`,
    title: critic.stale
      ? 'Config or narration changed since this report — run again.'
      : `Reviewed ${new Date(critic.generatedAt ?? '').toLocaleString()}`,
  };
}

function reviewedLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function severityCounts(critic: Critic) {
  const high = critic.high ?? critic.findings.filter((f) => f.severity === 'high').length;
  const medium = critic.medium ?? critic.findings.filter((f) => f.severity === 'medium').length;
  const low = critic.low ?? critic.findings.filter((f) => f.severity === 'low').length;
  return { high, medium, low };
}

function CriticSummary({ critic }: { critic: Critic }) {
  const when = reviewedLabel(critic.generatedAt);
  const { high, medium, low } = severityCounts(critic);
  const n = critic.findings.length;
  return (
    <div className="critic-summary" aria-label="Review summary">
      <div className="critic-summary-main">
        <strong>{n ? `${n} finding${n === 1 ? '' : 's'}` : 'Clean pass'}</strong>
        <span className="critic-summary-meta">
          {critic.purpose ? <em>{critic.purpose}</em> : null}
          {critic.purpose && when ? <span aria-hidden="true">·</span> : null}
          {when ? <span title={new Date(critic.generatedAt ?? '').toLocaleString()}>{when}</span> : null}
        </span>
      </div>
      {n ? (
        <div className="critic-summary-counts" aria-label="By severity">
          {high ? <span className="critic-count high">{high} high</span> : null}
          {medium ? <span className="critic-count medium">{medium} med</span> : null}
          {low ? <span className="critic-count low">{low} low</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function CriticAgentSummary({ critic }: { critic: Critic }) {
  const review = critic.agent;
  if (!review?.summary) return null;
  const score = review.score;
  const tone = score == null ? '' : score >= 80 ? 'good' : score >= 60 ? 'ok' : 'weak';
  return (
    <section className="critic-agent" aria-label="Critic agent review">
      <div className="critic-agent-head">
        <span className="critic-agent-kicker">
          <Icon name="sparkle" size={12} />
          Agent review
        </span>
        {score != null ? (
          <span className={cn('critic-score', tone)} title="How well the cut lands for a first-time viewer">
            {score}
            <small>/100</small>
          </span>
        ) : null}
      </div>
      <p className="critic-agent-summary">{review.summary}</p>
      {review.strengths.length ? (
        <ul className="critic-strengths" aria-label="What works">
          {review.strengths.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CriticAgentRunning({ job }: { job: Job }) {
  return (
    <section className="critic-running" role="status" aria-live="polite">
      <div className="critic-running-head">
        <span className="critic-running-dot" aria-hidden="true" />
        <div>
          <strong>Critic agent is watching the cut</strong>
          <span>{job.activity || 'Reading the sources, timeline and frames…'}</span>
        </div>
        <button type="button" className="btn ghost critic-running-stop" onClick={() => void cancelCriticReview()}>
          Stop
        </button>
      </div>
      <StreamHost
        id="criticStream"
        className="agent-stream agent-stream--rail critic-stream is-empty"
        label="Critic agent output"
        variant="rail"
        job={job}
      />
    </section>
  );
}

function CriticStale({ critic }: { critic: Critic | null }) {
  if (!critic?.stale) return null;
  return (
    <div className="critic-stale" role="status">
      <Icon name="warn" size={14} />
      <div>
        <strong>Report is stale</strong>
        <span>Config or narration changed since this pass — run the critic again before fixing.</span>
      </div>
    </div>
  );
}

function formatAt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function CriticFindingCard({ finding, index }: { finding: CriticFinding; index: number }) {
  const frame =
    finding.frame?.path || finding.frame?.at != null
      ? `Sampled ${finding.frame.path || 'frame'}${finding.frame.at != null ? ` at ${Number(finding.frame.at).toFixed(1)}s` : ''}`
      : null;
  return (
    <article className={cn('critic-item', finding.severity)}>
      <div className="critic-item-head">
        <span className="tag">{finding.severity}</span>
        <span className="critic-target" title={finding.target}>
          {finding.target}
        </span>
        {finding.persona ? <span className="critic-persona">{finding.persona}</span> : null}
        {finding.source === 'rules' ? (
          <span className="critic-source" title="From the automatic rule pass">
            rule
          </span>
        ) : null}
        <NeonButton
          className="btn primary critic-fix"
          data-critic-fix={index}
          title="Send this finding to the agent as a director note"
          onClick={() => fixFindingWithAi(finding)}
        >
          Fix with AI
        </NeonButton>
      </div>
      {finding.issue ? <p className="critic-issue">{finding.issue}</p> : null}
      {finding.suggestion ? <p className="critic-suggest">{finding.suggestion}</p> : null}
      {finding.evidence ? (
        <p className="critic-evidence">
          {finding.at != null ? <span className="critic-at">{formatAt(finding.at)}</span> : null}
          {finding.evidence}
        </p>
      ) : null}
      {frame ? <p className="critic-frame">{frame}</p> : null}
    </article>
  );
}

function CriticFindings({ critic }: { critic: Critic | null }) {
  const findings = useMemo(() => (critic ? sortFindings(critic.findings) : []), [critic]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const fix = (e.target as Element).closest<HTMLElement>('[data-critic-fix]');
    if (!fix) return;
    // Cards handle clicks directly; keep delegation for markup parity / tests that click the node.
    const f = findings[Number(fix.dataset.criticFix)];
    if (f && !(e.target as HTMLElement).closest('button')) fixFindingWithAi(f);
  };

  if (critic == null) {
    return (
      <div id="criticFindings" className="findings critic-findings is-empty" onClick={onClick}>
        <Zen
          art="loupe"
          title="Nothing reviewed yet 🔍"
          sub="A persona critic reads narration and plates against the story spine — then you fix findings one by one."
        />
      </div>
    );
  }

  if (!findings.length) {
    return (
      <div id="criticFindings" className="findings critic-findings is-clean" onClick={onClick}>
        <p className="empty-inline">{`Clean — narration and plates follow the ${critic.purpose || 'story'} spine.`}</p>
      </div>
    );
  }

  return (
    <div id="criticFindings" className="findings critic-findings" onClick={onClick}>
      {findings.map((f, i) => (
        <CriticFindingCard key={`${f.target}:${f.issue}:${i}`} finding={f} index={i} />
      ))}
    </div>
  );
}

function CriticActions({ critic, url }: { critic: Critic | null; url: string | null }) {
  const running = useBusy('btnCriticRun');
  const applying = useBusy('btnCriticApply');
  const applyHidden = !critic || !critic.findings.some((f) => f.severity === 'high' && /^narration:/.test(f.target ?? ''));
  const empty = critic == null;
  const stale = Boolean(critic?.stale);
  return (
    <div className={cn('critic-actions', empty && 'is-hero')}>
      <NeonButton
        id="btnCriticRun"
        className={cn('btn', (empty || stale) && 'primary', 'critic-run', running && 'busy')}
        disabled={running}
        title="Rule pass, then a critic agent watches the cut and writes a review of what to improve"
        onClick={() => void runCriticFromStudio({ force: true })}
      >
        <Icon name="loupe" size={14} />
        {running ? 'Reviewing…' : stale ? 'Run critic again' : 'Run critic'}
      </NeonButton>
      <div className="critic-actions-secondary">
        <button
          type="button"
          id="btnCriticApply"
          className={cn('btn', applying && 'busy')}
          disabled={applying}
          hidden={applyHidden}
          title="Apply the high-confidence narration rewrites from the report"
          onClick={() => void applyCriticFixes()}
        >
          Apply safe fixes
        </button>
        <a id="criticReportLink" className="btn linkbtn" hidden={!url} href={url ?? '#'} target="_blank" rel="noopener">
          Full report
        </a>
      </div>
    </div>
  );
}

/** Review → Story review: the persona critic's findings with one-click Fix. */
export function StoryReview() {
  const critic = useDesk((s) => s.video?.critic ?? null);
  const url = useDesk((s) => s.video?.criticUrl ?? null);
  const criticJob = useDesk((s) => s.criticJob);
  const badge = criticJob ? { text: 'reviewing', className: 'badge run', title: 'The critic agent is watching the cut' } : badgeView(critic);
  return (
    <PanelSection
      id="story-review"
      icon="loupe"
      title="Story review"
      help={REVIEW_HELP}
      className="story-review-sec"
      badge={
        <span id="criticBadge" className={badge.className} title={badge.title}>
          {badge.text}
        </span>
      }
    >
      <div className="critic-shell">
        {critic ? <CriticSummary critic={critic} /> : null}
        {criticJob ? <CriticAgentRunning job={criticJob} /> : critic ? <CriticAgentSummary critic={critic} /> : null}
        <CriticStale critic={criticJob ? null : critic} />
        {critic == null && !criticJob ? <CriticActions critic={critic} url={url} /> : null}
        <CriticFindings critic={critic} />
        {critic != null ? <CriticActions critic={critic} url={url} /> : null}
      </div>
    </PanelSection>
  );
}
