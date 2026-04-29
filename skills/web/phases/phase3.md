# Web — Phase 3: Test Generation (Three-Layer Spec Suite)

**Goal**: Write shippable, runnable test code in three coordinated layers — scenario functions, standalone wrappers, sequential E2E journeys. No intermediate TC markdown files.
**Input**: `qa/flows/F-NNN-*/scenarios.md` + DOM/ARIA snapshots from Phase 1.
**Output**:
- `qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts` — exported async scenario functions (reusable core)
- `qa/tests/F-NNN-<slug>.spec.ts` — thin standalone wrappers
- `qa/journeys/J-NNN-<role>.spec.ts` — sequential E2E journeys (shared session, `test.step()` chains)
- `qa/journey-todo/J-NNN-<role>.todo.md` — generation + runtime tracking per journey

**Transition**: automatic — after all flow specs + journeys written, Phase 4 runs them.

Runtime rules — see `skills/_shared/runtime.md`.

---

## Context Management — Critical

Write ONE flow's `F-NNN.scenarios.ts` per context window. After each flow:
1. Write `F-NNN.scenarios.ts` + `qa/tests/F-NNN-<slug>.spec.ts`
2. Append `test.step()` calls into the relevant `qa/journeys/J-NNN.spec.ts`
3. Mark flow done in `qa/journey-todo/J-NNN.todo.md`
4. Light checkpoint `qa/state.md`
5. Tell user: *"F-NNN done ([N] functions). Next: F-[NNN+1] — [name]. Say 'continue'."*

Never write multiple flows in one context if the previous flow had >25 functions.

---

## Step W-10: Three-Layer Spec Writing

### Quality Contract — every function and spec MUST satisfy ALL before Phase 4

1. **Syntactically valid TypeScript** — no missing `await`, no unresolved imports, no `any` on assertions.
2. **Logically complete** — every function body has a meaningful `expect()`. No `// TODO`, no empty assertions.
3. **No placeholder values** — no `[selector]`, `[route]`, `[label]`, `[value]`.
4. **No hardcoded credentials** — all via `process.env.QA_*`.
5. **Semantic locators preferred** — `getByRole` > `getByLabel` > `getByTestId` > CSS. CSS only with a comment.
6. **No bare `waitForTimeout`** — use `waitForSelector` / `waitForResponse` / `waitForURL` / `waitForFunction`.
7. **storageState set at describe level or via journey config** — never re-login inside a function that expects a cached session.
8. **`toHaveURL` over `waitForURL` for post-click checks** — `waitForURL` waits for a future navigation event; if the SPA navigated synchronously during the click, it waits forever for a second one. `toHaveURL` polls the current URL and works whether the navigation was fast or slow. Use `waitForURL` only when you need to wait for a navigation that has NOT started yet.
9. **`exact: true` on every string `getByRole` name** — Playwright partial-matches by default, causing strict-mode errors when a short name is a prefix of a longer one (e.g. `"Sign up"` matches `"Sign up for Free"`, `"$5"` matches `"$50"`). Always pass `{ exact: true }` unless using a regex name.
10. **URL assertions use regex; never assert query params on SPAs** — `toHaveURL('/')` is fragile. Always use regex: `toHaveURL(/\/path/)`. Do NOT assert SPA query params (`?mode=signin`, `?tab=terms`) — client-side routers silently strip or never set them. Do NOT use `waitForURL(/param=value/)` when a form-mode toggle works via JS state — assert *form state* instead (e.g. a field that only appears in one mode).
11. **axe-core violations are warnings, not failures** — use `console.warn()` for violations; only `throw` if axe itself failed to run. Filter to `impact === 'critical' || impact === 'serious'`.
12. **`inputValue()` not `textContent()` for form elements** — `textContent()` always returns `""` on `<select>`, `<input>`, `<textarea>`. Use `inputValue()`. Check the ARIA snapshot to confirm which role (`textbox` vs `combobox`) the target field has before writing the locator.
13. **Stateful buttons — assert the NEW label for the second action** — toggle buttons (`show/hide password`, `expand/collapse`, mode-switch) have a different `name` after each click. Never click the same name twice. Read the ARIA snapshot to know the label in each state.

### Standards

- `waitUntil: 'domcontentloaded'` (never `networkidle` on SPAs)
- All URLs relative — `page.goto('/')` not `page.goto('https://...')`
- `baseURL` from `QA_APP_URL` via `qa/playwright.config.ts`
- Credentials from `process.env.QA_*` only
- Locators derived from `.snapshot.json` files — `aria-label`, `role`, `name`, `placeholder`

---

---

## Auth Crawl Strategy (W-7 / `auth-crawl.js`)

Always try **signup first**, fall back to login if the account already exists:

1. Navigate to the app's signup page (from Phase 1 nav-graph) → fill email + password + confirm-password → submit.
2. Classify result via `armAuthWatcher` — arm `waitForResponse` for auth POSTs **before** clicking submit, never rely on URL change alone:
   - `auth-success` → save `storageState` to `qa/.auth/<role>.json`, add `QA_<ROLE>_STORAGE_STATE=qa/.auth/<role>.json` to `.env.qa`.
   - `user-already-exists` / `auth-rejected-server` / `error-surfaced` → fall back to the signin page → fill email + password → submit.
3. **Run `auth-crawl.js` from the repo root** — `dotenv` resolves `.env.qa` relative to `process.cwd()`, not `__dirname`. The script should walk up from `__dirname` to find `.env.qa` automatically.

---

## Shared Helper Patterns

Every `F-NNN.scenarios.ts` that needs the patterns below should copy them from `skills/web/templates/shared-helpers.ts`. Do not inline them by hand — copy the file section verbatim.

| Helper | When to use |
|---|---|
| `ANALYTICS_HOSTS` | Any test that asserts "no API calls fired" — filter this regex from the `request` listener |
| `assertAuthenticated(page)` | First line of every function that navigates to a protected route |
| `dismissWizardIfPresent(page)` | Any scenario that tests post-login UI on a fresh account (wizard may overlay the main UI) |

**API-call monitors must exclude analytics** — never assert `toHaveLength(0)` on an unfiltered request list. Analytics fire on every navigation. Use `ANALYTICS_HOSTS` to filter.

**Auth guard** — at the start of every auth-required function, call `assertAuthenticated(page)`. If the page redirected to `/account`, throw a clear error with the refresh command.

**Onboarding wizard** — fresh accounts may show a full-screen wizard (`fixed inset-0 z-[2147483647]`) that blocks all pointer events. Call `dismissWizardIfPresent(page)` before interacting with post-login UI. Adapt the step markers in the template to the observed app (read the ARIA snapshot of the post-login page first).

→ See `skills/web/templates/shared-helpers.ts` for canonical implementations.

---

### Layer 1: Scenario Functions (`qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts`)

Each scenario from `scenarios.md` becomes an exported async function receiving `page` and `context` from the caller. Plain async — no Playwright fixtures beyond `Page` and `BrowserContext`.

```typescript
// qa/flows/F-001-marketing-landing/F-001.scenarios.ts
// Callable from standalone tests OR journey specs.
//
// Entry state: any (functions navigate as needed)
// Exit state:  documented per function in JSDoc

import { Page, BrowserContext, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env.qa') });

/**
 * S-001-01: Happy Path — home loads with hero + CTAs
 * Entry: any URL  |  Exit: page is at '/'
 */
export async function S_001_01_happyPath(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Say hello/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
}

/**
 * S-001-02: CTA — "Sign up" routes to /account
 * Entry: page is at '/'  |  Exit: page is at '/account'
 */
export async function S_001_02_ctaSignUp(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.waitForURL(/\/account/, { timeout: 10000 });
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
}

// ... one exported function per scenario in scenarios.md
// Naming: S_NNN_NN_camelCaseDescription — matches scenario ID exactly
```

**Rules:**
- **Self-contained navigation**: each function navigates to its entry URL at start (unless JSDoc says it continues from caller's position).
- **No cross-function calls.**
- **Entry/exit documented** in JSDoc — tells the journey what state is left.
- **Journey-continuation functions**: if function N's exit = function N+1's entry, the journey can skip the redundant `page.goto()` in N+1 — note this in JSDoc.

---

### Layer 2: Standalone Spec Wrappers (`qa/tests/F-NNN-<slug>.spec.ts`)

Thin files that import the scenario module and wrap each function in `test()`. Each test gets a fresh page; functions self-navigate.

```typescript
// qa/tests/F-001-marketing-landing.spec.ts
import { test } from '@playwright/test';
import * as F001 from '../flows/F-001-marketing-landing/F-001.scenarios';

test.describe('F-001: Marketing Landing', () => {
  test('S-001-01: Happy path', async ({ page, context }) => {
    await F001.S_001_01_happyPath(page, context);
  });

  test('S-001-02: CTA — Sign up routes to /account', async ({ page, context }) => {
    await page.goto('/');  // explicit reset
    await F001.S_001_02_ctaSignUp(page, context);
  });
});
```

Run: `npx playwright test tests/F-001-marketing-landing.spec.ts`

**Mixed-auth flows** — use `test.use()` per group:

```typescript
test.describe('F-003: Auth — unauthenticated', () => {
  test('S-003-01: Sign in happy path', async ({ page, context }) => {
    await F003.S_003_01_signIn(page, context);
  });
});

test.describe('F-003: Auth — session-required', () => {
  test.use({ storageState: '.auth/free.json' });  // relative to qa/
  test('S-003-14: Session persistence', async ({ page, context }) => {
    await F003.S_003_14_sessionPersistence(page, context);
  });
});
```

---

### Layer 3: Sequential Journey Specs (`qa/journeys/J-NNN-<role>.spec.ts`)

ONE `test()` block per journey. Every scenario call is a `test.step()` for granular reporting. Same `page` and `context` flow through the entire journey.

Selection: include all **P1** + **P2 stateful** scenarios (next flow depends on them). Skip P3 — covered by standalone tests only.

```typescript
// qa/journeys/J-000-anonymous.spec.ts
import { test } from '@playwright/test';
import * as F001 from '../flows/F-001-marketing-landing/F-001.scenarios';
import * as F002 from '../flows/F-002-pricing/F-002.scenarios';
import * as F003 from '../flows/F-003-authentication/F-003.scenarios';

test('J-000: Anonymous user journey — full E2E', async ({ page, context }) => {
  await test.step('F-001-S-001-01: Landing page loads', () =>
    F001.S_001_01_happyPath(page, context));
  await test.step('F-001-S-001-08: External links have noopener', () =>
    F001.S_001_08_externalLinkSafety(page, context));
  await test.step('F-002-S-002-01: Pricing renders both tiers', () =>
    F002.S_002_01_happyPath(page, context));
  await test.step('F-003-S-003-13: /dashboard unauth → signin redirect', () =>
    F003.S_003_13_authGuard(page, context));
});
```

Authenticated journey — `storageState` at file level:

```typescript
// qa/journeys/J-001-free.spec.ts
import { test } from '@playwright/test';
import * as F003 from '../flows/F-003-authentication/F-003.scenarios';
import * as F009 from '../flows/F-009-dashboard/F-009.scenarios';

test.use({ storageState: '.auth/free.json' });

test('J-001: Free-tier journey — full E2E', async ({ page, context }) => {
  await test.step('F-009-S-009-01: Dashboard renders for free user', () =>
    F009.S_009_01_happyPath(page, context));
  await test.step('F-003-S-003-16: Sign out clears session', () =>
    F003.S_003_16_signOut(page, context));
});
```

Run: `npx playwright test journeys/J-001-free.spec.ts`

---

### Journey Todo File (`qa/journey-todo/J-NNN-<role>.todo.md`)

One per journey, created at the **start of Phase 3** before writing code. Updated as each flow is generated. Agent reads on resume to find the next pending flow.

```markdown
# Journey Todo — J-000-anonymous
# Updated: [YYYY-MM-DD]

## Generation Progress

| Flow | Scenarios.ts | Standalone Spec | Added to Journey | Steps Selected |
|------|--------------|-----------------|------------------|----------------|
| F-001 | ✅ done | ✅ done | ✅ done | 5/13 (P1+P2) |
| F-003 | ⬜ pending | ⬜ pending | ⬜ pending | — |

## Journey Step Execution (Phase 4 — updated after run)

| Step | Scenario ID | Function | Status | Error |
|------|-------------|----------|--------|-------|
| 1 | S-001-01 | S_001_01_happyPath | ⬜ pending | — |
```

Status: `⬜ pending` → `⏳ running` → `✅ done` / `❌ failed([reason])`.

---

## After all flows written — runner infrastructure

Copy templates (no edits needed; they read `.env.qa` dynamically):

| Source | Destination |
|---|---|
| `skills/web/templates/run.js` | `qa/run.js` |
| `skills/web/templates/package.json` | `qa/package.json` |
| `.env.example` | `qa/.env.example` (if not exists) |

**Phase boundary checkpoint** — heavy `qa/state.md`. Log: `"Phase 3 complete — [N] scenario modules, [N] standalone, [N] journeys."`

Announce:

> "✅ Shippable test suite ready:
> - `qa/tests/` — [N] standalone flow specs
> - `qa/journeys/` — [N] sequential E2E journeys
>
> Run flow: `node qa/run.js --flow F-001`
> Run journey: `node qa/run.js --journey J-000`
> Run all: `node qa/run.js`
> Share: `zip -r qa-suite.zip qa/flows/ qa/tests/ qa/journeys/ qa/journey-todo/ qa/run.js qa/package.json qa/playwright.config.ts`"

→ Next: [phase4.md](phase4.md)
