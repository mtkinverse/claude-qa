#!/usr/bin/env node
// qa/run.js — cross-platform runner.
// Examples:
//   node qa/run.js                          → all tests (standalone + journeys)
//   node qa/run.js --flow F-001             → standalone flow only
//   node qa/run.js --journey J-000          → one E2E journey
//   node qa/run.js --suite standalone       → all qa/tests/ specs
//   node qa/run.js --suite journeys         → all qa/journeys/ specs

const { execSync } = require('child_process');
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const flow    = get('--flow');
const journey = get('--journey');
const suite   = get('--suite');

console.log('→ Installing dependencies...');
execSync('npm install --silent', { stdio: 'inherit', cwd: __dirname });
execSync('node ./node_modules/playwright/cli.js install chromium --quiet', { stdio: 'inherit', cwd: __dirname });

// Self-heal cascade — heal.js is auto-imported by generated specs via shared-helpers.
// We export QA_QUIRKS_PATH so the cascade can find app-quirks.yml regardless of cwd.
process.env.QA_QUIRKS_PATH = process.env.QA_QUIRKS_PATH || require('path').join(__dirname, 'app-quirks.yml');
process.env.QA_SNAPSHOT_DIR = process.env.QA_SNAPSHOT_DIR || require('path').join(__dirname, 'knowledgebase', 'aria-snapshots');
process.env.QA_AUTO_FIX_PATH = process.env.QA_AUTO_FIX_PATH || require('path').join(__dirname, 'auto-fixes.md');
process.env.QA_EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR || require('path').join(__dirname, 'evidence');

let target = '';
if (flow)                        target = `tests/${flow}-*.spec.ts`;
else if (journey)                target = `journeys/${journey}-*.spec.ts`;
else if (suite === 'standalone') target = 'tests/';
else if (suite === 'journeys')   target = 'journeys/';

const cmd = [
  'node ./node_modules/playwright/cli.js test',
  '--config playwright.config.ts',
  '--reporter=html --continue-on-failure',
  target,
].filter(Boolean).join(' ');

console.log(`→ Running: ${cmd}`);
execSync(cmd, { stdio: 'inherit', cwd: __dirname });
