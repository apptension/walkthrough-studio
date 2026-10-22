#!/usr/bin/env node
/**
 * One-shot seed of icon SVG files from the studio's previous inline definitions.
 * Safe to re-run (overwrites). After seeding, run build.mjs.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const stroke24 = (body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>\n`;
const fill24 = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>\n`;
const stroke2 = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;

function write(rel, content) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log('  +', rel);
}

// —— Editor / timeline UI (stroke 1.8) ——
const UI = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  plate: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
  open: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  close: '<path d="M4 6h16M4 12h10M4 18h7"/><path d="m17 15 2 2 4-4"/>',
  speed: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15 16 9"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3M11 8.5v5M8.5 11h5"/>',
  transition: '<rect x="3" y="6" width="11" height="11" rx="1.5"/><rect x="10" y="9" width="11" height="11" rx="1.5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 9 9 0 0 0-9-9z"/><circle cx="7.5" cy="12" r="1.2" fill="currentColor"/><circle cx="10" cy="7.5" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>',
  motion: '<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>',
  depth: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  lockup: '<rect x="4" y="5" width="16" height="10" rx="2"/><path d="M8 19h8"/>',
  cursor: '<path d="M5 3 19 11l-6 2-3 6L5 3z"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 6"/><path d="M4 4v6h6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="m10.5 9 4.5 3-4.5 3z" fill="currentColor" stroke="none"/>',
  'to-start': '<path d="M6 5v14"/><path d="M18 6v12l-9-6z" fill="currentColor" stroke="none"/>',
  loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  render: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"/>',
  keep: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 12 3 3 5-6"/>',
  'no-zoom': '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3M8.5 11h5"/><path d="M4 4l16 16"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  warn: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  slow: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="M12 15 8 9"/><circle cx="12" cy="15" r="1.4" fill="currentColor"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8"/>',
  upload: '<path d="M12 16V5"/><path d="m8 9 4-4 4 4"/><path d="M5 19h14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>',
  music: '<path d="M9 18V6l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  lens: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9"/><path d="M7.4 9.2a3.4 3.4 0 0 1 2.4-2.3"/>',
  'lens-off': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9"/><path d="M4 4l16 16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  branch:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.2 7.5 10.5 15M15.8 7.5 13.5 15"/>',
  download: '<path d="M12 4v12"/><path d="M8 12l4 4 4-4"/><path d="M5 20h14"/>',
  sound:
    '<path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/>',
  chapters: '<path d="M4 5h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M8 9h6M8 13h4"/>',
  book: '<path d="M4 5h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2z"/><path d="M8 9h6M8 13h4"/>',
  history:
    '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
  pencil:
    '<path fill="currentColor" stroke="none" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  bulb:
    '<path fill="currentColor" stroke="none" d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7zm-2 18h4v2h-4v-2z"/>',
  walk:
    '<path fill="currentColor" stroke="none" d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z"/>',
  'skip-back':
    '<path fill="currentColor" stroke="none" d="M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z"/>',
  'skip-fwd':
    '<path fill="currentColor" stroke="none" d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>',
  volume:
    '<path fill="currentColor" stroke="none" d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>',
  mute: '<path fill="currentColor" stroke="none" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v4h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>',
  'fullscreen-fill':
    '<path fill="currentColor" stroke="none" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>',
  'play-fill': '<path fill="currentColor" stroke="none" d="M8 5v14l11-7z"/>',
  'pause-fill': '<path fill="currentColor" stroke="none" d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  'plus-fill': '<path fill="currentColor" stroke="none" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  'download-fill':
    '<path fill="currentColor" stroke="none" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/>',
  list: '<path d="M4 7h16M4 12h10M4 17h7"/><path d="M16 14l4 3-4 3v-6z"/>',
  queue: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  pipeline: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/>',
  poster: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/>',
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  'target-sec': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  story: '<path d="M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14"/><path d="M4 19a2 2 0 0 0 2 2h14"/><path d="M8 7h8M8 11h5"/>',
  loupe: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  'check-box': '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  bookmark: '<path d="M6 4h12a1 1 0 0 1 1 1v16l-7-4-7 4V5a1 1 0 0 1 1-1z"/>',
  box: '<path d="M21 8l-9-4-9 4 9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  formats:
    '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'palette-sec':
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 10c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="16" cy="8" r="1"/>',
  logo: '<circle cx="12" cy="12" r="9"/><path d="M8 15l4-7 4 7"/><path d="M9.5 12.5h5"/>',
  focus:
    '<circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>',
  pace: '<path d="M12 12l4-4"/><path d="M4 14a8 8 0 1 1 16 0"/><path d="M4 14h2M18 14h2"/>',
  camera: '<path d="M15 10l5-3v10l-5-3"/><rect x="3" y="6" width="12" height="12" rx="2"/>',
  'motion-sec': '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/><path d="M3 6v12" opacity=".5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/>',
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9"/><path d="M12 17h.01"/>',
  'warn-tri':
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  record:
    '<circle cx="12" cy="12" r="6" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.35"/>',
  'plates-queue': '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M9 5v14"/>',
  'produce-queue': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 10l4 2.5L8 15V10z"/>',
  'audio-queue':
    '<path d="M12 4v10"/><path d="M8 9v5M16 7v7"/><circle cx="12" cy="17" r="2.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/>',
  'pip-done':
    '<path fill="currentColor" stroke="none" d="M9.6 16.7 5.4 12.5l1.4-1.4 2.8 2.8 7-7.1 1.4 1.4-8.4 8.5z"/>',
  'pip-fail':
    '<path fill="currentColor" stroke="none" d="M7.1 6 6 7.1 10.9 12 6 16.9 7.1 18 12 13.1 16.9 18 18 16.9 13.1 12 18 7.1 16.9 6 12 10.9 7.1 6z"/>',
  'pip-run':
    '<circle class="pip-track" cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><circle class="pip-arc" cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="14 43" transform="rotate(-90 12 12)"/>',
  'pip-todo': '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  'step-record': '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
  'step-plates':
    '<path fill="currentColor" stroke="none" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/>',
  'step-produce':
    '<path fill="currentColor" stroke="none" d="M4 6h16v12H4V6zm2 2v8h12V8H6z"/>',
  'step-audio':
    '<path fill="currentColor" stroke="none" d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>',
  'step-deliver':
    '<path fill="currentColor" stroke="none" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/>',
  compare:
    '<path fill="currentColor" stroke="none" d="M10 3H3v18h7V3zm2 0v18h7V3h-7zM8 7v2H5V7h3zm0 4v2H5v-2h3zm0 4v2H5v-2h3zm11-8v2h-3V7h3zm0 4v2h-3v-2h3zm0 4v2h-3v-2h3z"/>',
  restore:
    '<path fill="currentColor" stroke="none" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>',
  preview:
    '<path fill="currentColor" stroke="none" d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
  // transitions
  'tr-directed':
    '<path d="m4 20 10-10"/><path d="m15 3 1.2 2.8L19 7l-2.8 1.2L15 11l-1.2-2.8L11 7l2.8-1.2z"/>',
  'tr-dissolve':
    '<rect x="3" y="5" width="12" height="12" rx="2"/><rect x="9" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".35"/>',
  'tr-wipe':
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7z" fill="currentColor" fill-opacity=".4" stroke="none"/><path d="M12 5v14"/>',
  'tr-push':
    '<rect x="2" y="6" width="9" height="12" rx="1.5"/><rect x="13" y="6" width="9" height="12" rx="1.5" fill="currentColor" fill-opacity=".4"/>',
  'tr-zoom':
    '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="8" y="8.5" width="8" height="7" rx="1" fill="currentColor" fill-opacity=".4"/>',
  'tr-iris':
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4.5" fill="currentColor" fill-opacity=".4"/>',
  'tr-blur':
    '<path d="M4 8c2-2 4 2 6 0s4-2 6 0 4 2 4 2M4 13c2-2 4 2 6 0s4-2 6 0 4 2 4 2M4 18c2-2 4 2 6 0s4-2 6 0"/>',
  'tr-dip':
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 12h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" stroke="none"/>',
  'tr-radial':
    '<circle cx="12" cy="12" r="8"/><path d="M12 12V4a8 8 0 0 1 8 8z" fill="currentColor" fill-opacity=".4"/>',
  'tr-slice':
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.7h18M3 14.3h18"/><path d="M3 9.7h11v4.6H3z" fill="currentColor" fill-opacity=".4" stroke="none"/>',
  'tr-diagonal':
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 5h18L3 19z" fill="currentColor" fill-opacity=".35" stroke="none"/>',
};

const fillNames = new Set([
  'pencil', 'bulb', 'walk', 'skip-back', 'skip-fwd', 'volume', 'mute', 'fullscreen-fill',
  'play-fill', 'pause-fill', 'plus-fill', 'download-fill', 'compare', 'restore', 'preview',
  'step-record', 'step-plates', 'step-produce', 'step-audio', 'step-deliver', 'pip-done', 'pip-fail',
  'pip-todo', 'pip-run', 'record',
]);
const secNames = new Set([
  'pipeline', 'activity', 'queue', 'poster', 'note', 'target-sec', 'story', 'loupe', 'check-box',
  'bookmark', 'box', 'formats', 'palette-sec', 'logo', 'focus', 'pace', 'camera', 'motion-sec',
  'tag', 'ask', 'warn-tri', 'grid', 'settings', 'branch',
]);
for (const [name, body] of Object.entries(UI)) {
  let svg;
  if (fillNames.has(name)) svg = fill24(body);
  else if (secNames.has(name)) svg = stroke2(body);
  else svg = stroke24(body);
  write(`ui/${name}.svg`, svg);
}

// —— Focus glyphs (read from index.html via extraction below) ——
const html = readFileSync(join(ROOT, '../index.html'), 'utf8');
const focusBlocks = [
  ['guided', /data-focus="guided"[\s\S]*?<svg viewBox="0 0 44 34" fill="none">([\s\S]*?)<\/svg>/],
  ['spotlight', /data-focus="spotlight"[\s\S]*?<svg viewBox="0 0 44 34" fill="none">([\s\S]*?)<\/svg>/],
  ['ring', /data-focus="ring"[\s\S]*?<svg viewBox="0 0 44 34" fill="none">([\s\S]*?)<\/svg>/],
];
for (const [name, re] of focusBlocks) {
  const m = html.match(re);
  if (!m) throw new Error(`focus ${name} not found`);
  write(
    `focus/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 34" fill="none">${m[1].trim()}</svg>\n`
  );
}

// —— Empty-state program icons ——
const emptyBlocks = [
  ['play', /data-icon="play"[\s\S]*?<svg viewBox="0 0 64 64" fill="none">([\s\S]*?)<\/svg>/],
  ['stale', /data-icon="stale"[\s\S]*?<svg viewBox="0 0 64 64" fill="none">([\s\S]*?)<\/svg>/],
  ['capture', /data-icon="capture"[\s\S]*?<svg viewBox="0 0 64 64" fill="none">([\s\S]*?)<\/svg>/],
];
for (const [name, re] of emptyBlocks) {
  const m = html.match(re);
  if (!m) throw new Error(`empty ${name} not found`);
  write(
    `empty/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${m[1].trim()}</svg>\n`
  );
}

// —— Agent logos ——
const agentBlocks = [
  ['cursor', /data-agent="cursor"[\s\S]*?<svg class="agent-logo"[^>]*>([\s\S]*?)<\/svg>/],
  ['claude', /data-agent="claude"[\s\S]*?<svg class="agent-logo"[^>]*>([\s\S]*?)<\/svg>/],
];
for (const [name, re] of agentBlocks) {
  const m = html.match(re);
  if (!m) throw new Error(`agent ${name} not found`);
  write(
    `agents/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${m[1].trim()}</svg>\n`
  );
}

// —— Zen art ——
const ZEN = {
  tumbleweed: `<path class="z-ground" d="M4 55h88" stroke-dasharray="2 6"/>
     <g class="z-weed">
       <circle cx="48" cy="38" r="14"/>
       <path d="M38 29c7 3 13 11 10 19M58 29c-7 3-13 11-10 19M35 42c8-7 18-7 26 0M41 25c3 9 3 17-1 26M55 25c-3 9-3 17 1 26M34 36h28" opacity=".65"/>
     </g>
     <g class="z-dust">
       <circle cx="24" cy="51" r="1.1" fill="currentColor" stroke="none"/>
       <circle cx="18" cy="47" r=".8" fill="currentColor" stroke="none"/>
       <circle cx="29" cy="46" r=".7" fill="currentColor" stroke="none"/>
     </g>`,
  sleep: `<rect x="30" y="26" width="36" height="26" rx="8"/>
     <path d="M39 39h7M50 39h7"/>
     <path d="M48 26v-6"/><circle cx="48" cy="17" r="2.2"/>
     <path d="M40 52v4M56 52v4"/>
     <g class="z-zz" fill="currentColor" stroke="none" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-weight="800">
       <text x="68" y="30" font-size="8">z</text>
       <text x="74" y="22" font-size="10">z</text>
       <text x="82" y="13" font-size="12">z</text>
     </g>`,
  clapper: `<rect x="22" y="29" width="52" height="25" rx="4"/>
     <path d="M30 41h14M30 47h22" opacity=".55"/>
     <g class="z-flap">
       <path d="M22 29h52l-4-11H18z"/>
       <path d="M31 18l5 11M44 18l5 11M57 18l5 11" opacity=".7"/>
     </g>`,
  frame: `<rect x="18" y="14" width="60" height="40" rx="5"/>
     <path d="M18 48l16-14 12 10 8-6 24 14" />
     <circle class="z-sun" cx="62" cy="27" r="5"/>`,
  loupe: `<g class="z-loupe">
       <circle cx="44" cy="30" r="15"/>
       <path d="M55 41l16 16"/>
       <path d="M36 27a9 9 0 0 1 8-6" opacity=".55"/>
     </g>`,
  checklist: `<rect x="24" y="12" width="48" height="42" rx="6"/>
     <g class="z-tick"><rect x="31" y="20" width="8" height="8" rx="2"/><path d="M33 24l2 2 4-4"/></g>
     <g class="z-tick"><rect x="31" y="32" width="8" height="8" rx="2"/><path d="M33 36l2 2 4-4"/></g>
     <g class="z-tick"><rect x="31" y="44" width="8" height="8" rx="2"/><path d="M33 48l2 2 4-4"/></g>
     <path d="M44 24h20M44 36h16M44 48h12" opacity=".55"/>`,
  box: `<path d="M24 30h48v24H24z"/>
     <g class="z-lid"><path d="M24 30l-6-10h60l-6 10"/></g>
     <path d="M48 30v24M40 42h16" opacity=".55"/>`,
  pointer: `<rect x="16" y="22" width="48" height="20" rx="5"/>
     <path d="M26 22v20M36 22v20M46 22v20" opacity=".45"/>
     <g class="z-pointer"><path d="M56 30l16 7-7 2-2 7z" fill="currentColor" fill-opacity=".18"/></g>`,
  film: `<rect x="16" y="20" width="64" height="24" rx="4"/>
     <path d="M16 26h64M16 38h64" opacity=".5"/>
     <path d="M24 20v6M34 20v6M44 20v6M54 20v6M64 20v6M74 20v6M24 38v6M34 38v6M44 38v6M54 38v6M64 38v6M74 38v6" opacity=".5"/>
     <g class="z-reel"><circle cx="48" cy="32" r="3"/></g>`,
  dashes: `<g class="z-dash"><path d="M28 24h40" opacity=".3"/><path d="M28 32h28" opacity=".5"/><path d="M28 40h34" opacity=".3"/></g>`,
};

for (const [name, body] of Object.entries(ZEN)) {
  write(
    `zen/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`
  );
}

console.log('seeded. run: node icons/build.mjs');
