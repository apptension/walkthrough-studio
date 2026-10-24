import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

import { requestMake } from '@/desk/jobs';
import { showRightTab } from '@/desk/panels';
import { useRenderStop } from '@/desk/renderStop';
import { useDesk } from '@/desk/store';
import { NeonButton } from '@/ui/NeonButton';
import { Icon } from '@/ui/icons';

import {
  baseChipView,
  chipView,
  clearsToUpToDate,
  IDLE_VIEW,
  NOTICE_MS,
  UP_TO_DATE,
  type ChipInput,
  type ChipNotice,
  type ChipTip,
  type ChipView,
} from './renderStatus';

function leftHost(e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>): boolean {
  const next = e.relatedTarget as Node | null;
  return !next || !e.currentTarget.contains(next);
}

/** Everything the chip decides from, plus the two bits of memory it keeps: catching up, and the passing notice. */
function useChip(): ChipView {
  const video = useDesk((s) => s.video);
  const action = useDesk((s) => s.action);
  const busy = useDesk((s) => s.jobBusy);
  const status = useDesk((s) => s.status);
  const pipeline = useDesk((s) => s.pipeline);
  const proposalOpen = useDesk((s) => s.proposalOpen);
  const slug = useDesk((s) => s.slug);
  const [catching, setCatching] = useState(false);
  const [notice, setNotice] = useState<ChipNotice | null>(null);

  useEffect(() => {
    if ((status.kind === 'ok' || status.kind === 'warn') && status.text) setNotice({ tone: status.kind, text: status.text });
  }, [status]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice((n) => (n === notice ? null : n)), NOTICE_MS[notice.tone]);
    return () => clearTimeout(t);
  }, [notice]);

  const activity = status.kind === 'run' ? status.text : '';
  const input: ChipInput = useMemo(
    () => ({ video, action, busy, activity, pipeline, catching, proposalOpen, notice }),
    [video, action, busy, activity, pipeline, catching, proposalOpen, notice],
  );
  const base = useMemo(() => baseChipView({ ...input, notice: null }), [input]);
  const view = useMemo(() => chipView(input), [input]);

  // A job that starts while the cut is behind (or a review is open) is catching it up.
  const rest = useRef<ChipView>(base);
  useEffect(() => {
    if (!busy) {
      rest.current = base;
      setCatching(false);
    } else if (rest.current.kind === 'review' || (rest.current.kind === 'render' && rest.current.tone !== 'accent')) {
      setCatching(true);
    }
  }, [busy, base]);

  // The cut caught up: flash "Up to date" — never for a sequence switch.
  const prev = useRef({ view: base, catching, slug });
  useEffect(() => {
    const was = prev.current;
    prev.current = { view: base, catching, slug };
    if (was.slug !== slug) {
      setNotice(null);
      return;
    }
    if (base.kind === 'idle' && was.view.kind !== 'idle' && clearsToUpToDate(was.view, was.catching)) {
      setNotice((n) => n ?? { tone: 'ok', text: UP_TO_DATE });
    }
  }, [base, catching, slug]);

  return view;
}

/** `#btnMake` — the label `renderActionCard` sets and the `updateQueueBadge` count. */
function MakeButton({ describedBy }: { describedBy?: string }) {
  const { busy, stopping, stop } = useRenderStop('btnMake');
  const label = useDesk((s) => s.action?.makeLabel ?? 'Render');
  const queued = useDesk((s) => s.queue.length);
  return (
    <NeonButton
      id="btnMake"
      className={busy ? 'btn primary icon-text is-stop' : 'btn primary icon-text'}
      title={busy ? 'Stop the running job and clear the queue' : describedBy ? undefined : 'Render / rebuild delivery'}
      aria-label={busy ? (stopping ? 'Stopping' : 'Stop') : label}
      aria-describedby={busy ? undefined : describedBy}
      disabled={stopping}
      onClick={() => (busy ? stop() : requestMake())}
    >
      <Icon name={busy ? 'ui-stop' : 'ui-play-fill'} size={14} />
      {' '}
      <span id="btnMakeLabel" className="btn-label">
        {busy ? (stopping ? 'Stopping…' : 'Stop') : label}
      </span>
      {' '}
      <span id="queueBadge" className="queue-badge" hidden={queued === 0}>
        {String(queued)}
      </span>
    </NeonButton>
  );
}

function TipBody({ tip }: { tip: ChipTip }) {
  return (
    <>
      <strong className="render-tip-title">
        <i aria-hidden="true" />
        {tip.title}
      </strong>
      {tip.lead ? <p className="render-tip-lead">{tip.lead}</p> : null}
      {tip.steps.length ? (
        <ol className="render-tip-steps">
          {tip.steps.map((s) => (
            <li key={s.id} data-status={s.status}>
              <i aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ol>
      ) : null}
      {tip.changes.length ? (
        <ul className="render-tip-changes">
          {tip.changes.map((c) => (
            <li key={c.key}>
              <span className="render-tip-change">
                <b>{c.label}</b>
                <em>{c.hint}</em>
              </span>
              <time>{c.when}</time>
            </li>
          ))}
        </ul>
      ) : null}
      {tip.detail ? <p className="render-tip-detail">{tip.detail}</p> : null}
      {tip.lastRender || tip.next ? (
        <footer className="render-tip-foot">
          {tip.lastRender ? <span>Last render · {tip.lastRender}</span> : <span />}
          {tip.next ? <span className="render-tip-next">{tip.next}</span> : null}
        </footer>
      ) : null}
    </>
  );
}

/**
 * `#renderCluster` — Render plus the one header status chip: it folds out of Render's left
 * edge for whatever the cut needs (or is doing), morphs between states, and says why on hover.
 */
export function RenderCluster() {
  const view = useChip();
  const open = view.kind !== 'idle';
  const [last, setLast] = useState<ChipView>(IDLE_VIEW);
  const [hover, setHover] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (open) setLast(view);
  }, [open, view]);

  // Folding away keeps the last face, so the chip collapses instead of blanking first.
  const shown = open ? view : last;

  useLayoutEffect(() => {
    const el = chipRef.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (chipRef.current) setWidth(chipRef.current.offsetWidth);
  }, [shown.label]);

  const tipOpen = hover && Boolean(view.tip);

  return (
    <div
      id="renderCluster"
      className="render-cluster"
      data-kind={view.kind}
      data-tone={shown.tone}
      data-attention={view.attention || undefined}
      onPointerOver={() => setHover(true)}
      onPointerOut={(e) => {
        if (leftHost(e)) setHover(false);
      }}
      onFocus={() => setHover(true)}
      onBlur={(e) => {
        if (leftHost(e)) setHover(false);
      }}
    >
      <span className="render-fresh" style={{ width: open ? width : 0 }} aria-hidden="true">
        <span
          ref={chipRef}
          className="render-fresh-chip"
          data-click={view.click || undefined}
          title={view.kind === 'notice' ? view.label : undefined}
          onClick={() => {
            if (view.click === 'render') requestMake();
            else if (view.click === 'feedback') showRightTab('feedback');
          }}
        >
          <span className="render-fresh-mark">
            <i className="render-fresh-dot" />
            <i className="render-fresh-spin" />
            <Icon name="ui-check" size={10} className="render-fresh-check" />
          </span>
          <span key={shown.label} className="render-fresh-label">
            {shown.label}
          </span>
        </span>
      </span>
      <span id="renderStatus" className="sr-only" role="status">
        {open ? view.label : ''}
      </span>
      <MakeButton describedBy={view.tip ? 'renderTip' : undefined} />
      <div id="renderTip" className="render-tip" role="tooltip" data-tone={view.tone} data-open={tipOpen || undefined} aria-hidden={!tipOpen}>
        {view.tip ? <TipBody tip={view.tip} /> : null}
      </div>
    </div>
  );
}
