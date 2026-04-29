'use strict';

/**
 * Example runner — pure stub showing the contract.
 *
 * Replace with a real runner that invokes your test framework. The pipeline does
 * not care HOW you run; it only needs `{ status, durationMs?, message? }`.
 *
 * mode.kind === 'smoke'   → run scenario in isolation, expect pass
 * mode.kind === 'mutation' → run scenario with mode.mutation injected; expect FAIL
 *
 * For a Playwright-based platform, a typical real runner would shell out to:
 *   npx playwright test <scenario.invoke.spec> -g "<scenario.id>" --workers=1
 * with env vars or CLI flags encoding the mutation.
 */

module.exports = {
  async run(scenario, mode) {
    const t0 = Date.now();
    // Stub logic: smoke passes, mutations always "fail" (i.e., scenario is non-vacuous).
    if (mode.kind === 'smoke') {
      return { status: 'pass', durationMs: Date.now() - t0 };
    }
    return { status: 'fail', durationMs: Date.now() - t0, message: `mutation ${mode.mutation} simulated` };
  },
};
