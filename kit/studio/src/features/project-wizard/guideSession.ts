import { create } from 'zustand';

/** `createGuideCard($('wizardGuide'))` — which guided session the wizard's card follows. */
export const useWizardGuide = create<{ slug: string | null; gen: number }>()(() => ({ slug: null, gen: 0 }));

export function showWizardGuide(slug: string): void {
  useWizardGuide.setState((s) => ({ slug, gen: s.gen + 1 }));
}

export function hideWizardGuide(): void {
  useWizardGuide.setState({ slug: null });
}
