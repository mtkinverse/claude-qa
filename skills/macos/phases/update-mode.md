# macOS — Update Mode (Step 11)

Triggered when `HAS_WORKSPACE` is detected in root SKILL.md Step 0.2.

```bash
cat qa/.qa-config.json
ls qa/flows/ 2>/dev/null | wc -l
find qa -name "TC-*.md" 2>/dev/null | wc -l
```

> "Found existing QA workspace for **[AppName]**:
> - Flows: [N] | Test cases: [N] | Last discovery: [date]
>
> 1. **Re-discover** — relaunch, new screenshots, detect UI changes
> 2. **Add flow** — add coverage for a new feature
> 3. **Add scenarios** — extend an existing flow
> 4. **Full refresh** — regenerate everything
> 5. **Generate full coverage (Phase 2)** — exploration done; write all TCs now"

## Routes

- **Option 1 (Re-Discover)** → re-run [phase1.md](phase1.md) Steps 5–6, compare new `ui-inventory.json` to existing, report changes, update only affected files.
- **Option 2 (Add Flow)** → ask which feature → targeted discovery → new `F-NNN-[slug]/` → scenarios + TCs → update `scope/contract.md`.
- **Option 3 (Add Scenarios)** → ask which flow → show existing `scenarios.md` → generate additional scenarios for uncovered categories → new TC files.
- **Option 4 (Full Refresh)** → confirm, restart from [phase1.md](phase1.md) Step 5.
- **Option 5 (Phase 2)** →
  1. Read Phase 1 auth screenshots → identify required fields
  2. Read `qa/state.md` for all flows + auth status
  3. [phase2.md](phase2.md) Step 8.0 (credentials)
  4. Step 8.1–8.2 (scenarios)
  5. [phase3.md](phase3.md) Step 9 (TCs)
  6. [phase4.md](phase4.md) Step 10 (final checkpoint)
