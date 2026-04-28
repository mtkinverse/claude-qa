# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What This Project Is

**native-qa** is a multi-platform autonomous QA skill for Claude Code. It tests any native or web application by:

1. Asking which platform to test (macOS, Web, Windows, iOS, Android)
2. Initializing a typed QA workspace (flow-based / feature-based / risk-based)
3. Reading prior knowledge from `qa/context/` or discovering the app via DOM/ARIA snapshots (web) or screenshots (macOS)
4. **Phase 1** — Seed crawl → DOM/ARIA snapshots (web) / screenshots (macOS) → nav graph → personas → E2E journeys → `flow.md` per journey → state checkpoints
5. **Phase 2** — After credentials provided, trace auth-gated flows → generate `scenarios.md` per flow
6. **Phase 3** — Write shippable journey specs to `qa/journeys/J-NNN-<role>.spec.ts` (single source of truth — no TC markdown files, no separate specs/ directory)
7. **Phase 4** — Run `qa/journeys/` → pass/fail report

Context is reset after each journey (DOM snapshots and accumulated tool output fill context). A state file `qa/state.md` persists all knowledge across resets.

**Platform support**:
- macOS ✅ production — AppleScript + screencapture + Accessibility API
- Web ✅ beta — Playwright + Chromium
- Windows 🔜 stub — WinAppDriver + UIA3
- iOS 🔜 stub — XCUITest + xcrun simctl
- Android 🔜 stub — UIAutomator2 + ADB
- Browser Extension 🔜 planned

---

## Architecture

### Skill Loading

Claude Code loads skills from committed SKILL.md files at session start. **Changes to SKILL.md take effect only after committing and starting a new session.** Staged changes are not picked up by the skill system.

### Skill Structure

```
SKILL.md                          ← Root orchestrator (platform-agnostic)
                                    Platform selection (Step 0)
                                    Workspace init (Steps 1–3)
                                    Platform fingerprint (Step 3.5)
                                    Decisions-log bootstrap (Step 3.6)
                                    Delegates Steps 4+ to platform skill

skills/
├── _shared/                      ← Cross-platform base layer
│   ├── principles.md             ← How Claude thinks (screenshot protocol,
│   │                               selector hierarchy, session limits,
│   │                               runtime script evolution)
│   ├── fingerprint-questions.md  ← 5 questions → qa/platform-fingerprint.md
│   └── fallback-discipline.md    ← Non-negotiable fallback rule
├── _registry/registry.json       ← Registered platform skills
├── macos/SKILL.md                ← macOS Steps 4–11 (production)
├── web/
│   ├── SKILL.md                  ← Web Steps W-1–W-12 (beta)
│   ├── strategies/               ← Exploration strategy menu (examples,
│   │   ├── README.md             ← not mandates — Claude picks per fingerprint)
│   │   ├── bfs.md                ← Default for dashboard/multi-page
│   │   ├── targeted-trace.md     ← Onboarding / wizard flows
│   │   └── sitemap-spot-check.md ← Content / CMS / docs
│   ├── templates/                ← flow.md, scenarios.md, test-case.md
│   └── references/               ← Playwright + selector patterns
├── ios/SKILL.md                  ← Stub
├── android/SKILL.md              ← Stub
├── windows/SKILL.md              ← Stub
└── extension/SKILL.md            ← Planned
```

Root `SKILL.md` always asks for platform FIRST — before any bash commands or workspace checks. This is enforced by a `## DO THIS NOW` block at the top of the file.

After platform selection, the root skill handles Steps 0–3 (mode detection, workspace init, app selection, prior knowledge), then **Step 3.5** (platform fingerprint → `qa/platform-fingerprint.md`) and **Step 3.6** (decisions log bootstrap → `qa/decisions.md`), then delegates all automation to the selected `skills/[platform]/SKILL.md`.

### Fingerprint → Strategy → Fallback pattern

Every run answers 5 questions about the app (`skills/_shared/fingerprint-questions.md`): app category, auth model, surface complexity, audience, chosen exploration strategy + rationale. The fingerprint file is **write-once** — future resumes read it without regenerating. Platform skills use it to pick from a menu of strategies (e.g. `skills/web/strategies/`) and log the choice + declared fallback in `qa/decisions.md`. If the chosen strategy stalls, the declared fallback kicks in — the flow never breaks.

### Platform Sub-Skills

Each platform SKILL.md is self-contained — automation code is inlined as instructions. The web skill depends on two committed utility scripts (`scripts/qa-screenshot.js` for atomic screenshot registration, `scripts/allure/generate-report.js` for standalone HTML report generation) that contain complex reusable logic. Platform skills receive context from the root skill via the workspace config and state file.

### Preflight → Role gate → Engagement protocol

After the fingerprint, root **Step 3.7 Preflight** (delegated to platform; web is **W-1.5**) verifies toolchain + env + config without throwing. Each missing item becomes an `AskUserQuestion` with four options (auto-install / provide value / fix manually / skip).

After exploration, web **Step W-2.9 Role & Flow Inventory Confirmation Gate** synthesizes roles + flow categories from the nav graph, presents them in one batched `AskUserQuestion`, and collects per-role credentials (`QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASSWORD`). Each role's session is cached as `storageState` at `qa/.auth/<role>.json` and reused per-flow.

**Engagement protocol** (`skills/_shared/engagement-protocol.md`): no runtime script may `throw` or `process.exit(1)` on a blocker — they write `qa/pending-question.md`, exit cleanly, and the agent re-engages the user.

### Outcome classifier + Login engagement

Two helpers (specs in `skills/web/helpers/`, runtime copies in `qa/scripts/`) replace the legacy heuristics:

- **outcome-classifier** — returns labeled outcomes (`navigated`, `dom-updated`, `error-surfaced`, `auth-rejected-server`, `form-reset-silent`, `auth-success`, `modal-opened`, `network-timeout`, `no-change`) instead of a `stateChanged` boolean. Only `no-change` counts as a stall.
- **login-engage** — network-first login: arms `page.waitForResponse` for the auth POST BEFORE clicking submit, captures status + body + cookies, distinguishes silent form-reset from server rejection (the HomaCare failure mode), engages the user with concrete evidence rather than reporting "blocker".

**Headless toggle**: every Chromium launch uses `chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' })`. Set `QA_HEADLESS=false` in `.env.qa` to watch the browser.

**Token discipline**: gated screenshot Reads — only inline-Read on `error-surfaced` / `auth-rejected-server` / `form-reset-silent` / `modal-opened` / `network-timeout` / terminal labels, plus ≤ 3 representative shots per flow boundary. `qa/classifier-log.jsonl` (≤ 120 bytes per entry) replaces re-parsing flow.md tables on resume. `storageState` per role prevents re-login per flow.

---

## How Exploration Works

Exploration scripts are **inlined in each platform's SKILL.md** — not standalone repo files. The agent writes and runs them at runtime, adapting to each app dynamically.

### macOS
The explore script is inlined in `skills/macos/SKILL.md` (Step 5). At runtime the agent writes it to `qa/scripts/explore.py` and runs it. No pip dependencies — uses stdlib only (`subprocess`, `json`, `argparse`, `plistlib`).

### Web
Playwright is the web tool. **Which exploration strategy** runs is picked per-app based on the fingerprint — see `skills/web/strategies/` for the menu (bfs, targeted-trace, sitemap-spot-check). The chosen strategy's code skeleton is copied into `qa/scripts/<strategy>.js` at runtime, adapted to the observed app, and dispatched through `qa/scripts/explore.js`. Every script carries a three-line header (Why / Strategy / Fallback); every update requires a matching `qa/decisions.md` entry. The agent calls `snapshotPage()` after each navigation to get a DOM/ARIA snapshot and decides the next action from the structured JSON — no image reading.

---

## Prerequisites

### macOS Skill
- macOS 12 Monterey or later
- Python 3.9+
- **Accessibility permission**: System Settings → Privacy & Security → Accessibility → enable Terminal

### Web Skill
- Node.js 20+
- `npm install` (installs `@playwright/test`, `dotenv`, and all dependencies)
- `npx playwright install chromium`
- `.env.qa` at repo root with `QA_APP_URL` set

---

## Skill Workflow (SKILL.md)

The skill detects its mode after platform selection:

| Mode | Trigger | Action |
|------|---------|--------|
| **INIT** | No `qa/` or no `qa/.qa-config.json` | Full init: framework → scaffold → app → discovery → flows → scenarios → TCs |
| **CONFIGURED_NO_FLOWS** | Config exists, no flows yet | Start from app selection |
| **EXPLORATION_COMPLETE** | Flows exist, TC count = 0 | Phase 1 done — awaiting credentials for Phase 2 |
| **HAS_WORKSPACE** | TC files present | Update mode |

**Phase 1 core loop** (Steps 4–7 in each platform skill):
1. Read prior knowledge from `qa/context/` (if any files exist)
2. Launch app / seed crawl all reachable pages
3. Screenshot → **Read with Read tool** → analyze visually
4. **Build navigation graph** (pages → CTAs → pages, with auth gates)
5. **Discover personas** from auth boundaries, plan tiers, feature sections
6. **Derive E2E journeys** (persona + goal + path through the app = one flow)
7. Present journey inventory to user for confirmation
8. Trace each journey end-to-end with `snapshotPage()` after every action (web: DOM/ARIA JSON; macOS: screenshot)
9. Write `flow.md` with 5-column discovery evidence table (Step | Page/Screen | Action | Screenshot | Observed)
10. Save checkpoint to `qa/state.md` → context reset
11. **Screenshot coverage gate** — every screenshot on disk must be referenced in a flow.md
12. **Generate report** (`npm run qa:report:open`) — one unified report with Product name, opens in browser

**Phase 2 core loop** (Steps 8–9):
1. Read auth-gate DOM/ARIA snapshots from Phase 1 to identify credential fields and login flow
2. Ask user how to provide credentials (check `.env.qa` / provide in chat / self-register)
3. Trace auth-gated flows with DOM/ARIA snapshots
4. Generate all scenarios per flow
5. Write journey specs to `qa/journeys/J-NNN-<role>.spec.ts` — one per role, all scenarios as `test.describe` blocks
6. **Generate report** (`npm run qa:report:open`) — same unified report, now includes all 4 phases

---

## Output Structure

### Flow-based (default)

```
qa/
├── .qa-config.json              ← Workspace config (platform, framework, app, counts)
├── state.md                     ← Session checkpoint — one global state file
├── run.js                       ← Cross-platform runner (node qa/run.js)
├── package.json                 ← Self-contained deps for qa/ (generated in Phase 3)
├── playwright.config.ts         ← Points testDir at qa/journeys/
├── planning/platforms.md
├── guardrails/do-and-dont.md
├── credentials/access.md
├── scope/contract.md
├── context/                     ← User places prior knowledge here before init
│   ├── README.md
│   ├── feature-specs/
│   └── figma-screens/
├── knowledgebase/
│   ├── ui-inventory.md          ← Page inventory from seed crawl
│   ├── nav-graph.md             ← Navigation graph (page → CTA → page)
│   ├── personas.md              ← Discovered user personas
│   ├── journey-inventory.md     ← All E2E journeys with coverage tracking
│   └── aria-snapshots/          ← DOM/ARIA snapshot JSON per visited page (web; gitignored)
├── journeys/                    ← SHIPPABLE TEST SUITE — single source of truth
│   ├── J-000-anonymous.spec.ts  ← All unauthenticated scenarios
│   ├── J-001-member.spec.ts     ← All member-role scenarios (test.describe per flow)
│   └── J-NNN-<role>.spec.ts
└── flows/
    └── F-NNN-[flow-slug]/
        ├── flow.md              ← Journey map + DOM/ARIA discovery evidence table
        └── scenarios.md         ← All test scenarios for this flow (documentation only)
```

### Feature-based

`qa/flows/` → `qa/features/[feature-name]/`

### Risk-based

`qa/flows/` → `qa/test-cases/P1-critical/`, `P2-high/`, `P3-medium/`, `P4-low/`

---

## Session State

Three session artefacts carry context across resets. All three are cheap to re-read — none are regenerated:

| File | Lifecycle | Purpose |
|------|-----------|---------|
| `qa/platform-fingerprint.md` | **Write-once** (Step 3.5) | 5-question app classification + chosen strategy + fallback. Never rewritten. |
| `qa/decisions.md` | **Append-only** | Audit trail: strategy choices, deviations, runtime script updates, fallback triggers. On resume, tail last N entries. |
| `qa/state.md` | **Updated per checkpoint** | App under test, journeys done/pending, coverage %, resume command. One global file across all platforms. Per-flow checkpoints shrink to a 6-line `## Active Position` pointer block; heavy template only at phase boundaries. |
| `qa/progress.jsonl` | **Append-only step ledger** | One line per step event (≤150 bytes) — `{ts,flow,step,action,url,outcome}`. Resume reads `tail -n 30` only; never full-read. Committed (audit trail). |
| `qa/flows/F-NNN-*/manifest.jsonl` | **Per-flow planned-step checklist** | One line per planned step with mutable `status` (`pending` / `done` / `skipped(reason)` / `blocked(reason)`). The agent drives every line to terminal status before advancing — see `skills/_shared/engagement-protocol.md` → *End-to-End Completion is Mandatory*. Resume: `grep -v '"status":"done"'` picks the next step. |
| `qa/run-state.md` | **Run-time todos** | One row per journey (`⬜ pending` → `⏳ running` → `✅ done` / `❌ failed`). Written before the run, updated after each journey. Never rewritten in full — only the status cell changes. On re-trigger, agent skips `✅` rows and resumes from the first non-done row. |
| `qa/journeys/J-NNN-*.spec.ts` | Generated in Phase 3 (W-10) | One journey per role — all scenarios organized as `test.describe` blocks per flow. **Single source of truth** — no separate specs/ or TC-*.md files. Shippable as-is. |
| `qa/run.js` | Generated in Phase 3 (W-10) | Cross-platform Node.js runner (Mac / Linux / Windows). Runs `qa/journeys/`. No shell scripts. |
| `qa/package.json` | Generated in Phase 3 (W-10) | Self-contained deps (`@playwright/test`, `dotenv`); makes `qa/` independently runnable after `npm install`. |

Strategy-specific resume artefacts (e.g. `qa/crawl-state.json` for BFS, `qa/trace-state.json` for targeted-trace) are owned by the platform skill and auto-saved after every page so mid-strategy resume is free.

`qa/scripts/` is Claude-owned. Every script there traces to a strategy file; every update requires a `qa/decisions.md` entry.

---

## Key Reference Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Root orchestrator — platform selection, workspace init, delegation |
| `skills/macos/SKILL.md` | Complete macOS runbook (Steps 4–11) — self-contained |
| `skills/web/SKILL.md` | Complete web runbook (Steps W-1–W-12) — self-contained with inline Playwright config and spec extraction |
| `skills/_registry/registry.json` | Platform skill registry (read by SKILL.md Step 0) |
| `skills/macos/SKILL.md` (Step 5, inlined) | AppleScript UI enumeration — written to `qa/scripts/explore.py` at runtime |
| `skills/macos/templates/flow.md` | Template for every `flow.md` (macOS) |
| `skills/web/templates/flow.md` | Template for every `flow.md` (web) — includes 5-col evidence table for E2E journeys |
| `skills/web/templates/scenarios.md` | Template for every `scenarios.md` |
| `skills/web/templates/scenarios.md` (journey section) | Schema for `test.describe` blocks written into journey specs |
| `skills/macos/references/macos-automation.md` | AppleScript patterns, window/menu enumeration |
| `skills/macos/references/test-patterns.md` | Scenario patterns by UI element type and app category |
| `skills/web/references/playwright-patterns.md` | Playwright patterns for web TCs |
| `skills/web/references/selector-strategies.md` | Selector strategies for SPAs |
| `scripts/qa-screenshot.js` | macOS/native: atomic screenshot + flow.md registration. Web platform no longer uses this for discovery. |
| `scripts/allure/generate-report.js` | Standalone HTML report — reads ALL data (flows, scenarios, TCs) and produces a self-contained session-based report at `qa/reports/<app-slug>-<timestamp>.html` with embedded screenshots. No external dependencies (no Java, no allure-commandline). Works when opened directly via `file://`. Use `--open` to auto-open in browser. Use `--out <path>` to override the output location. |
| `.env.example` | Template for `.env.qa` — all supported env vars |

---

## Manually Testing Changes

### macOS skill
Run the QA skill on any installed macOS app. The explore script is generated at runtime:
```bash
# In Claude Code, say: "Run QA on TextEdit"
# The skill writes qa/scripts/explore.py and runs it automatically
# After discovery, check output:
cat qa/knowledgebase/ui-inventory.md
ls qa/knowledgebase/screenshots/
```

### Web skill
```bash
cp .env.example .env.qa
# Set QA_APP_URL in .env.qa
# In Claude Code, say: "Run QA on [your web app]"
# The skill runs inline Playwright to explore the app dynamically
```

### Full skill verification checklist

- `qa/.qa-config.json` exists with correct `framework` and `platform` values
- `qa/state.md` exists after first checkpoint with journey coverage %
- `qa/crawl-state.json` exists during/after BFS (web skill) with visited URLs and queue state
- **Web**: `qa/knowledgebase/aria-snapshots/` contains at least 1 `.snapshot.json` per visited page — no PNGs
- **macOS**: `qa/knowledgebase/screenshots/` contains at least 1 screenshot per journey step
- `qa/knowledgebase/nav-graph.md` exists with navigation graph
- `qa/knowledgebase/personas.md` exists with discovered personas
- `qa/knowledgebase/journey-inventory.md` exists with journey count and coverage tracking
- `qa/flows/` has flow directories — one per feature area
- Each flow directory has `flow.md` and `scenarios.md` (no `test-cases/` subdirectory for web)
- `flow.md` includes a Discovery Evidence table with snapshot file references (web) or screenshot refs (macOS)
- Each `scenarios.md` has at least 5 scenarios covering multiple categories
- **Web**: `qa/journeys/J-NNN-<role>.spec.ts` exists — one per role, all scenarios as `test.describe` blocks. **No TC-NNN-*.md files, no specs/ directory.**
- `qa/journeys/` files pass the Quality Contract (no placeholders, no bare waitForTimeout, semantic locators)
- No credentials appear in any tracked file
- Session report (`qa/reports/<app-slug>-<timestamp>.html`) generated at **phase boundaries only** (Phase 1→2, 2→3, 3→4, final) or when user explicitly requests — NOT on every stop/checkpoint.

---

## Adding Platform Support

To implement a stub platform:
1. Write automation scripts in `skills/<platform>/` (explore, interact, screenshot)
2. Update `skills/<platform>/SKILL.md` status from `stub` to `beta`/`production`
3. Add or update the entry in `skills/_registry/registry.json`
4. Add platform-specific patterns to `skills/<platform>/references/test-patterns.md`
5. Update README.md platform table
6. Commit — the skill system reads from committed files only

---

## Environment Variables

All test credentials live in `.env.qa` (gitignored) at the consuming repo root. See `.env.example` for all supported keys. Key ones:

```env
QA_APP_URL=                   # web: full base URL with trailing slash
QA_APP_NAME=                  # macOS/Windows: app name
QA_TEST_EMAIL=
QA_TEST_PASSWORD=
QA_ACCOUNT_TIER=free
QA_SANDBOX_MODE=true
QA_LLM_PROVIDER=claude
QA_LLM_API_KEY=
QA_PAGE_WAIT_MS=2000          # web: minimum wait (ms) per page before screenshot
QA_MAX_PAGES=50               # web: BFS crawl page limit
QA_MAX_DEPTH=5                # web: BFS crawl depth limit
```

---

## Gitignore Entries

Add to the consuming repo's `.gitignore`:

```gitignore
.env.qa
qa/credentials/.env*
qa/evidence/
qa/knowledgebase/screenshots/
qa/knowledgebase/aria-snapshots/
qa/crawl-state.json
qa/.auth/
qa/reports/
qa/node_modules/
playwright-report/
allure-results/
allure-report/
```

Commit `qa/` itself — it is the team's living QA documentation. **Commit `qa/journeys/`** — it is the shippable test suite.
Never commit `qa/knowledgebase/aria-snapshots/` (large JSON files), `qa/knowledgebase/screenshots/` (large binaries), `qa/.auth/` (session tokens), `qa/crawl-state.json` (ephemeral BFS state), or anything under `qa/credentials/` with real values.
