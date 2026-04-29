// wiggle-pass.js — discover preconditions on disabled controls
// Why: when BFS lands on a disabled control (e.g. wizard "Continue"), we want to
//      know *what* enables it without writing per-app patterns. The wiggle-pass
//      toggles each enabled sibling in the same scope, observes which flips the
//      disabled control to enabled, and records those siblings as preconditions.
// Strategy: helper called by bfs.js / trace-onboarding.js / sitemap-spot-check.js.
// Fallback: if the wiggle-pass throws, return { preconditions: [], partial: true }.
//           Caller logs a stall but never breaks the flow.
//
// Generic across web / macOS / mobile — the loop is platform-agnostic; only the
// "click sibling" primitive is platform-specific (Playwright here, AppleScript on
// macOS, XCUITest on iOS). Replace the action stubs to port.

const fs = require('fs');
const path = require('path');
const { resolveScope } = require('./scope-resolver');

const DEFAULT_OPTS = {
  maxSiblings: 8,        // hard cap — never wiggle more than N siblings
  perSiblingTimeoutMs: 3000,
  uigPath: 'qa/knowledgebase/uig.jsonl',
  decisionsPath: 'qa/decisions.md',
};

/**
 * Wiggle every enabled sibling in `scopeSelector` and record which ones flip
 * the disabled control to enabled.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object}   args
 * @param {string}   args.scope            — UIG scope string (e.g. "card[Pro]", "dialog[X]", "root")
 *                                            OR raw CSS (any value containing whitespace/punctuation
 *                                            that doesn't match the UIG grammar passes through).
 * @param {object}   args.disabledTarget  — { role, name, exact } — the control we want to enable
 * @param {string}   [args.flowId]         — flow ID for decisions log
 * @param {object}   [opts]                — see DEFAULT_OPTS
 * @returns {Promise<{ preconditions: string[], evidence: object[], partial: boolean }>}
 */
async function wigglePass(page, args, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const { scope: scopeStr, scopeSelector, disabledTarget, flowId } = args;
  const evidence = [];
  const preconditions = [];

  // Resolve the scope — accept UIG-shape ("card[Pro]") or raw CSS via legacy
  // `scopeSelector` param. UIG-shape is preferred; CSS is fallback.
  const scopeRef = scopeStr || scopeSelector || 'root';
  const looksLikeUig = /^(root|nav|header|footer|main|tabpanel|dialog|overlay|card|region)(\[|$|>>)/.test(scopeRef);
  const scope = looksLikeUig ? resolveScope(page, scopeRef) : page.locator(scopeRef);
  const target = scope.getByRole(disabledTarget.role, { name: disabledTarget.name, exact: !!disabledTarget.exact });

  // Sanity — must exist and start disabled.
  const startEnabled = await target.isEnabled().catch(() => null);
  if (startEnabled === null) {
    return { preconditions: [], evidence: [{ note: 'target-not-found' }], partial: true };
  }
  if (startEnabled) {
    return { preconditions: [], evidence: [{ note: 'target-already-enabled' }], partial: false };
  }

  // Enumerate enabled siblings in the same scope. We deliberately exclude:
  //   - the target itself
  //   - destructive labels (delete, sign out, cancel, etc.)
  //   - other disabled controls (clicking them is a no-op)
  const DANGER = /delete|remove|cancel|sign\s?out|log\s?out|reset|destroy|disable|revoke/i;
  const candidates = await scope.locator(
    'button:not([disabled]), [role="button"]:not([aria-disabled="true"]), ' +
    'input[type="checkbox"]:not([disabled]), input[type="radio"]:not([disabled]), ' +
    '[role="combobox"]:not([aria-disabled="true"]), [role="option"]'
  ).all();

  let probed = 0;
  for (const c of candidates.slice(0, o.maxSiblings)) {
    const label = (await c.textContent().catch(() => '') || '').trim().slice(0, 80);
    if (!label) continue;
    if (DANGER.test(label)) continue;
    if (label === disabledTarget.name) continue; // self
    probed++;

    const before = await target.isEnabled().catch(() => false);
    try {
      await c.click({ force: true, timeout: o.perSiblingTimeoutMs });
      // Some controls open dropdowns — pick the first option to actually fire selection.
      const optionList = page.locator('[role="option"], [role="menuitem"]').first();
      if (await optionList.isVisible({ timeout: 800 }).catch(() => false)) {
        await optionList.click({ force: true, timeout: o.perSiblingTimeoutMs }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
      }
    } catch {
      evidence.push({ sibling: label, error: 'click-failed' });
      continue;
    }
    await page.waitForTimeout(400);
    const after = await target.isEnabled().catch(() => false);

    evidence.push({ sibling: label, before, after, flipped: !before && after });
    if (!before && after) preconditions.push(label);
  }

  // Append a single decisions entry — auditable trail.
  try {
    fs.appendFileSync(o.decisionsPath,
      `\n- ${new Date().toISOString()} | wiggle-pass | flow=${flowId || 'n/a'} | scope=${scopeRef} | target="${disabledTarget.name}" | probed=${probed} | preconditions=${JSON.stringify(preconditions)}\n`
    );
  } catch {}

  // Update uig.jsonl with the discovered preconditions for this target.
  try {
    if (preconditions.length && fs.existsSync(o.uigPath)) {
      const stamped = new Date().toISOString();
      fs.appendFileSync(o.uigPath, JSON.stringify({
        observedAt: stamped,
        page: page.url(),
        scope: scopeRef,
        role: disabledTarget.role,
        name: disabledTarget.name,
        exact: !!disabledTarget.exact,
        preconditionsUpdated: preconditions,
        wiggleEvidence: evidence,
      }) + '\n');
    }
  } catch {}

  return { preconditions, evidence, partial: false };
}

module.exports = { wigglePass };
