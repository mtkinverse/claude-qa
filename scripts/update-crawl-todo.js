#!/usr/bin/env node
/**
 * update-crawl-todo.js — persistent URL coverage tracker for Phase 1
 *
 * Unlike exploration-state.md (which was overwritten each tick and only showed
 * the current page), this file ACCUMULATES across the whole session. It is the
 * primary anti-hallucination guard: a URL is only considered explored when it
 * is marked ✅ in this table.
 *
 * Output: qa/knowledgebase/crawl-todo.md  (append/update — never overwritten)
 *
 * Modes:
 *   --discover "url1,url2,..."   Register new URLs (no-ops for already-known ones)
 *   --mark-explored "url"        Mark a URL as ✅ explored
 *   --mark-skipped  "url"        Mark a URL as ⛔ skipped (with optional --reason)
 *   --mark-active   "url"        Mark a URL as 🔄 in-progress
 *   --status                     Print current counts to stdout
 *
 * SPA states: for single-URL apps where panels/modals share one URL, register
 * synthetic keys of the form "<url>#<state-slug>" — e.g.
 *   --discover "https://app/dashboard#assistants,https://app/dashboard#ai-models"
 * Each synthetic key is treated as a distinct row and gated by crawl-gate.js
 * exactly like a real URL. Use whenever a snapshot is captured under a custom
 * label that maps to a DOM state, not a navigation.
 *
 * Example tick (call both after every BFS page):
 *   node scripts/update-crawl-todo.js --discover "/settings,/profile,/admin"
 *   node scripts/update-crawl-todo.js --mark-explored "/dashboard"
 */

const fs   = require('fs');
const path = require('path');

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg  = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : null; };
const has  = (flag) => argv.includes(flag);

const DISCOVER      = arg('--discover');
const MARK_EXPLORED = arg('--mark-explored');
const MARK_SKIPPED  = arg('--mark-skipped');
const MARK_ACTIVE   = arg('--mark-active');
const REASON        = arg('--reason') || '';
const STATUS_ONLY   = has('--status');

const OUT = 'qa/knowledgebase/crawl-todo.md';

// ── Parse existing table ──────────────────────────────────────────────────────
const HEADER_RE = /^\| *#/;
const ROW_RE    = /^\| *(\d+) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\| *(.*?) *\|/;

function parseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(ROW_RE);
    if (m) rows.push({ n: parseInt(m[1]), url: m[2].trim(), title: m[3].trim(), status: m[4].trim(), notes: m[5].trim() });
  }
  return rows;
}

function normalise(url) {
  // Strip trailing slash for dedup (except bare "/")
  return url.replace(/\/$/, '') || '/';
}

function statusIcon(s) {
  if (s.startsWith('✅')) return '✅ explored';
  if (s.startsWith('⛔')) return '⛔ skipped';
  if (s.startsWith('🔄')) return '🔄 in-progress';
  return '⬜ pending';
}

function renderTable(rows) {
  const lines = [];
  lines.push('| # | URL | Title | Status | Notes |');
  lines.push('|---|-----|-------|--------|-------|');
  for (const r of rows) {
    lines.push(`| ${r.n} | ${r.url} | ${r.title} | ${r.status} | ${r.notes} |`);
  }
  return lines.join('\n');
}

// ── Load or initialise ────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });

let existing = '';
if (fs.existsSync(OUT)) existing = fs.readFileSync(OUT, 'utf8');

let rows = parseTable(existing);

// ── Apply operations ──────────────────────────────────────────────────────────
function findRow(url) {
  const n = normalise(url);
  return rows.find(r => normalise(r.url) === n);
}

function addRow(url) {
  const n = normalise(url);
  if (!rows.find(r => normalise(r.url) === n)) {
    rows.push({ n: rows.length + 1, url: n, title: '—', status: '⬜ pending', notes: '' });
  }
}

function updateStatus(url, status, notes) {
  const r = findRow(url);
  if (r) {
    r.status = status;
    if (notes) r.notes = notes;
  } else {
    // Auto-register if not seen yet
    addRow(url);
    updateStatus(url, status, notes);
  }
}

if (DISCOVER) {
  for (const u of DISCOVER.split(',').map(s => s.trim()).filter(Boolean)) addRow(u);
}
if (MARK_ACTIVE)   updateStatus(MARK_ACTIVE,   '🔄 in-progress', REASON);
if (MARK_EXPLORED) updateStatus(MARK_EXPLORED, '✅ explored',     REASON);
if (MARK_SKIPPED)  updateStatus(MARK_SKIPPED,  '⛔ skipped',      REASON || 'no reason given');

// Renumber after any inserts
rows.forEach((r, i) => { r.n = i + 1; });

// ── Counts ────────────────────────────────────────────────────────────────────
const total    = rows.length;
const explored = rows.filter(r => r.status.startsWith('✅')).length;
const skipped  = rows.filter(r => r.status.startsWith('⛔')).length;
const active   = rows.filter(r => r.status.startsWith('🔄')).length;
const pending  = rows.filter(r => r.status.startsWith('⬜')).length;

if (STATUS_ONLY) {
  console.log(`crawl-todo: ${total} total | ✅ ${explored} explored | 🔄 ${active} active | ⬜ ${pending} pending | ⛔ ${skipped} skipped`);
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────────
const updated = new Date().toISOString();

const out = [
  `# Crawl TODO — Coverage Tracker`,
  ``,
  `> Persistent URL tracker for Phase 1. Append-only — never overwritten.`,
  `> A URL is only "explored" when marked ✅. Use this to avoid hallucinating coverage.`,
  ``,
  `**Updated**: ${updated}`,
  `**Queue**: ⬜ ${pending} pending | 🔄 ${active} active | ✅ ${explored} explored | ⛔ ${skipped} skipped | **${total} total**`,
  ``,
  renderTable(rows),
  ``,
  `---`,
  ``,
  `Usage:`,
  `\`\`\`bash`,
  `# Register newly discovered links (no-ops for known URLs)`,
  `node scripts/update-crawl-todo.js --discover "/page1,/page2"`,
  ``,
  `# Mark current page done`,
  `node scripts/update-crawl-todo.js --mark-explored "/current-page"`,
  ``,
  `# Skip a URL (with reason)`,
  `node scripts/update-crawl-todo.js --mark-skipped "/admin" --reason "no admin creds"`,
  ``,
  `# Print counts`,
  `node scripts/update-crawl-todo.js --status`,
  `\`\`\``,
].join('\n') + '\n';

fs.writeFileSync(OUT, out);
console.log(`✅ crawl-todo.md — ${total} total | ✅ ${explored} | 🔄 ${active} | ⬜ ${pending} | ⛔ ${skipped}`);
