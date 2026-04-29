---
name: native-qa-macos
description: macOS QA runbook — Steps 4–11. Phase 1 (discovery) → Phase 2 (credentials + scenarios) → Phase 3 (TCs) → Phase 4 (report). Invoked by root SKILL.md after platform selection.
platform: darwin
status: production
version: 4.0.0
---

# macOS Native QA Skill — Router

This file is the **router** for the macOS platform. Each phase has its own file. Load only what you need.

```
Phase 1: Discovery (Steps 4–7) → phases/phase1.md
Phase 2: Scenarios (Step 8)    → phases/phase2.md
Phase 3: Test Cases (Step 9)   → phases/phase3.md
Phase 4: Finalize (Step 10)    → phases/phase4.md
Update Mode (Step 11)          → phases/update-mode.md
```

**Platform**: macOS 12 Monterey+
**Automation**: AppleScript + screencapture + Accessibility API
**Invoked by**: root `SKILL.md` after platform selection (Step 0) and workspace init (Steps 1–3).

Cross-cutting rules — read once at session start, cited from every phase:
- `skills/_shared/runtime.md` — engagement, checkpoints, context resets, navigation, token discipline, browser launch
- `skills/_shared/principles.md` — selectors, screenshots, runtime script evolution
- `skills/_shared/fingerprint-questions.md` — drives strategy selection from `qa/platform-fingerprint.md`
- `skills/_shared/fallback-discipline.md` — every step declares a fallback

macOS doesn't yet have a `strategies/` directory. The default exploration flow in `phase1.md` IS the strategy. Future alternatives land under `skills/macos/strategies/` with the same selection + decisions-log + fallback pattern as web.

---

## Prerequisites

- macOS 12 Monterey or later
- Python 3.9+ (stdlib only — `subprocess`, `json`, `argparse`, `plistlib`, no pip)
- **Accessibility permission**: System Settings → Privacy & Security → Accessibility → enable Terminal (or your IDE)

---

## Templates (`skills/macos/templates/`)

- `flow.md` — flow journey map
- `scenarios.md` — full-coverage scenarios per flow
- `test-case.md` — single TC file

## References (`skills/macos/references/`)

- `macos-automation.md` — AppleScript patterns, window/menu enumeration
- `test-patterns.md` — scenario patterns by UI element type and app category

---

## Planning Files (Phase 1, Step 4.3)

Write these short, app-specific files to `qa/`:

- **`qa/planning/platforms.md`** — App name, bundle ID, version, build, path, macOS version, architecture, framework, automation method (AppleScript)
- **`qa/guardrails/do-and-dont.md`** — DOs: fresh launch per test, test accounts only, Accessibility permission, `delay 1` after clicks / `delay 3` after launch, screenshot on failure. DON'Ts: no personal accounts, no committed credentials, no skipped delays, no real payment. Cautions: system dialogs, menu bar apps (`menu bar 2`)
- **`qa/credentials/access.md`** — Structure only (NEVER real values). Required roles table, `.env.qa` template, Accessibility checklist
- **`qa/scope/contract.md`** — App name, platform, framework, in-scope (launch, quit, prefs, menus, core features), out-of-scope (other platforms, load/security testing), definition of done

---

## Key Reminders — macOS-Specific

- **Accessibility check first** — no automation without it (`phases/phase1.md` Step 5.1)
- **AppleScript delays are mandatory** — `delay 1` after clicks, `delay 3` after launch/quit
- **Menu bar apps** — if no window appears, check `menu bar 2`
- **Screenshots are the discovery record** — Read every screenshot with the Read tool; capture observations into `flow.md` immediately
- **Context resets, credentials, flow structure** — follow `skills/_shared/runtime.md` (no macOS-specific differences)

---

## STOP / PAUSE / SAVE STATE

Follow `skills/_shared/runtime.md` §4 exactly. No macOS-specific differences.
