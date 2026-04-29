# Wiring the verification pipeline into a project

The pipeline under `skills/_shared/verification/` is platform-agnostic. To use it on a real project, the project provides three things and nothing else:

## 1. `qa/contracts.json` — scenario contracts

Array of `{ id, role, preconditions[], postconditions[], file?, mutations?, invoke? }`.
The `invoke` field is opaque — only your runner reads it.

## 2. `qa/.verify.json` — config

Points at your runner module and any checker modules. See `examples/verify.config.json`. Paths are resolved relative to `qa/`.

## 3. A runner module

A single file exporting `async run(scenario, mode)`:

```js
module.exports = {
  async run(scenario, mode) {
    if (mode.kind === 'smoke') {
      // invoke the scenario in isolation on your platform
      return { status: 'pass' | 'fail' | 'error', durationMs, message };
    }
    if (mode.kind === 'mutation') {
      // invoke with mode.mutation injected (e.g. clear cookies for 'unauth')
      // expectation: scenario should FAIL
      return { status: 'pass' | 'fail' | 'error', durationMs, message };
    }
  },
};
```

The pipeline does not import your test framework, does not know what a browser is, does not know what a file extension is. Your runner makes those choices.

## (Optional) Checker modules

`async check({ qaDir, scenarios }) → Issue[]`. Each issue is `{ scenarioId?, file?, severity, message }`. The pipeline runs every registered checker and aggregates.

## Invocation

```
node skills/_shared/verification/cli.js --qa-dir ./qa
node skills/_shared/verification/cli.js --qa-dir ./qa --layers A,D
```

Outputs land at `qa/runs/<ts>/verify.json` and `summary.md`.

## Per-layer notes

- **Layer A (static)** runs all checkers + validates contracts against the optional vocabulary in config. Scenarios with errors are skipped from B/C.
- **Layer B (smoke)** calls runner with `{ kind: 'smoke' }`, bounded by `smoke.timeoutMs`, parallelism `smoke.concurrency`. A scenario must self-seed its preconditions; the runner is responsible for translating that.
- **Layer C (mutation)** calls runner with `{ kind: 'mutation', mutation }` for each enabled kind. A `pass` here means the test was vacuous. Cached by hash of `(contract + file content + mutation)` under `mutation.cacheDir` so repeat runs are free.
- **Layer D (contract)** is pure data — needs no runner. Reads `qa/journeys.json` and validates every adjacent step pair.

## Statuses written to `verify.json`

`pass | static-fail | smoke-fail | vacuous | contract-incompatible | skipped`
