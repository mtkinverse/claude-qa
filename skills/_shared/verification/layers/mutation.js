'use strict';

const fs = require('fs');
const path = require('path');
const { pMap, withTimeout } = require('../lib/concurrency');
const { hashOf, readCached, writeCached } = require('../lib/cache');

/**
 * Layer C — mutation sanity.
 * For each scenario, run with each enabled mutation kind. The expectation is FAILURE.
 * If the runner returns 'pass' under a mutation → scenario is vacuous.
 *
 * Cached by hash(scenario contract + source file content + mutation kind).
 *
 * Returns: { vacuousIds: Set<string>, details: Map<id, [{mutation, status}]> }
 */
async function runMutation({ qaDir, scenarios, runner, kinds, cacheDir, concurrency, timeoutMs, skipIds, log }) {
  const targets = scenarios.filter((s) => !skipIds || !skipIds.has(s.id));
  const details = new Map();
  const vacuous = new Set();
  const absCacheDir = path.resolve(qaDir, cacheDir);

  const probes = [];
  for (const s of targets) {
    const applicable = (s.mutations && s.mutations.length ? s.mutations : kinds).filter((k) => kinds.includes(k));
    if (!applicable.length) continue;
    const fileContent = s.file && fs.existsSync(path.resolve(qaDir, s.file))
      ? fs.readFileSync(path.resolve(qaDir, s.file), 'utf8')
      : '';
    for (const mutation of applicable) {
      probes.push({ s, mutation, key: hashOf([s.id, s.role, s.preconditions, s.postconditions, fileContent, mutation]) });
    }
  }
  log?.(`[mutation] ${probes.length} probe(s) across ${targets.length} scenario(s)`);

  const tasks = probes.map((p) => async () => {
    const cached = readCached(absCacheDir, p.key);
    if (cached) return { ...p, ...cached, cached: true };
    const t0 = Date.now();
    const res = await withTimeout(
      Promise.resolve().then(() => runner.run(p.s, { kind: 'mutation', mutation: p.mutation })),
      timeoutMs,
    );
    const durationMs = Date.now() - t0;
    const status = res?.__timedOut ? 'error' : (res?.status || 'error');
    const message = res?.__timedOut ? `timeout after ${timeoutMs}ms` : res?.message;
    const out = { status, durationMs, message };
    writeCached(absCacheDir, p.key, out);
    return { ...p, ...out, cached: false };
  });

  const out = await pMap(tasks, concurrency);
  for (const r of out) {
    if (r && r.__error) continue;
    const arr = details.get(r.s.id) || [];
    arr.push({ mutation: r.mutation, status: r.status, message: r.message, cached: r.cached });
    details.set(r.s.id, arr);
    // Vacuous = the broken-precondition probe still passed
    if (r.status === 'pass') vacuous.add(r.s.id);
  }
  return { vacuousIds: vacuous, details };
}

module.exports = { runMutation };
