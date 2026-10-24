import { useLayoutEffect, useRef } from 'react';

import { useWizard } from './wizard';

/**
 * A plate tile's frozen still in the chosen brand (`paintPlateStills`). The
 * img is driven imperatively, as legacy did, so a fade-in class and the one
 * retry after a cold render survive re-renders.
 */
export function PlateStill({ type, brand: forBrand, rev }: { type: string; brand?: string; rev?: string | number }) {
  const picked = useWizard((s) => s.stillBrand);
  const brand = forBrand ?? picked;
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    if (!img) return;
    const src = brand ? `/api/plate-stills/${encodeURIComponent(brand)}/${encodeURIComponent(type)}.jpg${rev != null ? `?v=${encodeURIComponent(rev)}` : ''}` : '';
    if (img.getAttribute('src') === src) return;
    img.classList.remove('is-in');
    if (!src) {
      img.removeAttribute('src');
      return;
    }
    img.loading = 'eager';
    img.decoding = 'async';
    img.onload = () => img.classList.add('is-in');
    img.onerror = () => {
      img.classList.remove('is-in');
      if (!img.dataset.retried) {
        img.dataset.retried = '1';
        setTimeout(() => {
          img.src = `${src}${src.includes('?') ? '&' : '?'}r=${Date.now()}`;
        }, 900);
      }
    };
    img.src = src;
  }, [brand, type, rev]);

  return <img ref={ref} alt="" decoding="async" />;
}
