import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** A number that eases from its last value to the new one. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || reduced() || typeof requestAnimationFrame !== 'function') {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - k) ** 3;
      const v = Math.round(start + (value - start) * eased);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** Reveals text a few characters at a time, restarting when it changes. */
export function useTypewriter(text: string, cps = 70): string {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (!text || reduced() || typeof requestAnimationFrame !== 'function') {
      setN(text.length);
      return;
    }
    setN(0);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(text.length, Math.ceil(((now - t0) / 1000) * cps));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, cps]);
  return text.slice(0, n);
}
