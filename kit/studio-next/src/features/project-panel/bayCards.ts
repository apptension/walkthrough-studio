import { create } from 'zustand';

import type { BayBridge } from '@/desk/bridge';
import { api, enc } from '@/desk/api';

import { rememberTakeChoice, type GuidedTour, type TakeChoice } from '@/logic/takeChoice';

/**
 * The Render bay's guided-take cards: what `bayGuide` (`createGuideCard`) and
 * `bayTake` (`createTakeChoice`) held in `kit/studio/app.js`. `GuideCard` and
 * `TakeChoiceCard` render from this store; `bayBridge` is what the make
 * pipeline calls through `bridges.bay`.
 */

interface BayCardsState {
  /** The sequence the guide card follows, or null when hidden. */
  guideSlug: string | null;
  /** Bumps on every `show()` so the card starts from a clean slate. */
  guideGen: number;
  take: { slug: string; tour: GuidedTour | null } | null;
}

export const useBayCards = create<BayCardsState>()(() => ({ guideSlug: null, guideGen: 0, take: null }));

interface Settle {
  resolve: (choice: TakeChoice) => void;
  reject: (err: Error) => void;
}

let settle: Settle | null = null;

export function showGuide(slug: string): void {
  useBayCards.setState((s) => ({ guideSlug: slug, guideGen: s.guideGen + 1 }));
}

export function hideGuide(): void {
  useBayCards.setState({ guideSlug: null });
}

export function hideTake(): void {
  useBayCards.setState({ take: null });
}

/** Ask which take to use. Rejects with a cancel error when `signal` aborts. */
export async function askTake(slug: string, { signal }: { signal?: AbortSignal | undefined } = {}): Promise<TakeChoice> {
  const r = await api<{ tour?: GuidedTour | null }>(`/api/video/${enc(slug)}/guide`).catch(() => null);
  useBayCards.setState({ take: { slug, tour: r?.tour || null } });
  return new Promise<TakeChoice>((resolve, reject) => {
    settle = { resolve, reject };
    signal?.addEventListener(
      'abort',
      () => {
        if (!settle) return;
        settle = null;
        hideTake();
        reject(new Error('cancelled'));
      },
      { once: true },
    );
  });
}

/** A click on one of the take options (or Record again). */
export function chooseTake(choice: TakeChoice): void {
  if (!settle) return;
  const slug = useBayCards.getState().take?.slug ?? null;
  rememberTakeChoice(slug, choice);
  const done = settle;
  settle = null;
  hideTake();
  done.resolve(choice);
}

export const bayBridge: BayBridge = { showGuide, hideGuide, askTake };

export function resetBayCards(): void {
  settle = null;
  useBayCards.setState({ guideSlug: null, guideGen: 0, take: null });
}
