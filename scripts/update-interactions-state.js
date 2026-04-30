#!/usr/bin/env node
/**
 * update-interactions-state.js
 * Tracks per-element interactive frontier (not just URL-level coverage).
 * Mirrors the CLI shape of update-crawl-todo.js.
 *
 * Usage:
 *   node scripts/update-interactions-state.js --discover-from-uig <uig.jsonl>
 *   node scripts/update-interactions-state.js --mark-exercised <fingerprint>
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_PATH = path.join(process.cwd(), 'qa', 'knowledgebase', 'interactions-state.json');

function fingerprint(row) {
  // Stable across re-renders — excludes CSS class and nth-child
  const key = [row.page || '', row.role || '', row.name || '', row.scope || ''].join('|');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { explored: {}, queue: [] };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { explored: {}, queue: [] }; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const args = process.argv.slice(2);
const cmd  = args[0];

if (cmd === '--discover-from-uig') {
  const uigPath = args[1];
  if (!uigPath || !fs.existsSync(uigPath)) {
    console.error(`[interactions-state] UIG file not found: ${uigPath}`);
    process.exit(1);
  }
  const state = loadState();
  const lines = fs.readFileSync(uigPath, 'utf8').split('\n').filter(Boolean);
  let added = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const fp  = fingerprint(row);
      if (!state.explored[fp] && !state.queue.find(q => q.fingerprint === fp)) {
        state.queue.push({
          url:            row.page || '',
          role:           row.role || '',
          name:           row.name || '',
          fingerprint:    fp,
          parent_section: row.scope || '',
          depth:          0,
          source_flow:    row.flowId || null,
          fork_of:        null,
        });
        added++;
      }
    } catch {}
  }
  saveState(state);
  console.log(`[interactions-state] Discovered ${added} new interactives from UIG (total queue: ${state.queue.length})`);

} else if (cmd === '--mark-exercised') {
  const fp = args[1];
  if (!fp) { console.error('[interactions-state] --mark-exercised requires a fingerprint'); process.exit(1); }
  const state = loadState();
  const idx   = state.queue.findIndex(q => q.fingerprint === fp);
  if (idx !== -1) {
    const item = state.queue.splice(idx, 1)[0];
    state.explored[fp] = { ...item, exercised_at: new Date().toISOString() };
    saveState(state);
    console.log(`[interactions-state] Marked exercised: ${fp}`);
  } else if (state.explored[fp]) {
    console.log(`[interactions-state] Already exercised: ${fp}`);
  } else {
    console.warn(`[interactions-state] Fingerprint not found in queue: ${fp}`);
  }

} else if (cmd === '--status') {
  const state = loadState();
  const total   = Object.keys(state.explored).length + state.queue.length;
  const explored = Object.keys(state.explored).length;
  const ratio    = total > 0 ? (explored / total).toFixed(2) : 'N/A';
  console.log(`Explored: ${explored} / ${total} (ratio: ${ratio})`);
  console.log(`Queue remaining: ${state.queue.length}`);

} else {
  console.log('Usage:');
  console.log('  node scripts/update-interactions-state.js --discover-from-uig <uig.jsonl>');
  console.log('  node scripts/update-interactions-state.js --mark-exercised <fingerprint>');
  console.log('  node scripts/update-interactions-state.js --status');
  process.exit(1);
}
