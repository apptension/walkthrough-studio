/**
 * Terminal layout for ./studio.
 * Boxes measure visible width (ANSI codes don't count) and wrap instead of
 * running past the frame.
 */

export function createTheme(enabled) {
  const ansi = (code) => (enabled ? `\x1b[${code}m` : '');
  return {
    enabled: Boolean(enabled),
    reset: ansi(0),
    bold: ansi(1),
    dim: ansi(2),
    italic: ansi(3),
    under: ansi(4),
    red: ansi(31),
    green: ansi(32),
    amber: ansi(33),
    soft: enabled ? '\x1b[38;5;245m' : '',
    ink: enabled ? '\x1b[38;5;255m' : '',
    accent: enabled ? '\x1b[38;5;216m' : '',
    line: enabled ? '\x1b[38;5;240m' : '',
    ok: enabled ? '\x1b[38;5;114m' : '',
    warn: enabled ? '\x1b[38;5;178m' : '',
    bad: enabled ? '\x1b[38;5;203m' : '',
  };
}

export function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '');
}

export function visibleWidth(value) {
  return stripAnsi(value).length;
}

export function frameWidth(columns) {
  const cols = columns && columns > 0 ? columns : 80;
  if (cols < 48) return Math.max(32, cols);
  return Math.min(72, cols);
}

/**
 * Wrap on spaces. Color codes stay attached to the text that follows,
 * including on the next line after a break.
 */
export function wrapAnsi(text, width) {
  const limit = Math.max(1, width | 0);
  const input = String(text);
  if (visibleWidth(input) <= limit) return [input];

  const lines = [];
  let line = '';
  let vis = 0;
  let active = '';

  const breakLine = () => {
    lines.push(line.replace(/[ \t]+$/g, ''));
    line = active;
    vis = 0;
  };

  for (const token of input.split(/(\x1b\[[0-9;]*m)/)) {
    if (!token) continue;
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      line += token;
      active = token === '\x1b[0m' ? '' : token;
      continue;
    }
    for (const word of token.split(/(\s+)/)) {
      if (!word) continue;
      if (/^\s+$/.test(word)) {
        if (vis === 0) continue;
        if (vis + word.length > limit) breakLine();
        else {
          line += word;
          vis += word.length;
        }
        continue;
      }
      if (vis > 0 && vis + word.length > limit) breakLine();
      if (word.length > limit) {
        for (const ch of word) {
          if (vis >= limit) breakLine();
          line += ch;
          vis += 1;
        }
        continue;
      }
      line += word;
      vis += word.length;
    }
  }
  if (vis > 0 || line) lines.push(line.replace(/[ \t]+$/g, ''));
  return lines.length ? lines : [''];
}

export function box(lines, { width = 52, theme = createTheme(false) } = {}) {
  const inner = Math.max(4, width - 4);
  const wrapped = [];
  for (const line of lines) {
    if (line === '') wrapped.push('');
    else wrapped.push(...wrapAnsi(line, inner));
  }
  const top = `${theme.line}┌${'─'.repeat(width - 2)}┐${theme.reset}`;
  const bot = `${theme.line}└${'─'.repeat(width - 2)}┘${theme.reset}`;
  const body = wrapped.map((line) => {
    const pad = Math.max(0, inner - visibleWidth(line));
    return `${theme.line}│${theme.reset} ${line}${' '.repeat(pad)} ${theme.line}│${theme.reset}`;
  });
  return [top, ...body, bot].join('\n');
}

export function titledBox(title, lines, { width = 52, theme = createTheme(false) } = {}) {
  const label = ` ${title} `;
  const remain = width - 2 - label.length;
  if (remain < 2) return box([`${theme.bold}${title}${theme.reset}`, ...lines], { width, theme });
  const left = 1;
  const right = remain - left;
  const top =
    `${theme.line}┌${'─'.repeat(left)}${theme.reset}` +
    `${theme.bold}${theme.accent}${label}${theme.reset}` +
    `${theme.line}${'─'.repeat(right)}┐${theme.reset}`;
  const inner = Math.max(4, width - 4);
  const wrapped = [];
  for (const line of lines) {
    if (line === '') wrapped.push('');
    else wrapped.push(...wrapAnsi(line, inner));
  }
  const bot = `${theme.line}└${'─'.repeat(width - 2)}┘${theme.reset}`;
  const body = wrapped.map((line) => {
    const pad = Math.max(0, inner - visibleWidth(line));
    return `${theme.line}│${theme.reset} ${line}${' '.repeat(pad)} ${theme.line}│${theme.reset}`;
  });
  return [top, ...body, bot].join('\n');
}

const LABEL_W = 12;

export function kvLines(theme, label, value, innerWidth) {
  const valueWidth = Math.max(8, innerWidth - 1 - LABEL_W - 2);
  const wrapped = wrapAnsi(String(value), valueWidth);
  return wrapped.map((line, index) => {
    const text = index === 0 ? label : '';
    const lab = `${theme.soft}${text.padEnd(LABEL_W, ' ')}${theme.reset}`;
    return ` ${lab}  ${line}`;
  });
}

function paint(theme, value, tone) {
  const color = tone === 'ok' ? theme.ok : tone === 'warn' ? theme.warn : tone === 'bad' ? theme.bad : '';
  if (!color) return String(value);
  return `${color}${value}${theme.reset}`;
}

export function readyCard({ theme, width, elapsed, url, browserLine, rows }) {
  const inner = width - 4;
  const lines = ['', ` ${theme.bold}${url}${theme.reset}`, ` ${theme.soft}${browserLine}${theme.reset}`, ''];
  for (const row of rows) {
    lines.push(...kvLines(theme, row.label, paint(theme, row.value, row.tone), inner));
  }
  lines.push('');
  return titledBox(`Ready · ${elapsed}s`, lines, { width, theme });
}

export function formatCheckRow({ theme, columns, label, status, detail = '', labelWidth = 14 }) {
  const glyph =
    status === 'ok'
      ? `${theme.ok}●${theme.reset}`
      : status === 'warn'
        ? `${theme.warn}●${theme.reset}`
        : status === 'bad'
          ? `${theme.bad}●${theme.reset}`
          : status === 'skip'
            ? `${theme.soft}○${theme.reset}`
            : `${theme.soft}·${theme.reset}`;
  const head = `  ${glyph}  ${String(label).padEnd(labelWidth, ' ')}`;
  if (!detail) return head;
  const room = Math.max(12, (columns || 100) - visibleWidth(head) - 2);
  const parts = wrapAnsi(`${theme.soft}${detail}${theme.reset}`, room);
  return parts
    .map((line, index) => (index === 0 ? `${head}  ${line}` : `${' '.repeat(visibleWidth(head))}  ${line}`))
    .join('\n');
}

export function formatLog({ theme, columns, time, source, text, tone }) {
  const srcColor =
    tone === 'error' ? theme.bad : tone === 'warn' ? theme.warn : source === 'server' ? theme.soft : theme.accent;
  const prefix = `  ${theme.soft}${time}${theme.reset}  ${srcColor}${String(source).padEnd(8, ' ')}${theme.reset}  `;
  const room = Math.max(16, (columns || 100) - visibleWidth(prefix));
  const parts = wrapAnsi(String(text), room);
  const indent = ' '.repeat(visibleWidth(prefix));
  return parts.map((line, index) => (index === 0 ? prefix + line : indent + line)).join('\n');
}

export function parseStudioBoot(text) {
  const url = text.match(/Walkthrough Studio → (http:\/\/127\.0\.0\.1:\d+\/\S*)/)?.[1] || null;
  const agentLine = text.match(/agent CLI:\s*(.+)/)?.[1]?.trim() || null;
  const videosMatch = text.match(/videos:\s*(.+?)\s*[·•]\s*out:/);
  const videosLine = videosMatch?.[1]?.trim() || null;
  let videoCount = 0;
  if (videosLine && videosLine !== '(none)') {
    videoCount = videosLine
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean).length;
  }
  const complete = Boolean(url && agentLine && videosLine !== null);
  return { url, agentLine, videoCount, complete };
}
