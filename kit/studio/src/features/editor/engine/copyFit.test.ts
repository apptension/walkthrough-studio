import { describe, expect, it } from 'vitest';

import { copyClipCallout, copyClipFieldNote, copyClipPhrase, parseCopyClips } from './copyFit';

describe('parseCopyClips', () => {
  it('reads the render note and keeps one entry per field', () => {
    expect(parseCopyClips(null)).toEqual([]);
    expect(parseCopyClips(['Type at its floor (28px): title "Hi"', 'not a clip'])).toEqual([]);
    expect(
      parseCopyClips([
        'Copy clips: overflow title "Three ways past home"',
        'Copy clips: overflow title "again"',
        'Copy clips: offscreen items.0.note "A longer line that the probe cuts at thirty two"',
      ]),
    ).toEqual([
      { path: 'title', where: 'overflow', snippet: 'Three ways past home' },
      { path: 'items.0.note', where: 'offscreen', snippet: 'A longer line that the probe…' },
    ]);
  });

  it('says where the line fails', () => {
    expect(copyClipPhrase('overflow')).toBe('clips, even at the smallest size');
    expect(copyClipPhrase('offscreen')).toBe('sits outside the frame');
  });

  it('builds a callout that focuses a known field and names the line', () => {
    const clips = parseCopyClips(['Copy clips: overflow title "Three ways past home"']);
    const html = copyClipCallout(clips, new Set(['title', 'body']), 'title');
    expect(html).toContain('Copy too long');
    expect(html).toContain('This line still clips at the smallest size');
    expect(html).toContain('data-field="title"');
    expect(html).toContain('class="copy-long-row on"');
    expect(html).toContain('Title');
    expect(html).toContain('“Three ways past home”');
    expect(copyClipFieldNote(clips, 'title')).toContain('data-paths="title"');
    expect(copyClipFieldNote(clips, 'body')).toContain('hidden');
    expect(copyClipCallout([], new Set(), null)).toBe('');
  });

  it('focuses a field-shaped line before the plate has listed its fields, and leaves a class name plain', () => {
    const early = copyClipCallout(parseCopyClips(['Copy clips: overflow title "Three ways past home"']), new Set(), null);
    expect(early).toContain('data-field="title"');
    const html = copyClipCallout(parseCopyClips(['Copy clips: overflow step-label "Go"']), new Set(['title']), null);
    expect(html).toContain('is-plain');
    expect(html).not.toContain('data-field=');
    expect(html).toContain('This line still clips');
  });
});
