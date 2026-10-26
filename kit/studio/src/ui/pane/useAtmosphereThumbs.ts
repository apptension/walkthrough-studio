import { useEffect, useState } from 'react';

import { paintAtmosphereThumbs, type ThumbPalette } from '@/ui/look/atmosphereThumbs';

/**
 * Whether `el` and every ancestor are shown. The right-panel crossfade flips `hidden` on the
 * DOM directly, so this watches the attribute instead of trusting a prop.
 */
export function useShown(el: HTMLElement | null): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!el) {
      setShown(false);
      return;
    }
    const check = () => setShown(!el.closest('[hidden]'));
    check();
    const mo = new MutationObserver(check);
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      mo.observe(node, { attributes: true, attributeFilter: ['hidden'] });
    }
    return () => mo.disconnect();
  }, [el]);
  return shown;
}

/**
 * Paint the real atmosphere shaders into every `canvas[data-atm]` under the returned callback
 * ref, in `palette`, once the host is on screen. A callback ref because the host can mount
 * after the section does (the catalogue loads late). `key` names the catalogue so a new list
 * repaints.
 */
export function useAtmosphereThumbs(palette: ThumbPalette, key: string): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const shown = useShown(el);
  const { ink, surface, gold, amber, teal } = palette;
  useEffect(() => {
    if (!shown || !el) return;
    paintAtmosphereThumbs(el, { ink, surface, gold, amber, teal });
  }, [el, shown, key, ink, surface, gold, amber, teal]);
  return setEl;
}
