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

if (issues.length) {
  console.error(`\n❌ ${issues.length} fidelity issues:`);
  issues.forEach(i => console.error(`   ${i}`));
  process.exit(1);
}

console.log(`\n✅ All ${files.length} snapshots pass fidelity check`);
