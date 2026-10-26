import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';
import { server } from '@/test/msw/server';
import { neonFxHtml } from '@/ui/neonFx';

import { regenerateLine } from './audio';
import { wireInspector } from './inspectorWire';
import { resetEdForTests, ed } from './state';
import type { VoiceClip } from './types';

function mountRegen(label = 'Regenerate'): HTMLButtonElement {
  const root = document.createElement('div');
  root.id = 'inspectorRoot';
  root.innerHTML = `
    <textarea data-voice-text>Hello there</textarea>
    <button type="button" class="ins-btn primary" data-act="voice-regen">${neonFxHtml()}<span>${label}</span></button>
  `;
  document.body.append(root);
  return root.querySelector('button')!;
}

const clip = {
  key: 'line-1',
  text: 'Hello',
  written: 'Hello',
  speed: 1,
  dur: 1,
  full: 1,
  start: 0,
  writtenStart: 0,
  trimStart: 0,
  trimEnd: 0,
} as VoiceClip;

beforeEach(() => {
  desk.reset();
  resetEdForTests();
  desk.set({ slug: 'demo' });
  ed.deck = { audio: { voiceClips: [clip] } };
  ed.sel = { type: 'voice', key: 'line-1' };
});

afterEach(() => {
  document.getElementById('inspectorRoot')?.remove();
});

describe('voice regenerate button', () => {
  it('writes Speaking on the label and leaves the neon layer in place', async () => {
    server.use(http.post('/api/video/:slug/voice/line', () => HttpResponse.json({ error: 'no' }, { status: 500 })));
    const btn = mountRegen();

    await regenerateLine('line-1', { newTake: true });

    expect(btn.querySelector('.neon-btn__water')).not.toBeNull();
    expect(btn.querySelector(':scope > span:not(.neon-btn__fx)')).toHaveTextContent('Speaking…');
    expect(btn.querySelector('.neon-btn__fx')?.textContent ?? '').not.toMatch(/Speaking/);
    expect(btn.textContent).not.toMatch(/Regenerate/);
  });

  it('rewrites the label when the line is dirty, not the neon layer', () => {
    const btn = mountRegen();
    wireInspector();

    document.querySelector('[data-voice-text]')!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(btn.querySelector('.neon-btn__water')).not.toBeNull();
    expect(btn.querySelector(':scope > span:not(.neon-btn__fx)')).toHaveTextContent('Regenerate with changes');
    expect(btn.querySelector('.neon-btn__fx')?.textContent ?? '').not.toMatch(/Regenerate/);
  });
});
