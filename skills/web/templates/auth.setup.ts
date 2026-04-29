// auth.setup.ts — Playwright `setup` project saves auth state for reuse.
// IMPORTANT: this is a STARTER. After copying, read Phase 1 auth-gate snapshots
// and adapt selectors (login URL, field labels, button text, post-login URL)
// to match this app's actual DOM. Generic selectors here may not work everywhere.

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto(process.env.QA_APP_URL || '/');

  // Navigate to login — adapt selectors per app
  await page.getByRole('link', { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/login|signin|auth/, { timeout: 10000 }).catch(() => {});

  await page.getByLabel(/email/i).fill(process.env.QA_TEST_EMAIL || '');
  await page.getByLabel(/password/i).fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

  // Wait for post-login state — adapt to app
  await page.waitForURL(/dashboard|home|app/, { timeout: 15000 }).catch(() => {});

  await page.context().storageState({ path: AUTH_FILE });
});
