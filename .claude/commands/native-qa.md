---
name: native-qa
description: Multi-platform autonomous QA — selects platform → scaffolds workspace → discovers UI → generates scenarios → writes shippable tests → runs them. Web (Playwright, DOM/ARIA snapshots) and macOS (AppleScript, screenshots) are production. Windows / iOS / Android are stubs.
---

# /native-qa

Start the native-qa skill.

> ⛔ **HARD GATE — platform selection comes first.** Do NOT run bash, read workspace files, or check `qa/` until the user picks a platform. The only allowed action is reading `skills/_registry/registry.json` to build the menu.

## Run order

1. Read `SKILL.md` — root router. It owns the platform gate, mode detection (Step 0), workspace init (Step 1, calls `scripts/init-workspace.js`), app selection (Step 2), prior-knowledge handling (Step 3), platform fingerprint (3.5), decisions log bootstrap (3.6), preflight (3.7), and delegation to the platform skill.

2. Read `skills/_shared/runtime.md` once at session start — the contract for engagement, checkpoints, context resets, navigation, token discipline, and browser launch. Cited from every phase. Don't restate it.

3. After Step 3, load the selected platform's router and follow its phase index:
   - `skills/web/SKILL.md` → `skills/web/phases/{phase1,phase2,phase3,phase4,update-mode}.md`
   - `skills/macos/SKILL.md` → `skills/macos/phases/{phase1,phase2,phase3,phase4,update-mode}.md`
   - `skills/windows/SKILL.md` / `skills/ios/SKILL.md` / `skills/android/SKILL.md` → stubs

## Lazy-load rule

Read on demand, not all at once. A typical session loads root SKILL + runtime.md + the platform router + only the phase currently in flight. Don't preload all phases.

## Platform-specific reminders

- **Web**: Phase 1/2 use `snapshotPage()` (DOM/ARIA JSON). Calling `page.screenshot()` during discovery is forbidden — Playwright takes screenshots only on test failure during Phase 4.
- **macOS**: screenshot at every action; Read every screenshot with the Read tool; capture observations into `flow.md` immediately.

## Stop / pause / resume

Follow `skills/_shared/runtime.md` §4. Resume command on any fresh context:

```
Read qa/state.md and continue QA for [AppName]
```
