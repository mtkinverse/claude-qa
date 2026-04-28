---
name: fingerprint-questions
description: The five generic questions Claude answers about any app before exploration. Output goes to qa/platform-fingerprint.md (written once, never regenerated).
type: reference
---

# Platform Fingerprint — The Five Questions

> ⚠️ **EXAMPLES AND PREFERRED SUGGESTIONS** — adapt the wording, not the questions.

Before delegating to a platform skill, the root orchestrator answers these five questions using:
- App name + URL/path from Step 2
- `.env.qa` values (auth flags, account tier, sandbox mode)
- Files in `qa/context/` (PRDs, Figma, specs)
- ONE quick probe — launch app. **macOS/native**: take ONE screenshot. **Web**: call `snapshotPage()` once — do NOT take a screenshot. No deeper exploration.

Output is written to `qa/platform-fingerprint.md` ONCE. Never rewritten. Re-read on every resume.

---

## Q1. App Category

What kind of surface is this?

| Option | Signals |
|---|---|
| **SPA** | Single HTML shell, client routing, rich JS framework markers |
| **MPA** | Server-rendered, full page reloads on nav, classic links |
| **Native shell** | Webview-wrapped (Electron, Tauri, Capacitor) |
| **Pure native** | macOS / iOS / Android / Windows app |
| **CLI / TUI** | Terminal-only, no GUI |
| **Hybrid** | Mix — explain which surface dominates |

**Why this matters**: drives strategy selection (SPA → BFS or targeted-trace; static MPA → sitemap-spot-check; native → AppleScript / UIAutomator).

## Q2. Auth Model

How do users get in?

| Option | Signals |
|---|---|
| **None** | Public, no login required |
| **Local** | Email + password, app-managed |
| **SSO / OAuth** | Google / Apple / GitHub / SAML — needs manual session |
| **API key** | Per-user token entry on first run |
| **OS-level** | Native auth (Touch ID, Windows Hello) |
| **Mixed** | Multiple options on the login screen |

**Hint — also estimate ROLE COUNT** (1 = single user type; 2-3 = e.g. admin/member; 4+ = multi-tier). This drives the role-confirmation gate (web Step W-2.5) and which `QA_<ROLE>_*` env vars are needed.

**Why this matters**: determines whether Phase 2 needs `auth.setup.ts`, codegen-captured session, or can run un-authed; and how many `storageState` files to cache under `qa/.auth/`.

## Q3. Surface Complexity

What dominates the user's time in the app?

| Option | Signals |
|---|---|
| **Onboarding-heavy** | Multi-step wizards, account setup, integrations to connect |
| **Dashboard / app** | Persistent nav, multiple tools/widgets, heavy interactivity |
| **Content** | Read-mostly: docs, blog, marketing, knowledge base |
| **Transactional** | Forms + checkout + confirmations |
| **Mixed** | Specify the dominant surface |

**Why this matters**: drives strategy. Onboarding-heavy → targeted-trace. Dashboard → BFS. Content → sitemap-spot-check.

## Q4. Audience

Who is this for?

| Option | Signals |
|---|---|
| **B2C** | Public sign-up, consumer pricing, broad audience |
| **B2B** | Workspace/team concepts, admin roles, billing tiers |
| **Internal** | No public sign-up, employee-only |
| **Developer** | API docs, SDK downloads, technical setup |

**Why this matters**: shapes scenario priorities (B2B → multi-user/permission scenarios; B2C → mobile viewport + accessibility; Developer → API + CLI scenarios).

## Q5. Chosen Exploration Strategy + Rationale

Pick the strategy you intend to start with and state why.

| Strategy | Best for |
|---|---|
| **BFS** (`skills/<platform>/strategies/bfs.md`) | Dashboard / multi-page apps with rich nav |
| **Targeted-trace** | Onboarding-heavy / wizard apps with linear paths |
| **Sitemap + spot-check** | Content-heavy apps with discoverable URL inventories |
| **Custom** | Justify why none of the above fit; describe your approach |

**Required output**: 2-3 sentences naming the strategy, justifying it from Q1-Q4 answers, and **declaring the fallback** (which alternative strategy to switch to if the primary stalls).

---

## Output Format — `qa/platform-fingerprint.md`

```markdown
# Platform Fingerprint — [AppName]

| Question | Answer | Evidence |
|---|---|---|
| Q1 — App Category | [option] | [1-line evidence] |
| Q2 — Auth Model | [option] | [1-line evidence] |
| Q3 — Surface Complexity | [option] | [1-line evidence] |
| Q4 — Audience | [option] | [1-line evidence] |
| Q5 — Strategy + Rationale | [strategy] | [2-3 sentences + fallback] |

**Generated**: YYYY-MM-DD HH:MM
**Source data**: [.env.qa / qa/context/ files / probe screenshot path]
```

Write once. Never rewrite. If app character genuinely changed mid-run (e.g. crossed an auth boundary into a different product surface), append a new dated section — do not edit the original.
