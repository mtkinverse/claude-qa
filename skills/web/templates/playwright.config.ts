import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const dotenvPath = path.resolve(__dirname, '..', '.env.qa');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
} else {
  console.warn('[qa] .env.qa not found. Preflight (Step W-1.5) will engage the user to create it.');
}
if (!process.env.QA_APP_URL) {
  console.warn('[qa] QA_APP_URL is not set. Preflight (Step W-1.5) will prompt for it.');
}
const HEADLESS = process.env.QA_HEADLESS !== 'false';
const CI = !!process.env.CI;
// __dirname = qa/ directory; REPO_ROOT is always its parent regardless of cwd
const REPO_ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  testDir:       __dirname,
  testMatch:     ['tests/**/*.spec.ts', 'journeys/**/*.spec.ts'],
  // Runtime parallelism: OFF. Journeys share browser session state.
  // Authoring parallelism (multiple flows discovered simultaneously) uses
  // separate Playwright contexts per flow — NOT Playwright workers.
  // See: skills/web/strategies/parallel-authoring.md
  fullyParallel: false,
  forbidOnly:    CI,
  retries:       CI ? 2 : 0,
  workers:       CI ? 2 : 1,
  timeout:       60_000,
  expect:        { timeout: 5_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(REPO_ROOT, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(REPO_ROOT, 'qa/runs/playwright-results.json') }],
  ],
  use: {
    baseURL:           process.env.QA_APP_URL,
    headless:          HEADLESS,
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'on-first-retry',
    actionTimeout:     10_000,
    navigationTimeout: 15_000,
    locale:            'en-US',
  },
  outputDir:   path.join(REPO_ROOT, 'qa/evidence/playwright/'),
  snapshotDir: path.join(REPO_ROOT, 'qa/knowledgebase/visual-baselines/'),
});
