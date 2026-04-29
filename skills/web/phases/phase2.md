# Web — Phase 2: Scenario Planning

**Goal**: Generate test scenarios for every traced flow.
**Input**: `qa/flows/F-NNN-*/flow.md` from Phase 1.
**Output**: `qa/flows/F-NNN-*/scenarios.md` per flow.
**Transition**: automatic — after all scenarios written, immediately begin Phase 3.

Runtime rules — see `skills/_shared/runtime.md`.

---

## Step W-6.9: Phase 2 Entry Precondition (HARD GATE)

**Run before anything else in Phase 2. Do not author a single scenario until these pass.**

```bash
node scripts/audit-snapshots.js   # snapshot fidelity
node scripts/coverage-check.js    # every snapshot is in ui-inventory + a flow
node scripts/crawl-gate.js        # zero ⬜ pending, zero 🔄 active, every ⛔ has a reason
```

Any non-zero exit → return to Phase 1. Specifically:
- `crawl-gate.js` failing means Phase 1 was exited prematurely. Resume the deep-exploration loop in `phase1.md` step 3 ("Autonomous deep-exploration"), drain every `⬜ pending` URL, then re-run the gate.
- Do not "skip" the gate by editing `crawl-todo.md` directly. Either explore the URL or mark it skipped via `update-crawl-todo.js --mark-skipped <url> --reason "<why>"`.

This precondition exists because scenarios authored against incomplete coverage produce silent gaps — the agent cannot test what it never discovered.

---

## Step W-7: Resolve Remaining Auth Gates

If Phase 1 BFS skipped auth gates (pages marked `⛔ AUTH REQUIRED`), resolve now.

Credential handling = same protocol as W-2.6 (no duplication):
1. Check `.env.qa` → use if available
2. Ask user → provide in chat or self-generate
3. Self-generate → disposable email + email verification
4. Use ONLY the auth method user chose

After credentials resolved → write `qa/auth.setup.ts` from template `skills/web/templates/auth.setup.ts`. **Important**: the template uses generic selectors. After copying, read the Phase 1 auth-gate snapshots to adapt selectors (login URL, field labels, button text, post-login URL) to this app's actual DOM.

Then **re-run BFS from auth-gated URLs** to discover pages behind the gate. Add new pages to `ui-inventory.md`, create new flows for new feature areas.

### Non-automatable Credentials

| Type | Action |
|---|---|
| Google/X/Apple/GitHub SSO | `playwright codegen --save-storage=qa/.auth/sso.json [URL]`; mark "requires manual session" |
| LLM API keys | User provides via `.env.qa` or chat |
| Stripe / payment | Test card `4242 4242 4242 4242` if Stripe detected |
| TOTP / 2FA | User provides TOTP seed |
| Enterprise SSO / SAML | Out of scope; note in `flow.md` |

**Never block Phase 2** for non-automatable creds. Continue with flows that have full access.

---

## Step W-9: Scenario Generation — Full Coverage

For each flow, read `flow.md` and generate ALL scenarios.

### Generation Rules

1. **Read `flow.md` first** — every scenario must trace to something in the Discovery Evidence table. No invented scenarios.
2. **One scenario = one user intent + one expected outcome.** Two assertions → split.
3. **Naming**: `S-NNN-NN` — first NNN = flow number, NN = sequence. E.g., `S-001-01`.
4. **Cover all applicable categories below** — at minimum one per category. Skip categories that don't apply.
5. **Priority**: P1 = user can't complete goal. P2 = degraded experience. P3 = cosmetic / edge.

### Universal categories (every flow)

| Category | Min/flow | Priority | Description |
|---|---|---|---|
| Happy path (E2E) | 1 | P1 | Complete flow with valid inputs |
| Required field validation | 1/form | P1 | Empty required fields |
| Invalid input | 1/input | P1 | Wrong format, too long, special chars, SQL/XSS |
| Boundary values | 1/numeric|text | P2 | Min, max, ±1, empty |
| Error state recovery | 1 | P2 | Retry after error → success |
| Empty state | 1 | P2 | New user, empty list, no results |
| Loading / slow network | 1 | P3 | Spinners, skeletons |
| Unauthorized access | 1/auth-gated page | P1 | Direct URL without login |

### Web-specific categories

| Category | Min | Priority | When |
|---|---|---|---|
| SPA route access (direct URL) | 1 | P1 | Every route |
| Auth guard (unauth → protected) | 1 | P1 | Auth-gated routes |
| Form validation (inline + submit) | 2+ | P1 | Any form |
| Mobile viewport (375/390px) | 1 | P2 | Every page |
| Network error / API failure | 1 | P2 | Forms with API calls |
| Console error monitoring | 1 | P2 | Every page |
| WCAG / axe-core | 1 | P3 | Every page |
| Visual regression baseline | 1 | P3 | Key pages |

**Target**: every visible interactive element from Phase 1 has at least one scenario. Discovery snapshots inform every scenario.

---

**Phase boundary checkpoint**: write full `qa/state.md` (heavy template — runtime.md §3). Generate QA report. Log: `"Phase 2 complete — [N] scenarios across [N] flows."`

→ Next: [phase3.md](phase3.md)
