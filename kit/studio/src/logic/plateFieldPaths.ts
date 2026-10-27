/**
 * Plate HTML uses generic `items.N.field` on many templates; the Content schema uses the real
 * list key (`stats`, `quotes`, `steps`, …). Map between them for pane ↔ stage sync.
 */

export interface PlateListSchema {
  key: string;
}

export interface PlateFieldPathSchema {
  lists: PlateListSchema[];
}

/** Content/schema path → `data-edit` path on the baked plate HTML. */
export function editPathForContentPath(path: string, schema: PlateFieldPathSchema | null | undefined): string {
  if (!path || !schema?.lists?.length) return path;
  for (const list of schema.lists) {
    if (list.key === 'items' || list.key.includes('.')) continue;
    const prefix = `${list.key}.`;
    if (!path.startsWith(prefix)) continue;
    return `items.${path.slice(prefix.length)}`;
  }
  return path;
}

/** `data-edit` path from the stage → Content pane `data-cnt-path`. */
export function contentPathForEditPath(path: string, schema: PlateFieldPathSchema | null | undefined): string {
  if (!path || !schema?.lists?.length) return path;
  const m = path.match(/^items\.(\d+)(?:\.(.+))?$/);
  if (!m) return path;
  const list = schema.lists.find((l) => l.key !== 'items' && !l.key.includes('.'));
  if (!list) return path;
  return `${list.key}.${m[1]}${m[2] ? `.${m[2]}` : ''}`;
}
