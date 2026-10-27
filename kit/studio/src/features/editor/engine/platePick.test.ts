import { describe, expect, it } from 'vitest';

import { pickPlateEditPath } from './plate';

function box(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {
        return {};
      },
    });
}

describe('pickPlateEditPath', () => {
  it('picks the overlapping carousel card whose center is closest to the click', () => {
    document.body.setAttribute('data-layout', 'carousel');
    document.body.innerHTML = `
      <div class="cards" data-n="3">
        <div class="card" data-slot="items.0">
          <div class="label" data-edit="items.0.label">One</div>
        </div>
        <div class="card" data-slot="items.1">
          <div class="label" data-edit="items.1.label">Two</div>
        </div>
        <div class="card" data-slot="items.2">
          <div class="label" data-edit="items.2.label">Three</div>
        </div>
      </div>`;
    const cards = [...document.querySelectorAll<HTMLElement>('.card')];
    // Overlapping AABBs: click sits inside all three, closest to card 2's center.
    box(cards[0]!, { left: 0, top: 0, width: 200, height: 200 });
    box(cards[1]!, { left: 80, top: 0, width: 200, height: 200 });
    box(cards[2]!, { left: 160, top: 0, width: 200, height: 200 });
    for (const label of document.querySelectorAll<HTMLElement>('[data-edit]')) {
      box(label, { left: 0, top: 0, width: 1, height: 1 });
    }

    // event.target falsely reports card 0's label (paint order), but geometry says card 2.
    const wrong = document.querySelector('[data-edit="items.0.label"]');
    expect(pickPlateEditPath(document, 260, 100, wrong)).toBe('items.2.label');
  });
});
