import { ICONS, escapeHtml, fieldLabel } from './util';

/** One line the last plate render measured as still clipping. */
export interface CopyClip {
  path: string;
  where: 'overflow' | 'offscreen';
  snippet: string;
}

/** `Copy clips: overflow title "Three ways past home"` — the note `plateEncodeSummary` stores. */
const NOTE = /^Copy clips: (overflow|offscreen) (\S+)(?: "([^"]*)")?$/;

/**
 * The lines a plate render reported as clipping. One entry per field; a 32-character
 * probe snippet gains an ellipsis so a cut-off word doesn't read as the whole line.
 */
export function parseCopyClips(notes: readonly string[] | null | undefined): CopyClip[] {
  const out: CopyClip[] = [];
  const seen = new Set<string>();
  for (const note of notes || []) {
    const m = String(note).match(NOTE);
    const path = m?.[2];
    if (!m || !path || seen.has(path)) continue;
    seen.add(path);
    const raw = (m[3] || '').trim();
    const cut = raw.length >= 32 ? raw.slice(0, 31).replace(/\s+\S*$/, '') : raw;
    out.push({ path, where: m[1] === 'offscreen' ? 'offscreen' : 'overflow', snippet: cut && cut !== raw ? `${cut}…` : raw });
  }
  return out;
}

export function copyClipPhrase(where: CopyClip['where']): string {
  return where === 'offscreen' ? 'sits outside the frame' : 'clips, even at the smallest size';
}

/**
 * The probe names the field (`title`, `items.0.label`). Before the plate has listed its fields,
 * that name is still clickable. A CSS class (`step-label`) is not a field, and a name missing
 * from a loaded field list is not one either.
 */
export function fieldPathFocusable(path: string, known: ReadonlySet<string>): boolean {
  if (known.has(path)) return true;
  if (known.size) return false;
  return !path.includes('-');
}

/** The callout at the top of Plate copy. A row focuses that field when the plate can edit it. */
export function copyClipCallout(clips: readonly CopyClip[], known: ReadonlySet<string>, activePath: string | null): string {
  if (!clips.length) return '';
  const rows = clips
    .map((c) => {
      const label = fieldLabel(c.path);
      const detail = `${copyClipPhrase(c.where)}${c.snippet ? ` — “${c.snippet}”` : ''}`;
      const body = `<b>${escapeHtml(label)}</b><span>${escapeHtml(detail)}</span>`;
      if (!fieldPathFocusable(c.path, known)) return `<li><div class="copy-long-row is-plain">${body}</div></li>`;
      const on = activePath === c.path ? ' on' : '';
      return `<li><button type="button" class="copy-long-row${on}" data-field="${escapeHtml(c.path)}" title="Edit ${escapeHtml(label)}">${body}</button></li>`;
    })
    .join('');
  const lead = clips.length === 1 ? 'This line still clips at the smallest size. Shorten it here.' : 'These lines still clip at the smallest size. Shorten them here.';
  return `<div class="copy-long" role="status">
      <span class="copy-long-mark" aria-hidden="true">${ICONS['warn']}</span>
      <div class="copy-long-body">
        <strong>Copy too long</strong>
        <p>${lead} The next plate render measures again.</p>
        <ul class="copy-long-list">${rows}</ul>
      </div>
    </div>`;
}

/** Sits under the textarea of the field that clips. Hidden until that field is the one open. */
export function copyClipFieldNote(clips: readonly CopyClip[], activePath: string | null): string {
  if (!clips.length) return '';
  const paths = clips.map((c) => c.path).join('|');
  const hit = Boolean(activePath && clips.some((c) => c.path === activePath));
  return `<p class="copy-long-field" data-copy-long data-paths="${escapeHtml(paths)}"${hit ? '' : ' hidden'}>This line still clips at the smallest size.</p>`;
}
