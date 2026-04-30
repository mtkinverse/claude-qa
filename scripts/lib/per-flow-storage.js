/**
 * per-flow-storage.js — isolates Playwright storageState per flow for parallel authoring.
 * Copies the shared user.json to a per-flow copy before the flow starts,
 * then merges it back (keeping newer cookie timestamps) when the flow ends.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const AUTH_DIR  = path.join(process.cwd(), 'qa', '.auth');
const BASE_AUTH = path.join(AUTH_DIR, 'user.json');

/**
 * Returns the per-flow storageState path and copies from shared base.
 * @param {string} flowId  e.g. "F-001"
 * @returns {string} path to the per-flow storageState file
 */
function allocateStorage(flowId) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const flowAuth = path.join(AUTH_DIR, `${flowId}.json`);
  if (fs.existsSync(BASE_AUTH)) {
    fs.copyFileSync(BASE_AUTH, flowAuth);
    console.log(`[per-flow-storage] Allocated ${flowId}.json from user.json`);
  } else {
    fs.writeFileSync(flowAuth, JSON.stringify({ cookies: [], origins: [] }));
    console.log(`[per-flow-storage] Allocated ${flowId}.json (no base auth)`);
  }
  return flowAuth;
}

/**
 * Merges a per-flow storageState back into the shared user.json.
 * Cookie merge: for duplicate names, keep the one with the newer `expires`.
 * @param {string} flowId
 */
function releaseStorage(flowId) {
  const flowAuth = path.join(AUTH_DIR, `${flowId}.json`);
  if (!fs.existsSync(flowAuth)) return;

  let base = { cookies: [], origins: [] };
  if (fs.existsSync(BASE_AUTH)) {
    try { base = JSON.parse(fs.readFileSync(BASE_AUTH, 'utf8')); }
    catch {}
  }

  let flow;
  try { flow = JSON.parse(fs.readFileSync(flowAuth, 'utf8')); }
  catch { return; }

  // Merge cookies: flow cookie wins if expires is newer (or base has no matching cookie)
  const merged = [...base.cookies];
  for (const fc of (flow.cookies || [])) {
    const idx = merged.findIndex(bc => bc.name === fc.name && bc.domain === fc.domain);
    if (idx === -1) { merged.push(fc); }
    else if ((fc.expires || 0) > (merged[idx].expires || 0)) { merged[idx] = fc; }
  }

  base.cookies = merged;
  fs.writeFileSync(BASE_AUTH, JSON.stringify(base, null, 2));
  console.log(`[per-flow-storage] Merged ${flowId}.json back into user.json`);
}

module.exports = { allocateStorage, releaseStorage };
