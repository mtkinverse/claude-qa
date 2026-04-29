---
name: web-helper-auth-bootstrap
description: Helper invoked by BFS when exploration hits a sign-up / login / onboarding wall. Drives the scripted persona path past the gate, saves storageState, returns control to BFS.
type: helper
platform: web
---

# Helper — Auth Bootstrap (formerly "targeted-trace")

> ⛔ **This is no longer a peer strategy.** BFS is the only strategy. This file exists as a helper BFS invokes when it hits a credential / onboarding wall it cannot traverse autonomously. After the wall is passed, control returns to BFS.

The filename `targeted-trace.md` is preserved to avoid breaking `bfs.md`, `trace-recorder.js`, and existing workspace references. The semantics have changed: this is an auth-bootstrap helper, not a strategy.

**Invoked when**: BFS detects a sign-up / login form, an onboarding wizard, or a credential gate that blocks the post-login surface from being reachable by breadth crawling alone.

**Returns**: `qa/.auth/<role>.json` (storageState) and a `gateOutcome` string (`auth-success` | `gate-unresolved`). BFS resumes from the post-gate URL with the storage state loaded.

**Stall signals**: A required step has no actionable element after `QA_PAGE_WAIT_MS * 2` wait; form submit returns no state change; OAuth/SSO redirect required and `.env.qa` lacks the credential.

**Declared fallback**: Skip the failing step + record skip in `qa/decisions.md`, then continue with the next step. After 3 consecutive no-change steps, return `gate-unresolved` to BFS — BFS records the gate URL as `⛔ skipped` with a 3-strike retry log (`bfs.md` W-2.6).

---

## Contract

Auth bootstrap MUST:

1. Run only when BFS calls it (never as a top-level strategy).
2. Stop the moment the post-gate URL is reached (do NOT continue exploring — that is BFS's job).
3. Save `storageState` to `qa/.auth/<role>.json` before returning.
4. Append one entry to `qa/decisions.md` recording the gate, the path taken, and the outcome.
5. Never click bypass buttons (see `principles.md` §9 — bypass detection is universal).
6. Use credentials from `.env.qa` only — never hardcode.
7. On `signup` returning `alreadyExists=true`, set the session-wide signup-once flag and switch permanently to login (see `helpers/login-engage.md` C2 guard).

---

## Loop Contract

Driven by `qa/flows/F-NNN-*/manifest.jsonl` until the manifest's terminal step is reached OR the post-gate URL is reached, whichever is first.

```
while (line = first `pending` in manifest.jsonl) AND not at post-gate URL:
  execute line.action on line.target     // click selector; goto only for seed/resume
  outcome = classify(page, before, buf)  // outcome-classifier.js
  recorder.interaction({...})            // append to trace.jsonl
  update manifest.jsonl line.status = done | skipped(reason) | blocked(reason)
  if at post-gate URL:
    save storageState; return { gateOutcome: 'auth-success' }
  if 3 consecutive no-change:
    return { gateOutcome: 'gate-unresolved' }
  if outcome in {error-surfaced, auth-rejected-server, form-reset-silent, network-timeout}:
    askUser(...); resume after answer
```

---

## Code Skeleton

```javascript
const fs = require('fs');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: '.env.qa' });

// Auth-bootstrap helper. Called by BFS when a credential / onboarding wall blocks
// breadth crawling. Returns storageState + gateOutcome to BFS — does not explore.

const MAX_STEPS = parseInt(process.env.QA_MAX_TRACE_STEPS || '20');
const PAGE_WAIT_MS = parseInt(process.env.QA_PAGE_WAIT_MS || '2000');

const browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' });
const context = await browser.newContext();
const page = await context.newPage();

const { attachListeners, snapshot, classify } = require('./outcome-classifier.js');
const { loginEngage } = require('./login-engage.js');
const { TraceRecorder, uigRef } = require('./trace-recorder.js');
const { wigglePass } = require('./wiggle-pass.js');
const { snapshotPage } = require('./snapshot-page.js');
const buf = attachListeners(context);

const recorder = new TraceRecorder(process.env.QA_TRACE_FLOW_ID || 'auth-bootstrap');
const role = process.env.QA_BOOTSTRAP_ROLE || 'member';
const postGateMatcher = process.env.QA_POST_GATE_URL_PATTERN
  ? new RegExp(process.env.QA_POST_GATE_URL_PATTERN)
  : /\/(dashboard|home|app|workspace|onboarding\/complete)/i;

await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(PAGE_WAIT_MS);

let consecutiveStalls = 0;
let gateOutcome = 'gate-unresolved';

for (let step = 1; step <= MAX_STEPS; step++) {
  // Exit immediately if post-gate URL reached — BFS resumes from here.
  if (postGateMatcher.test(page.url())) {
    gateOutcome = 'auth-success';
    break;
  }

  const before = await snapshot(page);
  const sinceTs = Date.now();

  const nextAction = await findNextAction(page);
  if (!nextAction) break;

  // Login forms: hand off to login-engage (NEVER fill+click directly).
  // login-engage enforces signup-once: on alreadyExists=true the session
  // permanently switches to login.
  if (nextAction.type === 'login' || nextAction.type === 'auth') {
    const result = await loginEngage(page, context, {
      email: process.env[`QA_${role.toUpperCase()}_EMAIL`] || process.env.QA_TEST_EMAIL,
      password: process.env[`QA_${role.toUpperCase()}_PASSWORD`] || process.env.QA_TEST_PASSWORD,
      role,
    });
    if (result.label === 'auth-success') {
      // Save storageState immediately on auth success — BFS needs it.
      await context.storageState({ path: `qa/.auth/${role}.json` });
      gateOutcome = 'auth-success';
      break;
    }
    if (result.label === 'auth-rejected-server' || result.label === 'auth-blocked') break;
    continue;
  }

  const ok = await interact(page, nextAction).catch(() => false);
  await page.waitForTimeout(PAGE_WAIT_MS);

  const outcome = await classify(page, before, buf, { sinceTs });

  recorder.interaction({
    action: nextAction.kind || 'click',
    uig_ref: nextAction.uig_ref,
    target: nextAction.label,
    outcome: outcome.label,
    evidence: { url: page.url() },
  });

  if (outcome.label === 'no-change') {
    consecutiveStalls++;
    appendDecision(`Step ${step} no-change: ${nextAction.label}.`);
    if (nextAction.disabled && nextAction.scope) {
      await wigglePass(page, {
        scope: nextAction.scope,
        disabledTarget: { role: nextAction.role || 'button', name: nextAction.label, exact: true },
        flowId: process.env.QA_TRACE_FLOW_ID || 'auth-bootstrap',
      }).catch(() => {});
    }
    if (consecutiveStalls >= 3) {
      appendDecision('Three consecutive no-change — returning gate-unresolved to BFS.');
      break;
    }
    continue;
  }

  consecutiveStalls = 0;
}

// Save state regardless of outcome; BFS decides whether to use it.
await context.storageState({ path: `qa/.auth/${role}.json` }).catch(() => {});
await browser.close();

// Emit the result for the BFS caller. Two channels: stdout JSON + a sentinel file.
const result = { gateOutcome, role, storageState: `qa/.auth/${role}.json`, lastUrl: page.url() };
fs.writeFileSync('qa/.auth-bootstrap-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

function appendDecision(line) {
  const ts = new Date().toISOString();
  fs.appendFileSync('qa/decisions.md', `\n## ${ts} — auth-bootstrap\n${line}\n`);
}
```

---

## `findNextAction` — Required Priority Order

The action-finding function MUST check conditions in this exact order. Reversing causes stall loops.

```
1. Auth-page context check (FIRST — before any CTA matching)
   - If current URL matches /(login|signin|sign-in|signup|sign-up|register|account)/i
     AND an email/password input is visible → return { type: 'auth' }
   - This prevents the script from clicking the form's submit button bare-handed.

2. Visible wizard / onboarding "Continue" or "Next" button
   - Only match if it is ENABLED (not disabled). Disabled means a precondition
     is missing — handled by wiggle-pass via the consecutiveStalls path.

3. Required form fields that are empty
   - Detect via input[required]:not([value]), aria-required inputs.
   - Fill from .env.qa via credential-fanout (skills/web/helpers/credential-fanout.md)
     — every credential type registered in the index, not just email/password.

4. Primary CTA button (sign-up, get-started) — only on non-auth pages.

5. Bypass detection (skills/_shared/principles.md §9) — never click these.

6. null — no actionable element; helper exits, BFS resumes.
```

---

## What this helper does NOT do

- It does not enumerate sidebar items, click dashboard panels, or open modals on the post-gate surface. **That is BFS's job.** This helper exits the moment the post-gate URL matcher fires.
- It does not record `## Strategy chosen` entries — there is no strategy choice. It records `## auth-bootstrap invoked` entries instead.
- It does not perform breadth fan-out. Linear walk only.
- It does not retry signup after `alreadyExists=true`. The signup-once guard in `login-engage` switches the session permanently to login.

If you find yourself extending this helper to "also explore the dashboard" or "also click the sidebar," stop — that work belongs in BFS. Add the missing capability there instead.
