'use strict';

/**
 * Scenario contract — the platform-agnostic shape used by all four layers.
 *
 * @typedef {Object} ScenarioContract
 * @property {string}   id                  Scenario id (e.g. 'S-001-01')
 * @property {string}   role                Project-defined role tag
 * @property {string[]} preconditions       State tags required before invocation
 * @property {string[]} postconditions      State tags guaranteed after success
 * @property {string=}  file                Source file path (relative to qaDir) — used by Layer A checkers
 * @property {string[]=} mutations          Mutation kinds meaningful for this scenario
 * @property {*=}       invoke              Opaque payload — the runner knows how to use this
 * @property {string=}  notes
 */

/** Layer D — postconditions(prev) ⊇ preconditions(next). */
function isCompatible(prev, next) {
  const have = new Set(prev.postconditions || []);
  const missing = (next.preconditions || []).filter((p) => !have.has(p));
  return { ok: missing.length === 0, missing };
}

/** Validate a single contract object. Returns array of error strings (empty = ok). */
function validateContract(c, vocabulary) {
  const errs = [];
  if (!c || typeof c !== 'object') return ['contract is not an object'];
  if (!c.id || typeof c.id !== 'string') errs.push('missing id');
  if (!c.role || typeof c.role !== 'string') errs.push('missing role');
  if (!Array.isArray(c.preconditions)) errs.push('preconditions must be array');
  if (!Array.isArray(c.postconditions)) errs.push('postconditions must be array');
  if (vocabulary) {
    if (vocabulary.roles && c.role && !vocabulary.roles.includes(c.role)) {
      errs.push(`role '${c.role}' not in vocabulary.roles`);
    }
    if (vocabulary.stateTags) {
      const allowed = new Set(vocabulary.stateTags);
      const isAllowed = (t) =>
        allowed.has(t) || vocabulary.stateTagPrefixes?.some((p) => t.startsWith(p));
      for (const t of [...(c.preconditions || []), ...(c.postconditions || [])]) {
        if (!isAllowed(t)) errs.push(`tag '${t}' not in vocabulary`);
      }
    }
  }
  return errs;
}

module.exports = { isCompatible, validateContract };
