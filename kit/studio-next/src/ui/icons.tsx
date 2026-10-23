import type { SVGProps } from 'react';

import { resolveIconId } from './iconString';
import { ICON_BODY, ICON_META } from './icons.gen';

const PRESENT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'] as const;
const PRESENT_PROP: Record<(typeof PRESENT)[number], string> = {
  fill: 'fill',
  stroke: 'stroke',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: string;
  size?: number;
  width?: number;
  height?: number;
  /** A label makes the icon an image; without one it is decorative. */
  label?: string;
  hidden?: boolean;
}

/**
 * The legacy `icon()` as a component: the same inline `<svg>`, the same
 * presentation attributes from the sprite's metadata, the same body.
 */
export function Icon({ name, size, width, height, label, className, ...rest }: IconProps) {
  const id = resolveIconId(name);
  if (!id) return null;
  const meta = ICON_META[id] ?? { viewBox: '0 0 24 24', present: {} };
  const present = meta.present ?? {};
  const presentProps: Record<string, string> = {};
  for (const key of PRESENT) {
    const value = present[key];
    if (value != null) presentProps[PRESENT_PROP[key]] = value;
  }
  const cls = [present['class'], className].filter(Boolean).join(' ') || undefined;
  return (
    <svg
      className={cls}
      viewBox={meta.viewBox}
      data-sprite={id}
      width={width ?? size ?? 14}
      height={height ?? size ?? 14}
      {...presentProps}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
      dangerouslySetInnerHTML={{ __html: ICON_BODY[id] ?? '' }}
    />
  );
}

/** Section label icon — what `mountSectionIcons` prepends to a `[data-ico]` label. */
const SEC: Record<string, string> = {
  pipeline: 'sec-pipeline',
  activity: 'sec-activity',
  queue: 'sec-queue',
  poster: 'sec-poster',
  film: 'sec-film',
  note: 'sec-note',
  target: 'sec-target',
  plates: 'sec-plates',
  story: 'sec-story',
  loupe: 'sec-loupe',
  check: 'sec-check',
  chapters: 'sec-chapters',
  box: 'sec-box',
  formats: 'sec-formats',
  palette: 'sec-palette',
  logo: 'sec-logo',
  focus: 'sec-focus',
  pace: 'sec-pace',
  camera: 'sec-camera',
  motion: 'sec-motion',
};

export function SecIcon({ name }: { name: string }) {
  const id = SEC[name];
  return id ? <Icon name={id} className="sec-ico" size={14} /> : null;
}

/** Zen empty-state art, 96×64. */
export function ZenArt({ art }: { art: string }) {
  return <Icon name={`zen-${art}`} className="zen-art" width={96} height={64} />;
}
