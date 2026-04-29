'use strict';

/**
 * Layer A — static gate.
 * Runs every registered checker. Aggregates issues, classifies per-scenario.
 *
 * Issue shape: { scenarioId?, file?, severity:'error'|'warn', message, checker? }
 * Returns: { issues, failedScenarioIds: Set<string> }
 */
async function runStatic({ qaDir, scenarios, checkers, log }) {
  const issues = [];
  for (const c of checkers) {
    log?.(`[static] running checker: ${c.name}`);
    try {
      const out = await c.check({ qaDir, scenarios });
      for (const i of out || []) issues.push({ checker: c.name, severity: i.severity || 'error', ...i });
    } catch (e) {
      issues.push({ checker: c.name, severity: 'error', message: `checker threw: ${e.message}` });
    }
  }
  const failedScenarioIds = new Set(
    issues.filter((i) => i.severity === 'error' && i.scenarioId).map((i) => i.scenarioId),
  );
  return { issues, failedScenarioIds };
}

module.exports = { runStatic };
