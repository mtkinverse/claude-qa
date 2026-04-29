---
name: runtime
description: Cross-platform runtime rules — checkpoints, context resets, engagement protocol, token discipline. Loaded by every platform skill.
type: shared
---

# Runtime Rules — How the Agent Behaves Across Resets

This file is the single source of truth for: when to checkpoint, when to reset context, how to engage the user on blockers, and how to spend tokens. Platform skills cite it; they do not duplicate it.

---

## 1. Engagement Protocol — Never Terminate Silently

> **The agent's job is to unblock, not to exit.** When something goes wrong, surface a concrete decision to the user. Halt is allowed only AFTER the user explicitly chooses it.

**Rules:**
1. **No silent `throw`, `exit 1`, `process.exit()` in any runtime script.** They become `askUser({ blocker, evidence, options })`.
2. Every blocker offers **at least two options** — fix-and-retry AND skip-and-continue.
3. **Evidence is mandatory.** Status code, response body excerpt, snapshot path, env var name — never just "login failed".
4. **Front-load engagement.** Preflight, role + flow confirmation, per-role credentials all run BEFORE tracing begins.

**askUser pattern** — runtime scripts can't call `AskUserQuestion` directly, so they file-handshake:

```javascript
function askUser({ blocker, evidence, options }) {
  const q = { blocker, evidence, options, ts: Date.now() };
  require('fs').writeFileSync('qa/pending-question.md',
    '```json\n' + JSON.stringify(q, null, 2) + '\n```\n');
  process.exit(0);  // clean exit; agent picks up
}
```

Agent flow on detecting `qa/pending-question.md`: read → `AskUserQuestion` → write `qa/pending-answer.md` → re-launch script with `--resume-from qa/pending-answer.md` → delete both pending files on success.

**Clean exits are not silent terminations** — the agent guarantees re-engagement.

---

## 2. End-to-End Completion is Mandatory

Once the agent enters a flow (first line appended to `qa/flows/F-NNN-*/manifest.jsonl`), it MUST drive every manifest step to terminal status (`done` / `skipped(reason)` / `blocked(reason)`) before moving on. The manifest — not the user — is the source of truth for "what's left."

- "Asking the user what's remaining" is not a valid terminal action. Consult the manifest.
- Legitimate mid-flow pauses are limited to:
  1. Classifier returns `error-surfaced` / `auth-rejected-server` / `form-reset-silent` / `network-timeout` → `AskUserQuestion` with evidence, then resume.
  2. `consecutiveStalls >= 3` on `no-change` → surface the stall.
  3. User explicitly types `pause` / `stop`.
- After a flow's manifest is fully terminal, **auto-advance to the next `PENDING` flow** in `qa/knowledgebase/journey-inventory.md` without asking.
- Progress logs go to `qa/progress.jsonl` (append-only, ≤150 bytes/line). Resume reads `tail -n 30` — never full-read.

### Deterministic resume sequence

1. Read `qa/state.md` → get **Active flow**.
2. `tail -n 30 qa/progress.jsonl` → confirm last concrete action.
3. `grep -v '"status":"done"' qa/flows/<active>/manifest.jsonl` → first line = next step.
4. If active flow is fully done, pick first `PENDING` in `journey-inventory.md`, write its manifest, begin.
5. Stop only when every flow is terminal or the user interrupts.

---

## 3. Checkpoint Protocol

One global state file: `qa/state.md`. Testing a different app overwrites it.

### When to checkpoint

| Trigger | Weight |
|---|---|
| Step 1 (workspace init) / Step 2 (app selected) | Light |
| After each flow traced in Phase 1 | **Light — pointer block only** |
| **Phase boundary (1→2, 2→3, 3→4, final)** | **Heavy — full state, deferred work runs here** |
| After each flow's TCs written in Phase 2 | Light |
| User says "stop" / "pause" / "save state" | Light |

### Light checkpoint — pointer block only

Overwrite ONLY the `## Active Position` block in `qa/state.md` (≤6 lines):

```markdown
## Active Position
- **Active flow**: F-NNN (<name>)
- **Next step**: first non-done line in `qa/flows/F-NNN-<slug>/manifest.jsonl`
- **Progress log**: `tail -n 30 qa/progress.jsonl`
- **Flows remaining**: F-NNN, F-NNN, … (see `qa/knowledgebase/journey-inventory.md`)
```

Do NOT rewrite the full file for light checkpoints.

### Heavy checkpoint — full state

At phase boundaries or stop/pause, write the full template (App table + Completed checklist + Flows table + Journey Specs Written/Pending + Resume Instructions). Fill every section with real values — no placeholders.

> Resume command (must appear in every heavy checkpoint):
> `Read qa/state.md and continue QA for [AppName]`

**Report generation is deferred** — only at phase boundaries or on explicit user request. Never on every reset.

---

## 4. Context Reset Discipline

**After every completed flow, reset.** Reading snapshots and accumulated tool output fills context fast; by flow 3-4 the session crashes mid-run. Treat each flow as an isolated unit.

### Reset triggers

| Trigger | Action |
|---|---|
| User says "stop" / "pause" / "save state" | STOP handler — write checkpoint FIRST, then announce |
| Each flow fully traced | Light checkpoint, tell user resume command |
| Each flow's TCs written | Light checkpoint, tell user resume command |
| ~15 tool calls accumulated | Proactive light checkpoint |
| Fingerprint or strategy changes | Append to `qa/decisions.md` first |

### STOP / PAUSE / SAVE STATE — Immediate Handler

When user says any of these, **the FIRST and ONLY action is to write the checkpoint**. No other response until the file is written.

1. Write `qa/state.md` (light or heavy depending on position) — capture in-progress work explicitly under "In Progress" so resume picks up at the right point, not from the start of the flow.
2. Then tell the user:

> "✅ Checkpoint saved to `qa/state.md` — [summary table].
> Type `/clear` to reset context, then paste:
> `Read qa/state.md and continue QA for [AppName]`"

**Do NOT generate the QA report on stop/reset.** Only at phase boundaries or on explicit request.

### How to reset after a flow

After writing `flow.md` and the discovery evidence table:
1. Append to `qa/state.md` (pointer block only) — mark this flow done, list next pending.
2. Tell the user the flow is complete and how to continue.
3. If user says "continue" — proceed immediately. Recommend a fresh context every 2-3 flows; don't force it.

Keep resets lightweight. No coverage checks, no report generation, no inventory updates mid-session — those are phase-boundary work.

### The state file is the memory

Every reset works because `qa/state.md` contains everything needed to resume: flows done (with snapshot paths + key observations), flows pending (with names + priority + auth requirement), exact resume command, app quirks, credentials status. A fresh context reading `qa/state.md` has full situational awareness.

> ⚠️ **Never write credential values into `qa/state.md`.** Record only whether credentials are present (e.g. `credentials: set via .env.qa`) — never echo email addresses, passwords, tokens, or API keys. Credentials live exclusively in `.env.qa` and `qa/.auth/`.

---

## 5. Token Discipline

Reading PNGs and re-parsing flow.md tables is the largest token sink in this skill. Rules:

- **Web discovery never reads PNGs.** Use `snapshotPage()` (DOM/ARIA JSON). Inline-Read screenshots only on `error-surfaced` / `auth-rejected-server` / `form-reset-silent` / `modal-opened` / `network-timeout` / terminal labels, plus ≤3 representative shots per flow boundary.
- **Replace re-parsing with append-only logs.** `qa/classifier-log.jsonl` (≤120 bytes/entry) and `qa/progress.jsonl` (≤150 bytes/entry) are the truth. `tail -n 30` is the only access pattern.
- **`storageState` per role** prevents re-login per flow. Cache to `qa/.auth/<role>.json`.
- **Manifest-first tracing** — the per-flow `manifest.jsonl` is the planned-step checklist; resume `grep`s for non-done lines instead of re-reading prose.
- **Strategy artefacts auto-save after every page** (`qa/crawl-state.json` for BFS, `qa/trace-state.json` for targeted-trace, etc.) so mid-strategy resume is free.

---

## 6. Navigation Discipline — Click, Don't Goto

Once the seed URL is loaded, **traverse the app by clicking its own nav elements** — not by calling `page.goto(arbitrary-url)`. Direct URL insertion bypasses the app's router, skips client-side guards, and produces journeys a real user cannot reproduce.

`page.goto` is reserved for: (a) initial seed URL, (b) explicit resume-from-route on re-entry, (c) URLs observed in `sitemap.xml` when sitemap-spot-check is active. Every other hop is a click.

---

## 7. Browser Launch — Shared Pattern

Every Chromium launch respects `QA_HEADLESS`:

```javascript
const browser = await chromium.launch({
  headless: process.env.QA_HEADLESS !== 'false'
});
```

Default headless; set `QA_HEADLESS=false` in `.env.qa` to watch the browser.

---

## 8. Hard-exit sites that MUST be replaced with `askUser`

| Site | Old | New |
|---|---|---|
| Root SKILL `qa/` cleanup failure | `exit 1` | "(a) identify locking process, (b) rename to qa-old, (c) halt" |
| Web SKILL `.env.qa` missing | `throw` | warning at config time; preflight handles it |
| Web SKILL `QA_APP_URL` missing | `throw` | warning; preflight prompts |
| Classifier error in any runtime script | crash | log + return `no-change` + continue |
| Mid-flow idle after engagement answer | wait for "continue" | re-enter manifest loop from first non-`done` line |

## Compliance

Strategy files, helper scripts, and platform skills MUST cite this document. PRs introducing a new `throw`/`exit` without a paired `askUser` are rejected.
