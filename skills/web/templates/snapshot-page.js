// snapshot-page.js — atomic DOM + ARIA snapshot
// Why: replaces screenshot capture for web discovery
// Strategy: any (shared by bfs / targeted-trace / sitemap-spot-check)
// Fallback: if ariaSnapshot() throws, return { aria: null, dom }
// Note: page.accessibility.snapshot() was removed in Playwright ≥1.49 — use page.locator('body').ariaSnapshot()

const fs = require('fs');
const path = require('path');

async function snapshotPage(page, slug, snapshotDir, opts = {}) {
  // page.accessibility is removed in Playwright ≥1.49; use the locator-based API instead
  const aria = await page.locator('body').ariaSnapshot().catch(() => null);
  const dom = await page.evaluate(() => {
    const ex = el => ({
      tag:         el.tagName?.toLowerCase(),
      role:        el.getAttribute('role') || el.tagName?.toLowerCase(),
      name:        el.getAttribute('aria-label') || el.getAttribute('name') || el.innerText?.slice(0, 80) || '',
      href:        el.href  || null,
      type:        el.type  || null,
      placeholder: el.placeholder || null,
      alt:         el.alt   || null,
      visible:     el.offsetParent !== null,
    });
    return {
      url:      location.href,
      title:    document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')].map(h => ({ level: h.tagName, text: h.innerText.slice(0, 120) })),
      inputs:   [...document.querySelectorAll('input,textarea,select')].map(ex),
      buttons:  [...document.querySelectorAll('button,[role="button"]')].map(ex),
      links:    [...document.querySelectorAll('a[href]')].map(ex),
      images:   [...document.querySelectorAll('img,[role="img"]')].map(e => ({ alt: e.alt, label: e.getAttribute('aria-label') })),
      alerts:   [...document.querySelectorAll('[role="alert"],[role="status"]')].map(e => e.innerText.slice(0, 200)),
    };
  });

  // ── Fidelity scoring ──────────────────────────────────────────────────────
  // Buttons with no name (icon-only, no aria-label) are the dominant failure mode.
  // If ≥30% of buttons are unnamed OR ≥3 unnamed buttons in absolute terms, the
  // ARIA tree is too thin to ground scenarios from text alone — flag low fidelity
  // so the agent knows it MAY read the PNG fallback for this slug.
  const totalButtons   = dom.buttons.length;
  const unnamedButtons = dom.buttons.filter(b => !b.name || !b.name.trim()).length;
  const unnamedRatio   = totalButtons ? unnamedButtons / totalButtons : 0;
  const ariaFidelity   = (unnamedButtons >= 3 || unnamedRatio >= 0.3) ? 'low' : 'ok';

  // ── PNG fallback ─────────────────────────────────────────────────────────
  // Always written to disk; do NOT Read it unless ariaFidelity === 'low' or
  // a flow needs visual grounding (modal opened, toast appeared, etc).
  // Suppress with opts.screenshot === false for hot loops.
  let pngPath = null;
  if (opts.screenshot !== false) {
    pngPath = path.join(snapshotDir, slug + '.png');
    await page.screenshot({ path: pngPath, fullPage: false }).catch(() => { pngPath = null; });
  }

  const capturedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(snapshotDir, slug + '.snapshot.json'),
    JSON.stringify({ slug, capturedAt, ariaFidelity, unnamedButtons, totalButtons, pngPath, aria, dom }, null, 2)
  );
  return { ...dom, ariaFidelity, pngPath };
}

module.exports = { snapshotPage };
