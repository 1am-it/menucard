'use strict';

// BE-67 (#164) — browsercheck van het dagmenu, de herhaling, Op = op en de
// cijfers, met een gestubde API.
//
// Fixture-bewijs: de echte productieopbouw (`next build` + `next start`, via
// `mode: 'start'` en een eigen bouwmap), een echte browser via CDP, en twee in de
// pagina gestubde lagen: de auth-stub van BE-48 (alleen inloggen) en de
// daghap-stub van BE-67 (lib/be67-daghap-stub.js). Geen Supabase-project, geen
// productiesleutel, geen productiedata, geen internet.
//
// Wat bewezen wordt:
//  - het formulier van de houder met een dagmenu (drie gangen, twee prijzen) en
//    "Elke week op" di en do: alles staat in beeld, geen overloop, en de
//    weekdagknoppen zijn minstens 40 px;
//  - het overzicht met de cijfers ("< 5" en een getal ≥ 5) en Op = op heen en
//    terug: de knop wisselt van tekst en het label "Uitverkocht" verschijnt en
//    verdwijnt;
//  - het blok "Vandaag" met een dagmenu (gangen, twee prijschips, Bewaar en
//    Delen) en een uitverkochte daghap (doorgestreept, met de badge
//    "Op = op · uitverkocht");
//  - licht en donker op 1280, 390 en 320 px, met het thema via de themakeuze van
//    de app, het instellingenpaneel dicht vóór de opname, en een themeProof bij
//    elke opname;
//  - de a11y-audit op de houderpagina en de restaurantpagina, zonder fouten.
//
// Niet bewezen hier: de serverregels (grenzen, tijdzone, de telling zelf) — die
// staan in src/lib/daghapMenu.test.js, daghapAanbod.test.js,
// daghapHandlers.test.js en dishCounterHandlers.test.js. Dit is
// ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be67-browser-check.js [--alleen=<scenario>] [--lijst]

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
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { authStubScript } = require('./lib/be48-auth-stub');
const { be67StubScript } = require('./lib/be67-daghap-stub');
const { THEME_LABELS, themeProofScript, clickThemeScript, themeProofValue, themeOk } = require('./lib/theme-proof');
const audit = require('./lib/a11y-audit');

const OUT_DIR = path.join(__dirname, 'output', 'be-67');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be67-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-67');
const SCRIPT_NAME = 'run-be67-browser-check.js';
// Poort 3191 valt binnen 3190-3199 en botst niet met BE-55 (3195).
const PORT = Number(process.env.BE67_FIXTURE_PORT || 3191);
const APP = `http://localhost:${PORT}`;
const LOGIN_URL = `${APP}/mijn-restaurant/inloggen`;
const AANBOD_URL = `${APP}/mijn-restaurant/aanbod`;
const RESTAURANT_URL = `${APP}/restaurant/6`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OWNER_EMAIL = 'houder@example.invalid';
const EMAIL_CODE = '654321';
const ROLES = [{ role: 'owner', restaurant_id: '1' }];

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];
const THEMES = ['light', 'dark'];

const checks = [];
const shots = [];
const injectedScripts = [];
const themeLog = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };
let cdp = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function shot(name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    state: meta.state || null,
    themeProof: meta.themeProof || null,
    panelClosed: meta.panelClosed === undefined ? null : meta.panelClosed,
  });
  return file;
}

async function themeProof() {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

const SETTINGS_BUTTON = '.pha-settings';
const SETTINGS_PANEL = '.pha-panel';

async function openSettings() {
  if (await evalJs(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`)) return true;
  if (!(await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_BUTTON}'))`, 15000))) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const knob = document.querySelector('${SETTINGS_BUTTON}'); if (!knob) return false; knob.click(); return true; })()`);
    if (await waitFor(cdp, `Boolean(document.querySelector('${SETTINGS_PANEL}'))`, 4000)) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

/** Het instellingenpaneel dicht; een opname toont de pagina, geen paneel. */
async function closeSettings() {
  const dicht = `!document.querySelector('${SETTINGS_PANEL}')`;
  if (await evalJs(cdp, dicht)) return true;
  await evalJs(cdp, `(() => { const knob = document.querySelector('.pha-close'); if (knob) knob.click(); return true; })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  await evalJs(cdp, `(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`);
  if (await waitFor(cdp, dicht, 3000)) return true;
  await evalJs(cdp, `(() => { const laag = document.querySelector('.pha-layer'); if (laag) laag.click(); return true; })()`);
  return waitFor(cdp, dicht, 3000);
}

/**
 * Het thema via de themaknop van de app zelf.
 * - `paneel: true` — via de themakeuze in het instellingenpaneel (de publieke
 *   pagina's), daarna het paneel dicht en pas dan het bewijs;
 * - `paneel: false` — via dezelfde themaknop, maar die staat op de houderpagina
 *   rechtstreeks in de kop (ThemeToggle), zonder paneel.
 */
async function applyTheme(theme, { paneel = true } = {}) {
  const label = THEME_LABELS[theme];
  if (paneel && !(await openSettings())) throw new Error(`settings_button_missing: ${label}`);
  if (!(await waitFor(cdp, `document.querySelectorAll('.theme-btn').length >= 2`, 15000))) {
    throw new Error(`theme_button_missing: ${label}`);
  }
  let proof = null;
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(label));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
    await sleep(300);
    proof = await themeProof();
    if (themeOk(proof, theme)) break;
    proof = null;
  }
  if (!proof) throw new Error(`theme_not_applied: ${label}`);
  let gesloten = true;
  if (paneel) {
    gesloten = await closeSettings();
    if (!gesloten) throw new Error(`settings_panel_still_open: ${label}`);
    // Het paneel kan focus en het thema hebben teruggezet; lees opnieuw.
    proof = await themeProof();
    if (!themeOk(proof, theme)) throw new Error(`theme_lost_after_close: ${label}`);
  }
  themeLog.push({
    theme,
    label,
    source: paneel ? 'instellingenpaneel' : 'themaknop-in-de-kop',
    panelClosed: gesloten,
    proof,
  });
  return { proof, panelClosed: gesloten };
}

async function fillField(selector, value) {
  const filled = await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      input.focus();
      const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  if (!filled) throw new Error(`field_missing: ${selector}`);
  return filled;
}

/** Een radio of checkbox van de app zelf indrukken (React luistert op click). */
async function clickInput(selector) {
  const clicked = await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      input.click();
      return input.checked;
    })()`,
  );
  if (!clicked) throw new Error(`input_not_clicked: ${selector}`);
  await sleep(160);
  return clicked;
}

/** Een weekdagknop van "Elke week op" op zijn korte naam indrukken. */
async function clickWeekdag(kort) {
  const clicked = await evalJs(
    cdp,
    `(() => {
      const knop = [...document.querySelectorAll('.aanbod-weekdag')]
        .find((label) => (label.textContent || '').trim() === ${JSON.stringify(kort)});
      if (!knop) return false;
      const input = knop.querySelector('input[type="checkbox"]');
      if (!input) return false;
      input.click();
      return input.checked;
    })()`,
  );
  if (!clicked) throw new Error(`weekdag_not_checked: ${kort}`);
  await sleep(160);
  return clicked;
}

async function resetStorage(theme) {
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`, 120000);
  await evalJs(
    cdp,
    `(() => {
      const stale = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.indexOf('sb-') === 0) stale.push(key);
      }
      stale.forEach((key) => localStorage.removeItem(key));
      try { localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)}); } catch (error) {}
      return stale.length;
    })()`,
  );
}

async function signIn() {
  await navigate(cdp, LOGIN_URL, `document.querySelector('#owner-email') !== null`, 120000);
  const hydrated = await waitFor(
    cdp,
    `(() => {
      const form = document.querySelector('form');
      if (!form) return false;
      return Object.keys(form).some((key) => key.indexOf('__reactProps') === 0);
    })()`,
    30000,
  );
  if (!hydrated) throw new Error('form_not_hydrated');
  await fillField('#owner-email', OWNER_EMAIL);
  await sleep(120);
  await evalJs(cdp, `(() => { const form = document.querySelector('form'); form.requestSubmit ? form.requestSubmit() : form.submit(); return true; })()`);
  if (!(await waitFor(cdp, `document.querySelector('#owner-code') !== null`, 25000))) {
    throw new Error('code_screen_missing');
  }
  await fillField('#owner-code', EMAIL_CODE);
  await sleep(120);
  await evalJs(cdp, `(() => { const form = document.querySelector('form'); form.requestSubmit ? form.requestSubmit() : form.submit(); return true; })()`);
  await waitFor(cdp, `document.querySelector('#owner-code') === null`, 25000);
}

/** Verse stubs, eigen opslag: één stand per opening. */
async function openPage(url, { ready, login = false } = {}) {
  await resetStorage('dark');
  for (const identifier of injectedScripts) {
    try {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    } catch (error) {
      // Een verdwenen script is geen fout.
    }
  }
  injectedScripts.length = 0;
  const auth = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: authStubScript({ email: OWNER_EMAIL, emailCode: EMAIL_CODE, roles: ROLES, theme: 'dark' }),
  });
  if (auth && auth.identifier) injectedScripts.push(auth.identifier);
  const stub = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be67StubScript() });
  if (stub && stub.identifier) injectedScripts.push(stub.identifier);

  await navigate(cdp, url, `document.readyState === 'complete'`, 120000);
  if (login) {
    // Zonder sessie stuurt de pagina zelf naar het inlogscherm; op beide
    // uitkomsten wachten, anders meet de check een lege pagina.
    const klaar = await waitFor(
      cdp,
      `Boolean(document.querySelector('.aanbod-form') || document.querySelector('#owner-email'))`,
      20000,
    );
    if (!klaar) throw new Error(`login_or_page_missing: ${url}`);
    const moetInloggen = await evalJs(cdp, `Boolean(document.querySelector('#owner-email'))`);
    if (moetInloggen) {
      await signIn();
      await navigate(cdp, url, `document.readyState === 'complete'`, 120000);
    }
  }
  if (ready && !(await waitFor(cdp, ready, 30000))) {
    // Eén herlaadpoging: de eerste keer kan de productieopbouw nog nadraaien.
    await navigate(cdp, url, `document.readyState === 'complete'`, 120000);
    if (!(await waitFor(cdp, ready, 30000))) throw new Error(`page_not_ready: ${url} · ${ready}`);
  }
}

/** Het onderdeel in beeld scrollen en meten, zoals BE-55 dat doet. */
function scrollToScript(selector) {
  return `(() => {
    const blok = document.querySelector(${JSON.stringify(selector)});
    if (!blok) return { inBeeld: false, reden: 'geen onderdeel' };
    // Bewust scrollTo en niet scrollIntoView: dat laatste koos in een lange
    // houderpagina de onderkant van het document, waardoor de kop van het
    // formulier buiten beeld bleef (ronde 3, eerste meting).
    const y = blok.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: Math.max(0, y), left: 0, behavior: 'instant' });
    const r = blok.getBoundingClientRect();
    return {
      inBeeld: r.top >= 0 && r.top < window.innerHeight && r.bottom > 0,
      boven: Math.round(r.top),
      onder: Math.round(r.bottom),
      hoogte: Math.round(r.height),
      scherm: window.innerHeight,
      scrollY: Math.round(window.scrollY),
    };
  })()`;
}

async function scrollTo(selector) {
  await evalJs(cdp, scrollToScript(selector));
  await sleep(220);
  return evalJs(cdp, scrollToScript(selector));
}

function overflowCheck(label, measured) {
  check(`${label}: geen horizontale overloop`, measured.overflow <= 0, `scrollWidth - innerWidth = ${measured.overflow}`);
}


// --- Het formulier ---------------------------------------------------------

const FORMULIER_STAAT = `(() => {
  const form = document.querySelector('.aanbod-form');
  if (!form) return { present: false };
  const waarde = (sel) => { const el = document.querySelector(sel); return el ? el.value : null; };
  const weekdagen = [...document.querySelectorAll('.aanbod-weekdag')].map((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    const r = label.getBoundingClientRect();
    return {
      tekst: (label.textContent || '').trim(),
      aangevinkt: Boolean(input && input.checked),
      hoogte: Math.round(r.height),
      breedte: Math.round(r.width),
    };
  });
  const invoer = [...form.querySelectorAll('input[type="text"], input[type="date"]')];
  const zichtbaar = invoer.filter((input) => {
    const r = input.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const prijs3 = document.querySelector('#aanbod-prijs3');
  // BE-67: bij overloop meteen laten zien wélk onderdeel te breed is.
  const rand = form.getBoundingClientRect().right;
  const buitenBeeld = [...form.querySelectorAll('*')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 60),
        id: el.id || '',
        breedte: Math.round(r.width),
        rechts: Math.round(r.right),
      };
    })
    .filter((rij) => rij.rechts > rand + 1)
    .slice(0, 5);
  return {
    present: true,
    soort: (() => { const el = document.querySelector('input[name="soort"]:checked'); return el ? el.value : null; })(),
    wanneer: (() => { const el = document.querySelector('input[name="wanneer"]:checked'); return el ? el.value : null; })(),
    gangen: ['voor', 'hoofd', 'na'].map((gang) => waarde('#aanbod-gang-' + gang)),
    gangVelden: form.querySelectorAll('.aanbod-gangen input[type="text"]').length,
    naam: waarde('#aanbod-naam'),
    prijs: waarde('#aanbod-prijs'),
    prijs3: waarde('#aanbod-prijs3'),
    prijs3Zichtbaar: Boolean(prijs3) && prijs3.getBoundingClientRect().height > 0,
    herhaalTot: waarde('#aanbod-herhaaltot'),
    weekdagen,
    weekdagKnoppen: weekdagen.length,
    minHoogte: weekdagen.length > 0 ? Math.min(...weekdagen.map((dag) => dag.hoogte)) : 0,
    invoer: invoer.length,
    zichtbareInvoer: zichtbaar.length,
    formulierOverloop: form.scrollWidth - form.clientWidth,
    buitenBeeld,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    thema: document.documentElement.getAttribute('data-theme'),
  };
})()`;

async function vulDagmenuFormulier() {
  await clickInput('input[name="soort"][value="dagmenu"]');
  await fillField('#aanbod-gang-voor', 'Pompoensoep met gember');
  await fillField('#aanbod-gang-hoofd', 'Kabeljauw met venkel');
  await fillField('#aanbod-gang-na', 'Appeltaart met kaneelijs');
  await fillField('#aanbod-naam', 'Drie gangen van de chef');
  await fillField('#aanbod-prijs', '29,50');
  await fillField('#aanbod-prijs3', '36,50');
  await clickInput('input[name="wanneer"][value="elke_week"]');
  await clickWeekdag('di');
  await clickWeekdag('do');
}

function beoordeelFormulier(label, gemeten) {
  check(`${label}: de soort staat op dagmenu`, gemeten.soort === 'dagmenu', gemeten.soort);
  check(
    `${label}: drie gangen met een naam`,
    gemeten.gangVelden === 3 && gemeten.gangen.every((naam) => typeof naam === 'string' && naam.trim().length > 0),
    JSON.stringify(gemeten.gangen),
  );
  check(
    `${label}: twee prijzen (2 en 3 gangen)`,
    gemeten.prijs === '29,50' && gemeten.prijs3 === '36,50' && gemeten.prijs3Zichtbaar,
    `${gemeten.prijs} · ${gemeten.prijs3}`,
  );
  check(`${label}: "Elke week op" staat aan`, gemeten.wanneer === 'elke_week', gemeten.wanneer);
  const aan = gemeten.weekdagen.filter((dag) => dag.aangevinkt).map((dag) => dag.tekst);
  check(`${label}: di en do zijn gekozen`, JSON.stringify(aan) === JSON.stringify(['di', 'do']), JSON.stringify(aan));
  check(`${label}: zeven weekdagknoppen`, gemeten.weekdagKnoppen === 7, gemeten.weekdagKnoppen);
  check(`${label}: weekdagknoppen minstens 40 px`, gemeten.minHoogte >= 40, `${gemeten.minHoogte} px`);
  check(`${label}: elk veld is zichtbaar`, gemeten.invoer > 0 && gemeten.zichtbareInvoer === gemeten.invoer, `${gemeten.zichtbareInvoer}/${gemeten.invoer}`);
  check(`${label}: het formulier loopt niet over`, gemeten.formulierOverloop <= 0, `${gemeten.formulierOverloop} · ${JSON.stringify(gemeten.buitenBeeld)}`);
  overflowCheck(label, gemeten);
}

async function formulierScenario() {
  await setViewport(1280, 900);
  await openPage(AANBOD_URL, { login: true, ready: `Boolean(document.querySelector('.aanbod-form'))` });
  await vulDagmenuFormulier();

  const resultaten = [];
  for (const theme of THEMES) {
    const { proof, panelClosed } = await applyTheme(theme, { paneel: false });
    for (const width of WIDTHS) {
      const label = `formulier · ${width.name} · ${theme}`;
      // Het hele formulier in één viewport: de breedte blijft 1280/390/320, de
      // hoogte groeit mee zodat "alles staat in beeld" letterlijk geldt.
      await setViewport(width.width, 1000);
      const hoogte = await evalJs(
        cdp,
        `(() => {
          const formulier = document.querySelector('.aanbod-form');
          if (!formulier) return 0;
          return Math.ceil(formulier.getBoundingClientRect().height) + 280;
        })()`,
      );
      await setViewport(width.width, Math.min(Math.max(Number(hoogte) || 900, 900), 4000));
      const framing = await scrollTo('.aanbod-form');
      const gemeten = await evalJs(cdp, FORMULIER_STAAT);
      beoordeelFormulier(label, gemeten);
      check(`${label}: het formulier staat in beeld bij de opname`, framing.inBeeld === true, JSON.stringify(framing));
      const bestand = await shot(`formulier-${width.name}-${theme}`, {
        theme,
        state: 'dagmenu-elke-week-di-do',
        themeProof: proof,
        panelClosed,
      });
      resultaten.push({ viewport: width.name, theme, framing, measured: gemeten, themeProof: proof, panelClosed, file: bestand.file });
    }
  }
  return { scenario: 'formulier', resultaten };
}


// --- Het overzicht van de houder -------------------------------------------

const OVERZICHT_STAAT = `(() => {
  const kaarten = [...document.querySelectorAll('.aanbod-card')].map((kaart) => {
    const knoppen = [...kaart.querySelectorAll('.aanbod-knop')].map((knop) => (knop.textContent || '').trim());
    const cijfers = [...kaart.querySelectorAll('.aanbod-cijfer')].map((cijfer) => ({
      getal: (cijfer.querySelector('.aanbod-cijfer-getal') || {}).textContent || '',
      label: (cijfer.querySelector('.aanbod-cijfer-label') || {}).textContent || '',
    }));
    const naam = kaart.querySelector('.owner-restaurant-name');
    const stijl = naam ? getComputedStyle(naam) : null;
    return {
      naam: naam ? (naam.textContent || '').trim() : '',
      knoppen,
      cijfers,
      cijfersTitel: (() => {
        const lijst = kaart.querySelector('.aanbod-cijfers');
        return lijst ? lijst.getAttribute('aria-label') : null;
      })(),
      uitverkochtLabel: Boolean(kaart.querySelector('.aanbod-uitverkocht-label')),
      doorgestreept: stijl ? String(stijl.textDecorationLine || '').indexOf('line-through') !== -1 : false,
    };
  });
  return { kaarten, overflow: document.documentElement.scrollWidth - window.innerWidth };
})()`;

/** De Op = op-knop van de eerste kaart indrukken en op de nieuwe stand wachten. */
async function klikOpIsOp(wordtUitverkocht) {
  const doel = wordtUitverkocht ? 'Op = op' : 'Toch weer beschikbaar';
  const tekst = wordtUitverkocht ? 'Toch weer beschikbaar' : 'Op = op';
  const geklikt = await evalJs(
    cdp,
    `(() => {
      const kaart = document.querySelector('.aanbod-card');
      if (!kaart) return false;
      const knop = [...kaart.querySelectorAll('.aanbod-knop')]
        .find((kandidaat) => (kandidaat.textContent || '').trim() === ${JSON.stringify(doel)});
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  if (!geklikt) throw new Error(`op_is_op_button_missing: ${doel}`);
  const klaar = await waitFor(
    cdp,
    `(() => {
      const kaart = document.querySelector('.aanbod-card');
      if (!kaart) return false;
      const knop = [...kaart.querySelectorAll('.aanbod-knop')]
        .find((kandidaat) => (kandidaat.textContent || '').trim() === ${JSON.stringify(tekst)});
      const label = Boolean(kaart.querySelector('.aanbod-uitverkocht-label'));
      return Boolean(knop) && label === ${wordtUitverkocht};
    })()`,
    15000,
  );
  if (!klaar) throw new Error(`op_is_op_not_applied: ${tekst}`);
  await sleep(200);
}


async function overzichtScenario() {
  await setViewport(1280, 900);
  await openPage(AANBOD_URL, { login: true, ready: `Boolean(document.querySelector('.aanbod-card'))` });

  const begin = await evalJs(cdp, OVERZICHT_STAAT);
  const eerste = begin.kaarten[0] || { cijfers: [], knoppen: [] };
  const getallen = eerste.cijfers.map((cijfer) => cijfer.getal);
  check(
    'overzicht: de cijfers staan bij het aanbod',
    eerste.cijfers.length === 3 && eerste.cijfers.map((cijfer) => cijfer.label).join(',') === 'bekeken,bewaard,gedeeld',
    JSON.stringify(eerste.cijfers),
  );
  check('overzicht: de cijferlijst heeft de titel "Vandaag"', eerste.cijfersTitel === 'Vandaag', eerste.cijfersTitel);
  check('overzicht: een getal onder de vijf staat er als "< 5"', getallen.indexOf('< 5') !== -1, JSON.stringify(getallen));
  check(
    'overzicht: een getal vanaf vijf staat er voluit',
    getallen.some((getal) => /^\d+$/.test(String(getal)) && Number(getal) >= 5),
    JSON.stringify(getallen),
  );
  check('overzicht: de knop zegt "Op = op"', eerste.knoppen.indexOf('Op = op') !== -1, JSON.stringify(eerste.knoppen));

  const resultaten = [];
  for (const theme of THEMES) {
    const { proof, panelClosed } = await applyTheme(theme, { paneel: false });
    for (const width of WIDTHS) {
      const label = `overzicht · ${width.name} · ${theme}`;
      await setViewport(width.width, width.height);

      const voor = await evalJs(cdp, OVERZICHT_STAAT);
      check(
        `${label}: nog niet uitverkocht`,
        Boolean(voor.kaarten[0]) && voor.kaarten[0].uitverkochtLabel === false,
        JSON.stringify(voor.kaarten[0] && voor.kaarten[0].knoppen),
      );
      const voorFraming = await scrollTo('.aanbod-card');
      const voorBestand = await shot(`overzicht-beschikbaar-${width.name}-${theme}`, {
        theme,
        state: 'op-is-op-uit',
        themeProof: proof,
        panelClosed,
      });

      await klikOpIsOp(true);
      const uit = await evalJs(cdp, OVERZICHT_STAAT);
      const kaart = uit.kaarten[0] || { knoppen: [], uitverkochtLabel: false, doorgestreept: false };
      check(`${label}: de knop wisselt van tekst`, kaart.knoppen.indexOf('Toch weer beschikbaar') !== -1, JSON.stringify(kaart.knoppen));
      check(`${label}: het label "Uitverkocht" verschijnt`, kaart.uitverkochtLabel === true, 'label zichtbaar');
      check(`${label}: de naam is doorgestreept`, kaart.doorgestreept === true, 'text-decoration-line');
      overflowCheck(label, uit);
      const uitFraming = await scrollTo('.aanbod-card');
      const uitBestand = await shot(`overzicht-uitverkocht-${width.name}-${theme}`, {
        theme,
        state: 'op-is-op-aan',
        themeProof: proof,
        panelClosed,
      });

      await klikOpIsOp(false);
      const terug = await evalJs(cdp, OVERZICHT_STAAT);
      const weer = terug.kaarten[0] || { knoppen: [], uitverkochtLabel: true };
      check(`${label}: de knop staat weer op "Op = op"`, weer.knoppen.indexOf('Op = op') !== -1, JSON.stringify(weer.knoppen));
      check(`${label}: het label "Uitverkocht" verdwijnt weer`, weer.uitverkochtLabel === false, 'label weg');
      const terugBestand = await shot(`overzicht-terug-${width.name}-${theme}`, {
        theme,
        state: 'op-is-op-terug',
        themeProof: proof,
        panelClosed,
      });

      resultaten.push({
        viewport: width.name,
        theme,
        themeProof: proof,
        panelClosed,
        voor: { framing: voorFraming, file: voorBestand.file },
        uit: { framing: uitFraming, file: uitBestand.file, kaart },
        terug: { file: terugBestand.file, kaart: weer },
      });
    }
  }
  const oproepen = await evalJs(cdp, 'window.__BE67__ ? window.__BE67__.uitverkocht.length : 0');
  check('overzicht: elke klik ging naar de Op = op-route', oproepen >= THEMES.length * WIDTHS.length * 2, oproepen);
  return { scenario: 'overzicht', begin, resultaten, uitverkochtOproepen: oproepen };
}

// --- Het blok "Vandaag" bij de bezoeker -------------------------------------

const VANDAAG_STAAT = `(() => {
  const blok = document.querySelector('.daghap-vandaag');
  if (!blok) return { present: false, overflow: document.documentElement.scrollWidth - window.innerWidth };
  const kaarten = [...blok.querySelectorAll('.daghap-vandaag-card')].map((kaart) => {
    const naam = kaart.querySelector('.daghap-vandaag-name');
    const stijl = naam ? getComputedStyle(naam) : null;
    const badge = kaart.querySelector('.daghap-vandaag-badge');
    return {
      naam: naam ? (naam.textContent || '').trim() : '',
      uitverkocht: kaart.className.indexOf('daghap-vandaag-card--uitverkocht') !== -1,
      badge: badge ? (badge.textContent || '').trim() : null,
      doorgestreept: stijl ? String(stijl.textDecorationLine || '').indexOf('line-through') !== -1 : false,
      // De demping staat op de kaart (opacity 0.65), niet op de naam.
      opacity: Number(getComputedStyle(kaart).opacity),
      gangen: [...kaart.querySelectorAll('.daghap-vandaag-gang')].map((gang) => ({
        label: ((gang.querySelector('.daghap-vandaag-gang-label') || {}).textContent || '').trim(),
        naam: ((gang.querySelector('.daghap-vandaag-gang-naam') || {}).textContent || '').trim(),
      })),
      chips: [...kaart.querySelectorAll('.daghap-vandaag-chip')].map((chip) => (chip.textContent || '').trim()),
      herhaal: ((kaart.querySelector('.daghap-vandaag-herhaal') || {}).textContent || '').trim(),
      bewaar: kaart.querySelectorAll('[aria-label^="Bewaar"]').length,
      deel: kaart.querySelectorAll('[aria-label^="Deel"]').length,
    };
  });
  return {
    present: true,
    titel: ((blok.querySelector('h2') || {}).textContent || '').trim(),
    kaarten,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    thema: document.documentElement.getAttribute('data-theme'),
  };
})()`;

function beoordeelVandaag(label, gemeten) {
  check(`${label}: het blok "Vandaag" staat er`, gemeten.present === true && gemeten.titel === 'Vandaag', gemeten.titel);
  const menu = (gemeten.kaarten || []).find((kaart) => kaart.gangen.length > 0) || {};
  check(`${label}: het dagmenu toont drie gangen`, (menu.gangen || []).length === 3, JSON.stringify(menu.gangen && menu.gangen.map((gang) => gang.naam)));
  check(
    `${label}: de gangen hebben een korte kop en een naam`,
    (menu.gangen || []).length === 3 && menu.gangen.every((gang) => gang.label.length > 0 && gang.naam.length > 0),
    JSON.stringify(menu.gangen),
  );
  check(`${label}: twee prijschips (2 en 3 gangen)`, (menu.chips || []).length === 2, JSON.stringify(menu.chips));
  check(
    `${label}: de chips noemen beide prijzen`,
    (menu.chips || []).join(' | ') === '2 gangen € 29,50 | 3 gangen € 36,50',
    JSON.stringify(menu.chips),
  );
  check(`${label}: het dagmenu heeft Bewaar en Delen`, menu.bewaar === 1 && menu.deel === 1, `bewaar ${menu.bewaar} · deel ${menu.deel}`);
  check(`${label}: de herhaling staat erbij`, String(menu.herhaal || '').indexOf('di') !== -1 && String(menu.herhaal || '').indexOf('do') !== -1, menu.herhaal);

  const uit = (gemeten.kaarten || []).find((kaart) => kaart.uitverkocht) || null;
  check(`${label}: de uitverkochte daghap blijft in de lijst staan`, Boolean(uit), gemeten.kaarten ? gemeten.kaarten.length : 0);
  if (uit) {
    check(`${label}: de badge zegt "Op = op · uitverkocht"`, uit.badge === 'Op = op · uitverkocht', uit.badge);
    check(`${label}: de naam is doorgestreept`, uit.doorgestreept === true, 'text-decoration-line');
    check(`${label}: de kaart is gedempt`, Number.isFinite(uit.opacity) && uit.opacity < 1, `opacity ${uit.opacity}`);
  }
  overflowCheck(label, gemeten);
}

async function vandaagScenario() {
  await setViewport(1280, 900);
  await openPage(RESTAURANT_URL, { ready: `Boolean(document.querySelector('.daghap-vandaag-card'))` });

  const resultaten = [];
  for (const theme of THEMES) {
    // Het thema van de bezoeker zit in het instellingenpaneel; dat gaat dicht
    // vóór de opname.
    const { proof, panelClosed } = await applyTheme(theme, { paneel: true });
    for (const width of WIDTHS) {
      const label = `vandaag · ${width.name} · ${theme}`;
      await setViewport(width.width, width.height);
      const framing = await scrollTo('.daghap-vandaag');
      const gemeten = await evalJs(cdp, VANDAAG_STAAT);
      beoordeelVandaag(label, gemeten);
      check(`${label}: het blok staat in beeld bij de opname`, framing.inBeeld === true, JSON.stringify(framing));
      const bestand = await shot(`vandaag-${width.name}-${theme}`, {
        theme,
        state: 'dagmenu-en-uitverkochte-daghap',
        themeProof: proof,
        panelClosed,
      });
      resultaten.push({ viewport: width.name, theme, framing, measured: gemeten, themeProof: proof, panelClosed, file: bestand.file });
    }
  }
  const publiek = await evalJs(cdp, 'window.__BE67__ ? window.__BE67__.publiekCalls.length : 0');
  check('vandaag: de pagina haalde het aanbod bij de publieke route', publiek >= 1, publiek);
  return { scenario: 'vandaag', resultaten, publiekOproepen: publiek };
}

// --- De a11y-audit, gefilterd op beide pagina's ------------------------------

/** De audit van BE-62/BE-65, met dezelfde drempel (44 px) en zonder fouten. */
async function auditeer(label, theme) {
  const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
  const review = audit.checksFromAudit(label, theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
  for (const failure of review.errors) {
    check(`${label} · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
  }
  check(`${label} · a11y-audit zonder fouten`, review.errors.length === 0, `${review.errors.length} fouten`);
  return review;
}

async function a11yScenario() {
  const resultaten = [];
  for (const theme of THEMES) {
    // De houderpagina: de themaknop staat in de kop.
    await setViewport(1280, 900);
    await openPage(AANBOD_URL, { login: true, ready: `Boolean(document.querySelector('.aanbod-card'))` });
    await applyTheme(theme, { paneel: false });
    for (const width of [WIDTHS[0], WIDTHS[1]]) {
      const label = `houderpagina · ${width.name} · ${theme}`;
      await setViewport(width.width, width.height);
      await evalJs(cdp, scrollToScript('.aanbod-card'));
      await sleep(200);
      resultaten.push({ pagina: 'houderpagina', viewport: width.name, theme, fouten: (await auditeer(label, theme)).errors.length });
    }

    // De restaurantpagina: het thema via het instellingenpaneel, daarna dicht.
    await setViewport(1280, 900);
    await openPage(RESTAURANT_URL, { ready: `Boolean(document.querySelector('.daghap-vandaag-card'))` });
    await applyTheme(theme, { paneel: true });
    for (const width of [WIDTHS[0], WIDTHS[1]]) {
      const label = `restaurantpagina · ${width.name} · ${theme}`;
      await setViewport(width.width, width.height);
      await evalJs(cdp, scrollToScript('.daghap-vandaag'));
      await sleep(200);
      resultaten.push({ pagina: 'restaurantpagina', viewport: width.name, theme, fouten: (await auditeer(label, theme)).errors.length });
    }
  }
  return { scenario: 'a11y', resultaten };
}

const SCENARIOS = [
  { name: 'formulier', run: () => formulierScenario() },
  { name: 'overzicht', run: () => overzichtScenario() },
  { name: 'vandaag', run: () => vandaagScenario() },
  { name: 'a11y', run: () => a11yScenario() },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  return filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    kind: 'fixture_browser_evidence',
    startedAt: new Date().toISOString(),
    port: PORT,
    mode: 'start',
    scenarioRuns,
    filter: SELECTION.filter || null,
    network: networkEvidence,
    themes: themeLog,
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
    try {
      writeEvidence({ error: 'run_timeout (20 min)' });
    } catch (ignored) {
      // Bewijs schrijven is ook hier best effort.
    }
    process.exit(2);
  }, 20 * 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  try {
    // De echte productieopbouw: `next build` + `next start`, zoals BE-57/BE-62.
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: AANBOD_URL,
      // De in-page stubs antwoorden zelf; de guard moet de routes alleen toestaan.
      fixtureRoutes: [
        { id: 'daghap', match: 'prefix', path: '/api/v1/daghap', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
        { id: 'tellers', match: 'exact', path: '/api/v1/tellers', methods: ['POST'] },
        { id: 'bekeken', match: 'exact', path: '/api/v1/bekeken', methods: ['POST'] },
        { id: 'me', match: 'exact', path: '/api/internal/v1/me', methods: ['GET'] },
      ],
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
    console.log(
      JSON.stringify(
        {
          passed: record.passed,
          checks: checks.length,
          failed: record.failed,
          screenshots: shots.length,
          evidence: evidencePath(),
        },
        null,
        2,
      ),
    );
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
