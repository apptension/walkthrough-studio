import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { server } from './msw/server';

// jsdom ships none of these, and the desk uses all three: the panels measure with
// ResizeObserver, the monitor sizes itself from matchMedia, and the timeline
// scrolls elements into view.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia;

// Radix and the monitor call these; jsdom defines none of them. Assigning
// through a helper keeps the stubs off the lint radar for unbound methods —
// they are prototype installs, not references to an existing method.
function stub<K extends keyof Element>(key: K, value: Element[K]): void {
  if (Element.prototype[key] === undefined) Element.prototype[key] = value;
}

stub('scrollIntoView', () => {});
stub('hasPointerCapture', () => false);
stub('setPointerCapture', () => {});
stub('releasePointerCapture', () => {});

// jsdom defines these but only to report "not implemented". The engine pauses and
// reloads players on every sequence switch, and the brand mark paints a canvas.
// Tests that care spy on them.
Object.assign(HTMLMediaElement.prototype, {
  pause() {},
  load() {},
  play: () => Promise.resolve(),
});
// Every member is callable and returns the context again, so gradient and path chains run.
const noop2d: object = new Proxy(function context() {}, { get: () => noop2d, apply: () => noop2d });
Object.assign(HTMLCanvasElement.prototype, {
  getContext: () => noop2d,
  toDataURL: () => 'data:,',
});

// jsdom has <dialog> but neither the modal API nor `method="dialog"` forms. The
// desk opens every sheet with showModal() and closes asks through a dialog form.
const dialogProto = HTMLDialogElement.prototype as HTMLDialogElement & { __stubbed?: boolean };
if (!dialogProto.__stubbed) {
  dialogProto.__stubbed = true;
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogProto.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialogProto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target as HTMLFormElement;
      if (form.getAttribute('method') !== 'dialog') return;
      e.preventDefault();
      const submitter = (e).submitter as HTMLButtonElement | null;
      form.closest('dialog')?.close(submitter?.value ?? '');
    },
    true,
  );
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
  vi.useRealTimers();
});

afterAll(() => {
  server.close();
});
