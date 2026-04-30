# Web — Phase 3: Test Transpilation (UIG + Trace → TypeScript)

**Goal**: Mechanically transpile observed evidence into shippable Playwright code. **No prose re-derivation.** Selectors come from `uig.jsonl`; interaction sequences come from `trace.jsonl`; disambiguation comes from `app-quirks.yml`. The agent does not invent.

**Inputs (read-only)** — read **both** the flow's `flow.md` AND its `scenarios.md` for every F-NNN. `scenarios.md` alone tells you *what* to ship; `flow.md` tells you *how the app actually behaved during discovery* — preconditions, auth context, observed waits, side effects, the URL path that worked. Skipping `flow.md` is the most common cause of generated tests that "look right" but fail at runtime because they miss a precondition or assume a navigation that needed a click.

- `qa/flows/F-NNN-<slug>/flow.md` — **discovery evidence (REQUIRED)**: pages traversed, observed elements, auth/role context, preconditions hit, app quirks specific to this flow
- `qa/flows/F-NNN-<slug>/scenarios.md` — *menu* of which traces to ship + any L4 contract assertions
- `qa/flows/F-NNN-<slug>/trace.jsonl` — recorded actions for the flow (resolved selectors, click order, waits that worked)
- `qa/knowledgebase/uig.jsonl` — Interactable Graph (scope, role, name, exact, preconditions, effect)
- `qa/app-quirks.yml` — auto-derived disambiguation / toggle pairs / console allowlist / SPA query drops / overlay registry
- `qa/knowledgebase/aria-snapshots/*.snapshot.json` — only when an L4 contract names a value to extract

**Read order per flow**: `flow.md` → `scenarios.md` → `trace.jsonl` → emit. If `flow.md` and `scenarios.md` disagree (e.g. scenario assumes a precondition flow.md never observed), trust `flow.md` and either narrow the scenario or skip it with a `decisions.md` entry — never paper over the gap with invented setup code.

**Outputs**:
- `qa/flows/F-NNN-<slug>/F-NNN.scenarios.ts` — exported async scenario functions, each carrying a `.contract` sidecar
- `qa/tests/F-NNN-<slug>.spec.ts` — thin standalone wrappers
- `qa/journeys/J-NNN-<role>.spec.ts` — emitted by `scripts/assemble-journey.js`, NOT hand-ordered
- `qa/journey-todo/J-NNN-<role>.todo.md` — generation + runtime tracking

**Transition**: automatic — after all flow specs written and journey assembled, Phase 4 runs them.

Runtime rules — see `skills/_shared/runtime.md`.

---

## ⛔ Phase 3 Non-Negotiables

1. **No prose-driven selectors.** Every `getByRole`/`getByText`/`locator` call must be derivable from a UIG row. If you cannot point to the `uig.jsonl` row that authorises a selector, do not emit it.
2. **Scope is mandatory.** Every locator scope-prefixes via `page.locator(scope).getByRole(...)`. Never `.first()` / `.last()` for disambiguation.
3. **Interactions go through `act()`.** No bare `waitForURL` / `toHaveURL` on SPA query params. Assert against `result.label`.
4. **Every scenario exports a `.contract`.** No JSDoc-only entry/exit prose.
5. **Layers L1+L2+L3 are emitted for every UIG-covered route.** L4 only when `qa/context/` has PRDs.
6. **No per-app patterns.** If you find yourself wanting to write a quirk inline, instead append it to `qa/app-quirks.yml` and the transpiler picks it up.
7. **Read `flow.md` AND `scenarios.md` for every F-NNN before emitting.** The flow file is discovery evidence (preconditions, auth context, side effects, observed waits). Scenarios alone are insufficient — they describe intent, not behavior. If you cannot cite the `flow.md` row that established a precondition, you cannot emit setup for it.

---

## Step W-10: Transpilation

### W-10.1 — Load inputs once (transpile-time, not runtime)

The transpiler runs at Phase 3 generation time; it reads the inputs once and **inlines** what each scenario needs into the emitted TS file. Generated specs must NOT read these files at runtime — they should embed the data they need as `const`s.

```ts
// transpile-time helper — runs in scripts/, not in qa/tests/
import * as fs from 'fs';

const UIG     = fs.readFileSync('qa/knowledgebase/uig.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const QUIRKS  = JSON.parse(fs.readFileSync('qa/.app-quirks.json', 'utf8'));   // runtime sidecar — no YAML parser needed
const TRACE   = (flowId: string) => fs.readFileSync(`qa/flows/${flowId}/trace.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
```

Inlined into each generated `F-NNN.scenarios.ts`:

```ts
// AUTO-INLINED from qa/.app-quirks.json
const CONSOLE_ALLOWLIST: RegExp[] = [
  /Analytics tracking error/,
  /FunctionsFetchError/,
  // ...
];
```

`expectConsoleClean(page, fn, CONSOLE_ALLOWLIST)` — never re-define the list per scenario.

Newest-wins per `(page, scope, role, name)` when reading UIG (same logic as `audit-snapshots.js`).

### W-10.2 — Resolve a UIG row to a Playwright locator

Pure function. No agent reasoning. The mapping is mechanical:

```ts
function locatorFor(page: Page, row: UigRow) {
  // scope is one of: "root" | "nav" | "header" | "footer" | "main"
  //                | "card[Pro]" | "region[Pricing]" | "tabpanel[X]"
  //                | "dialog[Onboarding]" | "overlay[Set up]"
  //                | nested: "dialog[X]>>region[Y]"
  const scopeChain = row.scope === 'root' ? ['body'] : row.scope.split('>>').map(scopeToCSS);
  let loc = page.locator(scopeChain.join(' >> ').replace(/^body >> /, ''));
  return loc.getByRole(row.role as any, { name: row.name, exact: row.exact !== false });
}

function scopeToCSS(seg: string): string {
  const card = /^card\[(.+)\]$/.exec(seg);
  if (card) return `:has(:scope > h1:text-is("${card[1]}"), :scope > h2:text-is("${card[1]}"), :scope > h3:text-is("${card[1]}"))`;
  if (seg === 'nav')    return 'nav, [role="navigation"]';
  if (seg === 'header') return 'header';
  if (seg === 'footer') return 'footer, [role="contentinfo"]';
  if (seg === 'main')   return 'main, [role="main"]';
  const region = /^region\[(.+)\]$/.exec(seg);
  if (region) return `[role="region"]:has(h1:text-is("${region[1]}")), section:has(h1:text-is("${region[1]}"))`;
  const dialog = /^(dialog|overlay)\[(.+)\]$/.exec(seg);
  if (dialog) return `[role="dialog"]:has(:text-is("${dialog[2]}")), [aria-modal="true"]:has(:text-is("${dialog[2]}"))`;
  return seg; // fall through
}
```

Use this helper inside every emitted scenario. Do not write ad-hoc selectors.

### W-10.3 — Transpile one trace into one scenario function

For each scenario in `scenarios.md`, the menu names a `traceSlice` (range of trace events). The transpiler walks the slice and emits one `act()` call per `interaction` event and one `expect()` per `assert` event.

```ts
// Emitted shape — every scenario follows this pattern
export async function S_NNN_NN_<name>(page: Page, ctx: BrowserContext): Promise<void> {
  // <-- L1 setup: navigate to entry route from the trace's first goto event -->
  const goto1 = await act(page, () => page.goto('<route from trace.jsonl>', { waitUntil: 'domcontentloaded' }));
  expect(goto1.label).toBe('navigated');

  // <-- one block per interaction event in the trace slice -->
  const r1 = await act(page, () =>
    locatorFor(page, /* uig row from uig_ref */).click()
  );
  expect(r1.label).not.toBe('error-surfaced');

  // <-- one expect() per assert event -->
  await expect(locatorFor(page, /* uig row */)).toBeVisible();
}

S_NNN_NN_<name>.contract = {
  preconditions:  [/* derived from trace slice's first event's prior state */],
  postconditions: [/* derived from trace slice's last event's posterior state */],
  sideEffects:    [/* if the trace touches viewport, cookies, page.route, etc. */],
};
```

The transpiler **never inserts** a selector or assertion that has no UIG row or trace event backing it. If the menu asks for a scenario that the trace doesn't cover, the transpiler writes a `test.skip()` stub with reason `"no trace evidence"` rather than fabricating one.

---

## W-10.4 — Layered emission per route

For every distinct route reached by `trace.jsonl`, emit four functions automatically:

| Layer | Function name | Asserts |
|---|---|---|
| L1 Smoke | `S_NNN_smoke_<route>` | `goto` returns label `navigated`, page has H1, console clean per `app-quirks.yml.console_allowlist` |
| L2 Shape | `S_NNN_shape_<route>` | UIG interactable counts ±1 vs Phase 1 snapshot, `getByRole('heading', { level: 1 })` visible |
| L3 Behavior | `S_NNN_behavior_<uigRef>` (one per interactable) | clicking the UIG element produces its recorded `effect` (label match) |
| L4 Contract | `S_NNN_contract_<id>` | only generated when a matching entry exists in `qa/context/` |

L1+L2+L3 are emitted ALWAYS — fully autonomous. L4 is opt-in by user-supplied PRD content (handled by the transpiler reading `qa/context/feature-specs/*.md`).

---

## W-10.5 — Contract sidecar

Every scenario function ships with a typed contract. The journey planner consumes this:

```ts
type ScenarioContract = {
  preconditions: string[];   // e.g. ["route:/dashboard", "overlay:onboarding-wizard:step=ai", "auth=true"]
  postconditions: string[];
  sideEffects: ('viewport-change' | 'cookies-cleared' | 'route-mocked')[];
};
```

Derivation rules:
- `route:/X` — from `goto` events.
- `overlay:<id>:<state>` — from UIG rows whose scope is in the overlay registry.
- `auth=true` / `auth=false` — from trace events whose outcome was `auth-success` / `signOut` action.
- `viewport-change` — emitted when the scenario calls `page.setViewportSize`.
- `cookies-cleared` — emitted when the scenario calls `ctx.clearCookies` or signs out.
- `route-mocked` — emitted when the scenario calls `page.route`.

The journey planner uses contracts to mechanically order steps, inject setup, and wrap side effects in `try/finally`. **No "MUST be last" comments. No hand-pinned ordering.**

---

## W-10.6 — Skip semantics

A scenario whose preconditions cannot be satisfied at runtime calls `test.skip(true, reason)` — never a vacuous early `return`. The runtime engine in `qa/scripts/heal.js` cooperates: if the planner injected a setup step that fails, the dependent scenario skips with a diagnosable message.

```ts
// Emitted when preconditions like "wizard.step=ai" cannot be reached
test.skip(!await canReach(page, ['wizard.step=ai']), 'precondition unmet: wizard.step=ai');
```

Vacuous green tests are gone. A skip is honest reporting.

---

## Step W-10.7: Standalone wrappers (Layer 2 file)

Mechanical — one `test()` per exported scenario function. No logic.

```ts
// qa/tests/F-NNN-<slug>.spec.ts
import { test } from '@playwright/test';
import * as F from '../flows/F-NNN-<slug>/F-NNN.scenarios';

test.describe('F-NNN: <name>', () => {
  for (const fnName of Object.keys(F)) {
    if (typeof (F as any)[fnName] !== 'function') continue;
    test(fnName, async ({ page, context }) => (F as any)[fnName](page, context));
  }
});
```

Mixed-auth flows: the wrapper introspects each function's `.contract.preconditions`. If `auth=true` is required, it loads `storageState` from the corresponding `.auth/<role>.json`. No `test.use()` per group.

---

## Step W-10.8: Journey assembly (handed off to the planner)

After every flow's scenarios are written, run the journey planner:

```bash
node scripts/assemble-journey.js --role free
node scripts/assemble-journey.js --role anonymous
```

The planner:
1. Reads `.contract` sidecars from every emitted scenario.
2. Reads `qa/knowledgebase/uig.jsonl` for setup-action discovery.
3. Topologically orders scenarios so each step's preconditions are satisfied.
4. Injects setup steps from the UIG when current state lacks required preconditions.
5. Wraps `sideEffects` (viewport, cookies, route mocks) in journey-level `try/finally`.
6. Emits `qa/journeys/J-NNN-<role>.spec.ts` and `qa/journey-todo/J-NNN-<role>.todo.md`.

**No hand-ordered journey files.** No "MUST be last" comments. No viewport-restoration commentary. The planner produces the entire `.spec.ts` from the contracts.

---

## Quality contract — same as before, plus new

| Rule | Source |
|---|---|
| Syntactically valid TypeScript | language |
| No hardcoded URLs / credentials — all via `process.env.QA_*` | runtime |
| `waitUntil: 'domcontentloaded'` (never `networkidle` on SPAs) | runtime |
| **Every interaction wrapped in `act()`** | NEW |
| **Every locator scope-qualified** | NEW |
| **Every function has `.contract`** | NEW |
| **No `.first()` / `.last()` for disambiguation** — fail audit | NEW |
| **No raw `toHaveURL(/\?param=/)` for SPA params** — use `act()` label | NEW |
| **Console assertions filter via `app-quirks.yml.console_allowlist`** — use `expectConsoleClean()` | NEW |
| Stateful buttons use the toggle-pair from `app-quirks.yml.toggle_pairs` | NEW |

---

## Runner infrastructure (after all flows + assembler)

Copy templates (no edits needed; they read `.env.qa` dynamically):

| Source | Destination |
|---|---|
| `skills/web/templates/run.js` | `qa/run.js` |
| `skills/web/templates/package.json` | `qa/package.json` |
| `skills/web/templates/heal.js` | `qa/scripts/heal.js` |
| `.env.example` | `qa/.env.example` (if not exists) |

**Phase boundary checkpoint** — heavy `qa/state.md`. Log:
`"Phase 3 complete — [N] scenario modules, [N] standalone, [N] journeys. UIG rows: [M]. Quirks: [K]."`

→ Next: [phase4.md](phase4.md)
