---
name: shared-principles
description: Platform-agnostic principles for autonomous QA skills. How Claude reasons, decides, and records — referenced by every platform skill.
type: reference
---

# Shared Principles — How Claude Thinks During QA

These are the cross-platform rules. Every platform skill (web, macOS, iOS, Android, Windows) inherits them.

> ⚠️ **EXAMPLES AND PREFERRED SUGGESTIONS** — these are the defaults. You may deviate when the observed app character justifies it, but you MUST log the deviation in `qa/decisions.md` and declare a fallback.

---

## 1. Reason Before You Act

Before any exploration, automation, or generation, answer:

- **What kind of app is this?** (category, complexity, audience, auth model)
- **Why is this approach appropriate?** (vs. alternatives)
- **What is the fallback if this approach stalls?**

The five fingerprint questions in `skills/_shared/fingerprint-questions.md` operationalize this. Answer them once, write `qa/platform-fingerprint.md`, never regenerate.

## 2. Justify Every Boundary

A "flow" is not a directory you create — it is a user goal you can defend. For every flow:

- **Why is this a distinct flow?** (2-3 sentences grounded in observed evidence)
- **Why is it not a sub-step of an adjacent flow?**
- **What strategy was used to discover it?** (and what was the fallback?)

Templates have explicit Why fields. If you can't fill them, the flow boundary is wrong — re-derive.

## 3. Decisions Log — Append Only

`qa/decisions.md` is the audit trail. Append one entry whenever you:

- Pick a strategy (or deviate from the default)
- Choose between framework alternatives
- Skip a scenario category that the template suggests
- Update a runtime helper script in `qa/scripts/`
- Encounter a stall and execute a fallback

Format: `## YYYY-MM-DD HH:MM — <topic>` then 2-4 lines (decision + rationale + fallback if relevant). Never rewrite. On resume, tail the last ~10 entries — do not re-read the whole file.

## 4. Fallback Discipline — Never Break the Flow

See `skills/_shared/fallback-discipline.md`. Every strategy, runtime script, and TC declares a fallback. If primary stalls, execute fallback and continue. Stopping the run because one approach failed is a bug.

## 5. Selector Hierarchy (Abstract)

Order of preference when locating UI elements (applies to any tool):

1. Accessibility role + accessible name
2. Visible label association
3. Explicit test ID (e.g. `data-testid`)
4. Visible text
5. CSS / structural selector
6. XPath (last resort — fragile)

Each platform skill maps this hierarchy onto its tool's API.

## 6. Discovery Snapshot Protocol

**Web platform**: Discovery uses DOM/ARIA snapshots — not screenshots.
- After each navigation, call `snapshotPage()` (defined in `skills/web/SKILL.md` W-2.5) to write a `.snapshot.json` containing the ARIA accessibility tree + structured DOM extract (headings, inputs, buttons, links, images, alerts).
- Never call raw `page.screenshot()` during Phase 1 or Phase 2 discovery. Screenshots are taken automatically by Playwright only on test failure during Phase 4 execution.
- Visual artifacts (images, icons, badges, illustrations) are identified from `role="img"`, `alt` text, `aria-label`, and DOM class names in the snapshot — not by reading PNG files.
- Name snapshots by ACTUAL URL slug, not intended destination — prevents hallucination on redirects.
- Snapshot **AFTER** wait + verification (so it reflects settled state, not transitional).

**macOS / native platforms**: continue using the platform's atomic capture wrapper (screencapture + accessibility API). This DOM/ARIA rule applies to web only.

## 7. Session Limits

- Per-flow context reset is the norm — finish flow → write `flow.md` → checkpoint to `qa/state.md` → reset.
- Heavy checkpoint (full state snapshot + report) only at phase boundaries (1→2, 2→3, 3→4, end). Per-flow checkpoints are append-only.
- Disk state (`qa/state.md`, `qa/decisions.md`, platform-specific resume files) survives every reset.

## 8. Runtime Script Evolution

`qa/scripts/` is Claude-owned. As you learn the app:

- Write a helper → header comment states WHY it exists, which strategy spawned it, and its fallback.
- Update a helper → append a new entry to `qa/decisions.md` explaining what changed and why.
- Never write a script without a fallback path baked in.

### `page.accessibility` is removed — use `page.locator('body').ariaSnapshot()`

`page.accessibility.snapshot()` was removed in Playwright ≥1.49. Any script that calls it will throw `Cannot read properties of undefined (reading 'snapshot')`. Always use:

```javascript
const aria = await page.locator('body').ariaSnapshot().catch(() => null);
```

This applies to `snapshot-page.js` and every helper that reads the ARIA tree. The template at `skills/web/templates/snapshot-page.js` is the canonical source — copy it fresh each session; do not hand-write `page.accessibility` calls.

---

### Never inline scripts with `node -e "..."`

Always write scripts to a file and run with `node <file>`. Inline `node -e "..."` with double quotes causes bash to expand `$$` as the current PID — `page.$$eval` becomes `page.12345eval`, breaking the script.

```bash
# WRONG — $$ gets expanded by bash
node -e "const x = page.$$eval(...)"

# CORRECT — write to file first
cat > /tmp/probe.js << 'EOF'
const x = await page.$$eval(...)
EOF
node probe.js
```

The heredoc `<< 'EOF'` (quoted) prevents all variable expansion. Use it for every multi-line script write.

## 9. Bypass Detection — Universal, Dynamic, Never Skip

Before clicking **any non-primary element** inside a wizard, onboarding, setup, or modal context, run the bypass classifier:

### Step 1 — Structural detection
A target is a bypass candidate if ANY of these are true:
- It is styled as a ghost/link/text button (no filled background) while a filled primary CTA exists on the same screen — check via `page.evaluate(el => getComputedStyle(el).backgroundColor)` returning `rgba(0,0,0,0)` or `transparent`
- Its font size is visibly smaller than the primary CTA
- It has no border, no background, and low-contrast text

### Step 2 — Semantic detection
A target is a bypass candidate if its visible text (case-insensitive) matches the pattern:
```
/\b(skip|later|remind|not now|maybe|dismiss|cancel setup|continue without|without (setting|connecting|adding|completing)|do (this )?later|set up later|setup later|i'?ll do this later|skip for now|next time|no thanks|no,? thanks|pass|defer|ignore|close (this|setup|wizard|modal)|finish later)\b/i
```

This regex is **app-agnostic** — it matches semantic bypass intent in plain English regardless of app brand or specific wording.

### Step 3 — Action
- **If neither structural nor semantic signal fires** → click normally.
- **If either signal fires** → DO NOT CLICK. Instead:
  1. Take a screenshot of the current screen
  2. Write `qa/pending-question.md` with:
     - `blocker`: "Bypass button detected: '[button text]'"
     - `evidence`: screenshot path + what was about to be clicked
     - `options`: ["Provide missing value now (specify in chat)", "Click this bypass intentionally (confirm in chat)", "Skip this flow entirely for this run"]
  3. Stop — do not proceed further in this step. Call `AskUserQuestion` with the pending question content.

### Why this is dynamic, not hardcoded
The classifier uses structural signals (visual hierarchy) + a semantic regex (intent patterns) — not literal text from any specific app. A button that says "Configure this later", "We'll do this in a moment", or "Not interested" will be caught by the semantic pattern. A button that has a filled primary peer will be caught by the structural check. New apps with novel phrasing still get caught.

### The one exception
If the user has explicitly answered the pending question with "Click this bypass intentionally" → the agent may click it **once** for that specific step, then the bypass lock resets for the next wizard screen.

## 10. Engagement Protocol — Never Terminate Silently

See `skills/_shared/runtime.md`. Every blocker — missing dep, missing env var, failed login, locked workspace — surfaces to the user with at least two options (fix-and-retry / skip-and-continue). `throw` and `process.exit(1)` in runtime scripts are forbidden; use the file-based `askUser` handshake instead.

## 11. Headless Toggle — Single Pattern

Every Chromium launch in any runtime script uses:

```javascript
const browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' });
```

Default is headless. Set `QA_HEADLESS=false` in `.env.qa` to watch the browser while debugging.

## 12. Token Efficiency

- `qa/platform-fingerprint.md`: write once, re-read on resume. No regeneration.
- `qa/decisions.md`: append only, tail (~10 lines) on resume.
- `qa/classifier-log.jsonl`: append-only outcome trace, tail on resume.
- `qa/state.md`: append per flow; full rewrite only at phase boundaries.
- Runtime helper scripts: kept on disk; never regenerated cosmetically.
- **No Read tool calls on PNG files during discovery** (web platform): DOM/ARIA snapshots are read as JSON — zero image-processing tokens. The only tool calls during Phase 1/2 are file reads on `.snapshot.json` and `.md` files.
- `storageState` cached per role at `qa/.auth/<role>.json` — never re-login per flow.
- **Journey specs are the single test artifact** (web platform): no TC markdown extraction step, no intermediate files. Phase 3 writes directly to `qa/journeys/`; Phase 4 runs them. No deduplication overhead.
