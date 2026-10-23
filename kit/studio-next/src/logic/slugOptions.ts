import type { VideoEntry, VideoIndex } from '@/api/types';

/** `optionLabel(v)` — how the sequence picker names a video; branches indent under their root. */
export function optionLabel(v: VideoEntry): string {
  if ('error' in v && v.error) return `${v.slug} (needs setup)`;
  if ('lineage' in v && v.lineage?.role === 'branch') return `  ↳ ${v.title || v.slug}`;
  return v.title || v.slug;
}

export interface SlugOption {
  value: string;
  label: string;
  /** A branch of another video in the list — the picker draws it as a child row. */
  branch?: true;
  /** The video has no brand pack / config yet. */
  setup?: true;
}

export interface SlugGroup {
  label: string;
  options: SlugOption[];
}

function toOption(v: VideoEntry): SlugOption {
  const opt: SlugOption = { value: v.slug, label: optionLabel(v) };
  if ('error' in v && v.error) opt.setup = true;
  else if ('lineage' in v && v.lineage?.role === 'branch') opt.branch = true;
  return opt;
}

/**
 * `fillSlugSelect(sel, index)` as data: one optgroup per project folder, then
 * the loose videos. An empty list is the single "No videos" option.
 */
export function slugGroups({ videos = [], folders = [], loose = [] }: Partial<VideoIndex>): SlugGroup[] {
  const toOptions = (list: readonly VideoEntry[]) => list.map(toOption);
  const groups: SlugGroup[] = [];
  for (const folder of folders) {
    if (!folder.videos?.length) continue;
    groups.push({ label: folder.title || folder.id, options: toOptions(folder.videos) });
  }
  const rest = loose.length ? loose : folders.length ? [] : videos;
  if (rest.length) groups.push({ label: folders.length ? 'Other videos' : 'Videos', options: toOptions(rest) });
  return groups;
}
