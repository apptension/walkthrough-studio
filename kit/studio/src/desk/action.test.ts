import { describe, expect, it } from 'vitest';

import { makeVideo } from '@/test/factories';

import { decideAction } from './action';

describe('decideAction', () => {
  it('asks for a first render when nothing exists', () => {
    const action = decideAction(
      makeVideo({ hasDelivery: false, recordFailure: null, freshness: { liveAt: null, deliveryAt: null } }),
    );
    expect(action.status).toBe('Not rendered');
    expect(action.primary).toEqual({ label: 'Render', mode: 'full' });
  });

  it('stays quiet when the delivery is current', () => {
    const action = decideAction(
      makeVideo({
        hasDelivery: true,
        recordFailure: null,
        freshness: { liveAt: 1, deliveryAt: 2, stale: false, needsRecord: false },
      }),
    );
    expect(action).toMatchObject({ kind: 'ok', status: 'Up to date', primary: null, secondary: null });
  });

  it('offers a re-record when the flow changed', () => {
    const action = decideAction(
      makeVideo({
        hasDelivery: true,
        recordFailure: null,
        freshness: { liveAt: 1, needsRecord: true, reason: 'flow.json changed' },
      }),
    );
    expect(action.status).toBe('Needs re-record');
    expect(action.primary?.mode).toBe('full');
    expect(action.secondary?.mode).toBe('quick');
    expect(action.detail).toBe('flow.json changed');
  });

  it('offers a plate re-render when the frame check failed', () => {
    const action = decideAction(
      makeVideo({
        hasDelivery: true,
        recordFailure: null,
        freshness: { liveAt: 1, needsRecord: false, plateHealth: { bad: true } },
      }),
    );
    expect(action.status).toBe('Plate check failed');
    expect(action.primary).toEqual({ label: 'Re-render plates', mode: 'plates' });
  });

  it('treats a live take without a delivery as out of date', () => {
    const action = decideAction(
      makeVideo({
        hasDelivery: false,
        recordFailure: null,
        freshness: { liveAt: 1, deliveryAt: null, needsRecord: false, stale: false },
      }),
    );
    expect(action.status).toBe('Out of date');
    expect(action.primary).toEqual({ label: 'Render', mode: 'quick' });
  });

  it('turns a raw record failure into a re-record', () => {
    const action = decideAction(
      makeVideo({
        recordFailure: {
          reason: 'locator.click: Timeout 30000ms exceeded waiting for getByRole("button", { name: "Save" })',
          url: 'https://app.example.com/settings',
        },
      }),
    );
    expect(action.status).toBe('Record failed');
    expect(action.primary).toEqual({ label: 'Re-record', mode: 'full' });
    expect(action.detail).toContain('https://app.example.com/settings');
  });

  it('keeps an already parsed failure', () => {
    const action = decideAction(
      makeVideo({
        recordFailure: {
          reason: 'Could not click Save',
          technical: 'Timeout 30000ms',
          next: 'Check the selector',
          url: 'https://x.test',
        },
      }),
    );
    expect(action.title).toBe('Could not click Save');
    expect(action.reason).toBe('Check the selector');
    expect(action.detail).toBe('Timeout 30000ms · https://x.test');
  });

  it('survives a summary without freshness', () => {
    const video = { ...makeVideo(), freshness: undefined };
    expect(decideAction(video as never).status).toBe('Up to date');
  });
});
