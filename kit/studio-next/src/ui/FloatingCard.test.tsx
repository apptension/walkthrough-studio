import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FloatingCard } from './FloatingCard';

afterEach(() => cleanup());

describe('FloatingCard', () => {
  it('is the shared popover chrome, sized by variant', () => {
    const { container, rerender } = render(
      <FloatingCard id="a" className="help-pop" role="tooltip">
        Hi
      </FloatingCard>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el).toHaveClass('floating-card', 'help-pop');
    expect(el).toHaveAttribute('data-size', 'sm');
    expect(el).toHaveAttribute('role', 'tooltip');

    rerender(
      <FloatingCard id="a" className="queue-menu" size="lg">
        Hi
      </FloatingCard>,
    );
    expect((container.firstElementChild as HTMLElement).dataset['size']).toBe('lg');
  });

  it('forwards a ref to the card element', () => {
    let node: HTMLDivElement | null = null;
    render(
      <FloatingCard
        ref={(el) => {
          node = el;
        }}
      />,
    );
    expect(node).toBeInstanceOf(HTMLDivElement);
    expect(node).toHaveClass('floating-card');
  });
});
