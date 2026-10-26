import { create } from 'zustand';

/** Editor chrome state that React renders but the desk store does not share. */

export interface AccentValues {
  atmosphere: string;
  titleReveal: string;
  depth: string;
  energy: string;
  sheen: string;
}

export interface AccentOptions {
  atmospheres: string[];
  atmosphereLabels: Record<string, string>;
  titleReveals: string[];
  titleRevealLabels: Record<string, string>;
  depths: string[];
  energies: string[];
}

export interface EditorChrome {
  /** `updatePlateEditChrome` ran once: `#plateEditHint` leaves its page-load copy. */
  editChromePainted: boolean;
  /** `#plateAccentPop` open (`togglePlateAccent`). */
  accentOpen: boolean;
  accentOptions: AccentOptions;
  accentValues: AccentValues;
  /** Motion keys this plate overrides (`renderAccentState(keys)`). */
  accentKeys: string[];
}

export const EMPTY_ACCENT: AccentValues = { atmosphere: '', titleReveal: '', depth: '', energy: '', sheen: '' };

export function initialChrome(): EditorChrome {
  return {
    editChromePainted: false,
    accentOpen: false,
    accentOptions: { atmospheres: [], atmosphereLabels: {}, titleReveals: [], titleRevealLabels: {}, depths: [], energies: [] },
    accentValues: EMPTY_ACCENT,
    accentKeys: [],
  };
}

export const useEditorChrome = create<EditorChrome>()(() => initialChrome());

export const chrome = {
  get: useEditorChrome.getState,
  set: (patch: Partial<EditorChrome>) => useEditorChrome.setState(patch),
  reset: () => useEditorChrome.setState(initialChrome(), true),
};

const ACCENT_KEYS = ['atmosphere', 'titleReveal', 'depth', 'sheen', 'energy'];

/** Overrides counted by `renderAccentState`. */
export const accentOverrideCount = (keys: string[]): number => keys.filter((k) => ACCENT_KEYS.includes(k)).length;
