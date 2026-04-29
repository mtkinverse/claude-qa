# Verification Pipeline (platform-agnostic)

Generic four-layer verification engine for auto-generated scenarios. Knows nothing about Playwright, AppleScript, XCUITest, or any specific test runner. Platforms plug in **runners** and **checkers** via config.

## The four layers

| Layer | What it does | Cost | Catches |
|------|--------------|------|---------|
| A — Static | Runs registered checkers over scenario files | Seconds | Syntactic / structural failures |
| B — Smoke | Runs each scenario in isolation with concurrency | Minutes | Per-step correctness |
| C — Mutation | Runs each scenario with a deliberately broken precondition | Minutes (cached) | Vacuous-green tests |
| D — Contract | Walks planned journey step pairs, checks postcond ⊇ precond | <1s | Incompatible step composition |

Layer A + D are pure data — zero runtime cost. Only B and C need the platform runner.

## Concepts

**Scenario** — `{ id, role, preconditions[], postconditions[], file?, mutations?, invoke? }`. The `invoke` field is opaque to the pipeline; the runner uses it to know how to execute the scenario on its platform.

**Runner** — a module exporting `async run(scenario, mode)`. `mode` is either `{ kind: 'smoke' }` or `{ kind: 'mutation', mutation: 'unauth' | 'wrong-role' | 'wrong-url' | <custom> }`. Returns `{ status: 'pass' | 'fail' | 'error', durationMs, message? }`.

**Checker** — a module exporting `name` and `async check({ qaDir, scenarios })`. Returns an array of issues.

**Vocabulary** — roles and state-tag strings are project-defined in the config. No hardcoded enum.

## Config

The pipeline reads `qa/.verify.json` (path overridable). See `examples/verify.config.json`.

```json
{
  "scenarios": "contracts.json",
  "checkers": [],
  "runner": null,
  "smoke":    { "concurrency": 8, "timeoutMs": 30000 },
  "mutation": { "enabled": true, "kinds": ["unauth", "wrong-role", "wrong-url"], "cacheDir": ".cache/mutation" },
  "journeys": "journeys.json",
  "output":   { "runsDir": "runs" }
}
```

`runner` and `checkers` are paths resolved relative to the qa directory. If `runner` is null, layers B and C are skipped (useful for contract-only verification).

## Running

```
node skills/_shared/verification/cli.js --qa-dir ./qa
node skills/_shared/verification/cli.js --qa-dir ./qa --layers A,D     # subset
```

Outputs:
- `qa/runs/<ts>/verify.json` — per-scenario status (`pass | static-fail | smoke-fail | vacuous | contract-incompatible`)
- `qa/runs/<ts>/summary.md` — grouped, human-readable

## Inputs

- `qa/contracts.json` (path configurable) — array of scenario contracts
- `qa/journeys.json` (optional) — array of `{ id, steps: [scenarioId, ...] }` for layer D
