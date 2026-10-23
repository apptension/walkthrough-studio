import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PanelSection } from './PanelSection';

describe('PanelSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('renders title, body and toggles open state', () => {
    render(
      <PanelSection id="test-sec" icon="story" title="Story" help="Help text">
        <p>Body copy</p>
      </PanelSection>,
    );
    expect(screen.getByText('Story')).toBeTruthy();
    expect(screen.getByText('Body copy')).toBeTruthy();
    const details = document.querySelector('details.panel-sec') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    fireEvent.click(details.querySelector('summary')!);
    expect(details.open).toBe(false);
    expect(JSON.parse(localStorage.getItem('wt-studio-panel-sec') || '{}')['test-sec']).toBe(false);
  });

  it('restores remembered closed state', () => {
    localStorage.setItem('wt-studio-panel-sec', JSON.stringify({ remembered: false }));
    render(
      <PanelSection id="remembered" icon="check" title="Quality checks">
        <span>inner</span>
      </PanelSection>,
    );
    expect((document.querySelector('details.panel-sec') as HTMLDetailsElement).open).toBe(false);
  });

  it('opens when preferOpen becomes true', () => {
    localStorage.setItem('wt-studio-panel-sec', JSON.stringify({ qc: false }));
    const { rerender } = render(
      <PanelSection id="qc" icon="check" title="Quality checks" preferOpen={false}>
        <span>inner</span>
      </PanelSection>,
    );
    expect((document.querySelector('details.panel-sec') as HTMLDetailsElement).open).toBe(false);
    rerender(
      <PanelSection id="qc" icon="check" title="Quality checks" preferOpen>
        <span>inner</span>
      </PanelSection>,
    );
    expect((document.querySelector('details.panel-sec') as HTMLDetailsElement).open).toBe(true);
  });

  it('lays out icon, title and help tip as siblings in the title row', () => {
    render(
      <PanelSection id="motion" icon="motion" title="Motion & transitions" help="Fine-tune" className="direction-advanced">
        <span>body</span>
      </PanelSection>,
    );
    const title = document.querySelector('.panel-sec-title') as HTMLElement;
    expect(title.classList.contains('has-help')).toBe(true);
    expect(title.querySelector(':scope > .sec-ico')).toBeTruthy();
    expect(title.querySelector(':scope > .help-tip')).toBeTruthy();
    expect(title.childNodes.length).toBeGreaterThanOrEqual(3);
  });

  it('does not let legacy direction-advanced rules stack PanelSection titles', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/studio.css'), 'utf8');
    // The old column stack was `.direction-advanced > summary span { flex-direction: column }`.
    // It must stay scoped to legacy markup only — otherwise icon / title / help tip stack.
    expect(css).toMatch(/\.direction-advanced:not\(\.panel-sec\)\s*>\s*summary\s+span\s*\{[^}]*flex-direction:\s*column/);
    expect(css).not.toMatch(/\.direction-advanced\s*>\s*summary\s+span\s*\{/);
  });
});
