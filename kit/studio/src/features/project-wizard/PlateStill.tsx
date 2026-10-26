import { useLayoutEffect, useRef } from 'react';

import { useWizard } from './wizard';

/**
 * A frozen plate still. The img is driven imperatively, as legacy did, so a fade-in class and
 * the one retry after a cold render survive re-renders.
 */
function Still({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);

  useLayoutEffect(() => {
    const img = ref.current;
    if (!img) return;
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
  }, [src]);

  return <img ref={ref} alt="" decoding="async" />;
}

/** A plate type's still in a brand pack, on sample copy (`plateStill`). */
export function PlateStill({ type, brand: forBrand, rev }: { type: string; brand?: string; rev?: string | number }) {
  const picked = useWizard((s) => s.stillBrand);
  const brand = forBrand ?? picked;
  const src = brand
    ? `/api/plate-stills/${encodeURIComponent(brand)}/${encodeURIComponent(type)}.jpg${rev != null ? `?v=${encodeURIComponent(rev)}` : ''}`
    : '';
  return <Still src={src} />;
}

/**
 * This video's own plate, built from its config (`videoPlateStill`) — the frame the encode
 * produces, not a sample. `rev` should change with the plate's copy so a rewrite re-fetches.
 */
export function VideoPlateStill({ slug, plateId, rev }: { slug: string; plateId: string; rev?: string | number }) {
  const src = slug
    ? `/api/video/${encodeURIComponent(slug)}/still/${encodeURIComponent(plateId)}.jpg${rev != null ? `?v=${encodeURIComponent(rev)}` : ''}`
    : '';
  return <Still src={src} />;
}
