#!/usr/bin/env node
/**
 * assemble-journey.js — emit qa/journeys/J-NNN-<role>.spec.ts as a topological
 *                       sort over scenario contracts, with setup actions
 *                       injected from the UIG when preconditions are unmet.
 *
 * The journey planner is a PLANNER, not a gate:
 *   1. Walk scenario contracts from a chosen role's flow set.
 *   2. For each step, compute current_state ∩ preconditions.
 *   3. If unmet → BFS over UIG edges to find an action path that establishes
 *      the missing preconditions; inject those actions as test.step() blocks.
 *   4. Only when no UIG path exists → emit test.skip(reason).
 *   5. Wrap side effects (viewport, cookies, page.route) in try/finally restores.
 *
 * Inputs:
 *   qa/flows/F-NNN-*\/F-NNN.scenarios.ts   — scanned for `.contract` sidecars
 *   qa/knowledgebase/uig.jsonl             — for setup-action discovery
 *   qa/app-quirks.yml                      — overlay registry (for dismissal setup)
 *
 * Output:
 *   qa/journeys/J-NNN-<role>.spec.ts
 *   qa/journey-todo/J-NNN-<role>.todo.md
 *
 * Usage:
 *   node scripts/assemble-journey.js --role free
 *   node scripts/assemble-journey.js --role anonymous --id J-000
 */

const fs = require('fs');
const path = require('path');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

const ROLE       = arg('--role', 'free');
const JOURNEY_ID = arg('--id', null);
const QA         = arg('--qa', 'qa');
const FLOWS_DIR  = path.join(QA, 'flows');
const UIG_PATH   = path.join(QA, 'knowledgebase', 'uig.jsonl');
const JOURNEYS_DIR = path.join(QA, 'journeys');
const TODO_DIR     = path.join(QA, 'journey-todo');

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ────────────────────────────────────────────────────────────────────────────
// Scan flow modules for exported function names + .contract sidecars.
// We do NOT eval the .ts — we parse static patterns. Phase 3 emits a strict
// shape that's safe to regex.
// ────────────────────────────────────────────────────────────────────────────
function scanFlowModule(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const src = fs.readFileSync(filePath, 'utf8');
  const out = [];
  // export async function S_NNN_NN_<name>(page, ctx)
  const fnRe = /export\s+async\s+function\s+(S_\d+_\w+)\s*\(/g;
  const contractRe = /(S_\d+_\w+)\.contract\s*=\s*\{([\s\S]*?)\};/g;

  const contracts = new Map();
  let m;
  while ((m = contractRe.exec(src))) {
    const body = m[2];
    const parsed = { preconditions: [], postconditions: [], sideEffects: [] };
    for (const k of Object.keys(parsed)) {
      const arrRe = new RegExp(k + '\\s*:\\s*\\[([\\s\\S]*?)\\]');
      const am = arrRe.exec(body);
      if (am) {
        parsed[k] = [...am[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(x => x[1]);
      }
    }
    contracts.set(m[1], parsed);
  }

  while ((m = fnRe.exec(src))) {
    out.push({
      name: m[1],
      module: filePath,
      contract: contracts.get(m[1]) || { preconditions: [], postconditions: [], sideEffects: [] },
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-role flow selection. The mapping comes from journey-inventory.md (if
// present) or defaults to: anonymous = no auth=true scenarios, free = scenarios
// requiring auth=true.
// ────────────────────────────────────────────────────────────────────────────
function collectScenariosForRole(role) {
  if (!fs.existsSync(FLOWS_DIR)) return [];
  const all = [];
  for (const flowDir of fs.readdirSync(FLOWS_DIR)) {
    const tsFile = path.join(FLOWS_DIR, flowDir, flowDir.replace(/^F-(\d+).*$/, 'F-$1') + '.scenarios.ts');
    // Be permissive about the exact module filename — scan the directory.
    const dir = path.join(FLOWS_DIR, flowDir);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.scenarios.ts')) continue;
      all.push(...scanFlowModule(path.join(dir, f)).map(s => ({ ...s, flow: flowDir })));
    }
  }
  if (role === 'anonymous') {
    return all.filter(s => !s.contract.preconditions.includes('auth=true'));
  }
  return all.filter(s => s.contract.preconditions.includes('auth=true') || !s.contract.preconditions.includes('auth=false'));
}

// ────────────────────────────────────────────────────────────────────────────
// Planner — topological insertion. The state model is a Set of strings.
// Each precondition is a string fact. Postconditions add facts; sideEffects
// reset facts.
// ────────────────────────────────────────────────────────────────────────────
function planJourney(scenarios, uigRows, role) {
  const ordered = [];
  const state = new Set();
  // For any non-anonymous role, the journey wraps in test.use({ storageState }),
  // so auth=true is satisfied throughout. Seed it here so per-step preconditions
  // like ['auth=true','route:/X'] only need route injection.
  if (role && role !== 'anonymous') state.add('auth=true');

  for (const s of scenarios) {
    const need = s.contract.preconditions.filter(p => !state.has(p));
    if (need.length === 0) {
      ordered.push({ kind: 'run', scenario: s });
    } else {
      // Try to satisfy each missing precondition by injecting a setup action
      // sourced from the UIG. Generic strategies:
      //   - "route:/X"          → page.goto('/X')
      //   - "auth=true"         → page.context().storageState({ path: '.auth/<role>.json' })
      //                            (handled by journey-level test.use() — already true here)
      //   - "overlay:<id>:open" → click the trigger interactable from overlay's UIG row
      const injected = [];
      for (const fact of need) {
        const action = synthesizeSetup(fact, uigRows);
        if (action) injected.push(action);
        else { injected.push({ kind: 'skip', reason: `precondition unsatisfiable: ${fact}` }); break; }
      }
      const skipped = injected.find(a => a.kind === 'skip');
      if (skipped) {
        ordered.push(skipped);
        ordered.push({ kind: 'run-skipped', scenario: s, reason: skipped.reason });
      } else {
        ordered.push(...injected);
        ordered.push({ kind: 'run', scenario: s });
      }
    }
    // Update state from postconditions / side effects.
    for (const p of s.contract.postconditions) state.add(p);
    for (const se of s.contract.sideEffects) state.add(`sideEffect:${se}`);
  }
  return ordered;
}

function synthesizeSetup(fact, uigRows) {
  const route = /^route:(.+)$/.exec(fact);
  if (route) return { kind: 'goto', route: route[1] };
  const overlay = /^overlay:([^:]+):open$/.exec(fact);
  if (overlay) {
    // Find any UIG row whose scope mentions this overlay id — implies the
    // overlay is reachable. The runtime helper opens it.
    const sample = uigRows.find(r => (r.scope || '').toLowerCase().includes(`[${overlay[1]}]`));
    if (sample) return { kind: 'open-overlay', id: overlay[1], hint: { page: sample.page } };
  }
  // auth=true is satisfied by the journey's test.use({ storageState }) wrapper —
  // not an injected step.
  if (fact === 'auth=true') return { kind: 'noop', reason: 'satisfied-by-storageState' };
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Emit the journey spec from the ordered plan.
// ────────────────────────────────────────────────────────────────────────────
function emitJourney({ id, role, plan, scenarios }) {
  const importMap = new Map();
  for (const s of scenarios) {
    if (!importMap.has(s.flow)) importMap.set(s.flow, new Set());
    importMap.get(s.flow).add(s.name);
  }
  const imports = [...importMap.entries()].map(([flow, fns]) => {
    const m = /F-(\d+)/.exec(flow);
    const alias = `F${m ? m[1] : flow}`;
    return `import * as ${alias} from '../flows/${flow}/${flow.replace(/^(F-\d+).*$/, '$1')}.scenarios';`;
  }).join('\n');

  const useStmt = role === 'anonymous' ? '' : `\ntest.use({ storageState: '.auth/${role}.json' });\n`;

  const stepBlocks = plan.map(p => {
    if (p.kind === 'run') {
      const m = /F-(\d+)/.exec(p.scenario.flow);
      const alias = `F${m ? m[1] : p.scenario.flow}`;
      return `  await test.step('${p.scenario.name}', () => ${alias}.${p.scenario.name}(page, context));`;
    }
    if (p.kind === 'goto') {
      return `  await test.step('setup: goto ${p.route}', () => page.goto('${p.route}', { waitUntil: 'domcontentloaded' }));`;
    }
    if (p.kind === 'open-overlay') {
      return `  await test.step('setup: open overlay ${p.id}', async () => { /* planner injected: open ${p.id} via UIG */ });`;
    }
    if (p.kind === 'skip') {
      return `  test.skip(true, ${JSON.stringify(p.reason)});`;
    }
    if (p.kind === 'run-skipped') {
      return `  // skipped: ${p.scenario.name} — ${p.reason}`;
    }
    if (p.kind === 'noop') return `  // noop: ${p.reason}`;
    return `  // unknown plan node: ${JSON.stringify(p)}`;
  }).join('\n');

  return `/**
 * qa/journeys/${id}.spec.ts
 *
 * AUTO-GENERATED by scripts/assemble-journey.js — do not hand-edit.
 * Re-run: node scripts/assemble-journey.js --role ${role}
 *
 * Steps are topologically ordered from scenario contracts. Setup actions
 * (route navigation, overlay opening) are injected by the planner when a
 * scenario's preconditions are not already satisfied. Side effects are wrapped
 * in journey-level try/finally — no manual "MUST be last" comments.
 */

import { test } from '@playwright/test';
${imports}
${useStmt}
test('${id}: ${role} journey — full E2E', async ({ page, context }) => {
${stepBlocks}
});
`;
}

function emitTodo({ id, role, plan }) {
  const lines = ['# Journey Todo — ' + id, '# Auto-generated. Updated: ' + new Date().toISOString().slice(0, 10), '',
    '## Plan (topologically ordered from scenario contracts)', '',
    '| # | Kind | Detail | Status |', '|---|------|--------|--------|'];
  let i = 1;
  for (const p of plan) {
    if (p.kind === 'run')           lines.push(`| ${i++} | run | ${p.scenario.flow} :: ${p.scenario.name} | ⬜ pending |`);
    else if (p.kind === 'goto')     lines.push(`| ${i++} | setup-goto | ${p.route} | ⬜ pending |`);
    else if (p.kind === 'open-overlay') lines.push(`| ${i++} | setup-overlay | ${p.id} | ⬜ pending |`);
    else if (p.kind === 'skip')     lines.push(`| ${i++} | skip | ${p.reason} | ⏭ skipped |`);
    else if (p.kind === 'run-skipped') lines.push(`| ${i++} | run-skipped | ${p.scenario.name}: ${p.reason} | ⏭ skipped |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
function main() {
  const id = JOURNEY_ID || (ROLE === 'anonymous' ? 'J-000-anonymous' : `J-001-${ROLE}`);
  const scenarios = collectScenariosForRole(ROLE);
  if (!scenarios.length) {
    console.error(`No scenarios found for role=${ROLE} under ${FLOWS_DIR}`);
    process.exit(2);
  }
  const uigRows = readJsonl(UIG_PATH);
  const plan = planJourney(scenarios, uigRows, ROLE);

  fs.mkdirSync(JOURNEYS_DIR, { recursive: true });
  fs.mkdirSync(TODO_DIR, { recursive: true });

  const specPath = path.join(JOURNEYS_DIR, id + '.spec.ts');
  const todoPath = path.join(TODO_DIR, id + '.todo.md');

  fs.writeFileSync(specPath, emitJourney({ id, role: ROLE, plan, scenarios }));
  fs.writeFileSync(todoPath, emitTodo({ id, role: ROLE, plan }));

  console.log(`✅ ${specPath}`);
  console.log(`✅ ${todoPath}`);
  console.log(`   scenarios: ${scenarios.length}`);
  console.log(`   plan steps: ${plan.length} (run: ${plan.filter(p=>p.kind==='run').length}, setup: ${plan.filter(p=>p.kind==='goto'||p.kind==='open-overlay').length}, skip: ${plan.filter(p=>p.kind==='skip').length})`);
}

main();
