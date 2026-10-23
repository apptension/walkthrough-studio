/** Quiet capture line and a queue that does not stack the same step twice. */
import { icon } from '@/ui/iconString';
import { asText } from './text';

export interface QueueItem {
  slug?: string | null;
  kind?: string | null;
  step?: string | null;
  mode?: string | null;
  goal?: string | null;
  fromStep?: string | null;
}

export type QueueIconId = 'step' | 'record' | 'render' | 'ai' | 'plates' | 'produce' | 'audio' | 'deliver';

export interface QueueMenuItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
}

export interface QueueMenuGroup {
  group: string;
  items: QueueMenuItem[];
}

export interface ButtonRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface QueueMenuViewport {
  vw: number;
  vh: number;
  menuHeight?: number;
  pad?: number;
}

export interface QueueMenuRect {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

export function captureSummary(url: unknown, loginRequired: unknown): string {
  const raw = asText(url || '').trim();
  if (!raw) return 'No start URL yet';
  let shown = raw;
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    shown = `${parsed.host}${path}`;
  } catch {
    /* keep the raw value when it is not a URL yet */
  }
  return loginRequired ? `${shown} · signs in` : shown;
}

export function queueKey(item: QueueItem | null | undefined): string {
  return [
    item?.slug || '',
    item?.kind || '',
    item?.step || '',
    item?.mode || '',
    item?.goal || '',
    item?.fromStep || '',
  ].join('|');
}

/** An improve note can repeat. The same render step for the same sequence should not. */
export function shouldEnqueue(queue: (QueueItem | null | undefined)[] | null | undefined, item: QueueItem | null | undefined): boolean {
  if (!item || item.kind === 'improve') return true;
  const key = queueKey(item);
  return !(queue || []).some((queued) => queueKey(queued) === key);
}

/** Icon id used by the Add-step menu and queue rows. */
export function queueIconId(item: QueueItem | null | undefined): QueueIconId {
  if (!item) return 'step';
  if (item.kind === 'make') return item.mode === 'full' ? 'record' : 'render';
  if (item.kind === 'improve') return 'ai';
  const step = item.step || '';
  if (step === 'record') return 'record';
  if (step === 'plates') return 'plates';
  if (step === 'produce') return 'produce';
  if (step === 'audio' || step === 'voice' || step === 'music' || step === 'mix') return 'audio';
  if (step === 'deliver' || step === 'export') return 'deliver';
  return 'step';
}

/**
 * Catalog for the Add-step menu. Kept here so markup + tests share one source of truth.
 */
export function queueMenuGroups(): QueueMenuGroup[] {
  return [
    {
      group: 'Full pass',
      items: [
        {
          id: 'make-quick',
          label: 'Render sequence',
          hint: 'Plates, master, voice & music, export',
          icon: 'render',
        },
        {
          id: 'make-full',
          label: 'Re-record & render',
          hint: 'Capture the app, then the full cut',
          icon: 'record',
        },
      ],
    },
    {
      group: 'Single step',
      items: [
        { id: 'record', label: 'Record walkthrough', hint: 'Capture the live app only', icon: 'record' },
        { id: 'plates', label: 'Brand plates', hint: 'Re-render open, close & interstitials', icon: 'plates' },
        { id: 'produce', label: 'Produce master', hint: 'Assemble the silent cut', icon: 'produce' },
        { id: 'audio', label: 'Voice & music', hint: 'Narration, bed and mix', icon: 'audio' },
        { id: 'deliver', label: 'Export handoff', hint: 'Pack poster, captions, chapters', icon: 'deliver' },
      ],
    },
  ];
}

/**
 * Viewport placement for the Add-step popover (position:fixed on document.body).
 * Prefer right-align under the button; open upward when the rail sits near the bottom.
 */
export function placeQueueMenuRect(
  btnRect: ButtonRect,
  { vw, vh, menuHeight = 280, pad = 8 }: QueueMenuViewport,
): QueueMenuRect {
  const width = Math.min(272, Math.max(200, vw - pad * 2));
  let left = btnRect.right - width;
  if (left < pad) left = btnRect.left;
  left = Math.max(pad, Math.min(left, vw - width - pad));

  const gap = 6;
  const spaceBelow = Math.max(0, vh - btnRect.bottom - pad);
  const spaceAbove = Math.max(0, btnRect.top - pad);
  const wantH = Math.min(Math.max(menuHeight, 160), 400);
  // Queue sits low in the left rail — prefer opening up whenever below is tight.
  const openUp = spaceAbove > 160 && (spaceBelow < wantH + gap || spaceAbove > spaceBelow + 40);
  const maxHeight = Math.max(120, Math.min(400, openUp ? spaceAbove - gap : Math.max(spaceBelow - gap, 140)));
  const height = Math.min(wantH, maxHeight);
  let top = openUp ? btnRect.top - height - gap : btnRect.bottom + gap;
  top = Math.max(pad, Math.min(top, vh - height - pad));

  return { top, left, width, maxHeight, openUp };
}

const QUEUE_ICON: Partial<Record<string, string>> = {
  render: 'queue-render',
  record: 'queue-record',
  plates: 'queue-plates',
  produce: 'queue-produce',
  audio: 'queue-audio',
  deliver: 'queue-deliver',
  ai: 'queue-ai',
};

/** Tiny SVGs for queue UI (menu + list) — sourced from icons/ui. */
export function queueIconSvg(id: string): string {
  return icon(QUEUE_ICON[id] || 'queue-default', { size: 16 });
}
