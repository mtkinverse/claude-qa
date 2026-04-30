#!/usr/bin/env node
/**
 * Standalone QA Report Generator
 *
 * ONE script, ONE self-contained HTML file. No external dependencies.
 * No Java, no allure-commandline, no server — works when opened via file://.
 *
 * Reads everything in the qa/ workspace and generates a report covering all work:
 *   Phase 1 (Discovery):  flow.md files + screenshots
 *   Phase 2 (Scenarios):  scenarios.md files
 *   Phase 3 (Test Cases): TC-NNN-*.md files
 *   Phase 4 (Execution):  Playwright test results (if run)
 *
 * Usage:
 *   node scripts/allure/generate-report.js               # generate report
 *   node scripts/allure/generate-report.js --open         # generate + open in browser
 *   node scripts/allure/generate-report.js --out report.html  # custom output path
 *
 * Node.js stdlib only — zero npm dependencies.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const QA_DIR = path.join(REPO_ROOT, 'qa');
const REPORTS_DIR = path.join(QA_DIR, 'reports');
const SCREENSHOTS_DIR = path.join(QA_DIR, 'knowledgebase', 'screenshots');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OPEN = args.includes('--open');
const phaseIdx = args.indexOf('--phase');
const PHASE = phaseIdx !== -1 ? args[phaseIdx + 1] : 'all';

function slugify(s) {
  return String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function sessionFilename(appName) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
  return `${slugify(appName)}-${ts}.html`;
}

// OUTPUT_PATH is resolved after config is read (needs app_name) unless --out is given
const EXPLICIT_OUT = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTableRow(line) {
  if (!line.trim().startsWith('|')) return null;
  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (cells.every(c => /^[-:]+$/.test(c))) return null;
  return cells;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Workspace readers (kept from original — proven correct)
// ---------------------------------------------------------------------------

function readConfig() {
  const p = path.join(QA_DIR, '.qa-config.json');
  if (!fs.existsSync(p)) {
    console.error('  WARNING: qa/.qa-config.json not found. Using defaults.');
    return { app_name: 'Unknown Product', platform: 'Unknown' };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findFlowDirs() {
  const results = [];
  for (const dir of ['flows', 'features']) {
    const full = path.join(QA_DIR, dir);
    if (!fs.existsSync(full)) continue;
    const entries = fs.readdirSync(full)
      .filter(d => {
        try { return fs.statSync(path.join(full, d)).isDirectory(); } catch { return false; }
      })
      .sort()
      .map(d => ({ name: d, dir: path.join(full, d) }));
    results.push(...entries);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Screenshot coverage gate
// ---------------------------------------------------------------------------

function validateScreenshotCoverage() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return { pass: true, orphaned: [], missing: [], total: 0, covered: 0 };

  const onDisk = new Set(fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png')));
  const referenced = new Set();

  for (const dirName of ['flows', 'features']) {
    const base = path.join(QA_DIR, dirName);
    if (!fs.existsSync(base)) continue;
    for (const sub of fs.readdirSync(base)) {
      for (const docName of ['flow.md', 'overview.md']) {
        const docPath = path.join(base, sub, docName);
        if (!fs.existsSync(docPath)) continue;
        const content = fs.readFileSync(docPath, 'utf8');
        let m;
        const re = /[a-zA-Z0-9_-]+\.png/g;
        while ((m = re.exec(content)) !== null) referenced.add(m[0]);
      }
    }
  }

  const orphaned = [...onDisk].filter(f => !referenced.has(f)).sort();
  const missing = [...referenced].filter(f => !onDisk.has(f)).sort();
  return { pass: orphaned.length === 0, orphaned, missing, total: onDisk.size, covered: onDisk.size - orphaned.length };
}

// ---------------------------------------------------------------------------
// Phase 1: Parse flow.md
// ---------------------------------------------------------------------------

function parseFlowMd(flowEntry) {
  let flowMdPath = path.join(flowEntry.dir, 'flow.md');
  if (!fs.existsSync(flowMdPath)) flowMdPath = path.join(flowEntry.dir, 'overview.md');
  if (!fs.existsSync(flowMdPath)) return null;

  const content = fs.readFileSync(flowMdPath, 'utf8');

  const metadata = {};
  const summaryMatch = content.match(/## Summary[\s\S]*?(?=\n---|\n## )/);
  if (summaryMatch) {
    for (const line of summaryMatch[0].split('\n')) {
      const cells = parseTableRow(line);
      if (cells && cells.length >= 2) {
        metadata[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
      }
    }
  }

  const steps = [];
  const evidenceMatch = content.match(/## Discovery Evidence[\s\S]*?(?=\n---|\n## [^#]|$)/);
  if (evidenceMatch) {
    const lines = evidenceMatch[0].split('\n');
    let headerFound = false;
    let colLayout = null;
    for (const line of lines) {
      const cells = parseTableRow(line);
      if (!cells || cells.length < 4) continue;
      if (!headerFound && /step/i.test(cells[0])) {
        headerFound = true;
        colLayout = cells.length >= 5 && /page|screen/i.test(cells[1]) ? '5col' : '4col';
        continue;
      }
      if (!headerFound) continue;

      if (colLayout === '5col' && cells.length >= 5) {
        steps.push({ number: parseInt(cells[0]) || steps.length + 1, page: cells[1], action: cells[2], screenshot: cells[3].replace(/`/g, '').trim(), observed: cells[4] });
      } else if (cells.length >= 4) {
        steps.push({ number: parseInt(cells[0]) || steps.length + 1, action: cells[1], screenshot: cells[2].replace(/`/g, '').trim(), observed: cells[3] });
      }
    }
  }

  return { entry: flowEntry, metadata, steps };
}

// ---------------------------------------------------------------------------
// Phase 2: Parse scenarios.md
// ---------------------------------------------------------------------------

function parseScenariosmd(flowDir) {
  const p = path.join(flowDir, 'scenarios.md');
  if (!fs.existsSync(p)) return null;
  const content = fs.readFileSync(p, 'utf8');

  const scenarios = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^## S-[\d-]+:\s*(.+)/);
    if (match) {
      const meta = {};
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const cells = parseTableRow(lines[j]);
        if (cells && cells.length >= 2) {
          meta[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
        }
      }
      scenarios.push({ name: match[1].trim(), ...meta });
    }
  }

  return { scenarios };
}

// ---------------------------------------------------------------------------
// Phase 3: Parse TC files
// ---------------------------------------------------------------------------

function findTcFiles(flowDir) {
  const tcDir = path.join(flowDir, 'test-cases');
  if (!fs.existsSync(tcDir)) return [];
  return fs.readdirSync(tcDir)
    .filter(f => f.startsWith('TC-') && f.endsWith('.md'))
    .sort()
    .map(f => path.join(tcDir, f));
}

function parseTcMd(tcPath) {
  const content = fs.readFileSync(tcPath, 'utf8');
  const filename = path.basename(tcPath, '.md');

  const metadata = {};
  const metaSection = content.match(/\| Field[\s\S]*?(?=\n## |\n---)/i) || content.match(/## Metadata[\s\S]*?(?=\n---|\n## )/);
  if (metaSection) {
    for (const line of metaSection[0].split('\n')) {
      const cells = parseTableRow(line);
      if (cells && cells.length >= 2) {
        metadata[cells[0].replace(/\*\*/g, '').trim().toLowerCase()] = cells[1].replace(/\*\*/g, '').trim();
      }
    }
  }

  const specPath = tcPath.replace(/\.md$/, '.spec.ts');
  const hasSpec = fs.existsSync(specPath);
  const hasCode = /```typescript/.test(content);

  return { filename, path: tcPath, metadata, hasSpec, hasCode };
}

// ---------------------------------------------------------------------------
// Screenshot embedding — base64 inline for self-contained HTML
// ---------------------------------------------------------------------------

function screenshotToBase64(filename) {
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  const data = fs.readFileSync(filepath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

// ---------------------------------------------------------------------------
// Phase Evaluation Panel
// ---------------------------------------------------------------------------

function buildPhaseEvaluation(phase) {
  const phaseLabel = phase === 'all' ? 'Session' : `Phase ${phase}`;

  // Gather done counts
  let snapCount = 0, uigRows = 0, tracedComplete = 0, tracedSurface = 0, deferred = 0;
  let exploredRatio = null;

  try {
    const snapDir = 'qa/knowledgebase/aria-snapshots';
    if (fs.existsSync(snapDir)) snapCount = fs.readdirSync(snapDir).filter(f => f.endsWith('.json')).length;
  } catch {}

  try {
    const uigPath = 'qa/knowledgebase/uig.jsonl';
    if (fs.existsSync(uigPath)) uigRows = fs.readFileSync(uigPath, 'utf8').split('\n').filter(Boolean).length;
  } catch {}

  const DEFERRAL = /deferred|surface only|not yet|not opened|not clicked|not expanded/i;
  try {
    const flowsDir = 'qa/flows';
    if (fs.existsSync(flowsDir)) {
      fs.readdirSync(flowsDir).forEach(d => {
        const fmd = path.join(flowsDir, d, 'flow.md');
        if (!fs.existsSync(fmd)) { deferred++; return; }
        const txt = fs.readFileSync(fmd, 'utf8');
        if (DEFERRAL.test(txt)) tracedSurface++;
        else tracedComplete++;
      });
    }
  } catch {}

  try {
    const isPath = 'qa/knowledgebase/interactions-state.json';
    if (fs.existsSync(isPath)) {
      const st = JSON.parse(fs.readFileSync(isPath, 'utf8'));
      const exp = Object.keys(st.explored || {}).length;
      const q   = (st.queue || []).length;
      exploredRatio = exp + q > 0 ? `${exp}/${exp+q} (${Math.round(100*exp/(exp+q))}%)` : 'N/A';
    }
  } catch {}

  // Run gates
  const gates = [
    { name: 'audit-snapshots', script: 'scripts/audit-snapshots.js' },
    { name: 'coverage-check',  script: 'scripts/coverage-check.js'  },
    { name: 'crawl-gate',      script: 'scripts/crawl-gate.js'       },
    { name: 'derive-quirks',   script: 'scripts/derive-quirks.js'    },
  ];
  const gateResults = gates.map(g => {
    try {
      execSync(`node ${g.script}`, { stdio: 'pipe', timeout: 30000 });
      return { name: g.name, pass: true, msg: '' };
    } catch (e) {
      const msg = (e.stderr || e.stdout || '').toString().split('\n')[0].slice(0, 200);
      return { name: g.name, pass: false, msg };
    }
  });

  // Check for surface-only flows
  const deferredFlows = [];
  try {
    const flowsDir = 'qa/flows';
    if (fs.existsSync(flowsDir)) {
      fs.readdirSync(flowsDir).forEach(d => {
        const fmd = path.join(flowsDir, d, 'flow.md');
        if (fs.existsSync(fmd) && DEFERRAL.test(fs.readFileSync(fmd, 'utf8'))) {
          deferredFlows.push(d);
        }
      });
    }
  } catch {}

  // Handoff banner
  let handoffHtml = '';
  try {
    const hf = 'qa/handoff.json';
    if (fs.existsSync(hf)) {
      const h = JSON.parse(fs.readFileSync(hf, 'utf8'));
      const parallel = (h.parallel_flows_running || []).length;
      handoffHtml = `<div style="background:#fffbe6;border:1px solid #faad14;padding:12px;border-radius:4px;margin:8px 0">
        &#x23F3; <strong>Resume after ${escHtml(h.est_resume_at_iso || 'unknown time')}</strong> — Flow <code>${escHtml(String(h.flow_id || ''))}</code> blocked on <em>${escHtml(String(h.blocker || ''))}</em>.
        ${parallel > 0 ? `${parallel} other flow(s) ran in parallel.` : ''}
      </div>`;
    }
  } catch {}

  // Next action from state.md
  let nextHtml = '<em>No qa/state.md found</em>';
  try {
    const statePath = 'qa/state.md';
    if (fs.existsSync(statePath)) {
      const txt = fs.readFileSync(statePath, 'utf8');
      const ap  = txt.match(/##\s*Active Position[\s\S]*?(?=##|$)/i);
      if (ap) nextHtml = `<pre style="white-space:pre-wrap;font-size:12px">${ap[0].replace(/</g,'&lt;')}</pre>`;
      else nextHtml = `<pre style="white-space:pre-wrap;font-size:12px">${txt.slice(0, 500).replace(/</g,'&lt;')}...</pre>`;
    }
  } catch {}

  const failGates = gateResults.filter(g => !g.pass);
  const passGates = gateResults.filter(g => g.pass);

  return `
  <div style="margin:16px 0;font-family:sans-serif">
    <h2 style="border-bottom:2px solid #1890ff;padding-bottom:8px">${escHtml(phaseLabel)} Evaluation</h2>
    ${handoffHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div style="background:#f6ffed;border:1px solid #b7eb8f;padding:12px;border-radius:4px">
        <h3 style="color:#389e0d;margin-top:0">&#x2705; Done</h3>
        <ul style="margin:0;padding-left:20px">
          <li>Snapshots: <strong>${snapCount}</strong></li>
          <li>UIG rows: <strong>${uigRows}</strong></li>
          <li>TRACED-COMPLETE: <strong>${tracedComplete}</strong></li>
          <li>TRACED-SURFACE: <strong>${tracedSurface}</strong></li>
          <li>DEFERRED: <strong>${deferred}</strong></li>
          ${exploredRatio ? `<li>Interactions explored: <strong>${exploredRatio}</strong></li>` : ''}
          ${passGates.map(g => `<li>Gate ${escHtml(g.name)}: <strong>PASS</strong></li>`).join('')}
        </ul>
      </div>
      <div style="background:${failGates.length > 0 ? '#fff1f0' : '#f5f5f5'};border:1px solid ${failGates.length > 0 ? '#ffa39e' : '#d9d9d9'};padding:12px;border-radius:4px">
        <h3 style="color:${failGates.length > 0 ? '#cf1322' : '#595959'};margin-top:0">${failGates.length > 0 ? '&#x274C; Failing / Missing' : '&#x2705; No failures'}</h3>
        ${failGates.map(g => `<div style="background:#fff2f0;border-left:3px solid #ff4d4f;padding:8px;margin:4px 0">
          <strong>${escHtml(g.name)}</strong><br><code style="font-size:11px">${g.msg.replace(/</g,'&lt;')}</code>
        </div>`).join('')}
        ${deferredFlows.length > 0 ? `<div><strong>Surface-only flows:</strong><ul>${deferredFlows.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul></div>` : ''}
        ${failGates.length === 0 && deferredFlows.length === 0 ? '<p>All gates pass. No surface-only flows.</p>' : ''}
      </div>
      <div style="background:#e6f7ff;border:1px solid #91d5ff;padding:12px;border-radius:4px">
        <h3 style="color:#096dd9;margin-top:0">&#x27A1;&#xFE0F; Next</h3>
        ${nextHtml}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// HTML Report Builder
// ---------------------------------------------------------------------------

function buildHtml(config, flowEntries, counts, coverage, phase) {
  const appName = escHtml(config.app_name || 'Unknown Product');
  const platform = escHtml(config.platform || 'Unknown');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Build flow cards
  let flowCards = '';
  let scenarioCards = '';
  let tcCards = '';

  for (const entry of flowEntries) {
    const flow = parseFlowMd(entry);
    if (!flow) continue;

    const flowName = escHtml(entry.name);
    const priority = escHtml(flow.metadata.priority || 'P2');
    const auth = /yes/i.test(flow.metadata['auth required'] || '') ? 'Auth' : 'Public';
    const stepCount = flow.steps.length;

    // Flow steps with inline screenshots
    let stepsHtml = '';
    for (const step of flow.steps) {
      const b64 = screenshotToBase64(step.screenshot);
      const imgHtml = b64
        ? `<img src="${b64}" alt="${escHtml(step.screenshot)}" class="screenshot" loading="lazy" onclick="this.classList.toggle('expanded')">`
        : `<span class="missing-img">${escHtml(step.screenshot)} (not found)</span>`;

      stepsHtml += `
        <div class="step">
          <div class="step-num">${step.number}</div>
          <div class="step-body">
            <div class="step-action">${escHtml(step.action)}</div>
            <div class="step-observed">${escHtml(step.observed || '')}</div>
            ${imgHtml}
          </div>
        </div>`;
    }

    flowCards += `
      <div class="card flow-card" data-phase="1">
        <div class="card-header" onclick="this.parentElement.classList.toggle('open')">
          <span class="badge ${priority.toLowerCase()}">${priority}</span>
          <span class="badge ${auth.toLowerCase()}">${auth}</span>
          <strong>${flowName}</strong>
          <span class="count">${stepCount} steps</span>
          <span class="chevron">&#9660;</span>
        </div>
        <div class="card-body">${stepsHtml}</div>
      </div>`;

    // Scenarios for this flow
    const scenarioData = parseScenariosmd(entry.dir);
    if (scenarioData && scenarioData.scenarios.length > 0) {
      let scenarioList = '';
      for (const s of scenarioData.scenarios) {
        const sPri = escHtml(s.priority || 'P2');
        const sCat = escHtml(s.category || 'Functional');
        scenarioList += `<div class="scenario-row"><span class="badge ${sPri.toLowerCase()}">${sPri}</span> <span class="badge cat">${sCat}</span> ${escHtml(s.name)}</div>`;
      }
      scenarioCards += `
        <div class="card scenario-card" data-phase="2">
          <div class="card-header" onclick="this.parentElement.classList.toggle('open')">
            <strong>${flowName}</strong>
            <span class="count">${scenarioData.scenarios.length} scenarios</span>
            <span class="chevron">&#9660;</span>
          </div>
          <div class="card-body">${scenarioList}</div>
        </div>`;
    }

    // TCs for this flow
    const tcFiles = findTcFiles(entry.dir);
    if (tcFiles.length > 0) {
      let tcList = '';
      for (const tcPath of tcFiles) {
        const tc = parseTcMd(tcPath);
        const tcId = escHtml(tc.metadata['tc id'] || tc.filename);
        const tcPri = escHtml(tc.metadata.priority || 'P2');
        const specIcon = tc.hasSpec ? '&#9989;' : tc.hasCode ? '&#128221;' : '&#10060;';
        tcList += `<div class="tc-row"><span class="badge ${tcPri.toLowerCase()}">${tcPri}</span> ${specIcon} ${tcId}</div>`;
      }
      tcCards += `
        <div class="card tc-card" data-phase="3">
          <div class="card-header" onclick="this.parentElement.classList.toggle('open')">
            <strong>${flowName}</strong>
            <span class="count">${tcFiles.length} TCs</span>
            <span class="chevron">&#9660;</span>
          </div>
          <div class="card-body">${tcList}</div>
        </div>`;
    }
  }

  // Coverage status
  const covHtml = coverage.total > 0
    ? `<span class="${coverage.pass ? 'pass' : 'fail'}">${coverage.covered}/${coverage.total} screenshots covered${coverage.orphaned.length > 0 ? ' (' + coverage.orphaned.length + ' orphaned)' : ''}</span>`
    : '<span class="na">No screenshots yet</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA Report — ${appName}</title>
<style>
  :root { --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #e6edf3; --dim: #8b949e; --accent: #58a6ff; --green: #3fb950; --red: #f85149; --orange: #d29922; --purple: #bc8cff; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .subtitle { color: var(--dim); margin-bottom: 24px; font-size: 14px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .stat-label { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 28px; font-weight: 600; margin-top: 4px; }
  .stat-value.green { color: var(--green); }
  .stat-value.orange { color: var(--orange); }
  .stat-value.dim { color: var(--dim); }
  .phase-title { font-size: 18px; margin: 28px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
  .card-header { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; user-select: none; }
  .card-header:hover { background: #1c2128; }
  .card-body { display: none; padding: 16px; border-top: 1px solid var(--border); }
  .card.open .card-body { display: block; }
  .card.open .chevron { transform: rotate(180deg); }
  .chevron { margin-left: auto; font-size: 10px; color: var(--dim); transition: transform 0.2s; }
  .count { color: var(--dim); font-size: 13px; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 600; }
  .badge.p1 { background: #f8514922; color: var(--red); }
  .badge.p2 { background: #d2992222; color: var(--orange); }
  .badge.p3 { background: #8b949e22; color: var(--dim); }
  .badge.auth { background: #bc8cff22; color: var(--purple); }
  .badge.public { background: #3fb95022; color: var(--green); }
  .badge.cat { background: #58a6ff22; color: var(--accent); }
  .step { display: flex; gap: 12px; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .step:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .step-num { background: var(--accent); color: var(--bg); width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
  .step-body { flex: 1; min-width: 0; }
  .step-action { font-weight: 600; margin-bottom: 4px; }
  .step-observed { color: var(--dim); font-size: 13px; margin-bottom: 8px; }
  .screenshot { max-width: 100%; max-height: 300px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; transition: max-height 0.3s; }
  .screenshot.expanded { max-height: none; }
  .missing-img { color: var(--red); font-size: 12px; font-style: italic; }
  .scenario-row, .tc-row { padding: 6px 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .scenario-row:last-child, .tc-row:last-child { border-bottom: none; }
  .pass { color: var(--green); }
  .fail { color: var(--red); }
  .na { color: var(--dim); }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--dim); font-size: 12px; }
  .empty { color: var(--dim); font-style: italic; padding: 16px 0; }
</style>
</head>
<body>

<h1>QA Report — ${appName}</h1>
<div class="subtitle">${platform} &middot; Generated ${now} &middot; ${os.hostname()}</div>

${buildPhaseEvaluation(phase)}

<div class="stats">
  <div class="stat">
    <div class="stat-label">Flows</div>
    <div class="stat-value ${counts.flows > 0 ? 'green' : 'dim'}">${counts.flows}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Discovery Steps</div>
    <div class="stat-value ${counts.steps > 0 ? 'green' : 'dim'}">${counts.steps}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Screenshots</div>
    <div class="stat-value ${counts.screenshots > 0 ? 'green' : 'dim'}">${counts.screenshots}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Scenarios</div>
    <div class="stat-value ${counts.scenarios > 0 ? 'green' : 'orange'}">${counts.scenarios}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Test Cases</div>
    <div class="stat-value ${counts.tcs > 0 ? 'green' : 'orange'}">${counts.tcs}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Screenshot Coverage</div>
    <div class="stat-value" style="font-size:16px">${covHtml}</div>
  </div>
</div>

<div class="phase-title">Phase 1 — Discovery</div>
${flowCards || '<div class="empty">No flows discovered yet.</div>'}

<div class="phase-title">Phase 2 — Scenarios</div>
${scenarioCards || '<div class="empty">No scenarios generated yet.</div>'}

<div class="phase-title">Phase 3 — Test Cases</div>
${tcCards || '<div class="empty">No test cases written yet.</div>'}

<div class="phase-title">Phase 4 — Execution</div>
${counts.specs > 0
    ? `<div class="card"><div class="card-header"><strong>${counts.specs} .spec.ts files ready</strong><span class="count">Run: npx playwright test --config qa/playwright.config.ts</span></div></div>`
    : '<div class="empty">No specs extracted yet.</div>'}

<div class="footer">
  Generated by native-qa report generator &middot; Node.js ${process.version} &middot; ${os.platform()} ${os.release()}
</div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('');
  console.log('  ========================================');
  console.log('  QA Report Generator — Standalone HTML');
  console.log('  ========================================');
  console.log('');

  // Screenshot coverage gate
  const coverage = validateScreenshotCoverage();
  if (!coverage.pass) {
    console.log('  WARNING: Screenshot coverage incomplete');
    console.log(`  On disk: ${coverage.total} | Referenced: ${coverage.covered} | Orphaned: ${coverage.orphaned.length}`);
    for (const f of coverage.orphaned) console.log(`    - ${f}`);
    console.log('');
    console.log('  Fix: node scripts/qa-screenshot.js --flow F-NNN --step N --action "..." --file <name>.png');
    console.log('  Continuing with partial coverage...');
    console.log('');
  } else if (coverage.total > 0) {
    console.log(`  Screenshots: ${coverage.covered}/${coverage.total} covered`);
  }

  const config = readConfig();
  const appName = config.app_name || 'Unknown Product';
  console.log(`  Product:  ${appName}`);
  console.log(`  Platform: ${config.platform || 'Unknown'}`);
  console.log(`  Phase:    ${PHASE}`);

  const flowEntries = findFlowDirs();
  if (flowEntries.length === 0) {
    console.log('  No flow directories found in qa/flows/ or qa/features/.');
    console.log('  Generating report with phase evaluation only.');
  }

  // Collect counts
  const counts = { flows: 0, steps: 0, screenshots: 0, scenarios: 0, tcs: 0, specs: 0 };

  console.log('');
  console.log('  Phase 1 — Discovery');
  for (const entry of flowEntries) {
    const flow = parseFlowMd(entry);
    if (!flow) { console.log(`    [--] ${entry.name}: no flow.md`); continue; }
    counts.flows++;
    counts.steps += flow.steps.length;
    // Count screenshots that actually exist on disk
    for (const step of flow.steps) {
      if (fs.existsSync(path.join(SCREENSHOTS_DIR, step.screenshot))) counts.screenshots++;
    }
    console.log(`    [OK] ${entry.name}: ${flow.steps.length} steps`);
  }

  console.log('  Phase 2 — Scenarios');
  let hasScenarios = false;
  for (const entry of flowEntries) {
    const sd = parseScenariosmd(entry.dir);
    if (!sd || sd.scenarios.length === 0) continue;
    hasScenarios = true;
    counts.scenarios += sd.scenarios.length;
    console.log(`    [OK] ${entry.name}: ${sd.scenarios.length} scenarios`);
  }
  if (!hasScenarios) console.log('    [..] No scenarios yet');

  console.log('  Phase 3 — Test Cases');
  let hasTcs = false;
  for (const entry of flowEntries) {
    const tcFiles = findTcFiles(entry.dir);
    if (tcFiles.length === 0) continue;
    hasTcs = true;
    for (const tcPath of tcFiles) {
      counts.tcs++;
      const tc = parseTcMd(tcPath);
      if (tc.hasSpec) counts.specs++;
    }
    console.log(`    [OK] ${entry.name}: ${tcFiles.length} TCs`);
  }
  if (!hasTcs) console.log('    [..] No test cases yet');

  console.log(`  Phase 4 — ${counts.specs > 0 ? counts.specs + ' specs ready' : 'No specs yet'}`);

  // Resolve output path (session-based by default)
  const OUTPUT_PATH = EXPLICIT_OUT || path.join(REPORTS_DIR, sessionFilename(appName));
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  // Generate HTML
  const html = buildHtml(config, flowEntries, counts, coverage, PHASE);
  fs.writeFileSync(OUTPUT_PATH, html);

  console.log('');
  console.log('  ========================================');
  console.log(`  Flows:       ${counts.flows}`);
  console.log(`  Steps:       ${counts.steps}`);
  console.log(`  Screenshots: ${counts.screenshots}`);
  console.log(`  Scenarios:   ${counts.scenarios}`);
  console.log(`  Test Cases:  ${counts.tcs}`);
  console.log(`  Specs:       ${counts.specs}`);
  console.log(`  Report:      ${OUTPUT_PATH}`);
  console.log('  ========================================');
  console.log('');

  if (OPEN) {
    try {
      const opener = process.platform === 'win32' ? 'start ""' :
                     process.platform === 'darwin' ? 'open' : 'xdg-open';
      execSync(`${opener} "${OUTPUT_PATH}"`, { stdio: 'ignore' });
      console.log('  Opened in browser.');
    } catch {
      console.log(`  Could not auto-open. Open manually: ${OUTPUT_PATH}`);
    }
  } else {
    console.log(`  Open: ${OUTPUT_PATH}`);
  }
  console.log('');
}

main();
