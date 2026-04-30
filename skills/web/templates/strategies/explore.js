/**
 * explore.js — strategy dispatcher
 * Copy to qa/scripts/explore.js at W-2.4.
 * Require()s the chosen strategy helper.
 * Usage: QA_STRATEGY=bfs node qa/scripts/explore.js
 */
'use strict';

const strategy = process.env.QA_STRATEGY || 'bfs';
const allowed  = ['bfs', 'targeted-trace', 'sitemap-spot-check'];

if (!allowed.includes(strategy)) {
  console.error(`[explore] Unknown strategy "${strategy}". Set QA_STRATEGY to one of: ${allowed.join(', ')}`);
  process.exit(1);
}

console.log(`[explore] Dispatching to strategy: ${strategy}`);
require(`./${strategy}`);
