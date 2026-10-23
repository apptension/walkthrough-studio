import { useLayoutEffect, useRef } from 'react';

import { CREATE_ORDER, useCreation, type CreateStage } from './creation';
import { useWizard } from './wizard';
import { WizardGuide } from './WizardGuide';
import { WizardStream } from './WizardStream';

function StageRowItem({ id }: { id: CreateStage }) {
  const row = useCreation((s) => s.stages[id]);
  const cls = [row.done && 'done', row.active && 'active', row.failed && 'failed'].filter(Boolean).join(' ');
  return (
    <li data-create-stage={id} className={cls || undefined}>
      <span className="cs-dot" />
      <div>
        <strong>
          {row.title}
        </strong>
        <em data-stage-note="">
          {row.note}
        </em>
      </div>
      <time data-stage-time="">{row.time}</time>
    </li>
  );
}

function BrandCard() {
  const hidden = useCreation((s) => s.brandCardHidden);
  const preview = useCreation((s) => s.preview);
  const swatches = useCreation((s) => s.swatches);
  const font = useCreation((s) => s.font);
  return (
    <div id="wizardBrandCard" className="creation-brand-card" hidden={hidden}>
      <iframe id="wizardBrandPreview" title="Captured brand logo" sandbox="" hidden={preview.hidden} src={preview.src || undefined} />
      <div id="wizardBrandSwatches" className="brand-swatches" hidden={!swatches.length}>
        {swatches.map((c) => (
          <i key={c} style={{ background: c }} title={c} />
        ))}
      </div>
      <span id="wizardBrandFont" className="creation-font" hidden={font.hidden}>
        {font.text}
      </span>
    </div>
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
    <ul ref={ref} id="wizardArtifacts" className="creation-artifacts">
      {artifacts.length ? (
        artifacts.map((a) => (
          <li key={`${a.kind}:${a.name}`} className={a.fresh ? 'is-fresh' : ''}>
            <span className={`ca-ico ca-${a.kind}`} aria-hidden="true" />
            <span className="ca-name">{a.name}</span>
            <em>{a.note || ''}</em>
          </li>
        ))
      ) : (
        <li className="is-empty">
          Files appear here as they are written.
        </li>
      )}
    </ul>
  );
}

function FirstScript() {
  const script = useCreation((s) => s.script);
  return (
    <section id="wizardScript" className="creation-script" aria-labelledby="wizardScriptTitle" hidden={!script}>
      <header className="creation-script-head">
        <div>
          <h4 id="wizardScriptTitle">
            Your first script
          </h4>
          <p id="wizardScriptMeta" className="creation-script-meta">
            {script?.meta}
          </p>
        </div>
        <p className="creation-script-next">
          Approve it and Studio records the app, cuts in the plates, adds voice and music, and opens the result in the player. Nothing is recorded until you approve.
        </p>
      </header>
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
      <p id="wizardScriptLint" className={`creation-script-lint${script?.lint.error ? ' is-error' : ''}`} hidden={script?.lint.hidden ?? true}>
        {script?.lint.text}
      </p>
    </section>
  );
}

/** `#wizardCreation` — replaces the form while a project is prepared (`creation.js`). */
export function CreationView() {
  const hidden = useCreation((s) => s.hidden);
  const ready = useCreation((s) => s.viewReady);
  const title = useCreation((s) => s.title);
  const detail = useCreation((s) => s.detail);
  const elapsed = useCreation((s) => s.elapsed);
  const eta = useCreation((s) => s.eta);
  const bar = useCreation((s) => s.bar);
  const streamJob = useWizard((s) => s.streamJob);
  return (
    <section id="wizardCreation" className={`creation-view${ready ? ' is-ready' : ''}`} aria-live="polite" aria-labelledby="wizardCreationTitle" hidden={hidden}>
      <header className="creation-head">
        <span className="creation-orb" aria-hidden="true">
          <i />
        </span>
        <div className="creation-titles">
          <strong id="wizardCreationTitle">
            {title}
          </strong>
          {' '}
          <span id="wizardCreationDetail">
            {detail}
          </span>
        </div>
        <div className="creation-clock" aria-label="Elapsed time">
          <b id="wizardCreationElapsed">
            {elapsed}
          </b>
          {' '}
          <em id="wizardCreationEta">
            {eta}
          </em>
        </div>
      </header>
      <div className="creation-bar" aria-hidden="true">
        <i id="wizardCreationBar" style={bar ? { width: bar } : undefined} />
      </div>
      <div className="creation-grid">
        <ol className="creation-stages">
          {CREATE_ORDER.map((id) => (
            <StageRowItem key={id} id={id} />
          ))}
        </ol>
        <aside className="creation-made" aria-label="Created so far">
          <h4>
            Created so far
          </h4>
          <BrandCard />
          <Artifacts />
        </aside>
      </div>
      <FirstScript />
      <WizardGuide />
      <WizardStream id="wizardStream" job={streamJob} label="Live output" />
    </section>
  );
}
