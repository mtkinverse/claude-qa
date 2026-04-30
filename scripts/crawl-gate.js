#!/usr/bin/env node
/**
 * crawl-gate.js — hard precondition for the Phase 1 → Phase 2 transition.
 *
 * Exits non-zero (= fails the gate) if:
 *   - any row in qa/knowledgebase/crawl-todo.md is still ⬜ pending
 *   - any row is 🔄 in-progress (left mid-tick)
 *   - any ⛔ skipped row has no reason
 *
 * Phase 2 must run this first thing and refuse to proceed on failure.
 * Phase 1 must run this as part of its exit gate.
 *
 * Usage:
 *   node scripts/crawl-gate.js          # check + exit code
 *   node scripts/crawl-gate.js --json   # machine-readable summary
 */

const fs   = require('fs');
const path = require('path');

const FILE = 'qa/knowledgebase/crawl-todo.md';
const JSON_OUT = process.argv.includes('--json');

if (!fs.existsSync(FILE)) {
  console.error(`crawl-gate: ${FILE} missing — Phase 1 has not run`);
  process.exit(2);
}

const ROW_RE = /^\| *(\d+) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\|/;
const rows = [];
for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
  const m = line.match(ROW_RE);
  if (m) rows.push({ n: +m[1], url: m[2].trim(), title: m[3].trim(), status: m[4].trim(), notes: m[5].trim() });
}

const pending = rows.filter(r => r.status.startsWith('⬜'));
const active  = rows.filter(r => r.status.startsWith('🔄'));
const skipped = rows.filter(r => r.status.startsWith('⛔'));
const skippedNoReason = skipped.filter(r => !r.notes || r.notes === '—');
const explored = rows.filter(r => r.status.startsWith('✅'));

const fail = pending.length > 0 || active.length > 0 || skippedNoReason.length > 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    total: rows.length,
    explored: explored.length,
    skipped: skipped.length,
    pending: pending.length,
    active: active.length,
    skippedNoReason: skippedNoReason.length,
    pass: !fail,
  }, null, 2));
  process.exit(fail ? 1 : 0);
}

console.log(`crawl-gate: ${rows.length} total | ✅ ${explored.length} | ⛔ ${skipped.length} | ⬜ ${pending.length} | 🔄 ${active.length}`);

if (pending.length) {
  console.error(`\n❌ ${pending.length} URLs still ⬜ pending — Phase 2 blocked. Either explore them or mark skipped with --reason:`);
  for (const r of pending) console.error(`   ⬜ ${r.url}`);
}
if (active.length) {
  console.error(`\n❌ ${active.length} URLs left 🔄 in-progress — finish or rollback before Phase 2:`);
  for (const r of active) console.error(`   🔄 ${r.url}`);
}
if (skippedNoReason.length) {
  console.error(`\n❌ ${skippedNoReason.length} ⛔ skipped rows have no reason — re-run with --mark-skipped <url> --reason "<why>":`);
  for (const r of skippedNoReason) console.error(`   ⛔ ${r.url}`);
}

if (fail) {
  console.error(`\nGate FAILED. Phase 1 not complete.`);
  process.exit(1);
}

// Interaction exhaustion ratio check
const stateFile = path.join(process.cwd(), 'qa', 'knowledgebase', 'interactions-state.json');
const threshold = parseFloat(process.env.INTERACTIONS_RATIO_THRESHOLD || '0.7');

if (fs.existsSync(stateFile)) {
  let state;
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  catch { state = null; }

  if (state) {
    const exploredCount = Object.keys(state.explored).length;
    const queueCount    = state.queue.length;
    const total         = exploredCount + queueCount;
    const ratio         = total > 0 ? exploredCount / total : 1;

    if (ratio < threshold) {
      console.error(`[crawl-gate] FAIL: interaction exhaustion ratio ${ratio.toFixed(2)} < ${threshold}`);
      console.error(`  Explored: ${exploredCount} / ${total} interactives`);
      console.error(`  ${queueCount} elements remain unexplored in interactions-state.json`);
      console.error(`  Set INTERACTIONS_RATIO_THRESHOLD env var to lower the bar, or explore more.`);
      process.exit(1);
    } else {
      console.log(`[crawl-gate] OK: interaction ratio ${ratio.toFixed(2)} >= ${threshold} (${exploredCount}/${total})`);
    }
  }
} else {
  console.warn('[crawl-gate] interactions-state.json not found — skipping ratio check');
  console.warn('  Run update-interactions-state.js --discover-from-uig after Phase 1 to generate it.');
}

console.log(`\n✅ Gate PASSED. Safe to enter Phase 2.`);
process.exit(0);
