---
name: native-qa-web
description: Autonomous QA skill for web applications using Playwright. Four phases — Discovery → Scenario Planning → Test Generation → Test Execution. Stops only for credentials or context limits. Reports at phase boundaries only.
platform: web
status: beta
version: 4.0.0
---

# Web QA Skill — Router

This file is the **router** for the web platform. Each phase has its own file. Load only what you need.

```
Phase 1: Discovery         → phases/phase1.md
Phase 2: Scenario Planning → phases/phase2.md
Phase 3: Test Generation   → phases/phase3.md
Phase 4: Test Execution    → phases/phase4.md
Update Mode (W-13)         → phases/update-mode.md
```

> ⛔ **WEB DISCOVERY USES NO SCREENSHOTS.** Phase 1/2 use `snapshotPage()` (DOM/ARIA JSON). Playwright takes screenshots only on test failure during Phase 4.

Cross-cutting rules — read once at session start, cited from every phase:
- `skills/_shared/runtime.md` — engagement, checkpoints, context resets, navigation, token discipline, browser launch
- `skills/_shared/fallback-discipline.md` — every strategy declares a fallback
- `skills/_shared/principles.md` — selectors, screenshots, runtime script evolution

---

## Phase Output Map — what each phase creates

**Phase 1 — Discovery** (exploration only, NO test code):
- `qa/knowledgebase/crawl-todo.md` — persistent URL TODO list (discovery + coverage tracking)
- `qa/knowledgebase/aria-snapshots/*.snapshot.json` — DOM/ARIA capture per page
- `qa/knowledgebase/ui-inventory.md`, `nav-graph.md`, `roles.md`, `personas.md`
- `qa/flows/F-NNN-<slug>/flow.md` — discovery evidence (steps, screenshots via DOM/ARIA, observed elements)
- `qa/flows/F-NNN-<slug>/manifest.jsonl` — trace plan

**Phase 2 — Scenario Planning** (scenarios only, NO test code):
- `qa/flows/F-NNN-<slug>/scenarios.md` — scenario matrix per flow (S-NNN-NN IDs, categories, expected outcomes)

**Phase 3 — Test Generation** (test code only):
- `qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts` — exported async scenario functions (reusable core)
- `qa/tests/F-NNN-<slug>.spec.ts` — thin standalone wrappers
- `qa/journeys/J-NNN-<role>.spec.ts` — sequential E2E journeys (shared session, `test.step()` chains)
- `qa/journey-todo/J-NNN-<role>.todo.md` — generation + runtime tracking

No `TC-NNN-*.md` files anywhere. No `.ts` files before Phase 3.

---

## Prerequisites

- Node.js 20+
- `npm install` in project root (`@playwright/test`, `dotenv`)
- `npx playwright install chromium`
- `.env.qa` at repo root — see `.env.example`

### BFS Crawl Configuration (`.env.qa`)

| Variable | Default | Purpose |
|---|---|---|
| `QA_PAGE_WAIT_MS` | `2000` | Min wait per page before snapshotting |
| `QA_MAX_PAGES` | `300` | BFS page cap (raised from 50 — silent ceiling caused shallow runs) |
| `QA_MAX_DEPTH` | `10` | Max click-depth from homepage (raised from 5) |
| `QA_NAV_TIMEOUT` | `15000` | `page.goto()` timeout (ms) |
| `QA_HEADLESS` | `true` | Set `false` to watch the browser |
| `QA_INTERACTION_DEPTH` | `full` | `full` enforces actuate-and-observe; `links-only` reverts to legacy (not recommended) |
| `QA_FRONTIER_ACTUATION_FLOOR` | `0.9` | Min ratio of actuated/detected interactables per page (frontier-gate) |
| `QA_FRONTIER_DISCOVERY_FLOOR` | `8` | Min total URLs discovered before Phase 1 may exit (override with justification) |

**Loud ceiling**: when `QA_MAX_PAGES` or `QA_MAX_DEPTH` is reached with URLs still in the queue, `scripts/frontier-gate.js` fails Phase 1. Either raise the limit and resume, or document the decision in `qa/decisions.md` using the phrase `"ceiling-hit accepted"`. Silent ceiling exits are no longer permitted — the gate enforces this.

---

## Templates (`skills/web/templates/`)

Real files — copy at runtime, no edits required (they read `.env.qa` dynamically):

| Template | Destination | When |
|---|---|---|
| `playwright.config.ts` | `qa/playwright.config.ts` | W-1 |
| `snapshot-page.js` | `qa/scripts/snapshot-page.js` | W-2.5 (once per session) |
| `wiggle-pass.js` | `qa/scripts/wiggle-pass.js` | W-2.5 (once per session) — precondition discovery |
| `trace-recorder.js` | `qa/scripts/trace-recorder.js` | W-2.5 (once per session) — emits per-flow `trace.jsonl` |
| `heal.js` | `qa/scripts/heal.js` | After W-10 — self-heal locator cascade for runtime |
| `auth.setup.ts` | `qa/auth.setup.ts` | W-7 (selectors need adapting) |
| `run.js` | `qa/run.js` | After W-10 |
| `package.json` | `qa/package.json` | After W-10 |
| `flow.md` | `qa/flows/F-NNN-*/flow.md` | W-3 |
| `scenarios.md` | `qa/flows/F-NNN-*/scenarios.md` | W-9 |

---

## Key Rules (every phase)

### Correctness
1. Never hardcode URLs — always `process.env.QA_APP_URL` or relative `'/'`.
2. Never hardcode credentials — `process.env.QA_TEST_EMAIL` / `_PASSWORD`.
3. Never use `networkidle` — use `domcontentloaded` + `QA_PAGE_WAIT_MS`.
4. Always use `snapshotPage()` for discovery — never raw `page.screenshot()` in Phase 1/2.
5. Snapshot BEFORE filling any form (clean empty state).
5a. Never guess SPA sub-routes — load the auth entry point and navigate via UI clicks. If `page.goto()` is unavoidable, check `page.url()` after and skip snapshot if it 404'd.
6. Verify every navigation — name snapshots by ACTUAL URL slug, not intended.
7. Don't write journey specs until user confirms `.env.qa` populated.
8. Relative URLs only in test files.
9. Scope nav selectors to `page.locator('nav, header').first()` — avoid footer duplicates.
10. Never click destructive buttons during BFS (use the safe whitelist in `phases/phase1.md` W-2.5).
11. No duplicate test code — scenario logic lives only in `F-NNN.scenarios.ts`. Standalone + journeys import and call.

### Performance
12. `QA_PAGE_WAIT_MS` (default 2000ms) after every navigation.
13. `QA_MAX_PAGES` / `QA_MAX_DEPTH` prevent infinite crawl.
14. `qa/crawl-state.json` written after every page — BFS survives resets.
15. Content fingerprinting catches duplicate pages at different URLs.
16. Reuse browser, fresh context per flow, `context.close()` after each.
17. Lightweight snapshot coverage check only at phase boundaries (see `phases/phase1.md` P1→P2 transition).
18. **Update the crawl tracker after every page** — two calls per tick:
    ```bash
    node scripts/update-crawl-todo.js --discover "$NEW_LINKS"
    node scripts/update-crawl-todo.js --mark-explored "$CURRENT_URL"
    ```
    Writes/updates `qa/knowledgebase/crawl-todo.md` — a persistent URL table that accumulates across the whole session. Status: `⬜ pending → 🔄 in-progress → ✅ explored | ⛔ skipped`. This is the anti-hallucination guard: never claim a page was explored unless it is ✅ in this table.

### Audit tooling (any time, especially at P1→P2)
- `node scripts/update-crawl-todo.js --status` — print pending/explored/skipped counts at a glance
- `node scripts/audit-snapshots.js` — fidelity gate (null hrefs, blank captures, missing ARIA)
- `node scripts/coverage-check.js` — every snapshot is in inventory AND in some flow.md
- `node scripts/inspect-snapshot.js <slug>` — render any snapshot as readable text

---

## STOP / PAUSE / SAVE STATE

Follow runtime.md §4 exactly. No web-specific differences.
