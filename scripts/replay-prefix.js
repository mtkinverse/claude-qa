#!/usr/bin/env node
/**
 * replay-prefix.js — drives Playwright through the first N steps of a manifest.
 * Used by transpile-flow.js JIT-backfill and strategy templates for branch-replay.
 *
 * Usage:
 *   node scripts/replay-prefix.js \
 *     --manifest qa/flows/F-003-onboarding/manifest.jsonl \
 *     --steps 4 \
 *     --auth qa/.auth/user.json \
 *     --snapshot-to /tmp/page-state.json
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args         = process.argv.slice(2);
const manifestPath = args[args.indexOf('--manifest') + 1];
const stepCount    = parseInt(args[args.indexOf('--steps') + 1] || '0', 10);
const authPath     = args[args.indexOf('--auth') + 1];
const snapshotTo   = args[args.indexOf('--snapshot-to') + 1];

if (!manifestPath) {
  console.error('Usage: node scripts/replay-prefix.js --manifest <path> --steps N [--auth <path>] [--snapshot-to <path>]');
  process.exit(1);
}

async function main() {
  const steps = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .slice(0, stepCount);

  const browser = await chromium.launch({ headless: true });
  const context  = await browser.newContext({
    storageState: (authPath && fs.existsSync(authPath)) ? authPath : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  for (const step of steps) {
    try {
      if (step.action === 'goto') {
        await page.goto(step.target, { waitUntil: 'networkidle' });
      } else if (step.action === 'click') {
        // Best-effort replay: try text match
        const name = step.target.match(/name='([^']+)'/)?.[1] || step.target;
        await page.getByText(name).first().click().catch(() =>
          page.locator(`text="${name}"`).first().click()
        );
        await page.waitForTimeout(300);
      } else if (step.action === 'fill') {
        const name = step.target.match(/\[placeholder="([^"]+)"\]/)?.[1]
                  || step.target.match(/name='([^']+)'/)?.[1]
                  || 'input';
        await page.locator(`[placeholder="${name}"]`).first().fill('test-value').catch(() => {});
      } else if (step.action === 'press') {
        await page.keyboard.press(step.target);
      }
    } catch (e) {
      console.warn(`[replay-prefix] Step ${step.step} failed: ${e.message} — continuing`);
    }
  }

  // Snapshot the final state
  if (snapshotTo) {
    const snapshotPage = (() => {
      const p = path.join(process.cwd(), 'qa', 'scripts', 'snapshot-page.js');
      const t = path.join(process.cwd(), 'skills', 'web', 'templates', 'snapshot-page.js');
      return fs.existsSync(p) ? require(p) : fs.existsSync(t) ? require(t) : null;
    })();

    if (snapshotPage) {
      const snap = await snapshotPage(page, {
        slug: 'jit-replay',
        kbDir: '/tmp',
        uigPath: null,
      });
      fs.writeFileSync(snapshotTo, JSON.stringify(snap, null, 2));
      console.log(`[replay-prefix] Snapshot written to ${snapshotTo}`);
    } else {
      // Fallback: just dump ARIA
      const aria = await page.locator('body').ariaSnapshot().catch(() => '');
      fs.writeFileSync(snapshotTo, JSON.stringify({ aria, url: page.url() }));
    }
  }

  await browser.close();
  console.log(`[replay-prefix] Replayed ${steps.length} steps. Final URL: ${page.url()}`);
}

main().catch(e => { console.error(e); process.exit(1); });
