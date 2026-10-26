import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bridges } from '@/desk/bridge';
import { desk } from '@/desk/store';

import { bayBridge, resetBayCards } from './bayCards';
import { ProjectPanel } from './ProjectPanel';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  desk.reset();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  resetBayCards();
  vi.unstubAllGlobals();
});

describe('ProjectPanel', () => {
  it('renders the rail with the Render bay up front', () => {
    render(<ProjectPanel />);
    const aside = $('projectPanel');
    expect(aside.tagName).toBe('ASIDE');
    expect(aside).toHaveAttribute('class', 'panel project-panel is-render-focus');
    expect(aside).toHaveAttribute('aria-label', 'Project');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => [t.textContent, t.dataset['left'], t.getAttribute('aria-selected'), t.className])).toEqual([
      ['Render', 'render', 'true', 'ptab active'],
      ['Versions', 'versions', 'false', 'ptab'],
      ['Deliver', 'deliver', 'false', 'ptab'],
    ]);
    expect($('leftRender')).toHaveAttribute('class', 'panel-body render-bay');
    expect($('leftRender').hidden).toBe(false);
    expect($('leftVersions')).toHaveAttribute('class', 'panel-body versions-bay');
    expect($('leftVersions').hidden).toBe(true);
    expect($('leftDeliver').hidden).toBe(true);
    for (const id of ['renderBrief', 'actionSteps', 'renderLiveCard', 'queueSection', 'versions', 'posterImg', 'title']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it('switches tabs through showLeftTab', () => {
    render(<ProjectPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(desk.get().leftTab).toBe('versions');
    expect($('projectPanel')).toHaveAttribute('class', 'panel project-panel');
    expect(screen.getByRole('tab', { name: 'Versions' })).toHaveAttribute('aria-selected', 'true');
    expect($('leftVersions').hidden).toBe(false);
    expect($('leftRender').hidden).toBe(true);
    act(() => desk.set({ leftTab: 'deliver' }));
    expect($('leftDeliver').hidden).toBe(false);
    expect($('leftVersions').hidden).toBe(true);
  });

  it('crossfades bodies when motion is allowed', () => {
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    render(<ProjectPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'Deliver' }));
    expect($('leftRender')).toHaveAttribute('class', 'panel-body render-bay is-panel-leave');
    expect($('leftDeliver')).toHaveAttribute('class', 'panel-body is-panel-enter');
    act(() => void vi.advanceTimersByTime(320));
    expect($('leftRender').hidden).toBe(true);
    expect($('leftDeliver')).toHaveAttribute('class', 'panel-body is-panel-ready');
  });

  it('registers the bay bridge while mounted', () => {
    const { unmount } = render(<ProjectPanel />);
    expect(bridges.bay).toBe(bayBridge);
    unmount();
    expect(bridges.bay).toBeNull();
  });
});
