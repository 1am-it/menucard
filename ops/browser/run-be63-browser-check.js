'use strict';

// BE-63 (#155, ronde 4) — browsercheck voor de kop en /inloggen.
//
// Fixture-bewijs: een echte browser via CDP en de echte pagina's, met een verse
// productieopbouw (`next build` + `next start` in een eigen bouwmap, de
// BE-57-opzet). Geen Supabase-project, geen productiesleutel, geen
// productiedata. De sessie van de ingelogde kop komt uit de bestaande BE-59-stub
// (ops/browser/lib/be59-stub-page.js): een fictieve sessie in localStorage.
//
// Wat gemeten wordt:
//  - de kop als gast op 1280, 390 en 320 px: op 1280 "Voor restaurants",
//    Inloggen en de instellingenknop; op 390 en 320 alleen Inloggen en de
//    menuknop; geen horizontale overloop; de kop blijft op één regel (de hoogte
//    wordt per breedte vastgelegd);
//  - de kop als ingelogd: het bestaande accountmenu in plaats van Inloggen;
//  - het instellingenpaneel op desktop: het thema wisselt (Licht, Donker en
//    Automatisch) en "Delen via" opent het BE-61-venster;
//  - het mobiele menu: alle onderdelen in beeld, boven de tabbalk
//    (`elementFromPoint` in het midden van de laatste regel) en Esc sluit het
//    menu waarbij de focus terugkeert;
//  - /inloggen: het formulier (label, e-mailveld van 52 px, knop "Stuur mij een
//    inlogcode" van 52 px in --button-primary-bg), het claimblok met drie
//    stappen en de teamlink, in licht en donker op de drie breedtes.
//
// Het thema van elke opname is aangetoond, niet aangenomen: vóór de opname gaat
// het thema via de themakeuze in het paneel zelf en legt themeProof `data-theme`,
// de actieve knop en de helderheid van `--bg` vast.
//
// Niet bewezen hier: de inlog zelf (geen Supabase-project) en de a11y-run (die
// draait apart: ops/browser/run-a11y-public-check.js). Dit is
// ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be63-browser-check.js [--alleen=<scenario>] [--lijst]
// Poort: BE63_PORT of 3189 (binnen 3180-3189). Draai deze check alleen.

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
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const { parseScenarioArgs, scenarioSelectionOutcome, runScenarioSelection } = require('./lib/scenario-filter');
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const { be59StubScript } = require('./lib/be59-stub-page');

const SCRIPT_NAME = 'run-be63-browser-check.js';
const PORT = Number(process.env.BE63_PORT || 3189);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-63');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be63-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-63');
// De nieuwe pagina uit dit ticket: statisch opgebouwd, met dezelfde gedeelde kop
// (site-header + header-inner) als de andere publieke pagina's en zonder
// API-aanroepen bij het laden. De kop, het instellingenpaneel en het mobiele menu
// worden hier gemeten; de hero van de homepage (PR #159) blijft ongemoeid.
const PAGE = '/inloggen';
const LOGIN_PAGE = '/inloggen';

const SIZES = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];

const SETTINGS_BUTTON = '.pha-settings';
const MENU_BUTTON = '.pha-menu';
const PANEL = '.pha-panel';

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Een volledige viewport, geen uitsnede: de kop, het paneel en de vaste
  // tabbalk moeten samen op de opname staan. De opname is altijd een PNG.
  const file = await screenshot(cdp, SHOT_DIR, `${name}.png`);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    state: meta.state || null,
    themeProof: meta.themeProof || null,
  });
  return file;
}

async function themeProof(cdp) {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

// Het paneel openen zoals een bezoeker het opent: de instellingenknop op
// desktop, de menuknop op de telefoon. Beide knoppen bestaan al vóór de
// hydratatie, dus een klik die niets opent wordt herhaald.
async function openPanel(cdp, opener) {
  if (await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`)) return true;
  const ready = await waitFor(cdp, `Boolean(document.querySelector('${opener}'))`, 15000);
  if (!ready) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const b = document.querySelector('${opener}'); if (!b) return false; b.click(); return true; })()`);
    const open = await waitFor(cdp, `Boolean(document.querySelector('${PANEL}'))`, 4000);
    if (open) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

async function closePanel(cdp) {
  if (!(await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`))) return true;
  await evalJs(cdp, `(() => { const b = document.querySelector('.pha-close'); if (!b) return false; b.click(); return true; })()`);
  return (await waitFor(cdp, `!document.querySelector('${PANEL}')`, 6000)) === true;
}

/**
 * Het thema zetten via de themakeuze in het paneel zelf (geen los attribuut en
 * geen schrijfactie in de opslag). Geeft het bewijs terug waarmee de opname
 * wordt gecontroleerd.
 */
async function applyTheme(cdp, theme, opener) {
  const label = THEME_LABELS[theme];
  if (!(await openPanel(cdp, opener))) throw new Error(`panel_missing: ${opener}`);
  const klaar = await waitFor(cdp, `document.querySelectorAll('.theme-btn').length >= 2`, 15000);
  if (!klaar) throw new Error(`theme_button_missing: ${label}`);
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(label));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
    await sleep(300);
    const proof = await themeProof(cdp);
    if (themeOk(proof, theme)) return proof;
  }
  throw new Error(`theme_not_applied: ${label}`);
}

const HEADER_STATE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    const visible = st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    return {
      visible, top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  };
  const tekst = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  };
  // De kopregel van de publieke pagina's. Niet elke pagina geeft het <header>
  // een klassenaam (/mijn-lijstje heeft een gewone <header> met daaronder nog
  // een paginatitel), dus meet de rij van de knoppen zelf: .header-inner.
  const header =
    document.querySelector('.header-inner') ||
    document.querySelector('.site-header') ||
    document.querySelector('header');
  const hr = header ? header.getBoundingClientRect() : null;
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    header: hr ? { top: Math.round(hr.top), bottom: Math.round(hr.bottom), height: Math.round(hr.height) } : null,
    restaurants: box('.pha-restaurants'),
    restaurantsTekst: tekst('.pha-restaurants'),
    login: box('.pha-login'),
    loginTekst: tekst('.pha-login'),
    settings: box('.pha-settings'),
    menu: box('.pha-menu'),
    account: box('.account-menu-trigger'),
  };
})()`;

const readHeader = (cdp) => evalJs(cdp, HEADER_STATE);
const zichtbaar = (b) => Boolean(b && b.visible);
// Twee knoppen staan op één regel als hun verticale midden samenvalt. De hoogte
// van de knoppen verschilt (een tekstlink is lager dan een knop van 44 px),
// daarom vergelijken we het midden en niet de boven- of onderkant.
const zelfdeRegel = (a, b) => {
  if (!a || !b) return false;
  const middenA = (a.top + a.bottom) / 2;
  const middenB = (b.top + b.bottom) / 2;
  return Math.abs(middenA - middenB) <= 3;
};

// Naar een element scrollen en pas daarna meten: met een smooth-scroll in de
// pagina zou een directe meting nog de oude positie zien. De vaste tabbalk telt
// als onderkant van het zichtbare gebied.
async function scrollEnMeet(cdp, selector) {
  const gevonden = await evalJs(
    cdp,
    `(() => { const el = document.querySelector('${selector}'); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`,
  );
  if (!gevonden) return null;
  await sleep(350);
  return evalJs(
    cdp,
    `(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const tabbar = document.querySelector('.mobile-tabbar');
      const tr = tabbar ? tabbar.getBoundingClientRect() : null;
      const onderkant = tr && tr.height > 0 ? tr.top : window.innerHeight;
      return {
        inBeeld: r.top >= -1 && r.left >= -1 && r.bottom <= onderkant + 1 && r.right <= window.innerWidth + 1,
        top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
        viewportHeight: window.innerHeight, onderkant: Math.round(onderkant),
        scrollY: Math.round(window.scrollY),
      };
    })()`,
  );
}

const MENU_STATE = `(() => {
  const panel = document.querySelector('.pha-panel');
  if (!panel) return { open: false };
  const tekst = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  };
  const inBeeld = (b) => Boolean(b) && b.top >= -1 && b.left >= -1 && b.bottom <= window.innerHeight + 1 && b.right <= window.innerWidth + 1;
  const rijen = [...panel.querySelectorAll('.pha-row')];
  const laatste = rijen[rijen.length - 1];
  const laatsteBox = box(laatste);
  const punt = laatsteBox
    ? { x: Math.floor((laatsteBox.left + laatsteBox.right) / 2), y: Math.floor((laatsteBox.top + laatsteBox.bottom) / 2) }
    : null;
  const top = punt ? document.elementFromPoint(punt.x, punt.y) : null;
  const tabbar = document.querySelector('.mobile-tabbar');
  const tabbarBox = box(tabbar);
  const panelBox = box(panel);
  return {
    open: true,
    panel: panelBox,
    panelInBeeld: inBeeld(panelBox),
    titel: tekst(panel.querySelector('.pha-panel-title')),
    restaurantTitel: tekst(panel.querySelector('.pha-restaurant-title')),
    restaurantTekst: tekst(panel.querySelector('.pha-restaurant-text')),
    restaurantKnoppen: [...panel.querySelectorAll('.pha-restaurant-actions a')].map(tekst),
    restaurantInBeeld: inBeeld(box(panel.querySelector('.pha-restaurant'))),
    bezoeker: tekst(panel.querySelector('.pha-visitor-note')),
    weergave: [...panel.querySelectorAll('.theme-btn')].map(tekst),
    weergaveInBeeld: inBeeld(box(panel.querySelector('.theme-switch'))),
    delen: tekst(panel.querySelector('.pha-share')),
    delenInBeeld: inBeeld(box(panel.querySelector('.pha-share'))),
    rijen: rijen.length,
    laatste: laatsteBox,
    laatsteTekst: tekst(laatste),
    laatsteInBeeld: inBeeld(laatsteBox),
    laatsteTop: top ? { cls: String(top.className || ''), binnen: Boolean(laatste && (top === laatste || laatste.contains(top))) } : null,
    tabbar: tabbarBox,
    tabbarZichtbaar: Boolean(tabbarBox && tabbarBox.width > 0 && tabbarBox.height > 0),
    overlaptTabbalk: Boolean(panelBox && tabbarBox && tabbarBox.height > 0 && panelBox.bottom > tabbarBox.top),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    focus: document.activeElement ? String(document.activeElement.className || document.activeElement.tagName) : '',
  };
})()`;

const SETTINGS_STATE = `(() => {
  const panel = document.querySelector('.pha-panel');
  if (!panel) return { open: false };
  const tekst = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  return {
    open: true,
    titel: tekst(panel.querySelector('.pha-panel-title')),
    weergave: [...panel.querySelectorAll('.theme-btn')].map((b) => ({
      label: tekst(b),
      pressed: b.getAttribute('aria-pressed') === 'true',
    })),
    theme: document.documentElement.getAttribute('data-theme'),
    deelKnop: tekst(panel.querySelector('.pha-share')),
    deelVenster: Boolean(document.querySelector('.share-sheet')),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

const LOGIN_STATE = `(() => {
  const tekst = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const inBeeld = (b) => Boolean(b) && b.top >= -1 && b.left >= -1 && b.bottom <= window.innerHeight + 1 && b.right <= window.innerWidth + 1;
  const probe = document.createElement('div');
  probe.style.background = 'var(--button-primary-bg)';
  document.body.appendChild(probe);
  const tokenKleur = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const input = document.querySelector('.inloggen-form input[type="email"]');
  const submit = document.querySelector('.inloggen-form .auth-submit');
  const label = document.querySelector('.inloggen-form label[for="owner-email"]');
  const claim = document.querySelector('.inloggen-claim');
  const team = document.querySelector('.inloggen-team-link');
  const action = document.querySelector('.inloggen-claim-action');
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    h1: tekst(document.querySelector('h1')),
    eyebrow: tekst(document.querySelector('.inloggen-eyebrow')),
    intro: tekst(document.querySelector('.inloggen-intro')),
    label: tekst(label),
    input: input ? { type: input.getAttribute('type'), box: box(input) } : null,
    submit: submit ? { tekst: tekst(submit), box: box(submit), kleur: getComputedStyle(submit).backgroundColor, tokenKleur } : null,
    help: tekst(document.querySelector('.inloggen-form .auth-help')),
    claim: claim ? { titel: tekst(claim.querySelector('.inloggen-claim-title')), tekst: tekst(claim.querySelector('.inloggen-claim-body')), stappen: [...claim.querySelectorAll('.inloggen-step-text')].map(tekst), box: box(claim), inBeeld: inBeeld(box(claim)) } : null,
    action: action ? { tekst: tekst(action), href: action.getAttribute('href') } : null,
    bezoeker: tekst(document.querySelector('.inloggen-visitor')),
    team: team ? { tekst: tekst(team), href: team.getAttribute('href'), box: box(team), inBeeld: inBeeld(box(team)) } : null,
  };
})()`;

async function gastScenario(cdp) {
  for (const size of SIZES) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('.pha-menu'))`);
    const opener = size.width >= 900 ? SETTINGS_BUTTON : MENU_BUTTON;

    const licht = await applyTheme(cdp, 'light', opener);
    await closePanel(cdp);
    const state = await readHeader(cdp);
    await shot(cdp, `be63-kop-gast-${size.name}-licht`, { theme: 'light', themeProof: licht, state: 'gast' });

    const donker = await applyTheme(cdp, 'dark', opener);
    await closePanel(cdp);
    await sleep(120);
    await shot(cdp, `be63-kop-gast-${size.name}-donker`, { theme: 'dark', themeProof: donker, state: 'gast' });

    const prefix = `kop als gast ${size.name}`;
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    // Op 1280 en 390 blijft de kop één regel (hoogte ≤ 96 px); het ontwerp staat
    // op 320 px een compacte kop toe. De gemeten hoogte staat in het detail,
    // zodat de review hem kan beoordelen.
    check(`${prefix}: de kop staat op één regel (hoogte vastgelegd)`,
      Boolean(state.header) && state.header.height > 0 && state.header.height <= (size.width < 390 ? 132 : 96),
      state.header ? `hoogte ${state.header.height}px` : 'geen header');
    check(`${prefix}: het thema is aangetoond in licht en donker`, themeOk(licht, 'light') && themeOk(donker, 'dark'),
      `${JSON.stringify(licht.attr)}/${JSON.stringify(donker.attr)}`);

    if (size.width >= 900) {
      check(`${prefix}: "Voor restaurants" staat in de kop`,
        zichtbaar(state.restaurants) && /Voor restaurants/.test(state.restaurantsTekst), state.restaurantsTekst);
      check(`${prefix}: Inloggen en de instellingenknop staan ernaast`,
        zichtbaar(state.login) && state.loginTekst === 'Inloggen' && zichtbaar(state.settings),
        `${state.loginTekst} / settings ${JSON.stringify(zichtbaar(state.settings))}`);
      check(`${prefix}: de menuknop is verborgen`, !zichtbaar(state.menu), JSON.stringify(state.menu));
      check(`${prefix}: de drie knoppen staan op één regel`,
        zelfdeRegel(state.restaurants, state.login) && zelfdeRegel(state.login, state.settings),
        `${JSON.stringify(state.restaurants && state.restaurants.top)}/${JSON.stringify(state.login && state.login.top)}/${JSON.stringify(state.settings && state.settings.top)}`);
    } else {
      check(`${prefix}: alleen Inloggen en de menuknop in de kop`,
        zichtbaar(state.login) && zichtbaar(state.menu) && !zichtbaar(state.restaurants) && !zichtbaar(state.settings),
        `login ${JSON.stringify(zichtbaar(state.login))} menu ${JSON.stringify(zichtbaar(state.menu))} restaurants ${JSON.stringify(zichtbaar(state.restaurants))} settings ${JSON.stringify(zichtbaar(state.settings))}`);
      check(`${prefix}: Inloggen en de menuknop staan op één regel`,
        zelfdeRegel(state.login, state.menu),
        `${JSON.stringify(state.login && state.login.top)}/${JSON.stringify(state.menu && state.menu.top)}`);
    }
  }
}

async function instellingenScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('${SETTINGS_BUTTON}'))`);

  const licht = await applyTheme(cdp, 'light', SETTINGS_BUTTON);
  const bijLicht = await evalJs(cdp, SETTINGS_STATE);
  await shot(cdp, 'be63-instellingen-1280-licht', { theme: 'light', themeProof: licht, state: 'settings' });
  check('instellingen 1280: het paneel staat open in licht', bijLicht.open === true, bijLicht.titel);
  check('instellingen 1280: "Licht" is de actieve keuze',
    bijLicht.weergave.filter((b) => b.pressed).map((b) => b.label).join('|') === 'Licht',
    JSON.stringify(bijLicht.weergave));
  check('instellingen 1280: thema licht is aangetoond', themeOk(licht, 'light'), licht.attr);

  const donker = await applyTheme(cdp, 'dark', SETTINGS_BUTTON);
  const bijDonker = await evalJs(cdp, SETTINGS_STATE);
  await shot(cdp, 'be63-instellingen-1280-donker', { theme: 'dark', themeProof: donker, state: 'settings' });
  check('instellingen 1280: "Donker" is de actieve keuze',
    bijDonker.weergave.filter((b) => b.pressed).map((b) => b.label).join('|') === 'Donker',
    JSON.stringify(bijDonker.weergave));
  check('instellingen 1280: thema donker is aangetoond', themeOk(donker, 'dark'), donker.attr);

  // "Automatisch" is de derde keuze en volgt het systeem.
  const geklikt = await evalJs(cdp, clickThemeScript('Automatisch'));
  const autoActief = await waitFor(
    cdp,
    `(() => { const b = [...document.querySelectorAll('.theme-btn')].find((x) => (x.textContent || '').trim() === 'Automatisch'); return Boolean(b && b.getAttribute('aria-pressed') === 'true'); })()`,
    6000,
  );
  const themaNa = await evalJs(cdp, `document.documentElement.getAttribute('data-theme')`);
  check('instellingen 1280: "Automatisch" is te kiezen en volgt het systeem',
    geklikt === 'clicked' && autoActief === true && (themaNa === 'light' || themaNa === 'dark'),
    `${geklikt} / ${JSON.stringify(autoActief)} / ${themaNa}`);
  await shot(cdp, 'be63-instellingen-1280-automatisch', { theme: null, state: 'settings-auto' });

  // "Delen via" opent het BE-61-venster vanuit hetzelfde paneel.
  const deelGeklikt = await evalJs(
    cdp,
    `(() => { const b = document.querySelector('.pha-share'); if (!b) return false; b.click(); return true; })()`,
  );
  const deelOpen = await waitFor(cdp, `Boolean(document.querySelector('.share-sheet'))`, 8000);
  const bijDelen = await evalJs(cdp, SETTINGS_STATE);
  check('instellingen 1280: "Delen via" opent het BE-61-venster',
    deelGeklikt === true && deelOpen === true && bijDelen.deelVenster === true,
    `${JSON.stringify(deelGeklikt)} / ${JSON.stringify(deelOpen)}`);
  check('instellingen 1280: geen horizontale overloop met het venster open', bijDelen.overflow <= 0, bijDelen.overflow);
  await shot(cdp, 'be63-instellingen-1280-delen', { theme: null, state: 'settings-share' });
}

async function menuScenario(cdp) {
  for (const size of [SIZES[1], SIZES[2]]) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('${MENU_BUTTON}'))`);

    const licht = await applyTheme(cdp, 'light', MENU_BUTTON);
    const state = await evalJs(cdp, MENU_STATE);
    await shot(cdp, `be63-menu-${size.name}-licht`, { theme: 'light', themeProof: licht, state: 'menu' });
    const donker = await applyTheme(cdp, 'dark', MENU_BUTTON);
    const inDonker = await evalJs(cdp, MENU_STATE);
    await shot(cdp, `be63-menu-${size.name}-donker`, { theme: 'dark', themeProof: donker, state: 'menu' });

    const prefix = `menu ${size.name}`;
    check(`${prefix}: het menu opent`, state.open === true, state.titel);
    check(`${prefix}: de titel is "Menu" en het paneel staat in beeld`,
      state.titel === 'Menu' && state.panelInBeeld === true,
      `${state.titel} / ${state.panelInBeeld}`);
    check(`${prefix}: het blok "Heb je een restaurant?" staat er met Inloggen en Claim je zaak`,
      state.restaurantTitel === 'Heb je een restaurant?'
        && state.restaurantKnoppen.includes('Inloggen')
        && state.restaurantKnoppen.includes('Claim je zaak')
        && state.restaurantInBeeld === true,
      `${state.restaurantTitel} / ${state.restaurantKnoppen.join('|')}`);
    check(`${prefix}: de zin voor bezoekers staat er`,
      state.bezoeker === 'Als bezoeker heb je geen account nodig.', state.bezoeker);
    check(`${prefix}: de weergave biedt Licht, Donker en Automatisch`,
      state.weergave.join('|') === 'Licht|Donker|Automatisch' && state.weergaveInBeeld === true,
      state.weergave.join('|'));
    check(`${prefix}: "Delen via" staat er en is in beeld`, Boolean(state.delen) && state.delenInBeeld, state.delen);
    check(`${prefix}: "Mijn lijstje" staat er`,
      /Mijn lijstje/.test(state.laatsteTekst) && state.laatsteInBeeld === true, state.laatsteTekst);
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    check(`${prefix}: het menu ligt boven de tabbalk`,
      state.overlaptTabbalk === false && state.laatsteTop !== null && state.laatsteTop.binnen === true,
      `tabbalk ${JSON.stringify(state.tabbar)} / laatste ${JSON.stringify(state.laatste)} / top ${JSON.stringify(state.laatsteTop)}`);
    check(`${prefix}: het thema is in licht en donker aangetoond`,
      themeOk(licht, 'light') && themeOk(donker, 'dark') && inDonker.titel === 'Menu',
      `${licht.attr}/${donker.attr}`);

    // Esc sluit het menu en de focus keert terug naar de menuknop.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const dicht = await waitFor(cdp, `!document.querySelector('${PANEL}')`, 8000);
    const focus = await evalJs(cdp, 'String(document.activeElement.className || document.activeElement.tagName)');
    check(`${prefix}: Esc sluit het menu en de focus keert terug`,
      dicht === true && focus === 'pha-menu', `${dicht} / ${focus}`);
  }
}

async function inloggenScenario(cdp) {
  for (const size of SIZES) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${LOGIN_PAGE}`, `Boolean(document.querySelector('.inloggen-form input[type="email"]'))`);
    const opener = size.width >= 900 ? SETTINGS_BUTTON : MENU_BUTTON;
    const prefix = `inloggen ${size.name}`;

    const licht = await applyTheme(cdp, 'light', opener);
    await closePanel(cdp);
    const state = await evalJs(cdp, LOGIN_STATE);
    await shot(cdp, `be63-inloggen-${size.name}-licht`, { theme: 'light', themeProof: licht, state: 'login' });

    const donker = await applyTheme(cdp, 'dark', opener);
    await closePanel(cdp);
    await sleep(120);
    await shot(cdp, `be63-inloggen-${size.name}-donker`, { theme: 'dark', themeProof: donker, state: 'login' });

    check(`${prefix}: de titel, het label en de intro staan op de pagina`,
      state.h1 === 'Inloggen bij je restaurant'
        && /^voor restaurants$/i.test(state.eyebrow)
        && state.intro.startsWith('Werk je menukaart, prijzen en daghap bij.'),
      `${state.eyebrow} / ${state.h1}`);
    check(`${prefix}: het e-mailveld van 52 px heeft een echt label`,
      state.label === 'E-mailadres' && state.input !== null && state.input.type === 'email' && state.input.box.height >= 50,
      `${state.label} / ${JSON.stringify(state.input)}`);
    check(`${prefix}: de knop "Stuur mij een inlogcode" is 52 px en staat in --button-primary-bg`,
      state.submit !== null
        && state.submit.tekst === 'Stuur mij een inlogcode'
        && state.submit.box.height >= 50
        && state.submit.kleur === state.submit.tokenKleur,
      `${state.submit && state.submit.tekst} / ${state.submit && state.submit.box.height}px / ${state.submit && state.submit.kleur} = ${state.submit && state.submit.tokenKleur}`);
    check(`${prefix}: de uitleg over het geclaimde adres staat eronder`,
      state.help === 'Gebruik het adres waarmee je je restaurant hebt geclaimd.', state.help);
    check(`${prefix}: het claimblok heeft de titel, de tekst en drie stappen`,
      state.claim !== null
        && state.claim.titel === 'Nog geen account?'
        && state.claim.stappen.length === 3
        && state.claim.stappen[0] === 'Zoek je restaurant',
      JSON.stringify(state.claim && state.claim.stappen));
    check(`${prefix}: de claimknop gaat naar /mijn-restaurant/claimen`,
      state.action !== null && state.action.tekst === 'Claim je restaurant' && state.action.href === '/mijn-restaurant/claimen',
      JSON.stringify(state.action));
    check(`${prefix}: de teamlink gaat naar de bestaande interne inlog`,
      state.team !== null && /Team-inlog/.test(state.team.tekst) && state.team.href === '/internal/login',
      JSON.stringify(state.team && { tekst: state.team.tekst, href: state.team.href }));
    check(`${prefix}: de zin voor bezoekers staat er`,
      state.bezoeker === 'Bezoeker? Je hebt geen account nodig om te zoeken, te bewaren of samen te kiezen.', state.bezoeker);
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    check(`${prefix}: het thema is in licht en donker aangetoond`, themeOk(licht, 'light') && themeOk(donker, 'dark'),
      `${licht.attr}/${donker.attr}`);

    // Het claimblok en de teamlink staan in beeld nadat de bezoeker ernaartoe
    // scrolt; de opname laat zien dat ze volledig passen. Het scrollen gebeurt
    // meteen (geen smooth-animatie) en de meting volgt pas daarna.
    const claimMeting = await scrollEnMeet(cdp, '.inloggen-claim');
    check(`${prefix}: het claimblok past volledig in beeld`,
      Boolean(claimMeting) && claimMeting.inBeeld === true, JSON.stringify(claimMeting));
    await shot(cdp, `be63-inloggen-${size.name}-claim`, { theme: null, state: 'login-claim' });

    const teamMeting = await scrollEnMeet(cdp, '.inloggen-team-link');
    check(`${prefix}: de teamlink past volledig in beeld`,
      Boolean(teamMeting) && teamMeting.inBeeld === true, JSON.stringify(teamMeting));
    await shot(cdp, `be63-inloggen-${size.name}-team`, { theme: null, state: 'login-team' });
  }
}

// De ingelogde kop: dezelfde sessie-stub als de BE-59-check zet een fictieve
// sessie in localStorage, waarna de bestaande accountmenu-component verschijnt.
let stubScriptId = null;

async function removeStub(cdp) {
  if (!stubScriptId) return;
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubScriptId }).catch(() => {});
  stubScriptId = null;
}

async function ingelogdScenario(cdp) {
  await removeStub(cdp);
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: be59StubScript({ session: true }),
  });
  stubScriptId = result.identifier || null;

  for (const size of SIZES) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('${MENU_BUTTON}'))`);
    const account = await waitFor(cdp, `Boolean(document.querySelector('.account-menu-trigger'))`, 20000);
    const opener = size.width >= 900 ? SETTINGS_BUTTON : MENU_BUTTON;
    const prefix = `kop als ingelogd ${size.name}`;

    const licht = await applyTheme(cdp, 'light', opener);
    await closePanel(cdp);
    const state = await readHeader(cdp);
    await shot(cdp, `be63-kop-ingelogd-${size.name}-licht`, { theme: 'light', themeProof: licht, state: 'ingelogd' });

    const donker = await applyTheme(cdp, 'dark', opener);
    await closePanel(cdp);
    await sleep(120);
    await shot(cdp, `be63-kop-ingelogd-${size.name}-donker`, { theme: 'dark', themeProof: donker, state: 'ingelogd' });

    check(`${prefix}: het accountmenu staat in de kop`, account === true && zichtbaar(state.account),
      `${JSON.stringify(account)} / ${JSON.stringify(state.account)}`);
    check(`${prefix}: Inloggen is weg`, !zichtbaar(state.login), JSON.stringify(state.login));
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    check(`${prefix}: de kop staat op één regel (hoogte vastgelegd)`,
      Boolean(state.header) && state.header.height > 0 && state.header.height <= (size.width < 390 ? 132 : 96),
      state.header ? `hoogte ${state.header.height}px` : 'geen header');
    check(`${prefix}: het thema is in licht en donker aangetoond`, themeOk(licht, 'light') && themeOk(donker, 'dark'),
      `${licht.attr}/${donker.attr}`);
    if (size.width >= 900) {
      check(`${prefix}: "Voor restaurants" en de instellingenknop staan ernaast`,
        zichtbaar(state.restaurants) && zichtbaar(state.settings),
        `${JSON.stringify(zichtbaar(state.restaurants))}/${JSON.stringify(zichtbaar(state.settings))}`);
    } else {
      check(`${prefix}: alleen de menuknop staat ernaast`, zichtbaar(state.menu) && !zichtbaar(state.settings),
        `menu ${JSON.stringify(zichtbaar(state.menu))} settings ${JSON.stringify(zichtbaar(state.settings))}`);
    }
  }

  // Na deze reeks weer gast, zodat een volgende run of scenario niet stilletjes
  // ingelogd begint.
  await removeStub(cdp);
}

const SCENARIOS = [
  { name: 'gast', run: (cdp) => gastScenario(cdp) },
  { name: 'instellingen', run: (cdp) => instellingenScenario(cdp) },
  { name: 'menu', run: (cdp) => menuScenario(cdp) },
  { name: 'inloggen', run: (cdp) => inloggenScenario(cdp) },
  { name: 'ingelogd', run: (cdp) => ingelogdScenario(cdp) },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  // Een gefilterde run schrijft naar een eigen bestand dat git negeert
  // (ops/browser/evidence/*.filtered.json); alleen de volledige run vervangt
  // het bewijs dat bij de levering hoort.
  return SELECTION.filter
    ? path.join(EVIDENCE_DIR, 'be63-browser-evidence.filtered.json')
    : BASE_EVIDENCE_PATH;
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    ticket: 'BE-63 (#155)',
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck op een verse productieopbouw (next build + next start op poort ${PORT}); geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    pages: [PAGE, LOGIN_PAGE],
    filter: SELECTION.filter,
    scenarioRuns,
    network: networkEvidence,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0,
    ...extra,
  };
  fs.writeFileSync(evidencePath(), JSON.stringify(record, null, 2));
  return record;
}

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    writeEvidence({ error: 'timeout na 10 minuten' });
    process.exit(2);
  }, 10 * 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    // De BE-57-opzet: een verse productieopbouw in een eigen bouwmap en
    // `next start`, zodat er geen HMR-herlaadbeurt midden in een meting valt.
    // Deze check draait daarom alleen (geen tweede browsercheck tegelijk).
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: PAGE, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}${PAGE}`,
      fixtureRoutes: [],
    });
    await enableFetchGuard(cdp, guard);

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    const guardViolations = guard.appViolations();
    check('netwerk: geen geblokkeerde oproep in de pagina', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    check('netwerk: geen geblokkeerde oproep op CDP-niveau', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence({});
    console.log(JSON.stringify({
      passed: record.passed,
      checks: checks.length,
      failed: record.failed,
      screenshots: shots.length,
      evidence: evidencePath(),
    }, null, 2));
    if (!record.passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel staat buiten de repo en is onschadelijk.
      }
    }
  }
}

main();


