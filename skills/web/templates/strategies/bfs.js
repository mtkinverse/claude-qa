/**
 * BFS discovery strategy — copy to qa/scripts/bfs.js at W-2.4
 * Strategy: skills/web/strategies/bfs.md
 * Fallback: targeted-trace (switch when BFS finds > 20 pages with low interaction density)
 *
 * EVERY TICK CONTRACT (8 steps — all mandatory):
 * 1. snapshotPage()       → snapshot.json + uig.jsonl append
 * 2. wigglePass()         → if disabled CTA on critical path
 * 3. update-crawl-todo    → --discover new links
 * 4. update-crawl-todo    → --mark-explored current URL
 * 5. update-interactions  → --discover-from-uig
 * 6. outcome-classifier   → progress.jsonl
 * 7. manifest.jsonl       → write step as done
 * 8. TraceRecorder        → record interaction → trace.jsonl
 */
'use strict';

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

// ── Adapt these to the app fingerprint ───────────────────────────────────────
const TARGET_URL  = process.env.QA_TARGET_URL || 'https://example.com';
const QA_DIR      = path.resolve(process.env.QA_DIR || './qa');
const NAV_TIMEOUT = parseInt(process.env.QA_NAV_TIMEOUT || '30000', 10);
const MAX_PAGES   = parseInt(process.env.QA_MAX_PAGES   || '50',    10);
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const KB_DIR    = path.join(QA_DIR, 'knowledgebase');
const FLOWS_DIR = path.join(QA_DIR, 'flows');
const AUTH_PATH = path.join(QA_DIR, '.auth', 'user.json');
const UIG_PATH  = path.join(KB_DIR, 'uig.jsonl');

const snapshotPage  = require('./snapshot-page');
const TraceRecorder = require('../trace-recorder');
const wigglePass    = require('../wiggle-pass');

// Positive nav whitelist
const SAFE_NAV = /view|open|go.to|see.all|see.more|more|details|explore|learn|visit|show|browse|discover|manage|dashboard|settings|profile|upgrade|pricing|docs|help|support|about/i;
// Dismissal/bypass labels — never the first pick when any other element exists
const DEPRIORITIZE = /skip|later|maybe|not.?now|dismiss|set.?up.?later|i'?ll.?do.?this.?later/i;

function run_script(cmd) {
  execSync(`node ${cmd}`, { cwd: REPO_ROOT, stdio: 'inherit' });
}

async function tick(page, url, flowId, recorder, stepNum) {
  const slug = `s${String(stepNum).padStart(2, '0')}-${url.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}`;

  // Step 1: Snapshot + UIG
  const snap = await snapshotPage(page, { slug, kbDir: KB_DIR, uigPath: UIG_PATH });

  // Step 2: Wiggle-pass for disabled CTAs on critical path
  const disabledCTAs = (snap.dom && snap.dom.buttons || []).filter(b => b.disabled && b.name);
  for (const cta of disabledCTAs) {
    await wigglePass(page, { scope: cta.scope, ctaSlug: cta.slug, uigPath: UIG_PATH });
  }

  // Steps 3+4: Crawl-todo
  const newLinks = ((snap.dom && snap.dom.links) || []).map(l => l.href).filter(Boolean).join(',');
  if (newLinks) run_script(`scripts/update-crawl-todo.js --discover "${newLinks}"`);
  run_script(`scripts/update-crawl-todo.js --mark-explored "${url}"`);

  // Step 5: Interaction frontier
  run_script(`scripts/update-interactions-state.js --discover-from-uig "${UIG_PATH}"`);

  // Step 6: Outcome classifier → progress.jsonl
  const outcome = snap.ariaFidelity === 'low' ? 'low-fidelity' : 'observed';
  fs.appendFileSync(path.join(QA_DIR, 'progress.jsonl'),
    JSON.stringify({ step: stepNum, url, slug, outcome, ts: new Date().toISOString() }) + '\n');

  // Step 7: Manifest
  const manifestPath = path.join(FLOWS_DIR, flowId, 'manifest.jsonl');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.appendFileSync(manifestPath,
    JSON.stringify({ step: stepNum, action: 'goto', target: url, status: 'done', ts: new Date().toISOString() }) + '\n');

  // Step 8: TraceRecorder
  recorder.interaction({ action: 'goto', target: url, uig_ref: slug, outcome,
    effect: { type: 'navigated', evidence: page.url() } });

  return snap;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_PATH) ? AUTH_PATH : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const flowId  = `F-bfs-${Date.now()}`;
  const recorder = new TraceRecorder(flowId);
  const visited  = new Set();
  const queue    = [TARGET_URL];
  let   stepNum  = 0;

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    console.log(`[bfs] Visiting (${visited.size}/${MAX_PAGES}): ${url}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    } catch (e) {
      console.warn(`[bfs] goto failed for ${url}: ${e.message}`);
      continue;
    }
    stepNum++;

    const snap = await tick(page, url, flowId, recorder, stepNum);

    // Enqueue links: SAFE_NAV first, DEPRIORITIZE last
    const links = ((snap.dom && snap.dom.links) || [])
      .filter(l => l.href && !visited.has(l.href))
      .sort((a, b) => {
        const pri = t => SAFE_NAV.test(t || '') ? 0 : DEPRIORITIZE.test(t || '') ? 2 : 1;
        return pri(a.text) - pri(b.text);
      });
    for (const l of links) queue.push(l.href);
  }

  // Drain interaction queue — exercise elements not reached via URL navigation
  const { execSync: exec2 } = require('child_process');
  function loadInteractionState() {
    const p = path.join(KB_DIR, 'interactions-state.json');
    if (!fs.existsSync(p)) return { queue: [] };
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch { return { queue: [] }; }
  }

  let intState = loadInteractionState();
  while (intState.queue.length > 0) {
    const item = intState.queue[0];
    if (!item.url) { intState.queue.shift(); continue; }
    console.log(`[bfs] Interaction drain: ${item.role}[name="${item.name}"] on ${item.url}`);
    try {
      await page.goto(item.url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
      // Attempt to exercise the element
      const locator = page.getByRole(item.role, { name: item.name });
      if (await locator.count() > 0) {
        await locator.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }
      run_script(`scripts/update-interactions-state.js --mark-exercised ${item.fingerprint}`);
      stepNum++;
      await tick(page, page.url(), flowId, recorder, stepNum);
    } catch (e) {
      console.warn(`[bfs] Interaction drain failed for ${item.fingerprint}: ${e.message}`);
      run_script(`scripts/update-interactions-state.js --mark-exercised ${item.fingerprint}`);
    }
    intState = loadInteractionState();
  }

  recorder.flush(path.join(FLOWS_DIR, flowId, 'trace.jsonl'));
  await browser.close();
  console.log(`[bfs] Done. Visited ${visited.size} pages.`);
}

main().catch(e => { console.error(e); process.exit(1); });
