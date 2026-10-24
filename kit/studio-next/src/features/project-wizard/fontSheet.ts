import { useEffect } from 'react';

/** Loads a brand's web font once per stylesheet URL so previews render in it. */
export function useFontStylesheet(css: string | undefined): void {
  useEffect(() => {
    if (!css || !/^https:\/\//.test(css)) return;
    if ([...document.querySelectorAll<HTMLLinkElement>('link[data-brand-font]')].some((l) => l.href === css)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = css;
    link.dataset.brandFont = '';
    document.head.appendChild(link);
  }, [css]);
}
