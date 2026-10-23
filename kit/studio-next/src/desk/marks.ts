import { getMarkMode, initMarks, setMarkMode } from '@/logic/mark';

/**
 * Favicon + studio-wide mark state (`kit/studio/favicon.js`). The animation
 * engine lives in `logic/mark`; the favicon, the header logo and every spinner
 * follow the mode set here, morphing between states.
 */
export type MarkMode = 'idle' | 'loading' | 'draft' | 'render' | 'record' | 'export' | 'ok' | 'err';

export function setFaviconMode(mode: MarkMode): void {
  setMarkMode(mode);
}

export function initFavicon(): void {
  initMarks();
}

export { getMarkMode };
