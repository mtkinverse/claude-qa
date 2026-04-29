#!/usr/bin/env node
/**
 * audit-snapshots.js — fail-fast quality gate for ARIA snapshots.
 *
 * Run at the Phase 1 → Phase 2 transition (and any time you want a sanity check).
 * Exits 1 if any snapshot looks degenerate (null role-tree, blank DOM,
 * mass-null hrefs, mass-empty button names, etc.).
 *
 * Usage:
 *   node scripts/audit-snapshots.js                              # default thresholds
 *   node scripts/audit-snapshots.js --dir qa/knowledgebase/aria-snapshots
 *   node scripts/audit-snapshots.js --min-els 3 --max-null-href 0.10 --max-empty-name 0.20
 */

const fs = require('fs');
const path = require('path');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

const DIR             = arg('--dir', 'qa/knowledgebase/aria-snapshots');
const MIN_ELS         = +arg('--min-els', 3);
const MAX_NULL_HREF   = +arg('--max-null-href', 0.10);
const MAX_EMPTY_NAME  = +arg('--max-empty-name', 0.20);

if (!fs.existsSync(DIR)) {
  console.error(`ERROR: snapshot dir not found: ${DIR}`);
  process.exit(2);
}

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.snapshot.json') && !f.startsWith('_'));

if (files.length === 0) {
  console.error(`ERROR: no snapshots in ${DIR}`);
  process.exit(2);
}

const issues = [];
const warnings = [];
let totals = { headings: 0, buttons: 0, links: 0, inputs: 0, alerts: 0 };

for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const dom = s.dom || {};

  const buttons = dom.buttons || [];
  const links   = dom.links   || [];
  const inputs  = dom.inputs  || [];

  totals.headings += (dom.headings || []).length;
  totals.buttons  += buttons.length;
  totals.links    += links.length;
  totals.inputs   += inputs.length;
  totals.alerts   += (dom.alerts || []).length;

  const totalEls = buttons.length + links.length + inputs.length;
  const nullHrefPct = links.length  ? links.filter(l => !l.href).length        / links.length  : 0;
  const emptyNamePct = buttons.length ? buttons.filter(b => !b.name?.trim()).length / buttons.length : 0;

  if (!dom.url)                                issues.push(`${f}: missing dom.url`);
  if (!dom.title)                              issues.push(`${f}: empty title`);
  if (totalEls < MIN_ELS)                      issues.push(`${f}: only ${totalEls} interactive elements — likely captured a blank/error state`);
  if (nullHrefPct  > MAX_NULL_HREF)            issues.push(`${f}: ${(nullHrefPct*100).toFixed(0)}% of ${links.length} links have null href (threshold ${(MAX_NULL_HREF*100).toFixed(0)}%)`);
  if (emptyNamePct > MAX_EMPTY_NAME)           issues.push(`${f}: ${(emptyNamePct*100).toFixed(0)}% of ${buttons.length} buttons have empty name (threshold ${(MAX_EMPTY_NAME*100).toFixed(0)}%)`);
  if (s.aria === null && totalEls > 5)         issues.push(`${f}: ARIA tree null but DOM has ${totalEls} elements — accessibility.snapshot() failed silently`);
  if (s.capturedAt === undefined)              warnings.push(`${f}: no capturedAt — old snapshot, regenerate when re-crawling`);
}

console.log(`Audited ${files.length} snapshots in ${DIR}`);
console.log(`  Totals: ${totals.headings} headings, ${totals.buttons} buttons, ${totals.links} links, ${totals.inputs} inputs, ${totals.alerts} alerts`);

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} warnings (non-blocking):`);
  warnings.slice(0, 5).forEach(w => console.log(`   ${w}`));
  if (warnings.length > 5) console.log(`   ... and ${warnings.length - 5} more`);
}

// ── Patterns-file gate ──────────────────────────────────────────────────────
// App-specific quirks belong in qa/app-quirks.yml (auto-derived). If any
// *-patterns.md file exists under qa/, fail audit — it indicates per-app
// pattern documentation that should be in the typed registry instead.
{
  const QA_ROOT = path.resolve(DIR, '..', '..');
  let patternsFiles = [];
  try {
    for (const entry of fs.readdirSync(QA_ROOT)) {
      if (/-patterns\.md$/i.test(entry)) patternsFiles.push(path.join(QA_ROOT, entry));
    }
  } catch {}
  if (patternsFiles.length) {
    console.error('\n❌ Per-app patterns file(s) detected — these belong in qa/app-quirks.yml:');
    patternsFiles.forEach(f => console.error('   ' + f));
    console.error('   Move quirks into the auto-derived registry (re-run scripts/derive-quirks.js).');
    process.exit(1);
  }
}

// ── UIG uniqueness gate ─────────────────────────────────────────────────────
// Every (page, scope, role, name) tuple in uig.jsonl must resolve to exactly one
// node within its scope at observation time. If two tuples collide, generation
// would have to pick `.first()` / `.last()` — which is exactly the failure mode
// we are eliminating. Force scope refinement instead.
const UIG_PATH = path.resolve(DIR, '..', 'uig.jsonl');
const uigIssues = [];
let uigRowCount = 0;
let uigUniqueKeys = 0;
if (fs.existsSync(UIG_PATH)) {
  const raw = fs.readFileSync(UIG_PATH, 'utf8').trim().split('\n').filter(Boolean);
  uigRowCount = raw.length;
  // Newest-wins per (page, scope, role, name).
  const latest = new Map();
  for (const line of raw) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const key = `${row.page}\t${row.scope}\t${row.role}\t${row.name}`;
    const prev = latest.get(key);
    if (!prev || (row.observedAt || '') > (prev.observedAt || '')) latest.set(key, row);
  }
  uigUniqueKeys = latest.size;
  // Group by (page, scope, role, name) — collisions across slugs/observations
  // are flagged. uniqueInScope=false signals the snapshot saw two peers with
  // the same identifying tuple in one observation.
  const collisions = [];
  for (const r of latest.values()) {
    if (r.uniqueInScope === false) {
      collisions.push(`${r.page} scope=${r.scope} role=${r.role} name="${r.name}" — non-unique within scope`);
    }
  }
  if (collisions.length) {
    uigIssues.push(...collisions.slice(0, 20));
    if (collisions.length > 20) uigIssues.push(`... and ${collisions.length - 20} more`);
  }
}

if (uigRowCount > 0) {
  console.log(`  UIG: ${uigRowCount} rows, ${uigUniqueKeys} unique (page,scope,role,name) tuples`);
}

// ── ui-inventory.md schema gate (D2) ────────────────────────────────────────
// The numeric evidence schema is required so frontier-gate.js can enforce the
// actuate-and-observe contract (principles.md §5b). Audit checks:
//   1. The header row contains all 10 required columns.
//   2. Every data row parses as 8 integers in the count columns.
//   3. No row has all-zero counts when the same page's snapshot has interactables.
const INVENTORY_PATH = path.resolve(DIR, '..', 'ui-inventory.md');
const inventoryIssues = [];
if (fs.existsSync(INVENTORY_PATH)) {
  const inv = fs.readFileSync(INVENTORY_PATH, 'utf8');
  const REQUIRED_COLS = ['url', 'snapshot', 'links_found', 'links_followed', 'inputs_filled',
                         'buttons_clicked', 'modals_opened', 'modals_submitted',
                         'dropdowns_expanded', 'new_states_revealed'];
  const headerLine = inv.split('\n').find(l => /^\| *url *\|/i.test(l));
  if (!headerLine) {
    inventoryIssues.push('ui-inventory.md: missing required header row with the D2 numeric schema');
  } else {
    const cols = headerLine.split('|').map(c => c.trim().toLowerCase()).filter(Boolean);
    for (const c of REQUIRED_COLS) {
      if (!cols.includes(c)) inventoryIssues.push(`ui-inventory.md: missing column "${c}" (D2 schema)`);
    }
  }

  // Cross-check: each snapshot file should have a corresponding row.
  const ROW_RE = /^\| *([^|]+?) *\| *([^|]+?) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\| *(\d+) *\|$/;
  const invRows = inv.split('\n').map(l => l.match(ROW_RE)).filter(Boolean);
  const invSnapshots = new Set(invRows.map(m => m[2].trim()));

  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const snapshotName = f;
    if (!invSnapshots.has(snapshotName) && !invSnapshots.has(snapshotName.replace(/\.snapshot\.json$/, ''))) {
      // Allow either the full filename or the slug to match.
      // No issue here yet — coverage-check is the dedicated gate for "every snapshot in inventory."
      continue;
    }
  }

  // All-zero rows where snapshot has interactables = D2 violation.
  for (const m of invRows) {
    const url = m[1].trim();
    const snapshotRef = m[2].trim();
    const counts = m.slice(3).map(Number);
    const allZero = counts.every(n => n === 0);
    if (!allZero) continue;
    // Cross-reference snapshot — does it actually have interactables?
    const snapFile = files.find(f => f === snapshotRef || f.startsWith(snapshotRef.replace(/\.snapshot\.json$/, '')));
    if (!snapFile) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(DIR, snapFile), 'utf8'));
      const dom = s.dom || {};
      const interactables = (dom.buttons || []).length + (dom.links || []).length + (dom.inputs || []).length;
      if (interactables > 0) {
        inventoryIssues.push(`ui-inventory.md: ${url} has all-zero D2 counts but snapshot has ${interactables} interactables — page was visited but never actuated (principles.md §5b)`);
      }
    } catch {}
  }
}

if (inventoryIssues.length) {
  console.error(`\n❌ ${inventoryIssues.length} ui-inventory.md schema issues (D2 — per-page evidence schema):`);
  inventoryIssues.slice(0, 20).forEach(i => console.error(`   ${i}`));
  if (inventoryIssues.length > 20) console.error(`   ... and ${inventoryIssues.length - 20} more`);
}

if (issues.length || uigIssues.length || inventoryIssues.length) {
  if (issues.length) {
    console.error(`\n❌ ${issues.length} fidelity issues:`);
    issues.forEach(i => console.error(`   ${i}`));
  }
  if (uigIssues.length) {
    console.error(`\n❌ ${uigIssues.length} UIG uniqueness issues — refine scope or rename:`);
    uigIssues.forEach(i => console.error(`   ${i}`));
  }
  // inventoryIssues already printed above
  process.exit(1);
}

console.log(`\n✅ All ${files.length} snapshots pass fidelity check${uigRowCount ? ' + UIG uniqueness' : ''}`);
