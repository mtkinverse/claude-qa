#!/usr/bin/env node
/**
 * derive-quirks.js — auto-generate qa/app-quirks.yml from observed evidence.
 *
 * Replaces hand-curated *-patterns.md files. Phase 3 reads the resulting YAML
 * to drive selector disambiguation, console-error filtering, and overlay
 * handling — no per-app prose anywhere in the test code.
 *
 * Inputs (read-only):
 *   qa/knowledgebase/uig.jsonl              — interactable graph
 *   qa/knowledgebase/aria-snapshots/*.json  — for overlay registry + heading text
 *   qa/flows/F-NNN-*\/trace.jsonl           — recorded actions per flow
 *   qa/decisions.md                         — wiggle-pass + login-engage events
 *
 * Outputs:
 *   qa/app-quirks.yml                       — human-readable, hand-editable
 *   qa/.app-quirks.json                     — runtime sidecar (heal.js, generated specs)
 *
 * Usage:
 *   node scripts/derive-quirks.js
 *   node scripts/derive-quirks.js --qa qa --out qa/app-quirks.yml
 */

const fs = require('fs');
const path = require('path');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

const QA  = arg('--qa', 'qa');
const OUT = arg('--out', path.join(QA, 'app-quirks.yml'));

const UIG_PATH       = path.join(QA, 'knowledgebase', 'uig.jsonl');
const SNAPSHOT_DIR   = path.join(QA, 'knowledgebase', 'aria-snapshots');
const FLOWS_DIR      = path.join(QA, 'flows');
const DECISIONS_PATH = path.join(QA, 'decisions.md');

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJsonDir(dir, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(suffix)).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean);
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Disambiguation — when the same (role, name) appears in ≥2 scopes on the
//    same page, every test must scope-prefix to disambiguate. Emit one entry
//    per (role, name) listing the observed scopes.
// ────────────────────────────────────────────────────────────────────────────
function deriveDisambiguation(uigRows) {
  // Newest-wins per (page, scope, role, name) — same logic as audit-snapshots.js.
  const latest = new Map();
  for (const r of uigRows) {
    const key = `${r.page}\t${r.scope}\t${r.role}\t${r.name}`;
    const prev = latest.get(key);
    if (!prev || (r.observedAt || '') > (prev.observedAt || '')) latest.set(key, r);
  }
  // Group by (page, role, name) → list scopes.
  const groups = new Map();
  for (const r of latest.values()) {
    if (!r.name) continue;
    const k = `${r.page}\t${r.role}\t${r.name}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.scope);
  }
  const out = [];
  for (const [k, scopes] of groups) {
    const unique = [...new Set(scopes)];
    if (unique.length >= 2) {
      const [page, role, name] = k.split('\t');
      out.push({ page, role, name, scopes: unique });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Toggle pairs — buttons whose `name` mutates after click. Detected from
//    UIG rows tagged with `wiggleEvidence` whose `before/after` differ in name,
//    or from trace.jsonl events with paired observations on the same uig_ref.
// ────────────────────────────────────────────────────────────────────────────
function deriveTogglePairs(uigRows, traceEvents) {
  const pairs = [];
  // From trace events: pre/post observations on same uig_ref with different names.
  // For now, infer from common toggle vocabulary present in the UIG itself.
  const names = new Set(uigRows.map(r => r.name).filter(Boolean));
  const KNOWN_PAIRS = [
    ['Show password', 'Hide password'],
    ['Show', 'Hide'],
    ['Expand', 'Collapse'],
    ['Mute', 'Unmute'],
    ['Play', 'Pause'],
    ['Sign in', 'Create account'],
    ['Log in', 'Sign up'],
  ];
  for (const [a, b] of KNOWN_PAIRS) {
    if (names.has(a) && names.has(b)) pairs.push([a, b]);
  }
  return pairs;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Console allowlist — errors that fire on >50% of distinct pages without
//    user interaction = app-side noise (analytics, telemetry endpoints
//    failing). Read from any classifier-log.jsonl or per-snapshot console
//    arrays if recorded; fall back to generic regexes.
// ────────────────────────────────────────────────────────────────────────────
function deriveConsoleAllowlist(snapshots) {
  // Always include the generic analytics regex so it's usable even when no
  // page-specific evidence exists.
  const generic = [
    'Analytics tracking error',
    'FunctionsFetchError',
    /\bGA4?\b|gtag/.source,
    'Failed to send a request to the Edge Function',
  ];
  // Future: scan a classifier-log.jsonl that records console errors per snapshot.
  return generic;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. SPA query drops — when a trace.jsonl `goto` event records an intended URL
//    with query params and the post-action snapshot URL is missing them.
//    Detected as patterns like "?mode=signin → /account" with no query.
// ────────────────────────────────────────────────────────────────────────────
function deriveSpaQueryDrops(traceEvents) {
  const drops = new Set();
  for (const ev of traceEvents) {
    if (ev.action !== 'goto' || !ev.url || !ev.evidence) continue;
    try {
      const intended = new URL(ev.url);
      const settled = new URL(ev.evidence.url || ev.url);
      // If intended has search params but settled doesn't (or differs)
      if (intended.search && !settled.search) {
        for (const [k, v] of intended.searchParams) drops.add(`${k}=${v}`);
      }
    } catch {}
  }
  return [...drops];
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Overlay registry — every dialog / aria-modal / fixed-inset overlay seen
//    during exploration. Emit `id`, `detect` (heading or aria-label), and a
//    pointer to the recorded dismiss trace if one exists.
// ────────────────────────────────────────────────────────────────────────────
function deriveOverlays(snapshots, uigRows) {
  const seen = new Map();
  for (const s of snapshots) {
    const overlays = s.dom?.overlays || [];
    for (const o of overlays) {
      const key = `${o.role}|${o.label}`.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { id: slug(o.label || o.role), detect: { role: 'heading', name: o.label || '' } });
      }
    }
    // Also from UIG rows whose scope starts with "dialog[" or "overlay["
    for (const r of (uigRows || [])) {
      const m = /^(dialog|overlay)\[([^\]]+)\]/.exec(r.scope || '');
      if (m && m[2]) {
        const key = `${m[1]}|${m[2]}`.toLowerCase();
        if (!seen.has(key)) seen.set(key, { id: slug(m[2]), detect: { role: 'heading', name: m[2] } });
      }
    }
  }
  return [...seen.values()];
}

function slug(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'overlay';
}

// ────────────────────────────────────────────────────────────────────────────
// YAML emission — no external dep. The output is structurally simple.
// ────────────────────────────────────────────────────────────────────────────
function yamlEmit(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => `${pad}- ${yamlEmit(item, indent + 2).replace(/^\s+/, '')}`).join('\n');
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    return keys.map(k => {
      const v = obj[k];
      const isComplex = (Array.isArray(v) && v.length) || (typeof v === 'object' && v !== null && !Array.isArray(v));
      if (isComplex) return `${pad}${k}:\n${yamlEmit(v, indent + 2)}`;
      return `${pad}${k}: ${yamlEmit(v, indent + 2)}`;
    }).join('\n');
  }
  return String(obj);
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(QA)) {
    console.error(`ERROR: qa workspace not found at ${QA}`);
    process.exit(2);
  }

  const uigRows = readJsonl(UIG_PATH);
  const snapshots = readJsonDir(SNAPSHOT_DIR, '.snapshot.json');

  // Aggregate trace events from every flow.
  const traceEvents = [];
  if (fs.existsSync(FLOWS_DIR)) {
    for (const flowDir of fs.readdirSync(FLOWS_DIR)) {
      const tracePath = path.join(FLOWS_DIR, flowDir, 'trace.jsonl');
      traceEvents.push(...readJsonl(tracePath));
    }
  }

  const quirks = {
    // ⚠ Auto-generated by scripts/derive-quirks.js — re-runs may overwrite manual edits.
    //   Hand-edits land in the same file but should be marked with `# manual:` comments.
    generatedAt: new Date().toISOString(),
    disambiguation: deriveDisambiguation(uigRows),
    toggle_pairs: deriveTogglePairs(uigRows, traceEvents),
    console_allowlist: deriveConsoleAllowlist(snapshots),
    spa_query_drops: deriveSpaQueryDrops(traceEvents),
    overlays: deriveOverlays(snapshots, uigRows),
  };

  const yaml = `# qa/app-quirks.yml — auto-generated by scripts/derive-quirks.js
# Read by Phase 3 transpiler and self-heal cascade. Replaces *-patterns.md.
# Hand edits welcome but optional — re-running this script will overwrite.

${yamlEmit(quirks)}
`;

  fs.writeFileSync(OUT, yaml);

  // Runtime sidecar: same data, machine-readable. heal.js + generated specs
  // read this instead of parsing YAML — avoids hand-parser fragility and
  // preserves regex strings exactly.
  const jsonOut = path.join(path.dirname(OUT), '.app-quirks.json');
  fs.writeFileSync(jsonOut, JSON.stringify(quirks, null, 2));

  console.log(`✅ ${OUT}`);
  console.log(`✅ ${jsonOut}`);
  console.log(`   disambiguation:    ${quirks.disambiguation.length}`);
  console.log(`   toggle_pairs:      ${quirks.toggle_pairs.length}`);
  console.log(`   console_allowlist: ${quirks.console_allowlist.length}`);
  console.log(`   spa_query_drops:   ${quirks.spa_query_drops.length}`);
  console.log(`   overlays:          ${quirks.overlays.length}`);
}

main();
