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
