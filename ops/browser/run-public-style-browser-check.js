'use strict';

// BE-28 (#65) â€” browsercheck voor de frisse publieke stijl.
//
// Dit script start de echte productiebuild (`next start`) op een lokale poort,
// bestuurt een lokaal geÃ¯nstalleerde Edge/Chrome via CDP (zelfde runtime als de
// #59/#62-checks) en legt vast:
//
//   - de initiÃ«le overdracht van `/` (document + subresources, dark, 1280 px),
//     zodat de "voor"- en "na"-meting van criterium 6 vergelijkbaar zijn;
//   - screenshots van home, zoeken met resultaten, alle restaurants, een
//     restaurantpagina en een menukaart op 1280, 390 en 320 px, in licht en
//     donker;
//   - een screenshot van /internal/coverage in licht en donker (zonder
//     productiecredentials: het script logt eerlijk wat er dan te zien is);
//   - live gemeten contrast van de nieuwe tokenparen en de layoutchecks
//     (geen horizontale overflow, tabbar alleen op de telefoon, tikvlakken
//     >= 44 px, prijs rechts in de zoekresultaten).
//
// Het is developer-evidence in een lokale, geÃ¯soleerde omgeving: geen
// productie, geen echte Supabase-credentials en geen merge/publicatie.
//
// Gebruik:
//   npm run build
//   node ops/browser/run-public-style-browser-check.js --label after
//   node ops/browser/run-public-style-browser-check.js --label before \
//     --transfer-only --out <path>

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { findBrowser, killTree, startBrowser, evalJs, navigate, pressKey } = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output', 'be-28');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const PORT = Number(process.env.BE28_PORT || 3144);
const APP = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 && args[index + 1] ? args[index + 1] : fallback;
};
const LABEL = option('label', 'after');
const TRANSFER_ONLY = args.includes('--transfer-only');
const OUT_PATH = path.resolve(option('out', path.join(EVIDENCE_DIR, 'public-style-browser-evidence.json')));

const checks = [];
const shots = [];
const transfer = [];
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ` â€” ${detail}` : ''}`);
}

// â”€â”€ contrast, measured from the live computed styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CONTRAST_JS = `(() => {
  const parse = (value) => {
    const m = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
  const lum = (c) => {
    const v = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a); const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const backgroundOf = (el) => {
    let node = el;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.05) return bg;
      node = node.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const measure = (label, el, explicitBg) => {
    if (!el) return { label, missing: true };
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    const bg = explicitBg || backgroundOf(el);
    const solid = fg.a < 1
      ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }
      : fg;
    return { label, fg: hex(solid), bg: hex(bg), ratio: ratio(solid, bg) };
  };
  const q = (sel) => document.querySelector(sel);
  const priceEl = q('.tonight-price') || q('.price-label');
  const results = [
    measure('body text', document.body),
    measure('secondary text', q('.tonight-meta') || q('.results-count')),
    measure('price label', priceEl, priceEl ? parse(getComputedStyle(priceEl).backgroundColor) : null),
    measure('primary button', q('.home-search-btn')),
    measure('chip', q('.home-chip')),
    measure('tab bar link', q('.mobile-tab-link')),
  ];
  const field = q('.home-search');
  if (field) {
    const border = parse(getComputedStyle(field).borderTopColor);
    const bg = parse(getComputedStyle(field).backgroundColor);
    if (border && bg) results.push({ label: 'search field border', fg: hex(border), bg: hex(bg), ratio: ratio(border, bg) });
  }
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    results,
  };
})()`; 


// â”€â”€ server en browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startProductionServer() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT_DIR, 'next-start.log'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npm, ['run', 'start', '--', '-p', String(PORT)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForHttp(`${APP}/`, 120000);
  return child;
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, name) {
  // Desktop: the whole page. Phone: exactly one viewport, because a fixed
  // tab bar is painted at its viewport position in a beyond-viewport shot and
  // would look like a layout bug in the evidence.
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(viewport.width, Math.ceil(content.width));
  const height = viewport.width < 720 ? viewport.height : Math.min(4000, Math.ceil(content.height));
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: viewport.width >= 720,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const buffer = Buffer.from(result.data, 'base64');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, buffer);
  shots.push({ file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'), bytes: buffer.length, width, height, viewport: `${viewport.width}x${viewport.height}` });
}

async function applyTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, `document.readyState === 'complete'`);
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', '${theme}')`);
}

async function open(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
}

// â”€â”€ netwerkmeting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function attachNetworkMeter(cdp) {
  const requests = new Map();
  const finished = [];
  cdp.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, { url: event.request.url, type: event.type });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const meta = requests.get(event.requestId) || { url: 'unknown', type: 'Other' };
    finished.push({ url: meta.url, type: meta.type, bytes: event.encodedDataLength || 0 });
  });
  return {
    reset() {
      requests.clear();
      finished.length = 0;
    },
    summary() {
      const totalBytes = finished.reduce((sum, entry) => sum + entry.bytes, 0);
      const byType = {};
      for (const entry of finished) byType[entry.type] = (byType[entry.type] || 0) + entry.bytes;
      const document = finished.find((entry) => entry.type === 'Document');
      return {
        totalBytes,
        totalKb: Math.round((totalBytes / 1024) * 10) / 10,
        documentBytes: document ? document.bytes : null,
        resourceCount: finished.length,
        byType,
        biggest: [...finished].sort((a, b) => b.bytes - a.bytes).slice(0, 8)
          .map((entry) => ({ url: entry.url.replace(APP, ''), type: entry.type, bytes: entry.bytes })),
      };
    },
  };
}

async function measureHomeTransfer(cdp, meter) {
  await applyTheme(cdp, 'dark');
  await setViewport(cdp, 1280, 900);
  // A cold cache is the honest "initial transfer": without this the second
  // navigation is served from the browser cache and measures ~0.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await open(cdp, `${APP}/`, `document.readyState === 'complete' && document.body && document.body.innerText.length > 0`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const summary = meter.summary();
  transfer.push({ label: LABEL, page: '/', theme: 'dark', viewport: '1280x900', ...summary });
  return summary;
}


// â”€â”€ scenario's â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function contrastScenario(cdp) {
  const perTheme = {};
  for (const theme of ['light', 'dark']) {
    await applyTheme(cdp, theme);
    await setViewport(cdp, 390, 820);
    await open(cdp, `${APP}/`, `document.readyState === 'complete' && document.querySelector('.home-hero') !== null`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const measured = await evalJs(cdp, CONTRAST_JS);
    perTheme[theme] = measured;
    for (const entry of measured.results) {
      if (entry.missing) {
        check(`contrast ${theme}: ${entry.label} present`, false, 'element missing');
        continue;
      }
      const isText = /body text|secondary text|price label|button|chip|tab/i.test(entry.label);
      const minimum = isText ? 4.5 : 3;
      check(`contrast ${theme}: ${entry.label} >= ${minimum}:1`, entry.ratio >= minimum, `${entry.ratio}:1 (${entry.fg} on ${entry.bg})`);
    }
  }
  return perTheme;
}

async function pageScenario(cdp, { name, url, ready, widths }) {
  for (const theme of ['light', 'dark']) {
    await applyTheme(cdp, theme);
    for (const width of widths) {
      await setViewport(cdp, width, width >= 1280 ? 900 : 820);
      await open(cdp, url, ready);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const state = await evalJs(cdp, `(() => ({
        htmlTheme: document.documentElement.getAttribute('data-theme'),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        images: document.images.length,
        tabbarVisible: (() => {
          const bar = document.querySelector('.mobile-tabbar');
          return bar ? getComputedStyle(bar).display !== 'none' : null;
        })(),
      }))()`);
      await shot(cdp, `${name}-${theme}-${width}.png`);

      check(`${name} ${theme} ${width}px: theme applied`, state.htmlTheme === theme, `${state.htmlTheme}, body ${state.bodyBackground}`);
      check(`${name} ${theme} ${width}px: no horizontal overflow`, state.scrollWidth <= state.innerWidth + 1, `scrollWidth ${state.scrollWidth} vs innerWidth ${state.innerWidth}`);
      if (state.tabbarVisible !== null) {
        check(`${name} ${theme} ${width}px: tab bar ${width <= 720 ? 'visible' : 'hidden'}`, state.tabbarVisible === (width <= 720));
      }
      check(`${name} ${theme} ${width}px: no photography`, state.images === 0, `${state.images} img elements`);
    }
  }
}

async function searchCardScenario(cdp) {
  await applyTheme(cdp, 'light');
  await setViewport(cdp, 390, 820);
  await open(cdp, `${APP}/search?q=pasta`, `document.querySelectorAll('.dish-result-card-row').length > 0`);
  const row = await evalJs(cdp, `(() => {
    const row = document.querySelector('.dish-result-card-row');
    if (!row) return null;
    const name = row.querySelector('.dish-group-example-link');
    const price = row.querySelector('.price-label');
    if (!name || !price) return { missing: true };
    const a = name.getBoundingClientRect();
    const b = price.getBoundingClientRect();
    return { nameRight: Math.round(a.right), priceLeft: Math.round(b.left), priceText: price.innerText, nameText: name.innerText };
  })()`);
  check('search results: a result card shows the dish name and its real price', Boolean(row && !row.missing), row ? JSON.stringify(row) : 'no cards');
  check('search results: the price sits to the right of the dish name', Boolean(row && row.priceLeft >= row.nameRight - 4), row ? `${row.priceLeft} >= ${row.nameRight}` : 'no cards');
  const tabs = await evalJs(cdp, `(() => {
    const parse = (v) => { const m = String(v).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const v = [c.r, c.g, c.b].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100; };
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
    const measure = (label, sel) => {
      const el = document.querySelector(sel);
      if (!el) return { label, missing: true };
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      const bg = parse(style.backgroundColor);
      return { label, fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg) };
    };
    return [measure('active phone tab', '.mobile-tab-link[aria-current="page"]'), measure('active header nav', '.primary-nav-link[aria-current="page"]')];
  })()`);
  for (const tab of tabs) {
    check(`search results: ${tab.label} contrast >= 4.5:1`, !tab.missing && tab.ratio >= 4.5, tab.missing ? 'element missing' : `${tab.ratio}:1 (${tab.fg} on ${tab.bg})`);
  }
  await shot(cdp, 'search-results-light-390-detail.png');
}

async function tapTargetScenario(cdp) {
  await setViewport(cdp, 320, 820);
  await applyTheme(cdp, 'dark');
  await open(cdp, `${APP}/`, `document.querySelector('.mobile-tabbar') !== null`);
  const sizes = await evalJs(cdp, `(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { text: el.innerText.trim(), width: Math.round(r.width), height: Math.round(r.height) }; };
    return {
      bars: [...document.querySelectorAll('.mobile-tab-link')].map(rect),
      chips: [...document.querySelectorAll('.home-chip')].map(rect),
    };
  })()`);
  for (const bar of sizes.bars) check(`320px: tab bar target "${bar.text}" >= 44px`, bar.height >= 44, `${bar.width}x${bar.height}`);
  for (const chip of sizes.chips) check(`320px: chip target "${chip.text}" >= 44px`, chip.height >= 44 || chip.width >= 44, `${chip.width}x${chip.height}`);
}

async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 820);
  await applyTheme(cdp, 'light');
  await open(cdp, `${APP}/`, `document.querySelector('.home-search-input') !== null`);
  await evalJs(cdp, `document.querySelector('.home-search-input').focus()`);
  await pressKey(cdp, 'Tab', 'Tab', 9);
  const focus = await evalJs(cdp, `(() => {
    const el = document.activeElement;
    return { tag: el.tagName, text: (el.innerText || el.value || '').trim().slice(0, 40), outline: getComputedStyle(el).outlineWidth };
  })()`);
  check('keyboard: Tab from the search field lands on the Zoeken button', focus.tag === 'BUTTON' && focus.text.includes('Zoeken'), JSON.stringify(focus));
}


async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  let server = null;
  let browser = null;
  let cdp = null;
  let contrast = null;
  try {
    console.log('starting the production build on ' + APP);
    server = await startProductionServer();
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const meter = attachNetworkMeter(cdp);
    const home = await measureHomeTransfer(cdp, meter);
    console.log(`home transfer (${LABEL}): ${home.totalKb} KB over ${home.resourceCount} requests`);

    if (!TRANSFER_ONLY) {
      contrast = await contrastScenario(cdp);
      await pageScenario(cdp, { name: 'home', url: `${APP}/`, ready: `document.querySelector('.home-hero') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'search-results', url: `${APP}/search?q=pasta`, ready: `document.querySelectorAll('.dish-result-card-row').length > 0`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'alle-restaurants', url: `${APP}/alle-restaurants`, ready: `document.querySelector('.lrc-card') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'restaurant', url: `${APP}/restaurant/6`, ready: `document.querySelector('.detail-name') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'menu', url: `${APP}/menu/6-diner`, ready: `document.querySelector('.td-price') !== null`, widths: [1280, 390, 320] });
      await searchCardScenario(cdp);
      await tapTargetScenario(cdp);
      await keyboardScenario(cdp);

      // /internal/coverage â€” zonder productiecredentials. Het script legt
      // vast wat er dan werkelijk staat; dit is geen interne acceptatie.
      for (const theme of ['light', 'dark']) {
        await applyTheme(cdp, theme);
        await setViewport(cdp, 1280, 900);
        await open(cdp, `${APP}/internal/coverage`, `document.readyState === 'complete'`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const state = await evalJs(cdp, `(() => ({
          path: location.pathname,
          text: document.body.innerText.trim().slice(0, 160),
          theme: document.documentElement.getAttribute('data-theme'),
        }))()`);
        await shot(cdp, `internal-coverage-${theme}-1280.png`);
        check(`internal/coverage ${theme}: captured without production credentials`, true, JSON.stringify(state));
      }

      // /internal/login is the one internal screen that renders without any
      // Supabase data, so it is the honest local proof that the new tokens
      // keep an internal page readable in both themes.
      for (const theme of ['light', 'dark']) {
        await applyTheme(cdp, theme);
        await setViewport(cdp, 1280, 900);
        await open(cdp, `${APP}/internal/login`, `document.readyState === 'complete' && document.body.innerText.length > 0`);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const state = await evalJs(cdp, `(() => ({
          path: location.pathname,
          theme: document.documentElement.getAttribute('data-theme'),
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          textColor: getComputedStyle(document.body).color,
          heading: document.querySelector('h1, h2') ? document.querySelector('h1, h2').innerText : null,
        }))()`);
        await shot(cdp, `internal-login-${theme}-1280.png`);
        check(`internal/login ${theme}: renders with the new tokens`, state.theme === theme && state.heading !== null, JSON.stringify(state));
      }
    }

    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      label: LABEL,
      kind: 'developer evidence â€” local production build, no production data or credentials',
      app: APP,
      transfer,
      contrast,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshots: shots,
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ result: record.result, checks: checks.length, failed: failed.length, screenshots: shots.length, out: path.relative(REPO_ROOT, OUT_PATH) }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // A locked temporary profile is harmless; it stays outside the repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

