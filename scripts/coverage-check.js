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

console.log(`\n✅ Coverage check passed — every snapshot is inventoried and referenced by a flow`);
