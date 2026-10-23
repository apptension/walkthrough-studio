import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desk } from '@/desk/store';

vi.mock('@/desk/monitor', () => ({
  activePlayer: vi.fn(() => ({ currentTime: 10 })),
  ensureProgramMaster: vi.fn(),
  seekTo: vi.fn(),
  updateTransport: vi.fn(),
}));

const monitor = await import('@/desk/monitor');
const { onDeskKeydown } = await import('./useShortcuts');

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, 'target', { value: target });
  onDeskKeydown(e);
  return e;
}

beforeEach(() => {
  desk.reset();
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('desk shortcuts', () => {
  it('toggles the command menu with Cmd/Ctrl+K even from an input', () => {
    const input = document.createElement('input');
    press('k', { metaKey: true }, input);
    expect(desk.get().dialogs.command).toBe(true);
    press('K', { ctrlKey: true }, input);
    expect(desk.get().dialogs.command).toBe(false);
  });

  it('ignores keys typed into fields and while a dialog is open', () => {
    press('c', {}, document.createElement('textarea'));
    expect(desk.get().captionsOn).toBe(false);
    document.body.innerHTML = '<dialog open></dialog>';
    press('c');
    expect(desk.get().captionsOn).toBe(false);
  });

  it('Space clicks Play unless the editor is up', () => {
    document.body.innerHTML = '<button id="btnPlay"></button>';
    const click = vi.fn();
    document.getElementById('btnPlay')?.addEventListener('click', click);
    press(' ', { code: 'Space' });
    expect(click).toHaveBeenCalledTimes(1);
    document.body.classList.add('is-editor');
    press(' ', { code: 'Space' });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('J/L jump 5 s and the arrows 2 s, but not in Plate HTML', () => {
    press('j');
    expect(monitor.seekTo).toHaveBeenLastCalledWith(5);
    press('ArrowRight');
    expect(monitor.seekTo).toHaveBeenLastCalledWith(12);
    desk.set({ monitorMode: 'plate' });
    vi.mocked(monitor.seekTo).mockClear();
    press('l');
    expect(monitor.seekTo).not.toHaveBeenCalled();
  });

  it('C toggles captions and ? opens help', () => {
    const before = desk.get().captionsOn;
    press('c');
    expect(desk.get().captionsOn).toBe(!before);
    expect(monitor.updateTransport).toHaveBeenCalled();
    press('?');
    expect(desk.get().dialogs.help).toBe(true);
  });

  it('Escape clears a version selection on the Versions tab', () => {
    desk.set({ versionSelection: ['v1'], leftTab: 'versions' });
    press('Escape');
    expect(desk.get().versionSelection).toEqual([]);
  });
});
