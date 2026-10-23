import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bridges, type WorkflowBridge } from '@/desk/bridge';
import { desk, openDialog } from '@/desk/store';

import { HELP_SUB, helpSub, modKeyGlyph, openHelp, sectionFromScroll } from './guide';
import { HelpDialog } from './HelpDialog';

const dialog = () => document.getElementById('helpDialog') as HTMLDialogElement;

afterEach(() => {
  act(() => openDialog('help', false));
  bridges.workflow = null;
});

describe('guide helpers', () => {
  it('picks the modifier glyph per platform', () => {
    expect(modKeyGlyph('MacIntel')).toBe('⌘');
    expect(modKeyGlyph('Win32')).toBe('Ctrl');
  });

  it('prefixes the subtitle with the build', () => {
    expect(helpSub(null)).toBe(HELP_SUB);
    expect(helpSub('v1.2.3')).toBe(`v1.2.3 · ${HELP_SUB}`);
  });

  it('spies the section under the upper third, pinning the last at the end', () => {
    const offsets = { guideHow: 0, guideDesk: 400, guideWords: 900, guideKeys: 1400 };
    const body = { scrollTop: 0, clientHeight: 300, scrollHeight: 2000, offsetTop: 0 };
    expect(sectionFromScroll(body, offsets)).toBe('guideHow');
    expect(sectionFromScroll({ ...body, scrollTop: 340 }, offsets)).toBe('guideDesk');
    expect(sectionFromScroll({ ...body, scrollTop: 1700 }, offsets)).toBe('guideKeys');
  });
});

describe('HelpDialog', () => {
  it('renders the guide and opens from the store', () => {
    render(<HelpDialog />);
    expect(dialog()).toHaveClass('sheet-dialog', 'help');
    expect(screen.getByRole('heading', { name: 'Studio guide', hidden: true })).toBeInTheDocument();
    expect([...document.querySelectorAll('[data-guide-jump]')].map((b) => b.textContent)).toEqual(['How it works', 'The desk', 'Words', 'Shortcuts']);
    act(() => openHelp());
    expect(dialog().open).toBe(true);
    expect(document.getElementById('helpDialogSub')).toHaveTextContent(HELP_SUB);
  });

  it('marks the jumped section active', () => {
    render(<HelpDialog />);
    act(() => openHelp());
    const words = document.querySelector<HTMLButtonElement>('[data-guide-jump="guideWords"]') as HTMLButtonElement;
    fireEvent.click(words);
    expect(words).toHaveClass('is-active');
    expect(words).toHaveAttribute('aria-current', 'true');
    expect(document.querySelector('[data-guide-jump="guideHow"]')).not.toHaveClass('is-active');
  });

  it('closes, then opens a stage through the workflow bridge', async () => {
    const openStage = vi.fn();
    bridges.workflow = { openStage } as unknown as WorkflowBridge;
    render(<HelpDialog />);
    act(() => openHelp());
    const stageBtn = document.querySelector<HTMLButtonElement>('[data-guide-stage]') as HTMLButtonElement;
    fireEvent.click(stageBtn);
    expect(desk.get().dialogs.help).toBe(false);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(openStage).toHaveBeenCalledWith(stageBtn.dataset.guideStage);
  });

  it('resets the active section when closed', () => {
    render(<HelpDialog />);
    act(() => openHelp());
    fireEvent.click(document.querySelector('[data-guide-jump="guideKeys"]') as HTMLButtonElement);
    act(() => dialog().close());
    expect(desk.get().dialogs.help).toBe(false);
    expect(document.querySelector('[data-guide-jump="guideHow"]')).toHaveClass('is-active');
  });
});
