import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import type { AgentAuth, AgentModel, AgentModelList } from '@/api/types';
import { api, enc } from '@/desk/api';
import { setAgentAuth } from '@/desk/boot';
import { toast } from '@/desk/toast';
import { FloatingCard } from '@/ui/FloatingCard';
import { Icon } from '@/ui/icons';

import { customCandidate, flatModels, groupModels, listCache, modelChipLabel } from './agentModels';
import type { AgentButtonView, AgentId } from './agentView';

const LABEL: Record<AgentId, string> = { cursor: 'Cursor', claude: 'Claude Code' };
const MENU_W = 340;

type Row = { kind: 'model'; model: AgentModel } | { kind: 'custom'; id: string };

const rowKey = (r: Row) => (r.kind === 'model' ? `m:${r.model.id}` : `c:${r.id}`);

export function AgentModelMenu({
  provider,
  view,
  active,
  current,
  anchor,
  onClose,
}: {
  provider: AgentId;
  view: AgentButtonView;
  active: boolean;
  current: string | null;
  anchor: HTMLElement | null;
  onClose: (opts?: { focusAnchor?: boolean }) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [list, setList] = useState<AgentModelList | null>(() => listCache.get(provider) ?? null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        const r = await api<AgentModelList>(`/api/agent/models?provider=${enc(provider)}${refresh ? '&refresh=1' : ''}`);
        listCache.set(provider, r);
        setList(r);
      } catch (err) {
        toast('Could not list models', err instanceof Error ? err.message : String(err), 'err');
      } finally {
        setLoading(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const models = useMemo(() => list?.models ?? [], [list]);
  const groups = useMemo(() => groupModels(models, query), [models, query]);
  const custom = customCandidate(models, query);
  const rows = useMemo<Row[]>(() => {
    const r: Row[] = flatModels(groups).map((model) => ({ kind: 'model', model }));
    if (custom) r.push({ kind: 'custom', id: custom });
    return r;
  }, [groups, custom]);
  const selected = current ?? '';
  const at = Math.min(cursor, Math.max(rows.length - 1, 0));

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (query) return;
    const i = rows.findIndex((r) => r.kind === 'model' && r.model.id === selected);
    if (i > 0) setCursor(i);
  }, [list, query, rows, selected]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(MENU_W, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const top = rect.bottom + 8;
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.maxHeight = `${Math.max(220, Math.round(window.innerHeight - top - 12))}px`;
    };
    place();
    inputRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => {
    const onDoc = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (t && (menuRef.current?.contains(t) || anchor?.contains(t))) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [anchor, onClose]);

  useEffect(() => {
    const row = rows[at];
    if (!row) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(row))}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [at, rows]);

  const pick = async (id: string) => {
    if (saving !== null) return;
    if (id === selected && active) return onClose({ focusAnchor: true });
    setSaving(id);
    try {
      const r = await api<{ agentAuth?: AgentAuth }>('/api/agent/model', { method: 'POST', body: { provider, model: id, use: true } });
      setAgentAuth(r.agentAuth ?? null);
      toast(`${LABEL[provider]} model`, modelChipLabel(provider, id || null, models), 'ok');
      onClose({ focusAnchor: true });
    } catch (err) {
      toast('Could not change model', err instanceof Error ? err.message : String(err), 'err');
    } finally {
      setSaving(null);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery('');
      else onClose({ focusAnchor: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((at + step + rows.length) % rows.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      if (e.target === inputRef.current) return;
      e.preventDefault();
      setCursor(e.key === 'Home' ? 0 : rows.length - 1);
    } else if (e.key === 'Enter') {
      const row = rows[at];
      if (!row) return;
      e.preventDefault();
      void pick(row.kind === 'model' ? row.model.id : row.id);
    }
  };

  const optionId = (i: number) => `${uid}-opt-${i}`;
  const ready = view.state === 'ready';
  let index = -1;

  const menu = (
    <FloatingCard
      ref={menuRef}
      id="agentModelMenu"
      className="agent-model-menu"
      size="lg"
      role="dialog"
      aria-label={`${LABEL[provider]} model`}
      data-provider={provider}
      onKeyDown={onKey}
    >
      <div className="amm-head">
        <span className="amm-logo" aria-hidden="true">
          <Icon name={`agent-${provider}`} size={16} />
        </span>
        <span className="amm-title">
          <strong>{LABEL[provider]}</strong>
          <span className={`amm-state${ready ? ' is-ok' : ' is-warn'}`}>
            {active ? 'In use · ' : ''}
            {view.tipView.status}
          </span>
        </span>
        <button
          type="button"
          className="amm-icon-btn"
          aria-label="Refresh model list"
          title="Refresh model list"
          data-loading={loading ? '1' : undefined}
          disabled={loading || provider === 'claude'}
          onClick={() => void load(true)}
        >
          <Icon name="replay" size={13} />
        </button>
      </div>
      {!ready ? <p className="amm-note is-warn">{view.tipView.detail}</p> : null}
      <div className="amm-search">
        <Icon name="search" size={13} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={rows.length ? optionId(at) : undefined}
          aria-autocomplete="list"
          placeholder={models.length > 1 ? `Search ${models.length} models or type an id` : 'Search or type a model id'}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div ref={listRef} id={`${uid}-list`} className="amm-list" role="listbox" aria-label="Models" aria-busy={loading && !list ? 'true' : 'false'}>
        {!list && loading
          ? Array.from({ length: 5 }, (_, i) => <span key={i} className="amm-skeleton" aria-hidden="true" />)
          : null}
        {groups.map((g) => (
          <div key={g.family} role="group" aria-label={g.label} className="amm-group">
            <span className="amm-group-label" aria-hidden="true">
              {g.label}
            </span>
            {g.models.map((m) => {
              index += 1;
              const i = index;
              const isSel = m.id === selected;
              return (
                <div
                  key={m.id || 'default'}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSel}
                  data-row={rowKey({ kind: 'model', model: m })}
                  data-active={i === at ? '1' : undefined}
                  data-saving={saving === m.id ? '1' : undefined}
                  className="amm-option"
                  onPointerMove={() => i !== at && setCursor(i)}
                  onClick={() => void pick(m.id)}
                >
                  <span className="amm-option-copy">
                    <strong>{m.label}</strong>
                    <span>{m.note || m.id}</span>
                  </span>
                  {isSel ? <Icon name="check" size={13} className="amm-check" /> : null}
                </div>
              );
            })}
          </div>
        ))}
        {custom ? (
          <div
            id={optionId(rows.length - 1)}
            role="option"
            aria-selected={false}
            data-row={rowKey({ kind: 'custom', id: custom })}
            data-active={at === rows.length - 1 ? '1' : undefined}
            className="amm-option is-custom"
            onPointerMove={() => setCursor(rows.length - 1)}
            onClick={() => void pick(custom)}
          >
            <span className="amm-option-copy">
              <strong>Use “{custom}”</strong>
              <span>Custom model id, passed to --model</span>
            </span>
          </div>
        ) : null}
        {list && !rows.length ? <p className="amm-empty">No model matches “{query}”.</p> : null}
      </div>
      <p className="amm-foot">
        {list?.error ? <span className="is-warn">{list.error} · </span> : null}
        Every new agent job uses this model · saved in kit/.env
      </p>
    </FloatingCard>
  );
  return createPortal(menu, document.body);
}
