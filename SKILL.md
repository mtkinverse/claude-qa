---
name: native-qa
description: >
  Generic QA skill for Claude Code covering any platform (macOS, iOS, Android, Windows, web). Two-phase workflow: Phase 1 = pure exploration — agent selects platform, initializes workspace, launches the app, traces every happy flow step-by-step with screenshots at every single action, maps flows, saves all knowledge to qa/knowledgebase/. Phase 1 ends with a credentials gate — no test cases are generated yet. Phase 2 = full coverage — after user provides credentials in .env.qa, agent traces auth-gated flows, generates every possible scenario per flow (happy + negative + edge + security + a11y), and writes all TC files. ALWAYS asks platform first. ALWAYS screenshots every step in Phase 1. NEVER generates TCs before credentials are confirmed.
---

# Native App QA Skill

An autonomous QA engineer for **any native or web application**. It asks you to select a platform, initializes a typed workspace, launches your app, takes screenshots for visual analysis, discovers every UI flow, and generates comprehensive test cases — organized by flow, feature, or risk priority.

**Supported platforms**: macOS ✅ | Web (Playwright) ✅ | Windows 🔜 | iOS 🔜 | Android 🔜

---

## DO THIS NOW — Platform Selection

> ⛔ **HARD GATE — Do NOT run any bash commands. Do NOT read any workspace files. Do NOT check `qa/`. Do NOT show a welcome message. Do NOT proceed past this section until the user has answered the platform question below. The only allowed action before this question is answered: read `skills/_registry/registry.json`.**

Read `skills/_registry/registry.json`. Build a numbered menu from all registered skills. Then output exactly this (substituting real status from the registry):

> "Which platform would you like to test on?
>
> 1. macOS — production ✅
> 2. Web (Playwright) — beta ✅
> 3. Windows — stub 🔜
> 4. iOS — stub 🔜
> 5. Android — stub 🔜"

**STOP. Output nothing else. Do not continue to Step 0 until the user replies with their platform choice.**

The selected platform determines: state file name, workspace mode detection, welcome message wording, and which platform SKILL.md to load for Steps 4+. Nothing downstream works correctly without it.

---

## Step 0: Mode Detection and Session Resume

### 0.1b Session Resume Check

Immediately after platform selection, check if a saved session exists for that platform:

```bash
STATE_FILE="qa/state.md"
[ -f "$STATE_FILE" ] && echo "EXISTS" || echo "NONE"
```

#### If state file EXISTS — read it and ask the user

Read `qa/state.md`. Extract:
- App name (from the App table)
- Phase (e.g. `EXPLORATION_COMPLETE`, `PHASE_2_IN_PROGRESS`)
- Next action (from Resume Instructions → "Next action" line)
- Counts: flows done, TCs written

Present to the user:

> "Found a saved **[platform]** session:
>
> | Field | Value |
> |-------|-------|
> | App | [AppName] |
> | Phase | [phase] |
> | Next action | [next action] |
> | Flows traced | [N done] / [N total] |
> | TCs written | [N] |
>
> **1) Resume** — continue from: *[next action]*
> **2) New session** — start fresh (saved state will be overwritten at next checkpoint)"

Wait for the user's choice:

- **"1"** or **"resume"** → Read the full state file for context. Jump directly to the saved next action. Do NOT re-run workspace init, app selection, or discovery. Announce: *"Resuming [AppName] on [platform] — [next action]"* and continue.
- **"2"** or **"new"** → **Clean up the old workspace first**, then proceed to Step 0.2 as INIT:

  ```bash
  # Cross-platform recursive remove with retries for OS-level file locks
  node -e "require('fs').rmSync('qa',{recursive:true,force:true,maxRetries:10,retryDelay:250})"

  # Verify — if anything remains, a process still has a file open
  if [ -d "qa" ]; then
    echo "WARN: qa/ still exists after cleanup."
    ls -la qa/ 2>&1 | head
  fi
  echo "Old workspace removed (or flagged for engagement). Starting fresh."
  ```

  This ensures Step 0.2 correctly detects INIT mode. **Engagement protocol** (`skills/_shared/engagement-protocol.md`): if `qa/` still exists after the rm, do NOT `exit 1`. Surface to the user via AskUserQuestion with three options: (a) identify the locking process and retry, (b) rename `qa/` to `qa-old-<timestamp>/` and continue, (c) halt with resume instructions. Never terminate silently.

#### If state file does NOT exist — proceed silently

No prompt. Go directly to Step 0.2.

### 0.2 Workspace Mode

```bash
if [ ! -d "qa" ] || [ ! -f "qa/.qa-config.json" ]; then
  echo "INIT"
elif [ ! -d "qa/flows" ] && [ ! -d "qa/features" ] && [ ! -d "qa/test-cases/P1-critical" ]; then
  echo "CONFIGURED_NO_FLOWS"
else
  # HAS_SPECS: journey specs exist — prompt run options first
  SPEC_COUNT=$(find qa/journeys -name "*.spec.ts" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SPEC_COUNT" -gt 0 ]; then
    echo "HAS_SPECS"
  else
    TC_COUNT=$(find qa -name "TC-*.md" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$TC_COUNT" -eq 0 ]; then
      echo "EXPLORATION_COMPLETE"
    else
      echo "HAS_WORKSPACE"
    fi
  fi
fi
```

| Result | Action |
|--------|--------|
| `INIT` | → **Step 1: INIT MODE** |
| `CONFIGURED_NO_FLOWS` | → **Step 2: App Selection** (workspace ready, need discovery) |
| `EXPLORATION_COMPLETE` | → Load the platform SKILL.md and jump directly to its **Phase 2** entry point (Web → Step W-7, macOS → Step 8). Announce: *"Phase 1 already complete — continuing to Phase 2."* |
| `HAS_SPECS` | → **Run Mode** — journey specs detected. Ask: *"Test suites found. (1) Run all journeys end-to-end (2) Run one journey by ID (3) Run specific TCs by ID (4) Regenerate / update tests"*. Write `qa/run-state.md`, then execute `node qa/run.js [args]`. Skip exploration entirely. |
| `HAS_WORKSPACE` | → Load the platform SKILL.md and jump to its **Update Mode** section (Web → Step W-13, macOS → Step 12). Announce: *"Existing workspace found — entering update mode."* |

---

## Context Window Management

**After every completed flow, reset the context window. This is not optional.**

Reading screenshots, flow.md files, and accumulated tool output fills the context fast. By flow 3-4 the context is full and the session crashes mid-run. The fix: treat each flow as an isolated unit — complete it, save everything to `qa/state.md`, start fresh.

### STOP / PAUSE / SAVE STATE — Immediate Handler

**When the user says "stop", "pause", "save state", or any equivalent:**

Do NOT just acknowledge. The FIRST and ONLY action is to write the checkpoint. No other response until the file is written.

1. **Immediately write `qa/state.md`** using the checkpoint template below — capture everything known at this exact moment: completed flows, pending flows, what was discovered, what was NOT yet written to files (note it as in-progress)
2. **Then tell the user**:

> "✅ Checkpoint saved to `qa/state.md`
>
> | Saved | Value |
> |-------|-------|
> | Flows completed | [N] — [names] |
> | Flows pending | [N] — [names] |
> | Screenshots taken | [N] |
> | TCs written | [N] |
> | Stopped at | [exact step — e.g. 'Mid F-003 trace, step 4 of 7'] |
>
> Type `/clear` now to reset context, then paste:
> `Read qa/state.md and continue QA for [AppName]`
>
> **To generate a report**: `npm run qa:report:open`"

**If work was in-progress mid-flow** (e.g. stopped while tracing F-003 step 4): note the incomplete flow explicitly in the state file under "In Progress" so the resume picks it up from the right point — not from the beginning of that flow.

**Do NOT generate the QA report on every stop/reset.** Report generation is expensive and consumes context. Only generate reports at phase boundaries (Phase 1 complete, Phase 2 complete, all phases done) or when the user explicitly asks for a report.

---

### Reset Triggers

Reset the context window after:

| Trigger | Action |
|---------|--------|
| User says "stop", "pause", or "save state" | → **STOP handler above — write state file only** |
| Each flow fully traced in Phase 1 (flow.md written) | → Append to state file, tell user resume command |
| Each flow's TCs fully written in Phase 2 | → Append to state file, tell user resume command |
| Conversation exceeds ~15 tool calls | → Write checkpoint proactively before continuing |
| Fingerprint or decisions change mid-run | → Append rationale to `qa/decisions.md` before continuing. Platform-specific resume hints live in the platform skill. |

### How to Reset After a Flow

After writing `flow.md` and the discovery evidence table for any flow:

1. **Append to `qa/state.md`** — mark this flow done, list the next flow pending. Do NOT rewrite the entire state file — just update the Flows table and Resume Instructions section.
2. **Tell the user**:

> "Flow **F-NNN — [Name]** complete ✅ ([N] screenshots).
>
> **To continue**: say **'continue'** or start a new conversation and say:
> `Read qa/state.md and continue Phase 1. Next flow: F-[NNN+1] — [name].`"

3. If the user says **'continue'** — proceed to the next flow immediately. Recommend a fresh context after every 2-3 flows, but don't force it.

**Keep resets lightweight.** The goal is: write flow.md → update state.md → move on. No coverage checks, no report generation, no inventory updates mid-session. Those happen at phase boundaries only.

### The State File Is the Memory

Every reset works because `qa/state.md` contains everything needed to resume:
- Which flows are done (with screenshot paths and key observations)
- Which flows are pending (with names, priority, auth requirement)
- The exact resume command for the next flow
- App quirks discovered so far
- Credentials status

A fresh context reading `qa/state.md` has full situational awareness. No information is lost.

### Phase 2 Context Resets

Same rule applies during TC generation:
- Write all TCs for one flow → checkpoint → reset
- Resume: `"Read qa/state.md and write all TCs for F-[NNN] — [name]."`
- Never try to write TCs for multiple flows in one context

---

## Checkpoint Protocol

**Session checkpoints are automatic — one global state file for the entire workspace.**

### Global State File

All platforms share a single state file: `qa/state.md`. Testing a different app overwrites it with the new app's context.

### When to Write a Checkpoint

| Trigger | What to record | Weight |
|---------|---------------|--------|
| After Step 1 (workspace init) | Framework, platform, directories created | Light |
| After Step 2 (app selected) | App name, URL/path, metadata, auth type | Light |
| **After each flow traced in Phase 1** | Flow slug, screenshot count, next flow pending | **Light — append only, no coverage checks or reports** |
| **Phase 1 → Phase 2 boundary** | All flows, coverage check, QA report | **Heavy — this is where deferred work runs** |
| **After each flow's TCs written in Phase 2** | TCs written for this flow, remaining flows | **Light — append only** |
| **Phase 2 → Phase 3 boundary** | All scenarios, QA report | **Heavy** |
| After final phase (finalize) | Final counts, QA report, run commands | Heavy |
| Whenever the user says "stop", "pause", or "save state" | Full snapshot of current progress | Light |

### How to Write the Checkpoint

**Light checkpoints** (per-flow): Overwrite only the `## Active Position` pointer block in `qa/state.md` — ≤6 lines — pointing at the active flow's `manifest.jsonl` (the step-level truth) and `qa/progress.jsonl` (append-only ledger). Do NOT rewrite the full file. Shape:

```markdown
## Active Position
- **Active flow**: F-NNN (<name>)
- **Next step**: first non-done line in `qa/flows/F-NNN-<slug>/manifest.jsonl`
- **Progress log**: `tail -n 30 qa/progress.jsonl`
- **Flows remaining**: F-NNN, F-NNN, … (see `qa/knowledgebase/journey-inventory.md`)
```

**Autonomous completion is mandatory.** Per `skills/_shared/engagement-protocol.md` → *End-to-End Completion is Mandatory*, once a flow's manifest is open the agent drives every step to terminal status (`done` / `skipped(reason)` / `blocked(reason)`) and auto-advances to the next PENDING flow in `journey-inventory.md` without prompting the user.

**Deterministic resume** — on fresh context, read `qa/state.md` → `tail -n 30 qa/progress.jsonl` → `grep -v '"status":"done"' qa/flows/<active>/manifest.jsonl` → continue at the first non-done line. No re-exploration.

**Heavy checkpoints** (phase boundaries, stop/pause): Write (or overwrite) the full `qa/state.md` using this template. Fill every section with real values — no placeholders left blank.

````markdown
# QA Session State — [OS/Platform]

**App under test**: [AppName]

> Resume: open a new conversation in this repo and say:
> **"Read qa/state.md and continue QA for [AppName]"**

## Snapshot — [YYYY-MM-DD HH:MM]

### App
| Field | Value |
|-------|-------|
| **App** | [name] |
| **Platform** | [macOS / web / windows / ios / android] |
| **URL / Path** | [url or /Applications/App.app] |
| **Auth** | [method — e.g. Email + Google SSO at /account] |
| **Plans / Tiers** | [Free / Pro / etc.] |
| **Core product** | [one sentence what it does] |
| **Key quirks** | [anything surprising discovered — redirects, SPA routes, etc.] |

### Completed
- [x] Workspace initialized (framework: [flow/feature/risk])
- [x] App metadata read
- [x] Discovery complete ([N] pages / sections, [N] screenshots)
- [x] Flows created: [N] — [F-001, F-002, ...]
- [x] Scenarios mapped: [N total]
- [x] Test cases written: [N] — [TC-001, TC-002, ...]

### Flows
| Flow | Dir | Scenarios | TCs Written | Priority |
|------|-----|-----------|-------------|----------|
| F-001 [name] | `qa/flows/F-001-[slug]/` | [N] | [N] | P[1/2/3] |

### Journey Specs — Written
| Journey | File | Scenarios | Status |
|---------|------|-----------|--------|
| J-001 | `qa/journeys/J-001-member.spec.ts` | [N] | Written |

### Journey Specs — Pending
#### [Role] ([N] scenarios remaining)
- [scenario description]

### Platform-Specific Resume Hints
See the platform skill's resume section for any platform-owned resume artefacts (e.g. strategy-specific state files, crawl queues, trace counters). The root skill does not know or care about them.

### Environment
Environment commands for running tests are written to `qa/scripts/` by the platform skill at the end of Phase 1. See the platform skill for the exact command set.

### .env.qa values needed
See `.env.example` and the platform skill for the required vars for this platform.

### Resume Instructions

**Next action**: [exact one-line description — e.g. "Trace F-003 — OpenClaw Onboarding" or "Write TCs for F-002 — Authentication"]

**Copy-paste resume command**:
```
Read qa/state.md and continue QA for [AppName]. Next: [exact next action].
```

> This command gives a fresh context full situational awareness. The state file is the memory.
````

### After Writing the Checkpoint

Tell the user:
> "✅ Checkpoint saved to `qa/state.md` — [N] flows, [N] scenarios, [N] TCs written, [N] pending.
> To resume: start a new conversation and say **'Read qa/state.md and continue QA for [AppName]'**"

**Report generation is deferred** — only generate the report at phase boundaries or when the user asks. Do NOT run `node scripts/allure/generate-report.js` on every checkpoint — it wastes context that should be spent tracing flows.

---

## Step 1: INIT MODE — Initialize QA Workspace

### 1.1 Framework Selection

Tell the user:
> "Welcome to native-qa! Let me set up a QA workspace for your **[selected platform]** app.
>
> First — how would you like your test cases organized?
>
> **1. Flow-based** *(recommended)*
>    One directory per user journey: `qa/flows/F-001-login/`, `qa/flows/F-002-settings/`, etc.
>    Best for apps with distinct end-to-end user flows.
>
> **2. Feature-based**
>    One directory per feature module: `qa/features/authentication/`, `qa/features/dashboard/`, etc.
>    Best for apps with many independent feature areas.
>
> **3. Risk-based**
>    Organized by severity: `qa/test-cases/P1-critical/`, `qa/test-cases/P2-high/`, etc.
>    Best for regression suites or deadline-driven QA cycles."

**STOP. Output nothing else. Do not continue to Step 1.2 until the user replies.** Accept: 1/2/3, "flow", "feature", "risk", or their description. Default to **flow-based** if unclear.

### 1.2 Create Directory Structure and READMEs

Create all directories and write a README in each one explaining its purpose.
Every directory gets a README so anyone opening the workspace understands what it is and why it exists.

#### Common directories (all frameworks)

```bash
mkdir -p qa/planning qa/guardrails qa/credentials qa/scope
mkdir -p qa/knowledgebase/aria-snapshots
mkdir -p qa/journeys
mkdir -p qa/context/feature-specs qa/context/figma-screens
mkdir -p qa/evidence qa/runs
```

#### Flow-based

```bash
mkdir -p qa/flows
```

#### Feature-based

```bash
mkdir -p qa/features
```

#### Risk-based

```bash
mkdir -p qa/test-cases/P1-critical
mkdir -p qa/test-cases/P2-high
mkdir -p qa/test-cases/P3-medium
mkdir -p qa/test-cases/P4-low
```

#### Write README in every directory

Write a short README in each `qa/` subdirectory explaining its purpose. Each README should have:
- A `# title` with the directory path and short description
- What files belong there and what formats are accepted
- One sentence on how the agent uses the contents

**Directories that need READMEs**: `qa/`, `qa/context/`, `qa/context/feature-specs/`, `qa/context/figma-screens/`, `qa/planning/`, `qa/guardrails/`, `qa/credentials/`, `qa/scope/`, `qa/knowledgebase/`, `qa/evidence/`, `qa/runs/`.

**Key points to include**:
- `qa/context/` — the only directory the user populates manually. Accepts: Figma PNGs, PRDs (.md/.txt), specs, screenshots. Agent reads everything here in Step 3.
- `qa/credentials/` — structure only, NEVER real values. Real credentials go in `.env.qa` (gitignored).
- `qa/knowledgebase/` — auto-generated during Phase 1. Contains screenshots, ui-inventory.md, nav-graph.md, personas.md.
- `qa/README.md` — include a "Resume a session" section: `Read qa/state.md and continue QA for [AppName]`

Keep each README under 15 lines — enough for any human opening the directory to understand what it is. Do NOT include tables of contents or detailed howtos.

### 1.3 Write `.qa-config.json`

Write `qa/.qa-config.json` with the actual chosen framework value:

```json
{
  "version": "2.0",
  "framework": "flow-based",
  "app_name": null,
  "app_path": null,
  "app_identifier": null,
  "app_version": null,
  "platform": "[selected platform — macOS | web | windows | ios | android]",
  "os_version": null,
  "architecture": null,
  "created": "YYYY-MM-DD",
  "last_discovery": null,
  "flows_count": 0,
  "test_cases_count": 0
}
```

- `platform`: use the exact platform chosen in Step 0.1 (e.g., `"macOS"`, `"web"`, `"windows"`, `"iOS"`, `"android"`).
- `app_identifier`: bundle ID for macOS/iOS, package name for Android, URL/base URL for web, exe path for Windows.
- `os_version`: populate during app metadata discovery in Step 2.

Tell the user:
> "✅ QA workspace initialized with **[chosen framework]** organization on **[selected platform]**.
> Next — which application do you want to test?"

→ **Write checkpoint** to `qa/state.md` (see Checkpoint Protocol). Record: platform, framework, directories created.

Proceed to **Step 2**.

---

## Step 2: App Selection

### 2.1 Pre-Read `.env.qa` — Check Before Asking

**Before asking the user anything**, silently check if `.env.qa` already has the app configured:

```bash
[ -f ".env.qa" ] && cat .env.qa || echo "NO_ENV_FILE"
```

Parse the output. Extract ALL relevant values — not just the app URL/name:

| Platform | Primary key | Also extract |
|----------|------------|-------------|
| **Web** | `QA_APP_URL` | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD`, `QA_LLM_API_KEY`, `QA_LLM_PROVIDER`, `QA_ACCOUNT_TIER` |
| **macOS** | `QA_APP_NAME` | same as above |
| **Windows** | `QA_APP_NAME` | same as above |
| **iOS / Android** | `QA_APP_NAME` | same as above |

#### If the primary key is populated → confirm, don't ask

> "Found in `.env.qa`:
>
> | Key | Value |
> |-----|-------|
> | `QA_APP_URL` | `https://app.example.com` |
> | `QA_TEST_EMAIL` | ✅ set |
> | `QA_TEST_PASSWORD` | ✅ set |
> | `QA_LLM_API_KEY` | ✅ set / ❌ not set |
> | ... | ... |
>
> I'll test **[URL or AppName]**. Correct? (yes / different app)"

**STOP. Wait for confirmation.** If user says "yes" or equivalent → store the values and proceed. If user provides a different app → use that instead.

#### If the primary key is empty or `.env.qa` doesn't exist → ask

Tailored to the selected platform:
> **macOS**: "What application would you like to test? (e.g., 'Slack', 'Figma', 'MyApp')"
> **Web**: "What URL or web app would you like to test? (e.g., 'https://app.example.com')"
> **Windows**: "What application would you like to test? (e.g., 'Notepad', 'MyApp')"
> **iOS / Android**: "What app would you like to test? (bundle ID or app name — e.g., 'com.example.myapp')"

Wait for the answer. Store the app name / URL.

### 2.2 Remember What `.env.qa` Contains

Store the full credential inventory from 2.1 in memory for the rest of the session. This inventory is used by the Credential Gate Protocol during Phase 1 (platform skill Step W-2.4 / macOS Step 6.5) to **auto-fill credentials without asking the user again**. Do not re-read `.env.qa` repeatedly — read once here, use everywhere.

→ **Write checkpoint** to `qa/state.md`. Record: platform, framework, app name provided.

Proceed to **Step 3**.

---

## Step 3: Prior Domain Knowledge

### 3.1 Check `qa/context/` for Pre-Placed Files

`qa/context/` was created during Step 1. Before asking anything, silently check if the user has already placed files there:

```bash
find qa/context -type f ! -name "README.md" 2>/dev/null
```

**If files exist** — read all of them now. Accept any format found:
- `.md` / `.txt` — PRDs, specs, GitHub notes, feature docs
- `.png` / `.jpg` — Figma exports, app screenshots, design mocks (use the Read tool for visual analysis)

Extract: named flows, features, user journeys, navigation paths, edge cases, auth type, known bugs, priority areas. Announce what you found, then proceed directly to **Step 4** — skip the question below.

> "Found prior knowledge in `qa/context/` — read [N] files: [list]. I'll use this to guide flow discovery."

---

### 3.2 Ask How to Provide Context (only if `qa/context/` is empty)

> ⛔ **HARD GATE — Output the EXACT text below. Do NOT paraphrase. Do NOT rewrite. Do NOT summarize. Do NOT add your own questions. Replace only `[AppName]` with the actual app name. Copy everything else character-for-character.**

> "Step 3 — Prior Knowledge
>
> `qa/context/` is ready. Before I start exploring **[AppName]**, do you have any background I should read first?
>
> **Option 1 — Drop files into `qa/context/`**
> Place any of the following there, then say "ready":
> - Figma screen exports (PNG or JPG)
> - PRD / product spec (.md or .txt)
> - GitHub README, issue list, or notes
> - Any markdown describing flows, features, or edge cases
> - Screenshots of the installed app
>
> **Option 2 — Tell me in the chat**
> Describe what you know — what the app does, key flows, things to test or skip, known edge cases.
>
> **Option 3 — Discover it yourself**
> I'll explore **[AppName]** visually from scratch — screenshot every screen and map every flow.
>
> Which would you like? (1 / 2 / 3)"

**STOP. Output nothing else. Do not continue to Step 3.3 until the user replies.**

---

### 3.3 Route Based on Answer

#### Option 1 — Files in `qa/context/`
Wait for the user to say "ready" (or any confirmation). Then scan:

```bash
find qa/context -type f ! -name "README.md" 2>/dev/null
```

Read every file found. For images, use the Read tool (visual analysis). For text/markdown, read as-is. Extract:
- Named flows and user journeys
- Features to prioritize and features to skip
- Known edge cases, bugs, or tricky states
- Auth type and credential fields
- Navigation structure and key routes

Write a candidate flow list as a starting skeleton in `qa/knowledgebase/ui-inventory.md`. Proceed to **Step 4** to launch the app and validate extracted knowledge visually.

#### Option 2 — Written in chat
Parse the user's message. Extract the same fields as Option 1. Ask one follow-up only if the auth situation is unclear:

> "Got it — one thing I need before launching: does **[AppName]** require login? If yes, what does it look like — email/password, SSO, API key, or something else?"

Write what was extracted to `qa/knowledgebase/ui-inventory.md`. Proceed to **Step 4**.

#### Option 3 — Discover yourself
Acknowledge and proceed immediately to **Step 4**:

> "Got it — I'll explore **[AppName]** visually and map every flow from scratch."

---

### 3.4 Incomplete Picture — Always Supplement with Visual Discovery

After processing any provided context, evaluate completeness:
- Are there named flows covering all major user goals?
- Are screen states (empty, error, success, loading) identified?
- Are navigation paths between sections clear?

**If incomplete** — regardless of how much context was provided — supplement with visual exploration in Step 4:

> "The provided context gives me a partial picture — I can see [what was found] but [what's missing] isn't covered. I'll launch the app and screenshot every section to fill in the gaps."

---

### 3.5 Platform Fingerprint (required before delegation)

Before handing off to the platform skill, classify the app so Step 4 onward can pick the right exploration strategy.

1. **Read** `skills/_shared/fingerprint-questions.md` — the 5 questions.
2. **Answer** using context already gathered (app name, `.env.qa`, `qa/context/`, any Step 3 user responses) plus **ONE** quick probe: launch the app / load the URL, take a single screenshot, and READ it. No additional user interaction.
3. **Write** `qa/platform-fingerprint.md` using the table format in `fingerprint-questions.md`. All 5 fields must be filled, including Q5 (chosen strategy + rationale + declared fallback).
4. This file is **write-once**. Do not regenerate on resume — future sessions read it.

> If Q5 cannot be answered because the platform has no documented strategies yet, record `Strategy: default (platform skill's built-in flow)` and `Fallback: none — use platform skill default` and move on. Do not block.

### 3.6 Decisions Log Bootstrap

Create `qa/decisions.md` with a one-line header: `# Decisions Log — append-only audit trail`. Every subsequent strategy choice, tool selection, boundary justification, deviation from defaults, or runtime script update appends one dated entry. Never rewritten. See `skills/_shared/fallback-discipline.md` for the entry format.

### 3.7 Preflight (delegated to platform skill)

Before any exploration runs, execute the preflight defined by the selected platform skill (web → Step W-1.5; macOS → built-in accessibility check). The preflight **MUST NOT throw**. For each missing item — runtime toolchain, browser binary, config file, required env var — report the gap and ask the user via `AskUserQuestion` whether to:

- **(a)** auto-install / auto-create with the user's consent,
- **(b)** provide a value now so the skill writes `.env.qa`,
- **(c)** let the user fix it manually and type "continue",
- **(d)** skip that feature for this run.

See `skills/_shared/engagement-protocol.md`. Per-role credentials are **deferred** to the role-confirmation gate (web W-2.5) — preflight only checks the global baseline (`.env.qa` exists, `QA_APP_URL` set, `QA_TEST_EMAIL`/`PASSWORD` for the default role).

---

## → Delegate to Platform Skill

Steps 4 onward are **platform-specific**. After completing Step 3, load the selected platform's skill file and follow it from its Step 4:

```
skills/macos/SKILL.md    → macOS native apps (AppleScript + screencapture)
skills/web/SKILL.md      → Web apps (Playwright + Chromium)
skills/windows/SKILL.md  → Windows native apps (WinAppDriver + UIA3)
skills/ios/SKILL.md      → iOS apps (XCUITest + xcrun)
skills/android/SKILL.md  → Android apps (UIAutomator2 + ADB)
```

The platform skill is **fully self-contained** — it carries everything needed from Step 4 onward:

| Phase | Steps | What happens |
|-------|-------|-------------|
| **Phase 1: Discovery** | Steps 4–7 | App metadata → launch → explore → nav graph → personas → trace E2E journeys → flow.md |
| **Phase 2: Scenarios** | Step 8 | Credential acquisition (if needed) → auth tracing → scenario generation → scenarios.md |
| **Phase 3: Test Cases** | Step 9 | Journey spec generation → `qa/journeys/J-NNN-<role>.spec.ts` (shippable, no intermediate TC-*.md files) |
| **Phase 4: Execution** | Steps 10–11 | Extract specs → run tests → unified report |
| **Update mode** | Step 12 | Re-discover, add flows, full refresh |

No other files are required. All automation scripts, templates, and references are inlined in the platform skill.

