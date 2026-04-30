// snapshot-page.js — atomic DOM + ARIA + UIG snapshot
// Why: replaces screenshot capture for web discovery; emits the Interactable Graph
//      (UIG) used by Phase 3 generation, the journey planner, and the self-heal cascade.
// Strategy: any (shared by bfs / targeted-trace / sitemap-spot-check)
// Fallback: if ariaSnapshot() throws, return { aria: null, dom }; UIG rows still emitted from DOM.
// Note: page.accessibility.snapshot() was removed in Playwright ≥1.49 — use page.locator('body').ariaSnapshot()

const fs = require('fs');
const path = require('path');

async function snapshotPage(page, slug, snapshotDir, opts = {}) {
  const aria = await page.locator('body').ariaSnapshot().catch(() => null);

  const captured = await page.evaluate(() => {
    // ── Scope computation ──────────────────────────────────────────────────
    // Walks ancestors, prepends a scope segment for each scoping container.
    // Result: "nav" | "footer" | "card[Pro]" | "dialog[Onboarding]>>region[Pricing]" | "root"
    // Same idea works for any UI tree (macOS AX, mobile a11y) — it's structural, not web-specific.
    function trim(s, n) { return (s || '').trim().slice(0, 40); }
    function headingText(el) {
      const h = el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > header h1, :scope > header h2');
      return h ? trim(h.innerText, 40) : '';
    }
    function computeScope(el) {
      const scopes = [];
      let cur = el.parentElement;
      let dialogStop = false;
      while (cur && cur !== document.body && !dialogStop) {
        const tag = cur.tagName?.toLowerCase();
        const role = cur.getAttribute && cur.getAttribute('role');
        const ariaModal = cur.getAttribute && cur.getAttribute('aria-modal');

        // Dialog / wizard overlay — opaque scope, stop walking up
        if (role === 'dialog' || tag === 'dialog' || ariaModal === 'true') {
          const h = headingText(cur) || trim(cur.getAttribute('aria-label') || '', 40);
          scopes.unshift(h ? `dialog[${h}]` : 'dialog');
          dialogStop = true;
          break;
        }
        // Full-screen overlay (fixed inset-0 z-…) — common SPA wizard pattern
        if (cur.style && /fixed/.test(cur.style.position || '') && /inset-?0|z-\[2147/.test(cur.className || '')) {
          const h = headingText(cur);
          scopes.unshift(h ? `overlay[${h}]` : 'overlay');
          dialogStop = true;
          break;
        }
        if (role === 'navigation' || tag === 'nav') scopes.unshift('nav');
        else if (tag === 'header' && !cur.closest('article,section,[role=region]')) scopes.unshift('header');
        else if (tag === 'footer' || role === 'contentinfo') scopes.unshift('footer');
        else if (role === 'main' || tag === 'main') scopes.unshift('main');
        else if (role === 'region' || tag === 'section') {
          const h = headingText(cur);
          if (h) scopes.unshift(`region[${h}]`);
        } else if (role === 'tabpanel') {
          const labelledBy = cur.getAttribute('aria-labelledby');
          let label = '';
          if (labelledBy) {
            const lbl = document.getElementById(labelledBy);
            if (lbl) label = trim(lbl.innerText, 40);
          }
          scopes.unshift(label ? `tabpanel[${label}]` : 'tabpanel');
        } else {
          // Heuristic "card" detection — element with a direct heading child plus ≥2 interactives.
          // Generic across apps; no per-app classes.
          const directH = Array.from(cur.children || []).find(c => /^H[1-6]$/.test(c.tagName));
          if (directH) {
            const interactives = cur.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=link]').length;
            if (interactives >= 2) {
              scopes.unshift(`card[${trim(directH.innerText, 40)}]`);
            }
          }
        }
        cur = cur.parentElement;
      }
      return scopes.length ? scopes.join('>>') : 'root';
    }

    // ── Element extractor (unchanged shape, plus scope/disabled/exact) ─────
    function ex(el) {
      const role = el.getAttribute('role') || el.tagName?.toLowerCase();
      const name = (el.getAttribute('aria-label') || el.getAttribute('name') || el.innerText || el.value || '').trim().slice(0, 80);
      const visible = el.offsetParent !== null;
      return {
        tag:         el.tagName?.toLowerCase(),
        role,
        name,
        scope:       computeScope(el),
        href:        el.href  || null,
        type:        el.type  || null,
        placeholder: el.placeholder || null,
        alt:         el.alt   || null,
        visible,
        disabled:    el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      };
    }

    // ── Uniqueness + exact-safety ──────────────────────────────────────────
    // `exact: true` is ALWAYS safer for Playwright lookups — the snapshotter
    // captures the element's full accessible name, so an exact match is
    // accurate by construction. Partial matching is the failure mode (e.g.
    // `$5` resolving to `$50`). We emit `exact: true` for every UIG row.
    //
    // `uniqueInScope` tracks whether two peers share an identical (role,name)
    // tuple in this scope — that's the audit-gate input. It's separate from
    // the prefix-collision flag, which we record for diagnostics.
    function markExact(rows) {
      const byScope = new Map();
      for (const r of rows) {
        if (!byScope.has(r.scope)) byScope.set(r.scope, []);
        byScope.get(r.scope).push(r);
      }
      for (const r of rows) {
        const peers = byScope.get(r.scope) || [];
        r.exact = true;  // always safe given the snapshot captures full name
        // Diagnostic: prefix collisions in the same scope (e.g. $5 vs $50).
        // Surfaces in audit output but does not alter `exact`.
        r.prefixCollision = peers.some(p => p !== r && p.role === r.role
          && p.name && r.name && p.name !== r.name
          && (p.name.startsWith(r.name) || r.name.startsWith(p.name)));
        // Uniqueness within scope (used by audit gate).
        const samesies = peers.filter(p => p.role === r.role && p.name === r.name).length;
        r.uniqueInScope = samesies <= 1;
      }
    }

    const buttons = [...document.querySelectorAll('button,[role="button"]')].map(ex);
    const links   = [...document.querySelectorAll('a[href]')].map(ex);
    const inputs  = [...document.querySelectorAll('input,textarea,select')].map(ex);
    const comboboxes = [...document.querySelectorAll('[role="combobox"]')].map(ex);

    // Mark exact + uniqueness across the union of interactables in each scope.
    const allInteractives = [...buttons, ...links, ...inputs, ...comboboxes];
    markExact(allInteractives);

    return {
      url:      location.href,
      title:    document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')].map(h => ({ level: h.tagName, text: h.innerText.slice(0, 120) })),
      inputs,
      buttons,
      links,
      comboboxes,
      images:   [...document.querySelectorAll('img,[role="img"]')].map(e => ({ alt: e.alt, label: e.getAttribute('aria-label') })),
      alerts:   [...document.querySelectorAll('[role="alert"],[role="status"]')].map(e => e.innerText.slice(0, 200)),
      // Detected overlays — page-level evidence the wizard / modal exists right now.
      overlays: [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].map(d => ({
        role: d.getAttribute('role') || 'dialog',
        label: (d.querySelector('h1,h2,h3,h4')?.innerText || d.getAttribute('aria-label') || '').trim().slice(0, 80),
      })),
    };
  });

  const dom = captured;

  // ── Fidelity scoring (unchanged) ─────────────────────────────────────────
  const totalButtons   = dom.buttons.length;
  const unnamedButtons = dom.buttons.filter(b => !b.name || !b.name.trim()).length;
  const unnamedRatio   = totalButtons ? unnamedButtons / totalButtons : 0;
  const ariaFidelity   = (unnamedButtons >= 3 || unnamedRatio >= 0.3) ? 'low' : 'ok';

  // ── PNG fallback ─────────────────────────────────────────────────────────
  // PNGs live in a SIBLING `screenshots/` directory, not next to the JSON.
  // Reading order is JSON → PNG-on-stall (see phase1.md W-2.5), so keeping
  // them physically separate makes `ls` of either folder unambiguous.
  let pngPath = null;
  if (opts.screenshot !== false) {
    const screenshotDir = path.resolve(snapshotDir, '..', 'screenshots');
    try { fs.mkdirSync(screenshotDir, { recursive: true }); } catch {}
    pngPath = path.join(screenshotDir, slug + '.png');
    await page.screenshot({ path: pngPath, fullPage: false }).catch(() => { pngPath = null; });
  }

  const capturedAt = new Date().toISOString();

  // ── UIG emission ─────────────────────────────────────────────────────────
  // One row per interactable. Effect + preconditions are filled in later by
  // the BFS strategy and wiggle-pass; emit them as null/[] here.
  // The journey planner and Phase 3 transpiler consume uig.jsonl only.
  const uigPath = path.resolve(snapshotDir, '..', 'uig.jsonl');
  const uigRows = [];
  for (const kind of ['buttons', 'links', 'inputs', 'comboboxes']) {
    for (const el of dom[kind]) {
      if (!el.name && !el.placeholder && !el.alt && kind !== 'inputs') continue; // skip unnamed/anonymous
      uigRows.push({
        slug,
        observedAt: capturedAt,
        page: dom.url,
        scope: el.scope || 'root',
        role: el.role,
        name: el.name || el.placeholder || el.alt || '',
        exact: el.exact !== false,
        uniqueInScope: el.uniqueInScope !== false,
        disabled: !!el.disabled,
        href: el.href || null,
        type: el.type || null,
        // Filled in by BFS / wiggle-pass:
        effect: null,
        preconditions: [],
      });
    }
  }
  // Append rows. Aggregation (newest-wins per (page,scope,role,name)) happens
  // at audit time — see scripts/audit-snapshots.js.
  if (uigRows.length) {
    fs.appendFileSync(uigPath, uigRows.map(r => JSON.stringify(r)).join('\n') + '\n');
  }

  fs.writeFileSync(
    path.join(snapshotDir, slug + '.snapshot.json'),
    JSON.stringify({
      slug, capturedAt, ariaFidelity, unnamedButtons, totalButtons, pngPath,
      aria, dom, uigRowCount: uigRows.length,
    }, null, 2)
  );
  return { ...dom, ariaFidelity, pngPath, uigRowCount: uigRows.length };
}

module.exports = { snapshotPage };
