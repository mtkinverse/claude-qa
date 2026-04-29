# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this project is

**native-qa** is a multi-platform autonomous QA skill — selects platform → scaffolds workspace → discovers UI → generates scenarios → writes shippable tests → runs them. Web (Playwright, DOM/ARIA snapshots) and macOS (AppleScript, screenshots) are production. Windows / iOS / Android are stubs.

## Lazy-load rule

The skill is split into small files by phase. **Read on demand, not all at once.** A typical session loads:

1. `SKILL.md` — root router (platform gate + Steps 0–3 + delegation)
2. `skills/_shared/runtime.md` — engagement, checkpoints, resets, token discipline (cited from every phase)
3. `skills/<platform>/SKILL.md` — thin platform router with phase index
4. `skills/<platform>/phases/phase<N>.md` — only the phase currently in flight

Don't preload all phases. Don't restate runtime rules — cite `skills/_shared/runtime.md` and move on.

## Where things live

- **Workspace scaffolding** — `scripts/init-workspace.js` + `scripts/templates/readmes/` (deterministic; called once during INIT, not read by Claude after)
- **Code templates** — real files under `skills/web/templates/` (`playwright.config.ts`, `snapshot-page.js`, `auth.setup.ts`, `run.js`, `package.json`); copy at runtime, no edits required
- **Strategies** — `skills/web/strategies/` (BFS / targeted-trace / sitemap-spot-check); pick per fingerprint, log in `qa/decisions.md`, declare a fallback
- **Reports** — `scripts/allure/generate-report.js` runs at phase boundaries only

## Slash commands

- `/native-qa` — start the QA flow

## Read this before editing the skill

- `skills/_shared/principles.md` — selectors, screenshot protocol, runtime script evolution
- `skills/_shared/fallback-discipline.md` — every strategy declares a fallback
- `skills/_shared/runtime.md` — the runtime contract (don't duplicate it elsewhere)
