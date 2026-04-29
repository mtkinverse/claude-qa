---
name: web-strategy-targeted-trace
description: Linear persona-path trace for onboarding-heavy / wizard-style web apps. Single-thread depth-first, no breadth fan-out.
type: strategy
platform: web
---

# Strategy — Targeted Trace

> ⚠️ **THIS IS AN EXAMPLE AND PREFERRED SUGGESTION — NOT A MANDATE.**
> You may deviate based on the observed app character, but you MUST:
> 1. Log the deviation in `qa/decisions.md` with rationale.
> 2. Declare a fallback. If your chosen approach stalls, fall back and continue — never break the flow.

**Best for**: Onboarding-heavy, wizard-style, or transactional apps where the value is in following ONE persona's path step-by-step. BFS would waste effort on shallow nav surfaces; the real product is the funnel.

**When fingerprint says**: Q1=SPA or MPA, Q3=Onboarding-heavy or Transactional, Q4=often B2C signup or B2B trial.

**Stall signals**: A required step has no actionable element after `QA_PAGE_WAIT_MS * 2` wait; form submit returns no state change; OAuth/SSO redirect required and `.env.qa` lacks the credential.

**Declared fallback**: **Skip the failing step + record skip in `qa/decisions.md` AND in the flow's evidence row, then continue with the next step**. If three consecutive steps fail, switch to **BFS** (`skills/web/strategies/bfs.md`) for at least breadth coverage of the surface.

---

## Tracing Loop Contract

Each flow is driven by its `qa/flows/F-NNN-*/manifest.jsonl` until every line reaches terminal `status`. See `skills/_shared/runtime.md` → **End-to-End Completion is Mandatory**.

```
while (line = first `pending` in manifest.jsonl):
  execute line.action on line.target     // click selector; goto only for seed/resume
  outcome = classify(page, before, buf)  // outcome-classifier.js
  append 1 line to qa/progress.jsonl      // ≤150 bytes
  update manifest.jsonl line.status = done | skipped(reason) | blocked(reason)
  if outcome in {error-surfaced, auth-rejected-server, form-reset-silent, network-timeout}:
    askUser(...); resume loop after answer
after loop: mark flow TRACED in journey-inventory.md; auto-advance to next PENDING flow
```

---

## How It Works

Single-threaded depth-first walk through ONE intended persona path. No queue, no breadth.

### Loop Structure

```
1. Read fingerprint Q3 + Q4 → identify the dominant persona path (e.g. "new B2C user signs up → completes onboarding → reaches first-value")
2. Open the entry URL, screenshot, READ
3. For each step:
   a. Identify the next actionable element (form, button, wizard control)
   b. Interact (fill, click, select). Use credentials from .env.qa per the credential gate protocol — never bypass.
   c. Wait + verify state change (URL change, DOM change, success indicator)
   d. Screenshot AFTER state change, READ
   e. Record step in flow.md evidence row with: step number, action taken, screenshot file, observed result
   f. If state did not change after fallback wait → execute the declared fallback (skip + continue)
4. Stop when one of:
   - Reached the target end-state (first-value page, dashboard, success screen)
   - Three consecutive step failures → switch to BFS
   - User-defined max-steps reached (default: 20)
```

### Code Skeleton

```javascript
const fs = require('fs');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: '.env.qa' });
const { capture } = require('../scripts/qa-screenshot');

// Why: this script is the runtime helper for targeted-trace strategy.
// Strategy: targeted-trace (skills/web/strategies/targeted-trace.md)
// Fallback: on 3 consecutive step stalls, switch to BFS — log to qa/decisions.md.

const MAX_STEPS = parseInt(process.env.QA_MAX_TRACE_STEPS || '20');
const PAGE_WAIT_MS = parseInt(process.env.QA_PAGE_WAIT_MS || '2000');

const browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' });
const context = await browser.newContext();
const page = await context.newPage();

// Outcome classifier + login engagement helpers (see skills/web/helpers/)
const { attachListeners, snapshot, classify } = require('./outcome-classifier.js');
const { loginEngage } = require('./login-engage.js');
const buf = attachListeners(context);

await page.goto(process.env.QA_APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(PAGE_WAIT_MS);

let consecutiveStalls = 0;
const trace = [];

for (let step = 1; step <= MAX_STEPS; step++) {
  // Snapshot pre-interaction state
  const before = await snapshot(page);
  const sinceTs = Date.now();

  const nextAction = await findNextAction(page);
  if (!nextAction) {
    console.log(`Step ${step}: no actionable element — stopping`);
    break;
  }

  // If next action is a login form, hand off to login-engage (NEVER fill+click directly)
  if (nextAction.type === 'login') {
    const role = nextAction.role || 'member';
    const result = await loginEngage(page, context, {
      email: process.env[`QA_${role.toUpperCase()}_EMAIL`] || process.env.QA_TEST_EMAIL,
      password: process.env[`QA_${role.toUpperCase()}_PASSWORD`] || process.env.QA_TEST_PASSWORD,
      role,
    });
    if (result.label !== 'auth-success') break;  // pending-question.md was written; agent re-engages
    trace.push({ step, action: 'login-engage', label: result.label });
    continue;
  }

  const ok = await interact(page, nextAction).catch(() => false);
  await page.waitForTimeout(PAGE_WAIT_MS);

  const outcome = await classify(page, before, buf, { sinceTs });
  const slug = page.url().split('/').filter(Boolean).pop() || `step-${step}`;
  const file = `trace-${String(step).padStart(2, '0')}-${slug}.png`;

  // Gated screenshot read: only inline-READ on error / terminal labels
  const READ_NOW = ['error-surfaced', 'auth-rejected-server', 'form-reset-silent', 'modal-opened', 'network-timeout'];
  await capture(page, {
    flow: 'targeted-trace',
    step,
    action: nextAction.label || `Step ${step}`,
    observed: READ_NOW.includes(outcome.label) ? `READ: ${outcome.label}` : `(batch-read pending) ${outcome.label}`,
    page: slug,
    file,
  });

  fs.appendFileSync('qa/classifier-log.jsonl',
    JSON.stringify({ ts: Date.now(), step, label: outcome.label, url: page.url() }) + '\n');

  if (outcome.label === 'no-change') {
    consecutiveStalls++;
    appendDecision(`Step ${step} no-change: ${nextAction.label}.`);
    if (consecutiveStalls >= 3) {
      appendDecision('Three consecutive no-change — switching to BFS strategy.');
      break;
    }
    continue;
  }

  if (READ_NOW.includes(outcome.label)) {
    // Engagement protocol — write a pending-question for the agent to pick up
    fs.writeFileSync('qa/pending-question.md',
      '```json\n' + JSON.stringify({ step, label: outcome.label, evidence: outcome.evidence, screenshot: file }, null, 2) + '\n```\n');
    break;
  }

  consecutiveStalls = 0;
  trace.push({ step, action: nextAction.label, url: page.url(), file, label: outcome.label });
}

await browser.close();

// Persist trace summary
fs.writeFileSync('qa/flows/targeted-trace/trace.json', JSON.stringify(trace, null, 2));

function appendDecision(line) {
  const ts = new Date().toISOString();
  fs.appendFileSync('qa/decisions.md', `\n## ${ts} — targeted-trace\n${line}\n`);
}

// findNextAction + interact: adapt to the observed app.
// Default heuristic shown — override based on what you SEE in screenshots.
async function findNextAction(page) {
  // 1. Primary CTA (large, prominent button)
  const cta = page.locator('button[type="submit"], button.primary, [class*="primary"]').first();
  if (await cta.count() > 0 && await cta.isVisible().catch(() => false)) {
    return { type: 'click', selector: cta, label: (await cta.textContent() || '').trim() };
  }
  // 2. Required form fields → fill from .env.qa via credential gate (skills/web/strategies/bfs.md W-2.6)
  // 3. Next-step / continue / save link
  // ... extend per observation
  return null;
}
```

### Fallback in Action

The script **never throws**. Every failure path either:
- Records the skip and continues (single stall)
- Switches to BFS (three consecutive stalls)
- Stops at a terminal state (no next action)

In every case, `qa/decisions.md` gets a new entry explaining what happened.

### Adapt to What You See

After every screenshot READ, if the app exposes interactions the default `findNextAction` heuristic missed (e.g. a custom carousel, a multi-select wizard step), update `qa/scripts/targeted-trace.js` and append a `qa/decisions.md` entry: `"Updated targeted-trace.js: added handler for <X> based on screenshot of step N"`.
