# Web — Phase 1: Discovery

**Goal**: Discover EVERY reachable page via deep BFS crawl using DOM and ARIA snapshots — no image processing.
**Priority**: Exploration first. Auth is a gate to pass through, not a journey to trace. **NEVER skip any credential gate, setup step, or onboarding step without explicit user permission.**
**Snapshot rule**: every "visual" observation comes from DOM/ARIA — `role="img"`, `alt`, `aria-label`, class names. No `Read` calls on PNGs during discovery.
**Transition gate**: after all flows traced, run the **deep-exploration AskUserQuestion** before Phase 2. User either requests more exploration or approves.

## ⛔ PHASE 1 OUTPUT BOUNDARY — HARD RULE

Phase 1 creates EXACTLY these files and nothing else:

| File | Location | Created when |
|---|---|---|
| `flow.md` | `qa/flows/F-NNN-<slug>/flow.md` | W-3: one per feature area, discovery evidence only |
| `manifest.jsonl` | `qa/flows/F-NNN-<slug>/manifest.jsonl` | W-3: step-by-step trace plan |
| `trace.jsonl` | `qa/flows/F-NNN-<slug>/trace.jsonl` | W-2.5+: per-flow action recording, transpiled by Phase 3 |
| `ui-inventory.md` | `qa/knowledgebase/` | W-2.5: ongoing, updated per page |
| `nav-graph.md` | `qa/knowledgebase/` | W-2.5: ongoing |
| `uig.jsonl` | `qa/knowledgebase/` | W-2.5: append-only Interactable Graph; primary input to Phase 3 |
| `roles.md` | `qa/knowledgebase/` | W-2.9 |
| `flow-categories.md` | `qa/knowledgebase/` | W-2.9 |
| `journey-inventory.md` | `qa/knowledgebase/` | W-6 |
| `crawl-todo.md` | `qa/knowledgebase/` | W-2.5: URL discovery tracker |
| `*.snapshot.json` | `qa/knowledgebase/aria-snapshots/` | W-2.5: per page |
| `crawl-state.json` | `qa/` | W-2.5: BFS state |
| `app-quirks.yml` | `qa/` | P1→P2 boundary: auto-derived (see `scripts/derive-quirks.js`) |
| `decisions.md` | `qa/` | ongoing |
| `state.md` | `qa/` | checkpoints |

**DO NOT write in Phase 1:**
- `scenarios.md` — that is Phase 2 output
- `F-NNN.scenarios.ts` — that is Phase 3 output
- `*.spec.ts` files of any kind — that is Phase 3 output
- Any file under `qa/tests/` or `qa/journeys/` — Phase 3 only

Runtime rules — see `skills/_shared/runtime.md` (engagement, checkpoints, navigation, browser launch, token discipline).

---

## Pre-Step: Load Prior Knowledge

```bash
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

- If `ui-inventory.md` exists — read it; prioritize routes/pages named there. Confirm via Playwright.
- If `qa/context/` has unread files — read them before opening the browser.
- Otherwise — cold start; crawl from homepage.

---

## Step W-1: Workspace Setup

Confirm:
- `.qa-config.json` has `"platform": "web"`
- `QA_APP_URL` is set in `.env.qa`
- `qa/knowledgebase/aria-snapshots/` exists (replaces `screenshots/` for discovery)

> `init-workspace.js` already created all `qa/` subdirectories in Step 1.2. Do NOT run `mkdir` here — it is redundant and causes a spurious permission prompt.

Then write the Playwright config to `qa/playwright.config.ts`. **Template**: `skills/web/templates/playwright.config.ts` (read it, copy to `qa/`, no edits required — reads `.env.qa` dynamically). All run commands use `--config qa/playwright.config.ts`.

---

## Step W-1.5: Preflight — Verify & Auto-Install with Consent

> Engagement protocol (`skills/_shared/runtime.md` §1): preflight MUST NOT throw. Each missing item = `AskUserQuestion` with four options: (a) auto-install, (b) provide value now, (c) fix manually then "continue", (d) skip the affected feature.

**Run checks in this exact order — each unblocks the next:**

```bash
# 1. node_modules — MUST be installed before any playwright binary check
[ -d node_modules/@playwright/test ] && echo "ok" || echo "MISSING: node_modules"
```

If `node_modules` is missing: ask consent, then run `npm install` from the project root before proceeding to check 2.

```bash
# 2. Chromium binary — verify by actually launching it, NOT with --dry-run.
# --dry-run always prints "Download url:" regardless of install state — it is not a reliable check.
node -e "
const {chromium} = require('@playwright/test');
chromium.launch({headless:true}).then(b=>{console.log('ok');b.close();}).catch(()=>console.log('MISSING'));
" 2>/dev/null
```

If result is `MISSING`: run `./node_modules/.bin/playwright install chromium` (NOT `npx playwright install` — npx fails if `node_modules/.bin` is not on PATH). The install command is silent on success and exits 0. After install, re-run the launch test above to confirm — **never use `--dry-run` as a verification step**.

```bash
# 3. .env.qa exists
[ -f .env.qa ] && echo "ok" || echo "MISSING: .env.qa"

# 4. QA_APP_URL set
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_APP_URL" ] ) \
  && echo "ok" || echo "MISSING: QA_APP_URL"

# 5. Default-role creds (non-blocking)
( set -a; [ -f .env.qa ] && . ./.env.qa; set +a; [ -n "$QA_TEST_EMAIL" ] && [ -n "$QA_TEST_PASSWORD" ] ) \
  && echo "ok" || echo "WARN: no QA_TEST_EMAIL/PASSWORD — W-2.9 reconciles"
```

Auto-install only on explicit consent. Append every preflight outcome to `qa/decisions.md` as one dated entry. Per-role credentials deferred to W-2.9.

---

## Step W-2: Exploration — BFS with on-demand helpers

> ⛔ **There is no strategy-selection step.** BFS is the only strategy. Read `skills/web/strategies/README.md` once for context — it is an index of helpers BFS calls, not a menu to pick from.

### W-2.1 — Read the fingerprint (context only, not for strategy choice)

Read `qa/platform-fingerprint.md`. The fingerprint informs *runtime parameters* (e.g. seeding sitemap-spot-check for content-heavy sites, expected post-gate URL pattern for auth-bootstrap), not strategy selection.

### W-2.2 — Helpers BFS may invoke

| Helper | When BFS invokes it |
|---|---|
| `auth-bootstrap` (file: `strategies/targeted-trace.md`, kept for compatibility) | A sign-up / login / onboarding wall blocks reachability of the post-gate surface. Helper drives the persona path past the gate, saves `storageState`, returns. BFS resumes. |
| `sitemap-spot-check` (file: `strategies/sitemap-spot-check.md`) | Same content fingerprint observed on > 30% of visited pages — breadth crawling adds no signal. Helper samples N URLs per template group, then BFS resumes on returned URLs. |
| `wiggle-pass` (file: `templates/wiggle-pass.js`) | A disabled control is observed on the critical path — helper toggles enabled siblings to learn its preconditions, writes them to `uig.jsonl`. |
| `credential-fanout` (file: `helpers/credential-fanout.md`) | Any input field on any page matches a credential type registered in `.env.qa` — helper auto-fills and submits. |

Numeric escalation thresholds (when each helper fires) live in `skills/web/helpers/escalation-triggers.md`. Read it once.

### W-2.3 — Log helper invocations (not strategy choices)

Do **not** write `## Strategy chosen` entries. When BFS calls a helper, append:

```markdown
## YYYY-MM-DD HH:MM — <helper-name> invoked
**Trigger**: <numeric threshold or observation that fired the helper>
**Result**: <outcome — e.g. storageState saved, N URLs sampled, preconditions discovered>
```

### W-2.4 — Write `qa/scripts/explore.js`

Always copy `bfs.md`'s skeleton into `qa/scripts/explore.js` (no dispatcher needed — there is no choice). The skeleton already calls `auth-bootstrap`, `sitemap-spot-check`, `wiggle-pass`, and `credential-fanout` on the conditions defined in `escalation-triggers.md`. Header comment is mandatory:

```javascript
// Why: BFS exploration with on-demand helpers (auth-bootstrap, sitemap-spot-check, wiggle-pass, credential-fanout).
// Strategy: BFS — see skills/web/strategies/bfs.md
// Helpers: invoked by escalation triggers in skills/web/helpers/escalation-triggers.md
```

### W-2.5 — Execute + DOM/ARIA snapshot + analyze

> ⛔ **`page.accessibility` is removed in Playwright ≥ 1.49.** Any inline probe or script that calls `page.accessibility.snapshot()` will throw `Cannot read properties of undefined (reading 'snapshot')`. This applies to fingerprint probes written before `snapshot-page.js` is copied too. Always use:
> ```javascript
> const aria = await page.locator('body').ariaSnapshot().catch(() => null);
> ```
> This is the ONLY correct ARIA API. Never write `page.accessibility` anywhere.

> ⛔ **Always run `node` probes from the repo root with an absolute path.** Never assume a relative subdirectory exists — `cd qa && node -e "..."` fails if the shell is already inside `qa/` or if `qa/` doesn't exist yet. Always use:
> ```bash
> cd /absolute/path/to/repo && node -e "..."
> ```
> Or verify first: `ls qa/ 2>/dev/null || echo MISSING`. Never `cd` into a directory without confirming it exists.

For every page/step — **no image reading, no `Read` on PNGs**:

1. Navigate / interact via Playwright (click, don't goto — see runtime.md §6).
2. Wait `QA_PAGE_WAIT_MS`.
3. Verify state via `page.url()` and `page.title()`.
4. Capture DOM/ARIA snapshot via `snapshotPage()` — implementation lives at `skills/web/templates/snapshot-page.js`. Copy it to `qa/scripts/snapshot-page.js` once at session start, then `require()`. Each snapshot includes a `capturedAt` ISO timestamp.
5. Analyze the snapshot: `dom.headings`, `dom.buttons`, `dom.links`, `dom.inputs`, `dom.images`, `dom.alerts`, ARIA tree. Decide next action from structured data.
6. Record observations in `flow.md` discovery evidence using snapshot fields — never PNG paths.
7. **Register discovered links + mark current page explored** — two operations per tick:
   ```bash
   # Register any NEW links found on this page (appends to crawl-todo, no-ops for existing)
   node scripts/update-crawl-todo.js --discover "$URL1,$URL2,..."

   # Mark the page just visited as explored
   node scripts/update-crawl-todo.js --mark-explored "$CURRENT_URL"
   ```
   `qa/knowledgebase/crawl-todo.md` is the **persistent coverage tracker** — a URL table that accumulates through the whole session. Status values: `⬜ pending` → `🔄 in-progress` → `✅ explored` | `⛔ skipped`. Read it any time to see what has been visited and what is still queued without opening snapshot files. It is the primary anti-hallucination guard: never assert a page was explored unless it is `✅` in this table.

   **SPA states (single-URL apps)**: dashboards that swap panels via JS clicks share one URL. The crawl tracker keys on URL alone, so `Assistants` / `AI Models` / `Devices` panels at `/dashboard` would all collapse into one row and be invisible to the gate. To prevent this, register every distinct DOM state as a synthetic key `<url>#<state-slug>`:
   ```bash
   node scripts/update-crawl-todo.js --discover "https://app/dashboard#assistants,https://app/dashboard#ai-models,https://app/dashboard#devices"
   node scripts/update-crawl-todo.js --mark-explored "https://app/dashboard#assistants"
   ```
   Use the same slug you pass to `snapshotPage()`. Modals, tabs, drawers, and wizard steps all count — if it has its own snapshot, it has its own crawl-todo row. The Phase 1 → Phase 2 gate will block until each is `✅` or `⛔`.

   **Screenshot fallback (low ARIA fidelity)**: `snapshotPage()` writes a `.png` next to the `.snapshot.json` and computes an `ariaFidelity` field (`ok` | `low`). Do NOT `Read` the PNG by default — it burns tokens. Read it only when:
   - `ariaFidelity === 'low'` for a page on the critical path (icon-only buttons with no `aria-label` — common React/Tailwind pattern), OR
   - a flow asserts visual state that ARIA can't express (modal opened, toast appeared, layout regression).

   When you do read a PNG to ground a label, log the decision in `qa/decisions.md` with the slug and the specific element you needed it for.

Shared session artefacts (all strategies):
- `qa/knowledgebase/aria-snapshots/*.snapshot.json` — per visited state
- `qa/knowledgebase/ui-inventory.md` — page inventory with per-page actuation counts (D2 schema below). Replaces the older prose-style table — frontier-gate.js reads numeric columns directly.

  **Required schema (every page, every visit)**:
  ```
  | url | snapshot | links_found | links_followed | inputs_filled | buttons_clicked | modals_opened | modals_submitted | dropdowns_expanded | new_states_revealed |
  |-----|----------|------------:|---------------:|--------------:|----------------:|--------------:|-----------------:|-------------------:|---------------------:|
  | https://app/dashboard | dashboard.snapshot.json | 14 | 12 | 0 | 5 | 1 | 1 | 2 | 3 |
  ```

  - **links_found**: count of `<a href>` discovered in this snapshot (from `dom.links` + `urlHarvest`).
  - **links_followed**: count of those links that are now ✅ explored or ⛔ skipped in `crawl-todo.md`.
  - **inputs_filled**: count of input/select fields actually filled (by credential-fanout or by BFS form actuation).
  - **buttons_clicked**: count of safe-list buttons clicked during BFS interaction (excludes destructive buttons).
  - **modals_opened**: count of modals/dialogs opened during BFS interaction.
  - **modals_submitted**: count of opened modals where the primary action was submitted (per `principles.md` §5b).
  - **dropdowns_expanded**: count of `<select>` / `[role=combobox]` opened and at least one option enumerated.
  - **new_states_revealed**: count of new UIG rows or crawl-todo entries this page contributed.

  Numbers, not prose. Prose annotations belong in `flow.md` discovery evidence, not here. Pages with all-zero columns (other than vacuously-empty pages with no interactables) fail `frontier-gate.js`.
- `qa/knowledgebase/nav-graph.md` — every outbound link from `dom.links`
- `qa/knowledgebase/crawl-todo.md` — **persistent URL coverage tracker**, append-only, never overwritten
- `qa/crawl-state.json` — BFS frontier state, auto-saved per page; resume is free. Helper invocations write their own state files (`qa/.auth/<role>.json`, `qa/sitemap-groups.json`) but do not own the frontier.

### W-2.6 — Credential gate protocol (all strategies)

NEVER bypass. For any auth gate:

**Default flow is Sign Up, not Sign In.**
Most apps show a combined auth page with Sign In / Sign Up tabs or a default Sign Up form. Always attempt Sign Up first using `.env.qa` credentials. Switch to Sign In only if:
- Sign Up explicitly fails with "email already registered" / "account exists" (or equivalent), OR
- The page lands directly on a Sign In-only form with no Sign Up option visible.

Procedure:
1. Check `.env.qa` for `QA_TEST_EMAIL` / `QA_TEST_PASSWORD` / `QA_LLM_API_KEY` / etc. (note: variable is `QA_LLM_API_KEY`, not `QA_API_KEY` — match `.env.example`).
2. If present — attempt **Sign Up** first. On success, save `storageState` to `qa/.auth/user.json`.
3. If Sign Up fails with "already registered" → switch to Sign In tab and submit the same credentials.
4. If both fail — stop and ask the user with evidence (URL, error text, snapshot path).
5. **Never click "Skip" / "Maybe later" / any bypass button.**
6. Log the gate encounter + outcome (which path succeeded) in `qa/decisions.md`.

Self-registration only with explicit user authorization. Generated creds go in `.env.qa` (gitignored) + `qa/decisions.md`.

### W-2.6.5 — App config gates (BYOK / billing / model picker)

After auth, before tracing dependent flows, scan the post-login DOM for **app-internal configuration gates**. These are NOT auth gates but feature blockers — e.g. "Add API key" CTAs, "Connect provider" buttons, "Add payment method" panels, model-picker empty states.

Detection signatures (text + role match against the dashboard snapshot):
- Buttons / CTAs containing: `add api key`, `add key`, `connect <provider>`, `add provider`, `byok`, `add payment`, `add card`, `connect billing`, `setup model`, `choose model`.
- Empty-state cards on dashboards with a single "Add here" / "Get started" affordance.

For each detected gate:

1. Map the gate to a `.env.qa` variable:
   | Gate | Variable |
   |---|---|
   | LLM provider / API key | `QA_LLM_API_KEY` (+ `QA_LLM_PROVIDER`, `QA_LLM_MODEL`) |
   | Stripe / payment | test card `4242 4242 4242 4242` (CVC 123, any future expiry) |
   | OAuth third-party (Google Drive, etc.) | manual via `playwright codegen --save-storage` |

2. If the variable is set in `.env.qa` → **drive the gate to completion** before tracing any feature that depends on it. Do not author "empty-state" scenarios as a substitute. Save any resulting state (e.g. configured-key flag) to `qa/decisions.md`.
3. If the variable is missing → single `AskUserQuestion` (batch all missing variables in one prompt). Options: (a) provide now, (b) skip dependent flows, (c) author empty-state scenarios only.
4. Log every gate encountered + how it was resolved in `qa/decisions.md`.

**Anti-pattern**: seeing "Add API key" in a snapshot, declaring "no key configured," and authoring scenarios for the empty state without checking `.env.qa` first. This silently strips coverage from every downstream flow.

### W-2.7 — Stall signals → fallback (mandatory verification)

**After every script exit, verify it ran meaningfully before accepting the result:**

```bash
# Count meaningful steps (exclude stall notes)
node -e "
const lines = require('fs').readFileSync('qa/progress.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const meaningful = lines.filter(l => !l.note || !l.note.includes('stall'));
console.log('Meaningful steps:', meaningful.length);
console.log('Unique URLs:', [...new Set(lines.map(l=>l.url).filter(Boolean))].length);
"
```

**If meaningful steps < 5 OR unique URLs explored < 3: the fallback is MANDATORY and IMMEDIATE — do not proceed to W-2.8.** Execute the declared fallback strategy now.

When the strategy's named stall signal triggers:
1. Stop current iteration cleanly.
2. Append to `qa/decisions.md`: "Switching from <X> to <Y> because <signal>."
3. Update `qa/scripts/explore.js` to dispatch to fallback's helper.
4. **Actually run the fallback** — write and execute the fallback script. A log entry alone is not a fallback.
5. Resume — session artefacts carry over. The flow never breaks.

### W-2.8 — Record results

At end of strategy execution:
- `ui-inventory.md` + `nav-graph.md` current
- `crawl-todo.md` — all visited pages must be `✅ explored`; any remaining `⬜ pending` = scope decision (skip or queue)
- `qa/state.md` checkpoint: strategy, pages visited, fallback triggered?, next action
- `qa/decisions.md` terminal entry: "<Strategy> complete: N pages, M stalls, fallback-triggered=<yes|no>."

### Runtime Script Evolution

`qa/scripts/` is Claude-owned. Every script traces back to a strategy file. Rules:

- Three-line header (Why / Strategy / Fallback) on every script.
- Updates require a matching `qa/decisions.md` entry: "Updated qa/scripts/<name>.js: <change> — because <observation>."
- Deletions require a matching entry.
- Login forms use `qa/scripts/login-engage.js` (skeleton: `skills/web/helpers/login-engage.md`). Direct fill+click is forbidden — it can't detect form-reset-silent failures.
- Every interaction calls `qa/scripts/outcome-classifier.js` (skeleton: `skills/web/helpers/outcome-classifier.md`) and branches on the labeled outcome — never on legacy `stateChanged`.

---

## Step W-2.9: Role & Flow Inventory Confirmation Gate

> No tracing begins until the user confirms roles and flow categories. Front-loads engagement so the agent never burns tokens on unapproved flows.

### 1. Synthesize roles

Read `ui-inventory.md` + `nav-graph.md`. Infer roles from: distinct post-auth route prefixes (`/admin/*`), visible role labels in nav, plan-tier badges, pages that 403 for the default role.

Write `qa/knowledgebase/roles.md`:

```markdown
| Role ID | Observed signal | Evidence | Credential slot |
|---|---|---|---|
| admin   | `/admin/*` + "Admin" badge | shot-03.png | QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD |
| member  | default post-login | shot-01.png | QA_TEST_EMAIL / QA_TEST_PASSWORD |
```

### 2. Synthesize flow categories

Group nav clusters into 5–8 categories. Write `qa/knowledgebase/flow-categories.md`:

```markdown
| Category | Pages | Roles needed |
|---|---|---|
| Auth | /login, /signup, /reset | anonymous → member/admin |
| Dashboard | /, /home | member, admin |
| Admin Panel | /admin/* | admin |
```

### 3. ONE batched `AskUserQuestion`

Roles + categories together. The user can confirm, edit, or add. Do not ask sequentially.

### 4. Per confirmed role, request credentials

For each role in order:
1. Look up `QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASSWORD` in `.env.qa`.
2. If present → confirm: "Use existing admin creds?"
3. If absent → `AskUserQuestion`: (a) provide now (append to `.env.qa`), (b) self-register if app supports it, (c) skip this role's flows.
4. After login via `qa/scripts/login-engage.js`, save `storageState` to `qa/.auth/<role>.json`. Add `QA_<ROLE>_STORAGE_STATE=qa/.auth/<role>.json` to `.env.qa`.

### 5. Then proceed to W-3

Each W-3 flow declares its `Role` in the Summary table. Traced flows pick the right `storageState`:

```javascript
browser.newContext({ storageState: process.env[`QA_${role.toUpperCase()}_STORAGE_STATE`] })
```

Never re-login per flow.

---

## Step W-3: Feature-Scoped Flow Creation

After BFS, organize discovered pages into **feature-scoped flows** — one flow per distinct feature area (3–7 steps each).

**Manifest-first tracing.** Before executing a flow's steps, write its plan to `qa/flows/F-NNN-<slug>/manifest.jsonl` — one line per step `{step, action, target, url, status:"pending"}`. Then drive every line to terminal status (see runtime.md §2). Resume: `grep -v '"status":"done"' manifest.jsonl` → first line.

### Identifying flows from the inventory

Group by what the crawl found, not assumed categories:
- Pages sharing a URL prefix → one feature area
- Pages reachable from the same nav item → one flow
- Pages behind the same auth gate → group together
- Pages with related functionality → one flow
- Standalone pages (legal, about, contact) → "static pages" flow

Don't assume every app has pricing, dashboard, blog. Derive boundaries from actual nav-graph.

### flow.md template (feature-scoped)

```markdown
# F-NNN: [Feature/Section Name]

## Summary
| Field | Value |
|---|---|
| **Flow ID** | F-NNN |
| **Application** | [AppName] |
| **Section** | [feature area from nav-graph] |
| **Pages** | [URLs covered] |
| **Auth Required** | Yes / No |
| **Priority** | P1 / P2 / P3 |
| **Status** | COMPLETE |

## Discovery Evidence

| Step | Page/Screen | Action | Snapshot | Observed (from DOM/ARIA) |
|------|-------------|--------|----------|--------------------------|
```

Snapshot column = `.snapshot.json` filename. Observed column = findings from `dom.headings`, `dom.buttons`, etc. — no PNG references.

### Bridge seed-crawl evidence

1. Read `qa/crawl-state.json` for the page manifest (URL → snapshot).
2. For each F-NNN, find matching snapshots by URL prefix or nav grouping.
3. Copy matching evidence rows into each `flow.md`.
4. Delete the seed-crawl directory: `rm -rf qa/flows/seed-crawl`.

Every snapshot ends up in exactly one F-NNN. Catch-all: `F-NNN-misc-pages`.

### Present to user

Flow table only — no freeform prose. Deep-exploration gate happens at the P1→P2 transition.

> "Discovered **[N] pages** across **[M] feature areas**:
>
> | Flow | Section | Pages | Auth |
> |------|---------|-------|------|
> | F-001 | … | [N] | [Yes/No] |
>
> Tracing all flows now. Will ask before scenario planning."

---

## Step W-3b: Context Reset After Each Flow

Follow runtime.md §4. **Web-specific**: close the browser context after each flow:

```javascript
await context.close();
```

Coverage check + report deferred to P1→P2 transition.

---

## Step W-6: Save Knowledge Base

Write/update `qa/knowledgebase/`:
- `ui-inventory.md` — page inventory enriched with visual observations
- `nav-graph.md` — every outbound link
- `personas.md` — derived from auth boundaries, plan tiers, feature sections
- `journey-inventory.md` — **append one row per flow as it is traced** (do not batch at end):

  ```markdown
  | Flow ID | Name | Auth Required | Status | Snapshot Count | Notes |
  |---------|------|---------------|--------|----------------|-------|
  | F-001   | Login & Registration | no | TRACED | 3 | sign-up default |
  ```

  Valid statuses: `PENDING` (identified, not yet traced) → `TRACED` (Phase 1 done) → `DONE` (Phase 3 test written).

- App quirks (SPA routes, redirect behavior, widget edge cases)

---

## Phase 1 → Phase 2 Transition

After Step W-6, do deferred housekeeping and run the deep-exploration gate before Phase 2.

### 1. Update `journey-inventory.md`

Batch-update all flows as TRACED or SKIPPED based on `qa/flows/`.

### 2. Snapshot fidelity + coverage gates

Three scripts. **All must exit 0** before the deep-exploration gate. Any failure means the agent cannot proceed to Phase 2 without backfilling the inventory, re-capturing degenerate snapshots, or finishing pending crawl rows. Treat these like CI checks — do not interpret prose, run the scripts.

```bash
# Fidelity — every snapshot has real values, no null hrefs, no blank captures
node scripts/audit-snapshots.js

# Coverage — every snapshot is in ui-inventory.md AND in some flow.md
node scripts/coverage-check.js

# Crawl gate — zero ⬜ pending, zero 🔄 in-progress, every ⛔ skipped has a reason
node scripts/frontier-gate.js
```

If `frontier-gate.js` fails: do NOT proceed. The gate fails when URLs are pending, when skipped URLs lack 2+ retry attempts logged in `decisions.md` (3-strike protocol), when any visited page has actuation coverage < 90% (principles.md §5b), when modal triggers were detected but never submitted, when total discovery is below the floor without justification, or when `QA_MAX_PAGES`/`QA_MAX_DEPTH` was hit without a documented decision. Resume the deep-exploration loop, fill the missing actuation, and re-run the gate. Pending and shallow-actuation are never terminal states.

If `audit-snapshots.js` fails: re-capture any degenerate page (use the inspector to see what actually got recorded — `node scripts/inspect-snapshot.js <slug>`).

If `coverage-check.js` fails: orphans on disk → add them to `ui-inventory.md` under the right flow; missing on disk → re-crawl those URLs.

These two scripts replace the inline grep — they catch the failures screenshots used to expose visually.

### 3. Autonomous deep-exploration — exhaust all pending URLs before Phase 2

**Do NOT ask the user whether to explore more.** Automatically continue until `crawl-todo.md` has zero `⬜ pending` URLs that are reachable (i.e., not in the skip list).

Algorithm:
1. Read `qa/knowledgebase/crawl-todo.md` — collect all `⬜ pending` rows.
2. For each pending URL:
   - Navigate and snapshot with `snapshotPage()`.
   - Register any newly discovered links via `update-crawl-todo.js --discover`.
   - Mark the page `✅ explored` via `update-crawl-todo.js --mark-explored`.
   - If the page requires auth not yet obtained → mark `⛔ skipped (auth-gated)` and continue.
   - If the page 404s or redirects back to a previously visited URL → mark `⛔ skipped (dead)` and continue.
3. Repeat until no `⬜ pending` rows remain.
4. Only THEN proceed to step 4 (report generation).

**When to ask the user (only these cases):**
- A page requires credentials that are not in `.env.qa` → ask once, batch all missing roles.
- A destructive action is the only way forward (e.g., delete-account gate) → ask for explicit permission.
- The session is explicitly stopped by the user.

Print a brief progress line after each page: `[crawl] ✅ /path — N pending remaining`.

### 4. Auto-derive `qa/app-quirks.yml`

Run once at the P1→P2 boundary, AFTER all snapshots and traces are written:

```bash
node scripts/derive-quirks.js
```

This populates `qa/app-quirks.yml` from the observed evidence:
- **Disambiguation**: from UIG `scope` assignments (no `.first()`/`.last()` needed in tests).
- **Toggle pairs**: from wiggle-pass observations of buttons whose `name` mutates after click.
- **Console allowlist**: errors firing on >50% of pages without user interaction = app-side noise.
- **SPA query drops**: detected when `goto('/x?p=1')` settles to a URL without `?p=1`.
- **Overlay registry**: every `[role=dialog]` / `aria-modal` / `fixed inset-0 z-[…]` overlay seen during BFS, plus its recorded dismiss trace.

The user MAY hand-edit `qa/app-quirks.yml` to override, but this is optional. Phase 3 reads it as the source of truth for selector disambiguation, console-error filtering, and overlay handling — replacing every per-app `*-patterns.md` document.

### 5. Generate report

```bash
node scripts/allure/generate-report.js --open
```

### 6. Heavy checkpoint

Write full `qa/state.md` (template in runtime.md §3):

```markdown
## Session State — Phase 1 Complete
**App**: [name] ([QA_APP_URL])
**Platform**: web
**Completed**: [ts]

### Coverage
- Pages discovered: [N]
- Flows traced: [M] — [F-001 … F-NNN]
- Deeper passes: [K]
- Auth-gated flows pending: [list]

### Active Position
Phase 1 complete. Proceeding to Phase 2.

### Resume Command
Re-invoke skill — detects HAS_WORKSPACE and resumes from Phase 2.
```

### 7. Continue to Phase 2

Automatic. If auth-gated flows need creds → ask user → continue.

---

→ Next: [phase2.md](phase2.md)
