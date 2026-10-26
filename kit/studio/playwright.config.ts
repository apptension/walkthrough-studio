import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end runs against the real desk: Vite serves the app and a small stub
 * stands in for the studio server, so a spec exercises the same network surface
 * the legacy backend exposes without needing a project on disk or an API key.
 *
 * `STUDIO_ORIGIN` points Vite's proxy at the stub; override it to run the specs
 * against a real studio instead (`STUDIO_ORIGIN=http://127.0.0.1:4747`).
 */
const STUB_PORT = Number(process.env.STUDIO_STUB_PORT ?? 4846);
const APP_PORT = Number(process.env.STUDIO_E2E_PORT ?? 4847);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx vite-node e2e/fixtures/stub-studio.ts -- --port ${STUB_PORT}`,
      url: `http://127.0.0.1:${STUB_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: !process.env.CI,
      stdout: 'ignore',
      env: { STUDIO_ORIGIN: `http://127.0.0.1:${STUB_PORT}` },
    },
  ],
});
