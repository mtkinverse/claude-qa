'use strict';

const fs = require('fs');
const path = require('path');
const { validateContract } = require('./contract');
const { loadRunner, loadCheckers } = require('./lib/registry');
const { runStatic } = require('./layers/static');
const { runSmoke } = require('./layers/smoke');
const { runMutation } = require('./layers/mutation');
const { runContractCheck } = require('./layers/contract-check');

const DEFAULTS = {
  scenarios: 'contracts.json',
  journeys:  'journeys.json',
  checkers:  [],
  runner:    null,
  smoke:     { concurrency: 8, timeoutMs: 30000 },
  mutation:  { enabled: true, kinds: ['unauth', 'wrong-role', 'wrong-url'], cacheDir: '.cache/mutation', concurrency: 4, timeoutMs: 30000 },
  output:    { runsDir: 'runs' },
  vocabulary: null,
};

function deepMerge(a, b) {
  if (!b) return a;
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function tsStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 * Run the full pipeline (or a subset).
 * @param {{ qaDir: string, configPath?: string, layers?: ('A'|'B'|'C'|'D')[], log?: (msg:string)=>void }} opts
 */
async function runPipeline(opts) {
  const qaDir = path.resolve(opts.qaDir);
  const log = opts.log || ((m) => console.log(m));
  const configPath = opts.configPath ? path.resolve(opts.configPath) : path.join(qaDir, '.verify.json');
  const userCfg = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const cfg = deepMerge(DEFAULTS, userCfg);
  const layers = new Set(opts.layers || ['A', 'B', 'C', 'D']);

  // Load scenarios + journeys
  const scenariosPath = path.resolve(qaDir, cfg.scenarios);
  const journeysPath  = path.resolve(qaDir, cfg.journeys);
  const scenarios = loadJson(scenariosPath, []);
  const journeys  = loadJson(journeysPath, []);
  if (!Array.isArray(scenarios)) throw new Error(`${scenariosPath} must be a JSON array of contracts`);

  // Validate contracts
  const validationIssues = [];
  for (const s of scenarios) {
    const errs = validateContract(s, cfg.vocabulary);
    for (const e of errs) validationIssues.push({ scenarioId: s?.id, severity: 'error', message: e, checker: '<schema>' });
  }

  // Layer A
  let staticRes = { issues: [], failedScenarioIds: new Set() };
  if (layers.has('A')) {
    const checkers = loadCheckers(qaDir, cfg.checkers);
    staticRes = await runStatic({ qaDir, scenarios, checkers, log });
    staticRes.issues.push(...validationIssues);
    for (const i of validationIssues) if (i.scenarioId) staticRes.failedScenarioIds.add(i.scenarioId);
  } else {
    staticRes.issues = validationIssues;
  }

  const runner = (layers.has('B') || layers.has('C')) ? loadRunner(qaDir, cfg.runner) : null;

  // Layer B — skip scenarios that failed Layer A
  let smokeRes = { results: new Map() };
  if (layers.has('B') && runner) {
    smokeRes = await runSmoke({
      scenarios, runner,
      concurrency: cfg.smoke.concurrency,
      timeoutMs: cfg.smoke.timeoutMs,
      skipIds: staticRes.failedScenarioIds,
      log,
    });
  }

  // Layer C — only on scenarios that passed Layer B
  const passedSmoke = new Set(
    [...smokeRes.results.entries()].filter(([, v]) => v.status === 'pass').map(([k]) => k),
  );
  const skipMutation = new Set(scenarios.map((s) => s.id).filter((id) => !passedSmoke.has(id)));
  let mutRes = { vacuousIds: new Set(), details: new Map() };
  if (layers.has('C') && runner && cfg.mutation.enabled) {
    mutRes = await runMutation({
      qaDir, scenarios, runner,
      kinds: cfg.mutation.kinds,
      cacheDir: cfg.mutation.cacheDir,
      concurrency: cfg.mutation.concurrency,
      timeoutMs: cfg.mutation.timeoutMs,
      skipIds: skipMutation,
      log,
    });
  }

  // Layer D
  let contractRes = { incompatibleScenarioIds: new Set(), blockedJourneys: [] };
  if (layers.has('D')) {
    contractRes = runContractCheck({ scenarios, journeys, log });
  }

  // Per-scenario classification
  const perScenario = scenarios.map((s) => {
    if (staticRes.failedScenarioIds.has(s.id)) return { id: s.id, status: 'static-fail' };
    if (smokeRes.results.has(s.id) && smokeRes.results.get(s.id).status !== 'pass') {
      return { id: s.id, status: 'smoke-fail', message: smokeRes.results.get(s.id).message };
    }
    if (mutRes.vacuousIds.has(s.id)) return { id: s.id, status: 'vacuous' };
    if (contractRes.incompatibleScenarioIds.has(s.id)) return { id: s.id, status: 'contract-incompatible' };
    if (smokeRes.results.has(s.id)) return { id: s.id, status: 'pass' };
    return { id: s.id, status: layers.has('B') ? 'skipped' : 'pass' };
  });

  // Write artifacts
  const stamp = tsStamp();
  const runDir = path.resolve(qaDir, cfg.output.runsDir, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const verifyJson = {
    version: 1,
    timestamp: new Date().toISOString(),
    layers: [...layers],
    scenarios: perScenario,
    static: { issues: staticRes.issues },
    smoke:   { results: Object.fromEntries(smokeRes.results) },
    mutation: { vacuous: [...mutRes.vacuousIds], details: Object.fromEntries(mutRes.details) },
    contract: { blockedJourneys: contractRes.blockedJourneys, incompatibleScenarioIds: [...contractRes.incompatibleScenarioIds] },
  };
  fs.writeFileSync(path.join(runDir, 'verify.json'), JSON.stringify(verifyJson, null, 2));
  fs.writeFileSync(path.join(runDir, 'summary.md'), renderSummary(verifyJson));
  log(`✓ wrote ${path.relative(qaDir, runDir)}/verify.json + summary.md`);
  return verifyJson;
}

function renderSummary(v) {
  const counts = {};
  for (const s of v.scenarios) counts[s.status] = (counts[s.status] || 0) + 1;
  const total = v.scenarios.length;
  const lines = [];
  lines.push(`# Verification summary — ${v.timestamp}`);
  lines.push('');
  lines.push(`Layers run: ${v.layers.join(', ')}`);
  lines.push(`Total scenarios: ${total}`);
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|--------|-------|');
  for (const [k, n] of Object.entries(counts)) lines.push(`| ${k} | ${n} |`);
  lines.push('');
  const groups = ['static-fail', 'smoke-fail', 'vacuous', 'contract-incompatible'];
  for (const g of groups) {
    const ids = v.scenarios.filter((s) => s.status === g).map((s) => s.id);
    if (!ids.length) continue;
    lines.push(`## ${g} (${ids.length})`);
    for (const id of ids) {
      const s = v.scenarios.find((x) => x.id === id);
      lines.push(`- ${id}${s.message ? ` — ${s.message}` : ''}`);
    }
    lines.push('');
  }
  if (v.contract.blockedJourneys.length) {
    lines.push(`## blocked journeys (${v.contract.blockedJourneys.length})`);
    for (const j of v.contract.blockedJourneys) {
      lines.push(`- ${j.id}`);
      for (const g of j.gaps) lines.push(`  - ${g.from} → ${g.to}: missing ${g.missing.join(', ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { runPipeline };
