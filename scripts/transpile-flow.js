#!/usr/bin/env node
/**
 * transpile-flow.js — Phase 3 transpiler
 * Converts manifest.jsonl + trace.jsonl + uig.jsonl + app-quirks.yml
 * into F-NNN.scenarios.ts (reusable module) + F-NNN-<slug>.spec.ts (thin wrapper).
 *
 * See skills/web/references/manifest-grammar.md for the DSL spec.
 * Usage: node scripts/transpile-flow.js --flow qa/flows/F-001-auth
 */
'use strict';

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const flowArg  = args[args.indexOf('--flow') + 1];
const allFlows = args.includes('--all');

if (!flowArg && !allFlows) {
  console.error('Usage: node scripts/transpile-flow.js --flow qa/flows/F-NNN-<slug>');
  console.error('       node scripts/transpile-flow.js --all');
  process.exit(1);
}

const QA_DIR    = path.resolve('qa');
const FLOWS_DIR = path.join(QA_DIR, 'flows');
const UIG_PATH  = path.join(QA_DIR, 'knowledgebase', 'uig.jsonl');
const QUIRKS    = path.join(QA_DIR, 'app-quirks.yml');
const TESTS_DIR = path.join(QA_DIR, 'tests');

// ── Load UIG ──────────────────────────────────────────────────────────────────
function loadUig() {
  if (!fs.existsSync(UIG_PATH)) return [];
  return fs.readFileSync(UIG_PATH, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ── Load app-quirks.yml (minimal YAML parser for flat key: value) ─────────────
function loadQuirks() {
  if (!fs.existsSync(QUIRKS)) return {};
  const text = fs.readFileSync(QUIRKS, 'utf8');
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+):\s*(.+)$/);
    if (m) result[m[1].trim()] = m[2].trim();
  }
  return result;
}

// ── Parse a manifest DSL target → Playwright locator code ────────────────────
function parseTarget(target, action) {
  if (!target) return { locator: null, deprecated: false };

  // pseudo:alert-text — not a locator
  if (target.startsWith('pseudo:')) return { locator: null, alertText: target.slice(7), deprecated: false };

  // text:'X'
  const textMatch = target.match(/^text:'(.+)'$/);
  if (textMatch) return { locator: `page.getByText('${esc(textMatch[1])}')`, deprecated: false };

  // role[name='X' exact]
  const exactMatch = target.match(/^(\w+)\[name='([^']+)'\s+exact\]$/);
  if (exactMatch) return {
    locator: `page.getByRole('${exactMatch[1]}', { name: '${esc(exactMatch[2])}', exact: true })`,
    role: exactMatch[1], name: exactMatch[2], exact: true, deprecated: false };

  // role[name='X']
  const nameMatch = target.match(/^(\w+)\[name='([^']+)'\]$/);
  if (nameMatch) return {
    locator: `page.getByRole('${nameMatch[1]}', { name: '${esc(nameMatch[2])}' })`,
    role: nameMatch[1], name: nameMatch[2], exact: false, deprecated: false };

  // role[name~='X'] — deprecated
  const fuzzyMatch = target.match(/^(\w+)\[name~='([^']+)'\]$/);
  if (fuzzyMatch) return {
    locator: `page.getByRole('${fuzzyMatch[1]}', { name: /${esc(fuzzyMatch[2])}/i })`,
    role: fuzzyMatch[1], name: fuzzyMatch[2], deprecated: true };

  // role[index=N scope=Y]
  const indexMatch = target.match(/^(\w+)\[index=(\d+)\s+scope=([^\]]+)\]$/);
  if (indexMatch) return {
    locator: `page.getByRole('${indexMatch[1]}').nth(${indexMatch[2]})`,
    role: indexMatch[1], nth: parseInt(indexMatch[2]), scope: indexMatch[3], deprecated: false };

  // checkbox[index=0]
  const checkboxIndex = target.match(/^checkbox\[index=(\d+)\]$/);
  if (checkboxIndex) return {
    locator: `page.getByRole('checkbox').nth(${checkboxIndex[1]})`,
    deprecated: false };

  // input[type=password]:nth(N) — deprecated
  const cssNth = target.match(/^([^:]+):nth\((\d+)\)$/);
  if (cssNth) return {
    locator: `page.locator('${esc(cssNth[1])}').nth(${cssNth[2]})`,
    deprecated: true };

  // Bare URL (for goto actions)
  if (action === 'goto') return { locator: null, url: target, deprecated: false };

  // Fallback: treat as text
  return { locator: `page.getByText('${esc(target)}')`, deprecated: false };
}

function esc(s) { return String(s).replace(/'/g, "\\'"); }

// ── Find UIG row for a parsed target ─────────────────────────────────────────
function findUigRow(parsed, uig, quirks) {
  if (!parsed.role && !parsed.name) return null;
  const candidates = uig.filter(r =>
    (!parsed.role || r.role === parsed.role) &&
    (!parsed.name || r.name === parsed.name || r.name?.toLowerCase() === parsed.name?.toLowerCase())
  );
  if (candidates.length === 0) return null;
  // Prefer uniqueInScope
  const unique = candidates.find(r => r.uniqueInScope);
  if (unique) return unique;
  // Apply quirks
  for (const [key, val] of Object.entries(quirks)) {
    if (parsed.name && key.toLowerCase().includes(parsed.name.toLowerCase())) {
      const byScope = candidates.find(r => r.scope === val);
      if (byScope) return byScope;
    }
  }
  return candidates[0] || null;
}

// ── Outcome → assertion ───────────────────────────────────────────────────────
function outcomeToAssertion(outcome, locatorCode) {
  const map = {
    'navigated':           `  await expect(page).toHaveURL(/.+/);`,
    'dom-updated':         locatorCode ? `  await expect(${locatorCode}).toBeVisible();` : `  // dom-updated`,
    'modal-opened':        `  await expect(page.locator('[role="dialog"]')).toBeVisible();`,
    'error-surfaced':      `  await expect(page.locator('[role="alert"]')).toBeVisible();`,
    'auth-success':        `  await expect(page).toHaveURL(/dashboard/);`,
    'auth-rejected-server':`  await expect(page.locator('[role="alert"]')).toBeVisible();`,
    'no-change':           `  // no-change — no assertion`,
    'form-reset-silent':   `  // form-reset — no assertion`,
    'network-timeout':     `  // network-timeout — consider adding explicit wait`,
  };
  return map[outcome] || `  // outcome: ${outcome}`;
}

// ── Transpile one flow ────────────────────────────────────────────────────────
async function transpileFlow(flowDir) {
  const flowId   = path.basename(flowDir).match(/^(F-\d+)/)?.[1] || path.basename(flowDir);
  const flowSlug = path.basename(flowDir);

  const manifestPath = path.join(flowDir, 'manifest.jsonl');
  const tracePath    = path.join(flowDir, 'trace.jsonl');
  const flowMdPath   = path.join(flowDir, 'flow.md');

  if (!fs.existsSync(manifestPath)) {
    console.warn(`[transpiler] No manifest.jsonl in ${flowDir} — skipping`);
    return false;
  }

  const uig    = loadUig();
  const quirks = loadQuirks();

  const manifest = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const traceRows = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean)
    : [];

  const flowMdComment = fs.existsSync(flowMdPath)
    ? `// Flow: ${flowSlug}\n// Source: ${flowMdPath}\n`
    : `// Flow: ${flowSlug}\n`;

  const lines = [`import { Page, expect } from '@playwright/test';\n`, flowMdComment, `\nexport async function run(page: Page): Promise<void> {\n`];
  const warnings = [];
  let hasUnbackedTarget = false;

  for (const step of manifest) {
    const { action, target, step: stepNum } = step;
    const parsed   = parseTarget(target, action);
    const traceRow = traceRows.find(t => t.step === stepNum || t.action === action);
    const outcome  = traceRow?.outcome || null;

    if (parsed.deprecated) {
      warnings.push(`Step ${stepNum}: deprecated DSL form "${target}" — update to role[name='X' exact] form`);
    }

    if (action === 'goto') {
      lines.push(`  // Step ${stepNum}: navigate\n  await page.goto('${esc(parsed.url || target)}');\n`);
      if (outcome) lines.push(outcomeToAssertion(outcome, null) + '\n');
      continue;
    }

    if (action === 'assert-alert' || (parsed.alertText && action === 'assert-alert')) {
      const txt = parsed.alertText || target;
      lines.push(`  // Step ${stepNum}: assert alert\n  await expect(page.locator('[role="alert"]')).toContainText('${esc(txt)}');\n`);
      continue;
    }

    if (action === 'assert-url') {
      lines.push(`  // Step ${stepNum}: assert URL\n  await expect(page).toHaveURL(${target.startsWith('/') ? `'${esc(target)}'` : `/${esc(target)}/`});\n`);
      continue;
    }

    if (action === 'assert-text') {
      lines.push(`  // Step ${stepNum}: assert text\n  await expect(page.getByText('${esc(target)}')).toBeVisible();\n`);
      continue;
    }

    if (action === 'wait') {
      lines.push(`  // Step ${stepNum}: wait\n  await page.waitForSelector('${esc(target)}');\n`);
      continue;
    }

    if (action === 'press') {
      lines.push(`  // Step ${stepNum}: press key\n  await page.keyboard.press('${esc(target)}');\n`);
      continue;
    }

    // For click/fill: verify UIG backing
    let locatorCode = parsed.locator;
    let uigRow = null;

    if (parsed.role || parsed.name) {
      uigRow = findUigRow(parsed, uig, quirks);
      if (!uigRow) {
        // JIT-backfill: attempt to find the element by re-running snapshot
        console.warn(`[transpiler] Step ${stepNum}: no UIG row for "${target}" — attempting JIT-backfill`);
        const backfilled = await jitBackfill(target, parsed, flowDir, uig);
        if (backfilled) {
          uig.push(backfilled);
          uigRow = backfilled;
          // Refine locator using backfilled row
          locatorCode = buildLocatorFromUigRow(backfilled);
        } else {
          warnings.push(`Step ${stepNum}: UNBACKED TARGET "${target}" — JIT-backfill failed`);
          hasUnbackedTarget = true;
          locatorCode = parsed.locator || `page.getByText('${esc(target)}') /* UNBACKED */`;
        }
      } else {
        locatorCode = buildLocatorFromUigRow(uigRow);
      }
    }

    if (action === 'click') {
      lines.push(`  // Step ${stepNum}: click\n  await ${locatorCode}.click();\n`);
    } else if (action === 'fill') {
      // fill needs a value — use a placeholder; agents adapt this
      lines.push(`  // Step ${stepNum}: fill — replace 'TEST_VALUE' with fixture data\n  await ${locatorCode}.fill('TEST_VALUE');\n`);
    } else {
      lines.push(`  // Step ${stepNum}: ${action}\n  await ${locatorCode}.${action}();\n`);
    }

    if (outcome) lines.push(outcomeToAssertion(outcome, locatorCode) + '\n');
  }

  lines.push(`}\n`);

  // Emit scenarios.ts
  const scenariosPath = path.join(flowDir, `${flowId}.scenarios.ts`);
  fs.writeFileSync(scenariosPath, lines.join(''));
  console.log(`[transpiler] Wrote ${scenariosPath}`);

  // Emit thin wrapper spec
  fs.mkdirSync(TESTS_DIR, { recursive: true });
  const specPath = path.join(TESTS_DIR, `${flowSlug}.spec.ts`);
  const specContent = `import { test } from '@playwright/test';
import { run } from '../flows/${flowSlug}/${flowId}.scenarios';

// Auto-generated by transpile-flow.js — do not edit.
// Edit ${flowId}.scenarios.ts or re-run transpile-flow.js.
test('${flowSlug}', async ({ page }) => {
  await run(page);
});
`;
  fs.writeFileSync(specPath, specContent);
  console.log(`[transpiler] Wrote ${specPath}`);

  // Report warnings
  if (warnings.length > 0) {
    console.warn(`[transpiler] Warnings for ${flowSlug}:`);
    warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
  }

  if (hasUnbackedTarget) {
    console.error(`[transpiler] FAIL: ${flowSlug} has unbacked targets after JIT-backfill. Fix manifest or re-run Phase 1.`);
    return false;
  }

  return true;
}

function buildLocatorFromUigRow(row) {
  if (row.role && row.name) {
    const exactFlag = row.exact ? ', exact: true' : '';
    return `page.getByRole('${row.role}', { name: '${esc(row.name)}'${exactFlag} })`;
  }
  if (row.href) return `page.getByRole('link', { name: '${esc(row.name || row.href)}' })`;
  return `page.getByText('${esc(row.name || '')}')`;
}

// ── JIT-backfill: re-snapshot to find a missing element ──────────────────────
async function jitBackfill(target, parsed, flowDir, existingUig) {
  // JIT-backfill requires replaying the manifest to reach the page where the element lives.
  // We use replay-prefix.js for this. If it doesn't exist yet, skip.
  const replayScript = path.join(__dirname, 'replay-prefix.js');
  if (!fs.existsSync(replayScript)) {
    console.warn('[transpiler] replay-prefix.js not found — skipping JIT-backfill');
    return null;
  }

  try {
    const { execSync } = require('child_process');
    // Find the step number for this target in the manifest
    const manifestPath = path.join(flowDir, 'manifest.jsonl');
    const steps = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    const stepIdx = steps.findIndex(s => s.target === target);
    if (stepIdx < 0) return null;

    // Run replay-prefix to get to the state before this step
    const authPath = path.join(process.cwd(), 'qa', '.auth', 'user.json');
    execSync(
      `node scripts/replay-prefix.js --manifest "${manifestPath}" --steps ${stepIdx} --auth "${authPath}" --snapshot-to /tmp/jit-snap.json`,
      { cwd: process.cwd(), stdio: 'pipe', timeout: 60000 }
    );

    if (!fs.existsSync('/tmp/jit-snap.json')) return null;

    // Parse the snapshot and find matching element
    const snap = JSON.parse(fs.readFileSync('/tmp/jit-snap.json', 'utf8'));
    const candidates = [...(snap.dom?.buttons || []), ...(snap.dom?.links || []),
                        ...(snap.dom?.inputs || [])]
      .filter(el => !parsed.name || el.name?.toLowerCase().includes(parsed.name.toLowerCase()));

    if (candidates.length === 0) return null;

    const el = candidates[0];
    const fp = crypto.createHash('sha1')
      .update([el.page || '', el.role || '', el.name || '', el.scope || ''].join('|'))
      .digest('hex').slice(0, 16);

    const newRow = {
      slug: fp, page: el.page || '', scope: el.scope || '',
      role: el.role || 'button', name: el.name || '',
      exact: true, uniqueInScope: candidates.length === 1,
      disabled: el.disabled || false, href: el.href || null,
      type: el.type || null, effect: null, preconditions: [],
      provenance: 'jit-backfill', backfilled_for_flow: path.basename(flowDir),
      observedAt: new Date().toISOString(),
    };

    // Append to uig.jsonl
    fs.appendFileSync(UIG_PATH, JSON.stringify(newRow) + '\n');
    console.log(`[transpiler] JIT-backfill: added UIG row for "${el.name}" (${fp})`);
    return newRow;
  } catch (e) {
    console.warn(`[transpiler] JIT-backfill error: ${e.message}`);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const flowDirs = allFlows
    ? fs.readdirSync(FLOWS_DIR)
        .map(d => path.join(FLOWS_DIR, d))
        .filter(d => fs.statSync(d).isDirectory())
    : [path.resolve(flowArg)];

  let allPassed = true;
  for (const flowDir of flowDirs) {
    const ok = await transpileFlow(flowDir);
    if (!ok) allPassed = false;
  }

  if (!allPassed) {
    console.error('[transpiler] One or more flows failed. Fix unbacked targets before running tests.');
    process.exit(1);
  }
  console.log('[transpiler] All flows transpiled successfully.');
}

main().catch(e => { console.error(e); process.exit(1); });
