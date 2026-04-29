// credential-fanout.js — auto-fill any field matching a registered credential type.
// Why: ensures every credential in .env.qa actually exercises its UI surface
//      (API keys, promo codes, payment fields, etc. — not just login email/password).
// Strategy: helper invoked by BFS after each snapshotPage().
// Fallback: on any failure, record outcome and continue — never throw out of fanout.
// Spec: skills/web/helpers/credential-fanout.md

const AUTH_URL_RE = /\/(login|signin|sign-in|signup|sign-up|register|account|reset-password)\b/i;

function buildIndex(env = process.env) {
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
  const haystack = [field.name, field.placeholder, field.label, field.ariaLabel, field.type]
    .filter(Boolean).join(' ').toLowerCase();
  const order = ['email', 'password', 'card_number', 'card_expiry', 'card_cvc',
                 'cardholder', 'api_key', 'promo_code', 'server_config', 'phone', 'name'];
  for (const type of order) {
    if (!idx[type]) continue;
    for (const m of idx[type].matchers) {
      if (new RegExp(m, 'i').test(haystack)) return { type, value: idx[type].values[0] };
    }
  }
  return null;
}

async function fanout(page, snapshot, opts = {}) {
  const url = snapshot?.url || page.url();
  if (AUTH_URL_RE.test(url)) return { skipped: 'auth-page', fillsAttempted: 0, fillsSucceeded: 0, fieldsMatched: [] };

  const idx = opts.index || buildIndex(process.env);
  const fields = [...(snapshot?.inputs || []), ...(snapshot?.comboboxes || [])];
  const result = { fillsAttempted: 0, fillsSucceeded: 0, fieldsMatched: [] };

  for (const f of fields) {
    if (!f.visible) continue;
    if (f.disabled) continue;
    const match = matchType(f, idx);
    if (!match) continue;
    result.fieldsMatched.push({ field: f.name || f.placeholder || '?', type: match.type });

    try {
      let locator;
      if (f.name)             locator = page.getByRole(f.role || 'textbox', { name: f.name, exact: true });
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
    } catch {
      // Record-and-continue. Never throw out of fanout.
    }
  }

  return result;
}

module.exports = { fanout, buildIndex, matchType };
