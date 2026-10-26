import assert from 'node:assert/strict';

import { afterEach, describe, test, vi } from 'vitest';

import type * as Selects from './selects';

async function loadWithSupport(supported: boolean): Promise<typeof Selects> {
  vi.resetModules();
  vi.stubGlobal('CSS', { supports: (prop: string, value: string) => supported && prop === 'appearance' && value === 'base-select' });
  return import('./selects');
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.classList.remove('has-custom-select');
});

describe('selects', () => {
  // Runs first: observers from an enhanced module instance would pick the select up.
  test('without base-select support selects are left alone', async () => {
    document.body.innerHTML = '<select id="u"><option>C</option></select>';
    const { initSelects } = await loadWithSupport(false);
    initSelects();
    assert.equal(document.querySelector('#u .sel-trigger'), null);
    assert.ok(!document.documentElement.classList.contains('has-custom-select'));
  });

  test('enhance adds a trigger and a search field where base-select is supported', async () => {
    document.body.innerHTML = '<select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>';
    const { initSelects } = await loadWithSupport(true);
    initSelects();
    const select = document.getElementById('s') as HTMLSelectElement;
    assert.ok(document.documentElement.classList.contains('has-custom-select'));
    assert.equal(select.firstElementChild?.className, 'sel-trigger');
    assert.ok(select.querySelector('.sel-trigger selectedcontent'));
    assert.ok(select.querySelector(':scope > .sel-search'));
    assert.equal(select.querySelector('.sel-search')?.previousElementSibling?.className, 'sel-trigger');
    assert.equal(select.querySelector('.sel-empty')?.textContent, 'No matches');
  });

  test('typing in the search filters options and shows the empty note', async () => {
    document.body.innerHTML = '<select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>';
    const { initSelects } = await loadWithSupport(true);
    initSelects();
    const select = document.getElementById('s') as HTMLSelectElement;
    const input = select.querySelector<HTMLInputElement>('.sel-search')!;
    input.value = 'bet';
    input.dispatchEvent(new Event('input'));
    assert.deepEqual([...select.options].map((o) => o.classList.contains('is-filtered')), [true, false]);
    assert.equal(select.querySelector<HTMLElement>('.sel-empty')!.hidden, true);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    assert.equal(select.querySelector<HTMLElement>('.sel-empty')!.hidden, false);
  });

  test('multiple and data-no-search selects get a trigger but no search', async () => {
    document.body.innerHTML = '<select id="m" multiple><option>A</option></select><select id="n" data-no-search><option>B</option></select>';
    const { initSelects } = await loadWithSupport(true);
    initSelects();
    assert.equal(document.querySelector('#m .sel-search'), null);
    assert.equal(document.querySelector('#n .sel-search'), null);
    assert.ok(document.querySelector('#n .sel-trigger'));
  });

  test('relabelling the selected option in place refreshes the trigger label', async () => {
    document.body.innerHTML = '<select id="s"><option value="auto">Auto</option><option value="none">None</option></select>';
    const { initSelects, syncSelectedContent } = await loadWithSupport(true);
    initSelects();
    const select = document.getElementById('s') as HTMLSelectElement;
    const shown = select.querySelector('selectedcontent')!;
    shown.textContent = 'Auto';
    select.options[0]!.firstChild!.textContent = 'Auto · black';
    syncSelectedContent(select.options[0]!.firstChild!);
    assert.equal(shown.textContent, 'Auto · black');
    select.options[1]!.textContent = 'Nothing';
    syncSelectedContent(select.options[1]!);
    assert.equal(shown.textContent, 'Auto · black');
  });
});
