# macOS — Phase 2: Credentials + Scenarios (Step 8)

**Goal**: Acquire credentials for auth-gated flows, trace them, then generate full-coverage scenarios per flow.
**Output**: completed `flow.md` for auth-gated flows + `scenarios.md` per flow.

Runtime rules — see `skills/_shared/runtime.md`.

---

## Step 8.0: Credential Acquisition — Screenshot-Driven

**Never assume email + password.** Read Phase 1 screenshots first.

### 8.0a Read Auth Screenshots

For each auth-gated flow, read its Phase 1 screenshots. Identify exact fields:

| UI shows | Credential needed |
|---|---|
| Email + Password | `QA_TEST_EMAIL`, `QA_TEST_PASSWORD` |
| API key + provider dropdown | `QA_LLM_API_KEY`, `QA_LLM_PROVIDER` |
| Username only | `QA_USERNAME` |
| Bearer token | `QA_BEARER_TOKEN` |
| OAuth button only | SSO — manual session required |

### 8.0b Present Options

> "To trace **[F-NNN — Name]**, I need (from UI):
>
> | Field | Env Key |
> |---|---|
> | [exact label] | `QA_[NAME]` |
>
> **1.** I'll check `.env.qa` and report
> **2.** Paste values in chat — I save to `.env.qa`
> **3.** I self-register *(only if UI shows email + password signup)*"

### 8.0c Check `.env.qa`

```bash
node -e "
require('dotenv').config({ path: '.env.qa' });
const needed = process.argv.slice(1);
needed.forEach(k => console.log(k + ':', process.env[k] ? '✅ set' : '❌ MISSING'));
" -- QA_TEST_EMAIL QA_TEST_PASSWORD
```

### 8.0d Credentials in Chat

```bash
echo "QA_TEST_EMAIL=test@mailinator.com" >> .env.qa
echo "QA_TEST_PASSWORD=TestPass123!" >> .env.qa
```

### 8.0e Self-Registration (email + password only)

Only if Phase 1 showed an email + password signup. NEVER for API keys, OAuth, payment.

```applescript
tell application "[AppName]" to activate
delay 2
tell application "System Events"
    tell process "[AppName]"
        -- Adapt to actual signup path from Phase 1 screenshots
        set value of text field 1 of window 1 to "qatest-" & (do shell script "date +%s") & "@mailinator.com"
        delay 0.5
        set value of text field 2 of window 1 to "QAtest123!"
        delay 0.5
        click button "Sign Up" of window 1
        delay 3
    end tell
end tell
```

Screenshot result → Read → confirm.

### Non-automatable

| Type | Action |
|---|---|
| Google/Apple/X/GitHub SSO | `playwright codegen`; mark TC "requires manual session" |
| LLM API keys | User provides |
| Payment | User provides; Stripe test card `4242 4242 4242 4242` if Stripe |
| TOTP / 2FA | User provides seed |
| Enterprise SAML | Out of scope |

Never block Phase 2 on non-automatable. Continue with other flows.

### 8.0f Authenticated Exploration

After credentials resolved, trace every auth-gated flow step-by-step (same protocol as Phase 1 §6.5). Add screenshots to `flow.md` evidence.

---

## Step 8.1: Scenario Generation

Maximum coverage per flow.

| Category | Min | Priority | When |
|---|---|---|---|
| Happy Path | 1 | P1 | Every flow |
| Alternative Happy Path | 1+ | P1 | Multiple valid paths |
| Negative / Invalid Input | 2+ | P1 | User input |
| Empty / Null Input | 1 | P1 | Required fields |
| Boundary Values | 2 | P2 | Length/range |
| State Persistence | 1 | P2 | State-changing |
| Interrupted Flow | 1 | P2 | Multi-step |
| Error Recovery | 1+ | P2 | Network/IO/server |
| Offline / No Network | 1 | P2 | Connectivity-dependent |
| Permission Denied | 1 | P2 | OS permissions |
| Concurrent / Double-tap | 1 | P3 | Action buttons |
| Accessibility | 1 | P3 | All flows |

Reference: `skills/macos/references/test-patterns.md` for patterns by UI element.

| Flow Complexity | Min Scenarios |
|---|---|
| Simple (launch, quit) | 3–5 |
| Medium (settings, nav) | 6–10 |
| Complex (auth, core feature) | 10–20 |

## Step 8.2: Write `scenarios.md`

Each `qa/flows/F-NNN-[slug]/scenarios.md` has:
- Header: flow ref, app name, total count, date
- Per scenario: S-NNN-NN heading → table (Priority, Category, Preconditions, Steps summary, Expected result, TC file link)
- Coverage Summary table: Category | Count | TC Files

→ Heavy checkpoint after all `scenarios.md` written. Log: `"Phase 2 complete — [N] scenarios across [N] flows."`

→ Next: [phase3.md](phase3.md)
