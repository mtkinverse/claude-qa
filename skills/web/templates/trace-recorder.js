// trace-recorder.js — flow-scoped action trace emission
// Why: Phase 3 is a transpiler from observed action traces to TS scenario code.
//      Every interaction during exploration appends one structured event to the
//      flow's trace.jsonl. The transpiler reads (uig.jsonl + trace.jsonl) and
//      produces F-NNN.scenarios.ts deterministically — no prose re-derivation.
// Strategy: helper called by bfs.js / targeted-trace.js / sitemap-spot-check.js.
// Fallback: if the file write fails, log to stderr and continue. Tracing is
//           best-effort — never blocks exploration.
//
// Event shape:
//   { t, action, uig_ref?, url?, target?, outcome, evidence?, assert? }
//
//   action ∈ { goto, click, fill, select, press, hover, wait, observe }
//   outcome from outcome-classifier.js: navigated | dom-updated | modal-opened
//                                         | error-surfaced | auth-success
//                                         | auth-rejected-server | form-reset-silent
//                                         | network-timeout | no-change

const fs = require('fs');
const path = require('path');

class TraceRecorder {
  /**
   * @param {string} flowId  — e.g. "F-001-marketing-landing"
   * @param {object} [opts]
   * @param {string} [opts.flowsDir]  — defaults to "qa/flows"
   */
  constructor(flowId, opts = {}) {
    this.flowId = flowId;
    this.flowsDir = opts.flowsDir || 'qa/flows';
    this.traceDir = path.join(this.flowsDir, flowId);
    this.tracePath = path.join(this.traceDir, 'trace.jsonl');
    this.t0 = Date.now();
    fs.mkdirSync(this.traceDir, { recursive: true });
  }

  _emit(row) {
    row.t = Date.now() - this.t0;
    try {
      fs.appendFileSync(this.tracePath, JSON.stringify(row) + '\n');
    } catch (e) {
      process.stderr.write(`[trace-recorder] write failed: ${e.message}\n`);
    }
  }

  /** Record a navigation goto. */
  goto(url, outcome = 'navigated') { this._emit({ action: 'goto', url, outcome }); }

  /**
   * Record an interaction. uig_ref is the canonical scope-prefixed identifier
   * from uig.jsonl: "<scope>>>${role}[${name}]" — e.g. "card[Pro]>>combobox#0".
   */
  interaction({ action, uig_ref, target, outcome, evidence }) {
    const row = { action, outcome };
    if (uig_ref) row.uig_ref = uig_ref;
    if (target) row.target = target;
    if (evidence !== undefined) row.evidence = evidence;
    this._emit(row);
  }

  /** Record an assertion that should be transpiled into expect() at this point in the flow. */
  assert(uig_ref_or_target, kind, value) {
    this._emit({ assert: uig_ref_or_target, kind, value });
  }

  /** Free-form observation that the transpiler can use as evidence. */
  observe(note, evidence) {
    this._emit({ action: 'observe', note, evidence });
  }
}

/**
 * Build a uig_ref string from a UIG row or its identifying fields.
 * Generic across platforms — pure string composition.
 */
function uigRef({ scope, role, name, index }) {
  const idx = index !== undefined ? `#${index}` : '';
  return `${scope || 'root'}>>${role}[${name}]${idx}`;
}

module.exports = { TraceRecorder, uigRef };
