'use strict';

// BE-37 (#89) — kwaliteitscheck van de nieuwe stijl: contrast, overdracht,
// toetsenbord/schermlezer, telefoon en slordigheden.
//
// Twee fasen, met hetzelfde script en dezelfde metingen, zodat "voor" en "na"
// eerlijk vergelijkbaar zijn:
//
//   1) publiek  — de echte productiebuild (`next start`, koude cache) voor de
//      overdrachtsmeting van `/`, `/alle-restaurants`, `/restaurant/[id]` en
//      `/menu/[id]`, plus contrast, overloop, tikvlakken, toetsenbord en
//      screenshots op 1280, 390 en 320 px in licht en donker;
//   2) intern   — een lokale `next dev` met een fictieve in-page sessie en
//      fictieve API-antwoorden (de bestaande fixtures en het bestaande
//      netwerkbeleid) voor Dekking, Bronnen beoordelen, Toevoegen en Menu
//      importeren, met dezelfde metingen.
//
// De interne fase is FIXTURE-EVIDENTIE: geen productie-identiteit, -sessie of
// -data. De publieke fase is developer-evidence op een lokale build. Geen van
// beide is onafhankelijke review of productieacceptatie.
//
// Gebruik:
//   node node_modules/next/dist/bin/next build
//   node ops/browser/run-kwaliteit-browser-check.js --label voor
//   node ops/browser/run-kwaliteit-browser-check.js --label na
//
// Opties: --label <naam> (voor|na), --phase <public|internal|all>,
// `PUBLIC_ONLY=1`/`INTERNAL_ONLY=1` zijn niet nodig: gebruik --phase.
// De uitkomst staat in `ops/browser/evidence/kwaliteit-<label>.json`, de
// screenshots in `ops/browser/evidence/be-37/<label>/`.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const fixtures = require('./fixtures/menuReviewFixtures');
const { SCENARIOS: BRONNEN_SCENARIOS, BATCH_ID } = require('./fixtures/bronnenFixtures');
const { fixtureBootstrap } = require('./lib/fixture-page');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  REPO_ROOT,
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  pressKey,
} = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');

const OUT_DIR = path.join(__dirname, 'output', 'be-37');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 && args[index + 1] ? args[index + 1] : fallback;
};
const LABEL = option('label', 'na');
const PHASE = option('phase', 'all');
const PUBLIC_PORT = Number(process.env.BE37_PUBLIC_PORT || 3146);
const INTERNAL_PORT = Number(process.env.BE37_INTERNAL_PORT || 3147);
const PUBLIC_APP = `http://localhost:${PUBLIC_PORT}`;
const INTERNAL_APP = `http://localhost:${INTERNAL_PORT}`;
const INTERNAL_ORIGINS = defaultAppOrigins(INTERNAL_PORT);
const INTERNAL_START = `${INTERNAL_APP}/internal/bronnen`;
const SHOTS_DIR = path.join(EVIDENCE_DIR, 'be-37', LABEL);
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, `kwaliteit-${LABEL}.json`);
const FIXTURES = { ...fixtures.scenarios, ...BRONNEN_SCENARIOS };

// Dezelfde pagina's als het bouwcontract: vijf publieke en vier interne.
const PUBLIC_PAGES = [
  { id: 'home', path: '/', ready: `document.querySelector('.home-hero, .hero-search, .home-search') !== null` },
  { id: 'zoeken', path: '/search?q=pizza', ready: `document.querySelector('.search-input') !== null` },
  { id: 'alle-restaurants', path: '/alle-restaurants', ready: `document.querySelectorAll('.ar-card, .lrc-card').length > 0` },
  { id: 'restaurant', path: '/restaurant/6', ready: `document.querySelector('.detail-name') !== null` },
  { id: 'menu', path: '/menu/6-diner', ready: `document.querySelector('.td-price') !== null` },
];

const INTERNAL_PAGES = [
  {
    id: 'dekking',
    url: (theme) => `${INTERNAL_APP}/internal/coverage?theme=${theme}&fixture=bronnen&navCounts=bronnen`,
    ready: `document.body.innerText.includes('Nog niet gecontroleerd')`,
  },
  {
    id: 'bronnen',
    url: (theme) => `${INTERNAL_APP}/internal/bronnen?theme=${theme}&fixture=bronnen&navCounts=bronnen`,
    ready: `document.querySelectorAll('.brn-task').length === 3`,
  },
  {
    id: 'toevoegen',
    url: (theme) => `${INTERNAL_APP}/internal/toevoegen?theme=${theme}&fixture=bronnenToevoegen&navCounts=bronnen&batch=${BATCH_ID}`,
    ready: `document.body.innerText.includes('Restaurant of menu toevoegen')`,
  },
  {
    id: 'menu-import',
    url: (theme) =>
      `${INTERNAL_APP}/internal/menu-import?fixture=manual&restaurant=${encodeURIComponent(fixtures.RESTAURANT.id)}` +
      `&name=${encodeURIComponent(fixtures.RESTAURANT.name)}&url=https%3A%2F%2Ffictief-brasserie.invalid%2Fmenu&aiState=off&theme=${theme}`,
    ready: `document.body.innerText.includes('Menu importeren met AI')`,
  },
];

const WIDTHS = [1280, 390, 320];
const THEMES = ['light', 'dark'];

const checks = [];
const shots = [];
const transfer = [];
const contrast = [];
const layout = [];
const keyboard = [];
const dialogs = [];
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  const entry = { name, passed: Boolean(passed), detail: detail === undefined || detail === null ? null : String(detail) };
  checks.push(entry);
  console.log(`${entry.passed ? 'ok  ' : 'FAIL'} ${name}${entry.detail ? ` — ${entry.detail}` : ''}`);
  return entry.passed;
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return null;
  }
}

function short(entry) {
  return {
    selector: entry.selector,
    text: entry.text || null,
    fg: entry.fg,
    bg: entry.bg,
    ratio: entry.ratio,
  };
}

// ── contrast, randen en emoji uit de echte berekende stijlen ────────────────
// Dezelfde kleurwiskunde als de bestaande checks (WCAG 2.x relatieve
// luminantie), maar gemeten op elke zichtbare tekst in de pagina in plaats van
// op een handvol bekende selectors: alleen zo vind je wat het echt niet haalt.
const AUDIT_JS = `(() => {
  const results = { theme: document.documentElement.getAttribute('data-theme'), path: location.pathname + location.search, texts: [], borders: [], emoji: [] };
  const parse = (value) => {
    const m = String(value || '').match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
  const lum = (c) => {
    const v = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const bgOf = (el) => {
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.unshift(node);
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const node of chain) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.001) acc = c.a >= 1 ? { ...c, a: 1 } : blend(c, acc);
    }
    return acc;
  };
  const selectorOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (Number(style.opacity) < 0.1) return false;
    if (el.closest('[hidden]')) return false;
    return true;
  };
  const ownText = (el) => [...el.childNodes]
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join(' ')
    .replace(/\\s+/g, ' ')
    .trim();

  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"]')) continue;
    const value = ownText(el);
    if (!value) continue;
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const raw = parse(style.color);
    if (!raw) continue;
    const bg = bgOf(el);
    const fg = raw.a < 1 ? blend(raw, bg) : raw;
    const size = parseFloat(style.fontSize) || 16;
    const weight = Number(style.fontWeight) || 400;
    results.texts.push({
      selector: selectorOf(el),
      text: value.slice(0, 60),
      fg: hex(fg),
      bg: hex(bg),
      ratio: ratio(fg, bg),
      size,
      large: size >= 24 || (size >= 18.66 && weight >= 700),
      disabled: Boolean(el.closest(':disabled')),
    });
  }

  // Randen van bedieningselementen: een veld of knop moet herkenbaar zijn
  // (>= 3:1), ook als er geen tekst in staat.
  const CONTROL = 'input:not([type="hidden"]), select, textarea, button, [role="button"], summary, [class*="btn"], [class*="chip"], [class*="field"], [class*="search"], [class*="select"], [class*="toggle"]';
  for (const el of document.querySelectorAll(CONTROL)) {
    if (!visible(el)) continue;
    if (el.closest(':disabled')) continue;
    const style = getComputedStyle(el);
    const width = parseFloat(style.borderTopWidth) || 0;
    if (width < 1) continue;
    const color = parse(style.borderTopColor);
    if (!color || color.a < 0.05) continue;
    const bg = bgOf(el);
    const solid = color.a < 1 ? blend(color, bg) : color;
    results.borders.push({
      selector: selectorOf(el),
      color: hex(solid),
      bg: hex(bg),
      ratio: ratio(solid, bg),
      width,
    });
  }

  // Decoratieve emoji buiten een aria-hidden-element: een schermlezer leest
  // die anders voor ("vergrootglas", "sparkles"). Pijlen (→) zijn typografie,
  // geen emoji, en tellen hier niet mee.
  const EMOJI = /[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]/u;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const value = node.textContent || '';
    if (!EMOJI.test(value)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('[aria-hidden="true"]')) continue;
    if (!visible(parent)) continue;
    results.emoji.push({ selector: selectorOf(parent), text: value.replace(/\\s+/g, ' ').trim().slice(0, 60) });
  }
  return results;
})()`;

// ── overloop en tikvlakken ──────────────────────────────────────────────────
const LAYOUT_JS = `(() => {
  const doc = document.documentElement;
  const clientWidth = doc.clientWidth;
  const overflow = Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - clientWidth;
  const selectorOf = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.right <= clientWidth + 1) continue;
    wide.push({
      selector: selectorOf(el),
      parent: el.parentElement ? selectorOf(el.parentElement) : null,
      right: Math.round(rect.right),
      width: Math.round(rect.width),
    });
  }
  const tap = [];
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue;
    if (el.matches(':disabled')) continue;
    // WCAG 2.5.5: een link midden in een lopende zin is uitgezonderd; die
    // krijgt zijn tikvlak van de regel eromheen. Een inline-link dus, en geen
    // knop of chip die toevallig in een <span> zit.
    const inlineInProse = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (inlineInProse) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height >= 44 && rect.width >= 44) continue;
    tap.push({
      selector: selectorOf(el),
      text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 50),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      left: Math.round(rect.left),
    });
  }
  return {
    clientWidth,
    overflow,
    wide: wide.slice(0, 12),
    wideCount: wide.length,
    tap: tap.slice(0, 40),
    tapCount: tap.length,
  };
})()`;

// ── zichtbare focus: echte Tab-stappen, net als een toetsenbordgebruiker ────
const TABBABLE_JS = `(() => {
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const list = [];
  let index = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    if (el.matches(':disabled')) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    // De dev-overlay van Next.js is geen deel van de app.
    if (el.closest('nextjs-portal')) continue;
    el.setAttribute('data-be37-tab', String(index));
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    list.push({
      index,
      selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls,
      text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    });
    index += 1;
  }
  return list;
})()`;

const FOCUS_JS = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  if (el.closest && el.closest('nextjs-portal')) return null;
  const style = getComputedStyle(el);
  const parse = (value) => {
    const m = String(value || '').match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
  const lum = (c) => {
    const v = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const bgOf = (node) => {
    const chain = [];
    for (let current = node; current; current = current.parentElement) chain.unshift(current);
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const current of chain) {
      const c = parse(getComputedStyle(current).backgroundColor);
      if (c && c.a > 0.001) acc = c.a >= 1 ? { ...c, a: 1 } : blend(c, acc);
    }
    return acc;
  };
  const outlineWidth = parseFloat(style.outlineWidth) || 0;
  const outlineColor = parse(style.outlineColor);
  const hasOutline = style.outlineStyle !== 'none' && outlineWidth >= 1 && Boolean(outlineColor) && outlineColor.a > 0.05;
  const shadow = String(style.boxShadow || '');
  // Een inset-schaduw is opmaak (een actieve chip), geen focusring.
  const ownShadow = shadow && shadow !== 'none' && shadow.indexOf('inset') === -1 ? parse(shadow) : null;
  let ring = hasOutline ? outlineColor : ownShadow;
  let ringOwner = el;
  if (!ring) {
    // Een veld binnen een focus-within-omhulsel toont zijn ring op de ouder;
    // dat is net zo zichtbaar, dus het telt mee.
    let node = el.parentElement;
    for (let depth = 0; node && depth < 3; depth += 1, node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      const width = parseFloat(nodeStyle.outlineWidth) || 0;
      const color = parse(nodeStyle.outlineColor);
      if (nodeStyle.outlineStyle !== 'none' && width >= 1 && color && color.a > 0.05) {
        ring = color;
        ringOwner = node;
        break;
      }
      const nodeShadow = String(nodeStyle.boxShadow || '');
      if (nodeShadow && nodeShadow !== 'none' && nodeShadow.indexOf('inset') === -1) {
        const color2 = parse(nodeShadow);
        if (color2) {
          ring = color2;
          ringOwner = node;
          break;
        }
      }
    }
  }
  // Een outline met offset valt buiten het element: de ring ligt dus op de
  // achtergrond van de ouder, niet op die van het element zelf.
  const bg = bgOf(ringOwner.parentElement || ringOwner);
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
  return {
    tag: el.tagName,
    tab: el.getAttribute('data-be37-tab'),
    selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls,
    text: (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
    focusVisible: el.matches(':focus-visible'),
    hasRing: Boolean(ring),
    ring: ring ? hex(ring.a < 1 ? blend(ring, bg) : ring) : null,
    bg: hex(bg),
    ratio: ring ? ratio(ring.a < 1 ? blend(ring, bg) : ring, bg) : 0,
  };
})()`;

// ── server, viewport, thema en screenshots ─────────────────────────────────
function startProductionServer({ port, appUrl, outputDir, tag }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const log = fs.createWriteStream(path.join(outputDir, `next-start-${tag}.log`));
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
  };
  // Zelfde afweging als `lib/runtime.startServer`: npm is op deze runner niet
  // aanwezig, dus dezelfde `next start` loopt via node. Alleen de manier van
  // starten verschilt; commando, env en log niet.
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmAvailable =
    spawnSync(npm, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = npmAvailable
    ? spawn(npm, ['run', 'start', '--', '-p', String(port)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
      })
    : spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
      });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return waitForHttp(`${appUrl}/`, 120000).then(() => child);
}

async function setViewport(cdp, width) {
  viewport = { width, height: width >= 1280 ? 900 : 844 };
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function shot(cdp, name, meta = {}) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.max(1, Math.min(viewport.width, Math.ceil(content.width)));
  const wholePage = viewport.width >= 720;
  const height = wholePage ? Math.min(6000, Math.ceil(content.height)) : viewport.height;
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: wholePage,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const buffer = Buffer.from(result.data, 'base64');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOTS_DIR, name), buffer);
  const entry = {
    file: path.relative(REPO_ROOT, path.join(SHOTS_DIR, name)).replace(/\\/g, '/'),
    bytes: buffer.length,
    width,
    height,
    viewport: `${viewport.width}x${viewport.height}`,
    ...meta,
  };
  shots.push(entry);
  return entry;
}

async function openWithTheme(cdp, url, theme, ready) {
  await navigate(cdp, url, `document.readyState !== 'loading'`);
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', '${theme}')`);
  await navigate(cdp, url, ready);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

// ── de drie metingen ────────────────────────────────────────────────────────
async function auditContrast(cdp, page, theme, width) {
  const measured = await evalJs(cdp, AUDIT_JS);
  const texts = measured.texts.filter((entry) => !entry.disabled);
  const failing = texts.filter((entry) => entry.ratio < 4.5);
  const worst = [...texts].sort((a, b) => a.ratio - b.ratio)[0] || null;
  const borders = measured.borders.filter((entry) => entry.ratio < 3);
  const record = {
    page: page.id,
    theme,
    width,
    measuredTheme: measured.theme,
    texts: texts.length,
    textMin: worst ? worst.ratio : null,
    textMinEntry: worst ? short(worst) : null,
    textFailures: failing.slice(0, 12).map(short),
    textFailureCount: failing.length,
    borderMin: measured.borders.length ? Math.min(...measured.borders.map((entry) => entry.ratio)) : null,
    borderFailures: borders.slice(0, 12).map((entry) => ({ ...short(entry), width: entry.width })),
    borderFailureCount: borders.length,
    emoji: measured.emoji.slice(0, 20),
  };
  contrast.push(record);
  check(
    `contrast ${page.id} ${theme} ${width}px: every visible text >= 4.5:1`,
    failing.length === 0,
    failing.length === 0
      ? `minimum ${record.textMin}:1`
      : `${failing.length} below 4.5:1, worst ${JSON.stringify(short(failing[0]))}`,
  );
  check(
    `contrast ${page.id} ${theme} ${width}px: control borders >= 3:1`,
    borders.length === 0,
    borders.length === 0 ? 'ok' : JSON.stringify(borders.slice(0, 3)),
  );
  check(
    `emoji ${page.id} ${theme} ${width}px: every decorative emoji is aria-hidden`,
    measured.emoji.length === 0,
    measured.emoji.length === 0 ? 'ok' : JSON.stringify(measured.emoji.slice(0, 3)),
  );
  return record;
}

async function auditLayout(cdp, page, theme, width) {
  const measured = await evalJs(cdp, LAYOUT_JS);
  layout.push({ page: page.id, theme, width, ...measured });
  check(
    `phone ${page.id} ${theme} ${width}px: no horizontal overflow`,
    measured.overflow <= 0,
    `overflow=${measured.overflow}${measured.wide.length ? ` e.g. ${JSON.stringify(measured.wide.slice(0, 3))}` : ''}`,
  );
  // De 44px-eis hoort bij het bouwcontract bij de telefoon (320/390 px). Op
  // desktop wordt dezelfde lijst wel vastgelegd, maar niet als fout geteld.
  if (width < 720) {
    check(
      `tap ${page.id} ${theme} ${width}px: every tap target >= 44px`,
      measured.tapCount === 0,
      measured.tapCount === 0 ? 'ok' : `${measured.tapCount} too small, e.g. ${JSON.stringify(measured.tap.slice(0, 3))}`,
    );
  }
  return measured;
}

async function auditKeyboard(cdp, page, theme, width) {
  const tabbable = await evalJs(cdp, TABBABLE_JS);
  await evalJs(cdp, `(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return true; })()`);
  const steps = [];
  const limit = Math.min(60, tabbable.length + 4);
  for (let index = 0; index < limit; index += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const info = await evalJs(cdp, FOCUS_JS);
    if (!info) break;
    steps.push(info);
  }
  await evalJs(cdp, `(() => { for (const el of document.querySelectorAll('[data-be37-tab]')) el.removeAttribute('data-be37-tab'); return true; })()`);
  const reached = new Set(steps.map((step) => step.tab).filter((value) => value !== null));
  const unreached = tabbable.filter((entry) => !reached.has(String(entry.index)));
  const withoutRing = steps.filter((step) => !step.hasRing);
  const dimRing = steps.filter((step) => step.hasRing && step.ratio < 3);
  const record = {
    page: page.id,
    theme,
    width,
    tabbable: tabbable.length,
    steps: steps.length,
    unreached: unreached.slice(0, 10),
    unreachedCount: unreached.length,
    withoutRing: withoutRing.slice(0, 10),
    withoutRingCount: withoutRing.length,
    dimRing: dimRing.slice(0, 10),
    dimRingCount: dimRing.length,
    ringMin: steps.filter((step) => step.hasRing).length
      ? Math.min(...steps.filter((step) => step.hasRing).map((step) => step.ratio))
      : null,
  };
  keyboard.push(record);
  check(
    `keyboard ${page.id} ${theme} ${width}px: every control is reachable with Tab`,
    unreached.length === 0,
    unreached.length === 0 ? `${tabbable.length} controls` : JSON.stringify(unreached.slice(0, 3)),
  );
  check(
    `keyboard ${page.id} ${theme} ${width}px: every tab stop has a visible focus ring`,
    withoutRing.length === 0,
    withoutRing.length === 0 ? `${steps.length} stops` : JSON.stringify(withoutRing.slice(0, 3)),
  );
  check(
    `keyboard ${page.id} ${theme} ${width}px: every focus ring >= 3:1`,
    dimRing.length === 0,
    dimRing.length === 0 ? `minimum ${record.ringMin}:1` : JSON.stringify(dimRing.slice(0, 3)),
  );
  return record;
}

// ── overdracht: koude laad, productiebuild, donker, 1280 px ────────────────
function attachNetworkMeter(cdp, appUrl) {
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
        biggest: [...finished]
          .sort((a, b) => b.bytes - a.bytes)
          .slice(0, 8)
          .map((entry) => ({ url: entry.url.replace(appUrl, ''), type: entry.type, bytes: entry.bytes })),
      };
    },
  };
}

async function measureTransfer(cdp, meter, page) {
  await openWithTheme(cdp, `${PUBLIC_APP}${page.path}`, 'dark', page.ready);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await navigate(cdp, `${PUBLIC_APP}${page.path}`, page.ready);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const summary = meter.summary();
  transfer.push({ label: LABEL, page: page.path, theme: 'dark', viewport: '1280x900', ...summary });
  check(
    `transfer ${page.path}: initial transfer < 250 KB`,
    summary.totalKb < 250,
    `${summary.totalKb} KB (document ${Math.round((summary.documentBytes || 0) / 1024)} KB, ${summary.resourceCount} requests)`,
  );
  return summary;
}

async function safeStep(label, run) {
  try {
    await run();
    return true;
  } catch (error) {
    check(`${label}: the page could be measured`, false, String((error && error.message) || error).slice(0, 240));
    return false;
  }
}

// ── fase 1: publieke pagina's op de productiebuild ──────────────────────────
async function runPublicPhase(cdp) {
  const meter = attachNetworkMeter(cdp, PUBLIC_APP);
  await cdp.send('Network.enable');
  await setViewport(cdp, 1280);
  for (const page of PUBLIC_PAGES.filter((entry) => ['/', '/alle-restaurants', '/restaurant/6', '/menu/6-diner'].includes(entry.path))) {
    console.log(`overdracht: ${page.path}`);
    await measureTransfer(cdp, meter, page);
  }
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const page of PUBLIC_PAGES) {
        console.log(`publiek: ${page.id} ${theme} ${width}`);
        await safeStep(`publiek ${page.id} ${theme} ${width}px`, async () => {
          await setViewport(cdp, width);
          await openWithTheme(cdp, `${PUBLIC_APP}${page.path}`, theme, page.ready);
          await auditContrast(cdp, page, theme, width);
          await auditLayout(cdp, page, theme, width);
          await shot(cdp, `${page.id}-${width}-${theme}.png`, { page: page.id, theme, width, phase: 'public' });
        });
      }
    }
  }

  for (const theme of THEMES) {
    for (const width of [1280, 320]) {
      for (const page of PUBLIC_PAGES) {
        console.log(`toetsenbord: ${page.id} ${theme} ${width}`);
        await safeStep(`toetsenbord ${page.id} ${theme} ${width}px`, async () => {
          await setViewport(cdp, width);
          await openWithTheme(cdp, `${PUBLIC_APP}${page.path}`, theme, page.ready);
          await auditKeyboard(cdp, page, theme, width);
        });
      }
    }
  }
}

// ── fase 2: interne pagina's met de bestaande fictieve sessie ───────────────
async function runInternalPhase(cdp) {
  // Warm-up: de route en de API's compileren, zodat de metingen daarna niet de
  // eerste compilatie van een dev-server meten.
  await setViewport(cdp, 1280);
  await navigate(cdp, INTERNAL_PAGES[1].url('light'), INTERNAL_PAGES[1].ready);
  await waitFor(cdp, `document.querySelectorAll('.brn-task').length === 3`, 120000);

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      for (const page of INTERNAL_PAGES) {
        console.log(`intern: ${page.id} ${theme} ${width}`);
        await safeStep(`intern ${page.id} ${theme} ${width}px`, async () => {
          await setViewport(cdp, width);
          await navigate(cdp, page.url(theme), `document.readyState !== 'loading'`);
          await waitFor(cdp, page.ready, 60000);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await auditContrast(cdp, page, theme, width);
          await auditLayout(cdp, page, theme, width);
          await shot(cdp, `${page.id}-${width}-${theme}.png`, { page: page.id, theme, width, phase: 'internal' });
        });
      }
    }
  }

  for (const theme of THEMES) {
    for (const width of [1280, 320]) {
      for (const page of INTERNAL_PAGES) {
        console.log(`toetsenbord: ${page.id} ${theme} ${width}`);
        await safeStep(`toetsenbord ${page.id} ${theme} ${width}px`, async () => {
          await setViewport(cdp, width);
          await navigate(cdp, page.url(theme), `document.readyState !== 'loading'`);
          await waitFor(cdp, page.ready, 60000);
          await new Promise((resolve) => setTimeout(resolve, 400));
          await auditKeyboard(cdp, page, theme, width);
        });
      }
    }
  }

  // De enige dialoog van de app: "Oude resultaten opruimen" in Bronnen
  // beoordelen. Sluit hij met Escape en komt de focus terug bij de knop die
  // hem opende?
  for (const theme of THEMES) {
    await setViewport(cdp, 1280);
    await navigate(cdp, INTERNAL_PAGES[1].url(theme), INTERNAL_PAGES[1].ready);
    await waitFor(cdp, `document.querySelectorAll('.brn-task').length === 3`, 45000);
    const opened = await evalJs(cdp, `(() => {
      const button = document.querySelector('.brn-toolbar button');
      if (!button) return null;
      const label = button.innerText.replace(/\\s+/g, ' ').trim();
      button.click();
      return label;
    })()`);
    const appeared = await waitFor(cdp, `document.querySelector('[role="alertdialog"]') !== null`, 15000);
    check(`dialoog ${theme}: the cleanup confirmation asks before it closes results`, appeared, opened || 'no trigger');
    if (!appeared) continue;
    const focusIn = await evalJs(cdp, `(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      if (!dialog) return { inDialog: false, active: null };
      const active = document.activeElement;
      return {
        inDialog: Boolean(active && dialog.contains(active)),
        active: active ? (active.innerText || active.getAttribute('aria-label') || active.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
      };
    })()`);
    check(`dialoog ${theme}: focus starts inside the dialog`, focusIn.inDialog, JSON.stringify(focusIn));
    await shot(cdp, `dialoog-${theme}.png`, { page: 'bronnen-dialoog', theme, width: 1280, phase: 'internal' });
    await pressKey(cdp, 'Escape', 'Escape', 27);
    const closed = await waitFor(cdp, `document.querySelector('[role="alertdialog"]') === null`, 5000);
    const returned = await evalJs(cdp, `(() => {
      const active = document.activeElement;
      const button = document.querySelector('.brn-toolbar button');
      return {
        active: active ? (active.innerText || active.getAttribute('aria-label') || active.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
        backOnTrigger: Boolean(active && button && (active === button || button.contains(active))),
      };
    })()`);
    dialogs.push({ theme, trigger: opened, closedWithEscape: closed, focusReturned: returned.backOnTrigger, focusAfterEscape: returned.active });
    check(`dialoog ${theme}: Escape closes the dialog`, closed, `active after Escape: ${returned.active}`);
    check(`dialoog ${theme}: Escape returns focus to the button that opened it`, returned.backOnTrigger, JSON.stringify(returned));
  }
}

// ── bewijs ─────────────────────────────────────────────────────────────────
function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const record = {
    generatedAt: new Date().toISOString(),
    kind: 'browser-quality-check',
    task: 'BE-37 (#89) kwaliteitscheck van de nieuwe stijl (contrast, snelheid, toetsenbord, telefoon, slordigheden)',
    contract: 'planning/specs/tickets/be-37-quality-check.md + GitHub issue #89',
    label: LABEL,
    phase: PHASE,
    head: headSha(),
    branch: (() => {
      try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
      } catch {
        return null;
      }
    })(),
    evidence: 'developer evidence op een lokale build; de interne fase is fixture-evidence zonder productie-identiteit, -sessie of -data',
    screenshotsDir: path.relative(REPO_ROOT, SHOTS_DIR).replace(/\\/g, '/'),
    transferTargetKb: 250,
    screenshots: shots,
    transfer,
    contrast,
    layout,
    keyboard,
    dialogs,
    checks,
    ...extra,
  };
  record.passed = checks.length > 0 && checks.every((entry) => entry.passed);
  record.failed = checks.filter((entry) => !entry.passed);
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

function summarise() {
  const failed = checks.filter((entry) => !entry.passed);
  const minimaByPage = {};
  for (const entry of contrast) {
    const key = `${entry.page}/${entry.theme}`;
    const current = minimaByPage[key];
    if (!current || (entry.textMin !== null && entry.textMin < current.textMin)) {
      minimaByPage[key] = { textMin: entry.textMin, borderMin: entry.borderMin, entry: entry.textMinEntry };
    }
  }
  return {
    label: LABEL,
    phase: PHASE,
    head: headSha(),
    passed: failed.length === 0,
    checks: checks.length,
    failed: failed.length,
    failedChecks: failed.map((entry) => entry.name),
    transfer: transfer.map((entry) => ({ page: entry.page, totalKb: entry.totalKb, biggest: entry.biggest[0] || null })),
    contrastMinima: minimaByPage,
    screenshots: shots.length,
    evidence: path.relative(REPO_ROOT, EVIDENCE_PATH).replace(/\\/g, '/'),
  };
}

async function main() {
  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (40 min)' });
    } catch {
      // Best effort inside the watchdog.
    }
    process.exit(2);
  }, 40 * 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let publicServer = null;
  let internalServer = null;
  let browser = null;
  let cdp = null;
  try {
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    if (PHASE === 'public' || PHASE === 'all') {
      console.log('fase 1: productiebuild starten');
      publicServer = await startProductionServer({
        port: PUBLIC_PORT,
        appUrl: PUBLIC_APP,
        outputDir: OUT_DIR,
        tag: 'public',
      });
      await runPublicPhase(cdp);
      killTree(publicServer);
      publicServer = null;
    }

    if (PHASE === 'internal' || PHASE === 'all') {
      console.log('fase 2: dev-server met de fictieve sessie starten');
      internalServer = await startServer({
        port: INTERNAL_PORT,
        appUrl: INTERNAL_APP,
        outputDir: OUT_DIR,
        readyPath: '/internal/login',
      });
      const networkGuard = createNetworkGuard({ appOrigins: INTERNAL_ORIGINS, baseUrl: INTERNAL_START });
      await enableFetchGuard(cdp, networkGuard);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: fixtureBootstrap(FIXTURES, { appOrigins: INTERNAL_ORIGINS, baseUrl: INTERNAL_START }),
      });
      await runInternalPhase(cdp);
      const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
      check('network guard: the page recorded no blocked app traffic', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
      const guardViolations = networkGuard.appViolations();
      check('network guard: the CDP layer recorded no blocked app traffic', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
      const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
      check('no fixture bootstrap error at the end', !bootError, bootError || 'ok');
      killTree(internalServer);
      internalServer = null;
    }

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence();
    console.log(JSON.stringify(summarise(), null, 2));
    if (!record.passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (publicServer) killTree(publicServer);
    if (internalServer) killTree(internalServer);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel blijft buiten de repository.
      }
    }
  }
}

main();
