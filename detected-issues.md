-------
Selectors in manifest.jsonl are not real Playwright selectors                                                                                       
                                                                                                                                                                
  Look at F-001's manifest:
  {"step":3,"action":"fill","target":"input[type=password]:nth(0)"}    ← invalid CSS                                                                            
  {"step":5,"action":"click","target":"button[name='Sign up']"}        ← `name=` is not a CSS attribute on <button>                                             
  {"step":6,"action":"assert-alert","target":"user already exists"}    ← not a selector at all                                                                  
                                                                                                                                                                
  And F-003:                                                                                                                                                    
  {"step":3,"action":"click","target":"button[name~='Select tasks']"}  ← `~=` is whitespace-list match                                                          
  {"step":4,"action":"click","target":"checkbox[index=0]"}             ← `checkbox` is a role, not a tag                                                        
                                                                                                                                                                
  These are a DSL — pseudo-selectors that look like CSS but are not. Phase 3 must transpile them to page.getByRole('button', { name: 'Sign up' }) etc. The DSL  
  is undocumented (no parser spec in skills/web/), the role↔tag mapping (button vs checkbox) is implicit, and disambiguation when a name appears twice (e.g.    
  "Sign out" in both sidebar and dropdown — explicitly noted in decisions.md:11) is offloaded to app-quirks.yml plus "nth-based selection in test code" — which 
  means the transpiler must reconcile manifest target × uig.jsonl scope × app-quirks disambiguation × runtime app behavior. A lot of moving parts before any    
  test runs.

-------------------------------------------------------------------------------------------------------

2. "Web should use screenshots" — this is the design tension                                                                                                  
   
  You're right that this is a real gap. Here's the current design vs. what's actually happening:                                                                
                  
  - Phase 1/2 web is intentionally screenshot-light. The root SKILL.md literally says: ⛔ WEB DISCOVERY USES NO SCREENSHOTS. Phase 1/2 use snapshotPage()       
  (DOM/ARIA JSON). The reasoning: DOM/ARIA snapshots are cheap (kilobytes of structured text), screenshots are expensive (vision tokens). A 50-page BFS at 1
  screenshot/page = context dead.                                                                                                                               
  - But BFS code (W-2.3) DOES call capture() after every page. So the strategy file contradicts the root rule. There's an inconsistency in the codebase.
  - The trade-off it makes: rely on snapshotPage() (ARIA tree → JSON) to "see" the page. That works for normal forms/buttons but fails the exact case you       
  described: a "Setup Assistant" with a Skip button is visually obvious but ARIA-wise it's just two buttons of equal weight — the agent has no signal that      
  "Continue" is the primary path and "Skip" is the bypass. So it picks whichever the heuristic returns first, which on many wizards is Skip (smaller text, no   
  type=submit).                                                                                                                                                 
                  
  3. Why it skips interactions — the actual root causes                                                                                                         
   
  There are four distinct failure modes that all look like "skipped a flow", and they have different fixes:                                                     
                  
  a. The Skip-button trap (your example).                                                                                                                       
  Strategy code in targeted-trace.md (findNextAction) prioritises:
  4. Primary CTA (button[type="submit"], button.primary, [class*="primary"])                                                                                    
  5. Required form fields                                                                                                                                       
  6. Continue/Save links                                                                                                                                        
                                                                                                                                                                
  If a Setup Assistant uses unstyled <button> for "Continue" and another <button> for "Skip", neither matches button.primary → it falls through to "any visible
  nav item" → may click Skip. Plus the BFS strategy's "safe button" whitelist (SAFE_NAV regex) actively prefers labels like skip|later|maybe because they're not
   in the DANGEROUS list and they're short.


==========================================================================


2. "Web should use screenshots" — this is the design tension                                                                                                  
   
  You're right that this is a real gap. Here's the current design vs. what's actually happening:                                                                
                  
  - Phase 1/2 web is intentionally screenshot-light. The root SKILL.md literally says: ⛔ WEB DISCOVERY USES NO SCREENSHOTS. Phase 1/2 use snapshotPage()       
  (DOM/ARIA JSON). The reasoning: DOM/ARIA snapshots are cheap (kilobytes of structured text), screenshots are expensive (vision tokens). A 50-page BFS at 1
  screenshot/page = context dead.                                                                                                                               
  - But BFS code (W-2.3) DOES call capture() after every page. So the strategy file contradicts the root rule. There's an inconsistency in the codebase.
  - The trade-off it makes: rely on snapshotPage() (ARIA tree → JSON) to "see" the page. That works for normal forms/buttons but fails the exact case you       
  described: a "Setup Assistant" with a Skip button is visually obvious but ARIA-wise it's just two buttons of equal weight — the agent has no signal that      
  "Continue" is the primary path and "Skip" is the bypass. So it picks whichever the heuristic returns first, which on many wizards is Skip (smaller text, no   
  type=submit).                                                                                                                                                 
                  
  3. Why it skips interactions — the actual root causes                                                                                                         
   
  There are four distinct failure modes that all look like "skipped a flow", and they have different fixes:                                                     
                  
  a. The Skip-button trap (your example).                                                                                                                       
  Strategy code in targeted-trace.md (findNextAction) prioritises:
  4. Primary CTA (button[type="submit"], button.primary, [class*="primary"])                                                                                    
  5. Required form fields                                                                                                                                       
  6. Continue/Save links                                                                                                                                        
                                                                                                                                                                
  If a Setup Assistant uses unstyled <button> for "Continue" and another <button> for "Skip", neither matches button.primary → it falls through to "any visible
  nav item" → may click Skip. Plus the BFS strategy's "safe button" whitelist (SAFE_NAV regex) actively prefers labels like skip|later|maybe because they're not
   in the DANGEROUS list and they're short.
                                                                                                                                                                
  b. BFS doesn't interact, only navigates.                                                                                                                      
  W-2.5 only clicks buttons that look like navigation (matching view|open|see-all|browse|...). It explicitly does not click form submits, wizard Continue 
  buttons, or feature triggers during discovery — that's deferred to Phase 2 trace. So a button that opens a modal or kicks off a 3-step inline wizard is       
  invisible to BFS.
                                                                                                                                                                
  c. No global "interactive element frontier".                                                                                                                  
  Exactly the gap you spotted. There's a state.queue of URLs and a state.visited set of URLs. There is no equivalent queue for buttons / icons / modals / tabs /
   accordions. W-2.4 clicks tabs and dropdowns only to harvest more hrefs, then closes them — it doesn't enqueue "this button on this page is unexplored, come  
  back to it." So:
  - Page A has 12 buttons. BFS clicks 0–3 of them (only the SAFE_NAV whitelist).                                                                                
  - 9 buttons are never explored.                                                                                                                               
  - Nothing tracks them as "pending."
                                                                                                                                                                
  d. consecutiveStalls ends the run too easily.
  Targeted-trace bails to BFS after 3 no-change outcomes. If a wizard step needs a checkbox tick before "Continue" enables, the agent clicks Continue →         
  no-change → counts a stall → eventually gives up. There's a wiggle-pass helper meant to address this (toggle siblings to discover preconditions), but it's    
  only invoked for explicitly disabled controls — not for buttons that look enabled but silently no-op.                                                         
                                                                                                                                                                
  4. Your proposed fix — "maintain a frontier of every link AND every interactive element"                                                                      
   
  Your instinct is correct and matches what's actually missing. The architecturally honest version of your idea:                                                
                  
  crawl-state.json (existing)             interactions-state.json (NEW)                                                                                         
  ─────────────────────────               ───────────────────────────────                                                                                       
  visited: Set<url>                       explored: Set<element-fingerprint>
  queue:   [{url, depth}]                 queue:   [{url, selector, role,                                                                                       
                                                      name, fingerprint, depth}]                                                                                
                                                                                                                                                                
  Where element-fingerprint = hash(url + role + accessible-name + parent-section). On every visited page, snapshot ALL interactives (buttons, links, tabs,      
  accordions, icon buttons, role=button divs), enqueue any not in explored. The crawl is done when both queues are empty, not just the URL queue. With          
  per-element budgets (QA_MAX_INTERACTIONS_PER_PAGE, QA_MAX_TOTAL_INTERACTIONS) so context doesn't explode.                                                     
                  
  per-element budgets (QA_MAX_INTERACTIONS_PER_PAGE, QA_MAX_TOTAL_INTERACTIONS) so context doesn't explode.

  This also fixes the Skip-button problem cleanly: instead of the agent choosing one button via heuristic priority, it explores both Skip and Continue paths —
  Skip becomes one branch, Continue another. Each branch can checkpoint and reset context independently. That's how a human QA explores too.

  Where it's harder than it looks:
  - Resetting state between branches. Clicking Skip changes app state; to then explore Continue you must reset (relogin, clear localStorage, replay the path up
  to that fork). Playwright's storageState snapshots cover auth but not app-internal state. So branches need a "replay prefix" recorded — exactly what
  manifest.jsonl and trace.jsonl are trying to be in the current code, but they're per-flow, not per-fork.
  - Element identity across reloads. A button's selector is fragile. The element fingerprint must be stable across re-renders (role + accessible-name +
  DOM-section path, NOT CSS selector or nth-child).
  - Token budget. 50 pages × 12 elements × 2 screenshots (before/after) = 1200 vision reads. The current "no screenshots in web" rule was an over-correction to
  this. Middle ground: snapshot DOM/ARIA always, screenshot only at fork points or when outcome-classifier flags ambiguity.

  Where I'd start

  Three concrete changes (smallest → biggest):

  1. Fix the Skip-button heuristic immediately: in findNextAction and the BFS button whitelist, demote labels matching /skip|later|maybe|not now|dismiss|set up
  later/i to last priority (not into DANGEROUS — they're not destructive — but never the first pick when any other actionable element exists). One-day fix, big
  win.
  2. Add a per-page interaction inventory to crawl-state.json (not a separate file yet). On each visited page, record { buttons: [{name, role, fingerprint,
  clicked: false}], modals: [...], tabs: [...] }. Don't act on it yet — just see how big the frontier is on real apps. This is a measurement step before a
  behavior change.
  3. Then build the second queue with branch-replay. This is a real feature, probably 1–2 weeks; hardest part is replay state.


Here's the deep analysis. I'm being concrete — pointing at exact files and lines so you can verify each issue.                                                
                                                                                                                                                                
  What this run actually accomplished                                                                                                                           
                                                                                                                                                                
  For paioclaw.ai, Phase 1 produced: 22 ARIA snapshots + 22 PNGs, 8 traced flows (F-001…F-008), a 575-line uig.jsonl, ui-inventory + nav-graph +                
  journey-inventory + roles + categories + decisions, and 7 runtime helper scripts in qa/scripts/. Auth + onboarding obstacles were navigated successfully      
  (sign-up→sign-in fallback, persona+tasks wizard driven to completion, Setup AI Assistant skipped via "Set up later"). qa/.auth/user.json saved. qa/tests/ and 
  qa/journeys/ are both empty — Phase 3 has not run.                                                                                                            
                                                                                                                                                                
  That's the surface. Now the real issues.

  ---
  Issue 1 — Coverage is narrow and the agent knows it
                                                                                                                                                                
  crawl-todo.md says "10 explored, 1 skipped, 11 total." Eleven URL-states for an entire SaaS app. Look at what was not explored, even though every flow.md
  mentions it:                                                                                                                                                  
                  
  ┌────────────┬─────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐    
  │   Where    │                      What was deferred / surface-only                       │                          Evidence                           │
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤    
  │ F-005 AI   │ Add API Key dialog never opened. The whole BYOK feature — provider          │ flows/F-005-ai-models/flow.md:12,21 "surface only — Add API │
  │ Models     │ dropdown, model dropdown, key validation, "My API keys" list — is a black   │  Key dialog deferred"; manifest stops at 5 observe lines    │
  │            │ box.                                                                        │                                                             │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ F-007      │ Browser Agent tab never clicked. Mac install guide read, but Browser side   │ flows/F-007-agents/flow.md:21 "Browser Agent tab not yet    │    
  │ Agents     │ unexpanded.                                                                 │ expanded"                                                   │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ F-008 Sign │ User dropdown never opened, never clicked Sign Out, never verified          │ flows/F-008-sign-out/flow.md:12,25 "dropdown click deferred │    
  │  Out       │ redirect.                                                                   │  — overlay-blocked"                                         │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ F-004      │ "Create new assistant" / "Create AI Assistant" CTAs never clicked. The      │ flows/F-004-dashboard-core/flow.md:19,20                    │    
  │ Dashboard  │ primary product action of the app is unexplored.                            │                                                             │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ F-006      │ Search input never typed into. Just "empty list observed".                  │ flows/F-006-devices/flow.md:19                              │    
  │ Devices    │                                                                             │                                                             │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │            │ Pricing top-up buttons ($5/$10/$20/$50) not clicked. Monthly/Annual toggle  │                                                             │    
  │ F-002      │ not toggled. FAQ accordion not expanded. Plan CTAs (Start for Free, Go with │ ui-inventory.md:7,20-21                                     │    
  │ Marketing  │  Smart, Go with Genius) not followed. Privacy/Terms pages "not snapshotted" │                                                             │
  │            │  per ui-inventory.                                                          │                                                             │    
  ├────────────┼─────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │            │ "Forgot Password?" link never clicked. "Show password" toggle never         │                                                             │
  │ F-001 Auth │ clicked. Sign-up validation cases (weak password, mismatched confirm,       │ flows/F-001-auth/flow.md:22                                 │    
  │            │ invalid email) not probed.                                                  │                                                             │
  └────────────┴─────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘    
                  
  This is exactly the "skip option / button skipped" problem you described, but at scale. The agent records the existence of an interactive element in uig.jsonl
   (575 lines of buttons/links) but the manifest — the file Phase 3 transpiles into tests — only contains the one path it actually walked. Eight flows × ~5–12
  manifest lines each ≈ 60 actions total, against ~575 known interactives. Roughly 10% of observed UI is exercised.                                             
                  
  The decisions log even admits it: "Deeper BYOK tracing deferred to Phase 2 scenario planning." But Phase 2 in this skill is scenario planning, not exploration
   — by then the browser is closed and the only inputs are manifest.jsonl + trace.jsonl + snapshots. Anything not interacted with in Phase 1 will not appear in 
  tests. This is a structural deferral bug, not a one-off skip.                                                                                                 
                  
  Issue 2 — journey-inventory.md lies about completeness                                                                                                        
  
  Every flow says Status: TRACED and the inventory says all 8 are TRACED. But:                                                                                  
  - F-005 status field literally adds "(surface only — Add API Key dialog not opened in Phase 1)"
  - F-007 status: "TRACED" but flow.md says Browser tab unexpanded                                                                                              
  - F-008 status: "TRACED (surface evidence; dropdown not yet opened in Phase 1)"
                                                                                                                                                                
  TRACED has no integrity. It just means "we wrote a flow.md." There is no "PARTIAL" or "DEFERRED" status. Phase 3 will treat all 8 equally and produce 8 tests,
   3 of which will be near-empty smoke checks. The coverage-check.js and crawl-gate.js gates pass — but they're checking that files exist, not that interactives
   were exercised. This matches what decisions.md:10-13 admits about audit-snapshots.js failing on empty-name buttons and being waved through.                  
                                                                                                                                                                
  Issue 3 — A real precondition failure was masked as success                                                                                                   
  
  pending-question.md still contains:                                                                                                                           
  {"blocker": "onboarding-continue-still-disabled", "tasksPicked": []}
                                                                                                                                                                
  This is a live, unresolved blocker from the run. The wiggle-pass / Radix-checkbox issue was hit, the agent wrote the pending question, something unblocked it 
  (manual user intervention based on decisions.md:7), but the pending-question file was never cleared. Two consequences:                                        
  - On a fresh resume (Read qa/state.md and continue), the engagement protocol may re-trigger off this stale file.                                              
  - More importantly: the actual fix lives in qa/scripts/onboarding-complete.js (a hand-corrected runtime script) — but this fix is not generalised. Next app   
  with Radix checkboxes will hit the same wall. The "DOM walker reports name=on" quirk is recorded in app-quirks.yml:6-7 and ui-inventory.md:48, but         
  snapshot-page.js was never patched. The bug is documented, not fixed.                                                                                         
                                                                       
  Issue 4 — Selectors in manifest.jsonl are not real Playwright selectors                                                                                       
                                                                                                                                                                
  Look at F-001's manifest:
  {"step":3,"action":"fill","target":"input[type=password]:nth(0)"}    ← invalid CSS                                                                            
  {"step":5,"action":"click","target":"button[name='Sign up']"}        ← `name=` is not a CSS attribute on <button>                                             
  {"step":6,"action":"assert-alert","target":"user already exists"}    ← not a selector at all                                                                  
                                                                                                                                                                
  And F-003:                                                                                                                                                    
  {"step":3,"action":"click","target":"button[name~='Select tasks']"}  ← `~=` is whitespace-list match                                                          
  {"step":4,"action":"click","target":"checkbox[index=0]"}             ← `checkbox` is a role, not a tag                                                        
                                                                                                                                                                
  These are a DSL — pseudo-selectors that look like CSS but are not. Phase 3 must transpile them to page.getByRole('button', { name: 'Sign up' }) etc. The DSL  
  is undocumented (no parser spec in skills/web/), the role↔tag mapping (button vs checkbox) is implicit, and disambiguation when a name appears twice (e.g.    
  "Sign out" in both sidebar and dropdown — explicitly noted in decisions.md:11) is offloaded to app-quirks.yml plus "nth-based selection in test code" — which 
  means the transpiler must reconcile manifest target × uig.jsonl scope × app-quirks disambiguation × runtime app behavior. A lot of moving parts before any    
  test runs.      

  Issue 5 — uig.jsonl is rich but underused                                                                                                                     
  
  575 lines of {slug, scope, role, name, exact, uniqueInScope, disabled, href, type, effect, preconditions} — this is genuinely good data. It captures          
  uniqueInScope, preconditions, disabled state. But:
  - preconditions: [] on every line I sampled — wiggle-pass either didn't run or didn't write findings back. The Radix-checkbox quirk would have been the       
  perfect candidate (precondition: "task popover open").                                                                                                        
  - effect: null on every line — there's no record of what clicking each button did. Compare to a recorded trace (URL change? modal open? toast?). Without
  effect, the transpiler can't know which assertion to add after each action.                                                                                   
  - Many entries are duplicated across snapshots (same button observed on 5 pages = 5 rows). No deduping by fingerprint.                                        
                                                                                                                        
  Issue 6 — nav-graph.md is a hand-written ASCII tree, not data                                                                                                 
                                                                                                                                                                
  Compare nav-graph.md (40 lines of indented bullets) to what Phase 3 needs to generate journey specs: "to reach AI Models from logged-out, do: home → click    
  Sign up → fill form → submit → wait dashboard → click sidebar AI Models." The current nav-graph cannot be parsed for that. There's no machine-readable edge   
  list (from_url, action, to_url). The BFS strategy file (W-2.8) actually specifies a nav-graph.md table format — | From | Link/CTA | To | Auth Gate | — but the
   actual file produced is the freeform tree. The format spec was ignored.

  Issue 7 — Privacy / Terms / external links recorded as "not snapshotted"                                                                                      
  
  ui-inventory.md:20-21 lists /privacy-policy?tab=privacy and /privacy-policy?tab=terms with snapshot column literally "not snapshotted". These are linked from 
  /account — within the same domain — and would be one page.goto away. The agent enumerated them and chose not to capture. No decision-log entry justifying
  this. Same for the Chrome Web Store extension link and DMG download.                                                                                          
                  
  ---                                                                                                                                                           
  Now: is this enough information to write proper test scripts and scenarios?
                                                                                                                                                                
  Short answer: enough for shallow smoke tests, not enough for a real QA suite. Here's the gap by test layer:
                                                                                                                                                                
  What's there is enough for…
                                                                                                                                                                
  - Auth happy-path spec: F-001 manifest is complete enough — fill, submit, expect alert, switch mode, fill, submit, wait /dashboard. Phase 3 can transpile it. 
  - Onboarding completion spec: F-003 has the full step sequence (persona → tasks → continue → setup → skip).
  - Smoke tests that visit each panel and assert the heading: F-004 / F-005 / F-006 / F-007 trivially become "click sidebar X, expect heading X" tests.         
                                                                                                                                                                
  What's missing for real coverage…                                                                                                                             
                                                                                                                                                                
  ┌───────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────┬────────────────────────────────────┐    
  │                            Test layer                             │                 What you need                 │        What's in qa/ today         │ 
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤    
  │ Negative auth tests (wrong password, weak password, mismatched    │ Observed error messages, validation rules,    │ None — only the "user exists"      │ 
  │ confirm, invalid email, empty submit, "Forgot password" flow)     │ redirect behavior                             │ error was hit by accident          │ 
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤    
  │ BYOK happy path (fill key, save, verify list, delete, edit)       │ Provider list, model list, key format,        │ One snapshot of the panel, zero of │ 
  │                                                                   │ success/error states, list-item structure     │  the dialog                        │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤ 
  │ Assistant creation (the actual product)                           │ Dialog/form fields, validation, success       │ Zero — CTA never clicked           │    
  │                                                                   │ state, list update                            │                                    │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤ 
  │ Sign-out                                                          │ Dropdown items, click target, post-redirect   │ Zero — never opened                │    
  │                                                                   │ URL, session-cleared assertion                │                                    │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤ 
  │ Pricing flows (free signup CTA → account, paid plan → checkout,   │ Click chain, payment screen evidence          │ Zero — only the page heading was   │    
  │ top-up flow, monthly/annual toggle)                               │                                               │ read                               │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤ 
  │ Empty-state → first-content transitions (create first device,     │ What happens when state changes               │ Only empty states captured         │    
  │ first assistant)                                                  │                                               │                                    │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤ 
  │ Negative/edge scenarios per flow (network error, server error,    │ Recorded effect: error rows in uig.jsonl +    │ effect: null everywhere            │    
  │ offline, cancellation)                                            │ observed error UIs                            │                                    │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ A11y, keyboard, focus order                                       │ Tab-order recordings, ARIA tree state         │ The console_allowlist exists but   │    
  │                                                                   │                                               │ no a11y captures                   │    
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Selector stability (which selector survives a re-render)          │ Multiple snapshots of same control to diff    │ Each control snapshotted once      │    
  └───────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────┴────────────────────────────────────┘    
  
  What Phase 3 (test generation) will actually do given this input                                                                                              
  What's there is enough for…

  - Auth happy-path spec: F-001 manifest is complete enough — fill, submit, expect alert, switch mode, fill, submit, wait /dashboard. Phase 3 can transpile it.
  - Onboarding completion spec: F-003 has the full step sequence (persona → tasks → continue → setup → skip).
  - Smoke tests that visit each panel and assert the heading: F-004 / F-005 / F-006 / F-007 trivially become "click sidebar X, expect heading X" tests.

  What's missing for real coverage…

  ┌───────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────┬────────────────────────────────────┐
  │                            Test layer                             │                 What you need                 │        What's in qa/ today         │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Negative auth tests (wrong password, weak password, mismatched    │ Observed error messages, validation rules,    │ None — only the "user exists"      │
  │ confirm, invalid email, empty submit, "Forgot password" flow)     │ redirect behavior                             │ error was hit by accident          │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ BYOK happy path (fill key, save, verify list, delete, edit)       │ Provider list, model list, key format,        │ One snapshot of the panel, zero of │
  │                                                                   │ success/error states, list-item structure     │  the dialog                        │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Assistant creation (the actual product)                           │ Dialog/form fields, validation, success       │ Zero — CTA never clicked           │
  │                                                                   │ state, list update                            │                                    │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Sign-out                                                          │ Dropdown items, click target, post-redirect   │ Zero — never opened                │
  │                                                                   │ URL, session-cleared assertion                │                                    │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Pricing flows (free signup CTA → account, paid plan → checkout,   │ Click chain, payment screen evidence          │ Zero — only the page heading was   │
  │ top-up flow, monthly/annual toggle)                               │                                               │ read                               │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Empty-state → first-content transitions (create first device,     │ What happens when state changes               │ Only empty states captured         │
  │ first assistant)                                                  │                                               │                                    │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Negative/edge scenarios per flow (network error, server error,    │ Recorded effect: error rows in uig.jsonl +    │ effect: null everywhere            │
  │ offline, cancellation)                                            │ observed error UIs                            │                                    │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ A11y, keyboard, focus order                                       │ Tab-order recordings, ARIA tree state         │ The console_allowlist exists but   │
  │                                                                   │                                               │ no a11y captures                   │
  ├───────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────┼────────────────────────────────────┤
  │ Selector stability (which selector survives a re-render)          │ Multiple snapshots of same control to diff    │ Each control snapshotted once      │
  └───────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────┴────────────────────────────────────┘

  What Phase 3 (test generation) will actually do given this input

  Best case: 8 specs, ~6 of which are 5–10-line happy-path smokes ("goto → click → assert heading"), plus a fuller auth + onboarding pair. Add a roughly equal
  number of // TODO: markers where flow.md says "deferred to Phase 2." No negative-path tests, no BYOK end-to-end, no assistant-creation, no sign-out. Those
  Phase 2 deferrals become permanent gaps because nothing in the architecture sends the agent back into the browser between phases — decisions.md even ratifies
  this with "do not block Phase 2. Re-capture would not help."

  ---
  The deeper pattern

  There are three classes of issue here, and they're worth separating because the fixes are different:

  1. Exploration depth (issues 1, 2, 7). Agent satisfies itself with reading-by-snapshot rather than interacting. Your "frontier of every link AND every button"
   idea fixes this. Plus: a real status taxonomy — TRACED-COMPLETE vs TRACED-SURFACE vs DEFERRED — and a gate that blocks Phase 2 on >X% surface-only.
  2. Data fidelity (issues 3, 4, 5, 6). What gets recorded during exploration is incomplete in known ways: preconditions=[], effect=null, manifest selectors
  aren't real Playwright, nav-graph is freeform prose. Fixes: actually run wiggle-pass + write back; record post-action effect (URL/DOM/toast/error) into uig;
  standardise the manifest action grammar with a parser spec; emit nav-graph as a proper edge table.
  3. Phase boundary (issue 7 + the architectural Phase 2 deferral). The hard split between "browser open / browser closed" forces too many decisions to be made
  up-front. The deferrals you see in flow.md exist because Phase 1 ran out of patience or context, and there's no formal mechanism to come back. A staged Phase
  1 — broad pass → targeted return for deferred items — would close most of the gaps in F-005, F-007, F-008, F-004's CTA, F-006's search.

  If I had to pick one thing to fix first based on this run: the "deferred to Phase 2" pattern in flow.md. Five of eight flows defer something, those deferrals
  are listed as actionable in state.md ("Phase 2 priorities"), but the architecture has no return path. Either Phase 2 needs to re-open the browser, or Phase 1
  needs a "loose ends" pass before declaring TRACED. Without that, every run will look like this one — broad but thin.

  Want me to draft what a proper "loose-ends pass" or status taxonomy would look like, or pick a different angle (e.g., the manifest selector DSL, or the
  nav-graph data format)?