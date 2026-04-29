// shared-helpers.ts — copy relevant sections into F-NNN.scenarios.ts at Phase 3 time.
// Do not import this file directly — it is a template, not a module.

import { Page, BrowserContext, expect, Response as PWResponse } from '@playwright/test';

// ─── ANALYTICS FILTER ────────────────────────────────────────────────────────
// Use this in any test that asserts "no API calls fired".
// Never assert toHaveLength(0) on an unfiltered request list — analytics fire on every navigation.

export const ANALYTICS_HOSTS =
  /google\.|googleapis\.|doubleclick\.|segment\.|mixpanel\.|amplitude\.|analytics\.|hotjar\.|intercom\.|sentry\.|clarity\.|supabase\.co\/functions\/v1\/track|facebook\.|twitter\.|tiktok\.|reddit\./i;

// ─── ACT() — CLASSIFIED-OUTCOME WRAPPER FOR INTERACTIONS ─────────────────────
// Mirrors qa/scripts/outcome-classifier.js semantics in TS. Every Phase 3
// scenario function should wrap interactions in act() and assert against
// `result.label`, NOT against URL strings or query params.
//
// Why: SPA routers silently strip query params (?mode=signin, ?tab=terms),
// auth pages reset forms without rendering errors, and `toHaveURL` polls a
// URL that may never change. The classifier reads SIX cheap signals at once
// (url, body length, error markers, cookie/storage delta, input emptiness,
// dialog state) and labels the outcome — robust to all three failure modes.
//
// Generic across platforms: the same shape works for macOS AX (cookie/url
// signals replaced with element-tree deltas) — only the snapshot primitive
// changes.

export type ActOpts = {
  isAuth?: boolean;
  /** Extra console-error patterns to allowlist (merged with quirks-derived list). */
  consoleAllowlist?: RegExp[];
  /** Wait after the action settles, in ms. */
  settleMs?: number;
};

export type ActResult = {
  label: 'navigated' | 'dom-updated' | 'modal-opened' | 'error-surfaced'
       | 'auth-rejected-server' | 'form-reset-silent' | 'auth-success'
       | 'network-timeout' | 'no-change';
  evidence: {
    from: string; to: string;
    bodyDelta: number;
    errorText?: string;
    cookieAdded?: boolean;
    tokenAdded?: boolean;
    consoleErrors?: string[];
  };
};

const ERROR_SELECTORS = '[role="alert"], .error, .invalid-feedback, [aria-invalid="true"], .toast, [data-testid*="error"], .alert-danger';
const ERROR_REGEX_SRC = 'invalid|incorrect|failed|wrong|denied|rejected|unauthori[sz]ed|forbidden';
const AUTH_URL_REGEX = /\/(login|signin|auth|session|token)/i;

async function _snapshot(page: Page) {
  return page.evaluate(({ errSel, errRe }) => ({
    url: location.href,
    bodyLen: document.body.innerText.length,
    errorVisible:
      !!document.querySelector(errSel) ||
      new RegExp(errRe, 'i').test(document.body.innerText.slice(0, 4000)),
    errorText: ((document.querySelector(errSel) as HTMLElement)?.innerText || '').slice(0, 200),
    cookieCount: document.cookie.split(';').filter(Boolean).length,
    storageKeys: Object.keys(localStorage).length,
    inputsEmpty: Array.from(document.querySelectorAll('input,textarea')).every(
      (i: any) => !(i as HTMLInputElement).value
    ),
    dialogOpen: !!document.querySelector('[role="dialog"], [aria-modal="true"]'),
  }), { errSel: ERROR_SELECTORS, errRe: ERROR_REGEX_SRC });
}

/**
 * Run `fn` (an interaction) and return a labeled outcome.
 * Replaces `expect(page).toHaveURL(/.../)` and `page.waitForURL(...)` for any
 * post-click verification.
 */
export async function act<T>(
  page: Page,
  fn: () => Promise<T>,
  opts: ActOpts = {}
): Promise<ActResult & { value?: T }> {
  const consoleErrors: string[] = [];
  const onConsole = (msg: any) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); };
  page.on('console', onConsole);

  const before = await _snapshot(page);
  let value: T | undefined;
  let timedOut = false;
  try {
    value = await fn();
  } catch (e: any) {
    if (/timeout/i.test(e?.message || '')) timedOut = true;
    else throw e;
  }
  await page.waitForTimeout(opts.settleMs ?? 400);
  const after = await _snapshot(page);
  page.off('console', onConsole);

  // Filter allowlisted console errors; remaining errors surface in evidence.
  const allow = opts.consoleAllowlist || [];
  const remainingErrors = consoleErrors.filter(e => !allow.some(rx => rx.test(e)));

  let label: ActResult['label'];
  if (timedOut) label = 'network-timeout';
  else if (after.dialogOpen && !before.dialogOpen) label = 'modal-opened';
  else if (after.errorVisible && !before.errorVisible) label = 'error-surfaced';
  else if (opts.isAuth && AUTH_URL_REGEX.test(after.url) && after.inputsEmpty && after.url === before.url && !after.errorVisible) {
    label = 'form-reset-silent';
  } else if (opts.isAuth && (after.cookieCount > before.cookieCount || after.storageKeys > before.storageKeys)) {
    label = 'auth-success';
  } else if (after.url !== before.url) label = 'navigated';
  else if (Math.abs(after.bodyLen - before.bodyLen) > 100) label = 'dom-updated';
  else label = 'no-change';

  const evidence: ActResult['evidence'] = {
    from: before.url,
    to: after.url,
    bodyDelta: after.bodyLen - before.bodyLen,
    errorText: after.errorText,
    cookieAdded: after.cookieCount > before.cookieCount,
    tokenAdded: after.storageKeys > before.storageKeys,
  };
  if (remainingErrors.length) evidence.consoleErrors = remainingErrors;

  return { label, evidence, value };
}

/**
 * Assert that no console errors fired during `fn`, after filtering the
 * provided allowlist (typically loaded from qa/app-quirks.yml). Use INSTEAD of
 * raw `expect(consoleErrors).toHaveLength(0)` — analytics noise gets filtered.
 */
export async function expectConsoleClean(
  page: Page,
  fn: () => Promise<void>,
  allowlist: RegExp[] = []
): Promise<void> {
  const errors: string[] = [];
  const onConsole = (msg: any) => { if (msg.type() === 'error') errors.push(msg.text()); };
  page.on('console', onConsole);
  try {
    await fn();
  } finally {
    page.off('console', onConsole);
  }
  const remaining = errors.filter(e => !allowlist.some(rx => rx.test(e)));
  expect(remaining, `Console errors:\n${remaining.join('\n')}`).toHaveLength(0);
}

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
