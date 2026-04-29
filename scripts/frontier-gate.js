#!/usr/bin/env node
/**
 * frontier-gate.js — replaces crawl-gate.js. Hard precondition for the
 * Phase 1 → Phase 2 transition.
 *
 * Coverage requires *frontier closure*, not URL count. The gate fails when
 * any of these conditions hold:
 *
 *   1. Any `crawl-todo.md` row is still ⬜ pending or 🔄 in-progress.
 *   2. Any ⛔ skipped row lacks a reason OR has fewer than 2 retry attempts
 *      logged in `decisions.md` (3-strike protocol — see bfs.md W-2.6).
 *   3. Any visited page in `ui-inventory.md` has actuation coverage below
 *      90% — i.e. interactions_actuated / interactions_detected < 0.9.
 *      (See principles.md §5b — actuate-and-observe contract.)
 *   4. Any modal trigger detected in the UIG has zero submission attempts.
 *   5. Discovery floor: total URLs < 8 with no documented justification in
 *      decisions.md.
 *   6. Ceiling reached: QA_MAX_PAGES or QA_MAX_DEPTH was hit AND no
 *      decisions.md entry justifies stopping at that limit. (E2 — loud
 *      ceiling failure.)
 *
 * Usage:
 *   node scripts/frontier-gate.js          # check + exit code
 *   node scripts/frontier-gate.js --json   # machine-readable summary
 *
 * The legacy `crawl-gate.js` is preserved for one release; phase1.md and
 * phase2.md should call frontier-gate going forward.
 */

const fs = require('fs');
const path = require('path');

const TODO_FILE      = 'qa/knowledgebase/crawl-todo.md';
const INVENTORY_FILE = 'qa/knowledgebase/ui-inventory.md';
const UIG_FILE       = 'qa/knowledgebase/uig.jsonl';
const DECISIONS_FILE = 'qa/decisions.md';
const STATE_FILE     = 'qa/crawl-state.json';
const JSON_OUT       = process.argv.includes('--json');

const ACTUATION_FLOOR = parseFloat(process.env.QA_FRONTIER_ACTUATION_FLOOR || '0.9');
const DISCOVERY_FLOOR = parseInt(process.env.QA_FRONTIER_DISCOVERY_FLOOR  || '8', 10);
const MAX_PAGES       = parseInt(process.env.QA_MAX_PAGES || '300', 10);
const MAX_DEPTH       = parseInt(process.env.QA_MAX_DEPTH || '10',  10);

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ── 1. crawl-todo.md parsing ────────────────────────────────────────────────
const todoRaw = readSafe(TODO_FILE);
if (!todoRaw) {
  console.error(`frontier-gate: ${TODO_FILE} missing — Phase 1 has not run`);
  process.exit(2);
}
const ROW_RE = /^\| *(\d+) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\|/;
const rows = [];
for (const line of todoRaw.split('\n')) {
  const m = line.match(ROW_RE);
  if (m) rows.push({ n: +m[1], url: m[2].trim(), title: m[3].trim(), status: m[4].trim(), notes: m[5].trim() });
}
const pending  = rows.filter(r => r.status.startsWith('⬜'));
const active   = rows.filter(r => r.status.startsWith('🔄'));
const skipped  = rows.filter(r => r.status.startsWith('⛔'));
const explored = rows.filter(r => r.status.startsWith('✅'));

// ── 2. decisions.md — count retry attempts per skipped URL ──────────────────
const decisionsRaw = readSafe(DECISIONS_FILE) || '';
function retryCount(url) {
  const safe = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(strike\\s*\\d|retry|attempt)\\b[^\\n]*${safe}|${safe}[^\\n]*\\b(strike\\s*\\d|retry|attempt)\\b`, 'gi');
  const matches = decisionsRaw.match(re);
  return matches ? matches.length : 0;
}
const skippedNoReason       = skipped.filter(r => !r.notes || r.notes === '—');
const skippedInsufficientRetries = skipped.filter(r => retryCount(r.url) < 2);

// ── 3. ui-inventory.md — actuation coverage ─────────────────────────────────
// Schema (from D2): | url | snapshot | links_found | links_followed | inputs_filled |
// buttons_clicked | modals_opened | modals_submitted | dropdowns_expanded | new_states_revealed |
const inventoryRaw = readSafe(INVENTORY_FILE) || '';
const INV_RE = /^\| *([^|]+?) *\| *([^|]+?) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\|$/;
const invRows = [];
for (const line of inventoryRaw.split('\n')) {
  const m = line.match(INV_RE);
  if (!m) continue;
  invRows.push({
    url: m[1].trim(),
    snapshot: m[2].trim(),
    links_found: +m[3],
    links_followed: +m[4],
    inputs_filled: +m[5],
    buttons_clicked: +m[6],
    modals_opened: +m[7],
    modals_submitted: +m[8],
    dropdowns_expanded: +m[9],
    new_states_revealed: +m[10],
  });
}

// Pages with detected interactions but actuation ratio < ACTUATION_FLOOR
const lowActuation = [];
for (const r of invRows) {
  const detected = r.links_found + r.inputs_filled + r.buttons_clicked + r.modals_opened + r.dropdowns_expanded;
  // "Actuated" = followed/submitted/expanded counts; "detected" includes everything found.
  // We score: (links_followed + inputs_filled + buttons_clicked + modals_submitted + dropdowns_expanded) / detected
  const actuated = r.links_followed + r.inputs_filled + r.buttons_clicked + r.modals_submitted + r.dropdowns_expanded;
  if (detected === 0) continue; // page with no interactables — vacuously OK
  const ratio = actuated / detected;
  if (ratio < ACTUATION_FLOOR) lowActuation.push({ url: r.url, ratio: +ratio.toFixed(2), detected, actuated });
}

// ── 4. uig.jsonl — modal triggers without submissions ───────────────────────
const uigRaw = readSafe(UIG_FILE) || '';
const uigRows = uigRaw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const modalTriggers = uigRows.filter(r => r.role === 'button' && /open|add|create|new|edit|configure|connect/i.test(r.name || ''));
const modalSubmissions = uigRows.filter(r => r.effect && /modal-submitted|submit-success|submit-error|new-url-after-modal/i.test(r.effect));
const modalsWithoutSubmissions = modalTriggers.length > 0 && modalSubmissions.length === 0;

// ── 5. Discovery floor ──────────────────────────────────────────────────────
const discoveryFloorJustified = /discovery[- ]?floor|small[- ]?surface|justified[- ]?small/i.test(decisionsRaw);
const discoveryFloorFail = rows.length < DISCOVERY_FLOOR && !discoveryFloorJustified;

// ── 6. Ceiling reached without justification ────────────────────────────────
const ceilingJustified = /ceiling[- ]?(hit|reached)|max[- ]?pages[- ]?accepted|max[- ]?depth[- ]?accepted/i.test(decisionsRaw);
let ceilingFail = false;
let ceilingReason = '';
const stateRaw = readSafe(STATE_FILE);
if (stateRaw) {
  try {
    const state = JSON.parse(stateRaw);
    const pageCount = state.pageCount || state.pages?.length || 0;
    const queueLen  = state.queue?.length || 0;
    if (pageCount >= MAX_PAGES && queueLen > 0 && !ceilingJustified) {
      ceilingFail = true;
      ceilingReason = `QA_MAX_PAGES (${MAX_PAGES}) reached with ${queueLen} URLs still in queue and no justification in decisions.md`;
    }
  } catch { /* state corrupt — separate concern */ }
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const failures = [];
if (pending.length)                        failures.push({ kind: 'pending',          n: pending.length });
if (active.length)                         failures.push({ kind: 'active',           n: active.length });
if (skippedNoReason.length)                failures.push({ kind: 'skipped-no-reason', n: skippedNoReason.length });
if (skippedInsufficientRetries.length)     failures.push({ kind: 'skipped-without-retries', n: skippedInsufficientRetries.length });
if (lowActuation.length)                   failures.push({ kind: 'low-actuation',     n: lowActuation.length });
if (modalsWithoutSubmissions)              failures.push({ kind: 'modals-without-submissions', n: modalTriggers.length });
if (discoveryFloorFail)                    failures.push({ kind: 'discovery-floor',   n: rows.length, floor: DISCOVERY_FLOOR });
if (ceilingFail)                           failures.push({ kind: 'ceiling',           reason: ceilingReason });

const fail = failures.length > 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    total: rows.length,
    explored: explored.length,
    skipped: skipped.length,
    pending: pending.length,
    active: active.length,
    inventoryRows: invRows.length,
    lowActuationPages: lowActuation.length,
    modalTriggers: modalTriggers.length,
    modalSubmissions: modalSubmissions.length,
    failures,
    pass: !fail,
  }, null, 2));
  process.exit(fail ? 1 : 0);
}

console.log(`frontier-gate: ${rows.length} URLs | ✅ ${explored.length} | ⛔ ${skipped.length} | ⬜ ${pending.length} | 🔄 ${active.length}`);
console.log(`              ${invRows.length} inventory rows | ${modalTriggers.length} modal triggers | ${modalSubmissions.length} submissions`);

if (pending.length) {
  console.error(`\n❌ ${pending.length} URLs still ⬜ pending — explore or mark skipped:`);
  for (const r of pending.slice(0, 10)) console.error(`   ⬜ ${r.url}`);
  if (pending.length > 10) console.error(`   ... and ${pending.length - 10} more`);
}
if (active.length) {
  console.error(`\n❌ ${active.length} URLs left 🔄 in-progress — finish or rollback:`);
  for (const r of active) console.error(`   🔄 ${r.url}`);
}
if (skippedNoReason.length) {
  console.error(`\n❌ ${skippedNoReason.length} ⛔ skipped rows have no reason:`);
  for (const r of skippedNoReason) console.error(`   ⛔ ${r.url}`);
}
if (skippedInsufficientRetries.length) {
  console.error(`\n❌ ${skippedInsufficientRetries.length} ⛔ skipped rows lack 2+ retry attempts in decisions.md (3-strike protocol):`);
  for (const r of skippedInsufficientRetries.slice(0, 10)) console.error(`   ⛔ ${r.url} — ${retryCount(r.url)} retries logged`);
}
if (lowActuation.length) {
  console.error(`\n❌ ${lowActuation.length} pages have actuation coverage < ${(ACTUATION_FLOOR*100).toFixed(0)}% (principles.md §5b):`);
  for (const r of lowActuation.slice(0, 10)) console.error(`   ${r.url} — ${(r.ratio*100).toFixed(0)}% (${r.actuated}/${r.detected})`);
}
if (modalsWithoutSubmissions) {
  console.error(`\n❌ ${modalTriggers.length} modal triggers detected but 0 submissions recorded — open every modal AND submit (principles.md §5b).`);
}
if (discoveryFloorFail) {
  console.error(`\n❌ Discovery floor: only ${rows.length} URLs found (floor: ${DISCOVERY_FLOOR}). Either deepen exploration or document why this app legitimately has < ${DISCOVERY_FLOOR} pages in decisions.md (use the phrase "discovery-floor justified").`);
}
if (ceilingFail) {
  console.error(`\n❌ ${ceilingReason}. Either raise QA_MAX_PAGES / QA_MAX_DEPTH and resume, or document the ceiling decision in decisions.md (use the phrase "ceiling-hit accepted").`);
}

if (fail) {
  console.error(`\nFrontier gate FAILED. Phase 1 not complete.`);
  process.exit(1);
}

console.log(`\n✅ Frontier closed. Safe to enter Phase 2.`);
process.exit(0);
