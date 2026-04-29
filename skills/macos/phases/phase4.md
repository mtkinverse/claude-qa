# macOS — Phase 4: Finalize + Report (Step 10)

Runtime rules — see `skills/_shared/runtime.md`.

---

## 10.1 Update `ui-inventory.md`

Append flow mapping:

```markdown
## Flow Mapping

| UI Element | Type | Flow | Test Cases |
|---|---|---|---|
| [Element] | [type] | F-NNN | TC-NNN, TC-NNN |
```

## 10.2 Update `.qa-config.json`

```bash
python3 - <<'PYEOF'
import json, datetime, os, glob

with open("qa/.qa-config.json") as f:
    config = json.load(f)

flows = [d for d in os.listdir("qa/flows") if d.startswith("F-")] if os.path.isdir("qa/flows") else []
tcs = glob.glob("qa/**/TC-*.md", recursive=True)
config["last_discovery"] = datetime.datetime.now().isoformat()
config["flows_count"] = len(flows)
config["test_cases_count"] = len(tcs)

with open("qa/.qa-config.json", "w") as f:
    json.dump(config, f, indent=2)
print(f"Updated: {len(flows)} flows, {len(tcs)} test cases")
PYEOF
```

## 10.3 Generate HTML Report

At runtime, write `qa/scripts/generate-report.py` (stdlib only — `os`, `re`, `glob`, `json`, `argparse`, `pathlib`):
- Reads `qa/runs/RUN-*.md`
- Parses run ID, date, app name, pass/fail counts, flow results, failures
- Outputs `qa/report.html` with stat cards + expandable run rows

```bash
python3 qa/scripts/generate-report.py --runs-dir qa/runs --output qa/report.html
```

## 10.4 Final Report

→ Heavy checkpoint to `qa/state.md`. Generate unified Allure report:

```bash
node scripts/allure/generate-report.js --open
```

Tell user:

> "✅ QA complete — [AppName] on macOS [version]. [N] flows, [N] scenarios, [N] TCs. Report opened."
