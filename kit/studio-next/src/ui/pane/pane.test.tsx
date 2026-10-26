import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { devicePreview, framePreview, scalePreview, seatPreview, tile } from '@/ui/look/previews';

import { LookTile, PaneSection, PaneTabs, SegButtons, SwitchRow, TileGrid, useShown } from './index';

const squash = (html: string) => html.replace(/\s+/g, ' ');

describe('LookTile', () => {
  it('draws the same tile as the engine string', () => {
    const preview = '<span class="lk-stage"></span>';
    const react = renderToStaticMarkup(
      <LookTile role="toggle" preview={preview} label="Aurora · colour ribbons" badge="Video · Aurora" on data={{ 'data-look': 'aurora' }} />,
    );
    const engine = tile(preview, { attr: 'data-look', value: 'aurora', label: 'Aurora · colour ribbons', badge: 'Video · Aurora', on: true });
    expect(squash(react)).toBe(squash(engine));
  });

  it('is a radio inside a group, in the tab order only when picked', () => {
    render(
      <TileGrid label="Energy">
        <LookTile preview="" label="Calm" on={false} data={{ 'data-energy': 'calm' }} />
        <LookTile preview="" label="Clear" on data={{ 'data-energy': 'clear' }} />
      </TileGrid>,
    );
    const [calm, clear] = screen.getAllByRole('radio');
    expect(screen.getByRole('radiogroup', { name: 'Energy' })).toHaveClass('lk-grid');
    expect(calm).toHaveAttribute('aria-checked', 'false');
    expect(calm).toHaveAttribute('tabindex', '-1');
    expect(clear).toHaveAttribute('aria-checked', 'true');
    expect(clear).toHaveAttribute('tabindex', '0');
    expect(clear).toHaveClass('lk-tile', 'on');
  });

  it('keeps one tile focusable when nothing is picked, and walks tiles with the arrows', () => {
    render(
      <TileGrid label="Shape">
        {['a', 'b', 'c'].map((v) => (
          <LookTile key={v} preview="" label={v} on={false} />
        ))}
      </TileGrid>,
    );
    const tiles = screen.getAllByRole('radio');
    expect(tiles.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    tiles[0]!.focus();
    fireEvent.keyDown(tiles[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tiles[1]);
    fireEvent.keyDown(tiles[1]!, { key: 'End' });
    expect(document.activeElement).toBe(tiles[2]);
    expect(tiles.map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(tiles[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(tiles[0]);
  });

  it('shows a detail line and calls onSelect', () => {
    const onSelect = vi.fn();
    render(<LookTile preview="" label="Laptop" detail="1440×900 @2x" on={false} onSelect={onSelect} />);
    expect(screen.getByText('1440×900 @2x')).toHaveClass('lk-detail');
    fireEvent.click(screen.getByRole('radio'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('PaneTabs', () => {
  function Harness() {
    const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
    return (
      <PaneTabs
        base="t"
        label="Test"
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: 'a', label: 'A', icon: 'palette' },
          { id: 'b', label: 'B', icon: 'motion', dot: 'warn' },
          { id: 'c', label: 'C', icon: 'camera' },
        ]}
      />
    );
  }

  it('links tabs to panes and moves with the arrow keys', () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole('tab');
    expect(a).toHaveAttribute('aria-controls', 't-pane-a');
    expect(a).toHaveAttribute('id', 't-tab-a');
    expect(b!.querySelector('.sl-tab-dot')).toHaveAttribute('data-tone', 'warn');
    fireEvent.keyDown(a!, { key: 'ArrowLeft' });
    expect(c).toHaveAttribute('aria-selected', 'true');
    expect(c).toHaveClass('sl-tab', 'on');
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c!, { key: 'ArrowRight' });
    expect(a).toHaveAttribute('aria-selected', 'true');
  });
});

describe('controls', () => {
  it('SegButtons is a radio group carrying its data attributes', () => {
    const onSelect = vi.fn();
    render(
      <SegButtons
        label="Corners"
        data={{ 'data-camera': 'corners' }}
        current="soft"
        onSelect={onSelect}
        choices={[
          { value: 'square', label: 'Square' },
          { value: 'soft', label: 'Soft' },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Corners' });
    expect(group).toHaveAttribute('data-camera', 'corners');
    expect(screen.getByRole('radio', { name: 'Soft' })).toHaveClass('on');
    fireEvent.click(screen.getByRole('radio', { name: 'Square' }));
    expect(onSelect).toHaveBeenCalledWith('square');
  });

  it('SwitchRow toggles and carries its hint', () => {
    const onToggle = vi.fn();
    render(<SwitchRow id="sw" label="Glide" hint="Curved paths" aria="Smooth glide" checked={false} onToggle={onToggle} />);
    expect(screen.getByText('Curved paths')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Smooth glide' }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('PaneSection renders the inspector section with its help', () => {
    render(
      <PaneSection icon="palette" title="Color scale" help="Five roles" extra={<span>Captured</span>}>
        <p>body</p>
      </PaneSection>,
    );
    const sec = screen.getByRole('region', { name: 'Color scale' });
    expect(sec).toHaveClass('ins-sec');
    expect(sec.querySelector(':scope > header .help-tip')).not.toBeNull();
    expect(sec.querySelector(':scope > .ins-body')).toHaveTextContent('body');
  });
});

describe('useShown', () => {
  it('follows the hidden attribute up the tree', async () => {
    function Probe() {
      const [el, setEl] = useState<HTMLDivElement | null>(null);
      const shown = useShown(el);
      return <div ref={setEl}>{shown ? 'shown' : 'hidden'}</div>;
    }
    const { container } = render(
      <div id="host" hidden>
        <Probe />
      </div>,
    );
    expect(screen.getByText('hidden')).toBeInTheDocument();
    await act(async () => {
      container.querySelector('#host')!.removeAttribute('hidden');
      await Promise.resolve();
    });
    expect(screen.getByText('shown')).toBeInTheDocument();
  });
});

describe('previews', () => {
  it('only lets real colours into style attributes', () => {
    const html = scalePreview({ gold: 'red;background:url(evil)', ink: '#101010' }, [
      { id: 'gold', label: 'Accent' },
      { id: 'ink', label: 'Ink' },
    ]);
    expect(html).not.toContain('evil');
    expect(html).toContain('--ink:#101010');
    expect(html).toContain('--gold:#42f272');
    expect(html.match(/<i style="--swatch:/g)).toHaveLength(2);
  });

  it('draws the frame, seat and device from their settings', () => {
    expect(framePreview({ frame: 'inset', padding: 'roomy' })).toContain('data-frame="inset" data-background="" data-padding="roomy"');
    expect(seatPreview('bottom-right', 'center')).toContain('lk-seat s-bottom-right a-center');
    expect(devicePreview(390, 844, true)).toContain('is-phone');
    expect(devicePreview(1440, 900)).not.toContain('is-phone');
  });
});
