// heal.js — self-healing locator cascade for Phase 4 execution
// Why: when a generated locator misses, we want to recover deterministically
//      before failing. Each recovery strategy is generic (no per-app logic) and
//      either succeeds (record auto-fix) or surfaces a structured ARIA diff.
// Strategy: imported by qa/run.js and any Phase 3-generated spec; called via
//           healingFind(page, uigRow, options).
// Fallback: never throws — returns { locator: null, diagnostics } so the
//           caller can decide to test.skip vs throw.
//
// Cascade (in order):
//   1. Original locator from UIG row.
//   2. Same name, exact flipped — handles cases where the snapshot under-marked
//      a peer that now exists.
//   3. Sibling roles — button↔link, textbox↔combobox, tab↔button.
//   4. Overlay dismissal — if an entry from app-quirks.yml.overlays is detected
//      blocking the target, attempt registered dismiss steps.
//   5. ARIA diff — captures current ARIA tree, diffs against the Phase-1
//      snapshot, attaches to evidence.

const fs = require('fs');
const path = require('path');
const { resolveScope } = require('./scope-resolver');

const SIBLING_ROLES = new Map([
  ['button', ['link', 'menuitem']],
  ['link', ['button']],
  ['textbox', ['combobox', 'searchbox']],
  ['combobox', ['textbox', 'listbox']],
  ['tab', ['button']],
]);

// Quirks are read from the runtime JSON sidecar emitted alongside app-quirks.yml.
// The JSON is canonical; the YAML is for humans only. Avoids hand-rolled YAML parsing.
const QUIRKS_JSON_PATH = process.env.QA_QUIRKS_JSON_PATH
  || (process.env.QA_QUIRKS_PATH ? path.join(path.dirname(process.env.QA_QUIRKS_PATH), '.app-quirks.json')
                                  : 'qa/.app-quirks.json');
const SNAPSHOT_DIR = process.env.QA_SNAPSHOT_DIR || 'qa/knowledgebase/aria-snapshots';
const AUTO_FIX_PATH = process.env.QA_AUTO_FIX_PATH || 'qa/auto-fixes.md';
const EVIDENCE_DIR = process.env.QA_EVIDENCE_DIR || 'qa/evidence';

let _quirks = null;
function loadQuirks() {
  if (_quirks !== null) return _quirks;
  try {
    _quirks = JSON.parse(fs.readFileSync(QUIRKS_JSON_PATH, 'utf8'));
  } catch {
    _quirks = { overlays: [], console_allowlist: [], toggle_pairs: [], disambiguation: [], spa_query_drops: [] };
  }
  // Defensive defaults for fields heal.js consumes.
  _quirks.overlays = _quirks.overlays || [];
  _quirks.console_allowlist = _quirks.console_allowlist || [];
  return _quirks;
}

function appendAutoFix(entry) {
  try {
    if (!fs.existsSync(AUTO_FIX_PATH)) {
      fs.writeFileSync(AUTO_FIX_PATH, '# auto-fixes — heal.js cascade events\n\n');
    }
    fs.appendFileSync(AUTO_FIX_PATH,
      `- ${new Date().toISOString()} | ${entry.uigRef || '?'} | strategy=${entry.strategy} | from="${entry.from}" → to="${entry.to}"\n`
    );
  } catch {}
}

async function tryDismissOverlays(page, quirks) {
  const dismissed = [];
  for (const overlay of quirks.overlays || []) {
    // Overlay shape from derive-quirks: { id, detect: { role, name } }.
    const detectName = overlay.detect?.name || overlay.name;
    const detectRole = overlay.detect?.role || 'heading';
    if (!detectName) continue;
    const heading = page.getByRole(detectRole, { name: detectName }).first();
    if (await heading.isVisible({ timeout: 600 }).catch(() => false)) {
      const dismiss = page.getByRole('button', { name: /set up later|skip|dismiss|close|cancel/i }).first();
      if (await dismiss.isVisible({ timeout: 800 }).catch(() => false)) {
        await dismiss.click({ force: true }).catch(() => {});
        dismissed.push(overlay.id);
        await page.waitForTimeout(600);
      }
    }
  }
  return dismissed;
}

/**
 * Healing find. Returns a Playwright Locator that resolves to exactly one
 * visible element, or { locator: null, diagnostics } if every strategy fails.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} uigRow  — { scope, role, name, exact }
 * @param {object} [opts]  — { uigRef, scopeBuilder }
 */
async function healingFind(page, uigRow, opts = {}) {
  const quirks = loadQuirks();
  // UIG scope strings (e.g. "card[Pro]", "dialog[X]>>region[Y]") are NOT raw CSS;
  // resolveScope() translates them. Callers may override via scopeBuilder.
  const buildScope = opts.scopeBuilder || ((s) => resolveScope(page, s));
  const strategies = [];

  // Strategy 1 — original.
  strategies.push({
    name: 'original',
    locator: () => buildScope(uigRow.scope).getByRole(uigRow.role, { name: uigRow.name, exact: uigRow.exact !== false }),
  });
  // Strategy 2 — flip exact.
  strategies.push({
    name: 'flip-exact',
    locator: () => buildScope(uigRow.scope).getByRole(uigRow.role, { name: uigRow.name, exact: !(uigRow.exact !== false) }),
  });
  // Strategy 3 — sibling roles.
  for (const altRole of SIBLING_ROLES.get(uigRow.role) || []) {
    strategies.push({
      name: `sibling-role:${altRole}`,
      locator: () => buildScope(uigRow.scope).getByRole(altRole, { name: uigRow.name, exact: uigRow.exact !== false }),
    });
  }
  // Strategy 4 — relax to regex.
  strategies.push({
    name: 'regex-relax',
    locator: () => buildScope(uigRow.scope).getByRole(uigRow.role, { name: new RegExp(uigRow.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i') }),
  });

  for (const s of strategies) {
    const loc = s.locator();
    const count = await loc.count().catch(() => 0);
    if (count === 1 && await loc.first().isVisible({ timeout: 600 }).catch(() => false)) {
      if (s.name !== 'original') {
        appendAutoFix({ uigRef: opts.uigRef, strategy: s.name, from: 'original', to: s.name });
      }
      return { locator: loc, strategy: s.name };
    }
  }

  // Strategy 5 — overlay dismiss + retry original.
  const dismissed = await tryDismissOverlays(page, quirks);
  if (dismissed.length) {
    const loc = strategies[0].locator();
    if (await loc.count().catch(() => 0) === 1) {
      appendAutoFix({ uigRef: opts.uigRef, strategy: `overlay-dismiss:${dismissed.join(',')}`, from: 'occluded', to: 'reachable' });
      return { locator: loc, strategy: `overlay-dismiss:${dismissed.join(',')}` };
    }
  }

  // Strategy 6 — capture diff vs Phase-1 snapshot, return null.
  const diagnostics = await captureAriaDiff(page, uigRow);
  return { locator: null, diagnostics };
}

async function captureAriaDiff(page, uigRow) {
  const live = await page.locator('body').ariaSnapshot().catch(() => null);
  let baseline = null;
  try {
    const slug = (uigRow.slug || '').replace(/[^\w-]/g, '');
    if (slug && fs.existsSync(path.join(SNAPSHOT_DIR, slug + '.snapshot.json'))) {
      baseline = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, slug + '.snapshot.json'), 'utf8')).aria;
    }
  } catch {}
  const diagnostics = {
    ts: new Date().toISOString(),
    uigRow,
    liveAriaExcerpt: (live || '').slice(0, 4000),
    baselineAriaExcerpt: (baseline || '').slice(0, 4000),
  };
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const fname = `heal-miss-${Date.now()}.json`;
    fs.writeFileSync(path.join(EVIDENCE_DIR, fname), JSON.stringify(diagnostics, null, 2));
    diagnostics.evidenceFile = path.join(EVIDENCE_DIR, fname);
  } catch {}
  return diagnostics;
}

module.exports = { healingFind, loadQuirks };
