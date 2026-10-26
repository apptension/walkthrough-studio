import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { desk, openDialog } from '@/desk/store';

const jobs = vi.hoisted(() => ({ requestMake: vi.fn(), exportPack: vi.fn() }));
const panels = vi.hoisted(() => ({ showRightTab: vi.fn(), showLeftTab: vi.fn() }));
const wizard = vi.hoisted(() => ({ openProjectNew: vi.fn() }));
const branch = vi.hoisted(() => ({ openBranch: vi.fn() }));
const actions = vi.hoisted(() => ({ onStageClick: vi.fn() }));
vi.mock('@/desk/jobs', () => jobs);
vi.mock('@/desk/panels', () => panels);
vi.mock('@/features/project-wizard/wizard', () => wizard);
vi.mock('@/features/branch/branch', () => branch);
vi.mock('@/features/stages/actions', () => actions);

import { COMMANDS, moveCommandActive, openCommandMenu, setCommandQuery, useCommandMenu, visibleCommands } from './command';
import { CommandDialog } from './CommandDialog';

const dialog = () => document.getElementById('commandDialog') as HTMLDialogElement;
const input = () => document.getElementById('commandInput') as HTMLInputElement;
const items = () => [...document.querySelectorAll<HTMLButtonElement>('#commandList [data-command]')];

beforeEach(() => {
  useCommandMenu.setState({ query: '', active: COMMANDS[0]?.id ?? null, seq: 0 });
});
afterEach(() => {
  act(() => openDialog('command', false));
});

describe('command model', () => {
  it('filters on the whole button text and keeps the active item in range', () => {
    expect(visibleCommands('handoff').map((c) => c.id)).toEqual(['deliver', 'handoff']);
    expect(visibleCommands('pack').map((c) => c.id)).toEqual(['handoff']);
    expect(visibleCommands('').length).toBe(COMMANDS.length);
    setCommandQuery('open');
    expect(useCommandMenu.getState().active).toBe('direction');
    moveCommandActive(1);
    expect(useCommandMenu.getState().active).toBe('script');
    moveCommandActive(-1);
    moveCommandActive(-1);
    expect(useCommandMenu.getState().active).toBe('deliver');
  });
});

describe('CommandDialog', () => {
  it('renders the legacy menu and opens from the bridge entry point', () => {
    render(<CommandDialog />);
    expect(dialog()).toHaveClass('command-dialog');
    expect(dialog().open).toBe(false);
    act(() => openCommandMenu());
    expect(dialog().open).toBe(true);
    expect(desk.get().dialogs.command).toBe(true);
    expect(items().map((b) => b.dataset.command)).toEqual(COMMANDS.map((c) => c.id));
    expect(items()[0]).toHaveClass('is-active');
    expect(items()[0]).toHaveTextContent('Render video');
  });

  it('filters, shows the empty line and runs the active item on Enter', () => {
    render(<CommandDialog />);
    act(() => openCommandMenu());
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(items().every((b) => b.hidden)).toBe(true);
    expect(document.getElementById('commandEmpty')).not.toHaveAttribute('hidden');
    fireEvent.change(input(), { target: { value: 'branch' } });
    expect(items().filter((b) => !b.hidden).map((b) => b.dataset.command)).toEqual(['branch']);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(branch.openBranch).toHaveBeenCalled();
    expect(desk.get().dialogs.command).toBe(false);
  });

  it('routes clicks to their commands', () => {
    render(<CommandDialog />);
    act(() => openCommandMenu());
    fireEvent.click(screen.getByText('Open Direction').closest('button') as HTMLButtonElement);
    expect(panels.showRightTab).toHaveBeenCalledWith('motion');
    act(() => openCommandMenu());
    fireEvent.click(screen.getByText('Open Deliver').closest('button') as HTMLButtonElement);
    expect(panels.showLeftTab).toHaveBeenCalledWith('deliver');
    act(() => openCommandMenu());
    fireEvent.click(screen.getByText('Studio guide').closest('button') as HTMLButtonElement);
    expect(desk.get().dialogs.help).toBe(true);
    act(() => openDialog('help', false));
  });

  it('resets on every opening', () => {
    render(<CommandDialog />);
    act(() => openCommandMenu());
    fireEvent.change(input(), { target: { value: 'deliver' } });
    act(() => openDialog('command', false));
    act(() => openCommandMenu());
    expect(input().value).toBe('');
    expect(items().every((b) => !b.hidden)).toBe(true);
  });
});
