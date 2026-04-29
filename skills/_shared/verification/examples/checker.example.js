'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Example checker — flags scenario files with no expect/assert call and any
 * function with an early `return` before its first assertion (vacuous-green pattern).
 *
 * Adapt the regexes per language/framework. The pipeline is regex-agnostic; it just
 * receives the issues you emit.
 */

module.exports = {
  name: 'no-empty-assertion',
  async check({ qaDir, scenarios }) {
    const issues = [];
    for (const s of scenarios) {
      if (!s.file) continue;
      const abs = path.resolve(qaDir, s.file);
      if (!fs.existsSync(abs)) {
        issues.push({ scenarioId: s.id, file: s.file, severity: 'error', message: 'scenario file missing' });
        continue;
      }
      const src = fs.readFileSync(abs, 'utf8');
      if (!/\b(expect|assert)\s*\(/.test(src)) {
        issues.push({ scenarioId: s.id, file: s.file, severity: 'error', message: 'no expect/assert call found' });
      }
    }
    return issues;
  },
};
