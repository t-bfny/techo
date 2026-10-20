import { defineConfig } from '@playwright/test';

// `npm test` builds first, then runs these against `vite preview` (which serves the same
// security headers as the deployed site, see vite.config.js).
// Locally the installed Chrome is used; in CI (or with PW_BUNDLED=1) Playwright's own
// Chromium, installed with `npx playwright install chromium`.
// BASE_URL=https://… runs the same tests against a deployed copy instead (no local server).
const PORT = 4817;
const BASE_URL = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL || `http://localhost:${PORT}`,
    channel: process.env.CI || process.env.PW_BUNDLED ? undefined : 'chrome',
    locale: 'ja-JP',
    colorScheme: 'dark',
    viewport: { width: 1300, height: 800 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: BASE_URL ? undefined : {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
