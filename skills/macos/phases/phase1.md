# macOS — Phase 1: Discovery (Steps 4–7)

**Goal**: Discover the app's UI surface — launch, enumerate windows/menus/sidebars, trace every happy flow step-by-step with a screenshot at every action.
**Output**: `qa/knowledgebase/ui-inventory.{md,json}`, `qa/knowledgebase/screenshots/*.png`, `qa/flows/F-NNN-*/flow.md` per flow.
**Transition**: Phase 1 Complete Gate stops before scenario generation; awaits user confirmation.

Runtime rules — see `skills/_shared/runtime.md` (engagement, checkpoints, navigation, token discipline).

---

## Pre-Step: Load Prior Knowledge

```bash
ls qa/knowledgebase/ui-inventory.md 2>/dev/null && echo "EXISTS" || echo "NONE"
ls qa/context/ 2>/dev/null
```

- If `ui-inventory.md` exists — read it; prioritize flows named there.
- If `qa/context/` has unread files — read them before launching the app.
- Otherwise — cold start.

---

## Step 4: App Metadata

### 4.1 Locate the App

```bash
APP_NAME="[user input from Step 2]"

if [ -d "/Applications/${APP_NAME}.app" ]; then
  APP_PATH="/Applications/${APP_NAME}.app"
elif [ -d "$HOME/Applications/${APP_NAME}.app" ]; then
  APP_PATH="$HOME/Applications/${APP_NAME}.app"
else
  APP_PATH=$(mdfind "kMDItemKind == 'Application'" | grep -i "${APP_NAME}" | head -1)
fi
echo "Resolved: $APP_PATH"
```

Not found → ask user for full path.

### 4.2 Read Metadata

```bash
python3 - <<'PYEOF'
import plistlib
app_path = "/Applications/APPNAME.app"  # replace
with open(app_path + "/Contents/Info.plist", "rb") as f:
    p = plistlib.load(f)
print("Name:    ", p.get("CFBundleName", p.get("CFBundleExecutable", "N/A")))
print("BundleID:", p.get("CFBundleIdentifier", "N/A"))
print("Version: ", p.get("CFBundleShortVersionString", "N/A"))
print("Build:   ", p.get("CFBundleVersion", "N/A"))
print("Min OS:  ", p.get("LSMinimumSystemVersion", "N/A"))
PYEOF

sw_vers -productVersion
uname -m
```

### 4.3 Update Config + Planning Files

Update `qa/.qa-config.json`: `app_name`, `app_path`, `app_identifier` (bundle ID), `app_version`, `os_version`, `architecture`.

Write planning files (short, app-specific — see "Planning Files" in `skills/macos/SKILL.md`):
- `qa/planning/platforms.md`
- `qa/guardrails/do-and-dont.md`
- `qa/credentials/access.md`
- `qa/scope/contract.md`

→ Light checkpoint to `qa/state.md`.

---

## Step 5: Launch + First Screenshot

### 5.1 Accessibility Permission Check

```bash
osascript -e 'tell application "System Events" to get name of every process' > /dev/null 2>&1 \
  && echo "✅ Accessibility OK" \
  || echo "❌ BLOCKED"
```

If blocked, **stop**:

> "I need Accessibility permission to explore [AppName]'s UI. System Settings → Privacy & Security → Accessibility → enable Terminal (or your IDE). Tell me when done."

### 5.2 Launch

```bash
osascript -e 'tell application "[AppName]" to quit' 2>/dev/null; sleep 2
open -a "[AppName]"; sleep 4
osascript -e 'tell application "System Events" to (name of every process) contains "[AppName]"'
```

Fallback: `open -b "[bundle-id]"; sleep 4`.

### 5.3 Capture Main Window

```bash
osascript -e 'tell application "[AppName]" to activate'; sleep 1
mkdir -p qa/knowledgebase/screenshots
screencapture -x qa/knowledgebase/screenshots/01-main-window.png
```

### 5.4 Visual Analysis

Use the Read tool on the screenshot. Tell the user: layout, top-level nav, primary actions, inferred app type, sections to explore next.

---

## Step 6: Deep Exploration

### 6.1 AppleScript UI Enumeration

Write `qa/scripts/explore.py` at runtime (stdlib only: `subprocess`, `json`, `os`, `time`, `argparse`, `plistlib`). Then:

```bash
python3 qa/scripts/explore.py --app "[AppName]" --output qa/knowledgebase --screenshot
```

The script must:
1. `run_applescript(script)` wrapper around `subprocess.run(["osascript", "-e", ...])`.
2. `check_accessibility()` — verify System Events access.
3. `check_app_running(app)` / `launch_app(app)`.
4. `get_windows(app)` — list window names, positions, sizes via AppleScript.
5. `get_ui_elements(app, window_index)` — enumerate buttons, text fields, static texts, tabs, groups, checkboxes, pop-ups per window.
6. `explore_app(app, output_dir)` — orchestrate; write `ui-inventory.md` + `ui-inventory.json`.
7. CLI: `--app NAME --output DIR [--no-launch] [--screenshot]`.

Outputs:
- `qa/knowledgebase/ui-inventory.md`
- `qa/knowledgebase/ui-inventory.json`
- `qa/knowledgebase/screenshots/applescript-main.png`

### 6.2 Deep Navigation Loop

For each tab / sidebar item / toolbar button / menu entry:

```applescript
tell application "System Events"
    tell process "[AppName]"
        click [element]
        delay 1
    end tell
end tell
```

```bash
screencapture -x "qa/knowledgebase/screenshots/0N-[section-slug].png"
```

Read every screenshot. Analyze: visible elements, available actions, sub-sections, forms, pickers. Repeat for Preferences (`Cmd+,`), tabs, sidebar, modals.

### 6.3 Menu Bar Exploration

```bash
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        return name of every menu bar item of menu bar 1 as string
    end tell
end tell'

osascript -e '
tell application "System Events"
    tell process "[AppName]"
        click menu bar item "View" of menu bar 1
        delay 0.5
    end tell
end tell'
screencapture -x qa/knowledgebase/screenshots/menu-view.png
osascript -e 'tell application "System Events" to key code 53'  # Escape
```

### 6.4 Status Bar / Menu Bar Extra

```bash
osascript -e '
tell application "System Events"
    tell process "[AppName]"
        try
            return name of every menu bar item of menu bar 2 as string
        on error
            return "none"
        end try
    end tell
end tell'
```

If a menu bar extra exists, click + screenshot.

### 6.5 Happy Flow Tracing — Screenshot at Every Step

**Core of Phase 1.** For each happy flow, trace end-to-end one action at a time, screenshot after every action.

#### Naming

```
qa/knowledgebase/screenshots/flow-[F-slug]-step[NN]-[description].png
```

Example: `flow-F001-launch-step01-initial-window.png`.

#### Tracing protocol (per flow)

1. **Create `flow.md` immediately** — before screenshots:

   ```markdown
   # F-NNN: [Flow Name]
   > ⚠️ IN PROGRESS — being traced. Do not use until marked complete.

   ## Summary
   | Field | Value |
   |---|---|
   | **Flow ID** | F-NNN |
   | **App** | [AppName] |
   | **Status** | IN PROGRESS |

   ## Discovery Evidence

   | Step | Action | Screenshot | Observed |
   |------|--------|-----------|---------|
   ```

2. **Reset** — quit and relaunch (or navigate to flow's start state).

3. **Step-by-step** — for each action, do ALL of these before next step:
   - Execute via AppleScript / shortcut
   - `delay 1` (or `delay 3` for window-opening actions)
   - `screencapture -x [path]`
   - Read the screenshot
   - Append observation to flow.md table immediately:
     ```markdown
     | 1 | Launch app | `flow-F001-step01-initial.png` | Main window visible; 3 tabs: General, Network, About; Connect button prominent |
     ```
   - Capture everything visible — element names, labels, state. Don't summarize.

4. **Finalize `flow.md`** — fill remaining sections (User Journey, Success Outcome, Playwright skeleton). Remove the `⚠️ IN PROGRESS` warning. Status → `COMPLETE`.

#### Mid-Exploration Auth Gate — Credential Prompt

When a flow hits a locked state in Phase 1:

1. **Screenshot the gate.**
2. **Read it** — identify the exact credential type (don't assume email/password):

   | UI shows | Credential type |
   |---|---|
   | Email + Password | Login |
   | API key field | API key (OpenAI/Anthropic/etc.) |
   | License key | License/activation |
   | OAuth button | OAuth token |
   | TOTP / 2FA | TOTP |
   | Multiple plans | Plan selection required |
   | "Pro only" gate | Plan upgrade |
   | Invite code | Beta access |
   | Webhook URL/secret | Webhook |
   | Anything else | Read its label exactly |

3. **Plan selection** — if multiple plans visible, ask first:

   > "Multiple plans available: [list exactly as shown]. Which plan should I test with?"

   Store as `QA_ACCOUNT_TIER` in `.qa-config.json`.

4. **Then ask for credentials** — silently check `.env.qa` first:

   ```bash
   cat .env.qa 2>/dev/null || echo "File not found"
   ```

   | UI needs | `.env.qa` key |
   |---|---|
   | Email + password | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
   | OpenAI API key | `QA_LLM_API_KEY` or `OPENAI_API_KEY` |
   | Anthropic API key | `QA_LLM_API_KEY` or `ANTHROPIC_API_KEY` |
   | License key | `QA_LICENSE_KEY` |
   | Account tier | `QA_ACCOUNT_TIER` |
   | Other | Match label from screenshot |

   - **Found in `.env.qa`** → use immediately. Don't ask. Don't skip.
   - **Not found** → ask user:

     > "**[Flow Name]** needs access. App is asking for: **[exact credential type]**. `.env.qa` status: **[key] is ❌ not set**.
     >
     > 1. Tell me in chat
     > 2. Add to `.env.qa` and say 'ready'
     > 3. Self-register (only for email + password signup)
     > 4. Skip (only if you explicitly want to defer)"

> ⛔ **The agent NEVER chooses to skip on its own.** Only the user can. Never autonomously click "Skip" / "Maybe later" / any bypass button.

#### Routes

- **Option 2 (chat)** — use in current session via AppleScript only. Don't write to tracked files. Persist only to `.env.qa` (gitignored).
- **Option 3 (self-register)** — email + password signup forms only. Generate `qa-test-[ts]@mailinator.com` + `QaTest@[random]`. Attempt registration; on success → `.env.qa`. If gated (invite/CAPTCHA/paid/no signup) → tell user, fall back to Option 4.
- **Option 4 (skip — user choice only)** — note in `flow.md` discovery evidence: `⛔ Access required — [exact credential type] — deferred to Phase 2 (user chose to skip)`. Note in `qa/state.md` under pending flows. Continue.

### 6.6 Section Inventory

> "Explored **[AppName]** — found **[N] sections**, traced **[N] happy flows**:
>
> | # | Section | Type | Happy Flow Traced | Screenshots |
> |---|---|---|---|---|
> | 1 | [Name] | [type] | ✅ / ⛔ needs auth | [N] |"

### 6.7 Clarifying Questions

Batch 2–3 per message:

> "Quick questions:
> **[Section A]**: main user goal? Any conditions?
> **[Section B]**: multiple ways users reach this?"

Don't ask about negative/edge cases — that's Phase 2.

---

## Step 7: Flow Creation

### 7.1 Identify Flows

A flow = goal, not screen.

**Universal flows** (every macOS app):
- `F-001-app-launch-and-startup`
- `F-002-quit-and-state-persistence`
- `F-003-preferences-settings`
- `F-004-menu-bar-navigation`

**App-specific flows**: from discovery — `F-005-[primary-feature]`, etc.

Naming: `F-NNN-[lowercase-hyphenated]`.

### 7.2 Flow Directory

```bash
mkdir -p "qa/flows/F-NNN-[slug]/test-cases"
```

`qa/flows/F-NNN-[slug]/README.md`:

```markdown
# F-NNN — [Flow Name]

| Field | Value |
|---|---|
| Flow ID | F-NNN |
| Priority | P1 / P2 / P3 |
| Auth required | Yes / No |
| Scenarios | [N] |
| Test cases | [N] |

## What this flow covers
[One sentence: user goal tested]

## Files
| File | Purpose |
|---|---|
| flow.md | Journey map |
| scenarios.md | All scenarios |
| test-cases/ | One TC-NNN-*.md per scenario |
```

### 7.3 Write `flow.md`

Each flow.md has:
- **Summary table**: Flow ID, App, Description, Start/End State, Window/Panel, Priority, Created
- **UI Elements table**: Element Type | Name | Role in flow
- **User Journey**: Preconditions checklist → Steps table (Step | User Action | System Response | Element) → Success Outcome → Failure Outcomes table
- **AppleScript Navigation Skeleton**: tell app to activate → System Events click/interact with delays
- **Discovery Evidence table**: Step | Action | Screenshot | Observed

→ Light checkpoint after each `flow.md`. Tell user: "Type `/clear`, then paste: `Read qa/state.md and continue QA for [AppName]`".

---

## Phase 1 Complete Gate

**STOP. Do not generate scenarios or TCs yet.**

→ Heavy checkpoint to `qa/state.md`:
- All flows discovered (every F-NNN slug)
- Happy flows traced (with screenshot counts)
- Auth-gated flows (list which need credentials)
- Phase: `EXPLORATION_COMPLETE — awaiting credentials`

### Phase 1 Report

```bash
node scripts/allure/generate-report.js --open
```

Tell user:

> "Phase 1 Complete ✅ — [N] flows, [N] screenshots, [N] need credentials. Report opened. Say 'generate full coverage' when ready."

**Wait for user before [phase2.md](phase2.md).**
