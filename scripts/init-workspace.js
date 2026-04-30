#!/usr/bin/env node
/**
 * init-workspace.js — scaffold qa/ workspace from static templates.
 *
 * Usage:
 *   node scripts/init-workspace.js --framework flow-based --platform <macOS|web|windows|iOS|android>
 *
 * Idempotent: rewrites READMEs and .qa-config.json; never deletes user data.
 * Note: only flow-based layout is supported. Feature-based and risk-based layouts
 * have been removed — all downstream tooling assumes flow-based.
 */

const fs = require('fs');
const path = require('path');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const FRAMEWORK = arg('--framework', 'flow-based');
const PLATFORM  = arg('--platform', 'web');

const VALID_FRAMEWORKS = ['flow-based'];
if (!VALID_FRAMEWORKS.includes(FRAMEWORK)) {
  console.error(`ERROR: --framework must be "flow-based". Feature-based and risk-based layouts have been removed.`);
  process.exit(2);
}

const REPO_ROOT     = path.resolve(__dirname, '..');
const QA_ROOT       = path.join(REPO_ROOT, 'qa');
const TEMPLATES_DIR = path.join(__dirname, 'templates', 'readmes');

const COMMON_DIRS = [
  'guardrails', 'credentials', 'scope',
  'knowledgebase/aria-snapshots',
  'knowledgebase/screenshots',
  'journeys', 'tests',
  'context/feature-specs', 'context/figma-screens',
  'evidence', 'runs',
  'journey-todo', '.auth',
];

// macOS still needs planning/ for platforms.md; web does not
const PLATFORM_DIRS = {
  macos: ['planning'],
};

// Always create flows/ — flow-based is the only supported layout.
// Feature-based and risk-based layouts have been removed.
const FRAMEWORK_DIRS = {
  'flow-based': ['flows'],
};

// Source template → destination relative to qa/
const README_MAP = {
  [`qa.${FRAMEWORK}.md`]:        'README.md',
  'context.md':                  'context/README.md',
  'context.feature-specs.md':    'context/feature-specs/README.md',
  'context.figma-screens.md':    'context/figma-screens/README.md',
  'guardrails.md':               'guardrails/README.md',
  'evidence.md':                 'evidence/README.md',
  'scope.md':                    'scope/README.md',
  'knowledgebase.md':            'knowledgebase/README.md',
  'journey-inventory.md':        'knowledgebase/journey-inventory.md',
  'runs.md':                     'runs/README.md',
  'credentials.md':              'credentials/README.md',
};

// macOS platform adds planning/ README
const PLATFORM_README_MAP = {
  macos: {
    'planning.md': 'planning/README.md',
  },
};

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

// 1. Create directory tree
const platformExtraDirs = PLATFORM_DIRS[PLATFORM] || [];
const dirs = [...COMMON_DIRS, ...FRAMEWORK_DIRS[FRAMEWORK], ...platformExtraDirs];
for (const d of dirs) mkdirp(path.join(QA_ROOT, d));

// 2. Write READMEs from templates
const allReadmes = { ...README_MAP, ...(PLATFORM_README_MAP[PLATFORM] || {}) };
const vars = { platform: PLATFORM, framework: FRAMEWORK };
for (const [src, dest] of Object.entries(allReadmes)) {
  const srcPath = path.join(TEMPLATES_DIR, src);
  if (!fs.existsSync(srcPath)) {
    console.error(`ERROR: missing template ${srcPath}`);
    process.exit(3);
  }
  const content = render(fs.readFileSync(srcPath, 'utf8'), vars);
  const destPath = path.join(QA_ROOT, dest);
  mkdirp(path.dirname(destPath));
  fs.writeFileSync(destPath, content);
}

// 3. Write .qa-config.json
const today = new Date().toISOString().slice(0, 10);
const config = {
  version: '2.0',
  framework: FRAMEWORK,
  app_name: null,
  app_path: null,
  app_identifier: null,
  app_version: null,
  platform: PLATFORM,
  os_version: null,
  architecture: null,
  created: today,
  last_discovery: null,
  flows_count: 0,
  test_cases_count: 0,
};
fs.writeFileSync(
  path.join(QA_ROOT, '.qa-config.json'),
  JSON.stringify(config, null, 2) + '\n'
);

console.log(`✅ qa/ scaffolded — framework=${FRAMEWORK} platform=${PLATFORM}`);
console.log(`   ${dirs.length} directories, ${Object.keys(README_MAP).length} READMEs, .qa-config.json written.`);
