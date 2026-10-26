import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetBoot } from '@/desk/boot';
import { desk } from '@/desk/store';
import { allowLiveRendering } from '@/test/liveRendering';

import { App } from './App';

allowLiveRendering();

beforeEach(() => {
  desk.reset();
  resetBoot();
  document.title = '';
  history.replaceState(null, '', '/');
});
afterEach(() => desk.reset());

describe('boot', () => {
  it('loads health and the first sequence, then lifts the boot veil', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => expect(desk.get().slug).toBe('demo'), { timeout: 4000 });
    await waitFor(() => expect(document.getElementById('bootLoader')).toBeNull(), { timeout: 4000 });
    expect(desk.get().bootError).toBeNull();
    expect(desk.get().video?.slug).toBe('demo');
    expect(document.title).toMatch(/^Walkthrough Studio · /);
    expect(new URLSearchParams(location.search).get('slug')).toBe('demo');
    expect(document.getElementById('stageBar')).not.toBeNull();
    expect(document.getElementById('projectPanel')).not.toBeNull();
    expect(document.getElementById('workspace')).not.toBeNull();
    // The stub server has no editor deck; the editor says so and carries on.
    await waitFor(() => expect(warn).toHaveBeenCalledWith('editor deck', expect.anything()));
  });
});
