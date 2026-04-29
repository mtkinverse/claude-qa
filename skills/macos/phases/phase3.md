# macOS — Phase 3: Test Case Generation (Step 9)

**Goal**: Write one TC-NNN file per scenario.
**Output**: `qa/flows/F-NNN-[slug]/test-cases/TC-NNN-[scenario-slug].md`.

TC numbers are **globally sequential** across all flows. Zero-pad to 3 digits.

Runtime rules — see `skills/_shared/runtime.md`.

---

## 9.1 Quality Standards

Each TC must have:
- **Metadata table**: TC ID, flow ref, priority, macOS version, automation method
- **Preconditions**: exact app state before scenario
- **Setup**: bash/AppleScript to establish preconditions
- **Steps table**: Step | Action | AppleScript | Expected Result
- **Full AppleScript block**: runnable happy-path script
- **Pass criteria checklist**: binary observable outcomes
- **Evidence path**: `qa/evidence/TC-NNN-S1.png`
- **Teardown**: how to restore app state

## 9.2 AppleScript Standards

```applescript
-- Always delay after every click
click button "OK" of window 1
delay 1

-- Delay 3 after launch/quit
open -a "[AppName]"; sleep 3

-- Assert and log pass/fail
if exists button "Dashboard" of window 1 then
    log "✅ PASS: Dashboard button visible"
else
    do shell script "screencapture -x qa/evidence/TC-NNN-fail.png"
    error "❌ FAIL: Dashboard button not found"
end if
```

## 9.3 TC Template

`qa/flows/F-NNN-[slug]/test-cases/TC-NNN-[slug].md`:
- **Metadata**: TC ID, Flow, Scenario, Priority, Platform (macOS version), Automation (AppleScript), Created
- **Preconditions**: app installed, Accessibility granted, account state
- **Setup**: quit → sleep 2 → open → sleep 3
- **Steps table**: Step | Action | AppleScript Command | Expected Result
- **Full AppleScript block**: setup + steps + assertions
- **Pass Criteria**: observable outcomes checklist + no crash
- **Evidence**: pass/fail screenshot paths
- **Teardown**: quit, restore system state

## 9.4 Interaction Driver (execution)

When **executing** TCs, write `qa/scripts/interact.py` at runtime. Stdlib only. CLI:

```bash
python3 qa/scripts/interact.py click --app "[AppName]" --element "Save"
python3 qa/scripts/interact.py type --app "[AppName]" --text "Hello"
python3 qa/scripts/interact.py menu --app "[AppName]" --menu "File" --item "Save"
python3 qa/scripts/interact.py assert --app "[AppName]" --element "Dashboard"
```

Subcommands:
- `check-permission`
- `launch --app --wait`
- `quit --app`
- `click --app --element [--type button] [--window 1]`
- `type --app --text [--clear]`
- `shortcut --app --key [--mod cmd shift]`
- `menu --app --menu --item [--submenu]`
- `assert --app --element [--type] [--window]`

Each returns JSON: `{"ok": bool, "message": str, "error": str|null}`.

All AppleScript: `delay 1` after clicks, `delay 0.5` after keystrokes.

## 9.5 Checkpoint Discipline

→ Light checkpoint to `qa/state.md` after every 5 TCs. Record every TC by ID + every TC pending. Reset context after.

→ Next: [phase4.md](phase4.md)
