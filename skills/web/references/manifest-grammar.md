# Manifest Grammar — native-qa DSL spec

Version: 1.0
This file is the authoritative spec for the manifest DSL used in `qa/flows/F-NNN/manifest.jsonl`.
`scripts/transpile-flow.js` parses this grammar deterministically. Agents writing manifest lines must use these exact forms.

---

## Action verbs

| Verb | Description |
|---|---|
| `goto` | Navigate to a URL |
| `fill` | Fill an input field |
| `click` | Click a button, link, or interactive element |
| `press` | Press a keyboard key (e.g. Enter, Tab) |
| `wait` | Wait for a condition or element |
| `observe` | Record the current state without interaction |
| `assert-url` | Assert the current URL matches a pattern |
| `assert-text` | Assert visible text is present |
| `assert-alert` | Assert an alert/toast/error message is present |

---

## Target forms

| DSL form | Playwright equivalent | Notes |
|---|---|---|
| `role[name='X' exact]` | `page.getByRole('role', { name: 'X', exact: true })` | Preferred — always use when name is stable |
| `role[name='X']` | `page.getByRole('role', { name: 'X' })` | Substring/case-insensitive match |
| `role[name~='X']` | `page.getByRole('role', { name: /X/i })` | ⚠️ Deprecated — emit warning during transpilation |
| `role[index=N scope=Y]` | Look up `uig.scope === Y`, emit `.nth(N)` | Use only when `uniqueInScope === false` |
| `text:'X'` | `page.getByText('X')` | Fallback for non-semantic elements |
| `pseudo:alert-text` | Not a selector — drives `assert-alert` action | The value after `:` is the assertion text |
| `input[type=password]:nth(N)` | `page.locator('input[type=password]').nth(N)` | ⚠️ Deprecated legacy CSS — emit warning |
| `checkbox[index=0]` | `page.getByRole('checkbox').nth(0)` | Role is `checkbox`, not a tag |

---

## Role ↔ tag mapping

| DSL role | HTML/ARIA |
|---|---|
| `button` | `<button>`, `<a role="button">`, `<div role="button">` |
| `link` | `<a href>` |
| `checkbox` | `<input type="checkbox">`, `<div role="checkbox">` |
| `radio` | `<input type="radio">` |
| `textbox` | `<input type="text\|email\|search">`, `<textarea>` |
| `combobox` | `<select>`, `<input role="combobox">` |
| `listitem` | `<li>`, `[role="listitem"]` |
| `menuitem` | `<li role="menuitem">`, `[role="menuitem"]` |

---

## Disambiguation precedence

When a manifest target matches multiple UIG rows:

1. `uig.uniqueInScope === true` — use the unique row directly
2. `app-quirks.yml` rule matching the element name — apply the rule's scope/nth override
3. **JIT-backfill** — re-snapshot the page, write a new UIG row tagged `provenance: "jit-backfill"`, retry

If still ambiguous after JIT-backfill: `transpile-flow.js` exits 1 with evidence.

---

## Outcome → assertion mapping

| trace.jsonl outcome | Generated Playwright assertion |
|---|---|
| `navigated` | `await expect(page).toHaveURL(...)` |
| `dom-updated` | `await expect(locator).toBeVisible()` |
| `modal-opened` | `await expect(page.locator('[role="dialog"]')).toBeVisible()` |
| `error-surfaced` | `await expect(page.locator('[role="alert"]')).toBeVisible()` |
| `auth-success` | `await expect(page).toHaveURL(/dashboard/)` |
| `auth-rejected-server` | `await expect(page.locator('[role="alert"]')).toBeVisible()` |
| `no-change` | `// no-change — no assertion emitted` |
| `form-reset-silent` | `// form-reset — no assertion emitted` |
| `network-timeout` | `// timeout — consider adding a wait` |

---

## Version history

- v1.0 (2026-04-30): Initial frozen spec. Deprecated forms: `role[name~='X']`, `input[type]:nth(N)`.
