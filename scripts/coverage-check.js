#!/usr/bin/env node
/**
 * coverage-check.js — bidirectional snapshot ↔ inventory ↔ flow.md verification.
 *
 * Run at the Phase 1 → Phase 2 transition (and after re-discovery).
 * Replaces eyeballing screenshots with a deterministic 3-way audit:
 *
 *   1. Every snapshot file on disk is referenced in ui-inventory.md
 *   2. Every snapshot referenced in ui-inventory.md exists on disk
 *   3. Every snapshot is referenced in some flow.md Discovery Evidence table
 *      (catch-all: F-NNN-misc-pages is allowed)
 *
 * Exits 1 on any orphan/missing/dangling reference.
 */

const fs = require('fs');
const path = require('path');

const SNAP_DIR    = 'qa/knowledgebase/aria-snapshots';
const INVENTORY   = 'qa/knowledgebase/ui-inventory.md';
const FLOWS_DIR   = 'qa/flows';

function readMaybe(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }

const onDisk = new Set(
  fs.existsSync(SNAP_DIR)
    ? fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.snapshot.json') && !f.startsWith('_'))
    : []
);

const inventoryText = readMaybe(INVENTORY);
const inInventory = new Set(
  [...inventoryText.matchAll(/[a-zA-Z0-9_-]+\.snapshot\.json/g)].map(m => m[0])
);

const inFlowMd = new Set();
const flowDirs = fs.existsSync(FLOWS_DIR) ? fs.readdirSync(FLOWS_DIR).filter(d => d.startsWith('F-')) : [];
for (const d of flowDirs) {
  const flowMd = readMaybe(path.join(FLOWS_DIR, d, 'flow.md'));
  for (const m of flowMd.matchAll(/[a-zA-Z0-9_-]+\.snapshot\.json/g)) inFlowMd.add(m[0]);
}

const missingFromDisk      = [...inInventory].filter(f => !onDisk.has(f));
const orphanedFromInventory = [...onDisk].filter(f => !inInventory.has(f));
const orphanedFromFlowMd   = [...onDisk].filter(f => !inFlowMd.has(f));

const issues = [];
if (missingFromDisk.length)
  issues.push(`Inventory references ${missingFromDisk.length} snapshot(s) not on disk:\n   ${missingFromDisk.slice(0, 10).join('\n   ')}`);
if (orphanedFromInventory.length)
  issues.push(`${orphanedFromInventory.length} snapshot(s) on disk not in ui-inventory.md:\n   ${orphanedFromInventory.slice(0, 10).join('\n   ')}`);
if (orphanedFromFlowMd.length)
  issues.push(`${orphanedFromFlowMd.length} snapshot(s) not referenced by any flow.md:\n   ${orphanedFromFlowMd.slice(0, 10).join('\n   ')}`);

console.log(`Snapshots on disk:        ${onDisk.size}`);
console.log(`In ui-inventory.md:       ${inInventory.size}`);
console.log(`In some flow.md:          ${inFlowMd.size}`);
console.log(`Flow directories:         ${flowDirs.length} (${flowDirs.join(', ')})`);

if (issues.length) {
  console.error('');
  issues.forEach(i => console.error(`❌ ${i}`));
  process.exit(1);
}

// Check 4: Journey inventory status matches actual TRACED taxonomy
// A flow with deferral markers in flow.md must not be labeled TRACED-COMPLETE
const journeyInventoryPath = path.join(process.cwd(), 'qa', 'knowledgebase', 'journey-inventory.md');
const flowsDir = path.join(process.cwd(), 'qa', 'flows');

if (fs.existsSync(journeyInventoryPath) && fs.existsSync(flowsDir)) {
  const inventoryText = fs.readFileSync(journeyInventoryPath, 'utf8');
  const DEFERRAL_MARKERS = /deferred|surface only|not yet|not opened|not clicked|not expanded/i;
  const flowDirs = fs.readdirSync(flowsDir).filter(d =>
    fs.statSync(path.join(flowsDir, d)).isDirectory());

  for (const flowDir of flowDirs) {
    const flowMdPath = path.join(flowsDir, flowDir, 'flow.md');
    if (!fs.existsSync(flowMdPath)) continue;
    const flowMd = fs.readFileSync(flowMdPath, 'utf8');
    const hasDeferral = DEFERRAL_MARKERS.test(flowMd);
    // Check inventory row claims TRACED-COMPLETE despite deferral markers
    const flowId = flowDir.match(/^(F-\d+)/)?.[1];
    if (flowId && hasDeferral && inventoryText.includes(flowId) &&
        inventoryText.includes('TRACED-COMPLETE')) {
      const row = inventoryText.split('\n').find(l => l.includes(flowId));
      if (row && row.includes('TRACED-COMPLETE')) {
        console.error(`[coverage-check] FAIL: ${flowDir}/flow.md has deferral markers but journey-inventory.md claims TRACED-COMPLETE`);
        console.error(`  Inventory row: ${row.trim()}`);
        console.error(`  Either remove deferral markers or change status to TRACED-SURFACE`);
        process.exitCode = 1;
      }
    }
  }
  if (!process.exitCode) {
    console.log('[coverage-check] OK: all TRACED-COMPLETE flows have no deferral markers in flow.md');
  }
}

console.log(`\n✅ Coverage check passed — every snapshot is inventoried and referenced by a flow`);
