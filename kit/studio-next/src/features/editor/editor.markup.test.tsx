import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { desk } from '@/desk/store';

import { EdStatus } from './EdStatus';
import { EdTimeline } from './EdTimeline';
import { EdTransport } from './EdTransport';
import { chrome } from './engine/chrome';
import { resetPlateForTests } from './engine/plate';
import { resetEdForTests } from './engine/state';
import { InspectorTab } from './InspectorTab';
import { PlateEditBar } from './PlateEditBar';
import { PlatePane } from './PlatePane';
import { PlatePicker } from './PlatePicker';
import { SafeAreaOverlay } from './SafeAreaOverlay';
import { SceneBar } from './SceneBar';
import { TlLockHint } from './TlLockHint';

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

beforeEach(() => {
  desk.reset();
  chrome.reset();
  resetEdForTests();
  resetPlateForTests();
});

describe('editor markup contract', () => {
  it('PlatePane renders the stage, plate frame and engine containers', () => {
    render(<PlatePane />);
    const pane = $('playerPlate');
    expect(pane).toHaveClass('player-mode', 'plate-mode');
    expect(pane).toHaveAttribute('hidden');
    const frame = $('plateFrame');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('title', 'Plate HTML preview');
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin allow-scripts');
    expect($('fhdFit')).toHaveClass('fhd-fit');
    expect($('fhdCanvas')).toHaveClass('fhd-canvas');
    expect($('plateEmpty')).toHaveAttribute('hidden');
  });

  it('PlatePane follows monitorMode', () => {
    render(<PlatePane />);
    expect($('playerPlate')).toHaveAttribute('hidden');
    act(() => desk.set({ monitorMode: 'plate' }));
    expect($('playerPlate')).not.toHaveAttribute('hidden');
  });

  it('TlLockHint shows only in the plate monitor', () => {
    render(<TlLockHint />);
    expect($('tlLockHint')).toHaveAttribute('hidden');
    act(() => desk.set({ monitorMode: 'plate' }));
    expect($('tlLockHint')).not.toHaveAttribute('hidden');
  });

  it('SceneBar matches the legacy page-load bar', () => {
    render(<SceneBar />);
    expect($('sceneBar')).toHaveClass('scene-bar');
    expect($('sceneKind')).toHaveTextContent('—');
    expect($('sceneKind')).toHaveAttribute('class', 'scene-kind');
    expect($('sceneTitle')).toHaveTextContent('No scene');
    expect($('sceneHint')).toHaveTextContent('Play or scrub the timeline');
    expect($('btnEditScene')).toBeDisabled();
    expect($('btnEditScene')).toHaveAttribute('class', 'btn primary compact icon-text');
    expect($('btnEditScene')).toHaveAttribute('title', 'Open plate editor — click text to change copy');
    expect($('btnEditSceneLabel')).toHaveTextContent('Edit plate');
    expect($('btnAskAiScene')).toBeDisabled();
    expect($('btnAskAiScene')).toHaveTextContent('Ask AI');
    expect($('btnMotionScene')).toBeDisabled();
    expect($('btnMotionScene')).toHaveTextContent('Motion');
    expect($('sceneChips')).toHaveAttribute('aria-label', 'Plate scenes');
    expect($('sceneChips')).toHaveAttribute('hidden');
    expect($('sceneChips')).toBeEmptyDOMElement();
  });

  it('PlateEditBar matches the legacy bar and accent popover', () => {
    render(<PlateEditBar />);
    const bar = $('plateEditBar');
    expect(bar).toHaveAttribute('class', 'plate-edit-bar');
    expect(bar).toHaveAttribute('hidden');
    expect($('plateEditHint').innerHTML).toBe('Click any text on the plate to edit · <kbd>*</kbd>word<kbd>*</kbd> for accent');
    expect($('plateAccent')).toHaveAttribute('hidden');
    expect($('btnPlateAccent')).toHaveAttribute('aria-expanded', 'false');
    expect($('btnPlateAccent')).toHaveAttribute('aria-haspopup', 'dialog');
    expect($('plateAccentPop')).toHaveAttribute('hidden');
    expect($('plateAccentPop')).toHaveAttribute('role', 'dialog');
    expect($('plateAccentState')).toHaveTextContent('Follows the video');
    for (const id of ['accentAtmosphere', 'accentReveal', 'accentDepth', 'accentEnergy']) {
      expect([...$(id).querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Video default']);
    }
    expect([...$('accentSheen').querySelectorAll('option')].map((o) => o.value)).toEqual(['', 'on', 'off']);
    expect($('btnAccentReset')).toBeDisabled();
    expect($('btnAccentClose')).toHaveTextContent('Done');
    expect($('btnPlateReplay')).toBeEnabled();
    expect($('btnPlateDiscardEdits')).toBeDisabled();
    expect($('btnPlateSaveCopy')).toBeDisabled();
    expect($('btnPlateSaveCopy')).toHaveAttribute('class', 'btn tiny primary');
    expect($('btnPlateExit')).toHaveTextContent('Program');
  });

  it('PlatePicker is hidden with an empty list', () => {
    render(<PlatePicker />);
    expect($('platePicker')).toHaveAttribute('hidden');
    expect($('platePicker')).toHaveClass('plate-picker');
    expect($('platePickerList')).toBeEmptyDOMElement();
  });

  it('InspectorTab starts with the "Nothing picked yet" zen', () => {
    render(<InspectorTab />);
    const root = $('inspectorRoot');
    const zen = root.querySelector('.zen[data-zen="pointer"]');
    expect(zen).not.toBeNull();
    expect(root.querySelector('.zen-title')).toHaveTextContent('Nothing picked yet 👆');
    expect(root.querySelector('[data-open-editor]')).not.toBeNull();
  });

  it('EdTimeline reflects the collapsed timeline on #etlToggle', () => {
    render(<EdTimeline />);
    const toggle = $('etlToggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('title', 'Collapse the timeline');
    act(() => toggle.click());
    expect(desk.get().tlCollapsed).toBe(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('title', 'Expand the timeline');
    expect(document.body).toHaveClass('tl-collapsed');
    act(() => toggle.click());
    expect(document.body).not.toHaveClass('tl-collapsed');
  });

  it('EdTransport matches the legacy transport', () => {
    render(<EdTransport />);
    expect($('edTransport')).toHaveClass('ed-transport');
    const ids = [...$('edTransport').querySelectorAll('button')].map((b) => b.id);
    expect(ids).toEqual(['edToStart', 'edPlay', 'edReplay', 'edEditText', 'edLoop', 'edFx', 'edSound', 'edFullscreen']);
    expect($('edPlay')).toHaveAttribute('aria-label', 'Play');
    expect($('edEditText')).toHaveAttribute('hidden');
    expect($('edEditText')).toHaveAttribute('aria-pressed', 'false');
    expect($('edFx')).toHaveClass('is-on');
    expect($('edSound')).toHaveClass('is-on');
    expect($('edLoop')).not.toHaveClass('is-on');
  });

  it('EdStatus starts hidden and empty', () => {
    render(<EdStatus />);
    expect($('edStatus')).toHaveClass('ed-status');
    expect($('edStatus')).toHaveAttribute('hidden');
    expect($('edStatus')).toBeEmptyDOMElement();
  });

  it('SafeAreaOverlay follows the reel safe-area toggle', () => {
    render(<SafeAreaOverlay />);
    expect($('safeAreaOverlay')).toHaveAttribute('hidden');
    expect($('safeAreaOverlay')).toHaveAttribute('aria-hidden', 'true');
    expect($('safeAreaOverlay')).toHaveTextContent('9:16 safe area');
    act(() => desk.set({ reelSafeArea: true }));
    expect($('safeAreaOverlay')).not.toHaveAttribute('hidden');
  });
});
