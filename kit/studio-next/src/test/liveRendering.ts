import { afterEach, beforeEach } from 'vitest';

const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * For suites that drive a real runtime (boot, polling, a ticking clock): its updates
 * land on its own timers and requests, outside any act() scope, and the assertions
 * wait for them with `waitFor`.
 */
export function allowLiveRendering(): void {
  beforeEach(() => {
    env.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(() => {
    env.IS_REACT_ACT_ENVIRONMENT = true;
  });
}
