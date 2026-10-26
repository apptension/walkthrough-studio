import { describe, expect, it } from 'vitest';

import { retargetTitleReveal } from './plate';

/**
 * `plates.css` guards every host reveal with `:not(:has(.char, .mask, .line-wipe, .title-cascade))`,
 * so a title still wearing the previous family's markup keeps playing the previous reveal no
 * matter what `data-reveal` says. These cover the hand-off the editor does before the server
 * rebuild lands.
 */
const titleHtml = (reveal: string, inner: string) =>
  `<h1 class="title" data-reveal="${reveal}" data-edit="title" data-edit-raw="Read the *feedback*">${inner}</h1>`;

const CASCADE = '<span class="cw"><span class="char" style="--c: 0">R</span><span class="char accent" style="--c: 1">e</span></span>';

describe('retargetTitleReveal', () => {
  it('sheds the previous family\u2019s markup so the new reveal is not blocked by the :has() guard', () => {
    document.body.innerHTML = titleHtml('cascade', CASCADE);
    const title = document.body.querySelector('.title') as HTMLElement;

    retargetTitleReveal(document, 'focus');

    expect(title.dataset['reveal']).toBe('focus');
    expect(title.querySelector('.char')).toBeNull();
    expect(title.querySelector('.cw')).toBeNull();
    expect(title.textContent).toBe('Read the feedback');
  });

  it('clears host properties the previous reveal left behind, spread included', () => {
    document.body.innerHTML = titleHtml('focus', 'Read the feedback');
    const title = document.body.querySelector('.title') as HTMLElement;
    title.style.setProperty('letter-spacing', '0.14em', 'important');
    title.style.setProperty('filter', 'blur(18px)');

    retargetTitleReveal(document, 'rise');

    expect(title.style.getPropertyValue('letter-spacing')).toBe('');
    expect(title.style.getPropertyValue('filter')).toBe('');
    expect(title.dataset['reveal']).toBe('rise');
  });

  it('leaves a title that is already on the reveal alone', () => {
    document.body.innerHTML = titleHtml('cascade', CASCADE);
    const title = document.body.querySelector('.title') as HTMLElement;

    retargetTitleReveal(document, 'cascade');

    expect(title.querySelector('.char')).not.toBeNull();
  });

  it('keeps baked markup when the title carries no raw copy to rebuild from', () => {
    document.body.innerHTML = '<h1 class="title" data-reveal="cascade">' + CASCADE + '</h1>';
    const title = document.body.querySelector('.title') as HTMLElement;

    retargetTitleReveal(document, 'focus');

    expect(title.dataset['reveal']).toBe('focus');
    expect(title.querySelector('.char')).not.toBeNull();
  });
});
