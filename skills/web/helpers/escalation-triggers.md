---
name: web-helper-escalation-triggers
description: Numeric thresholds that fire BFS helpers (auth-bootstrap, sitemap-spot-check, wiggle-pass, credential-fanout, modal-sweep, standard-route-probe). Replaces subjective fallback language ("richer than expected", "if dashboard nav is rich") with measurable rules.
type: helper
platform: web
---

# Escalation Triggers — Measurable Helper Invocation Rules

> ⛔ **No subjective triggers.** Every helper fires on a numeric or boolean condition that the runtime can evaluate from current workspace state (snapshots, UIG, crawl-todo, decisions). Phrases like *"if the dashboard is richer than expected"* or *"when nav is unexpectedly broad"* are banned — agents do not reliably interpret them.

This file is the single source of truth for when BFS hands off to a helper. Helpers themselves declare their stall signals; this file declares their *invocation* triggers.

---

## Trigger Matrix

| # | Trigger condition (evaluated per BFS tick) | Helper to invoke | Source of values |
|---|---|---|---|
| 1 | `current_url` matches `/(login|signin|signup|register|account|onboarding)/i` AND no valid `qa/.auth/<role>.json` for the active role | `auth-bootstrap` | `page.url()` + `fs.existsSync(storageStatePath)` |
| 2 | `≥ 1` disabled interactable on critical path observed in snapshot | `wiggle-pass` | `snapshot.buttons.filter(b => b.disabled && b.visible).length` |
| 3 | `current_url` not auth-page AND `≥ 1` input field on page matches a credential type in the index | `credential-fanout` | `fanout.matchType` count > 0 |
| 4 | Same `nav.fingerprint` observed on `> 30%` of `state.pageCount` pages AND `state.pageCount ≥ 10` | `sitemap-spot-check` | `state.fingerprints` map duplicate ratio |
| 5 | Page contains `≥ 1` modal-trigger button (UIG `role=button` with name matching `/open|add|create|new|edit|configure|connect|invite|generate/i`) AND `0` modal-submission events recorded for this page in `trace.jsonl` | `modal-sweep` (run actuate-and-observe on modal triggers per `principles.md` §5b) | UIG + trace.jsonl scan |
| 6 | BFS queue empty AND `state.pageCount < 10` AND no decisions.md entry justifies small surface | `standard-route-probe` (deprecated — see note below) | `state.queue.length === 0` |
| 7 | Sidebar/nav region shows `≥ 3` items AND `< 50%` of those items have been added to `crawl-todo.md` as ✅ or ⛔ | Force BFS to enqueue all sidebar item URLs from snapshot before returning to outer loop | `dom.links` filtered by `scope ∈ {nav, header}` |
| 8 | `consecutiveStalls ≥ 3` in any flow | Switch path: BFS triggers strike-1 protocol; auth-bootstrap returns `gate-unresolved` | flow-local counter |
| 9 | Page error or nav failure (404 / soft-404 / timeout) | 3-strike skip protocol (`bfs.md` C1) | `isErrorPage(page)` |
| 10 | UIG row count grew by 0 across 5 consecutive snapshots | Same fingerprint stall — invoke `sitemap-spot-check` (same as #4 with stricter ratio) | UIG growth delta |

---

## Note on #6 — `standard-route-probe`

The earlier plan included a guess-list of common routes (`/settings`, `/billing`, `/profile`, …). That list is **deprecated** in favor of multi-source URL harvesting (`snapshot-page.js` source 2–5: onClick scan, router-config harvest, pushState interception, sitemap fetch). The harvest finds the routes the app actually exposes; guessing is unprincipled. Trigger #6 remains as a fallback for sites with truly hostile JS (heavily obfuscated bundles where the harvest finds nothing) — but it should rarely fire if harvesting is implemented correctly.

If you do reach #6, the fallback list is:
```
['/settings', '/profile', '/account', '/billing', '/subscription',
 '/integrations', '/api', '/logout', '/help', '/support', '/admin',
 '/docs', '/security', '/notifications']
```
Each is `page.goto`'d once. Status ∈ {200, 3xx-to-known-page} → add to BFS frontier. 404 → record skip with reason `"standard-route-probe: 404"`.

---

## Implementation — single check function

```javascript
// qa/scripts/escalation-triggers.js
function evaluateTriggers(state, page, snapshot, opts = {}) {
  const triggers = [];

  // 1. Auth wall
  if (/\/(login|signin|signup|register|account|onboarding)/i.test(page.url())) {
    const authPath = `qa/.auth/${opts.role || 'user'}.json`;
    if (!require('fs').existsSync(authPath)) triggers.push('auth-bootstrap');
  }

  // 2. Disabled controls on critical path
  if ((snapshot.buttons || []).some(b => b.disabled && b.visible && b.name)) {
    triggers.push('wiggle-pass');
  }

  // 3. Credential-fanout fields present (non-auth pages)
  if (!/\/(login|signin|signup|register|account)/i.test(page.url())) {
    const { matchType, buildIndex } = require('./credential-fanout');
    const idx = opts.credIndex || buildIndex(process.env);
    const fields = [...(snapshot.inputs || []), ...(snapshot.comboboxes || [])];
    if (fields.some(f => f.visible && !f.disabled && matchType(f, idx))) {
      triggers.push('credential-fanout');
    }
  }

  // 4. Fingerprint repetition
  if (state.pageCount >= 10) {
    const counts = new Map();
    for (const fp of state.fingerprints.values()) counts.set(fp, (counts.get(fp) || 0) + 1);
    const maxRep = Math.max(...counts.values(), 0);
    if (maxRep / state.pageCount > 0.30) triggers.push('sitemap-spot-check');
  }

  // 5. Modal triggers without submissions
  const modalTriggerRe = /open|add|create|new|edit|configure|connect|invite|generate/i;
  const modalTriggers = (snapshot.buttons || []).filter(b => b.visible && !b.disabled && modalTriggerRe.test(b.name || ''));
  if (modalTriggers.length > 0) {
    // Check trace.jsonl for submissions on this page
    const traceFile = `qa/flows/${opts.flowId || 'seed-crawl'}/trace.jsonl`;
    let submissions = 0;
    try {
      const trace = require('fs').readFileSync(traceFile, 'utf8').split('\n').filter(Boolean);
      submissions = trace.filter(l => {
        try {
          const r = JSON.parse(l);
          return r.evidence?.url === page.url() && /modal-submitted|submit-success|submit-error/.test(r.outcome || '');
        } catch { return false; }
      }).length;
    } catch {}
    if (submissions === 0) triggers.push('modal-sweep');
  }

  // 7. Sidebar coverage
  const navLinks = (snapshot.links || []).filter(l => /\bnav|header/.test(l.scope || ''));
  if (navLinks.length >= 3) {
    const visited = navLinks.filter(l => state.visited.has(l.href)).length;
    if (visited / navLinks.length < 0.5) triggers.push('enqueue-nav-links');
  }

  return triggers;
}

module.exports = { evaluateTriggers };
```

BFS calls `evaluateTriggers(state, page, snapshot)` after each `snapshotPage()`. Each returned trigger name maps to a helper invocation. Triggers fire independently and may stack (e.g. a page can trigger both `wiggle-pass` and `credential-fanout` in the same tick).

---

## What this file replaces

The old language in `targeted-trace.md` ("BFS if dashboard nav is richer than expected"), `bfs.md` ("acceptable — by design"), and `strategies/README.md` ("when fingerprint says Q3=Dashboard") is replaced by these numeric triggers. There is no subjective strategy switch — there are measurable conditions that fire helpers, and the BFS frontier closes when no triggers are firing and `crawl-todo.md` is drained.
