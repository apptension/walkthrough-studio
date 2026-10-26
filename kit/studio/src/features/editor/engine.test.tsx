import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { bridges } from '@/desk/bridge';
import { desk } from '@/desk/store';
import { makeScene } from '@/test/factories';

import { accentOverrideCount, chrome } from './engine/chrome';
import { editorApi } from './engine/lifecycle';
import { plateBridge, registerEditorBridges } from './engine/mount';
import { inferPlateIdFromFeedback, resetPlateForTests } from './engine/plate';
import { plateCssSec } from './engine/plateCss';
import { ed, resetEdForTests } from './engine/state';
import type { Deck } from './engine/types';
import { zen } from './engine/util';
import { PlatePane } from './PlatePane';

beforeEach(() => {
  desk.reset();
  chrome.reset();
  resetEdForTests();
  resetPlateForTests();
  bridges.editor = null;
  bridges.plate = null;
});

describe('zen()', () => {
  it('builds the zen.js markup with escaped copy', () => {
    const html = zen('film', 'No <chapters>', 'a & b', { mini: true, id: 'z1', hidden: true, cls: 'extra' });
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild as HTMLElement;
    expect(el).toHaveAttribute('class', 'zen mini extra');
    expect(el).toHaveAttribute('id', 'z1');
    expect(el).toHaveAttribute('hidden');
    expect(el).toHaveAttribute('data-zen', 'film');
    expect(el.querySelector('.zen-title')).toHaveTextContent('No <chapters>');
    expect(el.querySelector('.zen-sub')).toHaveTextContent('a & b');
  });

  it('omits the sub line when empty and passes html through when asked', () => {
    expect(zen('pointer', 'T')).not.toContain('zen-sub');
    expect(zen('pointer', 'T', '<b>x</b>', { html: true })).toContain('<p class="zen-sub"><b>x</b></p>');
  });
});

describe('inferPlateIdFromFeedback', () => {
  beforeEach(() => {
    desk.set({
      scenes: [
        makeScene(),
        makeScene({ id: 'feature-tour', title: 'Feature tour', type: 'interstitial', plateId: 'feature-tour' }),
        makeScene({ id: 'live-1', kind: 'live', editable: false, plateId: null, title: 'Dashboard' }),
      ],
    });
  });

  it('matches a named plate', () => {
    expect(inferPlateIdFromFeedback('Make the Feature tour card warmer')).toBe('feature-tour');
  });

  it('maps intro / outro words and logo sizing', () => {
    expect(inferPlateIdFromFeedback('a calmer opening')).toBe('open');
    expect(inferPlateIdFromFeedback('shorter ending')).toBe('close');
    expect(inferPlateIdFromFeedback('make the logo bigger')).toBe('open');
  });

  it('ignores live scenes and vague notes', () => {
    expect(inferPlateIdFromFeedback('the dashboard is slow')).toBeNull();
    expect(inferPlateIdFromFeedback('')).toBeNull();
    expect(inferPlateIdFromFeedback(null)).toBeNull();
  });
});

describe('plateCssSec', () => {
  it('reads seconds and milliseconds from CSS custom properties', () => {
    const doc = document.implementation.createHTMLDocument('plate');
    doc.documentElement.style.setProperty('--plate-dur', '4.5s');
    doc.body.style.setProperty('--plate-peak', '900ms');
    expect(plateCssSec(doc, '--plate-dur')).toBe(4.5);
    expect(plateCssSec(doc, '--plate-peak')).toBe(0.9);
    expect(plateCssSec(doc, '--missing')).toBeNull();
  });
});

describe('accentOverrideCount', () => {
  it('counts only accent keys', () => {
    expect(accentOverrideCount(['atmosphere', 'sheen', 'palette', 'energy'])).toBe(3);
    expect(accentOverrideCount([])).toBe(0);
  });
});

describe('editorApi getters', () => {
  it('maps the engine selection and scenes', () => {
    expect(editorApi.selection).toBeNull();
    expect(editorApi.hasScenes).toBe(false);
    ed.sel = { type: 'clip', i: 2 };
    expect(editorApi.selection).toEqual({ kind: 'clip' });
    ed.deck = { scenes: [{ id: 'open' }] } as unknown as Deck;
    expect(editorApi.hasScenes).toBe(true);
    expect(editorApi.active).toBe(false);
  });
});

describe('bridges', () => {
  it('registerEditorBridges sets and clears only its own bridges', () => {
    const cleanup = registerEditorBridges();
    expect(bridges.editor).toBe(editorApi);
    expect(bridges.plate).toBe(plateBridge);
    cleanup();
    expect(bridges.editor).toBeNull();
    expect(bridges.plate).toBeNull();

    const cleanup2 = registerEditorBridges();
    const other = { ...plateBridge };
    bridges.plate = other;
    cleanup2();
    expect(bridges.plate).toBe(other);
  });

  it('PlatePane registers the bridges on mount and clears them on unmount', () => {
    const { unmount } = render(<PlatePane />);
    expect(bridges.editor).toBe(editorApi);
    expect(bridges.plate).toBe(plateBridge);
    unmount();
    expect(bridges.editor).toBeNull();
    expect(bridges.plate).toBeNull();
  });

  it('the plate bridge exposes every legacy entry point', () => {
    for (const key of [
      'rebuildPlateHtmlPreview',
      'openPlateFromScene',
      'fitFhdPreview',
      'ensureFhdFitObserver',
      'previewPlateAfterEdit',
      'approvePlateOnly',
      'savePlateCopyEdits',
      'showPlateHtml',
      'editCurrentPlate',
      'loadPlateFrame',
      'askAiForCurrentScene',
      'openMotionForCurrentScene',
      'inferPlateIdFromFeedback',
      'discardPlateCopyEdits',
      'replayPlateInline',
    ] as const) {
      expect(typeof plateBridge[key]).toBe('function');
    }
  });
});
