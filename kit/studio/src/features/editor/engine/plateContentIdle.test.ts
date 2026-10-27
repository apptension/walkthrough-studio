import { describe, expect, it } from 'vitest';

import { contentSaveIdle, hasContentPending, kickContentPending, resetPlateContentPane } from './plateContentPane';

describe('content save queue (idle)', () => {
  it('starts empty after resetPlateContentPane', () => {
    resetPlateContentPane();
    expect(hasContentPending()).toBe(false);
  });

  it('contentSaveIdle resolves when the queue is empty', async () => {
    resetPlateContentPane();
    await contentSaveIdle();
  });

  it('kickContentPending does not throw when nothing is debounced', () => {
    resetPlateContentPane();
    kickContentPending();
    expect(hasContentPending()).toBe(false);
  });
});
