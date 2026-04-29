---
name: web-strategy-sitemap-spot-check
description: Sample N representative URLs from /sitemap.xml or robots.txt for content-heavy / CMS / marketing apps. No full crawl.
type: strategy
platform: web
---

# Strategy — Sitemap + Spot-Check

> ⚠️ **THIS IS AN EXAMPLE AND PREFERRED SUGGESTION — NOT A MANDATE.**
> You may deviate based on the observed app character, but you MUST:
> 1. Log the deviation in `qa/decisions.md` with rationale.
> 2. Declare a fallback. If your chosen approach stalls, fall back and continue — never break the flow.

**Best for**: Content-heavy / CMS / marketing / docs / knowledge-base sites. The pages are largely templated — once you've seen the page-type once, full BFS is wasted bandwidth. Sample, don't enumerate.

**When fingerprint says**: Q1=MPA or static-shell, Q3=Content, Q4=often B2C marketing or Developer docs.

**Stall signals**: `/sitemap.xml` returns 404; sitemap returns <5 URLs; robots.txt has no `Sitemap:` directive; sampled URLs all return identical content fingerprints (templating broken).

**Declared fallback**: If no sitemap is discoverable, switch to **BFS with shallow depth** (`QA_MAX_DEPTH=2`) — `skills/web/strategies/bfs.md`. This still avoids full crawl but doesn't depend on sitemap presence. Log the switch in `qa/decisions.md`.

---

## Tracing Loop Contract

When tracing flows derived from sitemap entries, each flow is driven by its `qa/flows/F-NNN-*/manifest.jsonl` until every line reaches terminal `status`. See `skills/_shared/runtime.md` → **End-to-End Completion is Mandatory**.

```
while (line = first `pending` in manifest.jsonl):
  execute line.action on line.target     // goto allowed here: URLs come from sitemap.xml
  outcome = classify(page, before, buf)  // outcome-classifier.js
  append 1 line to qa/progress.jsonl      // ≤150 bytes
  update manifest.jsonl line.status = done | skipped(reason) | blocked(reason)
  if outcome in {error-surfaced, network-timeout}:
    askUser(...); resume loop after answer
after loop: mark flow TRACED in journey-inventory.md; auto-advance to next PENDING flow
```

---

## How It Works

### Loop Structure

```
1. Fetch /sitemap.xml (and recursively /sitemap_index.xml entries if present).
   If absent, try /robots.txt → look for Sitemap: directive.
   If still absent → declared fallback (BFS shallow).
2. Parse the XML, extract <loc> URLs.
3. Group URLs by path-prefix template (e.g. /blog/*, /docs/*, /pricing).
   Each group is one "page-type".
4. Sample N URLs per group:
   - 1 URL = the canonical/landing page (e.g. /blog vs /blog/some-post)
   - 2 URLs = randomly sampled instances (e.g. two /blog/* posts)
   - = 3 representative samples per group, capped by QA_MAX_PAGES.
5. For each sampled URL:
   a. page.goto, wait, verify, screenshot, READ
   b. Record in flow.md evidence row
   c. Compare fingerprint to others in the same group:
      - If all identical → group is verified templated, can stop sampling
      - If different → take one more sample to confirm variety
6. Write group manifest to qa/knowledgebase/sitemap-groups.md
```

### Code Skeleton

```javascript
const fs = require('fs');
const { chromium } = require('@playwright/test');
require('dotenv').config({ path: '.env.qa' });
const { capture } = require('../scripts/qa-screenshot');

// Why: this script is the runtime helper for sitemap-spot-check strategy.
// Strategy: sitemap-spot-check (skills/web/strategies/sitemap-spot-check.md)
// Fallback: if sitemap missing or empty, switch to BFS with QA_MAX_DEPTH=2.

const SAMPLES_PER_GROUP = parseInt(process.env.QA_SITEMAP_SAMPLES || '3');
const PAGE_WAIT_MS = parseInt(process.env.QA_PAGE_WAIT_MS || '2000');
const MAX_PAGES = parseInt(process.env.QA_MAX_PAGES || '50');

const browser = await chromium.launch({ headless: process.env.QA_HEADLESS !== 'false' });
const page = await browser.newPage();

// 1. Locate sitemap
const sitemapUrl = await locateSitemap(page);
if (!sitemapUrl) {
  appendDecision('No sitemap discoverable. Falling back to BFS with QA_MAX_DEPTH=2.');
  process.env.QA_MAX_DEPTH = '2';
  // Hand off to BFS — see skills/web/strategies/bfs.md
  return;
}

// 2. Fetch + parse
const urls = await fetchSitemapUrls(page, sitemapUrl);
if (urls.length < 5) {
  appendDecision(`Sitemap has only ${urls.length} URLs — too few for sampling. Falling back to BFS.`);
  return;
}

// 3. Group by path-prefix template
const groups = groupByTemplate(urls);

// 4. Sample
let pageCount = 0;
for (const [groupName, groupUrls] of Object.entries(groups)) {
  const samples = pickSamples(groupUrls, SAMPLES_PER_GROUP);
  const fingerprints = new Set();

  for (const url of samples) {
    if (pageCount >= MAX_PAGES) break;
    pageCount++;

    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(PAGE_WAIT_MS);

    // Verify (same as BFS verifyNavigation pattern)
    const fingerprint = await page.evaluate(() => {
      const h1 = (document.querySelector('h1') || {}).textContent || '';
      const title = document.title || '';
      return `${title.trim()}|||${h1.trim()}`.toLowerCase();
    });

    // Screenshot
    const slug = new URL(url).pathname.split('/').filter(Boolean).join('-') || 'home';
    const file = `sitemap-${groupName}-${String(pageCount).padStart(2, '0')}-${slug}.png`;
    await capture(page, {
      flow: 'sitemap-spot-check',
      step: pageCount,
      action: `Sample ${groupName} group: ${url}`,
      observed: '(pending visual READ)',
      page: slug,
      file,
    });

    fingerprints.add(fingerprint);
    // If first 2 samples have identical fingerprint → templated, skip remaining
    if (fingerprints.size === 1 && samples.indexOf(url) >= 1) {
      appendDecision(`Group ${groupName}: 2 samples identical → templated, stopping sampling.`);
      break;
    }
  }
}

await browser.close();

async function locateSitemap(page) {
  // Try /sitemap.xml first
  const direct = `${process.env.QA_APP_URL.replace(/\/$/, '')}/sitemap.xml`;
  const res = await page.goto(direct, { waitUntil: 'domcontentloaded' }).catch(() => null);
  if (res && res.ok()) return direct;
  // Fall back to robots.txt
  const robots = await page.goto(`${process.env.QA_APP_URL.replace(/\/$/, '')}/robots.txt`, {
    waitUntil: 'domcontentloaded',
  }).catch(() => null);
  if (robots && robots.ok()) {
    const text = await page.content();
    const m = text.match(/Sitemap:\s*(\S+)/i);
    if (m) return m[1];
  }
  return null;
}

async function fetchSitemapUrls(page, sitemapUrl) {
  await page.goto(sitemapUrl, { waitUntil: 'domcontentloaded' });
  const xml = await page.content();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  return [...new Set(urls)];
}

function groupByTemplate(urls) {
  const groups = {};
  for (const url of urls) {
    const path = new URL(url).pathname;
    // Group by first path segment, fall back to "root"
    const key = (path.split('/').filter(Boolean)[0]) || 'root';
    (groups[key] = groups[key] || []).push(url);
  }
  return groups;
}

function pickSamples(urls, n) {
  if (urls.length <= n) return urls;
  // Deterministic pick: first + random middle + last for repeatability
  return [urls[0], urls[Math.floor(urls.length / 2)], urls[urls.length - 1]];
}

function appendDecision(line) {
  const ts = new Date().toISOString();
  fs.appendFileSync('qa/decisions.md', `\n## ${ts} — sitemap-spot-check\n${line}\n`);
}
```

### Fallback Discipline

| Stall signal | Action |
|---|---|
| `/sitemap.xml` 404 + no robots.txt directive | Switch to BFS shallow (`QA_MAX_DEPTH=2`). Log + continue. |
| Sitemap has <5 URLs | Switch to BFS shallow. Log + continue. |
| All samples in a group return identical content | Stop sampling that group, mark as "templated" in `qa/knowledgebase/sitemap-groups.md`. Continue with other groups. |
| Sampled URL returns error page | Skip + record skip in `qa/decisions.md`. Continue with next sample. |

### Adapt to What You See

After READing the first sample of each group, if the page-type is more varied than templated (e.g. blog posts have very different layouts), increase `SAMPLES_PER_GROUP` for that group only and append a `qa/decisions.md` entry: `"Group <X>: increased samples from 3 to 5 because layouts varied between samples."`
