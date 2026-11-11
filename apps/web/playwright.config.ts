import { defineConfig, devices } from '@playwright/test';

// E2E runs the built API (in-memory PGlite, synthetic demo seed) and the built
// web app on dedicated ports so a running dev stack is not disturbed.
// Locally an installed browser channel is used (PW_CHANNEL, default msedge on
// Windows); CI installs Playwright's Chromium and leaves PW_CHANNEL empty.
export const E2E_PASSWORD = 'e2e-only-password';
const API_PORT = 4400;
const WEB_PORT = 3400;
const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './e2e',
  // Needs an owner in the seed, which changes staff rules: playwright.daily.config.ts.
  testIgnore: /(daily-reports|system-admin)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1366, height: 860 } },
      testIgnore: /mobile\.spec\.ts|(daily-reports|system-admin)\.spec\.ts/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testMatch: /(mobile|screenshots)\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        APP_ENV: 'development',
        DB_DRIVER: 'pglite',
        PGLITE_DATA_DIR: 'memory://',
        SEED_DEMO_PASSWORD: E2E_PASSWORD,
        API_PORT: String(API_PORT),
        NODE_ID: 'e2e',
        // The suite logs in as several roles from one address within a minute.
        LOGIN_RATE_LIMIT: '200',
        // Reminders depend on the time of day; their browser test mocks the inbox.
        DAILY_SCHEDULER: 'false',
        // The browser suite counts the five base demo cases; screenshots of a full
        // workshop use DEMO_FLEET=true (docs/TEST_REPORT.md).
        DEMO_FLEET: process.env.DEMO_FLEET ?? 'false',
        // Synthetic key allows the manual staff-invitation fallback to use
        // the real API without enabling personal-mode login for demo roles.
        AUTH_TOKEN_SECRET: 'e2e-synthetic-only-authenticator-key',
      },
    },
    {
      command: `pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_INTERNAL_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
