'use strict';

// BE-44 (#105) — browsercheck voor "een gerecht delen" (criterium 1, 2 en 3).
//
// Start een eigen lokale ontwikkelserver (dezelfde runtime als de andere
// ops/browser-checks: ops/browser/lib/runtime.js) en bestuurt een lokaal
// geïnstalleerde Edge/Chrome via CDP. Niets hiervan raakt productie, Supabase
// of een externe host (de browser kan geen externe naam opzoeken).
//
// Wat deze check vastlegt, per viewport (1280, 390, 320 px) en per stand
// (licht, donker):
//   - de knop "Delen" staat op de gerechtkaart van /menu/6-diner, onder de
//     beschrijving en niet in de regel met de prijs, met een aanraakvlak van
//     minstens 44 × 44 px en het deelicoon;
//   - zonder navigator.share kopieert de knop de link en verschijnt
//     "Link gekopieerd" in een role="status";
//   - met navigator.share gaat exact { url, title } naar het systeemmenu —
//     geen `text`, en de link is de BE-12-deeplink met de stand van dit moment;
//   - de ontvanger van een gedeelde link ziet "Iemand deelde dit gerecht met je"
//     boven de opgelichte kaart, terwijl het thema van de pagina niet verandert;
//   - de server-HTML van een gedeelde link heeft og:title "<gerecht> · <prijs>",
//     og:description met restaurant en adres, og:url en een og:image van
//     1200 × 630; zonder gerecht-deeplink blijft de algemene metadata staan;
//   - de twee og:image-afbeeldingen komen als PNG van 1200 × 630 terug en zijn
//     per stand verschillend; het apple-touch-icon is 180 × 180.
//
// Bewijs: `ops/browser/evidence/be44-browser-evidence.json` (in git) en de
// schermafbeeldingen + og:image-PNG's in `ops/browser/output/be-44/` (buiten
// git, zoals de opdracht vraagt). Dit is developer-evidence op een lokale
// build: geen productie en geen onafhankelijke acceptatie.
//
//   node ops/browser/run-be44-browser-check.js [--alleen=<scenario>] [--lijst]

const fs = require('node:fs');
const path = require('node:path');

const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pngSize,
} = require('./lib/runtime');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { CdpClient } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BE44_PORT || 3157);
const APP = `http://localhost:${PORT}`;
const OUT_DIR = path.join(REPO_ROOT, 'ops', 'browser', 'output', 'be-44');
const BASE_EVIDENCE_PATH = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'be44-browser-evidence.json');

// De echte fixture: "Poussin" (€20,95) uit de dinerkaart van restaurant 6
// (Brasserie Bardot, Van Coothplein 12, 4811 NE Breda), categorie
// "Specialiteiten van Bardot". Precies dezelfde waarden als in de unit-tests.
const MENU_ID = '6-diner';
const DISH_ID = '6-diner-0-0';
const DISH_NAME = 'Poussin';
const DISH_CATEGORY = 'Specialiteiten van Bardot';
const DISH_PRICE = '€20,95';
const RESTAURANT_NAME = 'Brasserie Bardot';
const ADDRESS = 'Van Coothplein 12, 4811 NE Breda';
// Zo bouwt de pagina hem zelf (buildDishDeepLink + de stand van dit moment).
const DEEP_LINK = `/menu/${MENU_ID}?dish=${DISH_ID}&name=${encodeURIComponent(DISH_NAME).replace(/%20/g, '+')}&cat=${encodeURIComponent(DISH_CATEGORY).replace(/%20/g, '+')}`;

const SCENARIOS = [
  { name: 'delen', run: (cdp) => delenScenario(cdp) },
  { name: 'ontvanger', run: (cdp) => ontvangerScenario(cdp) },
  { name: 'server', run: () => serverScenario() },
];
// BE-43 (#101): tijdens het werk `--alleen=<naam>`, aan het eind één volledige
// run. Een gefilterde run schrijft naar zijn eigen bewijsbestand.
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

const checks = [];
const shots = [];
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) console.log(`FAIL ${name} — ${detail === undefined ? '' : detail}`);
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, name, meta = {}) {
  const file = await screenshot(cdp, OUT_DIR, name);
  shots.push({ file, viewport: `${viewport.width}x${viewport.height}`, ...meta });
}

async function setTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, 'document.readyState === "complete"');
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)})`);
}

// ── gedeelde meethelpers in de pagina ───────────────────────────────────────
const PAGE_HELPERS = `
  const flat = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const cardFor = (name) => [...document.querySelectorAll('.menu-card')]
    .find((card) => flat((card.querySelector('.td-name') || {}).innerText) === name) || null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: Math.round(r.width), height: Math.round(r.height) }; };
`;

function readCardJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    if (!card) return { missing: true, cards: document.querySelectorAll('.menu-card').length };
    const button = card.querySelector('.dish-share-btn');
    const desc = card.querySelector('.td-desc');
    const cardTop = card.querySelector('.card-top');
    const status = card.querySelector('[role="status"]');
    const note = card.querySelector('.dish-share-note');
    const nameEl = card.querySelector('.td-name');
    return {
      missing: false,
      theme: document.documentElement.getAttribute('data-theme'),
      button: button ? flat(button.innerText) : null,
      buttonBox: button ? box(button) : null,
      icon: Boolean(button && button.querySelector('svg')),
      insideCardTop: Boolean(cardTop && button && cardTop.contains(button)),
      afterDesc: Boolean(desc && button && box(button).top >= box(desc).top),
      statusRole: Boolean(status),
      statusText: status ? flat(status.innerText) : null,
      highlighted: card.classList.contains('menu-card-highlighted'),
      note: note ? flat(note.innerText) : null,
      noteAboveName: Boolean(note && nameEl && note.getBoundingClientRect().top <= nameEl.getBoundingClientRect().top),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}

// Zonder navigator.share: het klembord. De stub legt vast wat er gekopieerd
// zou zijn; er wordt niets echt naar het systeemklembord geschreven.
const CLIPBOARD_STUB = `(() => {
  window.__copied = null;
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (value) => { window.__copied = String(value); return Promise.resolve(); },
    },
    configurable: true,
  });
  return true;
})()`;

// Met navigator.share: het systeemmenu. De stub legt de payload vast, zodat de
// check kan bewijzen dat er alleen `url` en `title` meegaan.
const SHARE_STUB = `(() => {
  window.__shared = null;
  Object.defineProperty(navigator, 'share', {
    value: (payload) => { window.__shared = payload; return Promise.resolve(); },
    configurable: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('mag niet gebruikt worden')) },
    configurable: true,
  });
  return true;
})()`;

function clickShareJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    const button = card ? card.querySelector('.dish-share-btn') : null;
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

/**
 * De knop pas klikken als de pagina echt interactief is. De server rendert de
 * knop al, maar de klikhandler bestaat pas na hydratatie; een klik daarvoor
 * verdwijnt zonder fout. Daarom: klikken en kijken of het effect optreedt,
 * een paar keer achter elkaar, binnen een redelijke tijd.
 */
async function clickUntil(cdp, name, observedJs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  while (Date.now() < deadline) {
    clicked = await evalJs(cdp, clickShareJs(name));
    if (!clicked) return { clicked: false, observed: false };
    if (await waitFor(cdp, observedJs, 1500)) return { clicked: true, observed: true };
  }
  return { clicked, observed: false };
}

const COPIED_OBSERVED = `(() => {
  const card = [...document.querySelectorAll('.menu-card')].find((c) => ((c.querySelector('.td-name') || {}).innerText || '').trim() === ${JSON.stringify(DISH_NAME)});
  const status = card && card.querySelector('[role="status"]');
  return Boolean(status && status.innerText.trim());
})()`;

const SHARED_OBSERVED = 'Boolean(window.__shared)';

// De gerechtkaart in beeld brengen vóór een schermafbeelding: de opname moet de
// knop (of de deelregel met de opgelichte kaart) echt laten zien.
function focusCardJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    if (!card) return false;
    card.scrollIntoView({ block: 'center' });
    return true;
  })()`;
}
const THEMES = ['light', 'dark'];
const WIDTHS = [1280, 390, 320];

const standFor = (theme) => (theme === 'dark' ? 'donker' : 'licht');
const expectedShareUrl = (theme) => `${APP}${DEEP_LINK}&stand=${standFor(theme)}`;

// ── 1. De knop "Delen" (criterium 1) ────────────────────────────────────────
async function delenScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      await setViewport(cdp, width, width === 1280 ? 950 : 844);
      await setTheme(cdp, theme);
      await navigate(
        cdp,
        `${APP}/menu/${MENU_ID}`,
        `Boolean([...document.querySelectorAll('.menu-card .td-name')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(DISH_NAME)}))`,
      );

      const card = await evalJs(cdp, readCardJs(DISH_NAME));
      check(`delen (${label}): de knop "Delen" staat op de gerechtkaart`, card.missing === false && card.button === 'Delen', JSON.stringify({ button: card.button, missing: card.missing }));
      check(
        `delen (${label}): het aanraakvlak is minstens 44 × 44 px`,
        Boolean(card.buttonBox) && card.buttonBox.height >= 44 && card.buttonBox.width >= 44,
        JSON.stringify(card.buttonBox),
      );
      check(`delen (${label}): de knop staat onder de beschrijving, niet naast de prijs`, card.afterDesc === true && card.insideCardTop === false, JSON.stringify({ afterDesc: card.afterDesc, insideCardTop: card.insideCardTop }));
      check(`delen (${label}): de knop heeft het deelicoon`, card.icon === true);
      check(`delen (${label}): de melding staat in een role="status"`, card.statusRole === true);
      check(`delen (${label}): de stand van de pagina is ${theme}`, card.theme === theme, card.theme);
      check(`delen (${label}): geen horizontale overloop`, card.overflow <= 0, `overflow=${card.overflow}`);
      await evalJs(cdp, focusCardJs(DISH_NAME));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await shot(cdp, `be44-deelknop-${width}-${theme}.png`, { scenario: 'delen', theme, width });

      if (width === 1280) {
        // Zonder navigator.share: het klembord, met de melding.
        await evalJs(cdp, CLIPBOARD_STUB);
        const { clicked, observed: statusReady } = await clickUntil(cdp, DISH_NAME, COPIED_OBSERVED);
        const after = await evalJs(cdp, readCardJs(DISH_NAME));
        const copied = await evalJs(cdp, 'window.__copied');
        check(`delen (${label}): zonder navigator.share verschijnt "Link gekopieerd"`, statusReady && after.statusText === 'Link gekopieerd', JSON.stringify({ clicked, status: after.statusText }));
        check(`delen (${label}): het klembord kreeg de deeplink met de stand`, copied === expectedShareUrl(theme), copied);
        await shot(cdp, `be44-melding-${width}-${theme}.png`, { scenario: 'delen', state: 'melding', theme, width });
      } else {
        // Met navigator.share: alleen url en title, geen tekst.
        await evalJs(cdp, SHARE_STUB);
        const { clicked, observed: sharedReady } = await clickUntil(cdp, DISH_NAME, SHARED_OBSERVED);
        const payload = sharedReady ? await evalJs(cdp, 'window.__shared') : null;
        const keys = payload && typeof payload === 'object' ? Object.keys(payload).sort() : [];
        check(`delen (${label}): de knop gebruikt navigator.share`, sharedReady, JSON.stringify({ clicked, payload }));
        check(`delen (${label}): de payload is alleen url en title`, JSON.stringify(keys) === JSON.stringify(['title', 'url']), JSON.stringify(keys));
        check(`delen (${label}): de link is de deeplink met de stand van dit moment`, Boolean(payload) && payload.url === expectedShareUrl(theme), payload && payload.url);
        check(`delen (${label}): de titel is gerecht en restaurant`, Boolean(payload) && payload.title === `${DISH_NAME} · ${RESTAURANT_NAME}`, payload && payload.title);
      }
    }
  }
}


// ── 2. De ontvanger van een gedeelde link (criterium 2 en 3) ────────────────
//
// De ontvanger opent de gedeelde link. De stand in de link kiest alleen de
// voorvertoning: hier staat de pagina opzettelijk op de tegenovergestelde stand
// (deel in licht → pagina in donker) om te bewijzen dat het thema niet
// meebeweegt.
async function ontvangerScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      const stand = standFor(theme === 'dark' ? 'light' : 'dark');
      const shared = `${DEEP_LINK}&stand=${stand}`;
      await setViewport(cdp, width, width === 1280 ? 950 : 844);
      await setTheme(cdp, theme);
      await navigate(
        cdp,
        `${APP}${shared}`,
        `Boolean([...document.querySelectorAll('.menu-card .td-name')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(DISH_NAME)}))`,
      );
      // De oplichting is een client-effect (BE-12): de server rendert de kaart
      // zonder de klasse. Daarom eerst wachten tot de pagina gehydrateerd is.
      const lit = await waitFor(cdp, `[...document.querySelectorAll('.menu-card')].some((c) => c.classList.contains('menu-card-highlighted'))`, 8000);
      const card = await evalJs(cdp, readCardJs(DISH_NAME));
      check(`ontvanger (${label}): de regel "Iemand deelde dit gerecht met je" staat bij de kaart`, card.note === 'Iemand deelde dit gerecht met je', card.note);
      check(`ontvanger (${label}): de regel staat boven de kaart`, card.noteAboveName === true);
      check(`ontvanger (${label}): het gerecht is opgelicht`, lit === true && card.highlighted === true, JSON.stringify({ lit, highlighted: card.highlighted }));
      check(`ontvanger (${label}): de deelknop staat ook op deze kaart`, card.button === 'Delen', card.button);
      check(`ontvanger (${label}): de stand in de link verandert het thema niet`, card.theme === theme, JSON.stringify({ theme: card.theme, stand }));
      check(`ontvanger (${label}): geen horizontale overloop`, card.overflow <= 0, `overflow=${card.overflow}`);
      await evalJs(cdp, focusCardJs(DISH_NAME));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await shot(cdp, `be44-ontvanger-${width}-${theme}.png`, { scenario: 'ontvanger', theme, width, link: shared });
    }
  }
}

// ── 3. Metadata en voorvertoningsafbeeldingen (criterium 3) ─────────────────
function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaContent(html, property) {
  const match = new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`).exec(html)
    || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${property}"`).exec(html);
  return match ? decodeEntities(match[1]) : null;
}

async function serverScenario() {
  const sharedUrl = `${APP}${DEEP_LINK}&stand=donker`;
  const response = await fetch(sharedUrl);
  const html = await response.text();
  check('server: de gedeelde link antwoordt met 200', response.status === 200, response.status);
  check('server: og:title is "<gerecht> · <prijs>"', metaContent(html, 'og:title') === `${DISH_NAME} · ${DISH_PRICE}`, metaContent(html, 'og:title'));
  const description = metaContent(html, 'og:description') || '';
  check('server: og:description noemt het restaurant en het adres', description.includes(RESTAURANT_NAME) && description.includes(ADDRESS), description);
  check(`server: og:url is de gedeelde link`, metaContent(html, 'og:url') === sharedUrl, metaContent(html, 'og:url'));
  const image = metaContent(html, 'og:image') || '';
  check('server: og:image wijst naar de eigen afbeelding van dit gerecht', image.startsWith(`${APP}/menu/${MENU_ID}/share-image?`) && image.includes('dish=' + DISH_ID) && image.includes('stand=donker'), image);
  const appleIcon = (/<link[^>]+rel="apple-touch-icon"[^>]*>/.exec(html) || [null])[0] || '';
  check('server: er is een apple-touch-icon', appleIcon.includes('apple-icon'), appleIcon);

  // Zonder gerecht-deeplink blijft de algemene metadata staan.
  const plain = await (await fetch(`${APP}/menu/${MENU_ID}`)).text();
  check('server: zonder gerecht-deeplink blijft de algemene titel staan', plain.includes('BredaEats — Zie de menukaart vóór je reserveert'), metaContent(plain, 'og:title'));
  check('server: zonder gerecht-deeplink geen gerecht-og:title', metaContent(plain, 'og:title') !== `${DISH_NAME} · ${DISH_PRICE}`, metaContent(plain, 'og:title'));
  check('server: zonder gerecht-deeplink geen og:image van een gerecht', !String(metaContent(plain, 'og:image') || '').includes('/share-image'), metaContent(plain, 'og:image'));

  // De twee voorvertoningsafbeeldingen: PNG van 1200 × 630, per stand anders.
  const images = {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const theme of ['licht', 'donker']) {
    const url = `${APP}/menu/${MENU_ID}/share-image?dish=${DISH_ID}&name=${encodeURIComponent(DISH_NAME)}&cat=${encodeURIComponent(DISH_CATEGORY)}&stand=${theme}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const size = pngSize(buffer);
    images[theme] = { url, status: res.status, type: res.headers.get('content-type'), size, bytes: buffer.length, buffer };
    fs.writeFileSync(path.join(OUT_DIR, `be44-og-image-${theme}.png`), buffer);
    check(`og:image (${theme}): PNG van 1200 × 630`, res.status === 200 && String(images[theme].type).includes('image/png') && size.width === 1200 && size.height === 630, JSON.stringify({ status: res.status, type: images[theme].type, size }));
  }
  check('og:image: licht en donker zijn echt twee verschillende afbeeldingen', images.licht.buffer.length > 0 && !images.licht.buffer.equals(images.donker.buffer), JSON.stringify({ licht: images.licht.bytes, donker: images.donker.bytes }));

  // Een ongeldig gerecht levert geen afbeelding op (geen giswerk).
  const invalid = await fetch(`${APP}/menu/${MENU_ID}/share-image?dish=${MENU_ID}-0-999&name=${encodeURIComponent(DISH_NAME)}&cat=${encodeURIComponent(DISH_CATEGORY)}&stand=licht`);
  check('og:image: een ongeldige positie geeft 404 in plaats van een verzonnen kaart', invalid.status === 404, invalid.status);

  // Het apple-touch-icon van 180 × 180.
  if (appleIcon.includes('href="')) {
    const href = /href="([^"]+)"/.exec(appleIcon)[1];
    const res = await fetch(`${APP}${href}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const size = pngSize(buffer);
    check('app-icoon: PNG van 180 × 180', res.status === 200 && size.width === 180 && size.height === 180, JSON.stringify({ status: res.status, size, type: res.headers.get('content-type') }));
    fs.writeFileSync(path.join(OUT_DIR, 'be44-apple-touch-icon.png'), buffer);
  } else {
    check('app-icoon: PNG van 180 × 180', false, 'geen apple-touch-icon-link gevonden');
  }
}



// ── Uitvoering ──────────────────────────────────────────────────────────────
async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: 'run-be44-browser-check.js' });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let server = null;
  let browser = null;
  let cdp = null;
  let scenarioRuns = [];

  try {
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: `/menu/${MENU_ID}` });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      ticket: '#105 BE-44 deel 1 — een gerecht delen met voorvertoning',
      kind: 'developer evidence — local build, no production data or credentials',
      app: APP,
      filter: SELECTION.filter,
      scenarios: scenarioRuns,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshots: shots,
      fixture: {
        menu: MENU_ID,
        dish: DISH_ID,
        name: DISH_NAME,
        category: DISH_CATEGORY,
        price: DISH_PRICE,
        restaurant: RESTAURANT_NAME,
        address: ADDRESS,
        deepLink: DEEP_LINK,
      },
      gaps: [
        'Het systeemdeelmenu zelf is van de telefoon: navigator.share is in deze check een stub die de payload vastlegt, geen echte share-sheet.',
        'Het klembord is een stub: de check bewijst welke link gekopieerd wordt en dat de melding verschijnt, niet het echte systeemklembord.',
        'Dit is developer-evidence op een lokale build: geen productie, geen echte Supabase-credentials, geen merge of publicatie.',
        'De app-brede AI-activering valt buiten deze opdracht; er is hier niets aan AI of Supabase geactiveerd.',
      ],
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    const outPath = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ result: record.result, checks: checks.length, failed: failed.length, screenshots: shots.length, evidence: outPath }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
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

