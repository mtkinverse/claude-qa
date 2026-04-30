#!/bin/bash
# P1→P2 gate runner — invoked at end of Phase 1 (phase1.md)
# All four scripts must exit 0 before Phase 2 starts.
# The eval report always opens — even on failure (using ; not &&).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== P1→P2 Gate: audit-snapshots ==="
node scripts/audit-snapshots.js

echo "=== P1→P2 Gate: coverage-check ==="
node scripts/coverage-check.js

echo "=== P1→P2 Gate: crawl-gate ==="
node scripts/crawl-gate.js

echo "=== P1→P2 Gate: derive-quirks ==="
node scripts/derive-quirks.js

echo "=== All P1→P2 gates passed ==="
