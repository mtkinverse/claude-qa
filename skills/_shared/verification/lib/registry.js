'use strict';

const path = require('path');
const fs = require('fs');

/** Resolve a module path relative to qaDir. Supports absolute paths and `./relative` forms. */
function resolveModule(qaDir, spec) {
  if (!spec) return null;
  if (path.isAbsolute(spec)) return spec;
  return path.resolve(qaDir, spec);
}

function loadRunner(qaDir, spec) {
  const p = resolveModule(qaDir, spec);
  if (!p) return null;
  if (!fs.existsSync(p)) throw new Error(`runner not found: ${p}`);
  const mod = require(p);
  if (typeof mod.run !== 'function') throw new Error(`runner ${p} must export async run(scenario, mode)`);
  return mod;
}

function loadCheckers(qaDir, specs) {
  const out = [];
  for (const s of specs || []) {
    const p = resolveModule(qaDir, s);
    if (!fs.existsSync(p)) throw new Error(`checker not found: ${p}`);
    const mod = require(p);
    if (typeof mod.check !== 'function') throw new Error(`checker ${p} must export async check(ctx)`);
    out.push({ name: mod.name || path.basename(p), check: mod.check });
  }
  return out;
}

module.exports = { loadRunner, loadCheckers, resolveModule };
