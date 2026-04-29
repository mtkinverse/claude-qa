// shared-helpers.ts — copy relevant sections into F-NNN.scenarios.ts at Phase 3 time.
// Do not import this file directly — it is a template, not a module.

import { Page, BrowserContext, expect } from '@playwright/test';

// ─── ANALYTICS FILTER ────────────────────────────────────────────────────────
// Use this in any test that asserts "no API calls fired".
// Never assert toHaveLength(0) on an unfiltered request list — analytics fire on every navigation.

export const ANALYTICS_HOSTS =
  /google\.|googleapis\.|doubleclick\.|segment\.|mixpanel\.|amplitude\.|analytics\.|hotjar\.|intercom\.|sentry\.|clarity\.|supabase\.co\/functions\/v1\/track|facebook\.|twitter\.|tiktok\.|reddit\./i;

// ─── AUTH GUARD ──────────────────────────────────────────────────────────────
// Call at the start of every function that navigates to a protected route.
// Throws a clear error if the page redirected to login instead of loading the protected route.

export async function assertAuthenticated(page: Page): Promise<void> {
  if (page.url().includes('/account')) {
    throw new Error(
      '[AUTH REQUIRED] Redirected to /account — storageState is missing or expired.\n' +
      'Refresh: node qa/scripts/auth-crawl.js  (run from repo root, not from qa/)'
    );
  }
}

// ─── WIZARD DISMISSAL ────────────────────────────────────────────────────────
// Fresh accounts may show a full-screen onboarding wizard (fixed inset-0 z-[2147483647])
// that blocks ALL pointer events before the main UI is reachable.
// Call dismissWizardIfPresent(page) before interacting with any post-login UI.
//
// ⚠ Adapt the marker strings to the actual wizard UI observed in the ARIA snapshot.
//   Replace '[STEP_N_MARKER]' placeholders with real text from the app.
//   Use { force: true } on ALL clicks inside fixed-position overlays.
//   Some "Continue" buttons are DISABLED until required selections are made —
//   always check isEnabled() before clicking, and handle the selection sequence.

export async function dismissWizardIfPresent(page: Page): Promise<void> {
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });

  for (let attempt = 0; attempt < 8; attempt++) {
    // ── Step N: [e.g. "Choose a Plan"] ──────────────────────────────────────
    // const stepNBtn = page.getByRole('button', { name: '[STEP_N_BUTTON]', exact: true });
    // if (await stepNBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    //   await stepNBtn.click({ force: true });
    //   await page.waitForTimeout(1200);
    //   continue;
    // }

    // ── Step N+1: [e.g. "Setup — persona + task selection required"] ─────────
    // const stepN1Heading = page.getByText('[UNIQUE_HEADING_TEXT]');
    // if (await stepN1Heading.isVisible({ timeout: 1000 }).catch(() => false)) {
    //   await page.getByRole('button', { name: '[PERSONA_BUTTON]', exact: true }).click({ force: true }).catch(() => {});
    //   await page.waitForTimeout(600);
    //   const tasksDropdown = page.getByText(/Select .*/i).first();
    //   if (await tasksDropdown.isVisible({ timeout: 1500 }).catch(() => false)) {
    //     await tasksDropdown.click({ force: true }).catch(() => {});
    //     await page.waitForTimeout(500);
    //     const firstOption = page.locator('[role="option"]').first();
    //     if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    //       await firstOption.click({ force: true }).catch(() => {});
    //     }
    //     await page.keyboard.press('Escape').catch(() => {});
    //     await page.waitForTimeout(400);
    //   }
    //   if (await continueBtn.isEnabled({ timeout: 4000 }).catch(() => false)) {
    //     await continueBtn.click({ force: true });
    //   } else {
    //     await continueBtn.click({ force: true }).catch(() => {});
    //   }
    //   await page.waitForTimeout(1500);
    //   continue;
    // }

    // ── Final step: dismiss/skip button ──────────────────────────────────────
    const dismissBtn = page.getByRole('button', { name: /set up later|skip|dismiss|close/i });
    if (await dismissBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await dismissBtn.click({ force: true });
      await page.waitForTimeout(1000);
      break;
    }

    break; // No wizard markers visible — exit loop
  }
}

// ─── SCENARIO STUBS ──────────────────────────────────────────────────────────
// Copy and adapt these into F-NNN.scenarios.ts.
// Naming: S_NNN_NN_camelCaseDescription — matches scenario ID from scenarios.md exactly.
// Locator values come from qa/knowledgebase/aria-snapshots/ — never guess them.

/**
 * S-001-01: Happy Path — landing page loads with hero and primary CTAs
 * Entry: any  |  Exit: page at '/'
 */
export async function S_001_01_happyPath(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Use text from qa/knowledgebase/aria-snapshots/home.snapshot.json → dom.headings[0]
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // exact: true prevents partial match — 'Sign up' would also match 'Sign up for Free'
  await expect(page.getByRole('link', { name: /sign up|get started|register/i }).first()).toBeVisible();
}

/**
 * S-001-02: CTA — primary sign-up CTA navigates to the registration page
 * Entry: page at '/'  |  Exit: page at signup/registration URL
 *
 * ⚠ Adapt the button/link name and expected URL regex to match the app.
 */
export async function S_001_02_ctaSignUp(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /sign up|get started|register/i, exact: false }).first().click();
  // toHaveURL polls the current URL — works whether SPA navigation was fast or slow.
  // waitForURL would miss a synchronous navigation that already completed before the call.
  await expect(page).toHaveURL(/\/(signup|register|account|join)/, { timeout: 10000 });
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
}

/**
 * S-001-06: Negative — interactive demo/widget must not fire real API calls without auth
 * Entry: any  |  Exit: page at '/' or auth redirect (both acceptable)
 *
 * Only flags POST requests to non-analytics endpoints (see ANALYTICS_HOSTS filter).
 * ⚠ Adapt the placeholder selector to the actual demo input in the snapshot.
 */
export async function S_001_06_demoWidgetNoSubmit(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const apiCalls: string[] = [];
  page.on('request', r => {
    if (r.method() === 'POST' && !ANALYTICS_HOSTS.test(r.url())) {
      apiCalls.push(`${r.method()} ${r.url()}`);
    }
  });
  const demoInput = page.getByPlaceholder(/try|demo|type a message/i).first();
  if (await demoInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await demoInput.fill('hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  }
  expect(apiCalls, `Unexpected API calls from demo widget: ${apiCalls.join(', ')}`).toHaveLength(0);
}

/**
 * S-001-10: Accessibility — axe-core baseline scan (warn only, never fail CI)
 * Entry: any  |  Exit: page at '/', axe scan logged
 *
 * Violations are app defects tracked separately — must not block CI.
 * Always console.warn, never throw. Only critical/serious impact reported.
 */
export async function S_001_10_accessibility(page: Page, _ctx: BrowserContext): Promise<void> {
  const { AxeBuilder } = await import('@axe-core/playwright').catch(() => ({ AxeBuilder: null as any }));
  if (!AxeBuilder) { console.warn('[axe] @axe-core/playwright not installed — skipping'); return; }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v: { impact?: string }) =>
    v.impact === 'critical' || v.impact === 'serious'
  );
  if (serious.length > 0) {
    console.warn(`[axe] ${serious.length} violation(s) on /:\n` +
      serious.map((v: { id: string; description: string }) => `  ${v.id}: ${v.description}`).join('\n'));
  }
}

/**
 * S-NNN-01: Happy Path — main authenticated page renders correctly
 * Entry: authenticated session via storageState  |  Exit: page at app's main route
 *
 * ⚠ Adapt route and heading assertions to what the ARIA snapshot shows.
 * Requires: test.use({ storageState: '.auth/user.json' }) in the spec wrapper.
 */
export async function S_NNN_01_happyPath(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await assertAuthenticated(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/**
 * S-NNN-13: Post-wizard sidebar tab — primary nav tab swaps panel
 * Entry: authenticated session  |  Exit: authenticated route, primary panel visible
 *
 * Calls dismissWizardIfPresent() — fresh accounts may have an onboarding wizard
 * overlaying the main UI until dismissed.
 *
 * ⚠ Adapt the tab button name and panel heading to what the ARIA snapshot shows.
 */
export async function S_NNN_13_sidebarTab(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await assertAuthenticated(page);
  await dismissWizardIfPresent(page);
  // Tab button name from ARIA snapshot: dom.buttons[N].name — always exact: true
  await page.getByRole('button', { name: '[TAB_NAME]', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: /[panel heading]/i })).toBeVisible({ timeout: 5000 });
}
