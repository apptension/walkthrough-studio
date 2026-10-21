/**
 * One stream model for every agent the Studio drives.
 *
 * Cursor CLI (`agent -p --output-format stream-json --stream-partial-output`) and Claude Code
 * (`claude -p --output-format stream-json --verbose --include-partial-messages`) both print JSON
 * lines, in different shapes. Both fold into the same ordered list of entries, which every Studio
 * surface renders with `studio/agentStream.js`:
 *
 *   { id, kind: 'think'|'say'|'tool'|'line'|'error'|'system', title, text, done, ok, t }
 *
 * Text is kept whole. Deltas grow the open entry, and the full message an agent repeats after its
 * deltas closes that entry rather than printing twice.
 */

const MAX_ENTRIES = 240;
const MAX_TEXT = 24000;

export function createStream() {
  return { seq: 0, rev: 0, entries: [], tools: {}, blocks: {} };
}

function touch(stream) {
  stream.rev += 1;
}

function clip(text) {
  const s = String(text ?? '');
  return s.length > MAX_TEXT ? s.slice(-MAX_TEXT) : s;
}

function add(stream, entry) {
  const e = { id: ++stream.seq, t: Date.now(), title: '', text: '', done: false, ...entry };
  e.text = clip(e.text);
  stream.entries.push(e);
  while (stream.entries.length > MAX_ENTRIES) stream.entries.shift();
  touch(stream);
  return e;
}

function last(stream) {
  return stream.entries.at(-1) || null;
}

function closeOpen(stream, except) {
  const open = last(stream);
  if (open && !open.done && open.kind !== except && open.kind !== 'tool') {
    open.done = true;
    touch(stream);
  }
}

/** Grow the open entry of this kind, or open a new one. */
export function streamDelta(stream, kind, text) {
  if (!text) return null;
  const open = last(stream);
  if (open && open.kind === kind && !open.done) {
    open.text = clip(open.text + text);
    touch(stream);
    return open;
  }
  closeOpen(stream, kind);
  return add(stream, { kind, text });
}

/** A whole message: closes the deltas it repeats, otherwise lands as its own entry. */
export function streamFull(stream, kind, text) {
  const body = String(text || '');
  if (!body.trim()) return null;
  const open = last(stream);
  if (open && open.kind === kind && !open.done) {
    if (body === open.text || body.startsWith(open.text)) {
      open.text = clip(body);
      open.done = true;
      touch(stream);
      return open;
    }
  }
  const recent = stream.entries.slice(-6);
  if (recent.some((e) => e.kind === kind && e.text.trim() === body.trim())) {
    if (open && open.kind === kind && !open.done) {
      open.done = true;
      touch(stream);
    }
    return null;
  }
  closeOpen(stream);
  return add(stream, { kind, text: body, done: true });
}

export function streamEnd(stream, kind) {
  const open = last(stream);
  if (open && !open.done && (!kind || open.kind === kind)) {
    open.done = true;
    touch(stream);
  }
}

function progressKey(text) {
  return String(text).replace(/[\d.:]+/g, '#').replace(/\s+/g, ' ').trim();
}

/** A plain output line (kit steps, stderr). */
export function streamLine(stream, text, kind = 'line') {
  const body = String(text || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, '');
  if (!body.trim()) return null;
  const prev = last(stream);
  // A progress line reprinted with new numbers ("42% · encoding" → "43% · encoding") updates in place.
  if (kind === 'line' && prev?.kind === 'line' && /\d/.test(body) && progressKey(prev.text) === progressKey(body)) {
    prev.text = body;
    touch(stream);
    return prev;
  }
  closeOpen(stream);
  return add(stream, { kind, text: body, done: true });
}

const TOOL_NAMES = {
  readToolCall: 'Read',
  writeToolCall: 'Write',
  editToolCall: 'Edit',
  strReplaceToolCall: 'Edit',
  deleteToolCall: 'Delete',
  shellToolCall: 'Shell',
  grepToolCall: 'Search',
  globToolCall: 'Find files',
  lsToolCall: 'List',
  todoToolCall: 'Plan',
  updateTodosToolCall: 'Plan',
  webSearchToolCall: 'Web search',
  webFetchToolCall: 'Fetch',
  mcpToolCall: 'Tool',
  semSearchToolCall: 'Search',
  readLintsToolCall: 'Lints',
};

function prettyTool(name) {
  if (!name) return 'Tool';
  if (TOOL_NAMES[name]) return TOOL_NAMES[name];
  return String(name)
    .replace(/ToolCall$/, '')
    .replace(/^mcp__/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** The one detail a person wants from tool input: the path, command or pattern. */
export function toolDetail(args) {
  if (!args || typeof args !== 'object') return typeof args === 'string' ? args : '';
  const pick =
    args.path ||
    args.file_path ||
    args.filePath ||
    args.target_file ||
    args.command ||
    args.pattern ||
    args.query ||
    args.url ||
    args.glob_pattern ||
    args.globPattern ||
    args.description ||
    '';
  if (pick) return String(pick);
  if (Array.isArray(args.todos)) {
    return args.todos.map((t) => `${t.status === 'completed' ? '✓' : '·'} ${t.content || t.title || ''}`).join('\n');
  }
  return '';
}

function shortPath(detail) {
  const s = String(detail || '');
  const m = s.match(/(?:\.cursor\/skills\/product-walkthrough-video\/|kit\/)(.+)$/);
  return m ? m[1] : s;
}

function toolStart(stream, callId, name, args) {
  const detail = shortPath(toolDetail(args));
  const existing = callId ? stream.tools[callId] : null;
  if (existing) {
    const e = stream.entries.find((x) => x.id === existing);
    if (e && detail && !e.text) {
      e.text = detail;
      touch(stream);
    }
    return e;
  }
  closeOpen(stream);
  const e = add(stream, { kind: 'tool', title: prettyTool(name), text: detail });
  if (callId) stream.tools[callId] = e.id;
  return e;
}

function toolEnd(stream, callId, { ok = true, note = '' } = {}) {
  const id = callId ? stream.tools[callId] : null;
  const e = id ? stream.entries.find((x) => x.id === id) : null;
  if (!e) return null;
  e.done = true;
  e.ok = ok;
  if (!ok && note) e.text = clip(`${e.text}${e.text ? '\n' : ''}${note}`);
  touch(stream);
  return e;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => typeof c === 'string' || c?.type === 'text' || (c && !c.type && c.text))
    .map((c) => (typeof c === 'string' ? c : c.text || ''))
    .join('');
}

/**
 * Fold one JSON event from either agent into the stream.
 * @returns {{ phase?: string, activity?: string, model?: string, result?: { ok: boolean, text: string } } | null}
 */
export function ingestAgentEvent(stream, o) {
  if (!o || typeof o !== 'object') return null;
  const type = o.type || o.event || '';
  const subtype = o.subtype || '';

  if (type === 'system' && subtype === 'init') {
    const model = o.model || 'Auto';
    add(stream, { kind: 'system', text: `Session ready · ${model}`, done: true });
    return { phase: 'starting', activity: `Starting · ${model}`, model };
  }
  if (type === 'user') {
    const parts = Array.isArray(o.message?.content) ? o.message.content : [];
    for (const p of parts) {
      if (p?.type === 'tool_result') {
        const note = p.is_error ? textOf(p.content) || String(p.content || '') : '';
        toolEnd(stream, p.tool_use_id, { ok: !p.is_error, note: note.slice(0, 600) });
      }
    }
    return null;
  }

  // Cursor CLI
  if (type === 'thinking') {
    if (subtype === 'completed') {
      streamEnd(stream, 'think');
      return { phase: 'thinking' };
    }
    const e = streamDelta(stream, 'think', o.text || o.delta || '');
    return { phase: 'thinking', activity: e ? tail(e.text) : undefined };
  }
  if (type === 'tool_call') {
    const call = o.tool_call || {};
    const key = Object.keys(call).find((k) => /ToolCall$/.test(k)) || '';
    const body = key ? call[key] : {};
    const id = o.call_id || call.toolCallId;
    const args = body?.args || {};
    if (subtype === 'completed') {
      const err = body?.result?.error || body?.result?.failure;
      const note = err ? String(err.errorMessage || err.message || err.error || JSON.stringify(err)).slice(0, 600) : '';
      const e = toolEnd(stream, id, { ok: !err, note });
      return e ? { phase: 'tool', activity: `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}` } : null;
    }
    const name = key || o.name || 'tool';
    const e = toolStart(stream, id, name, args);
    return { phase: 'tool', activity: `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}` };
  }

  // Claude Code partial messages
  if (type === 'stream_event') {
    const ev = o.event || {};
    const idx = ev.index ?? 0;
    if (ev.type === 'content_block_start') {
      const block = ev.content_block || {};
      stream.blocks[idx] = { type: block.type, id: block.id, json: '' };
      if (block.type === 'tool_use') {
        const e = toolStart(stream, block.id, block.name, block.input && Object.keys(block.input).length ? block.input : null);
        return { phase: 'tool', activity: e.title };
      }
      if (block.type === 'thinking') closeOpen(stream, 'think');
      if (block.type === 'text') closeOpen(stream, 'say');
      return null;
    }
    if (ev.type === 'content_block_delta') {
      const d = ev.delta || {};
      if (d.type === 'text_delta') {
        const e = streamDelta(stream, 'say', d.text);
        return { phase: 'writing', activity: e ? tail(e.text) : undefined };
      }
      if (d.type === 'thinking_delta') {
        const e = streamDelta(stream, 'think', d.thinking);
        return { phase: 'thinking', activity: e ? tail(e.text) : undefined };
      }
      if (d.type === 'input_json_delta' && stream.blocks[idx]) {
        stream.blocks[idx].json += d.partial_json || '';
      }
      return null;
    }
    if (ev.type === 'content_block_stop') {
      const block = stream.blocks[idx];
      delete stream.blocks[idx];
      if (block?.type === 'tool_use' && block.json) {
        try {
          const e = toolStart(stream, block.id, null, JSON.parse(block.json));
          return { phase: 'tool', activity: `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}` };
        } catch {
          /* partial json that never closed */
        }
      } else if (block?.type === 'text') streamEnd(stream, 'say');
      else if (block?.type === 'thinking') streamEnd(stream, 'think');
      return null;
    }
    return null;
  }

  if (type === 'assistant' || (o.message && o.message.role === 'assistant')) {
    const content = o.message?.content ?? o.content ?? o.text ?? '';
    // Claude Code: a full message is a list of typed blocks.
    if (Array.isArray(content) && content.some((c) => c && c.type && c.type !== 'text')) {
      let hint = null;
      for (const c of content) {
        if (c?.type === 'thinking' && c.thinking) streamFull(stream, 'think', c.thinking);
        else if (c?.type === 'text' && c.text) {
          const e = streamFull(stream, 'say', c.text);
          if (e) hint = { phase: 'writing', activity: tail(e.text) };
        } else if (c?.type === 'tool_use') {
          const e = toolStart(stream, c.id, c.name, c.input);
          hint = { phase: 'tool', activity: `${e.title}${e.text ? ` · ${e.text.split('\n')[0]}` : ''}` };
        }
      }
      return hint;
    }
    const text = textOf(content);
    if (!text) return null;
    // Cursor sends deltas and then the whole message once more; Claude's full blocks repeat its deltas.
    const open = last(stream);
    const repeat =
      open && open.kind === 'say' && !open.done && text.length > 1 && (text === open.text || text.startsWith(open.text));
    const e = repeat || o.model_call_id ? streamFull(stream, 'say', text) : streamDelta(stream, 'say', text);
    const ref = e || last(stream);
    return { phase: 'writing', activity: ref?.kind === 'say' ? tail(ref.text) : undefined };
  }

  if (type === 'result') {
    closeOpen(stream);
    const isError = o.is_error === true || subtype === 'error' || /^error/.test(subtype);
    const text = typeof o.result === 'string' ? o.result : '';
    if (isError && text) add(stream, { kind: 'error', text, done: true, ok: false });
    return { phase: 'finishing', activity: isError ? text || 'Agent reported an error' : 'Wrapping up…', result: { ok: !isError, text } };
  }
  if (type === 'error') {
    const text = o.message || o.error?.message || o.error || 'Agent error';
    add(stream, { kind: 'error', text: String(text), done: true, ok: false });
    return { phase: 'failed', activity: String(text) };
  }
  return null;
}

/** The last sentence or so of a growing text, for one-line titles. */
export function tail(text, max = 220) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(-max);
  const space = cut.indexOf(' ');
  return `…${space > 0 && space < 40 ? cut.slice(space + 1) : cut}`;
}

export function streamPayload(stream) {
  if (!stream) return null;
  return {
    rev: stream.rev,
    entries: stream.entries.map((e) => ({ id: e.id, kind: e.kind, title: e.title, text: e.text, done: e.done, ok: e.ok, t: e.t })),
  };
}
