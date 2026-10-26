/**
 * The plate icon set — compact 24-unit stroke icons for feature / journey cards and the
 * Inspector's icon picker (stroke inherits currentColor). One place, so a new icon lands on the
 * plates and in the picker together.
 */
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = Object.freeze({
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74"/>'),
  leave: svg('<path d="M12 3c-2.5 3-4 5.5-4 8a4 4 0 0 0 8 0c0-2.5-1.5-5-4-8z"/><path d="M8 20h8M10 20v1M14 20v1"/>'),
  chart: svg('<path d="M4 19V5M4 19h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>'),
  spark: svg('<path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3z"/>'),
  filter: svg('<path d="M4 5h16l-6 7v5l-4 2v-7L4 5z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M4.9 6.5l1.4 1.4M17.7 16.1l1.4 1.4M3 12h2M19 12h2M4.9 17.5l1.4-1.4M17.7 7.9l1.4-1.4"/>'),
  plug: svg('<path d="M9 7V3M15 7V3M8 7h8v4a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4V7z"/><path d="M12 15v6"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/>'),
  dashboard: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>'),
  export: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
  rocket: svg('<path d="M12 3c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10z"/><path d="M9 16l-3 3M15 16l3 3"/><circle cx="12" cy="10" r="1.6"/>'),
  heart: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'),
  cloud: svg('<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 3.5 3.5 0 0 1 17.5 18H7z"/>'),
  code: svg('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v12H4V8z"/><circle cx="12" cy="13" r="3.5"/>'),
  cursor: svg('<path d="M5 4l14 7-6 2-2 6L5 4z"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  trend: svg('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  wallet: svg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  play: svg('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5L10 8.5z"/>'),
});

/** Icon ids in set order — the Inspector picker and the agent prompts read this. */
export const ICON_IDS = Object.freeze(Object.keys(ICONS));
