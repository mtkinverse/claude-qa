---
name: native-qa-web
description: Autonomous QA skill for web applications using Playwright. Four continuous phases — Discovery → Scenario Planning → Test Generation → Test Execution. Stops only for credentials or context limits. QA report generated at phase boundaries only.
platform: web
status: beta
version: 3.0.0
---

# Web QA Skill — Playwright-Based Workflow

Four continuous phases that run end-to-end without stopping for user approval between phases:

```
Phase 1: Discovery         → Seed crawl → DOM/ARIA snapshots → nav graph → personas → E2E journeys → flow.md
Phase 2: Scenario Planning → Read flow.md → generate scenarios.md per flow
Phase 3: Test Generation   → Read scenarios.md → write scenario functions (qa/flows/F-NNN/F-NNN.scenarios.ts) + standalone wrappers (qa/tests/) + sequential journeys (qa/journeys/)
Phase 4: Test Execution    → Run qa/tests/ (standalone) or qa/journeys/ (E2E) → pass/fail → report
```

**No image processing**: Discovery uses DOM snapshots and ARIA accessibility trees — not screenshots. Screenshots are taken by Playwright only on test failure during Phase 4. Visual artifacts (images, icons, badges, illustrations) are identified from ARIA roles, `alt` attributes, and DOM structure — not by reading PNG files.

**Three-layer test architecture**: Phase 3 produces three artifacts per flow — (1) `qa/flows/F-NNN-*/F-NNN.scenarios.ts` (exported async functions, the reusable core), (2) `qa/tests/F-NNN-<slug>.spec.ts` (thin standalone wrappers — run any flow in isolation), (3) `qa/journeys/J-NNN-<role>.spec.ts` (sequential E2E journeys — shared browser session, `test.step()` chains). No TC-NNN-*.md files anywhere.

**Continuous execution**: phases flow into each other automatically. The agent only stops for:
- **Credentials required** — must ask user for auth/API keys
- **Context full** — must checkpoint to `qa/state.md` and reset

**Report timing**: `node scripts/allure/generate-report.js --open` generates a self-contained session report at `qa/reports/<app-slug>-<timestamp>.html`. Only run at **phase boundaries** (Phase 1→2, 2→3, 3→4, final) or when user asks — never on per-flow resets.

---

## Prerequisites

- Node.js 20+ installed
- `npm install` run in project root (installs `@playwright/test`, `dotenv`)
- `npx playwright install chromium` run at least once
- `.env.qa` at repo root — see `.env.example`

### BFS Crawl Configuration

These `.env.qa` variables tune the BFS crawler. Defaults work for most apps — only change if needed.

| Variable | Default | Purpose |
|----------|---------|---------|
| `QA_PAGE_WAIT_MS` | `2000` | Minimum wait (ms) after each page loads before snapshotting. Increase for slow SPAs. |
| `QA_MAX_PAGES` | `50` | Maximum pages the BFS visits. Prevents infinite crawl on large apps. |
| `QA_MAX_DEPTH` | `5` | Maximum click-depth from homepage. Pages deeper are queued but skipped. |
| `QA_NAV_TIMEOUT` | `15000` | Timeout (ms) for `page.goto()` calls. |

---

## Phase 1: Discovery

**Goal**: Discover EVERY reachable page in the application via deep BFS crawl using DOM and ARIA snapshots — no image processing.
**Priority**: Exploration first — maximize pages discovered. Auth is a gate to pass through, not a journey to trace. **NEVER skip any credential gate, setup step, or onboarding step without explicit user permission.** If `.env.qa` has values → use them. If not → ask the user. The agent must never autonomously click "Skip", "Set up later", "Maybe later", or any bypass button.
**Output**: `qa/knowledgebase/` (aria-snapshots/, ui-inventory, nav-graph) + `qa/flows/F-NNN-*/flow.md` per feature area.
**Snapshot approach**: Every "visual" observation is derived from the DOM/ARIA tree — not from reading PNG files. Visual artifacts (images, illustrations, icons) are identified via `role="img"`, `alt` text, `aria-label`, and CSS class names in the DOM. No `Read` tool calls on PNGs during discovery.
**Transition to Phase 2**: Gated — after all flows traced, the agent runs a **deep-exploration `AskUserQuestion`** (Phase 1 → Phase 2 Transition step 3). User either requests more exploration or approves the move to Phase 2. Session is checkpointed to `qa/state.md` at the end of every deeper pass.

---

### Pre-Step: Load Prior Knowledge

Before doing anything else, check what the root skill extracted from `qa/context/` in Step 3.

```bash
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

**If `qa/knowledgebase/ui-inventory.md` exists** — read it now. It contains the page inventory and known features extracted from any files the user dropped into `qa/context/`. Use this as your starting map:
- Prioritize routes and pages named in the inventory — explore these first
- If Figma screens were provided, you know the screen layouts — confirm visually via Playwright
- If a PRD or spec was provided, you know the features and acceptance criteria — test against them

**If `qa/context/` has unread files** (PNGs, `.md`, `.txt` not yet processed) — read them before opening the browser.

**If nothing exists** — cold start. Discover everything by crawling from the homepage.

---

## STOP / PAUSE / SAVE STATE

Follow the root SKILL.md **"STOP / PAUSE / SAVE STATE — Immediate Handler"** exactly. No web-specific differences — the root handler applies as-is.

---

### Step W-1: Workspace Setup

Handled by main SKILL.md Steps 1-2. Confirm:
- `.qa-config.json` has `"platform": "web"`
- `QA_APP_URL` is set in `.env.qa`
- `qa/knowledgebase/aria-snapshots/` directory exists (DOM/ARIA snapshot store — replaces screenshots/ for discovery)

Create the Phase 3 output directories now:

```bash
mkdir -p qa/knowledgebase/aria-snapshots qa/journeys qa/tests qa/journey-todo qa/runs
```

Then write the Playwright config to `qa/playwright.config.ts`:

```typescript
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
  // testDir = qa/ — testMatch selects both standalone tests/ and E2E journeys/
  testDir:       __dirname,
  testMatch:     ['tests/**/*.spec.ts', 'journeys/**/*.spec.ts'],
  fullyParallel: false,  // journeys run sequentially (shared session)
  forbidOnly:    CI,
  retries:       CI ? 2 : 0,
  workers:       CI ? 2 : 1,
  timeout:       60_000,  // journeys can be long
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
```

This reads all config from `.env.qa` dynamically — no hardcoded URLs or credentials. Write it fresh each session to `qa/`. All run commands use `--config qa/playwright.config.ts`.

---

### Step W-1.5: Preflight — Verify & Auto-Install with User Consent

> **Engagement protocol** (`skills/_shared/engagement-protocol.md`): preflight MUST NOT throw or `exit 1`. For each missing item, surface a four-option `AskUserQuestion`: (a) auto-install / auto-create, (b) provide value now, (c) fix manually then say "continue", (d) skip the affected feature.

Run these checks IN ORDER, branch on failure:

```bash
# 1. node_modules with @playwright/test
[ -d node_modules/@playwright/test ] && echo "ok: playwright installed" \
  || echo "MISSING: @playwright/test — offer 'npm install'"

# 2. Chromium browser binary
npx --yes playwright install --dry-run chromium 2>&1 | grep -q "is already installed" \
  && echo "ok: chromium installed" \
  || echo "MISSING: chromium — offer 'npx playwright install chromium'"

# 3. .env.qa exists
[ -f .env.qa ] && echo "ok: .env.qa present" \
  || echo "MISSING: .env.qa — offer to copy .env.example and prompt for values"

# 4. QA_APP_URL set
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_APP_URL" ] ) \
  && echo "ok: QA_APP_URL set" \
  || echo "MISSING: QA_APP_URL — prompt user for the URL to test"

# 5. Default-role creds (member)
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_TEST_EMAIL" ] && [ -n "$QA_TEST_PASSWORD" ] ) \
  && echo "ok: default creds present" \
  || echo "WARN: no QA_TEST_EMAIL/PASSWORD — non-blocking; W-2.9 role gate will reconcile"
```

For each MISSING line, call `AskUserQuestion` once with the four options. Auto-install only on explicit consent. Append every preflight outcome to `qa/decisions.md` as a single dated entry. **Per-role credentials are deferred to Step W-2.9.**

---

### Step W-2: Exploration Strategy Selection — Pick, Log, Execute, Fallback

> ⚠️ **Strategies under `skills/web/strategies/` are EXAMPLES AND PREFERRED SUGGESTIONS — NOT MANDATES.**
> You may deviate based on the observed app character, but you MUST:
> 1. Log the deviation in `qa/decisions.md` with rationale.
> 2. Declare a fallback. If the chosen approach stalls, fall back and continue — never break the flow.

Playwright remains the web tool. Autonomy is about **which exploration strategy** to apply, not which tool.

#### W-2.1 — Read the fingerprint

Read `qa/platform-fingerprint.md` (written in root SKILL.md Step 3.5). The Q3 answer (app category) and Q4 answer (audience) drive strategy selection.

#### W-2.2 — Consult the selection rubric

Open [skills/web/strategies/README.md](strategies/README.md) and map Q3 → starting strategy:

| Fingerprint Q3 | Starting strategy | Declared fallback |
|---|---|---|
| Dashboard / multi-page / mixed | [bfs.md](strategies/bfs.md) (default) | Direct-URL probing → sitemap-spot-check |
| Onboarding-heavy / Transactional / Wizard | [targeted-trace.md](strategies/targeted-trace.md) | Skip + continue → BFS after 3 consecutive stalls |
| Content / CMS / Marketing / Docs | [sitemap-spot-check.md](strategies/sitemap-spot-check.md) | BFS with `QA_MAX_DEPTH=2` |
| Something else | Custom strategy — document rationale + fallback in `qa/decisions.md` |  |

#### W-2.3 — Log the choice

Append to `qa/decisions.md`:

```markdown
## YYYY-MM-DD HH:MM — Strategy chosen
**Strategy**: <bfs | targeted-trace | sitemap-spot-check | custom>
**Why**: <2-3 sentences citing fingerprint Q1-Q4 answers>
**Fallback**: <named alternative + when to switch>
**Runtime helper**: qa/scripts/<strategy>.js
```

#### W-2.4 — Write the runtime helper

Copy the code skeleton from the chosen strategy file into `qa/scripts/<strategy>.js` (e.g. `qa/scripts/bfs.js`). Adapt selectors, wait heuristics, and actionable-element rules to what the fingerprint probe screenshot actually showed. The helper header comment MUST contain:

```javascript
// Why: <reason this script exists>
// Strategy: <strategy name — see skills/web/strategies/<name>.md>
// Fallback: <what to do if this script stalls — different code path, not retry>
```

Also write a dispatcher stub at `qa/scripts/explore.js` that `require()`s the chosen helper. Subsequent phases and resumes load `explore.js` — swapping strategies means replacing what it dispatches to.

#### W-2.5 — Execute + DOM/ARIA snapshot + analyze

Run the helper. For every page/step — **no image reading, no `Read` tool calls on PNGs**:

1. Navigate / interact via Playwright
2. Wait `QA_PAGE_WAIT_MS` for the page to settle
3. Verify state change via `page.url()` and `page.title()`
4. **Capture DOM/ARIA snapshot** — run this inline after every navigation:

```javascript
// Atomic DOM + ARIA snapshot — replaces screenshot capture for discovery
async function snapshotPage(page, slug, snapshotDir) {
  const fs   = require('fs');
  const path = require('path');
  const aria = await page.accessibility.snapshot();
  const dom  = await page.evaluate(() => {
    const ex = el => ({
      tag:         el.tagName?.toLowerCase(),
      role:        el.getAttribute('role') || el.tagName?.toLowerCase(),
      name:        el.getAttribute('aria-label') || el.getAttribute('name') || el.innerText?.slice(0,80) || '',
      href:        el.href  || null,
      type:        el.type  || null,
      placeholder: el.placeholder || null,
      alt:         el.alt   || null,
      visible:     el.offsetParent !== null,
    });
    return {
      url:      location.href,
      title:    document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')].map(h => ({ level: h.tagName, text: h.innerText.slice(0,120) })),
      inputs:   [...document.querySelectorAll('input,textarea,select')].map(ex),
      buttons:  [...document.querySelectorAll('button,[role="button"]')].map(ex),
      links:    [...document.querySelectorAll('a[href]')].map(ex),
      images:   [...document.querySelectorAll('img,[role="img"]')].map(e => ({ alt: e.alt, label: e.getAttribute('aria-label') })),
      alerts:   [...document.querySelectorAll('[role="alert"],[role="status"]')].map(e => e.innerText.slice(0,200)),
    };
  });
  fs.writeFileSync(path.join(snapshotDir, slug + '.snapshot.json'), JSON.stringify({ slug, aria, dom }, null, 2));
  return dom;
}
```

5. **Analyze the snapshot** directly — from `dom.headings`, `dom.buttons`, `dom.links`, `dom.inputs`, `dom.images`, `dom.alerts`, and the ARIA tree you can read the page section, all interactive elements, navigation targets, visible errors, and visual artifacts (images/icons described by `alt`/`aria-label`). No PNG reading needed.
6. Decide the next action from snapshot data. Record observations in `flow.md` discovery evidence using snapshot fields (headings, button labels, link text) instead of screenshot paths.

All strategies share the same session artefacts:
- `qa/knowledgebase/aria-snapshots/` — `.snapshot.json` files (ARIA tree + DOM extract) per visited state
- `qa/knowledgebase/ui-inventory.md` — page inventory (url, title, fingerprint, snapshot file, auth-gated?)
- `qa/knowledgebase/nav-graph.md` — every outbound link from every visited page (from `dom.links`)
- `qa/crawl-state.json` (BFS only) — queue + visited set for mid-crawl resume. If using targeted-trace, write `qa/trace-state.json` instead; if sitemap-spot-check, write `qa/sitemap-groups.json`. Auto-saved after every page so resume is free.

#### W-2.6 — Credential gate protocol (all strategies)

Any strategy may hit a credential gate (login, SSO, API key). NEVER bypass.

1. Check `.env.qa` for applicable credentials (`QA_TEST_EMAIL`, `QA_TEST_PASSWORD`, `QA_API_KEY`, etc.).
2. If present — use them. If the gate succeeds, save session state to `qa/.auth/user.json` via Playwright `storageState`.
3. If absent — **stop, ask the user**, do not click "Skip", "Maybe later", or any bypass button.
4. Log the gate encounter + outcome in `qa/decisions.md`.

For self-registration (account not pre-provisioned), only proceed if the user explicitly authorizes. Generated credentials get appended to `.env.qa` (gitignored) and logged in `qa/decisions.md` as `"Self-registered test account <email> at YYYY-MM-DD"`.

#### W-2.7 — Watch for stall signals, fall back

Each strategy file names its own stall signals. When one triggers:
1. Stop the current strategy cleanly (finish the current iteration — do not crash).
2. Append to `qa/decisions.md`: `"Switching from <X> to <Y> because <signal>."`
3. Replace or update `qa/scripts/explore.js` to dispatch to the fallback strategy's helper.
4. Resume — session artefacts (`qa/state.md`, screenshots, nav-graph) carry over. Progress is not lost.

**The flow never breaks.** A stall means switch, not stop.

#### W-2.8 — Record results

At end of strategy execution:
- `qa/knowledgebase/ui-inventory.md` + `qa/knowledgebase/nav-graph.md` must be current
- `qa/state.md` gets a checkpoint: strategy used, pages visited, fallback triggered?, next action
- `qa/decisions.md` closes with a terminal entry: `"<Strategy> complete: N pages, M stalls, fallback-triggered=<yes|no>."`

---

### Runtime Script Evolution

`qa/scripts/` is **Claude-owned**. Every script there traces back to a strategy file under `skills/web/strategies/`. Rules:

- Every script starts with the three-line header (Why / Strategy / Fallback) shown in W-2.4.
- Updating a script mid-session requires a matching `qa/decisions.md` entry: `"Updated qa/scripts/<name>.js: <what changed> — because <observation from screenshot N>."`
- Deleting a script requires a matching entry: `"Removed qa/scripts/<name>.js — strategy switched from <X> to <Y>."`
- Scripts that accumulate without entries are stale. Audit at phase boundaries and prune.
- **Every generated script reads `QA_HEADLESS` from env**: `chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' })`. Default headless; set `QA_HEADLESS=false` in `.env.qa` to watch the browser.
- **Every script that interacts with a login form uses `qa/scripts/login-engage.js`** (skeleton in `skills/web/helpers/login-engage.md`). Direct fill+click on a password field is a bug — it cannot detect form-reset-silent failures.
- **Every interaction calls `qa/scripts/outcome-classifier.js`** (skeleton in `skills/web/helpers/outcome-classifier.md`) and branches on the returned label — never on the legacy `stateChanged` boolean.

This is how Claude "writes its own tools" without losing audit trail. The strategy file is the contract; the script is the implementation; `decisions.md` is the commit log.

---

### Step W-2.9: Role & Flow Inventory Confirmation Gate

> **No tracing begins until the user confirms roles and flow categories.** This step front-loads engagement so the agent never burns tokens on flows the user didn't approve, and so multi-role apps are not wedged on a single global credential pair.

#### 1. Synthesize roles from the inventory

Read `qa/knowledgebase/ui-inventory.md` + `nav-graph.md` and infer roles from:
- distinct post-auth route prefixes (`/admin/*`, `/member/*`)
- visible role labels in nav (e.g. "Admin", "Owner", "Viewer")
- plan-tier badges in the header
- pages that 403/redirect for the default role

Write `qa/knowledgebase/roles.md`:

```markdown
| Role ID | Observed signal | Evidence screenshot | Credential slot |
|---|---|---|---|
| admin   | `/admin/*` + "Admin" badge | shot-03.png | QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD |
| member  | default post-login         | shot-01.png | QA_TEST_EMAIL  / QA_TEST_PASSWORD  |
```

#### 2. Synthesize broad flow categories

Group nav clusters into 5–8 flow categories. Write `qa/knowledgebase/flow-categories.md`:

```markdown
| Category    | Pages | Roles needed |
|-------------|-------|--------------|
| Auth        | /login, /signup, /reset | anonymous → member/admin |
| Dashboard   | /, /home              | member, admin |
| Admin Panel | /admin/*              | admin |
```

#### 3. ONE batched AskUserQuestion

Present roles + categories together. Use a structured `AskUserQuestion` so the user can confirm, edit, or add. Do not ask sequentially — one prompt, multiple answers.

#### 4. Per confirmed role, request credentials

For each confirmed role, in order:

1. Look up `QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASSWORD` in `.env.qa` (e.g. `QA_ADMIN_EMAIL`).
2. If present → confirm: *"Use the existing admin creds for the Admin role?"*
3. If absent → `AskUserQuestion` with options: (a) provide creds now, append to `.env.qa`; (b) self-register via UI if app supports it; (c) skip this role's flows for this run.
4. After successful login (via `qa/scripts/login-engage.js` — see `skills/web/helpers/login-engage.md`), save `storageState` to `qa/.auth/<role>.json`. Add `QA_<ROLE>_STORAGE_STATE=qa/.auth/<role>.json` to `.env.qa`.

#### 5. Only then proceed to W-3

Each W-3 flow declares its `Role` in the Summary table. Traced flows pick the right `storageState` file via `browser.newContext({ storageState: process.env[\`QA_${role.toUpperCase()}_STORAGE_STATE\`] })` — never re-login per flow.

**Login engagement** is delegated to `skills/web/helpers/login-engage.md`. It is the ONLY way to attempt a login from any runtime script — the shallow "fill + click + screenshot" loop is forbidden because it silently mis-classifies HomaCare-style form-reset rejections (see helper doc for evidence).

---

### Step W-3: Feature-Scoped Flow Creation

After BFS crawl, organize discovered pages into **feature-scoped flows** — one flow per distinct feature area (3-7 steps each).

**Manifest-first tracing.** Before executing any step in a flow, write its plan to `qa/flows/F-NNN-<slug>/manifest.jsonl` — one line per step `{step, action, target, url, status:"pending"}`. Then run the **Tracing Loop Contract** (see strategy files; governed by `skills/_shared/engagement-protocol.md` → *End-to-End Completion is Mandatory*): drive every manifest line to terminal status, append one line to `qa/progress.jsonl` per step, and auto-advance to the next PENDING flow in `journey-inventory.md` when the manifest is fully terminal. Do not stop mid-flow to ask the user what's left — the manifest is the answer.

**Resume**: `grep -v '"status":"done"' qa/flows/<active>/manifest.jsonl` → continue at the first non-done line. `tail -n 30 qa/progress.jsonl` confirms the last concrete action.

#### How to identify flows from the page inventory:

Group pages into flows based on **what the crawl actually found** — not assumed categories. Use these signals:
- **Pages that share a URL prefix** → likely one feature area (e.g., `/docs/*` = docs section)
- **Pages reachable from the same nav item** → one flow
- **Pages behind the same auth gate** → group together
- **Pages with related functionality** (seen in screenshots) → one flow
- **Standalone pages** (legal, about, contact) → can be grouped into one "static pages" flow

Do NOT assume every app has pricing, dashboard, blog, etc. Derive flow boundaries from the actual nav-graph and page inventory.

#### Create flow directories and flow.md:

```
qa/flows/F-001-[slug]/flow.md     ← 3-7 steps, one feature area
qa/flows/F-002-[slug]/flow.md
qa/flows/F-003-[slug]/flow.md
```

**flow.md template** — feature-scoped (NOT journey-scoped):
```markdown
# F-NNN: [Feature/Section Name]

## Summary
| Field | Value |
|-------|-------|
| **Flow ID** | F-NNN |
| **Application** | [AppName] |
| **Section** | [Feature area — derived from nav-graph grouping] |
| **Pages** | [URLs covered — list all pages in this flow] |
| **Auth Required** | Yes / No |
| **Priority** | P1 / P2 / P3 |
| **Status** | COMPLETE |

## Discovery Evidence

| Step | Page/Screen | Action | Snapshot | Observed (from DOM/ARIA) |
|------|------------|--------|----------|--------------------------|
```

Snapshot column contains the `.snapshot.json` filename (e.g. `settings-profile.snapshot.json`). Observed column describes what was found in `dom.headings`, `dom.buttons`, `dom.inputs`, `dom.alerts`, and ARIA roles — no PNG references.

#### Bridge seed-crawl evidence into F-NNN flows

1. Read `qa/crawl-state.json` — get the page manifest (URL → snapshot file mapping)
2. For each F-NNN flow, find which snapshots belong to it:
   - Match by URL prefix (e.g., pages at `/settings/*` → F-002-settings)
   - Match by nav-graph grouping (pages reachable from the same nav item)
3. Copy the matching evidence rows into each F-NNN's `flow.md` Discovery Evidence table
4. After all rows are distributed, delete the seed-crawl directory:
   ```bash
   rm -rf qa/flows/seed-crawl
   ```

> Every snapshot must end up in exactly one F-NNN flow. If a snapshot doesn't fit any flow, create a catch-all flow (e.g., `F-NNN-misc-pages`).

#### Present to user:

Summarize what was discovered — flow table only, no freeform prose. The deep-exploration gate happens at the Phase 1 → Phase 2 transition after coverage is verified (see below).

> "Discovered **[N] pages** across **[M] feature areas**:
>
> | Flow | Section | Pages | Auth |
> |------|---------|-------|------|
> | F-001 | [section name from nav-graph] | [N] | [Yes/No] |
> | F-002 | [section name] | [N] | [Yes/No] |
> | ... | | | |
>
> Tracing all flows now. Will ask before moving to scenario planning."

---

### Step W-3b: Context Reset After Each Flow

Follow root SKILL.md **"How to Reset After a Flow"** (lightweight reset — finalize flow.md, append to state.md, tell user).

**Web-specific addition**: close the browser context after each flow to free memory:
```javascript
await context.close(); // clean state for next flow
```

Screenshot coverage check and QA report are **deferred to Phase 1 → Phase 2 transition** — not run here.

---

### Step W-6: Save Exploration Knowledge Base

Write/update `qa/knowledgebase/` with:
- `ui-inventory.md` — Page inventory table (all crawled URLs), element inventory per page. Written in W-2.8 during BFS, enriched here with visual observations from screenshot analysis.
- `nav-graph.md` — Navigation graph built from BFS link collection (W-2.3 step 11). Every outbound link on every page = one row.
- `personas.md` — Discovered personas derived from auth boundaries, plan tiers, and feature sections visible in screenshots.
- `journey-inventory.md` — All flows with coverage status, updated as flows are traced.
- App-specific observations (SPA routes, redirect behavior, widget quirks)

---

## Phase 1 → Phase 2 Transition

After all flows are traced (Step W-6 complete), do the **deferred housekeeping** and run the **deep-exploration gate** before proceeding.

1. **Update `qa/knowledgebase/journey-inventory.md`** — batch-update all flows as TRACED or SKIPPED based on what exists in `qa/flows/`

2. **Run snapshot coverage check** (verify every page in ui-inventory.md has a corresponding snapshot):
   ```bash
   node -e "
   const fs=require('fs'),p=require('path');
   const snapDir=p.join('qa','knowledgebase','aria-snapshots');
   const snaps=fs.existsSync(snapDir)?new Set(fs.readdirSync(snapDir).filter(f=>f.endsWith('.snapshot.json'))):new Set();
   const inv=fs.existsSync('qa/knowledgebase/ui-inventory.md')?fs.readFileSync('qa/knowledgebase/ui-inventory.md','utf8'):'';
   const refs=new Set([...inv.matchAll(/[a-zA-Z0-9_-]+\\.snapshot\\.json/g)].map(m=>m[0]));
   const orphaned=[...snaps].filter(f=>!refs.has(f));
   if(orphaned.length){console.warn('⚠',orphaned.length,'unreferenced snapshots:',orphaned);}
   else console.log('✅',snaps.size,'snapshots, all referenced in ui-inventory.md');
   "
   ```
   If orphaned snapshots found → add them to `ui-inventory.md` under the appropriate flow.

3. **Deep-exploration gate — `AskUserQuestion`** (mandatory stop before Phase 2):

   Present a coverage summary, then ask:

   ```
   Question: "Phase 1 exploration is complete.

   Coverage summary:
   - Pages discovered: [N]
   - Flows traced: [M] ([list flow IDs and names])
   - DOM/ARIA snapshots: [K]
   - Auth-gated areas: [reached / not reached — list any skipped]

   Would you like me to go deeper before I generate test scenarios?"

   Options:
   1. "Yes — explore [specific area / flow / auth-gated section] more deeply"
   2. "Yes — explore all auth-gated areas I haven't reached yet"
   3. "Looks complete — continue to Phase 2 (scenario planning)"
   4. "Stop here and save session state only — I'll resume later"
   ```

   **If user picks option 1 or 2**:
   - Perform the requested deeper exploration (BFS sub-crawl, targeted trace, or specific click sequence)
   - Use `snapshotPage()` for every new page — the same DOM/ARIA rules as Phase 1 apply. No screenshots.
   - Register all new snapshots in the relevant `flow.md` or create a new `F-NNN-*` flow if the area is distinct
   - After the deeper pass completes: **checkpoint** — append to `qa/state.md`:
     ```
     ## Deeper Exploration Pass — [timestamp]
     Areas explored: [list]
     New pages found: [N]
     New flows created: [list or none]
     Next: awaiting user direction
     ```
   - Loop back to step 3 — ask again. Repeat until user picks option 3 or 4.

   **If user picks option 4**:
   - Write final `qa/state.md` checkpoint (see below)
   - Generate the QA report: `node scripts/allure/generate-report.js --open`
   - **Stop**. Do not proceed to Phase 2.

   **If user picks option 3**: proceed to step 4.

4. **Generate the QA report** — one report covering all Phase 1 flows and any deeper passes:
   ```bash
   node scripts/allure/generate-report.js --open
   ```

5. **Checkpoint** — write `qa/state.md`:
   ```markdown
   ## Session State — Phase 1 Complete

   **App**: [app name] ([QA_APP_URL])
   **Platform**: web
   **Completed**: [timestamp]

   ### Coverage
   - Pages discovered: [N]
   - Flows traced: [M] — [list flow IDs]
   - Deeper exploration passes: [K] (or none)
   - Auth-gated flows pending: [list or none]

   ### Active Position
   Phase 1 complete. Proceeding to Phase 2 (scenario planning).

   ### Resume Command
   Re-invoke the skill. It will detect HAS_WORKSPACE mode and resume from Phase 2.
   ```

6. **Continue to Phase 2** — automatic from here.
   If auth-gated flows need credentials → ask user for credentials → once provided, continue.

---

## Phase 2: Scenario Planning

**Goal**: Generate test scenarios for every traced flow.
**Input**: `qa/flows/F-NNN-*/flow.md` files from Phase 1.
**Output**: `qa/flows/F-NNN-*/scenarios.md` per flow.
**Transition to Phase 3**: Automatic — after all scenarios written, immediately begin TC generation.

---

### Step W-7: Resolve Remaining Auth Gates

If Phase 1 BFS crawl skipped any auth gates (pages marked `⛔ AUTH REQUIRED` in ui-inventory.md), resolve them now before generating scenarios.

**Credential handling follows the same Auth-as-Gate protocol from Step W-2.6.** No duplication — same rules apply:
1. Check `.env.qa` → use if available
2. Ask user → provide in chat or tell agent to self-generate
3. Self-generate → disposable email + email verification flow (see below)
4. Use ONLY the auth method user chose — note others as "available but not tested"

After credentials resolved → **create `qa/auth.setup.ts`** so Playwright's `setup` project can save auth state:

```typescript
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto(process.env.QA_APP_URL || '/');

  // Navigate to login — adapt selectors to what discovery screenshots showed
  await page.getByRole('link', { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/login|signin|auth/, { timeout: 10000 }).catch(() => {});

  // Fill credentials from .env.qa
  await page.getByLabel(/email/i).fill(process.env.QA_TEST_EMAIL || '');
  await page.getByLabel(/password/i).fill(process.env.QA_TEST_PASSWORD || '');
  await page.getByRole('button', { name: /sign in|log in|submit/i }).click();

  // Wait for auth to complete — adapt to app's post-login state
  await page.waitForURL(/dashboard|home|app/, { timeout: 15000 }).catch(() => {});

  // Save auth state for reuse by other test projects
  await page.context().storageState({ path: AUTH_FILE });
});
```

**IMPORTANT**: This is a **starter template**. After writing it, read the Phase 1 auth-gate screenshots to adapt the selectors (login URL, field labels, button text, post-login URL) to match the actual app. The template above uses generic selectors that may not work for every app.

Then **re-run BFS crawl** from the auth-gated URLs to discover pages behind the gate. Add new pages to ui-inventory.md, create new flows for newly discovered feature areas.

#### Non-automatable Credentials

| Type | Action |
|------|--------|
| Google/X/Apple/GitHub SSO | `playwright codegen --save-storage=qa/.auth/sso.json [URL]` — mark as "requires manual session" |
| LLM API keys | User provides via .env.qa or chat |
| Stripe / payment | Use test card `4242 4242 4242 4242` if Stripe detected |
| TOTP / 2FA | User provides TOTP seed |
| Enterprise SSO / SAML | Out of scope — note in flow.md |

**Never block Phase 2** for non-automatable credentials. Continue with flows that have full access.

---

### Step W-9: Scenario Generation — Full Coverage

For each flow in `qa/flows/`, read `flow.md` and generate ALL scenarios using these rules:

#### Scenario Generation Rules

1. **Read the flow.md first** — every scenario MUST trace back to something observed in the Discovery Evidence table (a screenshot, a UI element, a page state). No invented scenarios.
2. **One scenario = one user intent + one expected outcome**. If a scenario has two assertions, split it.
3. **Naming**: `S-NNN-NN` — first NNN is the flow number, NN is sequence within flow. E.g., `S-001-01`, `S-001-02`.
4. **Cover all categories below** — for each flow, generate at minimum one scenario per applicable category. Skip categories that don't apply to that flow.
5. **Priority assignment**: P1 = user cannot complete their goal. P2 = degraded experience. P3 = cosmetic or edge case.

#### Universal scenario categories (apply to every flow):

| Category | Min per flow | Priority | Description |
|----------|-------------|----------|-------------|
| Happy path (end-to-end) | 1 | P1 | Complete the flow successfully with valid inputs |
| Required field validation | 1 per form | P1 | Submit with empty required fields |
| Invalid input | 1 per input | P1 | Wrong format, too long, special chars, SQL/XSS payloads |
| Boundary values | 1 per numeric/text input | P2 | Min, max, min-1, max+1, empty string |
| Error state recovery | 1 | P2 | After an error, can user retry and succeed? |
| Empty state | 1 | P2 | Page with no data (new user, empty list, no results) |
| Loading / slow network | 1 | P3 | Behavior during API calls, spinners, skeleton screens |
| Unauthorized access | 1 per auth-gated page | P1 | Direct URL access without login |

#### Web-specific scenario categories (apply in addition to the universal categories):

| Category | Min | Priority | When |
|----------|-----|----------|------|
| SPA route access (direct URL entry) | 1 | P1 | Every route |
| Auth guard (unauthenticated → protected route) | 1 | P1 | Auth-gated routes |
| Form validation (inline + on submit) | 2+ | P1 | Any form |
| Mobile viewport (375px, 390px) | 1 | P2 | Every page |
| Network error / API failure | 1 | P2 | Forms with API calls |
| Console error monitoring | 1 | P2 | Every page |
| WCAG accessibility (axe-core) | 1 | P3 | Every page |
| Visual regression baseline | 1 | P3 | Key pages |

**Target**: Use the discovery screenshots from Phase 1 to inform EVERY scenario. If a screenshot showed a specific UI element, write a test for it. Full coverage means every visible interactive element has at least one TC.

**Phase boundary checkpoint** — write full `qa/state.md` (heavy checkpoint per root SKILL.md). Generate QA report. Log: `"Phase 2 complete — [N] scenarios across [N] flows."`

---

## Phase 3: Test Case Generation — Three-Layer Spec Suite

**Goal**: Write shippable, runnable test code in three coordinated layers — scenario functions, standalone wrappers, and sequential E2E journeys. No intermediate TC markdown files.
**Input**: `qa/flows/F-NNN-*/scenarios.md` files from Phase 2 + DOM/ARIA snapshots from Phase 1.
**Output**:
  - `qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts` — exported async scenario functions (reusable core)
  - `qa/tests/F-NNN-<slug>.spec.ts` — thin standalone spec wrappers (run any flow in isolation)
  - `qa/journeys/J-NNN-<role>.spec.ts` — sequential E2E journeys (shared browser session, `test.step()` chains)
  - `qa/journey-todo/J-NNN-<role>.todo.md` — generation + runtime tracking per journey

**Transition to Phase 4**: Automatic — after all flow specs written and journeys assembled, Phase 4 runs them.

**Context management — CRITICAL**: Write ONE flow's `F-NNN.scenarios.ts` per context window. After each flow:
1. Write `F-NNN.scenarios.ts` + `qa/tests/F-NNN-<slug>.spec.ts`
2. Append `test.step()` calls for this flow into the relevant `qa/journeys/J-NNN.spec.ts`
3. Mark flow done in `qa/journey-todo/J-NNN.todo.md`
4. Checkpoint `qa/state.md`
5. Tell user: *"F-NNN done ([N] functions). Next: F-[NNN+1] — [name]. Say 'continue'."*

Never write multiple flows in one context window if the previous flow had >25 functions.

---

### Step W-10: Three-Layer Spec Writing

**Quality Contract — every scenario function and spec file MUST satisfy ALL of these before Phase 4:**
1. **Syntactically valid TypeScript** — no missing `await`, no unresolved imports, no `any` on assertions.
2. **Logically complete** — every function body has a meaningful `expect()` assertion. No `// TODO`, no empty assertions.
3. **No placeholder values** — no `[selector]`, `[route]`, `[label]`, `[value]` remaining.
4. **No hardcoded credentials** — all creds via `process.env.QA_*`.
5. **Semantic locators preferred** — `getByRole` > `getByLabel` > `getByTestId` > CSS. CSS only with a comment.
6. **No bare `waitForTimeout`** — replace with `waitForSelector`, `waitForResponse`, `waitForURL`, or `waitForFunction`.
7. **storageState set at describe level or via journey config** — never re-login inside a function that expects a cached session.

**Standards:**
- `waitUntil: 'domcontentloaded'` (never `networkidle` on SPAs)
- All URLs are relative — `page.goto('/')` not `page.goto('https://...')`
- `baseURL` from `QA_APP_URL` via `qa/playwright.config.ts`
- Credentials always from `process.env.QA_TEST_EMAIL` — never hardcoded
- Locators derived from DOM/ARIA snapshots — use `aria-label`, `role`, `name`, `placeholder` values from `.snapshot.json` files

---

#### Layer 1: Scenario Functions (`qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts`)

Each scenario from `scenarios.md` becomes an exported async function that receives `page` and `context` from the caller. Functions are plain async — no Playwright fixtures, no imports from `@playwright/test` fixture types beyond `Page` and `BrowserContext`:

```typescript
// qa/flows/F-001-marketing-landing/F-001.scenarios.ts
// Callable from standalone tests (qa/tests/) OR journey specs (qa/journeys/)
// Standalone: npx playwright test tests/F-001-marketing-landing.spec.ts
// Journey:    npx playwright test journeys/J-000-anonymous.spec.ts
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
 * S-001-02: CTA — "Sign up" routes to /account (signup mode)
 * Entry: page is at '/'  |  Exit: page is at '/account'
 */
export async function S_001_02_ctaSignUp(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.getByRole('link', { name: 'Sign up' }).click();
  await page.waitForURL(/\/account/, { timeout: 10000 });
  await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible();
}

/**
 * S-001-06: Negative — demo widget "Type a message…" must not submit
 * Entry: any  |  Exit: page is at '/', no navigation occurred
 */
export async function S_001_06_demoWidgetNoSubmit(page: Page, _ctx: BrowserContext): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const requests: string[] = [];
  page.on('request', r => requests.push(r.url()));
  await page.getByPlaceholder(/type a message/i).fill('hello');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const postsFired = requests.filter(u => u.includes('/api') || u.includes('/chat'));
  await expect(page).toHaveURL('/');
  if (postsFired.length > 0) throw new Error(`Unexpected API call from demo widget: ${postsFired[0]}`);
}

// ... one exported function per scenario in scenarios.md
// Naming: S_NNN_NN_camelCaseDescription — matches scenario ID exactly
```

**Rules for scenario functions:**
- **Self-contained navigation**: every function navigates to its required entry URL at the start (unless the JSDoc explicitly states it continues from the caller's position)
- **No cross-function calls**: functions do NOT call other scenario functions
- **Entry/exit documented**: JSDoc `Entry:` / `Exit:` lines tell the journey what state is left after calling this function
- **Journey-continuation functions**: in the journey spec, successive `test.step()` calls share the same `page`. If function N's exit state is function N+1's entry state, skip the redundant `page.goto()` in function N+1 — note this in the JSDoc

---

#### Layer 2: Standalone Spec Wrappers (`qa/tests/F-NNN-<slug>.spec.ts`)

Thin files that import the scenario module and wrap each exported function in a `test()` block. In standalone mode, each test gets a fresh Playwright page — functions that rely on prior navigation should call `page.goto()` themselves (the scenario functions already do this):

```typescript
// qa/tests/F-001-marketing-landing.spec.ts
import { test } from '@playwright/test';
import * as F001 from '../flows/F-001-marketing-landing/F-001.scenarios';

test.describe('F-001: Marketing Landing', () => {

  test('S-001-01: Happy path — home loads', async ({ page, context }) => {
    await F001.S_001_01_happyPath(page, context);
  });

  test('S-001-02: CTA — Sign up routes to /account', async ({ page, context }) => {
    await page.goto('/');  // explicit reset — this test's entry state is '/'
    await F001.S_001_02_ctaSignUp(page, context);
  });

  test('S-001-06: Demo widget — no submit on Enter', async ({ page, context }) => {
    await F001.S_001_06_demoWidgetNoSubmit(page, context);
  });

});
```

Run standalone: `npx playwright test tests/F-001-marketing-landing.spec.ts`

**For mixed-auth flows** (e.g. F-003 — Authentication): use `test.use()` inside `test.describe()` to set storageState per group:

```typescript
// qa/tests/F-003-authentication.spec.ts
import { test } from '@playwright/test';
import * as F003 from '../flows/F-003-authentication/F-003.scenarios';

test.describe('F-003: Auth — unauthenticated scenarios', () => {
  // no storageState — test.use() not needed for anonymous group
  test('S-003-01: Sign in happy path', async ({ page, context }) => {
    await F003.S_003_01_signIn(page, context);
  });
  test('S-003-04: Invalid email rejected', async ({ page, context }) => {
    await F003.S_003_04_invalidEmail(page, context);
  });
});

test.describe('F-003: Auth — session-required scenarios', () => {
  test.use({ storageState: '.auth/free.json' });  // relative to qa/ (rootDir)
  test('S-003-14: Session persistence', async ({ page, context }) => {
    await F003.S_003_14_sessionPersistence(page, context);
  });
  test('S-003-16: Sign out', async ({ page, context }) => {
    await F003.S_003_16_signOut(page, context);
  });
});
```

---

#### Layer 3: Sequential Journey Specs (`qa/journeys/J-NNN-<role>.spec.ts`)

The actual E2E journey — ONE `test()` block per journey. Every scenario call is a `test.step()` for granular step-level pass/fail reporting. The same `page` and `context` flow through the entire journey — browser state carries forward between steps.

Journey scenario selection: include all **P1** scenarios + **P2** scenarios that create state the next flow depends on. Skip P3 (aesthetic/SEO/mobile viewport) — those are covered by standalone tests only.

```typescript
// qa/journeys/J-000-anonymous.spec.ts
// Sequential E2E — anonymous user journey, single browser session
// Run: npx playwright test journeys/J-000-anonymous.spec.ts

import { test, expect } from '@playwright/test';
import * as F001 from '../flows/F-001-marketing-landing/F-001.scenarios';
import * as F002 from '../flows/F-002-pricing/F-002.scenarios';
import * as F003 from '../flows/F-003-authentication/F-003.scenarios';
import * as F004 from '../flows/F-004-tutorials/F-004.scenarios';
// ... import all flows for this role

test('J-000: Anonymous user journey — full E2E', async ({ page, context }) => {

  // ── F-001: Marketing Landing ──────────────────────────────────
  await test.step('F-001-S-001-01: Landing page loads', () =>
    F001.S_001_01_happyPath(page, context));
  await test.step('F-001-S-001-08: External links have noopener', () =>
    F001.S_001_08_externalLinkSafety(page, context));
  await test.step('F-001-S-001-10: Accessibility — axe-core baseline', () =>
    F001.S_001_10_accessibility(page, context));

  // ── F-002: Pricing & Plans ────────────────────────────────────
  await test.step('F-002-S-002-01: Pricing page renders both tiers', () =>
    F002.S_002_01_happyPath(page, context));
  await test.step('F-002-S-002-04: Pro ladder updates spec label', () =>
    F002.S_002_04_ladderSelection(page, context));

  // ── F-003: Authentication (anonymous scenarios only) ──────────
  await test.step('F-003-S-003-04: Invalid email format rejected', () =>
    F003.S_003_04_invalidEmail(page, context));
  await test.step('F-003-S-003-13: /dashboard unauthenticated → signin redirect', () =>
    F003.S_003_13_authGuard(page, context));

  // ── F-004: Tutorials ─────────────────────────────────────────
  await test.step('F-004-S-004-01: /tutorial renders wizard outline', () =>
    F004.S_004_01_happyPath(page, context));

  // ... continue for all flows assigned to this role

});
```

```typescript
// qa/journeys/J-001-free.spec.ts
// Sequential E2E — free-tier authenticated journey
import { test } from '@playwright/test';
import * as F003 from '../flows/F-003-authentication/F-003.scenarios';
import * as F009 from '../flows/F-009-dashboard/F-009.scenarios';
import * as F012 from '../flows/F-012-unshipped-features/F-012.scenarios';

// storageState applied at file level — all steps in this journey run with free session
test.use({ storageState: '.auth/free.json' });

test('J-001: Free-tier user journey — full E2E', async ({ page, context }) => {

  // ── F-003: Auth — session-required scenarios ──────────────────
  await test.step('F-003-S-003-14: Session persists on reload', () =>
    F003.S_003_14_sessionPersistence(page, context));

  // ── F-009: Authenticated Dashboard ───────────────────────────
  await test.step('F-009-S-009-01: Dashboard renders for free user', () =>
    F009.S_009_01_happyPath(page, context));
  await test.step('F-009-S-009-13: Sidebar — Assistants tab swap', () =>
    F009.S_009_13_sidebarAssistants(page, context));
  await test.step('F-009-S-009-14: Sidebar — AI Models tab swap', () =>
    F009.S_009_14_sidebarAiModels(page, context));

  // ── F-012: Unshipped / Stub Surfaces ──────────────────────────
  await test.step('F-012-S-012-01: /channels redirects to /tutorial', () =>
    F012.S_012_01_channelsRedirect(page, context));
  await test.step('F-012-S-012-03: /agents returns 404', () =>
    F012.S_012_03_agentsFourOhFour(page, context));
  await test.step('F-012-S-012-08: 404 Return-to-Dashboard CTA works', () =>
    F012.S_012_08_returnToDashboard(page, context));

  // Sign out last — confirms auth teardown
  await test.step('F-003-S-003-16: Sign out clears session', () =>
    F003.S_003_16_signOut(page, context));

});
```

Run journey: `npx playwright test journeys/J-001-free.spec.ts`

---

#### Journey Todo File (`qa/journey-todo/J-NNN-<role>.todo.md`)

Create one todo file per journey **at the start of Phase 3**, before writing any code. Update it as each flow is generated. The agent reads this file on resume to find the next pending flow:

```markdown
# Journey Todo — J-000-anonymous
# Updated: [YYYY-MM-DD]
# Purpose: tracks Phase 3 generation progress + Phase 4 runtime execution

## Generation Progress

| Flow | Scenarios.ts Written | Standalone Spec | Added to Journey | Steps Selected |
|------|---------------------|-----------------|-----------------|----------------|
| F-001 | ✅ done | ✅ done | ✅ done | 5/13 (P1+P2) |
| F-002 | ✅ done | ✅ done | ✅ done | 4/11 (P1+P2) |
| F-003 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-004 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-005 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-006 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-007 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-008 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-010 | ⬜ pending | ⬜ pending | ⬜ pending | — |
| F-011 | ⬜ pending | ⬜ pending | ⬜ pending | — |

## Journey Step Execution (Phase 4 — updated after run)

| Step | Scenario ID | Function | Status | Error |
|------|-------------|----------|--------|-------|
| 1 | S-001-01 | S_001_01_happyPath | ⬜ pending | — |
| 2 | S-001-08 | S_001_08_externalLinkSafety | ⬜ pending | — |
| 3 | S-001-10 | S_001_10_accessibility | ⬜ pending | — |
| 4 | S-002-01 | S_002_01_happyPath | ⬜ pending | — |
| ... | | | | |

## Notes
- Journey includes P1 + stateful P2 scenarios only; P3 covered by standalone tests only
- Steps 1–N populated as each flow is generated in Phase 3
```

Status values: `⬜ pending` → `⏳ running` → `✅ done` / `❌ failed([reason])`

---

**After all flows written**, write the runner infrastructure:

```javascript
// qa/run.js
#!/usr/bin/env node
// node qa/run.js                          → all tests (standalone + journeys)
// node qa/run.js --flow F-001             → standalone flow only
// node qa/run.js --journey J-000          → one E2E journey
// node qa/run.js --suite standalone       → all qa/tests/ specs
// node qa/run.js --suite journeys         → all qa/journeys/ specs

const { execSync } = require('child_process');
const args = process.argv.slice(2);
const get  = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const flow    = get('--flow');
const journey = get('--journey');
const suite   = get('--suite');

console.log('→ Installing dependencies...');
execSync('npm install --silent', { stdio: 'inherit', cwd: __dirname });
execSync('node ./node_modules/playwright/cli.js install chromium --quiet', { stdio: 'inherit', cwd: __dirname });

let target = '';
if (flow)                       target = `tests/${flow}-*.spec.ts`;
else if (journey)               target = `journeys/${journey}-*.spec.ts`;
else if (suite === 'standalone') target = 'tests/';
else if (suite === 'journeys')   target = 'journeys/';
// else: testMatch in playwright.config.ts picks up both tests/ and journeys/

const cmd = [
  'node ./node_modules/playwright/cli.js test',
  '--config playwright.config.ts',
  '--reporter=html --continue-on-failure',
  target,
].filter(Boolean).join(' ');

console.log(`→ Running: ${cmd}`);
execSync(cmd, { stdio: 'inherit', cwd: __dirname });
```

```json
// qa/package.json
{
  "name": "qa-suite",
  "private": true,
  "scripts": {
    "test": "node run.js",
    "test:standalone": "node run.js --suite standalone",
    "test:journeys": "node run.js --suite journeys",
    "test:flow": "node run.js --flow",
    "test:journey": "node run.js --journey"
  },
  "dependencies": { "@playwright/test": "^1.44.0", "dotenv": "^16.0.0" }
}
```

Also copy `.env.example` to `qa/.env.example` if it doesn't already exist.

**Phase boundary checkpoint** — write full `qa/state.md`. Log: `"Phase 3 complete — [N] scenario modules, [N] standalone specs, [N] journey specs."`

Announce to user:
> "✅ Shippable test suite ready:
> - `qa/tests/` — [N] standalone flow specs (run any flow independently)
> - `qa/journeys/` — [N] sequential E2E journeys (shared browser session)
>
> **Run standalone flow**: `node qa/run.js --flow F-001`
> **Run journey**: `node qa/run.js --journey J-000`
> **Run all**: `node qa/run.js`
> **To share**: `zip -r qa-suite.zip qa/flows/ qa/tests/ qa/journeys/ qa/journey-todo/ qa/run.js qa/package.json qa/playwright.config.ts`"

---

## Phase 4: Test Execution & Reporting

**Goal**: Run the test suite and generate the final report.
**Input**: `qa/tests/F-NNN-*.spec.ts` (standalone) + `qa/journeys/J-NNN-*.spec.ts` (E2E journeys) written in Phase 3.
**Output**: Pass/fail results per flow/journey + unified HTML report.
**No test writing in this phase** — Phase 4 is execution only.

---

### Step W-11: Execution with Run-State Tracking

Before running, update the execution status section in each `qa/journey-todo/J-NNN.todo.md` — mark all steps `⬜ pending`. This is the runtime tracking record.

Write `qa/run-state.md` (the high-level run overview — ≤30 lines):

```markdown
# Run State — [AppName] [YYYY-MM-DD HH:MM]
> Resume: re-trigger `/native-qa` → option 1, or `node qa/run.js`

| Suite | Type | Tests | Status | Failure |
|-------|------|-------|--------|---------|
| J-000-anonymous | E2E journey | [N] | ⬜ pending | — |
| J-001-free | E2E journey | [N] | ⬜ pending | — |
| F-001-standalone | Standalone | [N] | ⬜ pending | — |
```

Then for each journey row, in order:
1. Update row status → `⏳ running`; mark steps `⏳ running` in journey-todo
2. `cd qa && node ./node_modules/playwright/cli.js test journeys/J-NNN-*.spec.ts --config playwright.config.ts --reporter=line --continue-on-failure`
3. Parse exit code + first failure step from stdout
4. Update row → `✅ done` or `❌ failed([step name]: [first-failure-text])`
5. Update journey-todo step statuses to `✅ done` or `❌ failed(...)` based on output

**Resume from partial failure**: on re-trigger, read `qa/run-state.md`, skip `✅ done` rows, continue from first non-done row.

After all journey rows terminal, run standalone suite:
```bash
cd qa && node ./node_modules/playwright/cli.js test tests/ --config playwright.config.ts --reporter=line --continue-on-failure
```

After all rows terminal:
- Generate report: `node scripts/allure/generate-report.js --open`
- Append to `qa/run-state.md`: `Result: N/M journeys passed. Failed: J-NNN. Report: qa/playwright-report/index.html`

---

### Step W-12: Generate Final Report

```bash
node scripts/allure/generate-report.js --open
```

Tell the user: `"✅ All 4 phases complete. [N] flows, [N] scenarios, [N] passed / [N] failed. Report opened."`

**To share the test suite:**
```bash
zip -r qa-suite.zip qa/flows/**/F-NNN.scenarios.ts qa/tests/ qa/journeys/ qa/journey-todo/ \
  qa/run.js qa/package.json qa/playwright.config.ts qa/.env.example
```
Recipient: `unzip qa-suite.zip && cp .env.example .env.qa` (fill URL + creds) → `node run.js`

---

### Step W-13: Update Mode

Triggered when `HAS_WORKSPACE` is detected (scenario modules or spec files already exist). The workspace has completed at least one full run. The goal is to **incrementally update** — not redo everything from scratch.

#### W-13.1: Read Current State

```bash
cat qa/state.md
cat qa/.qa-config.json
ls qa/flows/*/flow.md 2>/dev/null | wc -l
ls qa/tests/*.spec.ts 2>/dev/null | wc -l
ls qa/journeys/*.spec.ts 2>/dev/null | wc -l
```

Present to user:
> "Existing workspace for **[AppName]**:
>
> | Field | Value |
> |-------|-------|
> | Flows | [N] |
> | Standalone specs | [N] in qa/tests/ |
> | Journey specs | [N] in qa/journeys/ |
> | Last run | [date from state.md] |
>
> What would you like to do?
>
> **1) Re-discover** — re-crawl the app, find new pages/flows, regenerate affected scenario modules + specs
> **2) Add flows** — add specific new flows without re-crawling, write new scenario modules and append to relevant journeys
> **3) Re-run tests** — re-execute existing specs and generate fresh report
> **4) Full refresh** — delete all flows, snapshots, scenario modules and specs, start Phase 1 from scratch"

Wait for user's choice.

#### W-13.2: Route Based on Choice

- **"1" / "re-discover"** → Delete `qa/crawl-state.json` (force fresh crawl), then run Step W-2 (BFS crawl). Compare new page inventory with existing `ui-inventory.md`. For new pages not in any existing flow → create new flow directories. For changed flows → regenerate `F-NNN.scenarios.ts`, the standalone `qa/tests/F-NNN-*.spec.ts`, and update `test.step()` calls in the relevant `qa/journeys/J-NNN-<role>.spec.ts`. Unchanged flows untouched.

- **"2" / "add flows"** → Ask user which flows to add. Create new `F-NNN-*` directories. Run Phase 1 trace (DOM/ARIA snapshots) → Phase 2 scenarios → write `F-NNN.scenarios.ts` → write `qa/tests/F-NNN-<slug>.spec.ts` → append `import` + `test.step()` blocks to the relevant `qa/journeys/J-NNN-<role>.spec.ts`. Add new rows to the relevant `qa/journey-todo/J-NNN.todo.md`. Existing specs untouched for unchanged flows.

- **"3" / "re-run"** → Jump directly to Step W-11. Skip all discovery and generation.

- **"4" / "full refresh"** → Delete `qa/flows/` (docs + scenario modules), `qa/knowledgebase/`, `qa/tests/`, `qa/journeys/`, `qa/journey-todo/`, `qa/state.md`, `qa/crawl-state.json`. Keep `qa/.qa-config.json` and `qa/context/`. Then jump to Step W-2 — full Phase 1 restart with existing config.

---

## Key Rules — Web Skill

### Correctness

1. **Never hardcode URLs** — always `process.env.QA_APP_URL` or `page.goto('/')` (relative)
2. **Never hardcode credentials** — always `process.env.QA_TEST_EMAIL`, `process.env.QA_TEST_PASSWORD`
3. **Never use `networkidle`** — use `domcontentloaded` + `QA_PAGE_WAIT_MS` (configurable minimum wait)
4. **Always use `snapshotPage()`** for discovery — never raw `page.screenshot()` during Phase 1/2. Screenshots are taken by Playwright automatically only on test failure during Phase 4. DOM/ARIA snapshots are the discovery record; PNGs are failure evidence.
5. **Snapshot BEFORE credential fill** — run `snapshotPage()` before filling any form so the snapshot reflects the clean empty state. DOM extraction runs after for link discovery.
5a. **Never guess SPA sub-routes in probe scripts** — SPAs use client-side routing. A direct `page.goto('${QA_APP_URL}dashboard/channels')` will 404 because the route doesn't exist on the server. Instead, load the authenticated entry point (e.g. `/dashboard`) and navigate via UI clicks. If you must use `page.goto()` for a known anchor URL, always check `page.url()` after navigation and skip snapshotting if it redirected to an error page.
6. **Verify every navigation** — compare `page.url()` to intended URL; name snapshots by ACTUAL URL slug, not intended destination
7. **Credentials gate** — do not write journey specs until user confirms `.env.qa` is populated
8. **Relative URLs only** in test files — `'/'` not `'https://app.example.com/'`
9. **Scope nav selectors** to `page.locator('nav, header').first()` — avoid footer duplicates
10. **Never click destructive buttons** during BFS discovery — use the safe whitelist (W-2.5)
11. **No duplicate test code** — scenario logic lives only in `qa/flows/F-NNN-*/F-NNN.scenarios.ts`. Standalone wrappers (`qa/tests/`) and journey specs (`qa/journeys/`) import and call those functions — they do NOT copy test code. No `TC-*.md` files anywhere.

### Performance

12. **Configurable page wait** — `QA_PAGE_WAIT_MS` (default 2000ms) runs after every navigation. Tune per-app in `.env.qa`.
13. **BFS limits** — `QA_MAX_PAGES` (default 50) and `QA_MAX_DEPTH` (default 5) prevent infinite crawl and context exhaustion.
14. **Disk state persistence** — `qa/crawl-state.json` written after every page. BFS survives context resets.
15. **Content fingerprinting** — detects duplicate pages at different URLs. Prevents wasted snapshots and context.
16. **Reuse browser, fresh context** — launch browser once per session, `browser.newContext()` per flow, `context.close()` after each flow.
17. **Lightweight snapshot coverage check** — use the inline script in "Phase 1 → Phase 2 Transition". Only run at phase boundaries.
