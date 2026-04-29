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

    // ── Multi-source URL harvest ───────────────────────────────────────────
    // SPAs hide URLs in places <a href> can't reach: onClick handlers, router
    // configs, and runtime pushState calls. Harvest from every source so the
    // BFS frontier reflects what the app actually exposes.
    //
    // Provenance is recorded per-URL — the frontier gate uses it to validate
    // candidates from low-signal sources (jschunk regex hits) before promoting
    // them to ✅ explored.
    const harvestedUrls = new Map(); // url → Set(provenance tags)
    function addUrl(url, provenance) {
      if (!url || typeof url !== 'string') return;
      const trimmed = url.trim();
      if (!trimmed) return;
      // Normalize: ignore javascript:, mailto:, tel:, anchors-only-without-state
      if (/^(javascript|mailto|tel|data):/i.test(trimmed)) return;
      // Resolve relative to current origin
      let resolved;
      try { resolved = new URL(trimmed, location.href).href; } catch { return; }
      // Same-origin only — cross-origin links are recorded separately, not crawled
      const sameOrigin = new URL(resolved).origin === location.origin;
      const key = resolved;
      if (!harvestedUrls.has(key)) harvestedUrls.set(key, { provenance: new Set(), sameOrigin });
      harvestedUrls.get(key).provenance.add(provenance);
    }

    // Source 1: <a href> in DOM (already handled by `links` extraction; mirror here for provenance)
    document.querySelectorAll('a[href], area[href], [role=link][href]').forEach(el => addUrl(el.getAttribute('href'), 'dom-href'));

    // Source 2: Programmatic nav handlers — scan inline onclick source for path literals
    // Catches `onClick={() => navigate('/billing')}` / `onclick="location.href='/foo'"`
    const PATH_RE = /['"`](\/[a-zA-Z][\w\-/]*(?:\?[\w=&\-]*)?(?:#[\w-]*)?)['"`]/g;
    document.querySelectorAll('button, [role=button], [onclick]').forEach(el => {
      const src = el.onclick?.toString() || el.getAttribute('onclick') || '';
      if (!src) return;
      let m;
      while ((m = PATH_RE.exec(src))) addUrl(m[1], 'onclick-scan');
    });

    // Source 3a: Next.js / app router manifests
    try {
      const next = window.__NEXT_DATA__;
      if (next?.page)         addUrl(next.page,         'router-config-next-page');
      if (next?.props?.pageProps?.__lang) { /* noop, just shape probe */ }
      if (window.__BUILD_MANIFEST?.sortedPages) {
        for (const p of window.__BUILD_MANIFEST.sortedPages) addUrl(p, 'router-config-next-manifest');
      }
    } catch {}

    // Source 3b: Generic JS-chunk regex over already-loaded scripts.
    // Synchronous over performance entries; the actual fetch + scan is done
    // outside page.evaluate (see post-eval block) for async handling.
    const scriptUrls = [];
    try {
      for (const e of (performance.getEntriesByType?.('resource') || [])) {
        if (e.initiatorType === 'script' && e.name && /\.js(\?|$)/.test(e.name)) {
          scriptUrls.push(e.name);
        }
      }
    } catch {}

    // Source 4: Live pushState/replaceState interception.
    // Install a no-op recorder; events are read by BFS via window.__qaPushStateLog.
    // Idempotent: only install once per page lifecycle.
    if (!window.__qaPushStateInstalled) {
      window.__qaPushStateLog = window.__qaPushStateLog || [];
      const origPush    = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function (state, title, url) {
        try { window.__qaPushStateLog.push({ kind: 'push',    url: url || location.pathname, ts: Date.now() }); } catch {}
        return origPush.apply(this, arguments);
      };
      history.replaceState = function (state, title, url) {
        try { window.__qaPushStateLog.push({ kind: 'replace', url: url || location.pathname, ts: Date.now() }); } catch {}
        return origReplace.apply(this, arguments);
      };
      window.__qaPushStateInstalled = true;
    }
    // Drain any pushState events accumulated since the last snapshot
    for (const entry of (window.__qaPushStateLog || [])) addUrl(entry.url, `pushstate-${entry.kind}`);
    window.__qaPushStateLog = [];

    // Materialize harvested URLs for the return shape
    const urlHarvest = [];
    for (const [url, meta] of harvestedUrls.entries()) {
      urlHarvest.push({ url, provenance: [...meta.provenance], sameOrigin: meta.sameOrigin });
    }

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
      // Multi-source URL harvest (B3) — feeds the BFS frontier with provenance.
      urlHarvest,
      scriptUrls,
    };
  });

  // ── Source 3b (continued): JS-chunk regex scan, run outside page.evaluate ───
  // We fetch each loaded script's source via page.evaluate(fetch) and regex-scan
  // for path literals. Hits are LOW-SIGNAL — the BFS gate validates each via
  // page.goto before promoting from "candidate" to "explored". Cost is bounded
  // by the count of script chunks (typically 5–30 per page).
  const candidateUrls = [];
  try {
    const PATH_RE_GLOBAL = /['"`](\/[a-zA-Z][\w\-/]*(?:\?[\w=&\-]*)?(?:#[\w-]*)?)['"`]/g;
    for (const scriptUrl of (captured.scriptUrls || []).slice(0, 20)) {
      const src = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { credentials: 'same-origin' });
          if (!r.ok) return null;
          const txt = await r.text();
          // Cap each script to 2MB to avoid pathological bundles
          return txt.slice(0, 2 * 1024 * 1024);
        } catch { return null; }
      }, scriptUrl).catch(() => null);
      if (!src) continue;
      const seen = new Set();
      let m;
      while ((m = PATH_RE_GLOBAL.exec(src))) {
        const p = m[1];
        // Filter obvious noise: image paths, locale codes, version strings
        if (/\.(png|jpe?g|svg|gif|webp|ico|css|woff2?|ttf|eot|map|json)(\?|$)/i.test(p)) continue;
        if (/^\/[a-z]{2}(?:-[A-Z]{2})?$/.test(p)) continue; // locale codes
        if (seen.has(p)) continue;
        seen.add(p);
        try {
          const resolved = new URL(p, captured.url).href;
          candidateUrls.push({ url: resolved, provenance: ['jschunk-regex'], sameOrigin: true, candidate: true, sourceScript: scriptUrl });
        } catch {}
      }
      // Cap candidates per page to prevent runaway harvesting
      if (candidateUrls.length > 200) break;
    }
  } catch {}

  // ── Sitemap + robots.txt — once per origin ──────────────────────────────────
  // Cached via a sentinel file at qa/.sitemap-fetched-<origin>.json so we don't
  // re-fetch on every snapshot. Same-origin only.
  let sitemapUrls = [];
  try {
    const origin = new URL(captured.url).origin;
    const cacheKey = path.resolve(snapshotDir, '..', `..${path.sep}.sitemap-${origin.replace(/[^\w]/g, '_')}.json`);
    if (!fs.existsSync(cacheKey)) {
      const fetched = await page.evaluate(async (origin) => {
        const out = { sitemapUrls: [], robotsRules: [] };
        for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
          try {
            const r = await fetch(origin + path);
            if (!r.ok) continue;
            const txt = await r.text();
            const matches = txt.match(/<loc>([^<]+)<\/loc>/g) || [];
            for (const m of matches) {
              const u = m.replace(/<\/?loc>/g, '').trim();
              if (u) out.sitemapUrls.push(u);
            }
            if (out.sitemapUrls.length) break;
          } catch {}
        }
        try {
          const r = await fetch(origin + '/robots.txt');
          if (r.ok) out.robotsRules = (await r.text()).split('\n').filter(l => /^(allow|disallow):/i.test(l));
        } catch {}
        return out;
      }, origin).catch(() => ({ sitemapUrls: [], robotsRules: [] }));
      try {
        fs.writeFileSync(cacheKey, JSON.stringify(fetched, null, 2));
      } catch {}
      sitemapUrls = fetched.sitemapUrls.map(u => ({ url: u, provenance: ['sitemap'], sameOrigin: true }));
    } else {
      const cached = JSON.parse(fs.readFileSync(cacheKey, 'utf8'));
      sitemapUrls = (cached.sitemapUrls || []).map(u => ({ url: u, provenance: ['sitemap'], sameOrigin: true }));
    }
  } catch {}

  // Merge harvest sources into the captured payload for downstream consumers.
  captured.urlHarvest = [
    ...(captured.urlHarvest || []),
    ...candidateUrls,
    ...sitemapUrls,
  ];

  const dom = captured;

  // ── Fidelity scoring (unchanged) ─────────────────────────────────────────
  const totalButtons   = dom.buttons.length;
  const unnamedButtons = dom.buttons.filter(b => !b.name || !b.name.trim()).length;
  const unnamedRatio   = totalButtons ? unnamedButtons / totalButtons : 0;
  const ariaFidelity   = (unnamedButtons >= 3 || unnamedRatio >= 0.3) ? 'low' : 'ok';

  // ── PNG fallback (unchanged — written but not Read by default) ───────────
  let pngPath = null;
  if (opts.screenshot !== false) {
    pngPath = path.join(snapshotDir, slug + '.png');
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
