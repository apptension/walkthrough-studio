/** Paint a meter track up to its value (`--sp-fill`), so every Scrubber reads the same. */
export function paintRange(input: HTMLInputElement | null | undefined): void {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--sp-fill', `${Math.min(100, Math.max(0, pct)).toFixed(1)}%`);
}

/** Stamp the shared meter class and fill onto every range inside a freshly rendered panel. */
export function paintRanges(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) => {
    el.classList.add('sp-range');
    paintRange(el);
  });
}
