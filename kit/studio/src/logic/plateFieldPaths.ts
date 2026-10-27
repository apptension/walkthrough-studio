/**
 * Content schema paths vs baked `data-edit` paths. Most plates align keys (KPI uses `stats.N`
 * in both); a few templates still use generic `items.N` while the schema keeps the real list key.
 */

export interface PlateListSchema {
  key: string;
}

export interface PlateFieldPathSchema {
  lists: PlateListSchema[];
}

/** Schema list keys whose HTML uses `items.N…` for that plate type (not the schema key). */
function listUsesGenericItemsHtml(plateType: string, listKey: string): boolean {
  if (listKey === 'items') return false;
  if (plateType === 'stats' && listKey === 'stats') return true;
  if (plateType === 'journey' && listKey === 'steps') return true;
  return false;
}

/** Content/schema path → `data-edit` path on the baked plate HTML. */
export function editPathForContentPath(
  path: string,
  schema: PlateFieldPathSchema | null | undefined,
  plateType?: string | null,
): string {
  if (!path || !schema?.lists?.length) return path;
  const type = plateType || '';
  for (const list of schema.lists) {
    if (list.key.includes('.')) continue;
    const prefix = `${list.key}.`;
    if (!path.startsWith(prefix)) continue;
    if (listUsesGenericItemsHtml(type, list.key)) {
      return `items.${path.slice(prefix.length)}`;
    }
    return path;
  }
  return path;
}

/** `data-edit` path from the stage → Content pane `data-cnt-path`. */
export function contentPathForEditPath(
  path: string,
  schema: PlateFieldPathSchema | null | undefined,
  plateType?: string | null,
): string {
  if (!path || !schema?.lists?.length) return path;
  const m = path.match(/^items\.(\d+)(?:\.(.+))?$/);
  if (!m) return path;
  const type = plateType || '';
  for (const list of schema.lists) {
    if (listUsesGenericItemsHtml(type, list.key)) {
      return `${list.key}.${m[1]}${m[2] ? `.${m[2]}` : ''}`;
    }
  }
  return path;
}
