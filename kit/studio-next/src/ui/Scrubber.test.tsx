import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { paintRange } from './rangeFill';
import { Scrubber } from './Scrubber';

afterEach(() => cleanup());

describe('Scrubber', () => {
  it('is the shared meter and fills the track up to its value', () => {
    const { getByRole } = render(<Scrubber aria-label="Strength" min={1} max={3} defaultValue={2} />);
    const input = getByRole('slider', { name: 'Strength' }) as HTMLInputElement;
    expect(input).toHaveClass('sp-range');
    expect(input.style.getPropertyValue('--sp-fill')).toBe('50.0%');
    fireEvent.input(input, { target: { value: '3' } });
    expect(input.style.getPropertyValue('--sp-fill')).toBe('100.0%');
  });

  it('clamps a fill that falls outside the range', () => {
    const input = document.createElement('input');
    input.min = '0';
    input.max = '10';
    input.value = '20';
    paintRange(input);
    expect(input.style.getPropertyValue('--sp-fill')).toBe('100.0%');
  });
});
