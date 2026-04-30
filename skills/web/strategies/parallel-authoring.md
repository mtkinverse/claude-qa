# Parallel flow authoring

## Scope

**Per-flow authoring concurrency**: multiple flows discovered and traced simultaneously using separate Playwright browser contexts. This is the authoring-time contract.

This is distinct from **Phase 4 runtime parallelism**, which remains OFF (`fullyParallel: false` in `playwright.config.ts`) because journeys share session state.

## Invariants

1. **Per-flow workdir**: each flow gets `qa/flows/F-NNN-<slug>/` — manifest, trace, flow.md, scenarios never share a path.
2. **Per-flow storageState**: on parallel start, copy `qa/.auth/user.json` → `qa/.auth/F-NNN.json`. Each context loads its own copy. Merge back at end (keep newer timestamps per cookie key).
3. **File-locking on shared globals** — use `scripts/lib/file-lock.js` → `appendWithLock(path, content)`. Never raw `appendFileSync` on:
   - `qa/knowledgebase/uig.jsonl`
   - `qa/knowledgebase/crawl-todo.md`
   - `qa/knowledgebase/interactions-state.json`
   - `qa/decisions.md`
4. **Mutex flows** — never run in parallel, always scheduled last:
   - sign-out
   - delete-account
   - plan-change
   - billing-mutation
   Declare in `qa/parallel-policy.yml` at session start.

## Long-flow handoff protocol

When a flow stalls on a long-running event (provisioning, email verification, OAuth) with estimated wait > 5 minutes:

1. Write `qa/handoff.json`:
   ```json
   {
     "flow_id": "F-NNN",
     "blocker": "provisioning",
     "est_resume_at_iso": "2026-04-30T14:32:00Z",
     "parallel_flows_running": ["F-001", "F-003"],
     "last_step_cursor": 4,
     "observation_url": "https://app.example.com/dashboard"
   }
   ```
2. Continue any non-mutex flows in the interaction queue.
3. When only awaiting flows remain, terminate with:
   ```
   ⏳ Resume after <est_resume_at_iso>. Flow <flow_id> is blocked on <blocker>.
   Re-run /native-qa to continue from the handoff point.
   ```

## Per-flow synthetic email

For flows that create accounts or mutate account state:
```
<BASE_EMAIL_LOCAL>+<flow_id>@<BASE_EMAIL_DOMAIN>
```
Example: `qa+F001@example.com`. Declare the pattern in `qa/parallel-policy.yml`.
