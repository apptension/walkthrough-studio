import { describe, expect, it } from 'vitest';

import { makeJob } from '@/test/factories';

import { format, latestStreamText, paintAgentStream } from './agentStream';

function host() {
  const el = document.createElement('div');
  el.className = 'agent-stream agent-stream--bay is-empty';
  document.body.appendChild(el);
  return el;
}

describe('agent stream', () => {
  it('mounts the feed chrome on first paint and stays empty without a job', () => {
    const el = host();
    paintAgentStream(el, null, { variant: 'bay' });
    expect(el).toHaveAttribute('role', 'log');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el.querySelector('ol.as-list')).not.toBeNull();
    expect(el.querySelector('p.as-empty')).toHaveTextContent('Waiting for the first words…');
    expect(el.querySelector<HTMLButtonElement>('button.as-latest')?.hidden).toBe(true);
    expect(el).toHaveClass('is-empty');
  });

  it('paints finished entries at once with labels and glyphs', () => {
    const el = host();
    const job = makeJob({
      status: 'done',
      stream: {
        rev: 2,
        entries: [
          { id: 1, kind: 'say', text: 'Use `kit` **now**', done: true },
          { id: 2, kind: 'tool', title: 'Read', text: 'file', done: true, ok: false },
        ],
      },
    });
    paintAgentStream(el, job, { variant: 'bay' });
    const items = el.querySelectorAll('li.as-entry');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveClass('as-say');
    expect(items[0]?.querySelector('.as-label')).toHaveTextContent('Agent');
    expect(items[0]?.querySelector('.as-text')?.innerHTML).toBe('Use <code>kit</code> <strong>now</strong>');
    expect(items[1]).toHaveClass('as-tool', 'is-fail');
    expect(items[1]?.querySelector('.as-label')).toHaveTextContent('Read');
    expect(items[1]?.querySelector('.as-glyph.fail')).toHaveTextContent('✕');
    expect(el).not.toHaveClass('is-empty');
    expect(el).not.toHaveClass('is-live');
    expect(el.dataset['slug']).toBe('demo');
  });

  it('marks a live job and resets for a new job id', () => {
    const el = host();
    paintAgentStream(el, makeJob({ id: 'a', status: 'running', stream: { rev: 1, entries: [{ id: 1, kind: 'think', text: '', done: false }] } }));
    expect(el).toHaveClass('is-live');
    expect(el.querySelector('li')).toHaveClass('is-live');
    paintAgentStream(el, makeJob({ id: 'b', status: 'done', stream: { rev: 1, entries: [] } }));
    expect(el.querySelectorAll('li')).toHaveLength(0);
    expect(el).toHaveClass('is-empty');
  });

  it('turns error.png into a screenshot toggle', () => {
    expect(format('see error.png')).toContain('<button type="button" class="as-shot" data-shot="error.png">Open screenshot</button>');
    const el = host();
    paintAgentStream(el, makeJob({ status: 'failed', stream: { rev: 1, entries: [{ id: 1, kind: 'error', text: 'see error.png', done: true }] } }));
    el.querySelector<HTMLButtonElement>('.as-shot')?.click();
    expect(el.querySelector('img.as-shot-img')).toHaveAttribute('src', '/media/demo/error.png');
    el.querySelector<HTMLButtonElement>('.as-shot')?.click();
    expect(el.querySelector('img.as-shot-img')).toBeNull();
  });

  it('finds the newest readable line', () => {
    expect(latestStreamText(null)).toBe('');
    expect(
      latestStreamText({ stream: { entries: [{ kind: 'say', text: 'one\n two' }, { kind: 'tool', title: 'Edit', text: 'a.ts\nmore' }] } }),
    ).toBe('Edit · a.ts');
  });
});
