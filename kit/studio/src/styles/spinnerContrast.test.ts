import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function contrast(hexA: string, hexB: string) {
  const channel = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  };
  const lum = (hex: string) => {
    const channels = channel(hex);
    const r = channels[0] ?? 0;
    const g = channels[1] ?? 0;
    const b = channels[2] ?? 0;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(lum(hexA), lum(hexB));
  const darker = Math.min(lum(hexA), lum(hexB));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('spinner contrast', () => {
  it('a brand-gradient spinner uses dark ink and stays visible on both ends', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/studio.css'), 'utf8');
    expect(css).toMatch(
      /\.btn\.primary\.busy::after,\s*\.btn\.primary\.busy:hover::after,\s*\.render-cta\.primary\.busy::after/,
    );
    expect(css).toMatch(/border-top-color:\s*var\(--on-accent\)/);
    expect(css).toMatch(/\.btn\.busy::after, button\.busy::after \{[\s\S]*?border-top-color:\s*#fff/);
    expect(css.includes('--on-accent: #0a0a0a')).toBe(true);
    expect(contrast('#0a0a0a', '#fffe25')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#0a0a0a', '#42f272')).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.render-cta\.primary\.busy \{ opacity: 1; \}/);
  });
});
