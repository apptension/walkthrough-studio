import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSideCollapsed, setTlCollapsed, toggleTl, wirePanelResize } from './layout';
import { desk } from './store';

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const $ = (id: string) => document.getElementById(id) as HTMLElement;

function mountHandles() {
  document.body.innerHTML = `
    <div id="workspace">
      <div id="resizeLeft" class="resize-handle"></div>
      <div id="resizeRight" class="resize-handle"></div>
    </div>
    <div id="resizeTimeline" class="resize-handle resize-handle-h"></div>`;
}

/** jsdom has no PointerEvent; the handlers only read clientX/Y and button. */
function pointer(target: EventTarget, type: string, at: { x?: number; y?: number } = {}) {
  target.dispatchEvent(new MouseEvent(type, { clientX: at.x ?? 0, clientY: at.y ?? 0, button: 0, bubbles: true }));
}

function drag(handle: HTMLElement, from: { x?: number; y?: number }, to: { x?: number; y?: number }) {
  pointer(handle, 'pointerdown', from);
  pointer(window, 'pointermove', to);
  pointer(window, 'pointerup', to);
}

let unbind: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  desk.reset();
  document.documentElement.removeAttribute('style');
  document.body.className = '';
  mountHandles();
});
afterEach(() => unbind());

describe('wirePanelResize', () => {
  it('restores stored widths and the editor timeline height', () => {
    localStorage.setItem('wt-studio-panels', JSON.stringify({ left: 300, right: 240, tl: 500, tlCollapsed: true }));
    unbind = wirePanelResize();
    expect(rootVar('--left-w')).toBe('300px');
    expect(rootVar('--right-w')).toBe('240px');
    expect(rootVar('--tl-h-editor')).toBe('500px');
    expect(desk.get().tlCollapsed).toBe(true);
    expect(document.body).toHaveClass('tl-collapsed');
  });

  it('restores folded side panels', () => {
    localStorage.setItem('wt-studio-panels', JSON.stringify({ left: 300, leftCollapsed: true, rightCollapsed: false }));
    unbind = wirePanelResize();
    expect(document.body).toHaveClass('left-collapsed');
    expect(document.body).not.toHaveClass('right-collapsed');
    expect(rootVar('--left-col')).toBe('0px');
    expect(rootVar('--left-w')).toBe('300px');
  });

  it('falls back to the old timeline key, floors it at 180 and defaults to 400', () => {
    localStorage.setItem('wts.timeline.height', '150');
    unbind = wirePanelResize();
    expect(rootVar('--tl-h-editor')).toBe('400px');
    unbind();
    localStorage.setItem('wts.timeline.height', '200');
    unbind = wirePanelResize();
    expect(rootVar('--tl-h-editor')).toBe('200px');
    unbind();
    localStorage.clear();
    unbind = wirePanelResize();
    expect(rootVar('--tl-h-editor')).toBe('400px');
  });

  it('nudges the left panel with the arrow keys up to the monitor floor and saves it', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--right-w', '304px');
    document.documentElement.style.setProperty('--left-w', '345px');
    // jsdom: 1024px window − 304px right panel − 360px monitor floor − 10px of splitters.
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(rootVar('--left-w')).toBe('350px');
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
    expect(rootVar('--left-w')).toBe('326px');
    expect(JSON.parse(localStorage.getItem('wt-studio-panels') ?? '{}')).toMatchObject({ left: 326 });
  });

  it('keeps handle keys away from the desk shortcuts (no seeking while resizing)', () => {
    unbind = wirePanelResize();
    const desk = vi.fn();
    document.addEventListener('keydown', desk);
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.removeEventListener('keydown', desk);
    expect(desk).not.toHaveBeenCalled();
  });

  it('grows the right panel when its handle moves left', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--right-w', '280px');
    $('resizeRight').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(rootVar('--right-w')).toBe('292px');
  });

  it('folds a side panel with Enter and brings it back at its old width', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--left-w', '310px');
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.body).toHaveClass('left-collapsed');
    expect(rootVar('--left-col')).toBe('0px');
    expect($('resizeLeft')).toHaveAttribute('aria-expanded', 'false');
    $('resizeLeft').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.body).not.toHaveClass('left-collapsed');
    expect(rootVar('--left-col')).toBe('');
    expect(rootVar('--left-w')).toBe('310px');
    expect(JSON.parse(localStorage.getItem('wt-studio-panels') ?? '{}')).toMatchObject({ left: 310, leftCollapsed: false });
  });

  it('closes the left panel when dragged past its collapse line', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--left-w', '268px');
    drag($('resizeLeft'), { x: 268 }, { x: 40 });
    expect(document.body).toHaveClass('left-collapsed');
    expect(rootVar('--left-w')).toBe('268px');
    expect(JSON.parse(localStorage.getItem('wt-studio-panels') ?? '{}')).toMatchObject({ leftCollapsed: true });
  });

  it('springs back to the minimum when released short of the collapse line', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--left-w', '268px');
    drag($('resizeLeft'), { x: 268 }, { x: 150 });
    expect(document.body).not.toHaveClass('left-collapsed');
    expect(rootVar('--left-w')).toBe('180px');
  });

  it('closes the right panel when dragged toward the window edge', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--right-w', '304px');
    drag($('resizeRight'), { x: 700 }, { x: 1000 });
    expect(document.body).toHaveClass('right-collapsed');
  });

  it('re-opens a folded panel when its handle is clicked', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--left-w', '290px');
    setSideCollapsed('left', true);
    drag($('resizeLeft'), { x: 2 }, { x: 3 });
    expect(document.body).not.toHaveClass('left-collapsed');
    expect(rootVar('--left-w')).toBe('290px');
  });

  it('pulls a folded panel open by dragging, settling where the pointer lets go', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--left-w', '290px');
    setSideCollapsed('left', true);
    drag($('resizeLeft'), { x: 0 }, { x: 240 });
    expect(document.body).not.toHaveClass('left-collapsed');
    expect(rootVar('--left-w')).toBe('240px');
  });

  it('folds and unfolds a side panel on double-click', () => {
    unbind = wirePanelResize();
    $('resizeRight').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(document.body).toHaveClass('right-collapsed');
    $('resizeRight').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(document.body).not.toHaveClass('right-collapsed');
  });

  it('collapses and re-expands the timeline to the remembered height', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--tl-h-editor', '450px');
    toggleTl();
    expect(desk.get().tlCollapsed).toBe(true);
    expect(document.body).toHaveClass('tl-collapsed');
    setTlCollapsed(false);
    expect(document.body).not.toHaveClass('tl-collapsed');
    expect(rootVar('--tl-h-editor')).toBe('450px');
  });

  it('folds the timeline when dragged down past its collapse line', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--tl-h-editor', '400px');
    drag($('resizeTimeline'), { y: 300 }, { y: 650 });
    expect(desk.get().tlCollapsed).toBe(true);
    expect(rootVar('--tl-h-editor')).toBe('400px');
  });

  it('pulls a folded timeline open by dragging up', () => {
    unbind = wirePanelResize();
    document.documentElement.style.setProperty('--tl-h-editor', '400px');
    setTlCollapsed(true);
    drag($('resizeTimeline'), { y: 700 }, { y: 440 });
    expect(desk.get().tlCollapsed).toBe(false);
    expect(rootVar('--tl-h-editor')).toBe(`${42 + 260}px`);
  });
});
