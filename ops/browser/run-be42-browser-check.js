'use strict';

// BE-42 (#98) — browsercheck voor deel 1 (1A + 3B) en deel 2 (2A).
//
// Start de echte productiebuild (`next start`) op een lokale poort, bestuurt
// een lokaal geïnstalleerde Edge/Chrome via CDP (dezelfde runtime als de
// andere ops/browser-checks) en legt vast:
//
//   - /alle-restaurants: geen grote kaartlink en geen CTA meer, de
//     restaurantnaam is de link, elke menukaart is een eigen knop naar
//     /menu/<id>, de tabvolgorde is naam → knoppen, de focus is zichtbaar en
//     elk aanraakvlak is ≥ 44 px; een restaurant zonder menukaart blijft
//     ongewijzigd ("Nog geen menukaart" en "Bekijk restaurant →");
//   - /restaurant/6, /menu/6-diner, /search?q=steak en de home (met vaste
//     klok): het prijsvlak is var(--surface-soft) met var(--text-primary),
//     vet, rechts en ≥ 4,5:1 contrast in licht en donker;
//   - /restaurant/6 (2A): de sectie "Menukaarten" met één tabblad per kaart en
//     het aantal gerechten, de standaardkaart = de eerste in de vaste volgorde
//     (lunch), `?kaart=<id>` als echte serverlinks, wisselen met JavaScript
//     zonder volledige herlaadbeurt, en de bronregel van de gekozen kaart;
//   - de server-HTML zelf (zonder browser): maar één kaart in de HTML, nooit
//     alle kaarten; ook bij een onbekende `?kaart=`;
//   - de koude eerste overdracht van /alle-restaurants, van /restaurant/6 vóór
//     deel 2 (169,9 KB, uit deel 1) en van /restaurant/6 ná 2A (eis < 250 KB);
//   - screenshots van /alle-restaurants, /restaurant/6, /restaurant/6 met een
//     gewisseld tabblad en /restaurant/1 op 1280, 390 en 320 px, in licht en
//     donker.
//
// Bewijs (screenshots + JSON) gaat standaard buiten de repository:
//   node ops/browser/run-be42-browser-check.js --out ../be42-evidence
//
// Dit is developer-evidence in een lokale, geïsoleerde omgeving: geen
// productie, geen echte Supabase-credentials en geen merge/publicatie.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { findBrowser, killTree, startBrowser, evalJs, navigate } = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BE42_PORT || 3152);
const APP = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 && args[index + 1] ? args[index + 1] : fallback;
};
// Buiten git: de opdracht vraagt screenshots buiten de repository.
const OUT_DIR = path.resolve(option('out', path.join(REPO_ROOT, '..', 'be42-evidence')));
const OUT_PATH = path.join(OUT_DIR, 'be42-browser-evidence.json');

const checks = [];
const shots = [];
const transfer = [];
let viewport = { width: 1280, height: 900 };

// BE-42 — de "voor"-meting van /restaurant/6 uit het deel 1-bewijs (koude
// eerste overdracht, zelfde productiebuild en meetmethode). Ná 2A moet die
// onder 250 KB blijven (contract criterium 2).
const TRANSFER_BEFORE_RESTAURANT6_KB = 169.9;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}`);
}


// ── gedeelde meethelpers in de pagina ───────────────────────────────────────
const HELPERS = `
  const parse = (value) => {
    const m = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
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
  const tokens = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;background:var(--surface-soft);color:var(--text-primary)';
    document.body.appendChild(probe);
    const soft = getComputedStyle(probe).backgroundColor;
    const primary = getComputedStyle(probe).color;
    probe.remove();
    return { soft, primary };
  };
`;

// ── 1A: /alle-restaurants ───────────────────────────────────────────────────
const ALLE_JS = `(() => {
  ${HELPERS}
  const card = document.querySelector('article.ar-card');
  if (!card) return { missing: true, cards: document.querySelectorAll('.ar-card').length };
  const nameLink = card.querySelector('a.ar-name-link');
  const buttons = [...card.querySelectorAll('a.ar-menu-button')];
  const focusables = [...card.querySelectorAll('a, button')];
  const t = tokens();
  const buttonStyle = buttons[0] ? getComputedStyle(buttons[0]) : null;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    cards: document.querySelectorAll('.ar-card').length,
    menuCards: document.querySelectorAll('article.ar-card').length,
    noMenuCards: document.querySelectorAll('a.ar-card--nomenu').length,
    bigCtas: document.querySelectorAll('.ar-cta').length,
    cardIsLink: card.tagName === 'A',
    nameIsLink: Boolean(nameLink),
    nameText: card.querySelector('.ar-name') ? card.querySelector('.ar-name').innerText.trim() : null,
    nameHref: nameLink ? nameLink.getAttribute('href') : null,
    ariaLabel: card.querySelector('.ar-menu-buttons') ? card.querySelector('.ar-menu-buttons').getAttribute('aria-label') : null,
    buttons: buttons.map((el) => ({
      label: el.innerText.trim(),
      href: el.getAttribute('href'),
      height: Math.round(el.getBoundingClientRect().height),
    })),
    focusOrder: focusables.map((el) => el.getAttribute('href')),
    noMenu: (() => {
      const el = document.querySelector('.ar-card--nomenu');
      if (!el) return { missing: true };
      return {
        isWholeLink: el.tagName === 'A',
        href: el.getAttribute('href'),
        label: el.querySelector('.ar-nomenu-label') ? el.querySelector('.ar-nomenu-label').innerText.trim() : null,
        restaurantLink: el.querySelector('.ar-restaurant-link') ? el.querySelector('.ar-restaurant-link').innerText.trim() : null,
        extraActions: el.querySelectorAll('.ar-cta, a.ar-menu-button').length,
      };
    })(),
    buttonColors: buttons[0] ? {
      fg: buttonStyle.color,
      bg: buttonStyle.backgroundColor,
      soft: t.soft,
      primary: t.primary,
      ratio: ratio(parse(buttonStyle.color), parse(buttonStyle.backgroundColor)),
      fontWeight: buttonStyle.fontWeight,
    } : null,
    text: card.innerText.replace(/\\s+/g, ' ').trim(),
    overflow: Math.round(document.documentElement.scrollWidth) - Math.round(window.innerWidth),
  };
})()`;

// ── 3B: het prijsvlak op vier pagina's ──────────────────────────────────────
const priceJs = (selector) => `(() => {
  ${HELPERS}
  const el = document.querySelector('${selector}');
  const t = tokens();
  if (!el) return { missing: true, selector: '${selector}', theme: document.documentElement.getAttribute('data-theme') };
  const style = getComputedStyle(el);
  return {
    selector: '${selector}',
    theme: document.documentElement.getAttribute('data-theme'),
    text: el.innerText.trim(),
    fg: style.color,
    bg: style.backgroundColor,
    soft: t.soft,
    primary: t.primary,
    usesSoft: style.backgroundColor === t.soft,
    usesPrimary: style.color === t.primary,
    ratio: ratio(parse(style.color), parse(style.backgroundColor)),
    fontWeight: style.fontWeight,
    rightEdge: Math.round(el.getBoundingClientRect().right),
    containerRight: Math.round((() => {
      const parent = el.parentElement;
      const ps = getComputedStyle(parent);
      return parent.getBoundingClientRect().right
        - parseFloat(ps.paddingRight || '0')
        - parseFloat(ps.borderRightWidth || '0');
    })()),
  };
})()`;

// ── 2A: de hele menukaart in tabbladen op de restaurantpagina ───────────────
// Meet de tabbladen, de actieve kaart, de bronregel en de menupaginalink. De
// gerechten van de gekozen kaart staan in .rpm-panel; er is er altijd precies
// één (zie de server-HTML-check hieronder).
const TABS_JS = `(() => {
  ${HELPERS}
  const tabs = [...document.querySelectorAll('nav.rpm-tabs a')];
  const cards = [...document.querySelectorAll('.rpm-panel .menu-card')];
  const active = tabs.filter((tab) => tab.getAttribute('aria-current') === 'page');
  const source = document.querySelector('.rpm-source');
  const sourceLink = source ? source.querySelector('a') : null;
  const nameOf = (tab) => (tab.firstChild ? String(tab.firstChild.textContent).trim() : '');
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    heading: (() => { const el = document.querySelector('#menukaarten-title'); return el ? el.textContent.trim() : null; })(),
    navLabel: (() => { const el = document.querySelector('nav.rpm-tabs'); return el ? el.getAttribute('aria-label') : null; })(),
    tabs: tabs.map((tab) => {
      const count = tab.querySelector('.rpm-tab-count');
      return {
        name: nameOf(tab),
        count: count ? count.textContent.trim() : null,
        href: tab.getAttribute('href'),
        active: tab.getAttribute('aria-current') === 'page',
        height: Math.round(tab.getBoundingClientRect().height),
      };
    }),
    activeTabs: active.length,
    activeName: active[0] ? nameOf(active[0]) : null,
    panelTitle: (() => { const el = document.querySelector('.rpm-panel-title'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; })(),
    cards: cards.length,
    sections: document.querySelectorAll('.rpm-panel .cat-section').length,
    dishNames: cards.slice(0, 80).map((card) => (card.querySelector('.td-name') ? card.querySelector('.td-name').textContent.trim() : '')),
    prices: [...document.querySelectorAll('.rpm-panel .td-price')].map((el) => el.textContent.trim()),
    source: source ? source.textContent.replace(/\\s+/g, ' ').trim() : null,
    sourceHref: sourceLink ? sourceLink.getAttribute('href') : null,
    menuPageHref: (() => { const el = document.querySelector('a.detail-menu-btn-outline'); return el ? el.getAttribute('href') : null; })(),
    overflow: Math.round(document.documentElement.scrollWidth) - Math.round(window.innerWidth),
  };
})()`;

// Wisselen met JavaScript: klik het borreltabblad aan en kijk of alleen het
// paneel verandert. Een volledige herlaadbeurt zou een tweede
// navigatie-entry in de Performance-tijdlijn zetten.
const SWITCH_JS = `(async () => {
  const before = performance.getEntriesByType('navigation').length;
  const tabs = [...document.querySelectorAll('nav.rpm-tabs a')];
  const link = tabs.find((tab) => /Borrelkaart/.test(tab.textContent));
  if (!link) return { missing: true, tabs: tabs.length };
  const urlBefore = location.pathname + location.search;
  link.click();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const title = document.querySelector('.rpm-panel-title');
    if (title && /Borrelkaart/.test(title.textContent)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const title = document.querySelector('.rpm-panel-title');
  const cards = [...document.querySelectorAll('.rpm-panel .menu-card')];
  const active = document.querySelector('nav.rpm-tabs a[aria-current="page"]');
  return {
    navigationBefore: before,
    navigationEntries: performance.getEntriesByType('navigation').length,
    urlBefore,
    url: location.pathname + location.search,
    panelTitle: title ? title.textContent.replace(/\\s+/g, ' ').trim() : null,
    cards: cards.length,
    firstDish: cards[0] && cards[0].querySelector('.td-name') ? cards[0].querySelector('.td-name').textContent.trim() : null,
    activeName: active && active.firstChild ? String(active.firstChild.textContent).trim() : null,
    source: (() => { const el = document.querySelector('.rpm-source'); return el ? el.textContent.replace(/\\s+/g, ' ').trim() : null; })(),
  };
})()`;

// ── 2A: de server-HTML zelf, zonder browser ────────────────────────────────
// De echte productiebuild antwoordt op /restaurant/6. De HTML (inclusief de
// meegestuurde RSC-payload) mag maar één kaart bevatten: de gekozen. De namen
// hieronder komen uit dezelfde data als de pagina, zodat er niets verzonnen
// wordt en de check niet stilletjes veroudert.
const MENUS = require(path.join(REPO_ROOT, 'data', 'menus.json'));
const itemNames = (key) => (((MENUS[key] || {}).categories) || []).flatMap((cat) => (cat.items || []).map((item) => item.name));
const onlyIn = (key, others) => {
  const otherNames = new Set(others.flatMap((other) => itemNames(other)));
  return itemNames(key).find((name) => !otherNames.has(name)) || null;
};
const LUNCH_ONLY = onlyIn('6-lunch', ['6-diner', '6-borrel', '6-specialiteiten']);
const BORREL_ONLY = onlyIn('6-borrel', ['6-lunch', '6-diner', '6-specialiteiten']);
const DINER_ONLY = onlyIn('6-diner', ['6-lunch', '6-borrel', '6-specialiteiten']);
const LUNCH_COUNT = itemNames('6-lunch').length;
const BORREL_COUNT = itemNames('6-borrel').length;

const countIn = (haystack, needle) => haystack.split(needle).length - 1;

async function serverHtmlCheck() {
  const fetchHtml = async (page) => {
    const response = await fetch(`${APP}${page}`);
    const html = await response.text();
    // De RSC-payload (de props voor de client) begint bij self.__next_f; de
    // zichtbare HTML staat daarvoor. Beide moeten zuinig zijn.
    const flightAt = html.indexOf('self.__next_f');
    return {
      status: response.status,
      html,
      markup: flightAt === -1 ? html : html.slice(0, flightAt),
      markupKb: Math.round(((flightAt === -1 ? html.length : flightAt) / 1024) * 10) / 10,
      bytes: html.length,
    };
  };

  const standard = await fetchHtml('/restaurant/6');
  // React zet `<!-- -->` tussen tekst en expressies in de SSR-HTML; voor een
  // leesbare titel als "Lunchkaart · 36 gerechten" halen we die eruit.
  const markupNoComments = standard.markup.replace(/<!--[\s\S]*?-->/g, '');
  const activeMatch = /meal-btn active"[^>]*>([^<]*)/.exec(markupNoComments);
  const activeName = activeMatch ? activeMatch[1].trim() : null;
  const panelTitle = ((/rpm-panel-title"[^>]*>([\s\S]*?)<\/p>/.exec(markupNoComments) || [])[1] || '')
    .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  check('2A server-HTML: /restaurant/6 antwoordt met 200', standard.status === 200, String(standard.status));
  check('2A server-HTML: de sectie heet "Menukaarten"', standard.markup.includes('>Menukaarten<'), 'heading in the server HTML');
  check('2A server-HTML: elke kaart is een echte link (?kaart=<id>)',
    ['6-lunch', '6-diner', '6-borrel', '6-specialiteiten'].every((id) => standard.markup.includes(`/restaurant/6?kaart=${id}`)),
    JSON.stringify(['6-lunch', '6-diner', '6-borrel', '6-specialiteiten'].filter((id) => !standard.markup.includes(`/restaurant/6?kaart=${id}`))));
  check('2A server-HTML: de standaardkaart is lunch, de eerste in de vaste volgorde (geen klok)',
    activeName === 'Lunchkaart' && panelTitle === `Lunchkaart · ${LUNCH_COUNT} gerechten`,
    JSON.stringify({ activeTab: activeName, panelTitle }));
  check('2A server-HTML: precies één tabblad is actief', countIn(standard.markup, 'aria-current="page"') === 1, `${countIn(standard.markup, 'aria-current="page"')} aria-current`);
  check('2A server-HTML: regressie — maar één kaart in de HTML (de lunch)',
    countIn(standard.markup, 'class="menu-card') === LUNCH_COUNT && standard.html.includes(LUNCH_ONLY),
    `${countIn(standard.markup, 'class="menu-card')} kaarten (verwacht ${LUNCH_COUNT})`);
  check('2A server-HTML: regressie — geen gerechten van de andere kaarten, ook niet in de RSC-payload',
    !standard.html.includes(BORREL_ONLY) && !standard.html.includes(DINER_ONLY),
    JSON.stringify({ borrelOnly: BORREL_ONLY, borrelFound: standard.html.includes(BORREL_ONLY), dinerOnly: DINER_ONLY, dinerFound: standard.html.includes(DINER_ONLY) }));

  const borrel = await fetchHtml('/restaurant/6?kaart=6-borrel');
  check('2A server-HTML: ?kaart=6-borrel rendert de borrelkaart zonder JavaScript',
    borrel.status === 200 && countIn(borrel.markup, 'class="menu-card') === BORREL_COUNT
      && borrel.markup.includes(BORREL_ONLY) && !borrel.markup.includes(LUNCH_ONLY) && !borrel.markup.includes(DINER_ONLY),
    JSON.stringify({ cards: countIn(borrel.markup, 'class="menu-card'), expected: BORREL_COUNT, borrelDish: borrel.markup.includes(BORREL_ONLY), lunchDish: borrel.markup.includes(LUNCH_ONLY), dinerDish: borrel.markup.includes(DINER_ONLY) }));

  const unknown = await fetchHtml('/restaurant/6?kaart=6-bestaat-niet');
  check('2A server-HTML: een onbekende ?kaart= valt terug op de standaardkaart',
    unknown.status === 200 && countIn(unknown.markup, 'class="menu-card') === LUNCH_COUNT && unknown.markup.includes(LUNCH_ONLY),
    `${countIn(unknown.markup, 'class="menu-card')} kaarten (verwacht ${LUNCH_COUNT})`);

  const single = await fetchHtml('/restaurant/1');
  check('2A server-HTML: /restaurant/1 (twee kaarten) toont er ook maar één',
    single.status === 200 && countIn(single.markup, 'rpm-tab-count') === 2
      && countIn(single.markup, 'aria-current="page"') === 1
      && !single.html.includes('Signature Menu'),
    JSON.stringify({ tabs: countIn(single.markup, 'rpm-tab-count'), current: countIn(single.markup, 'aria-current="page"'), dinerDish: single.html.includes('Signature Menu') }));

  return {
    standard: { bytes: standard.bytes, markupKb: standard.markupKb },
    borrel: { bytes: borrel.bytes, markupKb: borrel.markupKb },
    single: { bytes: single.bytes, markupKb: single.markupKb },
  };
}

// ── server, viewport, thema, screenshots ────────────────────────────────────
async function startProductionServer() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT_DIR, 'next-start.log'));
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
  };
  // Deze geïsoleerde checkout heeft geen globale npm; start dezelfde
  // productiebuild dan rechtstreeks met node (zelfde commando, zelfde env).
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmAvailable = spawnSync(npm, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = npmAvailable
    ? spawn(npm, ['run', 'start', '--', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
      })
    : spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
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

async function shot(cdp, name) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(viewport.width, Math.ceil(content.width));
  const wholePage = viewport.width >= 720;
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
  shots.push({ file, bytes: buffer.length, viewport: `${viewport.width}x${viewport.height}` });
}

async function applyTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, 'document.readyState === "complete"');
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', '${theme}')`);
}

// ── netwerkmeting: de eerste overdracht met een koude cache ─────────────────
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
      const document = finished.find((entry) => entry.type === 'Document');
      return {
        totalBytes,
        totalKb: Math.round((totalBytes / 1024) * 10) / 10,
        documentKb: document ? Math.round((document.bytes / 1024) * 10) / 10 : null,
        resourceCount: finished.length,
      };
    },
  };
}

// BE-42: de koude eerste overdracht van de twee pagina's die 1A en 3B raken.
// /restaurant/6 (Bardot, vier kaarten) is tegelijk de "voor"-meting voor deel 2
// (de hele kaart in tabbladen, eis < 250 KB). Zonder koude cache meet de
// tweede navigatie bijna niets.
async function measureTransfer(cdp, meter, { label, page, ready }) {
  await setViewport(cdp, 1280, 900);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await navigate(cdp, `${APP}${page}`, ready);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const summary = meter.summary();
  transfer.push({ label, page, theme: 'dark', viewport: '1280x900', ...summary });
  console.log(`transfer ${page} (${label}): ${summary.totalKb} KB, ${summary.resourceCount} requests`);
  return summary;
}

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


async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  let server = null;
  let browser = null;
  let cdp = null;
  const pages = {};
  try {
    server = await startProductionServer();
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    const meter = attachNetworkMeter(cdp);

    // Overdracht: "na" voor 1A op de lijst, en de "voor"-meting van de
    // restaurantpagina voor deel 2 (2A).
    await applyTheme(cdp, 'dark');
    const transferNa = await measureTransfer(cdp, meter, {
      label: 'na 1A',
      page: '/alle-restaurants',
      ready: 'document.readyState === "complete" && document.querySelector(".ar-card") !== null',
    });

    // BE-42 deel 2 — dezelfde meting ná 2A: de hele kaart in tabbladen mag de
    // eerste overdracht niet boven 250 KB brengen. De "voor"-waarde (169,9 KB)
    // is in deel 1 met dezelfde methode en dezelfde productiebuild gemeten;
    // dit script kan die niet opnieuw meten, want de code is al gewijzigd.
    const transferRestaurantNa = await measureTransfer(cdp, meter, {
      label: 'na 2A (Bardot, 4 kaarten)',
      page: '/restaurant/6',
      ready: 'document.readyState === "complete" && document.querySelector(".rpm-panel") !== null',
    });
    transfer.unshift({
      label: 'voor 2A (Bardot, 4 kaarten)',
      page: '/restaurant/6',
      source: 'BE-42 deel 1-bewijs (zelfde productiebuild, zelfde meetmethode)',
      theme: 'dark',
      viewport: '1280x900',
      totalKb: TRANSFER_BEFORE_RESTAURANT6_KB,
      documentKb: null,
      resourceCount: null,
    });

    check('overdracht: /alle-restaurants blijft onder 250 KB', transferNa.totalKb < 250, `${transferNa.totalKb} KB`);
    check('2A overdracht: /restaurant/6 blijft ná 2A onder 250 KB', transferRestaurantNa.totalKb < 250, `${transferRestaurantNa.totalKb} KB`);
    check(
      '2A overdracht: de eerste overdracht groeit hooguit met één kaart (max. +25 KB op 169,9 KB)',
      transferRestaurantNa.totalKb <= TRANSFER_BEFORE_RESTAURANT6_KB + 25,
      `voor ${TRANSFER_BEFORE_RESTAURANT6_KB} KB, na ${transferRestaurantNa.totalKb} KB`
    );

    // De server-HTML zelf (zonder browser): precies één kaart, nooit alle.
    const serverHtml = await serverHtmlCheck();
    pages['server-html'] = serverHtml;

    for (const theme of ['light', 'dark']) {
      await applyTheme(cdp, theme);

      // 1A — /alle-restaurants, gemeten op 1280 px.
      await setViewport(cdp, 1280, 900);
      await navigate(cdp, `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null');
      const alle = await evalJs(cdp, ALLE_JS);
      pages[`alle-restaurants-${theme}`] = alle;
      check(`1A ${theme}: de kaart is geen grote link meer, de naam is de link`, !alle.cardIsLink && alle.nameIsLink && /^\/restaurant\//.test(alle.nameHref || ''), JSON.stringify({ nameHref: alle.nameHref, cardIsLink: alle.cardIsLink }));
      check(`1A ${theme}: de grote knop "Bekijk N menukaarten" is weg`, alle.bigCtas === 0, `${alle.bigCtas} .ar-cta`);
      check(`1A ${theme}: elke menukaart is een eigen knop naar /menu/<id>`, alle.buttons.length === 4 && alle.buttons.every((b) => /^\/menu\/[^/]+$/.test(b.href || '')), JSON.stringify(alle.buttons.map((b) => b.href)));
      check(`1A ${theme}: de knoppen dragen de echte kaartnamen`, alle.buttons.every((b) => b.label.length > 2), JSON.stringify(alle.buttons.map((b) => b.label)));
      check(`1A ${theme}: tabvolgorde is naam → kaartknoppen`, alle.focusOrder[0] === alle.nameHref && alle.focusOrder.slice(1).every((href) => /^\/menu\//.test(href || '')), JSON.stringify(alle.focusOrder));
      check(`1A ${theme}: alle aanraakvlakken zijn ≥ 44 px`, alle.buttons.every((b) => b.height >= 44), JSON.stringify(alle.buttons.map((b) => b.height)));
      check(`1A ${theme}: menuknoppen gebruiken de zachte tokenparen (≥ 4,5:1)`, Boolean(alle.buttonColors) && alle.buttonColors.bg === alle.buttonColors.soft && alle.buttonColors.ratio >= 4.5, JSON.stringify({ ratio: alle.buttonColors ? alle.buttonColors.ratio : null }));
      check(`1A ${theme}: geen horizontale overflow op 1280 px`, alle.overflow <= 1, `${alle.overflow}px`);
      check(`1A ${theme}: een restaurant zonder menukaart blijft zoals het was`,
        Boolean(alle.noMenu) && !alle.noMenu.missing && alle.noMenu.isWholeLink
          && /^\/restaurant\//.test(alle.noMenu.href || '')
          && alle.noMenu.label === 'Nog geen menukaart'
          && /^Bekijk restaurant/.test(alle.noMenu.restaurantLink || '')
          && alle.noMenu.extraActions === 0,
        JSON.stringify(alle.noMenu));

      // Zichtbare focus op de eerste menuknop.
      const focus = await evalJs(cdp, `(() => {
        const el = document.querySelector('a.ar-menu-button');
        if (!el) return { missing: true };
        el.focus();
        const s = getComputedStyle(el);
        return { active: document.activeElement === el, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor };
      })()`);
      check(`1A ${theme}: de focus op een menuknop is zichtbaar`, Boolean(focus.active) && parseFloat(focus.outlineWidth) >= 2 && focus.outlineStyle !== 'none', JSON.stringify(focus));

      // 1A — telefoonbreedtes: knoppen blijven ≥ 44 px en niets loopt buiten beeld.
      for (const width of [390, 320]) {
        await setViewport(cdp, width, 800);
        await navigate(cdp, `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null');
        const phone = await evalJs(cdp, `(() => ({
          overflow: Math.round(document.documentElement.scrollWidth) - Math.round(window.innerWidth),
          heights: [...document.querySelectorAll('a.ar-menu-button')].map((el) => Math.round(el.getBoundingClientRect().height)),
        }))()`);
        pages[`alle-restaurants-${theme}-${width}`] = phone;
        check(`1A ${theme} ${width}px: knoppen ≥ 44 px en geen horizontale overflow`, phone.heights.every((h) => h >= 44) && phone.overflow <= 1, JSON.stringify(phone));
      }


      // 3B — het prijsvlak op de restaurantpagina, de menupagina en zoeken.
      await setViewport(cdp, 1280, 900);
      for (const [label, url, selector, ready] of [
        ['restaurant', `${APP}/restaurant/6`, '.td-price', 'document.querySelector(".td-price") !== null'],
        ['menu', `${APP}/menu/6-diner`, '.td-price', 'document.querySelector(".td-price") !== null'],
        // De eerste treffer op /search kan de zachte "op aanvraag"-variant zijn;
        // die is apart gedekt en verandert niet in BE-42. Hier telt een echte prijs.
        ['search', `${APP}/search?q=steak`, '.price-label:not(.price-label--soft)', 'document.querySelector(".price-label:not(.price-label--soft)") !== null'],
      ]) {
        await navigate(cdp, url, ready);
        const price = await evalJs(cdp, priceJs(selector));
        pages[`price-${label}-${theme}`] = price;
        check(`3B ${theme} ${label}: zacht vlak, primaire tekst, vet, ≥ 4,5:1`, !price.missing && price.usesSoft && price.usesPrimary && price.ratio >= 4.5 && Number(price.fontWeight) >= 700, JSON.stringify({ bg: price.bg, fg: price.fg, ratio: price.ratio, weight: price.fontWeight }));
        check(`3B ${theme} ${label}: de prijs staat rechts in zijn rij`, price.rightEdge >= price.containerRight - 2, JSON.stringify({ right: price.rightEdge, container: price.containerRight }));
      }

      // "op aanvraag" blijft de bestaande gedempte variant op hetzelfde zachte vlak.
      await navigate(cdp, `${APP}/search?q=pasta`, 'document.querySelector(".price-label--soft") !== null');
      const onRequest = await evalJs(cdp, priceJs('.price-label--soft'));
      pages[`price-on-request-${theme}`] = onRequest;
      check(`3B ${theme} search: "op aanvraag" blijft gedempt op het zachte vlak (≥ 4,5:1)`, !onRequest.missing && onRequest.usesSoft && onRequest.ratio >= 4.5, JSON.stringify({ bg: onRequest.bg, fg: onRequest.fg, ratio: onRequest.ratio }));

      // 3B — home, "Vanavond op de kaart", met de vaste BE-29-klok.
      await setFixedClock(cdp, '2026-10-23T18:00:00.000Z');
      await navigate(cdp, `${APP}/`, 'document.querySelector(".tonight-price") !== null');
      const tonight = await evalJs(cdp, priceJs('.tonight-price'));
      pages[`price-home-${theme}`] = tonight;
      check(`3B ${theme} home: zacht vlak, primaire tekst, vet, ≥ 4,5:1`, !tonight.missing && tonight.usesSoft && tonight.usesPrimary && tonight.ratio >= 4.5 && Number(tonight.fontWeight) >= 700, JSON.stringify({ bg: tonight.bg, fg: tonight.fg, ratio: tonight.ratio, weight: tonight.fontWeight }));
      await setFixedClock(cdp, null);

      // 2A — de hele menukaart in tabbladen, in beide thema's.
      await setViewport(cdp, 1280, 900);
      await navigate(cdp, `${APP}/restaurant/6`, 'document.querySelector(".rpm-panel") !== null');
      const tabs = await evalJs(cdp, TABS_JS);
      pages[`tabs-${theme}`] = tabs;
      const expectedCounts = ['6-lunch', '6-diner', '6-borrel', '6-specialiteiten'].map((id) => String(itemNames(id).length)).join(',');
      check(`2A ${theme}: de sectie heet "Menukaarten" met één tabblad per kaart`,
        tabs.heading === 'Menukaarten' && tabs.navLabel === 'Menukaarten' && tabs.tabs.length === 4,
        JSON.stringify({ heading: tabs.heading, nav: tabs.navLabel, tabs: tabs.tabs.map((tab) => tab.name) }));
      check(`2A ${theme}: de tabbladen staan in de vaste volgorde (lunch, diner, borrel, overige)`,
        tabs.tabs.map((tab) => tab.name).join(', ') === 'Lunchkaart, Dinerkaart, Borrelkaart, Specialiteiten',
        JSON.stringify(tabs.tabs.map((tab) => tab.name)));
      check(`2A ${theme}: elk tabblad toont het echte aantal gerechten`,
        tabs.tabs.map((tab) => tab.count).join(',') === expectedCounts,
        `gemeten ${tabs.tabs.map((tab) => tab.count).join(',')} / verwacht ${expectedCounts}`);
      check(`2A ${theme}: elk tabblad is een echte link naar die kaart (?kaart=<id>)`,
        tabs.tabs.every((tab) => /^\/restaurant\/6\?kaart=6-[a-z]+$/.test(tab.href || '')),
        JSON.stringify(tabs.tabs.map((tab) => tab.href)));
      check(`2A ${theme}: de standaardkaart is de eerste in de vaste volgorde, dus lunch`,
        tabs.activeTabs === 1 && tabs.activeName === 'Lunchkaart' && /^Lunchkaart · \d+ gerechten$/.test(tabs.panelTitle || ''),
        JSON.stringify({ active: tabs.activeName, activeTabs: tabs.activeTabs, panel: tabs.panelTitle }));
      check(`2A ${theme}: onder het tabblad staat de hele kaart van die kaart`,
        tabs.cards === LUNCH_COUNT && tabs.sections > 1 && tabs.prices.length >= LUNCH_COUNT - 1,
        JSON.stringify({ cards: tabs.cards, expected: LUNCH_COUNT, sections: tabs.sections, prices: tabs.prices.length }));
      check(`2A ${theme}: de prijs is ook hier het zachte vlak met primaire tekst`,
        tabs.prices.length > 0 && tabs.prices.every((price) => price.length > 0),
        JSON.stringify(tabs.prices.slice(0, 3)));
      check(`2A ${theme}: de bronregel en de originele kaart blijven staan`,
        /^Bron: /.test(tabs.source || '') && /^https:\/\//.test(tabs.sourceHref || ''),
        JSON.stringify({ source: tabs.source, href: tabs.sourceHref }));
      check(`2A ${theme}: de aparte menupagina /menu/<id> blijft bereikbaar`,
        tabs.menuPageHref === '/menu/6-lunch', String(tabs.menuPageHref));
      check(`2A ${theme}: de tabbladen zijn tikvlakken van ≥ 44 px`, tabs.tabs.every((tab) => tab.height >= 44), JSON.stringify(tabs.tabs.map((tab) => tab.height)));
      check(`2A ${theme}: geen horizontale overflow op 1280 px`, tabs.overflow <= 1, `${tabs.overflow}px`);

      // Wisselen met JavaScript: alleen het paneel verandert, de pagina laadt
      // niet opnieuw en er komt precies één kaart bij.
      const switched = await evalJs(cdp, SWITCH_JS);
      pages[`tabs-switch-${theme}`] = switched;
      check(`2A ${theme}: wisselen met JavaScript zonder volledige herlaadbeurt`,
        !switched.missing && switched.navigationEntries === 1 && switched.navigationEntries === switched.navigationBefore && /kaart=6-borrel$/.test(switched.url || ''),
        JSON.stringify({ before: switched.navigationBefore, after: switched.navigationEntries, url: switched.url }));
      check(`2A ${theme}: na het wisselen staat alleen de borrelkaart in het paneel`,
        switched.cards === BORREL_COUNT && switched.activeName === 'Borrelkaart' && /^Borrelkaart · \d+ gerechten$/.test(switched.panelTitle || ''),
        JSON.stringify({ cards: switched.cards, expected: BORREL_COUNT, active: switched.activeName, panel: switched.panelTitle }));
      check(`2A ${theme}: de bronregel volgt de gekozen kaart`, /^Bron: /.test(switched.source || ''), JSON.stringify(switched.source));

      // Telefoonbreedtes: de tabbladen blijven ≥ 44 px en niets loopt buiten beeld.
      for (const width of [390, 320]) {
        await setViewport(cdp, width, 800);
        await navigate(cdp, `${APP}/restaurant/6`, 'document.querySelector(".rpm-panel") !== null');
        const phoneTabs = await evalJs(cdp, TABS_JS);
        pages[`tabs-${theme}-${width}`] = phoneTabs;
        check(`2A ${theme} ${width}px: tabbladen ≥ 44 px en geen horizontale overflow`,
          phoneTabs.tabs.every((tab) => tab.height >= 44) && phoneTabs.overflow <= 1,
          JSON.stringify({ heights: phoneTabs.tabs.map((tab) => tab.height), overflow: phoneTabs.overflow }));
      }
      await setViewport(cdp, 1280, 900);

      // Screenshots: /alle-restaurants en /restaurant/6 op 1280, 390 en 320 px.
      // Op 1280 staat de hele pagina in beeld. Op de telefoon schuift de
      // opname naar de tabbladen, zodat de sectie "Menukaarten" en de kaart
      // eronder echt in het bewijs staan; de zwevende menubalk blijft dan op
      // zijn eigen plek (geen beyond-viewport-opname).
      for (const [name, url, ready, toMenu] of [
        ['alle-restaurants', `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null', false],
        ['restaurant-6', `${APP}/restaurant/6`, 'document.querySelector(".td-price") !== null', true],
        // 2A — Bardot met een gewisseld tabblad (de borrelkaart, de grootste).
        ['restaurant-6-borrel', `${APP}/restaurant/6?kaart=6-borrel`, 'document.querySelector(".rpm-panel") !== null', true],
        // De lokale data heeft geen restaurant met precies één kaart; met twee
        // kaarten is /restaurant/1 (Wolfslaar) het kleinste echte geval.
        ['restaurant-1', `${APP}/restaurant/1`, 'document.querySelector(".td-price") !== null', true],
      ]) {
        for (const [width, height] of [[1280, 900], [390, 844], [320, 720]]) {
          await setViewport(cdp, width, height);
          await navigate(cdp, url, ready);
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (toMenu && width < 720) {
            await evalJs(cdp, `(() => {
              const el = document.querySelector('.rpm-tabs');
              if (!el) return false;
              window.scrollTo(0, Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY) - 16));
              return true;
            })()`);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          await shot(cdp, `${name}-${theme}-${width}.png`);
        }
      }
    }


    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      ticket: '#98 BE-42 deel 1 (1A + 3B) en deel 2 (2A)',
      kind: 'developer evidence — local production build, no production data or credentials',
      app: APP,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      measurements: pages,
      transfer,
      screenshots: shots,
      gaps: [
        'Geen restaurant met precies één menukaart in de lokale data; /restaurant/1 (Wolfslaar, twee kaarten) is het kleinste echte geval (geen data toegevoegd).',
        'De "voor"-meting van /restaurant/6 (169,9 KB) komt uit het deel 1-bewijs: dit script draait altijd op de huidige code en kan de oude toestand niet opnieuw meten.',
        'Dit is developer-evidence op een lokale productiebuild: geen productie, geen echte Supabase-credentials, geen merge of publicatie.',
      ],
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ result: record.result, checks: checks.length, failed: failed.length, shots: shots.length, out: OUT_PATH }, null, 2));
    if (failed.length > 0) {
      for (const entry of failed) console.log(`FAILED: ${entry.name} — ${entry.detail}`);
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

