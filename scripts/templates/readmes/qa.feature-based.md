# qa/

Living QA workspace — feature-based, {{platform}} platform.

- `context/` — drop prior knowledge here (PRDs, Figma exports, specs) before discovery
- `features/<feature-name>/` — one directory per feature module (flow.md + scenarios.md)
- `journeys/J-NNN-<role>.spec.ts` — shippable Playwright suite (generated in Phase 3)
- `knowledgebase/` — auto-generated nav graph, personas, ARIA snapshots
- `state.md` — session checkpoint (the memory across context resets)
- `decisions.md` — append-only audit trail of strategy choices
- `platform-fingerprint.md` — write-once app classification

## Resume a session
Open a new conversation and say: `Read qa/state.md and continue QA for [AppName]`
