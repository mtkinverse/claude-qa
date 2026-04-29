'use strict';

const { isCompatible } = require('../contract');

/**
 * Layer D — contract compatibility.
 * For each journey, walk adjacent step pairs and check postcond ⊇ precond.
 *
 * journeys: [{ id, steps: [scenarioId, ...] }]
 * Returns: { incompatibleScenarioIds: Set<string>, blockedJourneys: [{id, gaps:[{from,to,missing}]}] }
 */
function runContractCheck({ scenarios, journeys, log }) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const incompatible = new Set();
  const blocked = [];
  for (const j of journeys || []) {
    const gaps = [];
    for (let i = 0; i < j.steps.length - 1; i++) {
      const prev = byId.get(j.steps[i]);
      const next = byId.get(j.steps[i + 1]);
      if (!prev || !next) {
        gaps.push({ from: j.steps[i], to: j.steps[i + 1], missing: ['<unknown scenario id>'] });
        if (!prev) incompatible.add(j.steps[i]);
        if (!next) incompatible.add(j.steps[i + 1]);
        continue;
      }
      const r = isCompatible(prev, next);
      if (!r.ok) {
        gaps.push({ from: prev.id, to: next.id, missing: r.missing });
        incompatible.add(next.id);
      }
    }
    if (gaps.length) blocked.push({ id: j.id, gaps });
  }
  log?.(`[contract] ${journeys?.length || 0} journey(s), ${blocked.length} blocked`);
  return { incompatibleScenarioIds: incompatible, blockedJourneys: blocked };
}

module.exports = { runContractCheck };
