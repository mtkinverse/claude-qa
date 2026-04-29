# Web — Update Mode (Step W-13)

Triggered when `HAS_WORKSPACE` is detected (scenario modules or spec files exist). Goal: incrementally update — not redo from scratch.

---

## W-13.1: Read Current State

```bash
cat qa/state.md
cat qa/.qa-config.json
ls qa/flows/*/flow.md 2>/dev/null | wc -l
ls qa/tests/*.spec.ts 2>/dev/null | wc -l
ls qa/journeys/*.spec.ts 2>/dev/null | wc -l
```

Present:

> "Existing workspace for **[AppName]**:
>
> | Field | Value |
> |---|---|
> | Flows | [N] |
> | Standalone specs | [N] in qa/tests/ |
> | Journey specs | [N] in qa/journeys/ |
> | Last run | [date from state.md] |
>
> What would you like to do?
>
> 1) **Re-discover** — re-crawl, find new pages/flows, regenerate affected scenario modules + specs
> 2) **Add flows** — add specific new flows without re-crawling
> 3) **Re-run tests** — re-execute existing specs, fresh report
> 4) **Full refresh** — delete flows, snapshots, modules, specs; restart Phase 1"

---

## W-13.2: Route

- **"1" / re-discover** → delete `qa/crawl-state.json` (force fresh crawl), run [phase1.md](phase1.md) Step W-2 (BFS). Compare new inventory with `ui-inventory.md`. New pages → new flow dirs. Changed flows → regenerate `F-NNN.scenarios.ts`, `qa/tests/F-NNN-*.spec.ts`, update `test.step()` in journeys. Unchanged untouched.

- **"2" / add flows** → ask which. Create `F-NNN-*` dirs. Run Phase 1 trace (DOM/ARIA snapshots) → Phase 2 scenarios → write `F-NNN.scenarios.ts` → write `qa/tests/F-NNN-<slug>.spec.ts` → append `import` + `test.step()` to relevant `J-NNN-<role>.spec.ts`. Add rows to `qa/journey-todo/J-NNN.todo.md`. Existing untouched.

- **"3" / re-run** → jump directly to [phase4.md](phase4.md) Step W-11. Skip discovery/generation.

- **"4" / full refresh** → delete `qa/flows/`, `qa/knowledgebase/`, `qa/tests/`, `qa/journeys/`, `qa/journey-todo/`, `qa/state.md`, `qa/crawl-state.json`. Keep `qa/.qa-config.json` and `qa/context/`. Jump to [phase1.md](phase1.md) Step W-2.
