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
// BE-44 deel 2 (criterium 4, deze ronde) legt daarnaast vast, per viewport
// (1280, 390, 320 px) en per stand (licht, donker):
//   - de knop "Bewaren" naast "Delen": "Bewaard" met aria-pressed en een
//     gevulde bladwijzer zodra hij aanstaat, en die stand overleeft een reload;
//   - de onderbalk "<n> bewaard · Bekijken →" zodra er iets bewaard is;
//   - "Mijn lijstje" met gerecht, restaurant en prijs, verwijderen per gerecht
//     en "Lijstje delen" (alleen de link, net als bij één gerecht);
//   - het gedeelde lijstje: "Gedeeld lijstje · <n> gerechten", elk gerecht aan
//     te tikken, de telling van wat niet meer bestaat en "Zet ze op mijn eigen
//     lijstje";
//   - de og:image van het lijstje (licht en donker) als PNG van 1200 × 630 en
//     de metadata van de gedeelde lijstlink.
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
// Het tweede gerecht van dezelfde kaart (zonder prijs: "op aanvraag"), zodat
// het lijstje echt twee verschillende regels heeft.
const SECOND_DISH_ID = '6-diner-0-1';
const SECOND_DISH_NAME = 'Kreeft (pasta)';
const SECOND_DISH_PRICE = 'op aanvraag';
// Een id dat niet bestaat: de ontvanger van een lijstje moet die stil
// overslaan en zeggen hoeveel er mist.
const UNKNOWN_DISH_ID = '99-diner-0-0';
const SAVED_LIST_KEY = 'bredaeats_bewaard';
// Zo bouwt de pagina hem zelf (buildDishDeepLink + de stand van dit moment).
const DEEP_LINK = `/menu/${MENU_ID}?dish=${DISH_ID}&name=${encodeURIComponent(DISH_NAME).replace(/%20/g, '+')}&cat=${encodeURIComponent(DISH_CATEGORY).replace(/%20/g, '+')}`;

const SCENARIOS = [
  { name: 'delen', run: (cdp) => delenScenario(cdp) },
  { name: 'ontvanger', run: (cdp) => ontvangerScenario(cdp) },
  { name: 'bewaren', run: (cdp) => bewarenScenario(cdp) },
  { name: 'mijn-lijstje', run: (cdp) => mijnLijstjeScenario(cdp) },
  { name: 'gedeeld-lijstje', run: (cdp) => gedeeldLijstjeScenario(cdp) },
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
  return clickUntilWith(cdp, clickShareJs(name), observedJs, timeoutMs);
}

/**
 * Dezelfde wachtlus voor elke andere knop: klikken, kijken of het effect
 * optreedt, en dat herhalen tot de pagina echt interactief is.
 */
async function clickUntilWith(cdp, clickJs, observedJs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  while (Date.now() < deadline) {
    clicked = await evalJs(cdp, clickJs);
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

// ── Bewaren en het lijstje: helpers in de pagina (criterium 4) ──────────────

/** De knop "Bewaren" van dit gerecht, met de stand uit aria-pressed. */
function readSaveJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    const button = card ? card.querySelector('.dish-save-btn') : null;
    const icon = button ? button.querySelector('svg') : null;
    const bar = document.querySelector('.saved-list-bar');
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(${JSON.stringify(SAVED_LIST_KEY)}) || '[]'); } catch (error) { stored = null; }
    return {
      label: button ? flat(button.innerText) : null,
      pressed: button ? button.getAttribute('aria-pressed') : null,
      box: button ? box(button) : null,
      iconFill: icon ? icon.getAttribute('fill') : null,
      bar: bar ? flat(bar.innerText) : null,
      barHref: bar ? bar.getAttribute('href') : null,
      barBox: bar ? box(bar) : null,
      stored: Array.isArray(stored) ? stored.map((entry) => entry.id) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}

/**
 * De hele lijstpagina in één keer: kop, regels, knoppen, de melding en wat er
 * in de opslag staat. Werkt voor het eigen lijstje én voor een gedeeld lijstje.
 */
function readListPageJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const rows = [...document.querySelectorAll('.lijst-row')].map((row) => {
      const link = row.querySelector('.lijst-row-link');
      return {
        name: flat((row.querySelector('.lijst-row-name') || {}).innerText),
        meta: flat((row.querySelector('.lijst-row-meta') || {}).innerText),
        price: flat((row.querySelector('.lijst-row-price') || {}).innerText),
        href: link ? link.getAttribute('href') : null,
        remove: Boolean(row.querySelector('.lijst-remove')),
      };
    });
    const status = document.querySelector('.lijst-status') || document.querySelector('[role="status"]');
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(${JSON.stringify(SAVED_LIST_KEY)}) || '[]'); } catch (error) { stored = null; }
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      title: flat((document.querySelector('.lijst-title') || {}).innerText),
      skipped: flat((document.querySelector('.lijst-skipped') || {}).innerText),
      empty: flat((document.querySelector('.lijst-empty') || {}).innerText),
      addLabel: flat((document.querySelector('.lijst-add-btn') || {}).innerText),
      shareLabel: flat((document.querySelector('.lijst-share-btn') || {}).innerText),
      status: status ? flat(status.innerText) : null,
      rows,
      stored: Array.isArray(stored) ? stored.map((entry) => entry.id) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}

function clickSaveJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    const button = card ? card.querySelector('.dish-save-btn') : null;
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function clickFirstJs(selector) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
}

/** Wachten tot de knop van dit gerecht aan (of uit) staat. */
function savePressedJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    const button = card ? card.querySelector('.dish-save-btn') : null;
    return Boolean(button && button.getAttribute('aria-pressed') === 'true');
  })()`;
}

function saveReleasedJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    const button = card ? card.querySelector('.dish-save-btn') : null;
    return Boolean(button && button.getAttribute('aria-pressed') === 'false');
  })()`;
}

const SAVE_OBSERVED = savePressedJs(DISH_NAME);
const UNSAVE_OBSERVED = saveReleasedJs(DISH_NAME);
const SAVED_LIST_CLEARED = `localStorage.removeItem(${JSON.stringify(SAVED_LIST_KEY)})`;

/** De menukaart openen met een lege bewaarlijst en de gevraagde stand. */
async function openMenu(cdp, width, theme) {
  await setViewport(cdp, width, width === 1280 ? 950 : 844);
  await setTheme(cdp, theme);
  await evalJs(cdp, SAVED_LIST_CLEARED);
  await navigate(
    cdp,
    `${APP}/menu/${MENU_ID}`,
    `Boolean([...document.querySelectorAll('.menu-card .td-name')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(DISH_NAME)}))`,
  );
}

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

        // De opdracht vraagt de melding "Link gekopieerd" op alle drie de
        // breedtes: ook op de telefoon, waar het systeemmenu de normale route
        // is, forceren we hier het klembord-alternatief voor de opname.
        await evalJs(cdp, CLIPBOARD_STUB);
        const { observed: copiedReady } = await clickUntil(cdp, DISH_NAME, COPIED_OBSERVED);
        const copiedAfter = await evalJs(cdp, readCardJs(DISH_NAME));
        const mobileCopied = await evalJs(cdp, 'window.__copied');
        check(`delen (${label}): ook zonder systeemmenu verschijnt "Link gekopieerd"`, copiedReady && copiedAfter.statusText === 'Link gekopieerd', JSON.stringify({ status: copiedAfter.statusText }));
        check(`delen (${label}): dat klembord kreeg dezelfde link`, mobileCopied === expectedShareUrl(theme), mobileCopied);
        await evalJs(cdp, focusCardJs(DISH_NAME));
        await new Promise((resolve) => setTimeout(resolve, 250));
        await shot(cdp, `be44-melding-${width}-${theme}.png`, { scenario: 'delen', state: 'melding', theme, width });
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

// ── 4. Bewaren en de onderbalk (criterium 4) ────────────────────────────────
async function bewarenScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      await openMenu(cdp, width, theme);

      const before = await evalJs(cdp, readSaveJs(DISH_NAME));
      check(`bewaren (${label}): de knop heet "Bewaren" en staat niet aan`, before.label === 'Bewaren' && before.pressed === 'false', JSON.stringify({ label: before.label, pressed: before.pressed }));
      check(`bewaren (${label}): het tikvlak is minstens 44 × 44 px`, Boolean(before.box) && before.box.height >= 44 && before.box.width >= 44, JSON.stringify(before.box));
      check(`bewaren (${label}): zonder bewaard gerecht is er geen onderbalk`, before.bar === null, before.bar);

      const saveClick = await clickUntilWith(cdp, clickSaveJs(DISH_NAME), SAVE_OBSERVED);
      const saved = await evalJs(cdp, readSaveJs(DISH_NAME));
      check(`bewaren (${label}): de knop wordt "Bewaard" met aria-pressed`, saveClick.observed && saved.label === 'Bewaard' && saved.pressed === 'true', JSON.stringify({ label: saved.label, pressed: saved.pressed }));
      check(`bewaren (${label}): de bladwijzer is gevuld`, saved.iconFill === 'currentColor', saved.iconFill);
      check(`bewaren (${label}): het gerecht staat in localStorage`, JSON.stringify(saved.stored) === JSON.stringify([DISH_ID]), JSON.stringify(saved.stored));
      check(`bewaren (${label}): de onderbalk zegt "1 bewaard · Bekijken →"`, saved.bar === '1 bewaard · Bekijken →', saved.bar);
      check(`bewaren (${label}): de onderbalk linkt naar het lijstje`, saved.barHref === '/mijn-lijstje', saved.barHref);
      check(`bewaren (${label}): de onderbalk heeft een tikvlak van minstens 44 px`, Boolean(saved.barBox) && saved.barBox.height >= 44, JSON.stringify(saved.barBox));
      check(`bewaren (${label}): geen horizontale overloop`, saved.overflow <= 0, `overflow=${saved.overflow}`);

      await evalJs(cdp, focusCardJs(DISH_NAME));
      await new Promise((resolve) => setTimeout(resolve, 250));
      await shot(cdp, `be44-bewaard-${width}-${theme}.png`, { scenario: 'bewaren', theme, width });
      await shot(cdp, `be44-onderbalk-${width}-${theme}.png`, { scenario: 'onderbalk', theme, width });

      // De stand overleeft een reload: het lijstje staat in de browser, niet in
      // het geheugen van deze pagina.
      await navigate(cdp, `${APP}/menu/${MENU_ID}`, `Boolean(document.querySelector('.dish-save-btn'))`);
      await waitFor(cdp, SAVE_OBSERVED, 8000);
      const reloaded = await evalJs(cdp, readSaveJs(DISH_NAME));
      check(`bewaren (${label}): na een reload staat hij nog op "Bewaard"`, reloaded.label === 'Bewaard' && reloaded.pressed === 'true', JSON.stringify({ label: reloaded.label }));
      check(`bewaren (${label}): de onderbalk staat er na de reload ook`, reloaded.bar === '1 bewaard · Bekijken →', reloaded.bar);

      // En weer uitzetten: de balk verdwijnt en de opslag is leeg.
      await clickUntilWith(cdp, clickSaveJs(DISH_NAME), UNSAVE_OBSERVED);
      const released = await evalJs(cdp, readSaveJs(DISH_NAME));
      check(`bewaren (${label}): uitgezet is hij weer "Bewaren"`, released.label === 'Bewaren' && released.pressed === 'false', JSON.stringify({ label: released.label }));
      check(`bewaren (${label}): dan is er weer geen onderbalk en is de opslag leeg`, released.bar === null && Array.isArray(released.stored) && released.stored.length === 0, JSON.stringify({ bar: released.bar, stored: released.stored }));
    }
  }
}

// ── 5. "Mijn lijstje": het eigen lijstje (criterium 4) ──────────────────────
async function mijnLijstjeScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      await openMenu(cdp, width, theme);
      await clickUntilWith(cdp, clickSaveJs(DISH_NAME), SAVE_OBSERVED);
      await clickUntilWith(cdp, clickSaveJs(SECOND_DISH_NAME), savePressedJs(SECOND_DISH_NAME));

      await navigate(cdp, `${APP}/mijn-lijstje`, `Boolean(document.querySelector('.lijst-title'))`);
      await waitFor(cdp, `document.querySelectorAll('.lijst-row').length === 2`, 8000);
      const page = await evalJs(cdp, readListPageJs());

      check(`mijn lijstje (${label}): de pagina heet "Mijn lijstje"`, page.title === 'Mijn lijstje', page.title);
      check(`mijn lijstje (${label}): beide bewaarde gerechten staan erin`, page.rows.length === 2, JSON.stringify(page.rows.map((row) => row.name)));
      check(`mijn lijstje (${label}): gerecht, restaurant en prijs staan per regel`, page.rows[0].name === DISH_NAME && page.rows[0].meta === RESTAURANT_NAME && page.rows[0].price === DISH_PRICE, JSON.stringify(page.rows[0]));
      check(`mijn lijstje (${label}): een gerecht zonder prijs zegt "op aanvraag"`, page.rows[1].price === SECOND_DISH_PRICE, JSON.stringify(page.rows[1]));
      check(`mijn lijstje (${label}): elk gerecht is aan te tikken naar de menukaart`, page.rows.every((row) => (row.href || '').startsWith(`/menu/${MENU_ID}?dish=`)), JSON.stringify(page.rows.map((row) => row.href)));
      check(`mijn lijstje (${label}): elk gerecht heeft een verwijderknop`, page.rows.every((row) => row.remove === true));
      check(`mijn lijstje (${label}): "Lijstje delen" staat erbij`, page.shareLabel === 'Lijstje delen', page.shareLabel);
      check(`mijn lijstje (${label}): geen horizontale overloop`, page.overflow <= 0, `overflow=${page.overflow}`);
      await shot(cdp, `be44-mijn-lijstje-${width}-${theme}.png`, { scenario: 'mijn-lijstje', theme, width });

      // "Lijstje delen" geeft alleen de link, met de id's en de stand.
      await evalJs(cdp, CLIPBOARD_STUB);
      const shared = await clickUntilWith(cdp, clickFirstJs('.lijst-share-btn'), 'Boolean(window.__copied)');
      const copied = await evalJs(cdp, 'window.__copied');
      const expectedListUrl = `${APP}/mijn-lijstje?lijst=${DISH_ID},${SECOND_DISH_ID}&stand=${standFor(theme)}`;
      check(`mijn lijstje (${label}): "Lijstje delen" kopieert de lijstlink`, shared.observed && copied === expectedListUrl, JSON.stringify({ copied, expectedListUrl }));

      // Verwijderen per gerecht.
      const removed = await clickUntilWith(cdp, clickFirstJs('.lijst-remove'), `document.querySelectorAll('.lijst-row').length === 1`);
      const afterRemove = await evalJs(cdp, readListPageJs());
      check(`mijn lijstje (${label}): verwijderen haalt één gerecht weg`, removed.observed && afterRemove.rows.length === 1, JSON.stringify({ rows: afterRemove.rows.length }));
      check(`mijn lijstje (${label}): de opslag houdt één gerecht over`, Array.isArray(afterRemove.stored) && afterRemove.stored.length === 1, JSON.stringify(afterRemove.stored));
    }
  }
}

// ── 6. Het gedeelde lijstje voor de ontvanger (criterium 4) ─────────────────
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

async function gedeeldLijstjeScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      // De stand in de link is opzettelijk de tegenovergestelde stand: hij kiest
      // alleen de kleur van de voorvertoning, nooit het thema van de pagina.
      const stand = standFor(theme === 'dark' ? 'light' : 'dark');
      const sharedList = `/mijn-lijstje?lijst=${DISH_ID},${SECOND_DISH_ID},${UNKNOWN_DISH_ID}&stand=${stand}`;
      await setViewport(cdp, width, width === 1280 ? 950 : 844);
      await setTheme(cdp, theme);
      await evalJs(cdp, SAVED_LIST_CLEARED);
      await navigate(cdp, `${APP}${sharedList}`, `Boolean(document.querySelector('.lijst-title'))`);
      // De themakeuze bestaat pas na hydratatie; wachten daarop betekent dat de
      // schermafbeelding de echte, interactieve pagina laat zien.
      await waitFor(cdp, 'Boolean(document.querySelector(".theme-switch"))', 8000);

      const page = await evalJs(cdp, readListPageJs());
      check(`gedeeld lijstje (${label}): de kop is "Gedeeld lijstje · 2 gerechten"`, page.title === 'Gedeeld lijstje · 2 gerechten', page.title);
      check(`gedeeld lijstje (${label}): de pagina zegt hoeveel er mist`, page.skipped === 'Niet meer beschikbaar: 1', page.skipped);
      check(`gedeeld lijstje (${label}): elk gerecht is aan te tikken`, page.rows.length === 2 && page.rows.every((row) => (row.href || '').startsWith(`/menu/${MENU_ID}?dish=`)), JSON.stringify(page.rows.map((row) => row.href)));
      check(`gedeeld lijstje (${label}): gerecht, restaurant en prijs staan erbij`, page.rows[0].name === DISH_NAME && page.rows[0].meta === RESTAURANT_NAME && page.rows[0].price === DISH_PRICE, JSON.stringify(page.rows[0]));
      check(`gedeeld lijstje (${label}): "Zet ze op mijn eigen lijstje" staat klaar`, page.addLabel === 'Zet ze op mijn eigen lijstje', page.addLabel);
      check(`gedeeld lijstje (${label}): de stand in de link verandert het thema niet`, page.theme === theme, JSON.stringify({ theme: page.theme, stand }));
      check(`gedeeld lijstje (${label}): geen horizontale overloop`, page.overflow <= 0, `overflow=${page.overflow}`);
      await shot(cdp, `be44-gedeeld-lijstje-${width}-${theme}.png`, { scenario: 'gedeeld-lijstje', theme, width, link: sharedList });

      const added = await clickUntilWith(
        cdp,
        clickFirstJs('.lijst-add-btn'),
        `(() => { const s = document.querySelector('.lijst-status'); return Boolean(s && s.innerText.trim()); })()`,
      );
      const after = await evalJs(cdp, readListPageJs());
      check(`gedeeld lijstje (${label}): overnemen meldt "Op je lijstje gezet"`, added.observed && after.status === 'Op je lijstje gezet', JSON.stringify({ status: after.status }));
      check(`gedeeld lijstje (${label}): beide gerechten staan nu in de eigen opslag`, JSON.stringify(after.stored) === JSON.stringify([DISH_ID, SECOND_DISH_ID]), JSON.stringify(after.stored));
    }
  }
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

  // ── BE-44 criterium 4: de voorvertoning van een gedeeld lijstje ───────────
  const listUrl = `${APP}/mijn-lijstje?lijst=${DISH_ID},${SECOND_DISH_ID}&stand=donker`;
  const listResponse = await fetch(listUrl);
  const listHtml = await listResponse.text();
  check('lijstje: de gedeelde link antwoordt met 200', listResponse.status === 200, listResponse.status);
  check('lijstje: og:title is "<n> gerechten om uit te kiezen"', metaContent(listHtml, 'og:title') === '2 gerechten om uit te kiezen', metaContent(listHtml, 'og:title'));
  check('lijstje: og:description noemt de restaurants', String(metaContent(listHtml, 'og:description') || '').includes(RESTAURANT_NAME), metaContent(listHtml, 'og:description'));
  check('lijstje: og:url is precies de gedeelde lijstlink', metaContent(listHtml, 'og:url') === listUrl, metaContent(listHtml, 'og:url'));
  check('lijstje: de kop "Gedeeld lijstje · 2 gerechten" staat in de HTML', listHtml.includes('Gedeeld lijstje · 2 gerechten'), 'kop niet gevonden');
  const listImageMeta = metaContent(listHtml, 'og:image');
  check('lijstje: og:image is de eigen afbeelding van het lijstje', String(listImageMeta || '').includes('/mijn-lijstje/share-image?'), listImageMeta);

  const listImages = {};
  for (const theme of ['licht', 'donker']) {
    const url = `${APP}/mijn-lijstje/share-image?lijst=${DISH_ID},${SECOND_DISH_ID}&stand=${theme}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const size = pngSize(buffer);
    listImages[theme] = { buffer, bytes: buffer.length, size, status: res.status, type: res.headers.get('content-type') };
    fs.writeFileSync(path.join(OUT_DIR, `be44-lijst-og-image-${theme}.png`), buffer);
    check(`lijstje og:image (${theme}): PNG van 1200 × 630`, res.status === 200 && String(listImages[theme].type).includes('image/png') && size.width === 1200 && size.height === 630, JSON.stringify({ status: res.status, type: listImages[theme].type, size }));
  }
  check('lijstje og:image: licht en donker zijn echt twee verschillende afbeeldingen', listImages.licht.bytes > 0 && !listImages.licht.buffer.equals(listImages.donker.buffer), JSON.stringify({ licht: listImages.licht.bytes, donker: listImages.donker.bytes }));

  const emptyList = await fetch(`${APP}/mijn-lijstje/share-image?lijst=onzin`);
  check('lijstje og:image: een leeg of ongeldig lijstje geeft 404', emptyList.status === 404, emptyList.status);

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
      ticket: '#105 BE-44 deel 2 — bewaren, het lijstje en de voorvertoning',
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
        'Het lijstje is localStorage in een tijdelijk browserprofiel: de check bewijst de opslag, de stand na een reload en het verwijderen, geen privémodus of volle schijf.',
        'De voorvertoning van het lijstje is een PNG van deze build; of externe platforms hem precies zo tonen, is niet in een browsercheck te bewijzen.',
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

