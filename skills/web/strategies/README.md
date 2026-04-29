---
name: web-strategies-index
description: BFS is the single web exploration strategy. Other files in this directory are helpers BFS calls on demand.
type: reference
platform: web
---

# Web Exploration — One Strategy, Plus Helpers

> ⛔ **There is one exploration strategy: BFS.** Everything else in this directory is a helper that BFS calls on demand. There is no strategy-selection step — Phase 1 always runs BFS.

This collapse exists because picking between peer strategies was a recurring failure mode: Phase 1 would pick `targeted-trace`, walk the linear path, and exit with 15 URLs covered while the post-login surface sat unexplored. BFS, with the helpers below, handles every app shape.

---

## Files in this directory

| File | Role | Invoked when |
|---|---|---|
| [bfs.md](bfs.md) | **The strategy.** Breadth-first crawl driven by frontier closure (URLs + interactions + states). | Always — runs from Phase 1 start. |
| [targeted-trace.md](targeted-trace.md) | **`auth-bootstrap` helper.** Drives a scripted persona path past sign-up / onboarding walls and returns `storageState`. | BFS hits a credential / onboarding gate it cannot traverse autonomously. |
| [sitemap-spot-check.md](sitemap-spot-check.md) | **Content-sweep helper.** Reads `/sitemap.xml`, samples N URLs per template group. | BFS detects a content/CMS surface (same fingerprint > 30% of pages) where breadth crawling adds no signal. |

The historical `name` field in `targeted-trace.md` may still read `web-strategy-targeted-trace` — that's now a helper id, not a peer-strategy declaration. The semantics have changed; the filename is preserved only to avoid breaking references in `bfs.md`, `trace-recorder.js`, and existing workspaces.

---

## Selection — there is no selection

Phase 1 starts BFS. BFS calls `auth-bootstrap` when it needs to log in. BFS calls `sitemap-spot-check` when discovery is repetitive. Phase 1 cannot exit until the BFS frontier is closed (see `scripts/frontier-gate.js`).

Do **not** write `## Strategy chosen` entries in `qa/decisions.md`. Log helper invocations instead:

```markdown
## YYYY-MM-DD HH:MM — auth-bootstrap invoked
**Trigger**: BFS encountered sign-up form at /account
**Result**: storageState saved to qa/.auth/user.json; BFS resumed at /dashboard
```

---

## When to deviate

You may write a **custom** runtime script if the app shape is genuinely outside the helper set. Document it in `qa/decisions.md` with rationale and the frontier-closure check it satisfies. The frontier gate (`scripts/frontier-gate.js`) is the contract — any custom script must produce a frontier the gate accepts.

---

## Switching helpers mid-run

There is no "strategy switch." BFS is the strategy; helpers are called as needed. If `auth-bootstrap` stalls (3 consecutive no-change steps), it returns control to BFS with `gate-unresolved=true` and BFS records the gate as a `⛔ skipped` URL with a 3-strike retry log.

**The flow never breaks.** A stall in a helper means BFS records and continues, not that exploration stops.
