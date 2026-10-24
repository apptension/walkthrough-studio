import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';

import { Icon } from '@/ui/icons';

import { BrandCreator } from './BrandCreator';
import { useBrandStudio } from './brandStudio';
import { CREATE_ORDER, STAGE_DEFAULTS, useCreation, type CreateStage } from './creation';
import { agentPulse, creationFeed, useCreationFeed } from './creationFeed';
import { ActivityFeed, BrandReveal, Lockup, ScoutView, Storyboard, StoryStats, StoryView, ThoughtCaption } from './CreationStage';
import { useFontStylesheet } from './fontSheet';
import { useWizard } from './wizard';
import { WizardGuide } from './WizardGuide';
import { WizardStream } from './WizardStream';

const SCENE_TITLE: Record<CreateStage, string> = {
  project: 'Setting up the project',
  brand: 'Brand foundation',
  analyze: 'Scouting the product',
  draft: 'Writing the first script',
  ready: 'Ready for review',
};

function useCurrentStage(): CreateStage {
  return useCreation((s) => CREATE_ORDER.find((id) => s.stages[id].active || s.stages[id].failed) ?? (s.viewReady ? 'ready' : 'project'));
}

/** Polls the explore map and the half-written script while those stages run. */
function useFeedPolling(stage: CreateStage, hidden: boolean, failed: boolean): void {
  useEffect(() => {
    if (hidden || failed || (stage !== 'analyze' && stage !== 'draft')) return;
    const tick = () => {
      void creationFeed.pollExplore();
      if (stage === 'draft') void creationFeed.pollScript();
    };
    tick();
    const timer = setInterval(tick, stage === 'draft' ? 3500 : 2000);
    return () => clearInterval(timer);
  }, [stage, hidden, failed]);
}

function RailStep({ id, index }: { id: CreateStage; index: number }) {
  const row = useCreation((s) => s.stages[id]);
  const cls = [row.done && 'done', row.active && 'active', row.failed && 'failed'].filter(Boolean).join(' ');
  return (
    <li data-create-stage={id} className={cls || undefined} aria-current={row.active ? 'step' : undefined}>
      <span className="ct-rail-dot" aria-hidden="true">
        {row.done ? <Icon name="ui-check" size={11} /> : row.failed ? <Icon name="ui-x" size={11} /> : row.active ? <span className="activity-spinner" /> : index + 1}
      </span>
      <div>
        <strong>{row.title}</strong>
        <em data-stage-note="">{row.note}</em>
      </div>
      <time data-stage-time="">{row.time}</time>
    </li>
  );
}

function StageRail() {
  const bar = useCreation((s) => s.bar);
  return (
    <div className="ct-rail-wrap">
      <ol className="ct-rail creation-stages-rail" aria-label="Preparation stages">
        {CREATE_ORDER.map((id, i) => (
          <RailStep key={id} id={id} index={i} />
        ))}
      </ol>
      <div className="creation-bar ct-bar" aria-hidden="true">
        <i id="wizardCreationBar" style={bar ? { width: bar } : undefined} />
      </div>
    </div>
  );
}

function IdentityCard() {
  const identity = useCreation((s) => s.identity);
  const swatches = useCreation((s) => s.swatches);
  const font = useCreation((s) => s.font);
  const hidden = useCreation((s) => s.brandCardHidden) && !identity;
  return (
    <section id="wizardBrandCard" className="ct-panel ct-identity" aria-label="Brand" hidden={hidden}>
      <div className="ct-identity-art" id="wizardBrandPreview">
        <Lockup identity={identity} />
      </div>
      <div className="ct-identity-meta">
        <div id="wizardBrandSwatches" className="ct-swatches" hidden={!swatches.length}>
          {swatches.map((c, i) => (
            <i key={c} style={{ background: c, '--i': i } as CSSProperties} title={c} />
          ))}
        </div>
        <span id="wizardBrandFont" className="ct-font" hidden={font.hidden} style={identity?.font ? { fontFamily: `'${identity.font}', system-ui` } : undefined}>
          {font.text}
        </span>
      </div>
    </section>
  );
}

function Artifacts() {
  const artifacts = useCreation((s) => s.artifacts);
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (list && artifacts.length) list.scrollTop = list.scrollHeight;
  }, [artifacts]);
  return (
    <section className="ct-panel ct-files" aria-label="Created so far">
      <header className="ct-panel-head">
        <h5>Created so far</h5>
        <span className="ct-count">{artifacts.length || ''}</span>
      </header>
      <ul ref={ref} id="wizardArtifacts" className="creation-artifacts ct-artifacts">
        {artifacts.length ? (
          artifacts.map((a) => (
            <li key={`${a.kind}:${a.name}`} className={a.fresh ? 'is-fresh' : ''} title={a.note ? `${a.name} — ${a.note}` : a.name}>
              <span className={`ca-ico ca-${a.kind}`} aria-hidden="true" />
              <span className="ca-name">{a.name.split('/').pop()}</span>
              <em>{a.note || ''}</em>
            </li>
          ))
        ) : (
          <li className="is-empty">Files appear here as they are written.</li>
        )}
      </ul>
    </section>
  );
}

function FirstScript() {
  const script = useCreation((s) => s.script);
  const story = useCreationFeed((s) => s.story);
  return (
    <section id="wizardScript" className="creation-script ct-script" aria-labelledby="wizardScriptTitle" hidden={!script}>
      <header className="ct-script-head">
        <span className="ct-script-badge" aria-hidden="true">
          <Icon name="ui-check" size={16} />
        </span>
        <div>
          <h4 id="wizardScriptTitle">Your first script</h4>
          <p id="wizardScriptMeta" className="creation-script-meta">
            {script?.meta}
          </p>
        </div>
        {story.length ? <StoryStats /> : null}
      </header>
      <p className="creation-script-next">
        Approve it and Studio records the app, cuts in the plates, adds voice and music, and opens the result in the player. Nothing is recorded until you approve.
      </p>
      {story.length ? (
        <Storyboard live={false} id="wizardScriptScenes" />
      ) : (
        <ol id="wizardScriptScenes" className="creation-script-scenes">
          {script?.scenes.map((s, i) => (
            <li key={i} className={`is-${s.kind}`}>
              <b>{s.mark}</b>
              <div>
                <strong>{s.title}</strong>
                {s.line ? <em>{s.line}</em> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p id="wizardScriptLint" className={`creation-script-lint${script?.lint.error ? ' is-error' : ''}`} hidden={script?.lint.hidden ?? true}>
        {script?.lint.text}
      </p>
    </section>
  );
}

function Hero({ stage, discovering, guided, thought, live }: { stage: CreateStage; discovering: boolean; guided: boolean; thought: string; live: boolean }) {
  const subject = useCreation((s) => s.subject);
  const scene =
    stage === 'brand' && discovering ? 'creator' : stage === 'analyze' ? (guided ? 'guided' : 'scout') : stage === 'draft' ? 'story' : 'brand';
  return (
    <div className={`ct-hero is-${scene}`} data-ct-scene={scene}>
      <header className="ct-hero-head">
        <h4>{SCENE_TITLE[stage]}</h4>
        {live ? (
          <span className="ct-live" aria-hidden="true">
            <i />
            live
          </span>
        ) : null}
      </header>
      <div className="ct-hero-body" key={scene}>
        {scene === 'creator' ? (
          <BrandCreator />
        ) : scene === 'scout' ? (
          <ScoutView thought={thought} live={live} />
        ) : scene === 'guided' ? (
          <ScoutView thought={thought} live={live} preview />
        ) : scene === 'story' ? (
          <StoryView />
        ) : (
          <BrandReveal title={subject} />
        )}
      </div>
      {scene !== 'creator' ? <ThoughtCaption thought={live ? thought : ''} /> : null}
    </div>
  );
}

/** `#wizardCreation` — replaces the form while a project is prepared. */
export function CreationView() {
  const hidden = useCreation((s) => s.hidden);
  const ready = useCreation((s) => s.viewReady);
  const title = useCreation((s) => s.title);
  const detail = useCreation((s) => s.detail);
  const elapsed = useCreation((s) => s.elapsed);
  const eta = useCreation((s) => s.eta);
  const failed = useCreation((s) => CREATE_ORDER.some((id) => s.stages[id].failed));
  const guided = useCreation((s) => s.stages.analyze.title !== STAGE_DEFAULTS.analyze.title);
  const identity = useCreation((s) => s.identity);
  const stage = useCurrentStage();
  const discovering = useBrandStudio((s) => Boolean(s.slug) && s.phase === 'discovering');
  const creatorKept = useBrandStudio((s) => Boolean(s.slug) && s.phase !== 'discovering');
  const streamJob = useWizard((s) => s.streamJob);
  const pulse = useMemo(() => agentPulse(streamJob?.stream?.entries), [streamJob]);
  const live = !failed && !ready && streamJob?.status === 'running';
  useFeedPolling(stage, hidden, failed);
  useFontStylesheet(identity?.fontCss);

  const c = identity?.colors || {};
  const tint = identity
    ? ({ '--ct-ink': c.ink, '--ct-surface': c.surface, '--ct-accent': c.gold, '--ct-accent-2': c.amber || c.teal || c.gold, '--ct-text': c.text, '--ct-font': identity.font ? `'${identity.font}', system-ui` : undefined } as CSSProperties)
    : undefined;

  return (
    <section
      id="wizardCreation"
      className={`creation-view ct${ready ? ' is-ready' : ''}${failed ? ' is-failed' : ''}${identity ? ' is-branded' : ''}`}
      data-ct-stage={stage}
      aria-live="polite"
      aria-labelledby="wizardCreationTitle"
      hidden={hidden}
      style={tint}
    >
      <header className="creation-head ct-head">
        <span className={`ct-orb${ready ? ' is-done' : ''}`} aria-hidden="true">
          <span className="activity-spinner" />
        </span>
        <div className="creation-titles">
          <strong id="wizardCreationTitle">{title}</strong>{' '}
          <span id="wizardCreationDetail">{detail}</span>
        </div>
        <div className="creation-clock" aria-label="Elapsed time">
          <b id="wizardCreationElapsed">{elapsed}</b> <em id="wizardCreationEta">{eta}</em>
        </div>
      </header>
      <StageRail />
      {creatorKept ? <BrandCreator /> : null}
      {ready ? null : (
        <div className="ct-main">
          <Hero stage={stage} discovering={discovering} guided={guided} thought={pulse.thought} live={live} />
          <aside className="ct-side" aria-label="Live progress">
            <IdentityCard />
            <ActivityFeed actions={pulse.actions} live={live} />
            <Artifacts />
          </aside>
        </div>
      )}
      <FirstScript />
      <WizardGuide />
      <details className="ct-log">
        <summary>
          <Icon name="ui-activity" size={12} />
          Full agent log
        </summary>
        <WizardStream id="wizardStream" job={streamJob} label="Live output" />
      </details>
    </section>
  );
}
