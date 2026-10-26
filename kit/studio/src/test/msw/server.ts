import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * One MSW server for the whole suite. `setup.ts` resets handlers between tests,
 * so a test that needs a different reply calls `server.use(...)` and does not
 * have to clean up after itself.
 */
export const server = setupServer(...handlers);
