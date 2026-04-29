'use strict';

/** Run `tasks` (array of () => Promise) with at most `limit` in flight. Preserves order. */
async function pMap(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = { __error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Wrap a promise with a timeout. Resolves with `{ timedOut: true }` on expiry. */
function withTimeout(promise, ms, onTimeout) {
  let t;
  const timer = new Promise((resolve) => {
    t = setTimeout(() => {
      if (onTimeout) try { onTimeout(); } catch (_) {}
      resolve({ __timedOut: true });
    }, ms);
  });
  return Promise.race([
    promise.then((v) => { clearTimeout(t); return v; }),
    timer,
  ]);
}

module.exports = { pMap, withTimeout };
