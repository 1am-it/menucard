'use strict';

// BE-58 deel 4 (#143) — browsercheck voor de twee schermen van "snel aanpassen".
//
// Twee scenario's, elk in een echte lokale browser (Edge/Chrome via CDP, geen
// dependency), met een gestubde sessie en API (lib/be58-stub-page.js):
//
//   houder-menukaart    /mijn-restaurant/menukaart: prijs wijzigen, "tijdelijk
//                       niet beschikbaar", opslaan, de statuslijst "Je
//                       wijzigingen" en "Bevestig je menukaart";
//   interne-wijzigingen /internal/menukaart-wijzigingen: goedkeuren, afwijzen
//                       met een reden en de markering "Grote wijziging".
//
// Per pagina: licht en donker op 1280, 390 en 320 px, het thema via de
// themaknop van de app, elk onderdeel volledig op de opname, toetsenbord en
// focus, geen horizontale overloop, plus de bestaande a11y-audit
// (lib/a11y-audit.js, dezelfde als run-a11y-public-check.js) met 0 fouten.
//
// Lokaal alleen: next dev op poort 3191 (uit 3190-3199), geen productie, geen
// echte sessie en geen externe hosts. Bewijs:
// ops/browser/evidence/be58-browser-evidence.json en evidence/be-58/*.png.

const fs = require('node:fs');
const path = require('node:path');

const {
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
  killTree,
  findBrowser,
} = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');
const { be58StubScript, RESTAURANT_ID, MENU_ID } = require('./lib/be58-stub-page');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const PORT = Number(process.env.BE58_PORT || 3191);
const APP = `http://localhost:${PORT}`;
const OWNER_ROUTE = '/mijn-restaurant/menukaart';
const INTERNAL_ROUTE = '/internal/menukaart-wijzigingen';
const OWNER_URL = `${APP}${OWNER_ROUTE}`;
const INTERNAL_URL = `${APP}${INTERNAL_ROUTE}`;

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-58');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be58-browser-evidence.json');

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];
const THEMES = ['light', 'dark'];

const checks = [];
const errors = [];
const shots = [];
let cdp = null;
let server = null;
let browser = null;
let stubScriptId = null;

function add(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) errors.push({ name, detail: detail === undefined ? null : String(detail) });
  return Boolean(passed);
}

function writeEvidence(extra = {}) {
  const target = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
  const record = {
    ticket: 'BE-58 (#143)',
    routes: [OWNER_ROUTE, INTERNAL_ROUTE],
    category: `lokale browsercheck met gestubde sessie en API (next dev op poort ${PORT}); geen productie en geen echte acceptatie`,
    ranAt: new Date().toISOString(),
    passed: errors.length === 0 && !extra.error,
    filter: SELECTION.filter,
    checks,
    errors,
    shots,
    ...extra,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  return { target, record };
}

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

// Het thema komt van de themaknop van de app zelf, niet uit een eigenschap die
// de check zelf zet: zo doet de bezoeker het ook.
async function chooseTheme(theme) {
  const label = theme === 'dark' ? 'Donker' : 'Licht';
  const klik = (naam) => `(() => {
      function zichtbaar(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const stijl = getComputedStyle(el);
        return stijl.visibility !== 'hidden' && stijl.display !== 'none';
      }
      const knoppen = Array.from(document.querySelectorAll('.theme-switch button'))
        .filter((el) => (el.innerText || '').trim() === ${JSON.stringify(naam)});
      const doel = knoppen.filter(zichtbaar)[0];
      if (doel) {
        doel.click();
        return 'geklikt';
      }
      // Op een smal scherm zit de themaknop in het menu van de navigatie; dat
      // opent de bezoeker ook eerst.
      const trigger = Array.from(document.querySelectorAll('nav button[aria-expanded="false"]'))[0];
      if (!trigger) return 'geen-knop';
      trigger.click();
      return 'menu-geopend';
    })()`;
  for (let poging = 0; poging < 3; poging += 1) {
    const resultaat = await evalJs(cdp, klik(label));
    if (resultaat === 'geklikt') {
      await waitFor(cdp, `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(theme)}`, 8000);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return (await evalJs(cdp, 'document.documentElement.getAttribute("data-theme")')) === theme;
    }
    if (resultaat === 'geen-knop') return false;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function installStub(options) {
  if (stubScriptId) {
    await cdp
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubScriptId })
      .catch(() => {});
    stubScriptId = null;
  }
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be58StubScript(options) });
  stubScriptId = result.identifier || null;
}

// De stand van de fictieve server terug naar de beginstand. Dit gebeurt vóór de
// nieuwe navigatie: de stub bewaart zijn stand in sessionStorage, dus een nieuw
// document leest daarna precies de beginstand en nooit de oude.
async function clearStubState() {
  await evalJs(
    cdp,
    `(() => {
      if (window.__BE58__ && window.__BE58__.clear) {
        window.__BE58__.clear();
        return true;
      }
      try { sessionStorage.removeItem('be58-state'); } catch (error) {}
      return true;
    })()`,
  );
}

// Het hele onderdeel op de opname: de uitsnede loopt van de bovenkant van het
// element tot de onderkant, ook als het hoger is dan het venster.
async function capture(selector, name) {
  const info = await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left, right: rect.right, width: rect.width, height: rect.height,
        pageX: rect.left + window.scrollX, pageY: rect.top + window.scrollY,
        innerWidth: window.innerWidth,
      };
    })()`,
  );
  if (!info) {
    add(`opname ${name}: onderdeel gevonden`, false, `geen element voor ${selector}`);
    return null;
  }
  await new Promise((resolve) => setTimeout(resolve, 140));
  const fitsHorizontally = info.left >= -1 && info.right <= info.innerWidth + 1;
  const clip = {
    x: Math.max(0, Math.round(info.pageX)),
    y: Math.max(0, Math.round(info.pageY)),
    width: Math.max(1, Math.round(Math.min(info.width, info.innerWidth))),
    height: Math.max(1, Math.round(info.height)),
  };
  const shot = await screenshot(cdp, SHOT_DIR, `${name}.png`, { clip });
  shots.push({ ...shot, selector, clip, fitsHorizontally });
  add(`opname ${name}: hele onderdeel in beeld`, fitsHorizontally, JSON.stringify({ clip, fitsHorizontally }));
  return shot;
}

async function noHorizontalOverflow(label) {
  const gemeten = await evalJs(
    cdp,
    `(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
    }))()`,
  );
  add(`${label}: geen horizontale overloop`, gemeten.scrollWidth <= gemeten.innerWidth + 1, JSON.stringify(gemeten));
}

async function focusWalk(label, verwacht) {
  await evalJs(
    cdp,
    `(() => { const body = document.body; body.setAttribute('tabindex', '-1'); body.focus(); return true; })()`,
  );
  await evalJs(cdp, audit.inPageSource('prepareFocusWalk', [{ scope: 'page' }]));
  const walk = [];
  for (let step = 0; step < 24; step += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const info = await evalJs(cdp, audit.inPageSource('readFocusStep', []));
    if (!info || info.done) break;
    walk.push({ name: info.name, selector: info.selector, visible: Boolean(info.indicator && info.indicator.visible) });
  }
  add(
    `${label}: toetsenbord, minstens vijf stappen met een zichtbare focusring`,
    walk.length >= 5 && walk.every((entry) => entry.visible),
    JSON.stringify(walk),
  );
  const namen = walk.map((entry) => entry.name || '');
  const gevonden = verwacht.filter((tekst) => namen.some((naam) => naam.toLowerCase().includes(tekst.toLowerCase())));
  add(`${label}: toetsenbord, verwachte bediening komt langs`, gevonden.length === verwacht.length, JSON.stringify(namen));
  return walk;
}

// De bestaande a11y-audit, dezelfde als run-a11y-public-check.js gebruikt;
// hier gefilterd op deze twee pagina's.
async function a11y(label, theme) {
  const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
  const review = audit.checksFromAudit(label, theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
  for (const check of review.checks) add(check.name, check.passed, check.detail);
  for (const failure of review.errors) {
    add(`${label} (${theme}) · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
  }
  return review;
}

// ---------------------------------------------------------------------------
// Scenario 1 — de houderpagina.
// ---------------------------------------------------------------------------

const OWNER_READY = `document.querySelector('.mk-card') !== null`;

// De eerste navigatie naar een route in `next dev` en de tweede kunnen even op
// zich laten wachten (compileren, hydrateren). Eén herkansing met een korte
// eerste wachttijd houdt de check snel en de meting eerlijk: pas als het scherm
// er echt staat, wordt er gemeten.
async function gotoPage(url, readyExpression) {
  for (let poging = 1; poging <= 2; poging += 1) {
    await cdp.send('Page.navigate', { url });
    const klaar = await waitFor(
      cdp,
      `document.readyState !== 'loading' && (${readyExpression})`,
      poging === 1 ? 20000 : 45000,
    );
    if (klaar) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return true;
    }
  }
  const staart = await evalJs(
    cdp,
    `(() => {
      const opslag = (() => { try { return Boolean(localStorage.getItem('sb-127-auth-token')); } catch (error) { return null; } })();
      return JSON.stringify({ pad: location.pathname, sessie: opslag, tekst: document.body ? document.body.innerText.slice(-500) : '' });
    })()`,
  );
  throw new Error(`page_not_ready: ${url}\n${staart}`);
}

async function openOwner() {
  await installStub({ roles: [{ role: 'owner', restaurant_id: RESTAURANT_ID }] });
  await gotoPage(OWNER_URL, OWNER_READY);
}

async function openOwnerFresh(theme, size) {
  await setViewport(size.width, size.height);
  await clearStubState();
  await openOwner();
  const themed = await chooseTheme(theme);
  add(`houder (${theme}/${size.name}): thema via de themaknop van de app`, themed, `data-theme=${theme}`);
  return themed;
}

async function runHouder() {
  // 1. Het scherm laadt met een houder-sessie en toont de eigen kaart.
  await setViewport(1280, 900);
  await openOwner();
  const scherm = await evalJs(
    cdp,
    `(() => ({
      pad: location.pathname,
      titel: (document.querySelector('.mk-title') || {}).innerText || '',
      gerechten: document.querySelectorAll('.mk-card').length,
      eerstePrijs: (document.getElementById('prijs-0:0') || {}).value || '',
    }))()`,
  );
  add('houder: blijft op /mijn-restaurant/menukaart (geen omleiding)', scherm.pad === OWNER_ROUTE, scherm.pad);
  add('houder: titel "Menukaart bijwerken"', scherm.titel.includes('Menukaart bijwerken'), scherm.titel);
  add('houder: de eigen kaart staat er (3 gerechten)', scherm.gerechten === 3, String(scherm.gerechten));
  add('houder: de huidige prijs staat als beginwaarde in het veld', scherm.eerstePrijs === '7,50', scherm.eerstePrijs);

  // 2. Prijs wijzigen en opslaan: eerst in controle, niet meteen zichtbaar.
  const ingevuld = await evalJs(
    cdp,
    `(() => {
      const input = document.getElementById('prijs-0:0');
      if (!input) return null;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '8,95');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`,
  );
  add('houder: de prijs is in het veld gewijzigd', ingevuld === '8,95', String(ingevuld));
  await evalJs(
    cdp,
    `(() => {
      const input = document.getElementById('prijs-0:0');
      const knop = input && input.closest('form').querySelector('button[type="submit"]');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const inControle = await waitFor(
    cdp,
    `(() => {
      const status = document.querySelector('.mk-status[role="status"]');
      return Boolean(status) && status.innerText.indexOf('We controleren een wijziging kort') !== -1;
    })()`,
    30000,
  );
  add('houder: na opslaan ziet de houder de regel "We controleren een wijziging kort …"', inControle);

  const historie = await evalJs(
    cdp,
    `Array.from(document.querySelectorAll('.mk-history-row')).map((rij) => rij.innerText)`,
  );
  add(
    'houder: de wijziging staat op "In controle" in "Je wijzigingen"',
    historie.some((tekst) => tekst.includes('Nieuwe prijs: €8,95') && tekst.includes('In controle')),
    JSON.stringify(historie),
  );

  // 3. "Tijdelijk niet beschikbaar" aanzetten en opslaan.
  await evalJs(
    cdp,
    `(() => {
      const vak = document.getElementById('niet-beschikbaar-0:1');
      if (!vak) return false;
      vak.click();
      return vak.checked;
    })()`,
  );
  await evalJs(
    cdp,
    `(() => {
      const vak = document.getElementById('niet-beschikbaar-0:1');
      const knop = vak && vak.closest('form').querySelector('button[type="submit"]');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const beschikbaarheid = await waitFor(
    cdp,
    `(() => {
      const rijen = Array.from(document.querySelectorAll('.mk-history-row')).map((rij) => rij.innerText);
      return rijen.some((tekst) => tekst.includes('Tijdelijk niet beschikbaar')) &&
        document.querySelectorAll('.mk-badge').length >= 2;
    })()`,
    30000,
  );
  add('houder: "Tijdelijk niet beschikbaar" staat in de statuslijst met een badge', beschikbaarheid);

  // 4. De houder bevestigt zijn kaart; het label met de datum verschijnt.
  await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('section.mk-confirm button.mk-save');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const bevestigd = await waitFor(
    cdp,
    `(() => {
      const label = document.querySelector('.mk-confirmed-label');
      return Boolean(label) && label.innerText.indexOf('Bevestigd door het restaurant') !== -1;
    })()`,
    30000,
  );
  const labelTekst = await evalJs(cdp, `(document.querySelector('.mk-confirmed-label') || {}).innerText || ''`);
  add('houder: "Bevestig je menukaart" toont het label op de pagina', bevestigd, labelTekst);
  add('houder: het label noemt de datum', labelTekst.includes('31 oktober 2026'), labelTekst);

  // 5. Wat er werkelijk naar de (fictieve) server ging.
  const verstuurd = await evalJs(
    cdp,
    `(() => {
      const stub = window.__BE58__;
      if (!stub) return null;
      return {
        post: stub.calls.filter((regel) => regel.kind === 'api' && regel.method === 'POST'),
        violations: stub.violations,
        wijzigingen: stub.state().wijzigingen,
        bevestiging: stub.state().bevestiging,
      };
    })()`,
  );
  const berichten = (verstuurd ? verstuurd.post : []).map((regel) => JSON.parse(regel.body || '{}'));
  const prijsPost = berichten.find((rij) => rij.soort === 'prijs');
  const beschikbaarPost = berichten.find((rij) => rij.soort === 'beschikbaarheid');
  add(
    'houder: de prijswijziging ging met menu en gerecht naar de API',
    Boolean(prijsPost) && prijsPost.menuId === MENU_ID && prijsPost.gerechtIndex === 0 && prijsPost.prijs === '8,95',
    JSON.stringify(prijsPost),
  );
  add(
    'houder: de beschikbaarheid ging als "niet beschikbaar" naar de API',
    Boolean(beschikbaarPost) && beschikbaarPost.menuId === MENU_ID && beschikbaarPost.beschikbaar === false,
    JSON.stringify(beschikbaarPost),
  );
  add(
    'houder: de nieuwe wijzigingen staan op in_controle en de bevestiging is actief',
    Boolean(verstuurd) &&
      verstuurd.wijzigingen.filter((rij) => rij.status === 'in_controle').length >= 2 &&
      verstuurd.bevestiging.actief === true,
    JSON.stringify(
      verstuurd && { statussen: verstuurd.wijzigingen.map((rij) => rij.status), bevestiging: verstuurd.bevestiging },
    ),
  );
  add(
    'houder: geen enkele externe of onbekende API-aanroep',
    Boolean(verstuurd) && verstuurd.violations.length === 0,
    JSON.stringify(verstuurd && verstuurd.violations),
  );

  // 6. Toetsenbord en focus.
  await openOwnerFresh('light', WIDTHS[0]);
  await focusWalk('houder', ['Prijs voor Pompoensoep', 'Wijzigingen opslaan', 'Bevestig je menukaart']);

  // 7. De a11y-check op deze pagina, in licht en donker.
  for (const theme of THEMES) {
    await openOwnerFresh(theme, WIDTHS[0]);
    await a11y('houder', theme);
  }

  // 8. Licht en donker op 1280, 390 en 320 px: elk onderdeel volledig in beeld.
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      await openOwnerFresh(theme, size);
      const naam = `be58-houder-${size.name}-${theme}`;
      await capture('section[aria-labelledby="mk-dishes-title"] .mk-card', `${naam}-gerecht`);
      await capture('section[aria-labelledby="mk-history-title"]', `${naam}-wijzigingen`);
      await capture('section.mk-confirm', `${naam}-bevestigen`);
      await noHorizontalOverflow(`houder (${theme}/${size.name})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario 2 — de interne controlelijst.
// ---------------------------------------------------------------------------

const INTERNAL_READY = `document.querySelector('.mw-card') !== null`;

async function openIntern() {
  await installStub({ roles: [{ role: 'internal', restaurant_id: null }] });
  await gotoPage(INTERNAL_URL, INTERNAL_READY);
}

async function openInternFresh(theme, size) {
  await setViewport(size.width, size.height);
  await clearStubState();
  await openIntern();
  const themed = await chooseTheme(theme);
  add(`intern (${theme}/${size.name}): thema via de themaknop van de app`, themed, `data-theme=${theme}`);
  return themed;
}

async function runIntern() {
  // 1. De lijst laadt met een interne sessie: twee wijzigingen, één groot.
  await setViewport(1280, 900);
  await openIntern();
  const lijst = await evalJs(
    cdp,
    `(() => ({
      pad: location.pathname,
      titel: (document.querySelector('.mw-title') || {}).innerText || '',
      kaarten: document.querySelectorAll('.mw-card').length,
      groot: Array.from(document.querySelectorAll('.mw-big')).map((el) => el.innerText),
      notitie: Array.from(document.querySelectorAll('.mw-note')).map((el) => el.innerText).join(' | '),
    }))()`,
  );
  add('intern: blijft op /internal/menukaart-wijzigingen', lijst.pad === INTERNAL_ROUTE, lijst.pad);
  add('intern: titel "Wijzigingen van houders"', lijst.titel.includes('Wijzigingen van houders'), lijst.titel);
  add('intern: twee wijzigingen in de werkvoorraad', lijst.kaarten === 2, String(lijst.kaarten));
  add('intern: de markering "Grote wijziging" staat bij de grote wijziging', lijst.groot.length === 1, JSON.stringify(lijst.groot));
  add(
    'intern: de samenvatting noemt één grote wijziging',
    lijst.notitie.includes('1 van deze wijzigingen is een grote wijziging'),
    lijst.notitie,
  );

  // 2. Goedkeuren: de wijziging verdwijnt uit de werkvoorraad.
  await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('.mw-card .mw-approve');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const goedgekeurd = await waitFor(cdp, `document.querySelectorAll('.mw-card').length === 1`, 30000);
  const naGoedkeuren = await evalJs(
    cdp,
    `(() => ({
      kaarten: document.querySelectorAll('.mw-card').length,
      status: window.__BE58__ ? window.__BE58__.state().wijzigingen.map((rij) => [rij.wijzigingId, rij.status]) : [],
      bevestiging: window.__BE58__ ? window.__BE58__.state().bevestiging : null,
    }))()`,
  );
  add('intern: na goedkeuren blijft één wijziging over', goedgekeurd, JSON.stringify(naGoedkeuren.kaarten));
  add(
    'intern: de goedgekeurde wijziging staat op goedgekeurd en telt als bevestiging',
    naGoedkeuren.status.some((rij) => rij[0] === 101 && rij[1] === 'goedgekeurd') &&
      Boolean(naGoedkeuren.bevestiging) &&
      naGoedkeuren.bevestiging.actief === true,
    JSON.stringify(naGoedkeuren),
  );

  // 3. Afwijzen met een reden.
  await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('.mw-card .mw-reject');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const formulier = await waitFor(cdp, `document.querySelector('.mw-reject-form .mw-input') !== null`, 15000);
  add('intern: "Afwijzen" opent het formulier met een redenveld', formulier);
  await evalJs(
    cdp,
    `(() => {
      const invoer = document.querySelector('.mw-reject-form .mw-input');
      if (!invoer) return false;
      invoer.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(invoer, 'Prijs past niet bij de kaart');
      invoer.dispatchEvent(new Event('input', { bubbles: true }));
      return invoer.value;
    })()`,
  );
  await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('.mw-reject-form button[type="submit"]');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const afgewezen = await waitFor(
    cdp,
    `(() => document.querySelectorAll('.mw-card').length === 0 &&
      Array.from(document.querySelectorAll('.mw-note')).some((el) => el.innerText.indexOf('geen wijzigingen') !== -1))()`,
    30000,
  );
  add('intern: na afwijzen is de werkvoorraad leeg', afgewezen);

  // 4. De afgewezen wijziging staat met reden onder het filter "Afgewezen".
  await evalJs(
    cdp,
    `(() => {
      const knop = Array.from(document.querySelectorAll('.mw-filter'))
        .filter((el) => (el.innerText || '').trim() === 'Afgewezen')[0];
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const metReden = await waitFor(
    cdp,
    `(() => {
      const kaarten = Array.from(document.querySelectorAll('.mw-card'));
      return kaarten.length === 1 && kaarten[0].innerText.indexOf('Prijs past niet bij de kaart') !== -1;
    })()`,
    30000,
  );
  const afwijsStand = await evalJs(
    cdp,
    `(() => ({
      tekst: (document.querySelector('.mw-card') || {}).innerText || '',
      status: window.__BE58__ ? window.__BE58__.state().wijzigingen.map((rij) => [rij.wijzigingId, rij.status]) : [],
      violations: window.__BE58__ ? window.__BE58__.violations : [],
    }))()`,
  );
  add('intern: de afgewezen wijziging staat met reden onder "Afgewezen"', metReden, afwijsStand.tekst);
  add(
    'intern: de wijziging staat op afgewezen in de fictieve server',
    afwijsStand.status.some((rij) => rij[0] === 102 && rij[1] === 'afgewezen'),
    JSON.stringify(afwijsStand.status),
  );
  add(
    'intern: geen enkele externe of onbekende API-aanroep',
    afwijsStand.violations.length === 0,
    JSON.stringify(afwijsStand.violations),
  );

  // 5. Toetsenbord en focus, op de werkvoorraad.
  await openInternFresh('light', WIDTHS[0]);
  await focusWalk('intern', ['Te beoordelen', 'Goedkeuren', 'Afwijzen']);

  // 6. De a11y-check op deze pagina, in licht en donker.
  for (const theme of THEMES) {
    await openInternFresh(theme, WIDTHS[0]);
    await a11y('intern', theme);
  }

  // 7. Licht en donker op 1280, 390 en 320 px.
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      await openInternFresh(theme, size);
      const naam = `be58-intern-${size.name}-${theme}`;
      await capture('.mw-filters', `${naam}-filters`);
      await capture('.mw-list .mw-card', `${naam}-wijziging`);
      await capture('.mw-list', `${naam}-lijst`);
      await noHorizontalOverflow(`intern (${theme}/${size.name})`);
    }
  }
}

const SCENARIOS = [
  { name: 'houder-menukaart', run: runHouder },
  { name: 'interne-wijzigingen', run: runIntern },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: 'run-be58-browser-check.js' });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('no_local_browser');
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  server = await startServer({ port: PORT, appUrl: APP, outputDir: path.join(__dirname, 'output', 'be-58') });

  // De eerste keer compileren deze routes tientallen seconden; dat mag geen
  // CDP-timeout op de eerste navigatie worden. Daarom eerst de routes zelf
  // opvragen, zodat de dev-server ze al gebouwd heeft.
  for (const route of [OWNER_ROUTE, INTERNAL_ROUTE]) {
    await waitForHttp(`${APP}${route}`, 180000);
  }

  browser = await startBrowser(browserPath);
  cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });
  return writeEvidence({ scenarios: scenarioRuns, port: PORT });
}

const timeout = setTimeout(() => {
  writeEvidence({ error: 'run_timeout (12 min)' });
  try {
    if (browser) killTree(browser.child);
    if (server) killTree(server);
  } catch {
    // afsluiten mag nooit de uitslag verbergen
  }
  process.exit(1);
}, 12 * 60 * 1000);

(async () => {
  try {
    const result = await main();
    clearTimeout(timeout);
    if (!result) return;
    console.log(
      JSON.stringify({
        evidence: result.target,
        passed: result.record.passed,
        checks: checks.length,
        errors: errors.length,
        shots: shots.length,
      }),
    );
    for (const error of errors.slice(0, 10)) console.log(`FOUT: ${error.name} — ${error.detail}`);
  } catch (error) {
    clearTimeout(timeout);
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(String((error && error.stack) || error));
    process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.close();
      if (browser) killTree(browser.child);
      if (server) killTree(server);
    } catch {
      // afsluiten mag nooit de uitslag verbergen
    }
  }
  if (errors.length > 0) process.exitCode = 1;
})();


