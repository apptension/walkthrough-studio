import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function contrast(hexA, hexB) {
  const channel = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  };
  const lum = (hex) => {
    const [r, g, b] = channel(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(lum(hexA), lum(hexB));
  const darker = Math.min(lum(hexA), lum(hexB));
  return (lighter + 0.05) / (darker + 0.05);
}

test('a brand-gradient spinner uses dark ink and stays visible on both ends', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.btn\.primary\.busy::after,\s*\.btn\.primary\.busy:hover::after,\s*\.render-cta\.primary\.busy::after/);
  assert.match(css, /border-top-color:\s*var\(--on-accent\)/);
  assert.match(css, /\.btn\.busy::after, button\.busy::after \{[\s\S]*?border-top-color:\s*#fff/);
  assert.equal(css.includes('--on-accent: #0a0a0a'), true);
  assert.ok(contrast('#0a0a0a', '#fffe25') >= 4.5);
  assert.ok(contrast('#0a0a0a', '#42f272') >= 4.5);
  assert.match(css, /\.render-cta\.primary\.busy \{ opacity: 1; \}/);
});
