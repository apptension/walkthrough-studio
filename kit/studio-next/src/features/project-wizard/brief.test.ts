import { describe, expect, it } from 'vitest';

import {
  captureChoice,
  captureGroups,
  failureMessage,
  lastStepLabel,
  payload,
  pendingFromViews,
  STOPPED_MESSAGE,
  summaryGroups,
  validate,
  type FormReader,
  type WizardCaptureOption,
} from './brief';

function reader(fields: Record<string, string | boolean | string[]>): FormReader {
  const text = (name: string) => {
    const v = fields[name];
    return typeof v === 'string' ? v : '';
  };
  return {
    val: (name) => text(name).trim(),
    raw: text,
    checked: (name) => fields[name] === true,
    radio: text,
    checkedValues: (name) => {
      const v = fields[name];
      return Array.isArray(v) ? v : [];
    },
  };
}

const basics = { title: 'Invite a teammate', audience: 'New admins', brandMode: 'existing', brandId: 'acme', language: 'en' };

const options: WizardCaptureOption[] = [
  { id: 'desktop-fhd', label: 'Full HD · desktop', group: 'desktop', width: 1920, height: 1080, dpr: 1, reason: 'Matches your screen' },
  { id: 'laptop', label: 'Laptop', group: 'laptop', width: 1440, height: 900, dpr: 2 },
  { id: 'phone', label: 'iPhone · phone', group: 'phone', width: 390, height: 844, dpr: 3, mobile: true, touch: true },
  { id: 'screen', label: 'This screen', group: 'desktop', width: 2560, height: 1440, dpr: 2 },
] as WizardCaptureOption[];

describe('validate', () => {
  it('walks Basics field by field', () => {
    expect(validate(0, reader({}))).toEqual(['Give the video a title.', 'title']);
    expect(validate(0, reader({ ...basics, slug: 'Bad Slug' }))).toEqual(['Slug: lowercase letters, digits and dashes only.', 'slug']);
    expect(validate(0, reader({ ...basics, audience: '' }))).toEqual(['Say who watches — the agent writes for them.', 'audience']);
    expect(validate(0, reader({ ...basics, brandId: '' }))).toEqual(['Pick a brand pack, or discover a new one.', 'brandId']);
    expect(validate(0, reader({ ...basics, language: 'xx' }))).toEqual(['Choose a video language.', 'language']);
    expect(validate(0, reader(basics))).toBeNull();
  });

  it('needs a site to discover a new brand from', () => {
    const fresh = { ...basics, brandMode: 'new', brandName: 'Acme' };
    expect(validate(0, reader({ ...fresh, brandName: '' }))).toEqual(['Name the new brand.', 'brandName']);
    expect(validate(0, reader({ ...fresh, brandUrl: 'acme.com' }))).toEqual(['Brand website must be a full https:// URL.', 'brandUrl']);
    expect(validate(0, reader(fresh))?.[1]).toBe('brandUrl');
    expect(validate(0, reader({ ...fresh, startUrl: 'https://app.acme.com' }))).toBeNull();
  });

  it('checks App access URLs and the Story list', () => {
    expect(validate(1, reader({ startUrl: 'nope' }))).toEqual(['Start URL must be a full https:// URL.', 'startUrl']);
    expect(validate(1, reader({ startUrl: 'https://a.b', appUrl: 'x' }))).toEqual(['App URL must be a full https:// URL.', 'appUrl']);
    expect(validate(2, reader({}))?.[1]).toBe('mustShow');
    expect(validate(2, reader({ captureMode: 'guided' }))).toBeNull();
  });
});

describe('payload', () => {
  it('sends credentials only when typed, and size only for a new project', () => {
    const f = reader({ ...basics, loginRequired: true, email: 'demo@acme.com', password: ' secret ', captureMode: 'agent', outputFormat: 'portrait', lengthSec: '90', plates: ['stats'] });
    const p = payload(f, { newProject: true, capture: captureChoice(options, 'laptop') });
    expect(p.brand).toEqual({ mode: 'existing', id: 'acme' });
    expect(p.app).toMatchObject({ loginRequired: true, email: 'demo@acme.com', password: ' secret ' });
    expect(p.capture).toEqual({ mode: 'agent', size: { preset: 'laptop' } });
    expect(p.output).toEqual({ format: 'portrait' });
    expect(p.story.lengthSec).toBe(90);
    expect(p.proof.plates).toEqual(['stats']);
    const settings = payload(reader({ ...basics, loginRequired: true }), { newProject: false, capture: null });
    expect(settings.app.email).toBeUndefined();
    expect(settings.app.password).toBeUndefined();
    expect(settings.output).toBeUndefined();
    expect(settings.capture).toEqual({ mode: 'agent' });
  });

  it('sends the screen preset with its measured size', () => {
    expect(captureChoice(options, 'screen')).toEqual({ preset: 'screen', width: 2560, height: 1440, dpr: 2 });
    expect(captureChoice(options, 'missing')).toBeNull();
  });
});

describe('captureGroups', () => {
  it('groups devices, widest first', () => {
    expect(captureGroups(options).map(([g, list]) => [g, list.map((o) => o.id)])).toEqual([
      ['Desktop & laptop', ['screen', 'desktop-fhd', 'laptop']],
      ['Phone', ['phone']],
    ]);
  });
});

describe('summaryGroups', () => {
  it('summarises every step, with the agent draft notes', () => {
    const p = payload(reader({ ...basics, mustShow: 'People\nShare', startUrl: 'https://app.acme.com' }), { newProject: true, capture: { preset: 'desktop-fhd' } });
    const groups = summaryGroups(p, {
      brandLabel: 'Acme',
      purposeLabel: 'Product overview',
      captureOptions: options,
      agentBrief: { title: 'x', confidence: 'high', assumptions: ['Admins only'] },
      settings: false,
      settingsBrief: null,
    });
    expect(groups.map((g) => [g.title, g.step])).toEqual([
      ['Video', 0],
      ['App access', 1],
      ['Story', 2],
      ['Proof', 3],
      ['Drafted from your description', 'short'],
    ]);
    const rows = Object.fromEntries(groups.flatMap((g) => g.rows));
    expect(rows['Language']).toBe('English');
    expect(rows['Length · tone']).toBe('~2 min');
    expect(rows['Recorded at']).toBe('Full HD · 1920×1080 · @1x — landscape 16:9 video');
    expect(rows['Chapters']).toBe('1. People\n2. Share');
    expect(rows['Plates']).toBe('None — open and close only');
    expect(rows['Confidence']).toBe('High — the description covered most of it');
    expect(rows['Assumptions']).toBe('• Admins only');
    expect(rows['Open questions']).toBe('None');
  });
});

describe('labels and resume', () => {
  it('names the last step button', () => {
    expect(lastStepLabel({ settings: true, replanPending: false, created: false, runDraft: true })).toBe('Save and replan');
    expect(lastStepLabel({ settings: true, replanPending: true, created: false, runDraft: true })).toBe('Save and resume');
    expect(lastStepLabel({ settings: false, replanPending: false, created: true, runDraft: true })).toBe('Retry preparation');
    expect(lastStepLabel({ settings: false, replanPending: false, created: false, runDraft: true })).toBe('Create & draft');
    expect(lastStepLabel({ settings: false, replanPending: false, created: false, runDraft: false })).toBe('Create project');
  });

  it('reads stops as stops and keeps other errors', () => {
    expect(failureMessage(new Error('boom'), true)).toBe(STOPPED_MESSAGE);
    expect(failureMessage(new Error('cancelled'), false)).toBe(STOPPED_MESSAGE);
    expect(failureMessage(new Error('boom'), false)).toBe('boom');
    expect(failureMessage('plain', false)).toBe('plain');
  });

  it('rebuilds the replan list from unfinished creation stages', () => {
    expect(pendingFromViews(['draft', 'brand'])).toEqual(['discover', 'planner']);
    expect(pendingFromViews([])).toEqual(['planner']);
  });
});
