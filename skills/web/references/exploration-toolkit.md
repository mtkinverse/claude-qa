# Playwright Exploration Toolkit — Frontend Context Discovery

> ⛔ **SCREENSHOTS ARE FORBIDDEN ON WEB (Phase 1 & Phase 2)**
> Never call `page.screenshot()`, `locator.screenshot()`, or any screenshot API during discovery or scenario tracing.
> Use `snapshotPage()` (DOM/ARIA JSON) exclusively for all observation. Screenshots in this file are reference patterns only — they apply to macOS/native or Phase 4 test failure capture, NOT to web exploration.
> The screenshot sections below exist as API reference; invoking them during web Phase 1/2 violates the no-screenshot rule.

Every Playwright API useful during **Phase 1 exploration**. Goal: build a complete picture
of the app's UI, DOM structure, network behaviour, and state before writing a single test case.

Read this file before starting any web exploration session.

---

## 1. Page Snapshot — Full HTML & Accessibility Tree

The two most powerful "understand what's on screen" tools.

### Full HTML Dump

```typescript
// Get the entire rendered DOM as a string
const html = await page.content();
// Write to file for offline analysis
import * as fs from 'fs';
fs.writeFileSync('qa/knowledgebase/page-snapshot.html', html);
```

### Accessibility Tree Snapshot

Reveals the semantic structure — headings, buttons, links, forms — exactly as a screen reader sees it.
Much more useful than raw HTML for understanding UI intent.

```typescript
// Full accessibility tree of the page
const snapshot = await page.accessibility.snapshot();
console.log(JSON.stringify(snapshot, null, 2));
// Output: { role: 'WebArea', name: 'Dashboard', children: [ ... ] }

// Focused subtree — just the nav
const navSnapshot = await page.accessibility.snapshot({
  root: await page.locator('nav').elementHandle()
});
console.log(JSON.stringify(navSnapshot, null, 2));
```

### ARIA Snapshot (Playwright 1.44+)

Returns a human-readable ARIA representation — best for understanding component structure.

```typescript
// Snapshot of an element's accessible subtree
const ariaTree = await page.locator('main').ariaSnapshot();
console.log(ariaTree);
// Output:
// - heading "Dashboard" [level=1]
// - navigation "Main":
//   - link "Overview"
//   - link "Settings"
// - region "Content":
//   - button "New Project"
```

---

## 2. DOM Interrogation — Find and Inspect Every Element

### Enumerate All Interactive Elements

```typescript
// All buttons on the page
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]')]
    .map(el => ({
      text: el.textContent?.trim(),
      type: el.getAttribute('type'),
      disabled: (el as HTMLButtonElement).disabled,
      testId: el.getAttribute('data-testid'),
      ariaLabel: el.getAttribute('aria-label'),
      visible: (el as HTMLElement).offsetParent !== null
    }))
);

// All links
const links = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')]
    .map(a => ({
      text: (a as HTMLAnchorElement).textContent?.trim(),
      href: (a as HTMLAnchorElement).href,
      location: a.closest('nav') ? 'nav' : a.closest('footer') ? 'footer' : a.closest('header') ? 'header' : 'body'
    }))
    .filter(l => l.text)
);

// All form fields
const fields = await page.evaluate(() =>
  [...document.querySelectorAll('input, textarea, select')]
    .map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.getAttribute('id'),
      placeholder: el.getAttribute('placeholder'),
      label: el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : null,
      required: (el as HTMLInputElement).required,
      value: (el as HTMLInputElement).value
    }))
);

// All headings — reveals page structure at a glance
const headings = await page.evaluate(() =>
  [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .map(h => ({ level: h.tagName, text: h.textContent?.trim() }))
);

// All navigation items
const navItems = await page.evaluate(() =>
  [...document.querySelectorAll('nav a, nav button, [role="menuitem"], [role="tab"]')]
    .map(el => ({
      text: el.textContent?.trim(),
      href: (el as HTMLAnchorElement).href || null,
      role: el.getAttribute('role'),
      active: el.classList.contains('active') || el.getAttribute('aria-current') === 'page'
    }))
);
```

### Inspect a Specific Element

```typescript
// All attributes of an element
const attrs = await page.locator('[data-testid="user-menu"]').evaluate(el => {
  const result: Record<string, string> = {};
  for (const attr of el.attributes) result[attr.name] = attr.value;
  return result;
});

// Computed styles
const styles = await page.locator('.hero-button').evaluate(el =>
  window.getComputedStyle(el).cssText
);

// Bounding box — position and size on screen
const box = await page.locator('.modal').boundingBox();
// { x: 200, y: 100, width: 600, height: 400 }

// Whether element is in viewport
const inViewport = await page.locator('.cta-button').isIntersectingViewport();

// Element count
const cardCount = await page.locator('[data-testid="project-card"]').count();

// All text content of matching elements
const allLabels = await page.locator('.nav-label').allTextContents();
// ['Overview', 'Projects', 'Settings', 'Help']
```

### Page-Level Info

```typescript
// Current URL, title, viewport
console.log('URL:', page.url());
console.log('Title:', await page.title());
console.log('Viewport:', page.viewportSize());

// Scroll dimensions — is the page scrollable? how tall?
const dimensions = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  clientHeight: document.documentElement.clientHeight,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));

// Meta tags — description, og:title, canonical URL
const meta = await page.evaluate(() =>
  [...document.querySelectorAll('meta')].map(m => ({
    name: m.getAttribute('name') || m.getAttribute('property'),
    content: m.getAttribute('content')
  })).filter(m => m.name && m.content)
);
```

---

## 3. Screenshots — Every Variant

### Full-Page Screenshot

```typescript
// Entire scrollable page — most useful for exploration
await page.screenshot({
  path: 'qa/knowledgebase/screenshots/01-homepage.png',
  fullPage: true
});
```

### Viewport-Only Screenshot

```typescript
// Only what's visible without scrolling
await page.screenshot({
  path: 'qa/knowledgebase/screenshots/01-homepage-viewport.png',
  fullPage: false
});
```

### Element Screenshot

```typescript
// Crop exactly to a specific element — useful for components
await page.locator('.dashboard-chart').screenshot({
  path: 'qa/knowledgebase/screenshots/component-chart.png'
});

// Modal content only
await page.locator('[role="dialog"]').screenshot({
  path: 'qa/knowledgebase/screenshots/modal-content.png'
});
```

### Clip to a Region

```typescript
// Screenshot a specific coordinate region
await page.screenshot({
  path: 'qa/knowledgebase/screenshots/nav-region.png',
  clip: { x: 0, y: 0, width: 1280, height: 80 }
});
```

### Scroll and Capture Each Section

```typescript
// Capture page in sections — useful for very long pages
const viewportHeight = page.viewportSize()!.height;
const totalHeight: number = await page.evaluate(() => document.documentElement.scrollHeight);
const sections = Math.ceil(totalHeight / viewportHeight);

for (let i = 0; i < sections; i++) {
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), i * viewportHeight);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `qa/knowledgebase/screenshots/page-section-${String(i + 1).padStart(2, '0')}.png`
  });
}

// Scroll back to top
await page.evaluate(() => window.scrollTo(0, 0));
```

### Screenshot After Every Navigation Step

```typescript
// Helper — screenshot at every step with auto-naming
let stepCount = 0;
async function step(description: string) {
  stepCount++;
  const slug = description.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  await page.screenshot({
    path: `qa/knowledgebase/screenshots/flow-F001-step${String(stepCount).padStart(2, '0')}-${slug}.png`,
    fullPage: true
  });
  console.log(`📸 Step ${stepCount}: ${description}`);
}

// Usage
await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await step('dashboard-loaded');

await page.locator('nav a:has-text("Settings")').click();
await page.waitForTimeout(1000);
await step('settings-page');
```

---

## 4. Trace — Full Session Recording

Playwright Trace captures screenshots, DOM snapshots, network, console, and every action.
Open with `npx playwright show-trace trace.zip` — gives a full timeline of the session.

### Record a Trace

```typescript
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext();

// Start tracing before any navigation
await context.tracing.start({
  screenshots: true,   // screenshot at every action
  snapshots: true,     // DOM snapshot at every action — enables time-travel
  sources: true        // include source files in trace
});

const page = await context.newPage();

// ... explore the app ...
await page.goto(process.env.QA_APP_URL!);
await page.locator('nav a:has-text("Pricing")').click();
await page.locator('button:has-text("Sign up")').click();

// Stop and save trace
await context.tracing.stop({ path: 'qa/knowledgebase/trace-exploration.zip' });

await browser.close();

// View: npx playwright show-trace qa/knowledgebase/trace-exploration.zip
```

### Trace Chunk — Save Mid-Session Without Stopping

```typescript
// Save a partial trace snapshot without stopping
await context.tracing.stopChunk({ path: 'qa/knowledgebase/trace-chunk-01.zip' });

// Continue tracing
await context.tracing.startChunk({ title: 'Phase 2 — Auth flows' });
// ... more navigation ...
await context.tracing.stopChunk({ path: 'qa/knowledgebase/trace-chunk-02.zip' });
```

---

## 5. Video Recording

Records the full browser session as a video file — useful for async review.

```typescript
const context = await browser.newContext({
  recordVideo: {
    dir: 'qa/knowledgebase/videos/',
    size: { width: 1280, height: 720 }
  }
});

const page = await context.newPage();
// ... explore ...

// Must close context to finalise video file
await context.close();
// Video saved to qa/knowledgebase/videos/[random].webm
```

---

## 6. Network Monitoring — Capture All API Calls

### Log Every Request and Response

```typescript
const networkLog: object[] = [];

page.on('request', request => {
  networkLog.push({
    type: 'request',
    method: request.method(),
    url: request.url(),
    headers: request.headers(),
    postData: request.postData()
  });
});

page.on('response', async response => {
  let body = null;
  try {
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('application/json')) body = await response.json().catch(() => null);
  } catch {}

  networkLog.push({
    type: 'response',
    status: response.status(),
    url: response.url(),
    headers: response.headers(),
    body
  });
});

// Navigate and interact
await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Save network log
fs.writeFileSync(
  'qa/knowledgebase/network-log.json',
  JSON.stringify(networkLog, null, 2)
);
```

### Capture Only API Calls

```typescript
const apiCalls: object[] = [];

page.on('response', async response => {
  const url = response.url();
  if (!url.includes('/api/') && !url.includes('/graphql')) return;

  let body = null;
  try { body = await response.json(); } catch {}

  apiCalls.push({
    method: response.request().method(),
    url,
    status: response.status(),
    body
  });
});
```

### Wait for a Specific API Response

```typescript
// Trigger an action and capture the resulting API call
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/api/user') && resp.status() === 200),
  page.locator('button:has-text("Save")').click()
]);

const data = await response.json();
console.log('API returned:', data);
```

### Discover All Routes the App Calls

```typescript
const routes = new Set<string>();

page.on('request', req => {
  const url = new URL(req.url());
  if (!req.url().includes(process.env.QA_APP_URL!)) return; // same-origin only
  routes.add(`${req.method()} ${url.pathname}`);
});

// Navigate through the whole app
await page.goto('/');
await page.goto('/pricing');
await page.goto('/account');
// ... etc

console.log('All routes called:\n', [...routes].sort().join('\n'));
```

---

## 7. Console & Error Monitoring

```typescript
const logs = { errors: [] as string[], warnings: [] as string[], info: [] as string[] };

page.on('console', msg => {
  const text = `[${msg.type()}] ${msg.text()}`;
  if (msg.type() === 'error') logs.errors.push(text);
  else if (msg.type() === 'warning') logs.warnings.push(text);
  else logs.info.push(text);
});

// Unhandled JS exceptions
page.on('pageerror', err => {
  logs.errors.push(`[pageerror] ${err.message}\n${err.stack}`);
});

// Failed requests (4xx, 5xx, network errors)
page.on('requestfailed', req => {
  logs.errors.push(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
});

// After exploring
console.log('Errors:', logs.errors);
console.log('Warnings:', logs.warnings);
```

---

## 8. Storage Inspection — Cookies, localStorage, sessionStorage

```typescript
// All cookies for the current page
const cookies = await page.context().cookies();
console.log('Cookies:', JSON.stringify(cookies, null, 2));

// localStorage — what the app is persisting
const localStorage = await page.evaluate(() => {
  const store: Record<string, string> = {};
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i)!;
    store[key] = window.localStorage.getItem(key)!;
  }
  return store;
});

// sessionStorage
const sessionStorage = await page.evaluate(() => {
  const store: Record<string, string> = {};
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const key = window.sessionStorage.key(i)!;
    store[key] = window.sessionStorage.getItem(key)!;
  }
  return store;
});

// Full snapshot — cookies + localStorage + sessionStorage (use for auth save/restore)
await page.context().storageState({ path: 'qa/knowledgebase/storage-state.json' });

console.log('localStorage:', localStorage);
console.log('sessionStorage:', sessionStorage);
```

---

## 9. Accessibility Audit — axe-core

```typescript
import AxeBuilder from '@axe-core/playwright';

// Run axe on the current page
const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
  .analyze();

console.log('Violations:', results.violations.length);
console.log('Passes:', results.passes.length);
console.log('Incomplete (needs manual check):', results.incomplete.length);

// Detailed violation output
results.violations.forEach(v => {
  console.log(`\n[${v.impact}] ${v.id}: ${v.description}`);
  v.nodes.forEach(n => console.log(`  → ${n.target.join(', ')}: ${n.failureSummary}`));
});

// Save full report
fs.writeFileSync(
  'qa/knowledgebase/axe-report.json',
  JSON.stringify(results, null, 2)
);
```

---

## 10. Performance & Core Web Vitals

### Chrome DevTools Protocol (CDP)

```typescript
const client = await page.context().newCDPSession(page);

// Enable performance tracking
await client.send('Performance.enable');
await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const { metrics } = await client.send('Performance.getMetrics');
const map = Object.fromEntries(metrics.map(m => [m.name, m.value]));

console.log({
  FCP:        map['FirstContentfulPaint'],
  LCP:        map['LargestContentfulPaint'],
  DomReady:   map['DOMContentLoaded'],
  Resources:  map['ResourceCount'],
  JSHeapUsed: `${(map['JSHeapUsedSize'] / 1024 / 1024).toFixed(1)} MB`,
});
```

### Resource Loading Breakdown

```typescript
const resources = await page.evaluate(() =>
  performance.getEntriesByType('resource').map((r: any) => ({
    name: r.name.split('/').pop(),
    type: r.initiatorType,
    duration: Math.round(r.duration),
    size: r.transferSize
  }))
);

// Sort by slowest
const slowest = resources.sort((a, b) => b.duration - a.duration).slice(0, 10);
console.log('Slowest resources:', slowest);
```

### JS/CSS Coverage — Find Dead Code

```typescript
// Start coverage before navigation
await Promise.all([
  page.coverage.startJSCoverage(),
  page.coverage.startCSSCoverage()
]);

await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const [jsCoverage, cssCoverage] = await Promise.all([
  page.coverage.stopJSCoverage(),
  page.coverage.stopCSSCoverage()
]);

// JS coverage summary
jsCoverage.forEach(entry => {
  const usedBytes = entry.ranges.reduce((sum, r) => sum + r.end - r.start, 0);
  const totalBytes = entry.text?.length ?? 0;
  const pct = totalBytes ? Math.round((usedBytes / totalBytes) * 100) : 0;
  if (pct < 50) console.log(`Low JS coverage: ${entry.url.split('/').pop()} — ${pct}% used`);
});
```

---

## 11. Frame & Worker Discovery

### iframes on the Page

```typescript
// List all frames
page.frames().forEach(frame => {
  console.log('Frame:', frame.url(), '| Name:', frame.name());
});

// Get content inside an iframe
const iframeContent = await page.frameLocator('iframe#embedded').locator('body').innerHTML();

// Screenshot a specific iframe
await page.frameLocator('iframe#map').locator('body').screenshot({
  path: 'qa/knowledgebase/screenshots/iframe-map.png'
});
```

### Web Workers and Service Workers

```typescript
// Detect service workers
page.on('worker', worker => {
  console.log('Worker registered:', worker.url());
});

// Check for service worker registration
const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
if (hasSW) {
  const swUrl = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active?.scriptURL ?? null;
  });
  console.log('Service worker:', swUrl);
}
```

---

## 12. Multi-Viewport Exploration

Explore the same route at different viewports to discover responsive layout differences.

```typescript
import { devices } from '@playwright/test';

const viewports = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 720 },
  { name: 'tablet-768',   width: 768,  height: 1024 },
  { name: 'mobile-390',   width: 390,  height: 844  },  // iPhone 14
  { name: 'mobile-375',   width: 375,  height: 812  },  // iPhone SE
];

for (const vp of viewports) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: `qa/knowledgebase/screenshots/responsive-${vp.name}.png`,
    fullPage: true
  });
}

// Device emulation (includes touch, user agent, pixel ratio)
const context = await browser.newContext({ ...devices['Pixel 7'] });
```

---

## 13. Full Exploration Run — Putting It All Together

A single script that runs everything above in one pass and writes a complete knowledge base.

```typescript
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.qa' });

const BASE_URL = process.env.QA_APP_URL!;
const OUT = 'qa/knowledgebase';
fs.mkdirSync(`${OUT}/screenshots`, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  // Start trace
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const page = await context.newPage();

  // Attach monitors
  const networkLog: object[] = [];
  const consoleLogs: object[] = [];

  page.on('request',  r  => networkLog.push({ dir: '→', method: r.method(), url: r.url() }));
  page.on('response', r  => networkLog.push({ dir: '←', status: r.status(), url: r.url() }));
  page.on('console',  m  => consoleLogs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror',e  => consoleLogs.push({ type: 'pageerror', text: e.message }));

  let step = 0;
  const snap = async (label: string) => {
    step++;
    const file = `${OUT}/screenshots/${String(step).padStart(2,'0')}-${label}.png`;
    await page.screenshot({ path: file, fullPage: true });
    return file;
  };

  // ── Navigate and discover ──────────────────────────────────────────────────

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await snap('homepage');

  // DOM inventory
  const inventory = {
    url:       page.url(),
    title:     await page.title(),
    viewport:  page.viewportSize(),
    headings:  await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3')].map(h => `${h.tagName}: ${h.textContent?.trim()}`)),
    navLinks:  await page.evaluate(() =>
      [...document.querySelectorAll('nav a')].map(a => ({
        text: a.textContent?.trim(),
        href: (a as HTMLAnchorElement).getAttribute('href')
      }))),
    buttons:   await page.evaluate(() =>
      [...document.querySelectorAll('button,[role="button"]')].map(b => b.textContent?.trim()).filter(Boolean)),
    forms:     await page.evaluate(() =>
      [...document.querySelectorAll('form')].map(f => ({
        action: f.getAttribute('action'),
        fields: [...f.querySelectorAll('input,textarea,select')]
          .map(i => ({ type: i.getAttribute('type'), name: i.getAttribute('name'), placeholder: i.getAttribute('placeholder') }))
      }))),
    iframes:   page.frames().map(f => f.url()).filter(u => u !== 'about:blank'),
  };

  // Accessibility snapshot
  const a11yTree = await page.accessibility.snapshot();

  // Storage
  const cookies = await context.cookies();
  const localStore = await page.evaluate(() => ({ ...localStorage }));

  // Save all knowledge
  fs.writeFileSync(`${OUT}/ui-inventory.json`,    JSON.stringify(inventory, null, 2));
  fs.writeFileSync(`${OUT}/a11y-tree.json`,       JSON.stringify(a11yTree,  null, 2));
  fs.writeFileSync(`${OUT}/network-log.json`,     JSON.stringify(networkLog, null, 2));
  fs.writeFileSync(`${OUT}/console-log.json`,     JSON.stringify(consoleLogs, null, 2));
  fs.writeFileSync(`${OUT}/cookies.json`,         JSON.stringify(cookies,    null, 2));
  fs.writeFileSync(`${OUT}/localstorage.json`,    JSON.stringify(localStore, null, 2));
  fs.writeFileSync(`${OUT}/page-snapshot.html`,   await page.content());

  // Multi-viewport screenshots
  for (const [name, size] of Object.entries({
    'responsive-desktop': { width: 1280, height: 720 },
    'responsive-tablet':  { width: 768,  height: 1024 },
    'responsive-mobile':  { width: 375,  height: 812  },
  })) {
    await page.setViewportSize(size);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/screenshots/${name}.png`, fullPage: true });
  }

  // Save trace
  await context.tracing.stop({ path: `${OUT}/trace-exploration.zip` });

  await browser.close();

  console.log(`\n✅ Exploration complete. Knowledge base saved to ${OUT}/`);
  console.log(`   UI inventory:    ${OUT}/ui-inventory.json`);
  console.log(`   A11y tree:       ${OUT}/a11y-tree.json`);
  console.log(`   Network log:     ${OUT}/network-log.json`);
  console.log(`   Page snapshot:   ${OUT}/page-snapshot.html`);
  console.log(`   Trace:           npx playwright show-trace ${OUT}/trace-exploration.zip`);
  console.log(`   Screenshots:     ${OUT}/screenshots/ (${step} files)`);
})();
```

---

## Quick Reference — Which Tool for What

| Goal | Tool |
|------|------|
| See what's on screen | `page.screenshot({ fullPage: true })` + Read tool |
| Understand page structure | `page.accessibility.snapshot()` or `locator.ariaSnapshot()` |
| Find all buttons/links/inputs | `page.evaluate(() => querySelectorAll(...))` |
| See every API call made | `page.on('request')` + `page.on('response')` |
| Catch JS errors | `page.on('pageerror')` + `page.on('console')` |
| Full session replay | `context.tracing.start/stop` → `show-trace` |
| Record video | `browser.newContext({ recordVideo: ... })` |
| Responsive layout check | `page.setViewportSize()` loop |
| What's in localStorage | `page.evaluate(() => ({...localStorage}))` |
| Auth state saved | `context.storageState({ path })` |
| Measure performance | CDP `Performance.getMetrics` |
| Find dead JS/CSS | `page.coverage.startJSCoverage/CSS` |
| WCAG compliance | `AxeBuilder({ page }).analyze()` |
| iframe content | `page.frameLocator('iframe#id').locator(...)` |
| Service worker detection | `page.evaluate(() => navigator.serviceWorker.getRegistration())` |
