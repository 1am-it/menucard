'use strict';

// BE-62 (#153) — browsercheck van "de ontvanger laten terugkomen".
//
// Doet wat de review vraagt, in de modus `start` (echte productieopbouw, eigen
// bouwmap `.next-be62`): de kies-pagina ná het stemmen met een GESTUBDE
// kies-API (er wordt geen echte stemming aangemaakt), een gedeeld gerecht, een
// gedeeld lijstje en de tip "Zet ons op je beginscherm" bij het tweede bezoek.
// Elke opname draagt zijn eigen themabewijs (lib/theme-proof.js), in licht en
// donker op 1280, 390 en 320 px; daarna gaat de bestaande a11y-audit erover.
//
// Dit is lokaal bewijs, geen productie en geen echte acceptatie.
// Gebruik: node ops/browser/run-be62-browser-check.js [--alleen=<scenario>]
// [--lijst]. Poort: BE62_PORT of 3196 (3190-3199, één voor één).

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
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { BE62_KIES_CODE, be62KiesStubScript } = require('./lib/be62-kies-stub');
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const audit = require('./lib/a11y-audit');

const SCRIPT_NAME = 'run-be62-browser-check.js';
const PORT = Number(process.env.BE62_PORT || 3196);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-62');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be62-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-62');

const KIES_URL = `${APP}/kies/${BE62_KIES_CODE}`;
// Een bestaand gerecht uit de echte menukaarten, met de stand van een gedeelde
// link (dat is het teken dat iemand de link deelde). `name` en `cat` moeten exact
// kloppen, anders wijst de deeplink niets aan (resolveDishTarget).
const DISH_TARGET = {
  menuId: '1-diner',
  catIdx: 1,
  itemIdx: 0,
  name: "Blonde d'Aquitaine Beef",
  category: 'Voorgerechten',
};
const DISH_ID = `${DISH_TARGET.menuId}-${DISH_TARGET.catIdx}-${DISH_TARGET.itemIdx}`;
const DISH_URL = `${APP}/menu/${DISH_TARGET.menuId}?dish=${DISH_ID}`
  + `&name=${encodeURIComponent(DISH_TARGET.name)}`
  + `&cat=${encodeURIComponent(DISH_TARGET.category)}&stand=licht`;
const PLAIN_MENU_URL = `${APP}/menu/${DISH_TARGET.menuId}`;
const LIST_URL = `${APP}/mijn-lijstje?lijst=${DISH_ID}`;
const PLAIN_LIST_URL = `${APP}/mijn-lijstje`;
const HOME_URL = `${APP}/`;

const SIZES = [
  { width: 1280, height: 900 },
  { width: 390, height: 780 },
  { width: 320, height: 640 },
];
const THEMES = ['light', 'dark'];
const TIP_SESSION_KEY = 'bredaeats_beginscherm_tip_sessie';

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    state: meta.state || null,
    theme: meta.theme || null,
    themeProof: meta.themeProof || null,
  });
  return file;
}

async function themeProof(cdp) {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

const SETTINGS_BUTTON = '.pha-settings';
const SETTINGS_PANEL = '.pha-panel';

async function openSettings(cdp) {
  if (await evalJs(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`)) return true;
  const ready = await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_BUTTON}'))`, 15000);
  if (!ready) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const button = document.querySelector('${SETTINGS_BUTTON}'); button.click(); return true; })()`);
    const open = await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`, 4000);
    if (open) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

/** Het thema via de themaknop van de app zelf, met bewijs. */
async function applyTheme(cdp, theme) {
  const label = THEME_LABELS[theme];
  if (!(await openSettings(cdp))) throw new Error(`settings_button_missing: ${label}`);
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

/** Het terugkomvlak lezen: kop, tekst, knop en doel. */
const BLOK_STAAT = `(() => {
  const blok = document.querySelector('.zoek-gerecht');
  if (!blok) return { present: false };
  const title = blok.querySelector('.zoek-gerecht-title');
  const body = blok.querySelector('.zoek-gerecht-body');
  const link = blok.querySelector('.zoek-gerecht-btn');
  return {
    present: true,
    heading: title ? title.tagName.toLowerCase() : null,
    title: title ? (title.textContent || '').trim() : null,
    body: body ? (body.textContent || '').trim() : null,
    cta: link ? (link.textContent || '').trim() : null,
    href: link ? link.getAttribute('href') : null,
  };
})()`;

const TIP_STAAT = `(() => {
  const tip = document.querySelector('.beginscherm-tip');
  if (!tip) return { present: false };
  const rect = tip.getBoundingClientRect();
  const tabbar = document.querySelector('.mobile-tabbar');
  const tabRect = tabbar ? tabbar.getBoundingClientRect() : null;
  const close = tip.querySelector('.beginscherm-tip-close');
  const closeRect = close ? close.getBoundingClientRect() : null;
  const title = tip.querySelector('.beginscherm-tip-title');
  const body = tip.querySelector('.beginscherm-tip-body');
  const logo = tip.querySelector('.beginscherm-tip-logo');
  const mid = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  const hit = document.elementFromPoint(mid.x, mid.y);
  return {
    present: true,
    title: title ? (title.textContent || '').trim() : null,
    heading: title ? title.tagName.toLowerCase() : null,
    body: body ? (body.textContent || '').trim() : null,
    logo: logo ? (logo.textContent || '').trim() : null,
    closeLabel: close ? close.getAttribute('aria-label') : null,
    closeSize: closeRect ? { w: Math.round(closeRect.width), h: Math.round(closeRect.height) } : null,
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom) },
    tabbar: tabRect ? { top: Math.round(tabRect.top), bottom: Math.round(tabRect.bottom) } : null,
    inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 0.5,
    hitIsTip: Boolean(hit && tip.contains(hit)),
    visits: (() => {
      try {
        const raw = window.localStorage.getItem('bredaeats_beginscherm_tip');
        return raw ? JSON.parse(raw) : null;
      } catch (error) { return null; }
    })(),
  };
})()`;

const BEWAAR_KNOP = `(() => {
  const knop = [...document.querySelectorAll('.menu-card button')]
    .find((item) => /^Bewaar/.test(item.getAttribute('aria-label') || ''));
  return knop ? knop.getAttribute('aria-label') : null;
})()`;

async function leegOpslag(cdp) {
  await evalJs(cdp, `(() => { try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (error) {} return true; })()`);
}

/** Een nieuw bezoek: sessionStorage leeg (zelfde localStorage), pagina opnieuw. */
async function newVisit(cdp, url = HOME_URL) {
  await evalJs(cdp, `(() => { try { window.sessionStorage.removeItem(${JSON.stringify(TIP_SESSION_KEY)}); } catch (error) {} return true; })()`);
  await navigate(cdp, url, `document.readyState === 'complete'`);
  await sleep(700);
}

/** De a11y-audit van de bestaande lib, met 0 fouten als eis. */
async function a11y(cdp, label, theme) {
  const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
  const review = audit.checksFromAudit(label, theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
  for (const failure of review.errors) {
    check(`${label} (${theme}) · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
  }
  check(`${label} (${theme}) · a11y-audit zonder fouten`, review.errors.length === 0, `${review.errors.length} fouten`);
}

const TYPE_NAAM = `(() => {
  const input = document.querySelector('#kies-roepnaam');
  if (!input) return 'missing';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'Sam');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()`;

const KLIK_JOIN = `(() => {
  const knop = [...document.querySelectorAll('form button')].find((item) => item.type === 'submit');
  if (!knop) return 'missing';
  knop.click();
  return 'clicked';
})()`;

async function joinKies(cdp) {
  const ready = await waitFor(cdp, `Boolean(document.querySelector('#kies-roepnaam'))`, 20000);
  if (!ready) throw new Error('kies_naamveld_missing');
  await evalJs(cdp, TYPE_NAAM);
  await evalJs(cdp, KLIK_JOIN);
  return waitFor(cdp, `Boolean(document.querySelector('.kies-dish-card'))`, 15000);
}

/** Eén keer "lekker", de rest "liever niet", tot de uitslag er staat. */
async function voteAll(cdp) {
  let first = true;
  for (let poging = 0; poging < 8; poging += 1) {
    if (await evalJs(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`)) return true;
    const selector = first ? '.kies-vote-lekker' : '.kies-vote-niet';
    const clicked = await evalJs(cdp, `(() => {
      const knop = document.querySelector('${selector}');
      if (!knop) return 'missing';
      knop.click();
      return 'clicked';
    })()`);
    if (clicked !== 'clicked') return false;
    first = false;
    await sleep(500);
  }
  return evalJs(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`);
}

/** Het instellingenpaneel weer dicht, zodat een opname de pagina toont. */
async function closeSettings(cdp) {
  const dicht = `!document.querySelector('${SETTINGS_PANEL}')`;
  if (await evalJs(cdp, `${dicht}`)) return true;
  // Eerst de sluitknop in het paneel zelf.
  await evalJs(cdp, `(() => { const knop = document.querySelector('.pha-close'); if (knop) { knop.click(); return 'clicked'; } return 'missing'; })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  // Dan Escape, zoals het paneel zelf voorschrijft.
  await evalJs(cdp, `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  // Als laatste een klik naast het paneel (de achtergrondlaag).
  await evalJs(cdp, `(() => { const laag = document.querySelector('.pha-layer'); if (laag) laag.click(); return true; })()`);
  return waitFor(cdp, dicht, 3000);
}

/** Sluit het paneel en leg vast dat het echt dicht is vóór de opname. */
async function sluitPaneel(cdp, label) {
  const closed = await closeSettings(cdp);
  await sleep(200);
  const nogOpen = await evalJs(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`);
  check(`opname: het instellingenpaneel is dicht (${label})`, closed === true && nogOpen === false, `gesloten=${closed} · nogOpen=${nogOpen}`);
  return nogOpen === false;
}

/** Het vlak als vlak: achtergrond, knophoogte, plek in beeld en ná het gerecht. */
const BLOK_BEELD = `(() => {
  const blok = document.querySelector('.zoek-gerecht');
  if (!blok) return { present: false };
  const rect = blok.getBoundingClientRect();
  const stijl = getComputedStyle(blok);
  const knop = blok.querySelector('.zoek-gerecht-btn');
  const knopRect = knop ? knop.getBoundingClientRect() : null;
  const noot = document.querySelector('.dish-share-note');
  const kaart = noot ? noot.closest('.menu-card') : null;
  const kaartRect = kaart ? kaart.getBoundingClientRect() : null;
  return {
    present: true,
    rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) },
    inViewport: rect.top >= 0 && rect.bottom <= window.innerHeight + 0.5,
    background: stijl.backgroundColor,
    pageBackground: getComputedStyle(document.body).backgroundColor,
    radius: stijl.borderTopLeftRadius,
    paddingTop: stijl.paddingTop,
    buttonHeight: knopRect ? Math.round(knopRect.height) : null,
    afterDish: kaartRect
      ? { cardBottom: Math.round(kaartRect.bottom), blockTop: Math.round(rect.top), ok: rect.top >= kaartRect.bottom - 1 }
      : null,
    panelOpen: Boolean(document.querySelector('.pha-panel')),
  };
})()`;

/**
 * Scroll het vlak in beeld en leg de vorm vast: het onderdeel zelf staat in de
 * viewport, het paneel is dicht, de achtergrond wijkt af van de pagina en de
 * knop is hoog genoeg. Zonder deze stap toonde ronde 1 het paneel in plaats van
 * het vlak.
 */
async function blokInBeeld(cdp, label) {
  const gevonden = await evalJs(cdp, `(() => {
    const blok = document.querySelector('.zoek-gerecht');
    if (!blok) return false;
    blok.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  await sleep(450);
  const beeld = await evalJs(cdp, BLOK_BEELD);
  check(`opname: het vlak zelf staat in beeld (${label})`, gevonden === true && beeld.inViewport === true, `${gevonden} · ${JSON.stringify(beeld.rect)}`);
  check(`opname: geen paneel over de pagina (${label})`, beeld.panelOpen === false, String(beeld.panelOpen));
  check(`vorm: het vlak heeft een andere achtergrond dan de pagina (${label})`,
    Boolean(beeld.background) && beeld.background !== beeld.pageBackground, `${beeld.background} · ${beeld.pageBackground}`);
  check(`vorm: de knop is minstens 44 px hoog (${label})`, beeld.buttonHeight >= 44, String(beeld.buttonHeight));
  check(`vorm: radius 16 px en padding 18 px (${label})`,
    beeld.radius === '16px' && beeld.paddingTop === '18px', `${beeld.radius} · ${beeld.paddingTop}`);
  return beeld;
}

async function kiesScenario(cdp) {
  await leegOpslag(cdp);
  let beforeChecked = false;
  for (const theme of THEMES) {
    for (const size of SIZES) {
      await setViewport(cdp, size.width, size.height);
      await navigate(cdp, KIES_URL, `document.readyState === 'complete'`);
      // De pagina haalt de stemming async op: wacht op één van de drie standen.
      await waitFor(cdp, `Boolean(document.querySelector('#kies-roepnaam')) || Boolean(document.querySelector('.kies-dish-card')) || Boolean(document.querySelector('ul.kies-uitslag'))`, 25000);
      let hasResult = await evalJs(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`);
      if (!hasResult) {
        const naamveld = await evalJs(cdp, `Boolean(document.querySelector('#kies-roepnaam'))`);
        if (naamveld) {
          await joinKies(cdp);
          if (!beforeChecked) {
            const before = await evalJs(cdp, BLOK_STAAT);
            check('kies: geen terugkomvlak vóór de eigen stem', before.present === false, JSON.stringify(before));
            beforeChecked = true;
          }
        }
        const voted = await voteAll(cdp);
        check(`kies: stemmen tot de uitslag (${size.width} ${theme})`, voted === true, String(voted));
        hasResult = voted === true;
      }
      const proof = await applyTheme(cdp, theme);
      const label = `${size.width} ${theme}`;
      await sluitPaneel(cdp, `kies ${label}`);
      await blokInBeeld(cdp, `kies ${label}`);
      const blok = await evalJs(cdp, BLOK_STAAT);
      check(`kies: het vlak staat onder de uitslag (${label})`, blok.present === true, JSON.stringify(blok));
      check(`kies: de kop noemt het eerste "lekker"-gerecht (${label})`,
        blok.title === 'Jij koos Poussin. Zelf ook een lijstje maken?', blok.title);
      check(`kies: de kop is een h2 (${label})`, blok.heading === 'h2', blok.heading);
      check(`kies: de tekst uit het ontwerp (${label})`,
        blok.body === 'Zoek op gerecht in alle menukaarten van Breda, altijd met prijs. Geen account nodig.', blok.body);
      check(`kies: de gele knop "Zoek een gerecht →" naar / (${label})`,
        blok.cta === 'Zoek een gerecht →' && blok.href === '/', `${blok.cta} · ${blok.href}`);
      await shot(cdp, `be62-kies-${size.width}-${theme}.png`, { theme, state: 'uitslag', themeProof: proof });
      if (size.width === 390) await a11y(cdp, 'kies na het stemmen', theme);
    }
  }
}

async function gedeeldScenario(cdp) {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      await setViewport(cdp, size.width, size.height);
      await navigate(cdp, DISH_URL, `Boolean(document.querySelector('.dish-share-note'))`);
      const proof = await applyTheme(cdp, theme);
      const label = `${size.width} ${theme}`;
      await sluitPaneel(cdp, `gedeeld gerecht ${label}`);
      const beeld = await blokInBeeld(cdp, `gedeeld gerecht ${label}`);
      check(`volgorde: het vlak staat ná het gedeelde gerecht (${label})`,
        Boolean(beeld.afterDish) && beeld.afterDish.ok === true, JSON.stringify(beeld.afterDish));
      const blok = await evalJs(cdp, BLOK_STAAT);
      check(`gedeeld gerecht: het vlak staat onder de deelregel (${label})`, blok.present === true, JSON.stringify(blok));
      check(`gedeeld gerecht: kop, tekst en knop (${label})`,
        blok.title === 'Zelf ook zin in iets?'
          && blok.body === 'Zoek op gerecht in alle menukaarten van Breda. Geen app of account nodig.'
          && blok.cta === 'Zoek een gerecht'
          && blok.href === '/',
        JSON.stringify(blok));
      const bewaar = await evalJs(cdp, BEWAAR_KNOP);
      check(`gedeeld gerecht: de bestaande Bewaar-knop staat bij het gerecht (${label})`, Boolean(bewaar), String(bewaar));
      await shot(cdp, `be62-gerecht-${size.width}-${theme}.png`, { theme, state: 'gedeeld', themeProof: proof });
      if (size.width === 390) await a11y(cdp, 'gedeeld gerecht', theme);
    }
  }

  // Gewoon bezoek: geen vlak, en de deelregel staat er ook niet.
  await setViewport(cdp, 390, 780);
  await navigate(cdp, PLAIN_MENU_URL, `Boolean(document.querySelector('.menu-card'))`);
  const plain = await evalJs(cdp, BLOK_STAAT);
  check('gewoon bezoek aan een menukaart: geen terugkomvlak', plain.present === false, JSON.stringify(plain));

  // Gedeeld lijstje, met de bestaande bewaarknop ernaast.
  for (const theme of THEMES) {
    await navigate(cdp, LIST_URL, `Boolean(document.querySelector('.lijst-title'))`);
    const proof = await applyTheme(cdp, theme);
    await sluitPaneel(cdp, `gedeeld lijstje ${theme}`);
    await blokInBeeld(cdp, `gedeeld lijstje ${theme}`);
    const blok = await evalJs(cdp, BLOK_STAAT);
    const addLabel = await evalJs(cdp, `(() => {
      const knop = document.querySelector('.lijst-add-btn');
      return knop ? (knop.textContent || '').trim() : null;
    })()`);
    check(`gedeeld lijstje: het vlak staat er (${theme})`, blok.present === true, JSON.stringify(blok));
    check(`gedeeld lijstje: kop en knop naar de home (${theme})`,
      blok.title === 'Zelf ook zin in iets?' && blok.cta === 'Zoek een gerecht' && blok.href === '/', JSON.stringify(blok));
    check(`gedeeld lijstje: de bestaande bewaarknop blijft (${theme})`,
      addLabel === 'Zet ze op mijn eigen lijstje', String(addLabel));
    await shot(cdp, `be62-lijstje-390-${theme}.png`, { theme, state: 'gedeeld', themeProof: proof });
    await a11y(cdp, 'gedeeld lijstje', theme);
  }

  await navigate(cdp, PLAIN_LIST_URL, `Boolean(document.querySelector('.lijst-title'))`);
  const plainList = await evalJs(cdp, BLOK_STAAT);
  check('gewoon bezoek aan mijn lijstje: geen terugkomvlak', plainList.present === false, JSON.stringify(plainList));
}

const BROKEN_STORAGE = `(() => {
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('geen opslag'); },
    });
  } catch (error) {
    // Als dit niet lukt, meldt de check zelf dat de opslag nog werkt.
  }
})();`;

async function tipScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await leegOpslag(cdp);
  await navigate(cdp, HOME_URL, `Boolean(document.querySelector('.mobile-tabbar'))`);
  await sleep(900);
  const first = await evalJs(cdp, TIP_STAAT);
  check('tip: niet bij het eerste bezoek', first.present === false, JSON.stringify(first));

  await newVisit(cdp);
  const second = await evalJs(cdp, TIP_STAAT);
  check('tip: wel bij het tweede bezoek', second.present === true, JSON.stringify(second));
  check('tip: het bezoek is in localStorage geteld', Boolean(second.visits) && second.visits.visits === 2, JSON.stringify(second.visits));
  check('tip: boven de tabbalk, helemaal in beeld',
    Boolean(second.tabbar) && second.rect.bottom <= second.tabbar.top && second.inViewport === true,
    JSON.stringify({ rect: second.rect, tabbar: second.tabbar, inViewport: second.inViewport }));
  check('tip: elementFromPoint raakt de kaart zelf (geen pop-up ervoor)', second.hitIsTip === true, String(second.hitIsTip));
  check('tip: kop, logo-tegeltje en tekst uit het ontwerp',
    second.title === 'Zet ons op je beginscherm'
      && second.heading === 'h2'
      && second.logo === 'om'
      && /Tik op Delen en daarna op Zet op beginscherm/.test(second.body || ''),
    JSON.stringify({ title: second.title, logo: second.logo, body: second.body }));
  check('tip: sluitknop van 44 × 44 px met aria-label "Tip sluiten"',
    second.closeLabel === 'Tip sluiten' && second.closeSize && second.closeSize.w >= 44 && second.closeSize.h >= 44,
    JSON.stringify({ label: second.closeLabel, size: second.closeSize }));

  const light = await applyTheme(cdp, 'light');
  await sluitPaneel(cdp, 'tip licht');
  const tipLight = await evalJs(cdp, TIP_STAAT);
  check('tip: na het sluiten van het paneel staat de tip nog in beeld (licht)',
    tipLight.present === true && tipLight.inViewport === true, JSON.stringify(tipLight.rect));
  await shot(cdp, 'be62-tip-390-licht.png', { theme: 'light', state: 'tweede-bezoek', themeProof: light });
  const dark = await applyTheme(cdp, 'dark');
  await sluitPaneel(cdp, 'tip donker');
  const tipDark = await evalJs(cdp, TIP_STAAT);
  check('tip: na het sluiten van het paneel staat de tip nog in beeld (donker)',
    tipDark.present === true && tipDark.inViewport === true, JSON.stringify(tipDark.rect));
  await shot(cdp, 'be62-tip-390-donker.png', { theme: 'dark', state: 'tweede-bezoek', themeProof: dark });

  const closed = await evalJs(cdp, `(() => {
    const knop = document.querySelector('.beginscherm-tip-close');
    if (!knop) return 'missing';
    knop.click();
    return 'clicked';
  })()`);
  await sleep(500);
  const afterClose = await evalJs(cdp, TIP_STAAT);
  check('tip: weg direct na sluiten', closed === 'clicked' && afterClose.present === false, `${closed} · ${JSON.stringify(afterClose)}`);
  await newVisit(cdp);
  const later = await evalJs(cdp, TIP_STAAT);
  check('tip: na sluiten nooit meer, ook niet in een nieuw bezoek', later.present === false, JSON.stringify(later));

  await setViewport(cdp, 1280, 900);
  await newVisit(cdp);
  const desktop = await evalJs(cdp, TIP_STAAT);
  check('tip: niet op desktop (1280 px)', desktop.present === false, JSON.stringify(desktop));

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BROKEN_STORAGE });
  await setViewport(cdp, 390, 780);
  await navigate(cdp, HOME_URL, `document.readyState === 'complete'`);
  await sleep(900);
  const noStorage = await evalJs(cdp, TIP_STAAT);
  const pageOk = await evalJs(cdp, `Boolean(document.querySelector('.mobile-tabbar'))`);
  check('tip: zonder opslag geen tip en geen fout', noStorage.present === false && pageOk === true,
    JSON.stringify({ tip: noStorage, page: pageOk }));
  await shot(cdp, 'be62-tip-390-geen-opslag.png', { theme: 'dark', state: 'zonder-opslag', themeProof: await themeProof(cdp) });
}

const SCENARIOS = [
  { name: 'kies', run: (cdp) => kiesScenario(cdp) },
  { name: 'gedeeld', run: (cdp) => gedeeldScenario(cdp) },
  { name: 'tip', run: (cdp) => tipScenario(cdp) },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  return SELECTION.filter
    ? path.join(EVIDENCE_DIR, 'be62-browser-evidence.filtered.json')
    : BASE_EVIDENCE_PATH;
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck van de productieopbouw (next start op poort ${PORT}) met een gestubde kies-API; geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
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
    writeEvidence({ error: 'timeout na 12 minuten' });
    process.exit(2);
  }, 12 * 60 * 1000);
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
    // Eigen bouwmap, zodat deze check nooit de `.next` van een andere meting
    // hergebruikt of overschrijft.
    process.env.NEXT_DIST_DIR = process.env.NEXT_DIST_DIR || '.next-be62';
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}/`,
      fixtureRoutes: [
        { id: 'zoeken', match: 'prefix', path: '/api/search', methods: ['GET'] },
        { id: 'daghap', match: 'prefix', path: '/api/v1/daghap', methods: ['GET'] },
        { id: 'tellers', match: 'exact', path: '/api/v1/tellers', methods: ['POST'] },
        { id: 'bekeken', match: 'exact', path: '/api/v1/bekeken', methods: ['POST'] },
      ],
    });
    await enableFetchGuard(cdp, guard);
    // De kies-API is gestubd: geen echte stemming, geen echte gegevens.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be62KiesStubScript() });

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const kies = await evalJs(cdp, '({ stub: Boolean(window.__BE62_KIES_STUB__), calls: (window.__BE62_KIES_CALLS__ || []).length })');
    check('kies: de API is gestubd en elk stemverzoek bleef lokaal', kies.stub === true, JSON.stringify(kies));

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
