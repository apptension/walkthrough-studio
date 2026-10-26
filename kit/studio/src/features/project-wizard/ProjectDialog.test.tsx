import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoSummary } from '@/api/types';
import { desk, openDialog } from '@/desk/store';
import { makeVideo } from '@/test/factories';

const apiMod = vi.hoisted(() => ({ api: vi.fn(), enc: encodeURIComponent }));
const askMod = vi.hoisted(() => ({ ask: vi.fn(() => Promise.resolve(false)) }));
const jobs = vi.hoisted(() => ({ requestMake: vi.fn(), watchJob: vi.fn(), exportPack: vi.fn() }));
const toastMod = vi.hoisted(() => ({ toast: vi.fn() }));
const video = vi.hoisted(() => ({ refreshSummary: vi.fn(() => Promise.resolve()), openVideo: vi.fn(() => Promise.resolve()) }));
const sheet = vi.hoisted(() => ({ openScript: vi.fn(() => Promise.resolve()) }));
vi.mock('@/desk/api', () => apiMod);
vi.mock('@/desk/ask', () => askMod);
vi.mock('@/desk/jobs', () => jobs);
vi.mock('@/desk/toast', () => toastMod);
vi.mock('@/desk/video', () => video);
vi.mock('@/features/script/sheet', () => sheet);

import { PROJECT_DIALOG_SUB_NEW, PROJECT_DIALOG_SUB_SETTINGS } from './brief';
import { ProjectDialog } from './ProjectDialog';
import { openProjectNew, openProjectSettings, useWizard } from './wizard';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const field = <T extends HTMLElement>(name: string) => document.querySelector<T>(`#projectForm [name="${name}"]`) as T;
const visibleStep = () => [...document.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]')].filter((f) => !f.hidden).map((f) => f.dataset.step);

const BRANDS = {
  brands: [
    { id: 'acme', name: 'Acme', accent: '#ff3366', colors: { ink: '#101010', gold: '#ff3366', text: '#ffffff' }, font: 'Inter' },
    { id: 'demo', name: 'Demo', placeholder: true },
  ],
};
const OPTIONS = {
  options: [
    { id: 'desktop-fhd', label: 'Full HD · desktop', group: 'desktop', width: 1920, height: 1080, dpr: 1, reason: 'Matches your screen' },
    { id: 'phone', label: 'iPhone · phone', group: 'phone', width: 390, height: 844, dpr: 3, mobile: true, touch: true },
  ],
};

beforeEach(() => {
  // jsdom has no Element.scrollTo; showError scrolls the form back to the message.
  if (typeof HTMLElement.prototype.scrollTo !== 'function') HTMLElement.prototype.scrollTo = () => {};
  apiMod.api.mockImplementation((path: string) => {
    if (path === '/api/brands') return Promise.resolve(BRANDS);
    if (path.startsWith('/api/capture/options')) return Promise.resolve(OPTIONS);
    if (path === '/api/video/demo') return Promise.resolve({});
    return Promise.resolve({ ok: true });
  });
});
afterEach(() => {
  act(() => openDialog('project', false));
});

async function openNew() {
  render(<ProjectDialog />);
  await act(() => openProjectNew());
}

function fill(name: string, value: string) {
  const el = field<HTMLInputElement>(name);
  fireEvent.input(el, { target: { value } });
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ProjectDialog — new video', () => {
  it('opens on the one-description brief', async () => {
    await openNew();
    expect($<HTMLDialogElement>('projectDialog').open).toBe(true);
    expect($('projectDialogTitle')).toHaveTextContent('New video');
    expect($('projectDialogSub')).toHaveTextContent(PROJECT_DIALOG_SUB_NEW);
    expect(visibleStep()).toEqual(['short']);
    expect($('wizardSteps')).toHaveAttribute('hidden');
    expect($('btnWizardNext')).toHaveTextContent('Draft the video');
    expect($('wizardStepMeta')).toHaveTextContent('One description');
    expect($('wizardProgressBar').style.width).toBe('8%');
    expect($('btnWizardBack')).toBeDisabled();
    expect($('languageSlotShort').querySelector('#languageField')).not.toBeNull();
    expect([...$<HTMLSelectElement>('wizardBrand').options].map((o) => o.textContent)).toEqual(['Acme', 'Demo (placeholder)']);
  });

  it('groups the recording sizes and starts on Full HD', async () => {
    await openNew();
    await waitFor(() => expect($<HTMLSelectElement>('wizardCapture').options).toHaveLength(2));
    expect([...$('wizardCapture').querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Desktop & laptop', 'Phone']);
    expect($<HTMLSelectElement>('wizardCapture').value).toBe('desktop-fhd');
    expect($('wizardCapture').querySelector('option')).toHaveTextContent('Full HD · 1920×1080 · @1x');
    expect($('wizardCaptureHint')).toHaveTextContent('Suggested — Matches your screen.');
  });

  it('checks the description before drafting', async () => {
    await openNew();
    fireEvent.click($('btnWizardNext'));
    expect($('wizardError')).not.toHaveAttribute('hidden');
    expect($('wizardError')).toHaveTextContent('Describe what to show, for whom, and about how long');
    expect(field('description')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.input(field('description'), { target: { value: 'Show invites' } });
    expect(field('description')).not.toHaveAttribute('aria-invalid');
  });

  it('switches to the five steps and validates each one', async () => {
    await openNew();
    fireEvent.click(document.querySelector('[data-full-brief]') as HTMLButtonElement);
    expect(visibleStep()).toEqual(['0']);
    expect($('wizardSteps')).not.toHaveAttribute('hidden');
    expect($('languageSlotBasics').querySelector('#languageField')).not.toBeNull();
    expect($('btnWizardBack')).toHaveTextContent('Description');
    expect($('btnWizardNext')).toHaveTextContent('Continue');
    expect($('wizardStepMeta')).toHaveTextContent('Step 1 of 5');

    fireEvent.click($('btnWizardNext'));
    expect($('wizardError')).toHaveTextContent('Give the video a title.');

    fill('title', 'Invite a teammate');
    fill('audience', 'New admins');
    fireEvent.change($('wizardLanguage'), { target: { value: 'de' } });
    fireEvent.click($('btnWizardNext'));
    expect(visibleStep()).toEqual(['1']);
    // The language select stays in the hidden Basics fieldset, so later steps still read it.
    expect($<HTMLSelectElement>('wizardLanguage').value).toBe('de');
    act(() => useWizard.setState({ language: 'en' }));
    const steps = [...document.querySelectorAll('#wizardSteps li')];
    expect(steps[0]).toHaveClass('done');
    expect(steps[1]).toHaveClass('active');
    expect(steps[1]?.querySelector('button')).toHaveAttribute('aria-current', 'step');

    fireEvent.click($('btnWizardBack'));
    expect(visibleStep()).toEqual(['0']);
    fireEvent.click($('btnWizardBack'));
    expect(visibleStep()).toEqual(['short']);
  });

  it('shows the conditional fields on change', async () => {
    await openNew();
    fireEvent.click(document.querySelector('[data-full-brief]') as HTMLButtonElement);
    expect(document.querySelector('[data-brand="new"]')).toHaveAttribute('hidden');
    const brandNew = document.querySelector<HTMLInputElement>('input[name="brandMode"][value="new"]') as HTMLInputElement;
    fireEvent.click(brandNew);
    expect(document.querySelector('[data-brand="new"]')).not.toHaveAttribute('hidden');
    expect(document.querySelector('[data-brand="existing"]')).toHaveAttribute('hidden');
    expect($('wizardDiscoverRow')).not.toHaveAttribute('hidden');

    const login = field<HTMLInputElement>('loginRequired');
    fireEvent.click(login);
    expect(document.querySelector('[data-login]')).not.toHaveAttribute('hidden');
    expect(field('email')).toHaveAttribute('placeholder', 'demo@acme.com');

    const guided = document.querySelector<HTMLInputElement>('input[name="captureMode"][value="guided"]') as HTMLInputElement;
    fireEvent.click(guided);
    expect(field('mustShow')).not.toBeRequired();
    expect(document.querySelector('[data-must-show-required]')).toHaveAttribute('hidden');
    expect(field<HTMLTextAreaElement>('mustShow').placeholder).toContain('\nYou will show the actual journey in the browser.');
  });

  it('starts fresh after the dialog is closed and opened again', async () => {
    await openNew();
    fireEvent.input(field('description'), { target: { value: 'Show new admins how to invite a teammate in about 8 minutes' } });
    fireEvent.input(field('shortStartUrl'), { target: { value: 'https://app.acme.com' } });
    fireEvent.click(document.querySelector('[data-full-brief]') as HTMLButtonElement);
    fill('title', 'Invite a teammate');
    fill('audience', 'New admins');
    act(() => useWizard.setState({ lengthSec: 480 }));

    act(() => openDialog('project', false));
    await act(() => openProjectNew());

    expect(visibleStep()).toEqual(['short']);
    expect($('btnWizardNext')).toHaveTextContent('Draft the video');
    expect(field<HTMLTextAreaElement>('description').value).toBe('');
    expect(field<HTMLInputElement>('shortStartUrl').value).toBe('');
    expect(field<HTMLInputElement>('title').value).toBe('');
    expect(field<HTMLInputElement>('audience').value).toBe('');
    expect(useWizard.getState().lengthSec).toBe(120);
    expect(useWizard.getState().mode).toBe('short');
  });

  it('jumps to a step from the nav, validating the steps before it', async () => {
    await openNew();
    fireEvent.click(document.querySelector('[data-full-brief]') as HTMLButtonElement);
    fireEvent.click(document.querySelector('#wizardSteps li[data-step="3"]') as HTMLElement);
    expect(visibleStep()).toEqual(['0']);
    expect($('wizardError')).toHaveTextContent('Give the video a title.');
  });
});

describe('ProjectDialog — settings', () => {
  it('fills the brief from the video and locks the slug', async () => {
    const v = makeVideo({ slug: 'demo', title: 'Demo video', brief: { title: 'Demo video', audience: 'Admins', purpose: 'feature', app: { startUrl: 'https://app.acme.com' }, brand: { id: 'acme' } } as unknown as VideoSummary['brief'] });
    desk.set({ slug: 'demo', video: v });
    render(<ProjectDialog />);
    await act(() => openProjectSettings(v));
    expect($('projectDialog')).toHaveClass('is-project-settings');
    expect($('projectDialogTitle')).toHaveTextContent('Project settings');
    expect($('projectDialogSub')).toHaveTextContent(PROJECT_DIALOG_SUB_SETTINGS);
    expect(field<HTMLInputElement>('title').value).toBe('Demo video');
    expect(field<HTMLInputElement>('slug').value).toBe('demo');
    expect(field('slug')).toBeDisabled();
    expect(document.querySelector<HTMLInputElement>('input[name="purpose"][value="feature"]')?.checked).toBe(true);
    expect(field<HTMLInputElement>('startUrl').value).toBe('https://app.acme.com');
    expect($('btnWizardBack')).toBeDisabled();
    act(() => useWizard.setState({ settings: false, dialogTitle: 'New video', slugDisabled: false, mode: 'steps' }));
  });
});

describe('ProjectDialog — onboarding', () => {
  const frames = () => new Promise((r) => setTimeout(r, 30));

  it('reads the description live and fills it from an example', async () => {
    await openNew();
    const signals = () => [...document.querySelectorAll('.lp-signal.is-on')].map((s) => s.textContent);
    expect(signals()).toEqual([]);
    fireEvent.input(field('description'), { target: { value: 'Show new admins how to invite a teammate in 90 seconds, then the roles' } });
    expect(signals()).toEqual(['For new admins', 'What to show', 'About 1.5 min', '2 moments']);

    fireEvent.click(document.querySelector('.lp-example') as HTMLButtonElement);
    expect(field<HTMLTextAreaElement>('description').value).toMatch(/^Show new admins how to invite a teammate/);
    expect(document.activeElement).toBe(field('shortStartUrl'));

    fireEvent.input(field('shortStartUrl'), { target: { value: 'https://app.acme.com/home' } });
    expect(document.querySelector('.lp-host')).toHaveAttribute('title', 'app.acme.com');
    expect(document.querySelector('.lp-packs')).toHaveTextContent('2 brand packs ready to reuse');
  });

  it('drafts with Cmd+Enter from the description', async () => {
    await openNew();
    fireEvent.keyDown(field('description'), { key: 'Enter', metaKey: true });
    expect($('wizardError')).toHaveTextContent('Describe what to show, for whom, and about how long');
  });

  it('shows brand tiles over the select and a live title card beside the steps', async () => {
    await openNew();
    fireEvent.click(document.querySelector('[data-full-brief]') as HTMLButtonElement);
    await act(frames);
    const tiles = [...document.querySelectorAll<HTMLButtonElement>('.wz-brands .wz-brand:not(.wz-brand-new)')];
    expect(tiles.map((t) => t.querySelector('strong')?.textContent)).toEqual(['Acme', 'Demo']);
    expect(tiles[0]).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(tiles[1] as HTMLButtonElement);
    await act(frames);
    expect($<HTMLSelectElement>('wizardBrand').value).toBe('demo');
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'true');

    expect(document.querySelector('.wzp-poster h4')).toHaveTextContent('Untitled video');
    expect(document.querySelector('.wzp-meter')).toHaveTextContent('Next: Give it a title');
    fill('title', 'Invite a teammate');
    fill('audience', 'New admins');
    await act(frames);
    expect(document.querySelector('.wzp-poster h4')).toHaveTextContent('Invite a teammate');
    expect(document.querySelector('.wzp-poster')).toHaveTextContent('For new admins');
    expect(document.querySelector('.wzp-meter')).toHaveTextContent('Next: Name the outcome');

    fireEvent.click(document.querySelector('input[name="purpose"][value="feature"]') as HTMLInputElement);
    await act(frames);
    expect([...document.querySelectorAll('.wzp-spine li')].map((l) => l.textContent)).toEqual(['Before', 'After', 'Bridge']);

    fireEvent.click(document.querySelector('.wz-brand-new') as HTMLButtonElement);
    await act(frames);
    expect(document.querySelector<HTMLInputElement>('input[name="brandMode"][value="new"]')?.checked).toBe(true);
    expect(document.querySelector('[data-brand="new"]')).not.toHaveAttribute('hidden');
  });
});

