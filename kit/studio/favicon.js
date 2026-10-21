/**
 * Favicon + studio-wide mark state. The animation engine lives in mark.js; the favicon, the header
 * logo and every spinner follow the mode set here, morphing between states.
 */
import { getMarkMode, initMarks, setMarkMode } from './mark.js';

/**
 * @param {'idle'|'loading'|'draft'|'render'|'record'|'export'|'ok'|'err'} mode
 */
export function setFaviconMode(mode) {
  setMarkMode(mode);
}

export function initFavicon() {
  initMarks();
}

export { getMarkMode };
