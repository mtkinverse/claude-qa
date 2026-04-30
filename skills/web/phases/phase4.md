# Web — Phase 4: Test Execution & Reporting

**Goal**: Run the suite and generate the final report.
**Input**: `qa/tests/F-NNN-*.spec.ts` (standalone) + `qa/journeys/J-NNN-*.spec.ts` (E2E).
**Output**: pass/fail per flow/journey + unified HTML report.
**No test writing in this phase** — execution only.

Runtime rules — see `skills/_shared/runtime.md`.

---

## Step W-11: Execution with Run-State Tracking

Before running, update each `qa/journey-todo/J-NNN.todo.md` — mark all steps `⬜ pending`.

Write `qa/run-state.md` (≤30 lines):

```markdown
# Run State — [AppName] [YYYY-MM-DD HH:MM]
> Resume: re-trigger `/native-qa` → option 1, or `node qa/run.js`

| Suite | Type | Tests | Status | Failure |
|-------|------|-------|--------|---------|
| J-000-anonymous | E2E journey | [N] | ⬜ pending | — |
| J-001-free | E2E journey | [N] | ⬜ pending | — |
| F-001-standalone | Standalone | [N] | ⬜ pending | — |
```

For each journey row in order:
1. Update row → `⏳ running`; mark journey-todo steps `⏳ running`.
2. Run:
   ```bash
   cd qa && node ./node_modules/playwright/cli.js test journeys/J-NNN-*.spec.ts \
     --config playwright.config.ts --reporter=line --continue-on-failure
   ```
3. Parse exit code + first failure step from stdout.
4. Update row → `✅ done` or `❌ failed([step name]: [first-failure])`.
5. Update journey-todo step statuses to `✅ done` / `❌ failed(...)` from output.

**Resume from partial failure**: re-trigger reads `qa/run-state.md`, skips `✅ done` rows, continues from first non-done.

After all journey rows terminal, run standalone:
```bash
cd qa && node ./node_modules/playwright/cli.js test tests/ \
  --config playwright.config.ts --reporter=line --continue-on-failure
```

After all rows terminal:
- Generate report: `node scripts/allure/generate-report.js --open`
- Append to `qa/run-state.md`: `Result: N/M journeys passed. Failed: J-NNN. Report: qa/playwright-report/index.html`

---

## Step W-12: Final Report

```bash
node scripts/allure/generate-report.js --open
```

After Phase 4 test run completes, generate the final session report:
```bash
node scripts/allure/generate-report.js --phase 4 --open
```

Tell the user:

> "✅ All 4 phases complete. [N] flows, [N] scenarios, [N] passed / [N] failed. Report opened."

### Share the suite

```bash
zip -r qa-suite.zip qa/flows/**/F-NNN.scenarios.ts qa/tests/ qa/journeys/ qa/journey-todo/ \
  qa/run.js qa/package.json qa/playwright.config.ts qa/.env.example
```

Recipient: `unzip qa-suite.zip && cp .env.example .env.qa` (fill URL + creds) → `node run.js`.
