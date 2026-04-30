/**
 * Targeted-trace strategy — copy to qa/scripts/targeted-trace.js at W-2.4
 * Strategy: skills/web/strategies/targeted-trace.md
 * Fallback: bfs (switch when consecutiveStalls >= 3 with no progress)
 *
 * findNextAction priority (targeted-trace.md:222-241):
 * 1. Auth redirect check
 * 2. Wizard Continue/Next (enabled, not DEPRIORITIZE)
 * 3. Required empty form fields
 * 4. Primary CTA
 * 5. Any nav item (not DEPRIORITIZE)
 * 6. DEPRIORITIZE items last
 * 7. null — no actionable element
 */
'use strict';

const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const TARGET_URL  = process.env.QA_TARGET_URL || 'https://example.com';
const QA_DIR      = path.resolve(process.env.QA_DIR || './qa');
const NAV_TIMEOUT = parseInt(process.env.QA_NAV_TIMEOUT || '30000', 10);
const STALL_LIMIT = 3;

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const KB_DIR    = path.join(QA_DIR, 'knowledgebase');
const FLOWS_DIR = path.join(QA_DIR, 'flows');
const AUTH_PATH = path.join(QA_DIR, '.auth', 'user.json');
const UIG_PATH  = path.join(KB_DIR, 'uig.jsonl');

const snapshotPage  = require('./snapshot-page');
const TraceRecorder = require('../trace-recorder');
const wigglePass    = require('../wiggle-pass');

// Tiebreaker: when two candidates tie on priority, DEPRIORITIZE loses
const DEPRIORITIZE = /skip|later|maybe|not.?now|dismiss|set.?up.?later|i'?ll.?do.?this.?later/i;

function run_script(cmd) {
  execSync(`node ${cmd}`, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function findNextAction(snap, page) {
  const url     = page.url();
  const buttons = (snap.dom && snap.dom.buttons) || [];
  const enabled = buttons.filter(b => !b.disabled);

  // 1. Auth redirect
  if (/\/login|\/signin|\/auth/.test(url)) return { type: 'auth', url };
  // 2. Wizard Continue/Next (enabled, non-deprioritized)
  const wizard = enabled.find(b => /^(continue|next|proceed)$/i.test((b.name || '').trim())
    && !DEPRIORITIZE.test(b.name || ''));
  if (wizard) return { type: 'click', el: wizard };
  // 3. Required empty inputs
  const emptyRequired = ((snap.dom && snap.dom.inputs) || []).filter(i => i.required && !i.value);
  if (emptyRequired.length) return { type: 'fill', el: emptyRequired[0] };
  // 4. Primary CTA (non-deprioritized tiebreaker)
  const primary = enabled.find(b => (b.primary || /sign.?up|get.?start|create.?account/i.test(b.name || ''))
    && !DEPRIORITIZE.test(b.name || ''));
  if (primary) return { type: 'click', el: primary };
  // 5. Any nav link (non-deprioritized)
  const nav = ((snap.dom && snap.dom.links) || []).find(l => l.href && !DEPRIORITIZE.test(l.text || ''));
  if (nav) return { type: 'navigate', url: nav.href };
  // 6. DEPRIORITIZE items last resort
  const deprioBtn = enabled.find(b => DEPRIORITIZE.test(b.name || ''));
  if (deprioBtn) return { type: 'click', el: deprioBtn };
  return null;
}

async function runTick(page, flowId, recorder, stepNum, snap, manifestPath) {
  const url  = page.url();
  const slug = `s${String(stepNum).padStart(2, '0')}-${url.replace(/[^a-z0-9]/gi, '-').slice(0, 40)}`;

  // Step 2: Wiggle-pass for disabled CTAs
  const disabled = (snap.dom && snap.dom.buttons || []).filter(b => b.disabled && b.scope);
  for (const cta of disabled) {
    await wigglePass(page, { scope: cta.scope, ctaSlug: cta.slug, uigPath: UIG_PATH });
  }

  // Steps 3+4: Crawl-todo
  const newLinks = ((snap.dom && snap.dom.links) || []).map(l => l.href).filter(Boolean).join(',');
  if (newLinks) run_script(`scripts/update-crawl-todo.js --discover "${newLinks}"`);
  run_script(`scripts/update-crawl-todo.js --mark-explored "${url}"`);

  // Step 5: Interaction frontier
  run_script(`scripts/update-interactions-state.js --discover-from-uig "${UIG_PATH}"`);

  // Step 6: Progress
  fs.appendFileSync(path.join(QA_DIR, 'progress.jsonl'),
    JSON.stringify({ step: stepNum, url, slug, ts: new Date().toISOString() }) + '\n');

  return slug;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: fs.existsSync(AUTH_PATH) ? AUTH_PATH : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT);

  const flowId       = `F-trace-${Date.now()}`;
  const recorder     = new TraceRecorder(flowId);
  const manifestPath = path.join(FLOWS_DIR, flowId, 'manifest.jsonl');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });

  let consecutiveStalls = 0;
  let stepNum = 0;

  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

  while (consecutiveStalls < STALL_LIMIT) {
    stepNum++;

    // Step 1: Snapshot
    const snap = await snapshotPage(page, {
      slug: `s${String(stepNum).padStart(2,'0')}`, kbDir: KB_DIR, uigPath: UIG_PATH });
    const slug = await runTick(page, flowId, recorder, stepNum, snap, manifestPath);

    const action = findNextAction(snap, page);
    if (!action) { console.log('[targeted-trace] No actionable element — flow complete.'); break; }

    const urlBefore = page.url();
    let outcome = 'no-change';
    let effectType = 'noop';

    try {
      if (action.type === 'navigate') {
        await page.goto(action.url, { timeout: NAV_TIMEOUT });
        outcome = 'navigated'; effectType = 'navigated';
      } else if (action.type === 'click') {
        await page.locator(`text="${action.el.name}"`).first().click();
        await page.waitForTimeout(500);
        outcome    = page.url() !== urlBefore ? 'navigated' : 'dom-updated';
        effectType = outcome;
      } else if (action.type === 'fill') {
        await page.locator(`[placeholder="${action.el.placeholder || ''}"]`).fill('test-value');
        outcome = 'dom-updated'; effectType = 'dom-updated';
      }
    } catch (e) {
      outcome = 'error-surfaced'; effectType = 'noop';
      console.warn(`[targeted-trace] Action failed: ${e.message}`);
    }

    if (outcome === 'no-change') consecutiveStalls++;
    else consecutiveStalls = 0;

    if (consecutiveStalls >= STALL_LIMIT) {
      console.log(`[targeted-trace] ${STALL_LIMIT} stalls — switching to BFS. Log in decisions.md.`);
      break;
    }

    const target = action.el
      ? `${action.el.role || 'button'}[name='${action.el.name}']`
      : action.url;

    // Step 7: Manifest
    fs.appendFileSync(manifestPath,
      JSON.stringify({ step: stepNum, action: action.type, target, status: 'done',
        ts: new Date().toISOString() }) + '\n');

    // Step 8: TraceRecorder
    recorder.interaction({ action: action.type, target, uig_ref: slug, outcome,
      effect: { type: effectType, evidence: page.url() } });
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
    console.log(`[targeted-trace] Interaction drain: ${item.role}[name="${item.name}"] on ${item.url}`);
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
    } catch (e) {
      console.warn(`[targeted-trace] Interaction drain failed for ${item.fingerprint}: ${e.message}`);
      run_script(`scripts/update-interactions-state.js --mark-exercised ${item.fingerprint}`);
    }
    intState = loadInteractionState();
  }

  recorder.flush(path.join(FLOWS_DIR, flowId, 'trace.jsonl'));
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
