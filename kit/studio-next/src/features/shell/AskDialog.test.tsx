import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ask, useAsk } from '@/desk/ask';

import { AskDialog } from './AskDialog';

afterEach(() => useAsk.setState({ pending: null }));

function dialog(): HTMLDialogElement {
  return document.getElementById('askDialog') as HTMLDialogElement;
}

describe('AskDialog', () => {
  it('renders the legacy ask markup and resolves a confirm', async () => {
    const user = userEvent.setup();
    render(<AskDialog />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = ask({ title: 'Delete this version?', detail: 'Gone for good', ok: 'Delete version', tone: 'warn' });
    });
    expect(dialog().open).toBe(true);
    expect(dialog()).toHaveClass('sheet-dialog', 'ask');
    expect(document.getElementById('askTitle')).toHaveTextContent('Delete this version?');
    expect(document.getElementById('askSub')).not.toBeVisible();
    expect(document.querySelector('#askBody .ask-detail')).toHaveTextContent('Gone for good');
    expect(document.getElementById('askIcon')).toHaveClass('sheet-icon', 'warn');
    const ok = screen.getByRole('button', { name: 'Delete version' });
    expect(ok).toHaveClass('btn', 'warn');
    await user.click(ok);
    await expect(answer).resolves.toBe(true);
    expect(dialog().open).toBe(false);
  });

  it('resolves false when cancelled', async () => {
    const user = userEvent.setup();
    render(<AskDialog />);
    let answer: Promise<boolean> | undefined;
    act(() => {
      answer = ask({ title: 'Sure?' });
    });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(answer).resolves.toBe(false);
  });

  it('returns the typed value of a prompt, and submits on Enter', async () => {
    const user = userEvent.setup();
    render(<AskDialog />);
    let answer: Promise<string | null> | undefined;
    act(() => {
      answer = ask({ kind: 'prompt', title: 'Save a version', label: 'Title', value: 'Saved snapshot' });
    });
    const input = screen.getByLabelText('Title');
    expect(input).toHaveValue('Saved snapshot');
    // The dialog focuses and selects the field on the next frame; type after that.
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, 'v2{Enter}');
    await expect(answer).resolves.toBe('v2');
  });

  it('picks a choice, defaulting to the first option', async () => {
    const user = userEvent.setup();
    render(<AskDialog />);
    let answer: Promise<string | null> | undefined;
    act(() => {
      answer = ask({ kind: 'choice', title: 'Pick one', options: ['a', { value: 'b', label: 'Bee', hint: 'second' }] });
    });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveClass('ask-choice', 'is-on');
    await user.click(screen.getByRole('option', { name: /Bee/ }));
    expect(screen.getByRole('option', { name: /Bee/ })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await expect(answer).resolves.toBe('b');
  });

  it('keeps a job question up when a later confirm arrives', async () => {
    render(<AskDialog />);
    act(() => {
      void ask({ kind: 'prompt', title: 'Email?', job: true });
    });
    let later: Promise<boolean> | undefined;
    act(() => {
      later = ask({ title: 'Something else' });
    });
    expect(document.getElementById('askTitle')).toHaveTextContent('Email?');
    await act(async () => {
      await expect(later).resolves.toBe(false);
    });
  });
});
