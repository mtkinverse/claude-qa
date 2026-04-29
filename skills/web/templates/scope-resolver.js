// scope-resolver.js — translate UIG scope strings into Playwright Locators.
// Shared by wiggle-pass.js, heal.js, and (mirrored) the Phase 3 transpiler.
// The grammar is fixed at snapshot time by snapshot-page.js:
//
//   scope ::= segment ("'>>'" segment)*
//   segment ::= "root" | "nav" | "header" | "footer" | "main"
//             | "card[" text "]"
//             | "region[" text "]"
//             | "tabpanel[" text "]"
//             | "dialog[" text "]"
//             | "overlay[" text "]"
//             | "tabpanel"
//             | "dialog" | "overlay"
//
// Returns a Playwright Locator (chained). Falls back to `body` on unknown segments.

function escapeCssText(t) {
  return (t || '').replace(/"/g, '\\"');
}

function segmentToLocator(rootLocator, page, seg) {
  if (!seg || seg === 'root') return rootLocator;
  if (seg === 'nav')    return rootLocator.locator('nav, [role="navigation"]').first();
  if (seg === 'header') return rootLocator.locator('header').first();
  if (seg === 'footer') return rootLocator.locator('footer, [role="contentinfo"]').first();
  if (seg === 'main')   return rootLocator.locator('main, [role="main"]').first();
  if (seg === 'tabpanel') return rootLocator.locator('[role="tabpanel"]').first();
  if (seg === 'dialog' || seg === 'overlay') {
    return rootLocator.locator('[role="dialog"], [aria-modal="true"]').first();
  }

  const m = /^([a-z]+)\[([^\]]+)\]$/.exec(seg);
  if (!m) return rootLocator;  // unknown — degrade gracefully
  const kind = m[1];
  const label = escapeCssText(m[2]);

  if (kind === 'card') {
    // Container whose direct heading child contains `label`.
    return rootLocator.locator(
      `:has(> h1:has-text("${label}")), :has(> h2:has-text("${label}")), :has(> h3:has-text("${label}")), :has(> h4:has-text("${label}"))`
    ).first();
  }
  if (kind === 'region') {
    return rootLocator.locator(
      `[role="region"]:has-text("${label}"), section:has-text("${label}")`
    ).first();
  }
  if (kind === 'tabpanel') {
    return rootLocator.locator(`[role="tabpanel"]:has-text("${label}")`).first();
  }
  if (kind === 'dialog' || kind === 'overlay') {
    return rootLocator.locator(
      `[role="dialog"]:has-text("${label}"), [aria-modal="true"]:has-text("${label}")`
    ).first();
  }
  return rootLocator;
}

/**
 * Resolve a UIG scope string into a Playwright Locator on the given page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} scope
 * @returns {import('@playwright/test').Locator}
 */
function resolveScope(page, scope) {
  if (!scope || scope === 'root') return page.locator('body');
  let loc = page.locator('body');
  for (const seg of scope.split('>>')) {
    loc = segmentToLocator(loc, page, seg.trim());
  }
  return loc;
}

module.exports = { resolveScope, segmentToLocator };
