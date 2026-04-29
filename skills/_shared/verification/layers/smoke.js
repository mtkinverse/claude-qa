'use strict';

const { pMap, withTimeout } = require('../lib/concurrency');

/**
 * Layer B — parallel isolated smoke run.
 * Calls runner.run(scenario, { kind: 'smoke' }) with `concurrency` in flight.
 * Bounds each call to `timeoutMs`.
 *
 * Returns: { results: Map<scenarioId, { status, durationMs, message? }> }
 */
async function runSmoke({ scenarios, runner, concurrency, timeoutMs, skipIds, log }) {
  const targets = scenarios.filter((s) => !skipIds || !skipIds.has(s.id));
  log?.(`[smoke] ${targets.length} scenario(s), concurrency=${concurrency}`);

  const tasks = targets.map((s) => async () => {
    const t0 = Date.now();
    const res = await withTimeout(
      Promise.resolve().then(() => runner.run(s, { kind: 'smoke' })),
      timeoutMs,
    );
    const durationMs = Date.now() - t0;
    if (res && res.__timedOut) {
      return { id: s.id, status: 'error', durationMs, message: `timeout after ${timeoutMs}ms` };
    }
    return {
      id: s.id,
      status: res?.status || 'error',
      durationMs: res?.durationMs ?? durationMs,
      message: res?.message,
    };
  });

  const out = await pMap(tasks, concurrency);
  const results = new Map();
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r && r.__error) {
      results.set(targets[i].id, { status: 'error', durationMs: 0, message: String(r.__error.message || r.__error) });
    } else {
      results.set(r.id, { status: r.status, durationMs: r.durationMs, message: r.message });
    }
  }
  return { results };
}

module.exports = { runSmoke };
