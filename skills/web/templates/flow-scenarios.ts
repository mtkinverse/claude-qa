/**
 * qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts
 *
 * WHAT THIS FILE IS:
 *   Exported async scenario functions for F-NNN: [Flow Name].
 *   These are the reusable core — called by both standalone tests and journey specs.
 *
 * HOW TO USE:
 *   Standalone:  imported by qa/tests/F-NNN-<slug>.spec.ts — each function wrapped in test()
 *   Journey:     imported by qa/journeys/J-NNN-<role>.spec.ts — called via test.step()
 *
 * RULES:
 *   - Each function navigates to its required entry state (page.goto()) unless JSDoc says otherwise
 *   - Functions do NOT call each other — no chaining within this file
 *   - Every function has a meaningful expect() assertion — no TODOs
 *   - No hardcoded credentials — use process.env.QA_*
 *   - Semantic locators: getByRole > getByLabel > getByTestId > CSS
 *   - No bare waitForTimeout — use waitForURL, waitForSelector, waitForResponse
 *   - Document entry/exit state in JSDoc so journeys know what state is left after each call
 *
 * QUALITY CONTRACT (must pass before Phase 4):
 *   [x] Syntactically valid TypeScript — no missing await, no unresolved imports
 *   [x] Every function has expect() — no empty or TODO assertions
 *   [x] No [selector], [route], [label] placeholders remaining
 *   [x] No hardcoded credentials
 *   [x] Semantic locators used (getByRole preferred)
 *   [x] No bare waitForTimeout
 *   [x] Entry/exit state documented in JSDoc
 *
 * NAMING CONVENTION:
 *   S_NNN_NN_camelCaseDescription  (matches scenario ID — S-NNN-NN from scenarios.md)
 */

import { Page, BrowserContext, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.qa') });

// ─────────────────────────────────────────────────────────────────────────────
// HAPPY PATH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-01: Happy Path — [short description]
 * Priority: P1
 * Auth: [none | required — set storageState in caller if needed]
 *
 * Entry: any URL
 * Exit:  page is at '/[route]', [primary element] is visible
 */
export async function S_NNN_01_happyPath(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  // Wait for SPA render — use a specific element, not a timer
  await page.waitForSelector('[role="main"]', { state: 'visible', timeout: 10000 }).catch(() => {});

  // Assertions derived from DOM/ARIA snapshot (qa/knowledgebase/aria-snapshots/[page].snapshot.json)
  await expect(page.getByRole('heading', { name: /[expected heading]/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /[expected CTA]/i })).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE / VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-02: Negative — [invalid input / wrong state description]
 * Priority: P1
 * Auth: none
 *
 * Entry: any URL
 * Exit:  page is at '/[route]', form shows validation error, not submitted
 */
export async function S_NNN_02_negative(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });

  await page.getByLabel(/[field label]/i).fill('[invalid value]');
  await page.getByRole('button', { name: /submit|save|continue/i }).click();

  // Validation error must be visible — form must NOT have navigated
  await expect(page.getByRole('alert')).toContainText(/[expected error text]/i);
  await expect(page).toHaveURL('/[route]');  // URL unchanged confirms no submission
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GUARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-03: Auth Guard — unauthenticated access redirects to signin
 * Priority: P1
 * Auth: none (intentionally unauthenticated — do NOT load storageState before calling)
 *
 * Entry: any URL, no session
 * Exit:  page is at '/account?mode=signin'
 */
export async function S_NNN_03_authGuard(page: Page, _ctx: BrowserContext): Promise<void> {
  // Clear any session cookies to ensure unauthenticated state
  await _ctx.clearCookies();
  await page.goto('/[protected-route]', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/account/, { timeout: 10000 });
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA / NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-04: CTA — "[Button Name]" routes to /[destination]
 * Priority: P1
 * Auth: none
 *
 * Entry: page is at '/[source-route]'  (function navigates there first)
 * Exit:  page is at '/[destination]'
 */
export async function S_NNN_04_ctaRouting(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/[source-route]', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /[button label]/i }).click();
  await page.waitForURL(/\/[destination]/, { timeout: 10000 });
  await expect(page.getByRole('heading', { name: /[destination heading]/i })).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSIBILITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-05: Accessibility — axe-core baseline scan
 * Priority: P2 (runs standalone only — not included in journey by default)
 * Auth: none
 *
 * Entry: any URL
 * Exit:  page is at '/[route]', axe scan completed
 *
 * NOTE: Requires @axe-core/playwright — add to qa/package.json if not present
 */
export async function S_NNN_05_accessibility(page: Page, _ctx: BrowserContext): Promise<void> {
  // Lazy-require to avoid import error when axe is not installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AxeBuilder } = await import('@axe-core/playwright').catch(() => ({ AxeBuilder: null }));
  if (!AxeBuilder) {
    console.warn('[axe] @axe-core/playwright not installed — skipping a11y scan');
    return;
  }

  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');

  if (serious.length > 0) {
    const summary = serious.map(v => `${v.id}: ${v.description}`).join('\n  ');
    throw new Error(`[axe] ${serious.length} critical/serious violation(s):\n  ${summary}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK ERROR RECOVERY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-06: Network Error — API failure shows user-facing error message
 * Priority: P2
 * Auth: none
 *
 * Entry: any URL
 * Exit:  page is at '/[route]', error message visible, form still usable
 */
export async function S_NNN_06_networkError(page: Page, _ctx: BrowserContext): Promise<void> {
  // Intercept the API call and force a 500 response
  await page.route('**/api/[endpoint]', route =>
    route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal Server Error' }) })
  );

  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /submit|save/i }).click();

  // Error message must surface — no silent failure, no spinner stuck
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
  // Form must still be usable after the error
  await expect(page.getByRole('button', { name: /submit|save/i })).not.toBeDisabled();

  // Remove the route intercept so subsequent steps in the same journey are unaffected
  await page.unroute('**/api/[endpoint]');
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION / AUTH-REQUIRED (document auth dependency clearly)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-07: Session Persistence — page survives reload
 * Priority: P2
 * Auth: REQUIRED — caller must load storageState before calling this function.
 *   Standalone: test.use({ storageState: '.auth/free.json' }) in the describe block
 *   Journey:    test.use({ storageState: '.auth/free.json' }) at journey file level
 *
 * Entry: authenticated session loaded in context
 * Exit:  page is at '/[route]' with authenticated content visible
 */
export async function S_NNN_07_sessionPersistence(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/[protected-route]', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /[authenticated heading]/i })).toBeVisible();

  // Reload and verify session survives
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /[authenticated heading]/i })).toBeVisible();
  // Must NOT have redirected to signin
  await expect(page).not.toHaveURL(/\/account/);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL LINK SAFETY (no page navigation needed — DOM inspection only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-NNN-08: External links have target="_blank" + rel="noopener"
 * Priority: P2
 *
 * Entry: any URL
 * Exit:  page is at '/[route]' (no navigation)
 */
export async function S_NNN_08_externalLinkSafety(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/[route]', { waitUntil: 'domcontentloaded' });

  // Collect all external anchors (href starts with http and points off-domain)
  const baseHost = new URL(process.env.QA_APP_URL || 'http://localhost').hostname;
  const externalLinks = await page.locator('a[href^="http"]').evaluateAll(
    (links, host) => links
      .filter(a => !(a as HTMLAnchorElement).href.includes(host))
      .map(a => ({
        href: (a as HTMLAnchorElement).href,
        target: (a as HTMLAnchorElement).getAttribute('target') ?? '',
        rel: (a as HTMLAnchorElement).getAttribute('rel') ?? '',
      })),
    baseHost
  );

  const unsafe = externalLinks.filter(l => l.target !== '_blank' || !l.rel.includes('noopener'));
  if (unsafe.length > 0) {
    throw new Error(
      `External links missing target="_blank" or rel="noopener":\n` +
      unsafe.map(l => `  ${l.href} (target="${l.target}", rel="${l.rel}")`).join('\n')
    );
  }
}
