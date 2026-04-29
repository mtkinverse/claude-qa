#!/usr/bin/env node
/**
 * inspect-snapshot.js — render an ARIA snapshot as readable text.
 *
 * The text replacement for "open the screenshot to see what the agent saw".
 *
 * Usage:
 *   node scripts/inspect-snapshot.js p01-home
 *   node scripts/inspect-snapshot.js p01-home --section buttons
 *   node scripts/inspect-snapshot.js qa/knowledgebase/aria-snapshots/p01-home.snapshot.json
 */

const fs = require('fs');
const path = require('path');

const args    = process.argv.slice(2);
const sectIx  = args.indexOf('--section');
const SECTION = sectIx !== -1 ? args[sectIx + 1] : null;
const TARGET  = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--section');

if (!TARGET) {
  console.error('Usage: node scripts/inspect-snapshot.js <slug-or-path> [--section headings|buttons|links|inputs|alerts|images]');
  process.exit(2);
}

const tryPaths = [
  TARGET,
  TARGET.endsWith('.json') ? TARGET : `${TARGET}.snapshot.json`,
  path.join('qa/knowledgebase/aria-snapshots', `${TARGET}.snapshot.json`),
  path.join('qa/knowledgebase/aria-snapshots', TARGET),
];
const file = tryPaths.find(p => fs.existsSync(p));
if (!file) { console.error(`Not found: ${TARGET}`); process.exit(2); }

const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const d = s.dom || {};

const printAll = !SECTION;

console.log(`File:   ${file}`);
console.log(`URL:    ${d.url || '(missing)'}`);
console.log(`Title:  ${d.title || '(empty)'}`);
if (s.capturedAt) console.log(`When:   ${s.capturedAt}`);
console.log(`ARIA:   ${s.aria ? 'present' : 'NULL'}`);
console.log('');

const show = (name) => printAll || SECTION === name;

if (show('headings')) {
  console.log(`HEADINGS (${(d.headings || []).length}):`);
  (d.headings || []).forEach(h => console.log(`  ${h.level}: ${h.text}`));
  console.log('');
}

if (show('buttons')) {
  console.log(`BUTTONS (${(d.buttons || []).length}):`);
  (d.buttons || []).forEach(b => {
    const role = b.role && b.role !== b.tag ? ` role=${b.role}` : '';
    const type = b.type ? ` type=${b.type}` : '';
    console.log(`  [${b.name || '(no name)'}]${role}${type}${b.visible === false ? ' (hidden)' : ''}`);
  });
  console.log('');
}

if (show('links')) {
  console.log(`LINKS (${(d.links || []).length}):`);
  (d.links || []).forEach(l => console.log(`  [${l.name || '(no text)'}] → ${l.href || '(no href)'}`));
  console.log('');
}

if (show('inputs')) {
  console.log(`INPUTS (${(d.inputs || []).length}):`);
  (d.inputs || []).forEach(i => {
    const label = i.placeholder || i.name || '(no label)';
    console.log(`  ${(i.type || i.tag).padEnd(8)} "${label}"`);
  });
  console.log('');
}

if (show('alerts')) {
  console.log(`ALERTS (${(d.alerts || []).length}):`);
  (d.alerts || []).forEach(a => console.log(`  ${a}`));
  if ((d.alerts || []).length === 0) console.log('  (none)');
  console.log('');
}

if (show('images')) {
  console.log(`IMAGES (${(d.images || []).length}):`);
  (d.images || []).slice(0, 20).forEach(im => console.log(`  alt="${im.alt || ''}" label="${im.label || ''}"`));
  if ((d.images || []).length > 20) console.log(`  ... and ${(d.images || []).length - 20} more`);
}
