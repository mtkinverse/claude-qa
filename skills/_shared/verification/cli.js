#!/usr/bin/env node
'use strict';

const { runPipeline } = require('./pipeline');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const qaDir = arg('--qa-dir', './qa');
const configPath = arg('--config');
const layersArg = arg('--layers');
const layers = layersArg ? layersArg.split(',').map((s) => s.trim().toUpperCase()) : null;

runPipeline({ qaDir, configPath, layers })
  .then((v) => {
    const failed = v.scenarios.filter((s) => s.status !== 'pass' && s.status !== 'skipped').length;
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(`[verify] ${e.message}`);
    process.exit(2);
  });
