'use strict';

// BE-28 (#65) â€” browsercheck voor de frisse publieke stijl.
//
// Dit script start de echte productiebuild (`next start`) op een lokale poort,
// bestuurt een lokaal geÃ¯nstalleerde Edge/Chrome via CDP (zelfde runtime als de
// #59/#62-checks) en legt vast:
//
//   - de initiÃ«le overdracht van `/` en van `/alle-restaurants` (document +
//     subresources, dark, 1280 px), zodat de "voor"- en "na"-meting van
//     criterium 6 vergelijkbaar zijn;
//   - screenshots van home, zoeken met resultaten, alle restaurants,
//     /restaurants, een restaurantpagina met en zonder menukaart, een
//     menukaart, /claim en /nvwa op 1280, 390 en 320 px, in licht en donker;
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
const { spawn, spawnSync } = require('node:child_process');

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
// Optioneel: meet een andere checkout (bijvoorbeeld de base voor de
// "voor"-meting) met exact ditzelfde script. Standaard de eigen checkout.
const APP_ROOT = path.resolve(REPO_ROOT, option('root', '.'));

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


// BE-28b (#68) — hetzelfde contrastonderzoek op /alle-restaurants: kaartnaam,
// keukenregel, adres, CTA, chip en telling, in beide thema's.
const AR_CONTRAST_JS = `(() => {
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
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    results: [
      measure('card name', q('.ar-name')),
      measure('card kind', q('.ar-kind')),
      measure('card address', q('.ar-address')),
      // BE-42 (#98) — 1A: de grote kaartknop is vervallen; de menuknoppen
      // dragen nu hetzelfde tokenpaar en worden hier gemeten.
      measure('card menu button', q('.ar-menu-button')),
      measure('chip', q('.ar-chips .chip')),
      measure('count', q('.ar-count')),
    ],
  };
})()`;


// â”€â”€ server en browser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function startProductionServer() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT_DIR, 'next-start.log'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Een geïsoleerde checkout heeft soms geen globale npm. Dan start dezelfde
  // productiebuild rechtstreeks met node (zelfde commando, zelfde env).
  const npmAvailable = spawnSync(npm, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const nextBin = path.join(APP_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const serverEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
  };
  const child = npmAvailable
    ? spawn(npm, ['run', 'start', '--', '-p', String(PORT)], {
        cwd: APP_ROOT,
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
      })
    : spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
        cwd: APP_ROOT,
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
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

async function shot(cdp, name, { fullPage = false } = {}) {
  // Desktop: the whole page. Phone: exactly one viewport, because a fixed
  // tab bar is painted at its viewport position in a beyond-viewport shot and
  // would look like a layout bug in the evidence. BE-29's own evidence asks
  // for the whole page at every width, so it passes `fullPage: true`.
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(viewport.width, Math.ceil(content.width));
  const wholePage = fullPage || viewport.width >= 720;
  const height = wholePage ? Math.min(5000, Math.ceil(content.height)) : viewport.height;
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: wholePage,
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

// BE-29 (#70) — de drie momenten van de dag met een vaste browserklok. De
// productiecode rekent zelf in Europe/Amsterdam; deze override laat de echte
// clientselectie op een vast moment draaien zonder de systeemklok te wijzigen.
//
// BE-42 deel 2 (#98) — de borrelverwachting was verouderd. Sinds BE-38 (#90)
// laat de home de sectie niet meer weg als het huidige moment te weinig echte
// gerechten heeft: om 17:00 is de borrel te klein en valt de selectie terug op
// het eerstvolgende moment, de diner, met de titel "Straks op de kaart ·
// vanaf HH:MM" en `data-mode="later"`. Alleen deze verwachting is bijgewerkt;
// het gedrag van de app is niet veranderd.
const BE29_MOMENTS = [
  { id: 'lunch', iso: '2026-10-23T10:30:00Z', meal: 'lunch', mode: 'now', title: 'Nu op de lunchkaart' },
  { id: 'borrel', iso: '2026-10-23T15:00:00Z', meal: 'diner', mode: 'later', title: 'Straks op de kaart' },
  { id: 'diner', iso: '2026-10-23T18:00:00Z', meal: 'diner', mode: 'now', title: 'Vanavond op de kaart' },
];


let clockScriptId = null;
async function setFixedClock(cdp, iso) {
  if (clockScriptId) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScriptId });
    clockScriptId = null;
  }
  if (!iso) return;
  const fixed = new Date(iso).getTime();
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const RealDate = Date;
      const fixed = ${fixed};
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
        static now() { return fixed; }
      }
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      window.Date = FixedDate;
    })();`,
  });
  clockScriptId = result.identifier;
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

async function measureTransfer(cdp, meter, { page, ready }) {
  await applyTheme(cdp, 'dark');
  await setViewport(cdp, 1280, 900);
  // A cold cache is the honest "initial transfer": without this the second
  // navigation is served from the browser cache and measures ~0.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await open(cdp, `${APP}${page}`, ready);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const summary = meter.summary();
  transfer.push({ label: LABEL, page, theme: 'dark', viewport: '1280x900', ...summary });
  return summary;
}

async function measureHomeTransfer(cdp, meter) {
  return measureTransfer(cdp, meter, {
    page: '/',
    ready: `document.readyState === 'complete' && document.body && document.body.innerText.length > 0`,
  });
}

// BE-28b (#68) — dezelfde koude meting voor /alle-restaurants, zodat de
// "voor"- en "na"-overdracht met hetzelfde script en dezelfde omstandigheden
// vergelijkbaar zijn. De pagina is pas klaar als de echte kaarten er staan.
async function measureAlleRestaurantsTransfer(cdp, meter) {
  return measureTransfer(cdp, meter, {
    page: '/alle-restaurants',
    ready: `document.readyState === 'complete' && document.querySelectorAll('.ar-card, .lrc-card').length > 0`,
  });
}


// â”€â”€ scenario's â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function contrastScenario(cdp) {
  // BE-29 — de home toont "Vanavond op de kaart" alleen als er drie echte
  // gerechten voor dit moment zijn. Meet de contrastparen daarom op het vaste
  // dinermoment (2026-10-23, 20:00 Amsterdam), niet op de toevallige
  // systeemklok van de ontwikkelmachine.
  await setFixedClock(cdp, '2026-10-23T18:00:00Z');
  const perTheme = {};
  for (const theme of ['light', 'dark']) {
    await applyTheme(cdp, theme);
    await setViewport(cdp, 390, 820);
    await open(cdp, `${APP}/`, `document.readyState === 'complete' && document.querySelector('.home-hero') !== null`);
    await new Promise((resolve) => setTimeout(resolve, 900));
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
  await setFixedClock(cdp, null);
  return perTheme;
}

async function pageScenario(cdp, { name, url, ready, widths, fullPage = false }) {
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
      await shot(cdp, `${name}-${theme}-${width}.png`, { fullPage });

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

async function nvwaLayoutScenario(cdp) {
  await applyTheme(cdp, 'light');
  await setViewport(cdp, 320, 820);
  await open(cdp, `${APP}/nvwa/6`, `document.querySelector('.nvwa-score-value') !== null`);
  const score = await evalJs(cdp, `(() => {
    const value = document.querySelector('.nvwa-score-value').getBoundingClientRect();
    const copy = document.querySelector('.nvwa-score-copy').getBoundingClientRect();
    return {
      valueRight: Math.round(value.right),
      copyLeft: Math.round(copy.left),
      valueWidth: Math.round(value.width),
      copyWidth: Math.round(copy.width),
    };
  })()`);
  check('nvwa 320px: the compliance score and its explanation do not overlap', score.valueRight <= score.copyLeft, JSON.stringify(score));
}

async function alleRestaurantsContrastScenario(cdp) {
  const perTheme = {};
  for (const theme of ['light', 'dark']) {
    await applyTheme(cdp, theme);
    await setViewport(cdp, 1280, 900);
    await open(cdp, `${APP}/alle-restaurants`, `document.querySelectorAll('.ar-card').length > 0`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const measured = await evalJs(cdp, AR_CONTRAST_JS);
    perTheme[theme] = measured;
    for (const entry of measured.results) {
      if (entry.missing) {
        check(`contrast alle-restaurants ${theme}: ${entry.label} present`, false, 'element missing');
        continue;
      }
      check(`contrast alle-restaurants ${theme}: ${entry.label} >= 4.5:1`, entry.ratio >= 4.5, `${entry.ratio}:1 (${entry.fg} on ${entry.bg})`);
    }
  }
  return perTheme;
}

async function alleRestaurantsScenario(cdp) {
  await applyTheme(cdp, 'light');
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${APP}/alle-restaurants`, `document.querySelectorAll('.ar-card').length > 0`);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const initial = await evalJs(cdp, `(() => {
    const cards = [...document.querySelectorAll('.ar-card')];
    const rows = new Map();
    cards.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const top = Math.round(rect.top);
      rows.set(top, [...(rows.get(top) || []), Math.round(rect.height)]);
    });
    return {
      count: cards.length,
      // BE-42 (#98) — 1A: de kaart is geen grote link meer. De naam is de link
      // naar de restaurantpagina, elke menukaart is een eigen knop naar
      // /menu/<id> en de grote knop "Bekijk N menukaarten" is vervallen.
      cardTags: cards.filter((el) => !el.classList.contains('ar-card--nomenu')).map((el) => el.tagName),
      nameLinks: cards.filter((el) => !el.classList.contains('ar-card--nomenu')).map((el) => {
        const link = el.querySelector('a.ar-name-link');
        return link ? link.getAttribute('href') : null;
      }),
      menuButtons: [...document.querySelectorAll('.ar-card a.ar-menu-button')].map((el) => ({
        label: el.innerText.trim(),
        href: el.getAttribute('href'),
      })),
      countText: document.querySelector('.ar-count') ? document.querySelector('.ar-count').innerText.trim() : null,
      sortValue: document.querySelector('.ar-sort') ? document.querySelector('.ar-sort').value : null,
      sortText: document.querySelector('.ar-sort') ? document.querySelector('.ar-sort').selectedOptions[0].textContent.trim() : null,
      chips: [...document.querySelectorAll('.ar-chips .chip')].map((el) => el.innerText.trim()),
      ctas: [...document.querySelectorAll('.ar-cta')].length,
      noMenuButtons: [...document.querySelectorAll('.ar-card--nomenu')].filter((el) => el.querySelector('.ar-menu-button, .ar-cta')).length,
      noMenuLabels: [...document.querySelectorAll('.ar-nomenu-label')].map((el) => el.innerText.trim()),
      restaurantLinks: [...document.querySelectorAll('.ar-restaurant-link')].map((el) => el.innerText.trim()),
      firstCard: cards[0] ? cards[0].querySelector('.ar-name').innerText : null,
      rows: [...rows.values()],
    };
  })()`);

  check('alle restaurants: every known restaurant is shown from the real API', initial.count === 25, `${initial.count} cards`);
  check('alle restaurants: the count line is computed from the real data', initial.countText === '25 restaurants · 4 met menukaart', initial.countText);
  check('alle restaurants: no card with a menu is one big link any more', initial.cardTags.length === 4 && initial.cardTags.every((tag) => tag === 'ARTICLE'), JSON.stringify(initial.cardTags));
  check('alle restaurants: the restaurant name links to its own restaurant page', initial.nameLinks.length === 4 && initial.nameLinks.every((href) => /^\/restaurant\/\d+$/.test(href || '')), JSON.stringify(initial.nameLinks));
  check('alle restaurants: every menu card is its own button to /menu/<id>', initial.menuButtons.length === 11 && initial.menuButtons.every((button) => /^\/menu\/[^/]+$/.test(button.href || '') && button.label.length > 2), JSON.stringify(initial.menuButtons.map((button) => button.href)));
  check('alle restaurants: "Met menukaart eerst" is the default sort', initial.sortValue === 'menu-first' && /Met menukaart eerst/.test(initial.sortText || ''), JSON.stringify({ value: initial.sortValue, text: initial.sortText }));
  check('alle restaurants: the first chip is "📋 Met menukaart" and cuisine chips carry emoji', /Met menukaart/.test(initial.chips[0] || '') && initial.chips.length > 1 && initial.chips.some((chip) => /[🍝🥩🥘🍜🥡🍺🥂🍛🧆🥨🍴🥢🍽️]/.test(chip)), JSON.stringify(initial.chips.slice(0, 8)));
  check('alle restaurants: the big "Bekijk N menukaarten" button is gone', initial.ctas === 0, `${initial.ctas} .ar-cta`);
  check('alle restaurants: cards without a menu keep "Nog geen menukaart" and get no menu button', initial.noMenuButtons === 0 && initial.noMenuLabels.length === 21 && initial.noMenuLabels.every((text) => text === 'Nog geen menukaart'), JSON.stringify({ noMenuButtons: initial.noMenuButtons, labels: initial.noMenuLabels.length }));
  check('alle restaurants: cards without a menu still offer "Bekijk restaurant →"', initial.restaurantLinks.length === 21 && initial.restaurantLinks.every((text) => text.startsWith('Bekijk restaurant')), JSON.stringify(initial.restaurantLinks.slice(0, 2)));
  const uneven = initial.rows.filter((heights) => heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 1);
  check('alle restaurants: cards in the same row are equally high', uneven.length === 0, JSON.stringify(initial.rows));

  // Sorteren: A–Z is een echte keuze en de URL onthoudt hem.
  await evalJs(cdp, `(() => {
    const select = document.querySelector('.ar-sort');
    select.value = 'az';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const sorted = await evalJs(cdp, `(() => ({
    first: document.querySelector('.ar-card .ar-name') ? document.querySelector('.ar-card .ar-name').innerText : null,
    url: location.search,
    countText: document.querySelector('.ar-count') ? document.querySelector('.ar-count').innerText.trim() : null,
  }))()`);
  check('alle restaurants: A–Z really sorts alphabetically', sorted.first === 'Al Dente Ristorante', JSON.stringify(sorted));
  check('alle restaurants: the chosen sort lives in the URL', sorted.url.includes('sort=az'), sorted.url);

  await evalJs(cdp, `(() => {
    const select = document.querySelector('.ar-sort');
    select.value = 'menu-first';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const restored = await evalJs(cdp, `(() => ({
    first: document.querySelector('.ar-card .ar-name') ? document.querySelector('.ar-card .ar-name').innerText : null,
    hasMenuButtons: Boolean(document.querySelector('.ar-card a.ar-menu-button')),
    url: location.search,
  }))()`);
  check('alle restaurants: "Met menukaart eerst" puts a card with a menu first', restored.first === 'Brasserie Bardot' && restored.hasMenuButtons, JSON.stringify(restored));
  check('alle restaurants: the default sort removes the sort parameter again', !restored.url.includes('sort='), restored.url);

  // Filteren: de bestaande chipstijl, echte aantallen.
  await evalJs(cdp, `(() => {
    const chip = [...document.querySelectorAll('.ar-chips .chip')].find((el) => el.innerText.includes('Met menukaart'));
    chip.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const menuOnly = await evalJs(cdp, `(() => ({
    cards: document.querySelectorAll('.ar-card').length,
    menuButtons: document.querySelectorAll('.ar-card a.ar-menu-button').length,
    countText: document.querySelector('.ar-count').innerText.trim(),
  }))()`);
  check('alle restaurants: the "Met menukaart" chip filters to the four real menu cards', menuOnly.cards === 4 && menuOnly.menuButtons === 11 && menuOnly.countText.includes('4 van 25 restaurants'), JSON.stringify(menuOnly));

  await evalJs(cdp, `(() => {
    const chip = [...document.querySelectorAll('.ar-chips .chip')].find((el) => el.innerText.includes('Met menukaart'));
    chip.click();
    const italian = [...document.querySelectorAll('.ar-chips .chip')].find((el) => el.innerText.includes('Italiaans'));
    italian.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const italianOnly = await evalJs(cdp, `(() => ({
    cards: [...document.querySelectorAll('.ar-card')].map((el) => el.querySelector('.ar-name').innerText),
    kinds: [...document.querySelectorAll('.ar-kind')].map((el) => el.innerText.trim()),
    countText: document.querySelector('.ar-count').innerText.trim(),
  }))()`);
  check('alle restaurants: a cuisine chip filters on the real cuisine labels', italianOnly.cards.length === 3 && italianOnly.kinds.every((kind) => kind.startsWith('Italiaans')), JSON.stringify(italianOnly));
  check('alle restaurants: the filtered count is honest about the total', italianOnly.countText === '3 van 25 restaurants · 0 met menukaart', italianOnly.countText);

  // Telefoon: de kaart zonder menukaart is één compacte regel met pijl.
  await setViewport(cdp, 390, 820);
  await open(cdp, `${APP}/alle-restaurants`, `document.querySelectorAll('.ar-card--nomenu').length > 0`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const phone = await evalJs(cdp, `(() => {
    const card = document.querySelector('.ar-card--nomenu');
    const arrow = card.querySelector('.ar-arrow');
    const inline = card.querySelector('.ar-nomenu-inline');
    const link = card.querySelector('.ar-restaurant-link');
    return {
      arrow: getComputedStyle(arrow).display,
      inline: getComputedStyle(inline).display,
      link: getComputedStyle(link).display,
      address: card.querySelector('.ar-address') ? card.querySelector('.ar-address').innerText.trim() : null,
    };
  })()`);
  check('alle restaurants 390px: the menu-less card is one compact line with an arrow', phone.arrow !== 'none' && phone.inline !== 'none' && phone.link === 'none', JSON.stringify(phone));
  check('alle restaurants 390px: the address is still shown', Boolean(phone.address), phone.address);
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


// ── BE-29 (#70): drie momenten, seizoenstegels, anker en de 308 ───────────
async function be29Scenario(cdp) {
  const homeState = {};

  for (const moment of BE29_MOMENTS) {
    await setFixedClock(cdp, moment.iso);
    await pageScenario(cdp, {
      name: `be29-home-${moment.id}`,
      url: `${APP}/`,
      ready:
        `document.readyState === 'complete' && document.querySelector('.home-hero') !== null && document.querySelectorAll('[data-season]').length === 3` +
        ` && document.querySelector('.tonight-section') !== null`,
      widths: [1280, 390, 320],
      fullPage: true,
    });

    await applyTheme(cdp, 'light');
    await setViewport(cdp, 1280, 900);
    await open(cdp, `${APP}/`, `document.readyState === 'complete' && document.querySelector('.home-hero') !== null`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = await evalJs(cdp, `(() => {
      const section = document.querySelector('.tonight-section');
      return {
        meal: section ? section.getAttribute('data-meal') : null,
        mode: section ? section.getAttribute('data-mode') : null,
        title: section ? section.querySelector('.home-section-title').textContent.trim() : null,
        cards: [...document.querySelectorAll('.tonight-card')].map((link) => ({
          name: link.querySelector('.tonight-name') ? link.querySelector('.tonight-name').textContent.trim() : null,
          restaurant: link.querySelector('.tonight-meta') ? link.querySelector('.tonight-meta').textContent.trim() : null,
          price: link.querySelector('.tonight-price') ? link.querySelector('.tonight-price').textContent.trim() : null,
          href: link.getAttribute('href'),
          labels: [...link.querySelectorAll('.tonight-tag, .open-label')].map((label) => label.textContent.trim()),
        })),
        seasons: [...document.querySelectorAll('[data-season]')].map((tile) => tile.getAttribute('data-season')),
      };
    })()`);
    homeState[moment.id] = state;

    check(
      `BE-29 ${moment.id}: de sectie staat er met de juiste titel en het juiste moment`,
      Boolean(state.meal) && state.meal === moment.meal && state.mode === moment.mode
        && (state.title || '').includes(moment.title),
      JSON.stringify({ meal: state.meal, mode: state.mode, title: state.title, cards: state.cards.length })
    );

    check(`BE-29 ${moment.id}: precies drie echte gerechten met prijs`, state.cards.length === 3 && state.cards.every((card) => card.price && !/op aanvraag/i.test(card.price)), JSON.stringify(state.cards.map((card) => card.price)));
    check(
      `BE-29 ${moment.id}: hooguit één gerecht per restaurant`,
      new Set(state.cards.map((card) => card.restaurant)).size === state.cards.length,
      JSON.stringify(state.cards.map((card) => card.restaurant))
    );
    check(
      `BE-29 ${moment.id}: de klik opent de menukaart op het gerecht`,
      state.cards.every((card) => /\/menu\/[^?]+\?dish=.*#gerecht-/.test(card.href || '')),
      JSON.stringify(state.cards.map((card) => card.href))
    );

    check(
      `BE-29 ${moment.id}: seizoenstegels alleen met echte zoekresultaten (mosselen, wild, pompoen in oktober)`,
      state.seasons.length === 3 && ['mosselen', 'wild', 'pompoen'].every((id) => state.seasons.includes(id)),
      JSON.stringify(state.seasons)
    );
  }

  // De server-HTML mag geen moment-, open- of daghapinhoud bevatten: die
  // bepaalt de browser na het laden.
  const html = await (await fetch(`${APP}/`)).text();
  check('BE-29: geen "Nu open" in de server-HTML van de home', !html.includes('Nu open'));
  check('BE-29: geen daghap in de server-HTML van de home', !html.includes('Daghap') && !html.includes('Dagschotel'));
  check('BE-29: geen moment-sectie in de server-HTML van de home', !html.includes('tonight-section') && !html.includes('seizoen-title'));

  // Een tik op een gerecht landt op de menukaart, gemarkeerd.
  const dinerCard = homeState.diner.cards[0];
  if (!dinerCard || !dinerCard.href) {
    check('BE-29: er is een dinergerecht om naar de menukaart te volgen', false, 'no diner card');
    return;
  }
  await applyTheme(cdp, 'light');
  await setViewport(cdp, 390, 820);
  await open(cdp, `${APP}${dinerCard.href}`, `document.querySelector('.menu-card-highlighted') !== null`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const marked = await evalJs(cdp, `(() => {
    const el = document.querySelector('.menu-card-highlighted');
    return {
      id: el ? el.id : null,
      hash: decodeURIComponent(location.hash),
      name: el && el.querySelector('.td-name') ? el.querySelector('.td-name').textContent.trim() : null,
    };
  })()`);
  await shot(cdp, 'be29-menu-marked-light-390.png', { fullPage: true });
  check(
    'BE-29: de menukaart opent op hetzelfde gerecht en markeert het',
    Boolean(marked.id) && marked.hash === `#${marked.id}` && marked.name === dinerCard.name,
    JSON.stringify({ marked, expected: dinerCard.name })
  );

  await applyTheme(cdp, 'dark');
  await setViewport(cdp, 390, 820);
  await open(cdp, `${APP}${dinerCard.href}`, `document.querySelector('.menu-card-highlighted') !== null`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await shot(cdp, 'be29-menu-marked-dark-390.png', { fullPage: true });
  await applyTheme(cdp, 'light');
  await setViewport(cdp, 1280, 900);
  await open(cdp, `${APP}${dinerCard.href}`, `document.querySelector('.menu-card-highlighted') !== null`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await shot(cdp, 'be29-menu-marked-light-1280.png', { fullPage: true });

  // /restaurants is uitgefaseerd: permanente 308 naar /alle-restaurants,
  // met behoud van een bestaande zoekterm.
  const redirect = await fetch(`${APP}/restaurants`, { redirect: 'manual' });
  check('BE-29: /restaurants geeft een permanente 308', redirect.status === 308, `${redirect.status} ${redirect.headers.get('location') || ''}`);
  check(
    'BE-29: de 308 wijst naar /alle-restaurants',
    (redirect.headers.get('location') || '').endsWith('/alle-restaurants'),
    redirect.headers.get('location') || 'geen location'
  );
  const withQuery = await fetch(`${APP}/restaurants?q=bardot`, { redirect: 'manual' });
  const location = withQuery.headers.get('location') || '';
  check('BE-29: de 308 behoudt de zoekterm q=bardot', withQuery.status === 308 && /\/alle-restaurants\?q=bardot$/.test(location), `${withQuery.status} ${location}`);

  await setFixedClock(cdp, null);
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
    const alle = await measureAlleRestaurantsTransfer(cdp, meter);
    console.log(`/alle-restaurants transfer (${LABEL}): ${alle.totalKb} KB over ${alle.resourceCount} requests`);

    if (!TRANSFER_ONLY) {
      contrast = await contrastScenario(cdp);
      contrast.alleRestaurants = await alleRestaurantsContrastScenario(cdp);
      await pageScenario(cdp, { name: 'home', url: `${APP}/`, ready: `document.querySelector('.home-hero') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'search-results', url: `${APP}/search?q=pasta`, ready: `document.querySelectorAll('.dish-result-card-row').length > 0`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'alle-restaurants', url: `${APP}/alle-restaurants`, ready: `document.querySelector('.ar-card') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'restaurant-with-menu', url: `${APP}/restaurant/6`, ready: `document.querySelector('.detail-name') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'restaurant-without-menu', url: `${APP}/restaurant/2`, ready: `document.querySelector('.detail-name') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'menu', url: `${APP}/menu/6-diner`, ready: `document.querySelector('.td-price') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'claim', url: `${APP}/claim/6`, ready: `document.querySelector('.claim-title') !== null`, widths: [1280, 390, 320] });
      await pageScenario(cdp, { name: 'nvwa', url: `${APP}/nvwa/6`, ready: `document.querySelector('.nvwa-title') !== null`, widths: [1280, 390, 320] });
      await searchCardScenario(cdp);
      await alleRestaurantsScenario(cdp);
      await nvwaLayoutScenario(cdp);
      await be29Scenario(cdp);
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

