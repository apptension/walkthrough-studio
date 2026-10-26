import { describe, expect, it } from 'vitest';

import { clearPlateRevealOverrides, pinLiveAnimationFrames } from './plateCss';

/**
 * Fakes a running CSS animation the way `document.getAnimations()` would report it, without
 * depending on jsdom's (missing) Web Animations API support. `keyframeProps` only needs to name
 * the properties the real animation drives — `pinLiveAnimationFrames` reads their *current* value
 * from `getComputedStyle`, not from these keyframe values.
 */
function fakeAnimation(target: Element, animationName: string, keyframeProps: Record<string, string | number>[]) {
  let cancelled = false;
  return {
    effect: { target, getKeyframes: () => keyframeProps },
    animationName,
    get cancelled() {
      return cancelled;
    },
    cancel() {
      cancelled = true;
    },
  };
}

describe('pinLiveAnimationFrames', () => {
  it('freezes a template-specific class to exactly what is currently rendered, not a guessed end state', () => {
    // `.pr-card` (pricing), `.q-card` (quote), `.tm-card` (team), `.k-tile` (kpi), `.ck-row`
    // (checklist), `.panel`/`.score` and more are not in composePlateForEdit's static selector
    // allowlist. Cancelling their Web Animation used to snap them back to the plain declared
    // style — usually `opacity: 0`. Pinning the *live* computed style instead fixes any template
    // generically and matches "edit in place what you see", whatever that currently is (here,
    // still 60% revealed — not forced to fully shown).
    document.body.innerHTML = '<div class="pr-card" style="opacity: 0.6; transform: translateY(5px)">$19/mo</div>';
    const card = document.body.querySelector('.pr-card') as HTMLElement;
    const anim = fakeAnimation(card, 'fxLand', [
      { offset: 0, opacity: '0', transform: 'translateY(24px)' },
      { offset: 1, opacity: '1', transform: 'none' },
    ]);
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [anim];

    pinLiveAnimationFrames(document);

    expect(card.style.getPropertyValue('opacity')).toBe('0.6');
    expect(card.style.getPropertyPriority('opacity')).toBe('important');
    expect(anim.cancelled).toBe(true);
  });

  it('does not let a second, property-disjoint animation on the same target clobber the first', () => {
    // `.panel` in checklist.html stacks an entrance (`fxLand`, drives opacity/transform) with a
    // decorative `sheen` sweep (drives only transform). Pinning sheen's live transform must not
    // erase the opacity fxLand already pinned on the same element.
    document.body.innerHTML = '<div class="panel" style="opacity: 1; transform: translateX(40%)"></div>';
    const panel = document.body.querySelector('.panel') as HTMLElement;
    const land = fakeAnimation(panel, 'fxLand', [
      { offset: 0, opacity: '0', transform: 'translateY(56px)' },
      { offset: 1, opacity: '1', transform: 'none' },
    ]);
    const sheen = fakeAnimation(panel, 'sheen', [
      { offset: 0, transform: 'translateX(-130%)' },
      { offset: 1, transform: 'translateX(130%)' },
    ]);
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [land, sheen];

    pinLiveAnimationFrames(document);

    expect(panel.style.getPropertyValue('opacity')).toBe('1');
    expect(panel.style.getPropertyPriority('opacity')).toBe('important');
    expect(land.cancelled).toBe(true);
    expect(sheen.cancelled).toBe(true);
  });

  it('ignores animations with no resolvable keyframe properties', () => {
    document.body.innerHTML = '<div class="empty-anim"></div>';
    const el = document.body.querySelector('.empty-anim') as HTMLElement;
    const anim = fakeAnimation(el, 'noop', []);
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [anim];

    expect(() => pinLiveAnimationFrames(document)).not.toThrow();
    expect(el.getAttribute('style')).toBeNull();
  });
});

describe('clearPlateRevealOverrides', () => {
  it('lifts every property a reveal pinned, not only the ones on the static list', () => {
    // `titleFocus` opens on `letter-spacing: 0.14em`. Pinning it is right — that is what is on
    // screen — but it was pinned `!important` and never lifted, so picking another reveal left
    // the title stretched out for good.
    document.body.innerHTML = '<h1 class="title" data-reveal="focus" style="letter-spacing: 0.1em; opacity: 0.4"></h1>';
    const title = document.body.querySelector('.title') as HTMLElement;
    const focus = fakeAnimation(title, 'titleFocus', [
      { offset: 0, opacity: '0', letterSpacing: '0.14em' },
      { offset: 1, opacity: '1' },
    ]);
    (document as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [focus];

    pinLiveAnimationFrames(document);
    expect(title.style.getPropertyValue('letter-spacing')).toBe('0.1em');
    expect(title.style.getPropertyPriority('letter-spacing')).toBe('important');

    clearPlateRevealOverrides(document);
    expect(title.style.getPropertyValue('letter-spacing')).toBe('');
    expect(title.style.getPropertyValue('opacity')).toBe('');
    expect(title.hasAttribute('data-studio-reveal')).toBe(false);
  });
});
