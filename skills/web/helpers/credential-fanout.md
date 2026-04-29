---
name: web-helper-credential-fanout
description: Index .env.qa credential types once at Phase 1 start; auto-fill matching input fields anywhere in the app outside auth pages. Activates dormant credentials that would otherwise sit unused.
type: helper
platform: web
---

# Helper — Credential Fanout

> ⛔ **Problem this fixes**: BFS treats credentials as "fill if you happen upon a login form." A workspace with `QA_LLM_API_KEY`, `PROMOTION_CODE`, `CARDHOLDER_NAME`, and `QA_SECONDARY_EMAIL` set would have all four sit unused while their UIs sat unfilled (Add API Key modal captured but never submitted, promo code field never located, etc.). Credential fanout fixes this by indexing every credential type at session start and proactively matching it to detected fields anywhere in the app.

**Invoked by**: BFS on every `snapshotPage()` call. Runs in parallel with the existing credential-gate protocol — gate handling is for auth forms; fanout is for every other input that happens to match a registered credential type.

**Returns**: `{ fillsAttempted: N, fillsSucceeded: M, fieldsMatched: [...] }` — recorded in the page's evidence row.

---

## The Index — built once at Phase 1 start

Read `.env.qa`, classify each variable into a credential **type**, record matchers per type. Types and matchers are app-agnostic (label/placeholder/name regex), not app-specific.

| Type | Source vars | Field matchers (label / placeholder / name / aria-label, case-insensitive) |
|---|---|---|
| `email` | `QA_TEST_EMAIL`, `QA_<ROLE>_EMAIL`, `QA_SECONDARY_EMAIL` | `\bemail\b`, `\be-?mail\b`, `input[type=email]` |
| `password` | `QA_TEST_PASSWORD`, `QA_<ROLE>_PASSWORD` | `\bpassword\b`, `input[type=password]` |
| `api_key` | `QA_LLM_API_KEY`, `*_API_KEY`, `*_TOKEN`, `*_SECRET` | `\b(api[ _-]?key|access[ _-]?token|secret[ _-]?key|bearer[ _-]?token)\b` |
| `card_number` | `CARD_NUMBER`, plain digit string of length 13–19 | `\bcard\s*(number)?\b`, `\bccn?\b`, `autocomplete=cc-number` |
| `card_expiry` | `MM/YY`, `EXPIRY`, `EXPIRATION` | `\bexpir(y|ation)\b`, `\bmm[ /]?yy\b`, `autocomplete=cc-exp` |
| `card_cvc` | `CVC`, `CVV` | `\bcv[cv]\b`, `\bsecurity\s*code\b`, `autocomplete=cc-csc` |
| `cardholder` | `CARDHOLDER_NAME` | `\bcardholder\b`, `\bname on card\b`, `autocomplete=cc-name` |
| `promo_code` | `PROMOTION_CODE`, `PROMO_CODE`, `COUPON`, `DISCOUNT_CODE` | `\bpromo\b`, `\bcoupon\b`, `\bdiscount[ -]?code\b`, `\bvoucher\b` |
| `server_config` | `SERVER`, `*_HOST`, `*_ENDPOINT` | `\bserver\b`, `\bendpoint\b`, `\bhost\b`, `\bbase[ -]?url\b` |
| `phone` | `QA_PHONE`, `PHONE_NUMBER` | `\bphone\b`, `\bmobile\b`, `\btel\b`, `input[type=tel]` |
| `name` | `QA_FULL_NAME`, `FIRST_NAME`+`LAST_NAME` | `\b(full[ -]?)?name\b` (only on non-card forms) |

Index file written to `qa/.credential-index.json` at Phase 1 start. Format:

```json
{
  "version": 1,
  "indexedAt": "2026-04-29T...",
  "credentials": {
    "email":      { "values": ["gdtestqa+...@purevpn.com"], "matchers": ["\\bemail\\b", "..."] },
    "api_key":    { "values": ["sk-proj-..."],              "matchers": ["..."] },
    "promo_code": { "values": ["PAIOFORFREE"],              "matchers": ["..."] },
    ...
  }
}
```

---

## The Fanout — every page, every snapshot

After `snapshotPage()` returns, iterate the snapshot's `inputs` and `comboboxes`. For each field:

1. **Auth-page exemption**: if the current URL matches `/(login|signin|sign-in|signup|sign-up|register|account|reset-password)/i`, skip — auth forms are handled by `login-engage.js`, not fanout.
2. **Match**: combine the field's `label`, `placeholder`, `name`, and `aria-label` into one search string. Test against each credential type's matcher regex set. First match wins (priority order: `email` → `password` → `card_*` → `api_key` → `promo_code` → `server_config` → `phone` → `name`).
3. **Pre-fill check**: if the field already has a value (`value !== ''`) AND it matches the registered credential value, skip (idempotent).
4. **Fill**: use the appropriate Playwright primitive — `fill()` for text/textarea, `selectOption()` for `<select>`, click + select for `[role=combobox]`. For card-number fields, strip spaces from the source value.
5. **Locate the submit affordance**: walk the field's enclosing form / dialog / region (use the `scope` field from `uig.jsonl`) and find the primary submit button. If none, do not submit — record `inputs_filled` only.
6. **Submit**: click the submit button. Classify the outcome via `outcome-classifier.js`. Record in `trace.jsonl`.
7. **Record evidence**: per-page row in `ui-inventory.md` `inputs_filled` count includes the fanout fill. UIG row's `effect` field records the outcome.

---

## Code Skeleton — `qa/scripts/credential-fanout.js`

```javascript
// credential-fanout.js — auto-fill any field matching a registered credential type.
// Why: ensures every credential in .env.qa actually exercises its UI surface.
// Strategy: helper invoked by BFS after each snapshotPage.
// Fallback: on submit failure, record outcome and continue — never block the BFS loop.

const fs = require('fs');

const AUTH_URL_RE = /\/(login|signin|sign-in|signup|sign-up|register|account|reset-password)\b/i;

function buildIndex(env) {
  const idx = {};
  function add(type, value, matchers) {
    if (!value) return;
    if (!idx[type]) idx[type] = { values: [], matchers };
    idx[type].values.push(value);
  }
  add('email',         env.QA_TEST_EMAIL,           ['\\bemail\\b', '\\be-?mail\\b']);
  add('email',         env.QA_SECONDARY_EMAIL,      ['\\bemail\\b']);
  add('password',      env.QA_TEST_PASSWORD,        ['\\bpassword\\b']);
  add('password',      env.QA_SECONDARY_PASSWORD,   ['\\bpassword\\b']);
  add('api_key',       env.QA_LLM_API_KEY,          ['\\bapi[ _-]?key\\b', '\\baccess[ _-]?token\\b', '\\bsecret[ _-]?key\\b', '\\bbearer[ _-]?token\\b']);
  add('card_number',   env.CARD_NUMBER,             ['\\bcard\\s*(number)?\\b', '\\bccn?\\b']);
  add('card_expiry',   env['MM/YY'] || env.CARD_EXPIRY, ['\\bexpir(y|ation)\\b', '\\bmm[ /]?yy\\b']);
  add('card_cvc',      env.CVC || env.CVV,          ['\\bcv[cv]\\b', '\\bsecurity\\s*code\\b']);
  add('cardholder',    env['Cardholder name'] || env.CARDHOLDER_NAME, ['\\bcardholder\\b', '\\bname on card\\b']);
  add('promo_code',    env.PROMOTION_CODE || env.PROMO_CODE || env.COUPON, ['\\bpromo\\b', '\\bcoupon\\b', '\\bdiscount[ -]?code\\b', '\\bvoucher\\b']);
  add('server_config', env.SERVER,                  ['\\bserver\\b', '\\bendpoint\\b', '\\bhost\\b', '\\bbase[ -]?url\\b']);
  add('phone',         env.QA_PHONE,                ['\\bphone\\b', '\\bmobile\\b', '\\btel\\b']);
  add('name',          env.QA_FULL_NAME,            ['\\bfull[ -]?name\\b', '\\bname\\b']);
  return idx;
}

function matchType(field, idx) {
  const haystack = [field.name, field.placeholder, field.label, field.ariaLabel, field.type].filter(Boolean).join(' ').toLowerCase();
  // Priority order — most specific first
  const order = ['email', 'password', 'card_number', 'card_expiry', 'card_cvc', 'cardholder', 'api_key', 'promo_code', 'server_config', 'phone', 'name'];
  for (const type of order) {
    if (!idx[type]) continue;
    for (const m of idx[type].matchers) {
      if (new RegExp(m, 'i').test(haystack)) return { type, value: idx[type].values[0] };
    }
  }
  return null;
}

async function fanout(page, snapshot, opts = {}) {
  const url = snapshot.url || page.url();
  if (AUTH_URL_RE.test(url)) return { skipped: 'auth-page', fillsAttempted: 0, fillsSucceeded: 0 };

  const idx = opts.index || buildIndex(process.env);
  const fields = [...(snapshot.inputs || []), ...(snapshot.comboboxes || [])];
  const result = { fillsAttempted: 0, fillsSucceeded: 0, fieldsMatched: [] };

  for (const f of fields) {
    if (!f.visible) continue;
    if (f.disabled) continue;
    const match = matchType(f, idx);
    if (!match) continue;
    result.fieldsMatched.push({ field: f.name || f.placeholder || '?', type: match.type });

    try {
      // Locator — prefer accessible name, fall back to placeholder/name.
      let locator;
      if (f.name)         locator = page.getByRole(f.role || 'textbox', { name: f.name, exact: true });
      else if (f.placeholder) locator = page.getByPlaceholder(f.placeholder, { exact: true });
      else continue;

      result.fillsAttempted++;
      if (f.tag === 'select' || f.role === 'combobox') {
        await locator.selectOption({ label: match.value }).catch(() => locator.fill(match.value));
      } else {
        const cleanValue = match.type === 'card_number' ? match.value.replace(/\s+/g, '') : match.value;
        await locator.fill(cleanValue);
      }
      result.fillsSucceeded++;
    } catch (err) {
      // Record-and-continue. Never throw out of fanout.
    }
  }

  return result;
}

module.exports = { fanout, buildIndex, matchType };
```

---

## Where BFS calls this

In `bfs.md` step 11d (added with the C1 / B2 changes), after `snapshotPage()` returns:

```javascript
const { fanout } = require('./credential-fanout');
const fanoutResult = await fanout(page, snapshot, { index: sessionIndex }).catch(() => null);
if (fanoutResult) {
  recorder.note({ kind: 'fanout', ...fanoutResult });
  // Increment the inventory row's inputs_filled count.
}
```

If any fill succeeded and a submit affordance is present in the same scope, BFS triggers the submit + outcome classification step (per `principles.md` §5b actuate-and-observe contract) — fanout fills, BFS submits.

---

## What this helper does NOT do

- It does not fill auth forms — those go through `login-engage.js`.
- It does not invent values — only what's in `.env.qa` is used. Missing credential types are skipped silently (the page's evidence row still records `inputs_detected` so the gate can flag pages where credentials *should* have matched but the env was incomplete).
- It does not click submit on its own — that is the BFS actuate-and-observe step (which classifies the outcome). Fanout fills only.
- It does not retry. One pass per page; record and move on.
