---
name: native-qa
description: >
  Multi-platform QA skill (macOS, Web, Windows, iOS, Android). Selects platform → initializes workspace → discovers UI → generates scenarios → writes shippable tests → runs them. Web uses DOM/ARIA snapshots (no screenshots in Phase 1/2). macOS uses screenshots at every step. Never generates TCs before credentials are confirmed.
---

# Native App QA Skill — Root Router

Asks for the platform first, scaffolds a typed workspace, hands off to the platform skill for Steps 4+. Lazy-load by design: this file does Steps 0–3 only.

**Platforms**: macOS ✅ | Web (Playwright) ✅ | Windows 🔜 | iOS 🔜 | Android 🔜

> ⛔ **WEB DISCOVERY USES NO SCREENSHOTS.** Phase 1/2 use `snapshotPage()` (DOM/ARIA JSON). macOS/native use screenshots normally. Playwright takes screenshots only on test failure during Phase 4.

Cross-cutting runtime rules live in `skills/_shared/runtime.md` — engagement, checkpoints, context resets, navigation, token discipline, browser launch. Read once at session start; every phase cites it.

---

## DO THIS NOW — Platform Selection

> ⛔ **HARD GATE — Do NOT run any bash commands. Do NOT read workspace files. Do NOT check `qa/`. The only allowed action before this question is answered: read `skills/_registry/registry.json`.**

Read `skills/_registry/registry.json`. Build a numbered menu from registered skills, with real status. Output exactly:

> "Which platform would you like to test on?
>
> 1. macOS — production ✅
> 2. Web (Playwright) — beta ✅
> 3. Windows — stub 🔜
> 4. iOS — stub 🔜
> 5. Android — stub 🔜"

**STOP. Output nothing else until the user replies.**

---

## Step 0: Mode Detection + Resume

### 0.1 Resume check

```bash
[ -f "qa/state.md" ] && echo "EXISTS" || echo "NONE"
```

If `qa/state.md` exists, read it. Extract: app name, phase, next action, flows done/total, TCs written. Present:

> "Found a saved **[platform]** session: [table with App / Phase / Next action / Flows / TCs].
>
> 1) **Resume** — continue from: *[next action]*
> 2) **New session** — start fresh (overwrite at next checkpoint)"

- **Resume** → read full state, jump to saved next action. Do NOT re-init.
- **New** → clean up first:

  ```bash
  node -e "require('fs').rmSync('qa',{recursive:true,force:true,maxRetries:10,retryDelay:250})"
  ```

  Engagement protocol (`skills/_shared/runtime.md` §1): if `qa/` still exists after rm, do NOT exit. Surface via `AskUserQuestion`: (a) identify locking process, (b) rename `qa/` → `qa-old-<ts>/`, (c) halt with resume instructions.

### 0.2 Workspace mode

```bash
if [ ! -d "qa" ] || [ ! -f "qa/.qa-config.json" ]; then echo "INIT"
elif [ ! -d "qa/flows" ] && [ ! -d "qa/features" ] && [ ! -d "qa/test-cases/P1-critical" ]; then echo "CONFIGURED_NO_FLOWS"
else
  SPEC_COUNT=$(find qa/tests qa/journeys -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')
  MODULE_COUNT=$(find qa/flows -name "*.scenarios.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SPEC_COUNT" -gt 0 ] || [ "$MODULE_COUNT" -gt 0 ]; then echo "HAS_SPECS"
  elif [ ! -d "qa/flows" ] || [ "$(find qa/flows -name 'scenarios.md' 2>/dev/null | wc -l | tr -d ' ')" -eq 0 ]; then echo "EXPLORATION_COMPLETE"
  else echo "HAS_WORKSPACE"
  fi
fi
```

| Result | Action |
|---|---|
| `INIT` | → Step 1 |
| `CONFIGURED_NO_FLOWS` | → Step 2 |
| `EXPLORATION_COMPLETE` | → Load platform skill, jump to Phase 2 (`skills/<plat>/phases/phase2.md`). Announce "Phase 1 already complete — continuing to Phase 2." |
| `HAS_SPECS` | → **Run Mode** — ask: "Test suite found. (1) Run all journeys, (2) Run one journey by ID, (3) Run standalone flow specs, (4) Regenerate / update tests." Write `qa/run-state.md`, run `node qa/run.js [args]`. Skip exploration. |
| `HAS_WORKSPACE` | → Load platform skill `phases/update-mode.md`. Announce "Existing workspace — entering update mode." |

---

## Step 1: INIT — Initialize Workspace

### 1.1 Framework Selection

> "Welcome to native-qa! How would you like your test cases organized?
>
> 1. **Flow-based** *(recommended)* — `qa/flows/F-001-login/`, `F-002-settings/`, …
> 2. **Feature-based** — `qa/features/authentication/`, `dashboard/`, …
> 3. **Risk-based** — `qa/test-cases/P1-critical/`, `P2-high/`, …"

**STOP** until user replies. Default to flow-based if unclear. Map answer → `flow-based` | `feature-based` | `risk-based`.

### 1.2 Scaffold

```bash
node scripts/init-workspace.js --framework <chosen> --platform <chosen>
```

This creates `qa/` + all subdirectories + all READMEs + `qa/.qa-config.json` from `scripts/templates/readmes/`. Idempotent. On failure, surface via `AskUserQuestion` per engagement protocol.

**Why directories exist** (so the agent reads from them correctly):
- `qa/context/` — user populates manually before Step 3 (PRDs, Figma, screenshots)
- `qa/credentials/` — structure only; real secrets in `.env.qa` (gitignored)
- `qa/knowledgebase/` — auto-generated in Phase 1 (web: `aria-snapshots/`; macOS: `screenshots/`); plus `ui-inventory.md`, `nav-graph.md`, `personas.md`
- `qa/planning/`, `qa/guardrails/`, `qa/scope/` — short app-specific docs the platform skill writes during init
- `qa/evidence/`, `qa/runs/` — failure evidence and run logs

Tell user: `"✅ Workspace ready — [framework] / [platform]. Next — which application?"` → light checkpoint to `qa/state.md` → Step 2.

---

## Step 2: App Selection

### 2.1 Pre-read `.env.qa`

```bash
[ -f ".env.qa" ] && cat .env.qa || echo "NO_ENV_FILE"
```

Extract everything relevant. Primary keys per platform:

| Platform | Primary | Also extract |
|---|---|---|
| Web | `QA_APP_URL` | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD`, `QA_LLM_API_KEY`, `QA_LLM_PROVIDER`, `QA_ACCOUNT_TIER` |
| macOS / Windows / iOS / Android | `QA_APP_NAME` | same |

If primary key set → confirm, don't ask: *"Found in `.env.qa`: [table]. I'll test **[X]**. Correct? (yes / different app)"*. STOP for confirmation.

If not set → ask, tailored to platform ("What URL?" / "What app?"). Store the answer.

### 2.2 Memorize `.env.qa` for the session

Store the credential inventory in working memory for the rest of the session — Phase 1 credential gates auto-fill from this without re-reading the file.

→ Light checkpoint, then Step 3.

---

## Step 3: Prior Domain Knowledge

### 3.1 Auto-detect `qa/context/`

```bash
find qa/context -type f ! -name "README.md" 2>/dev/null
```

If files exist, read all of them now. Extract: named flows, features, navigation paths, edge cases, auth type, known bugs, priority areas. Announce findings, write skeleton to `qa/knowledgebase/ui-inventory.md`, **skip 3.2** and proceed to Step 3.5.

### 3.2 Ask the user (only if `qa/context/` is empty)

> ⛔ **HARD GATE — output the EXACT text below. Do NOT paraphrase. Replace only `[AppName]`.**

> "Step 3 — Prior Knowledge
>
> `qa/context/` is ready. Before I start exploring **[AppName]**, do you have any background?
>
> **1. Drop files into `qa/context/`** — Figma exports (PNG/JPG), PRDs, GitHub notes, markdown, screenshots — then say "ready"
> **2. Tell me in chat** — what the app does, key flows, what to test or skip, known edge cases
> **3. Discover yourself** — I'll explore from scratch
>
> Which? (1 / 2 / 3)"

**STOP** until user replies.

### 3.3 Route

- **Option 1** — wait for "ready", scan `qa/context/`, read every file (images via Read tool), extract fields, write skeleton `ui-inventory.md`.
- **Option 2** — parse user's message; ask one follow-up only if auth situation is unclear.
- **Option 3** — acknowledge and proceed.

### 3.4 Always supplement with visual discovery

If the picture from context is incomplete (no flows / no states / no nav clarity), tell the user and supplement in Phase 1.

### 3.5 Platform Fingerprint (write-once)

Read `skills/_shared/fingerprint-questions.md`. Answer using context already gathered + ONE quick probe (launch / load URL, single screenshot, Read it). Write `qa/platform-fingerprint.md`. **Never regenerate on resume.** If Q5 has no documented strategy, record `Strategy: default` / `Fallback: none — use platform skill default` and move on.

### 3.6 Decisions Log Bootstrap

Create `qa/decisions.md` with one-line header: `# Decisions Log — append-only audit trail`. Every later strategy choice / deviation / runtime-script update appends one dated entry. Format: see `skills/_shared/fallback-discipline.md`.

### 3.7 Preflight (delegated)

Run the platform skill's preflight (web → `phase1.md` Step W-1.5; macOS → built-in accessibility check). Preflight MUST NOT throw. Per missing item, `AskUserQuestion` with four options: (a) auto-install, (b) provide value now, (c) fix manually then "continue", (d) skip. Per-role credentials are deferred to the platform's role-confirmation gate.

---

## → Delegate to Platform Skill

After Step 3, load `skills/<platform>/SKILL.md` and follow its phase router (each platform's phases live in `skills/<platform>/phases/`):

```
skills/macos/SKILL.md   → macOS phases/phase1..4 + update-mode
skills/web/SKILL.md     → Web phases/phase1..4 + update-mode
skills/windows/SKILL.md → stub
skills/ios/SKILL.md     → stub
skills/android/SKILL.md → stub
```

| Phase | What happens |
|---|---|
| **1. Discovery** | App metadata → launch → explore → nav graph → personas → trace E2E journeys → flow.md |
| **2. Scenarios** | Credentials (if needed) → auth tracing → scenarios.md per flow |
| **3. Test Generation** | Web: three-layer specs (`F-NNN.scenarios.ts` + standalone wrappers + journey specs). macOS: TC-NNN markdown |
| **4. Execution** | Run tests → unified Allure report |
| **Update mode** | Re-discover / add flows / re-run / full refresh |
