import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PANEL_KEYS, layoutPanels, panelCollapsed, panelHelpHtml, panelPlace, savePanelPlace, showPanel, wireStagePanels } from './stagePanels';

const FULL = (id: string) =>
  `<div class="sp-full"><button type="button" class="sp-icon-btn is-grip" data-sp-grip></button><span class="sp-title">${id}</span><span class="sp-help"></span><button type="button" data-sp-collapse aria-expanded="true"></button></div><div class="sp-mini"><button type="button" class="sp-pill" data-sp-expand aria-expanded="false"></button></div>`;

let ac: AbortController;

function mount(): { wrap: HTMLElement; plate: HTMLElement; text: HTMLElement; zoom: HTMLElement; lens: HTMLElement } {
  document.body.innerHTML = `<div class="stage-wrap"><div class="stage"><div id="playerPlate">
    <div id="stageAim"><div id="liveZoomBox" hidden></div><div id="liveLensBox" hidden></div></div>
    <div id="edTextBar" class="ed-textbar stage-panel sp-dock" hidden>${FULL('text')}</div>
    <div id="edZoomPanel" class="stage-panel sp-dock" hidden>${FULL('zoom')}</div>
    <div id="edLensPanel" class="stage-panel sp-dock" hidden>${FULL('lens')}</div>
  </div></div></div>`;
  const wrap = document.querySelector<HTMLElement>('.stage-wrap')!;
  Object.defineProperty(wrap, 'clientWidth', { value: 1000, configurable: true });
  Object.defineProperty(wrap, 'clientHeight', { value: 600, configurable: true });
  const $ = (id: string) => document.getElementById(id)!;
  return { wrap, plate: $('playerPlate'), text: $('edTextBar'), zoom: $('edZoomPanel'), lens: $('edLensPanel') };
}

const px = (el: HTMLElement, v: 'x' | 'y') => el.style.getPropertyValue(`--sp-${v}`);

beforeEach(() => {
  localStorage.clear();
  ac = new AbortController();
});

afterEach(() => {
  ac.abort();
  document.body.innerHTML = '';
});

describe('stage control panels', () => {
  it('move into the whole monitor area with rails and an attach ghost, and go home on abort', () => {
    const { wrap, plate, text, zoom, lens } = mount();
    wireStagePanels(ac.signal);
    for (const el of [text, zoom, lens]) expect(el.parentElement).toBe(wrap);
    expect(wrap).toHaveClass('has-sp-panels');
    expect([...wrap.querySelectorAll('[data-sp-zone]')].map((z) => z.getAttribute('data-sp-zone'))).toEqual(['top', 'bottom']);
    expect(wrap.querySelector('.sp-attach-ghost')).not.toBeNull();
    ac.abort();
    for (const el of [text, zoom, lens]) expect(el.parentElement).toBe(plate);
    expect(wrap).not.toHaveClass('has-sp-panels');
    expect(wrap.querySelector('[data-sp-zone], .sp-attach-ghost')).toBeNull();
  });

  it('docks the copy bar bottom-centre by default and follows a saved dock or free spot', () => {
    const { text } = mount();
    wireStagePanels(ac.signal);
    showPanel('text', true);
    // jsdom has no layout: panels measure as 240 × 40.
    expect(text).toHaveClass('is-dock-bottom');
    expect(px(text, 'x')).toBe('380px');
    expect(px(text, 'y')).toBe('550px');
    expect(text.dataset['pop']).toBe('up');

    savePanelPlace('text', { dock: 'top' });
    layoutPanels({ instant: true });
    expect(text).toHaveClass('is-dock-top');
    expect(text).not.toHaveClass('is-dock-bottom');
    expect(px(text, 'y')).toBe('10px');
    expect(text.dataset['pop']).toBe('down');

    savePanelPlace('text', { dock: 'free', fx: 0.25, fy: 0.5 });
    layoutPanels({ instant: true });
    expect(text).toHaveClass('is-placed');
    expect(px(text, 'x')).toBe('130px');
    expect(px(text, 'y')).toBe('280px');
  });

  it('keeps the copy bar where it was saved before the redesign, and drops the legacy pixel spot', () => {
    localStorage.setItem(PANEL_KEYS.text.place, JSON.stringify({ dock: 'top' }));
    localStorage.setItem(PANEL_KEYS.text.legacy[0], JSON.stringify({ x: 40, y: 40 }));
    expect(panelPlace('text')).toEqual({ dock: 'top' });
    expect(localStorage.getItem(PANEL_KEYS.text.legacy[0])).toBeNull();
  });

  it('lines several panels up on one rail instead of stacking them', () => {
    const { text, zoom } = mount();
    wireStagePanels(ac.signal);
    savePanelPlace('zoom', { dock: 'bottom' });
    showPanel('text', true);
    showPanel('zoom', true);
    expect(px(text, 'y')).toBe('550px');
    expect(px(zoom, 'y')).toBe('550px');
    expect(px(text, 'x')).toBe('256px');
    expect(px(zoom, 'x')).toBe('504px');
  });

  it('falls back to a rail when the thing it attaches to is not on stage', () => {
    const { zoom } = mount();
    wireStagePanels(ac.signal);
    showPanel('zoom', true);
    expect(zoom).toHaveClass('is-dock-bottom');
  });

  it('collapses each panel to a pill and expands it back, remembering per panel', () => {
    const { text, zoom } = mount();
    wireStagePanels(ac.signal);
    showPanel('text', true);
    showPanel('zoom', true);
    zoom.querySelector<HTMLElement>('[data-sp-collapse]')!.click();
    expect(zoom).toHaveClass('is-collapsed');
    expect(panelCollapsed('zoom')).toBe(true);
    expect(panelCollapsed('text')).toBe(false);
    expect(localStorage.getItem(PANEL_KEYS.zoom.collapsed)).toBe('1');
    expect(zoom.querySelector('.sp-full')).toHaveAttribute('inert');
    expect(zoom.querySelector('.sp-mini')).not.toHaveAttribute('inert');
    expect(document.activeElement).toBe(zoom.querySelector('[data-sp-expand]'));
    expect(text).not.toHaveClass('is-collapsed');

    zoom.querySelector<HTMLElement>('[data-sp-expand]')!.click();
    expect(zoom).not.toHaveClass('is-collapsed');
    expect(panelCollapsed('zoom')).toBe(false);
    expect(zoom.querySelector('.sp-mini')).toHaveAttribute('inert');
  });

  it('restores a collapsed panel as a pill when it shows again', () => {
    const { lens } = mount();
    localStorage.setItem(PANEL_KEYS.lens.collapsed, '1');
    wireStagePanels(ac.signal);
    showPanel('lens', true);
    expect(lens).toHaveClass('is-collapsed');
    expect(lens.querySelector('.sp-full')).toHaveAttribute('inert');
  });

  it('puts a panel back on grip double-click and docks it from the keyboard', () => {
    const { text } = mount();
    wireStagePanels(ac.signal);
    showPanel('text', true);
    savePanelPlace('text', { dock: 'free', fx: 0.2, fy: 0.2 });
    const grip = text.querySelector<HTMLElement>('[data-sp-grip]')!;
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(localStorage.getItem(PANEL_KEYS.text.place)).toBeNull();
    expect(text).toHaveClass('is-dock-bottom');

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(panelPlace('text')).toEqual({ dock: 'top' });
    expect(text).toHaveClass('is-dock-top');

    grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(panelPlace('text')?.dock).toBe('free');
  });

  it('keeps the shortcuts behind a "?" with a card of keys', () => {
    const html = panelHelpHtml('Zoom', [{ keys: ['+', '−'], label: 'strength' }]);
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('[data-sp-help]')?.getAttribute('aria-label')).toBe('Zoom shortcuts');
    expect(host.querySelector('.sp-help-pop')?.getAttribute('role')).toBe('tooltip');
    expect([...host.querySelectorAll('.sp-help-pop kbd')].map((k) => k.textContent)).toEqual(['+', '−']);
  });
});
