'use strict';

// BE-55 stap B (#135) — browsercheck met een gestubde API voor het blok
// "Vandaag" op de restaurant- en menupagina, met de meldknop.
//
// Fixture-bewijs: de echte productieopbouw (`next start`), een echte browser via
// CDP, en één in de pagina gestubde daghap-API. Geen Supabase-project, geen
// productiesleutel, geen productiedata, geen internet.
//
// Wat bewezen wordt:
//  - /restaurant/6 en /menu/6-diner tonen "Vandaag" met een kaart per aanbod:
//    naam, prijspil, beschrijving, labels, de seizoensregel, "Bewaar", "Deel" en
//    "Klopt dit aanbod niet? Meld het";
//  - de kaart heeft een rand van 2 px en de prijs staat in de prijspil;
//  - zonder aanbod (leeg=1) verschijnt er geen blok;
//  - melden geeft een bevestiging, een tweede tik zegt "Je had dit al gemeld",
//    en de browser stuurt alleen een willekeurig apparaatkenmerk mee;
//  - licht en donker op 1280, 390 en 320 px, zonder horizontale overflow, met
//    focus op de meldknop en een contrastcheck op de nieuwe tekst;
//  - screenshots bij het bewijs.
//
// Niet bewezen hier: de serverregels (3 meldingen, limieten, filter) — die staan
// in src/lib/daghapHandlers.test.js. Dit is ontwikkelaarsbewijs, geen
// onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be55-browser-check.js [--alleen=<scenario>] [--lijst]

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
const { be55StubScript, DAGHAP, SEIZOEN } = require('./lib/be55-daghap-stub');
const audit = require('./lib/a11y-audit');

const OUT_DIR = path.join(__dirname, 'output', 'be-55');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be55-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-55');
const SCRIPT_NAME = 'run-be55-browser-check.js';
const PORT = Number(process.env.BE55_FIXTURE_PORT || 3195);
const APP = `http://localhost:${PORT}`;
const RESTAURANT_URL = (query = '') => `${APP}/restaurant/6${query}`;
const MENU_URL = `${APP}/menu/6-diner`;
const APP_ORIGINS = defaultAppOrigins(PORT);

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

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({ ...file, viewport: `${viewport.width}x${viewport.height}`, theme: meta.theme || null, state: meta.state || null });
  return file;
}

async function kiesThema(cdp, theme) {
  await evalJs(cdp, `(() => { try { localStorage.setItem('bredaeats_theme', '${theme}'); } catch (error) { return false; } return true; })()`);
}

const KAART_STAAT = `(() => {
  const blok = document.querySelector('.daghap-vandaag');
  const kaarten = Array.from(document.querySelectorAll('.daghap-vandaag-card'));
  const eerste = kaarten[0];
  const prijs = eerste ? eerste.querySelector('.daghap-vandaag-price') : null;
  const knop = eerste ? eerste.querySelector('.daghap-vandaag-report-button') : null;
  const kop = eerste ? eerste.querySelector('.daghap-vandaag-name') : null;
  const kaartStijl = eerste ? getComputedStyle(eerste) : null;
  const prijsStijl = prijs ? getComputedStyle(prijs) : null;
  const kopStijl = kop ? getComputedStyle(kop) : null;
  return {
    thema: document.documentElement.getAttribute('data-theme'),
    titel: blok ? blok.querySelector('h2').textContent.trim() : '',
    aantal: kaarten.length,
    namen: kaarten.map((kaart) => (kaart.querySelector('.daghap-vandaag-name') || {}).textContent || ''),
    prijzen: kaarten.map((kaart) => (kaart.querySelector('.daghap-vandaag-price') || {}).textContent || ''),
    labels: kaarten.map((kaart) => Array.from(kaart.querySelectorAll('.daghap-vandaag-label')).map((label) => label.textContent.trim())),
    seizoen: kaarten.map((kaart) => (kaart.querySelector('.daghap-vandaag-season') || {}).textContent || ''),
    meldtekst: knop ? knop.textContent.trim() : '',
    rand: kaartStijl ? kaartStijl.borderTopWidth : '',
    kaartAchtergrond: kaartStijl ? kaartStijl.backgroundColor : '',
    prijsKleur: prijsStijl ? prijsStijl.color : '',
    prijsAchtergrond: prijsStijl ? prijsStijl.backgroundColor : '',
    kopKleur: kopStijl ? kopStijl.color : '',
    knopHoogte: knop ? Math.round(knop.getBoundingClientRect().height) : 0,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    aria: blok ? blok.getAttribute('aria-labelledby') : '',
    h2Id: blok && blok.querySelector('h2') ? blok.querySelector('h2').id : '',
    bewaar: Boolean(eerste && eerste.querySelector('[aria-label^="Bewaar"]')),
    deel: Boolean(eerste && eerste.querySelector('[aria-label^="Deel"]')),
    bewaarAantal: eerste ? eerste.querySelectorAll('[aria-label^="Bewaar"]').length : 0,
    deelAantal: eerste ? eerste.querySelectorAll('[aria-label^="Deel"]').length : 0,
    apparaat: (() => { try { return localStorage.getItem('daghap-apparaat') || ''; } catch (error) { return ''; } })(),
  };
})()`;

// BE-55 (#135, herstel na review deel 2) — bewijs dat het blok écht in het
// beeld staat bij de opname. Eerst naar het blok scrollen (met ruimte voor de
// plakkende kop), daarna meten of het binnen de viewport valt.
const TOON_BLOK = `(() => {
  const blok = document.querySelector('.daghap-vandaag');
  if (!blok) return { inBeeld: false, reden: 'geen blok' };
  blok.scrollIntoView({ block: 'start', inline: 'nearest' });
  window.scrollBy(0, -80);
  const kop = blok.querySelector('h2');
  const r = blok.getBoundingClientRect();
  const k = kop ? kop.getBoundingClientRect() : null;
  return {
    inBeeld: r.top >= 0 && r.top < window.innerHeight && r.bottom > 0,
    kopInBeeld: Boolean(k) && k.top >= 0 && k.top < window.innerHeight,
    boven: Math.round(r.top),
    onder: Math.round(r.bottom),
    hoogte: Math.round(r.height),
    scherm: window.innerHeight,
    scrollY: Math.round(window.scrollY),
  };
})()`;

async function toonEnMeetBlok(cdp) {
  return evalJs(cdp, TOON_BLOK);
}


async function vandaagScenario(cdp) {
  // Eerst één keer naar de app: localStorage van about:blank hoort bij een
  // andere origin, dus het thema zetten werkt pas daarna.
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, RESTAURANT_URL(), `Boolean(document.querySelector('.daghap-vandaag-card'))`, 120000);
  for (const theme of ['light', 'dark']) {
    await kiesThema(cdp, theme);
    for (const width of [1280, 390, 320]) {
      await setViewport(cdp, width, 900);
      await navigate(cdp, RESTAURANT_URL(), `Boolean(document.querySelector('.daghap-vandaag-card'))`, 120000);
      await waitFor(cdp, KAART_STAAT, 20000);
      const staat = await evalJs(cdp, KAART_STAAT);
      const waar = `${theme}/${width}`;

      check(`vandaag ${waar}: het thema is toegepast`, staat.thema === theme, staat.thema);
      check(`vandaag ${waar}: het blok heet "Vandaag"`, staat.titel === 'Vandaag', staat.titel);
      check(`vandaag ${waar}: twee kaarten (daghap en seizoensgerecht)`, staat.aantal === 2, staat.aantal);
      check(`vandaag ${waar}: de namen staan op de kaart`, staat.namen.join('|') === `${DAGHAP.naam}|${SEIZOEN.naam}`, staat.namen.join('|'));
      check(`vandaag ${waar}: de prijs staat in de prijspil`, staat.prijzen[0] === '€ 6,50', staat.prijzen[0]);
      check(`vandaag ${waar}: de labels staan als chips`, staat.labels[0].join(',') === 'Veganistisch,Glutenvrij', staat.labels[0].join(','));
      check(`vandaag ${waar}: de seizoensregel noemt de einddatum`, /Seizoensgerecht · Online tot en met 30 december/.test(staat.seizoen[1]), staat.seizoen[1]);
      check(`vandaag ${waar}: de meldlink staat er`, staat.meldtekst === 'Klopt dit aanbod niet? Meld het', staat.meldtekst);
      check(`vandaag ${waar}: de kaart heeft een rand van 2 px`, staat.rand === '2px', staat.rand);
      check(`vandaag ${waar}: geen horizontale overflow`, staat.overflow <= 0, staat.overflow);
      check(`vandaag ${waar}: de meldknop is minstens 44 px hoog`, staat.knopHoogte >= 44, staat.knopHoogte);
      check(`vandaag ${waar}: het blok is gelabeld door zijn kop`, Boolean(staat.h2Id) && staat.aria === staat.h2Id, `${staat.aria}/${staat.h2Id}`);
      check(`vandaag ${waar}: "Bewaar" en "Deel" staan op de kaart`, staat.bewaar && staat.deel, `${staat.bewaar}/${staat.deel}`);
      check(`vandaag ${waar}: precies één "Bewaar" en één "Deel" op de kaart`, staat.bewaarAantal === 1 && staat.deelAantal === 1, `${staat.bewaarAantal}/${staat.deelAantal}`);

      const prijsContrast = audit.contrastRatio(staat.prijsKleur, staat.prijsAchtergrond);
      const kopContrast = audit.contrastRatio(staat.kopKleur, staat.kaartAchtergrond);
      check(`vandaag ${waar}: de prijs haalt 4,5:1`, Number(prijsContrast) >= 4.5, prijsContrast);
      check(`vandaag ${waar}: de naam haalt 4,5:1`, Number(kopContrast) >= 4.5, kopContrast);

      const inBeeld = await toonEnMeetBlok(cdp);
      check(`vandaag ${waar}: het blok staat in beeld bij de opname`,
        inBeeld.inBeeld && inBeeld.kopInBeeld,
        JSON.stringify(inBeeld));

      await shot(cdp, `be55-vandaag-restaurant-${width}-${theme}.png`, { theme, state: 'aanbod' });
    }
  }

  // Dezelfde kaart op de menupagina, één keer per thema.
  for (const theme of ['light', 'dark']) {
    await kiesThema(cdp, theme);
    await setViewport(cdp, 1280, 900);
    await navigate(cdp, MENU_URL, `Boolean(document.querySelector('.daghap-vandaag-card'))`, 120000);
    const staat = await evalJs(cdp, KAART_STAAT);
    check(`menu ${theme}: het blok "Vandaag" staat ook op de menupagina`, staat.aantal === 2 && staat.titel === 'Vandaag', `${staat.aantal}/${staat.titel}`);
    check(`menu ${theme}: precies één "Bewaar" en één "Deel" op de kaart`, staat.bewaarAantal === 1 && staat.deelAantal === 1, `${staat.bewaarAantal}/${staat.deelAantal}`);
    const inBeeld = await toonEnMeetBlok(cdp);
    check(`menu ${theme}: het blok staat in beeld bij de opname`,
      inBeeld.inBeeld && inBeeld.kopInBeeld,
      JSON.stringify(inBeeld));
    await shot(cdp, `be55-vandaag-menu-1280-${theme}.png`, { theme, state: 'menu' });
  }

  // Zonder aanbod verschijnt er geen blok.
  await kiesThema(cdp, 'light');
  await setViewport(cdp, 390, 900);
  await navigate(cdp, RESTAURANT_URL('?leeg=1'), 'Boolean(document.querySelector("main"))', 120000);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const leeg = await evalJs(cdp, `Boolean(document.querySelector('.daghap-vandaag'))`);
  check('zonder aanbod: er is geen blok "Vandaag"', leeg === false, leeg);
  await shot(cdp, 'be55-vandaag-leeg-390-light.png', { theme: 'light', state: 'leeg' });
}

async function meldenScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await navigate(cdp, RESTAURANT_URL(), `Boolean(document.querySelector('.daghap-vandaag-card'))`, 120000);
  await kiesThema(cdp, 'dark');
  await navigate(cdp, RESTAURANT_URL(), `Boolean(document.querySelector('.daghap-vandaag-report-button'))`, 120000);

  // Toetsenbord: de meldknop is met Tab bereikbaar.
  let bereikbaar = false;
  for (let stap = 0; stap < 80 && !bereikbaar; stap += 1) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    bereikbaar = await evalJs(cdp, `Boolean(document.activeElement && document.activeElement.classList.contains('daghap-vandaag-report-button'))`);
  }
  check('melden: de meldknop is met het toetsenbord bereikbaar', bereikbaar, bereikbaar);
  const focusStijl = await evalJs(cdp, `(() => {
    const knop = document.querySelector('.daghap-vandaag-report-button');
    const stijl = knop ? getComputedStyle(knop) : null;
    return stijl ? { breedte: stijl.outlineWidth, stijl: stijl.outlineStyle } : null;
  })()`);
  check('melden: de focusring is zichtbaar', Boolean(focusStijl) && focusStijl.stijl === 'solid' && focusStijl.breedte === '2px', JSON.stringify(focusStijl));

  // Eerste tik: bevestiging.
  await evalJs(cdp, `document.querySelector('.daghap-vandaag-report-button').click()`);
  const eersteGezien = await waitFor(cdp, `Boolean(document.querySelector('.daghap-vandaag-report-note'))`, 20000);
  const eerste = await evalJs(cdp, `(() => { const note = document.querySelector('.daghap-vandaag-report-note'); return note ? { tekst: note.textContent.trim(), rol: note.getAttribute('role') } : null; })()`);
  check('melden: de bevestiging verschijnt', eersteGezien && Boolean(eerste) && eerste.tekst === 'Bedankt, we kijken ernaar.', eerste && eerste.tekst);
  check('melden: de bevestiging is een status voor hulpsoftware', Boolean(eerste) && eerste.rol === 'status', eerste && eerste.rol);
  await shot(cdp, 'be55-melden-bevestiging-390-dark.png', { theme: 'dark', state: 'bevestiging' });

  // Tweede tik: hetzelfde apparaat telt één keer.
  await evalJs(cdp, `document.querySelector('.daghap-vandaag-report-button').click()`);
  const tweedeGezien = await waitFor(cdp, `(() => { const note = document.querySelector('.daghap-vandaag-report-note'); return Boolean(note) && note.textContent.indexOf('al gemeld') !== -1; })()`, 20000);
  const tweede = await evalJs(cdp, `(() => { const note = document.querySelector('.daghap-vandaag-report-note'); return note ? note.textContent.trim() : null; })()`);
  check('melden: een tweede tik zegt dat het al gemeld is', tweedeGezien && tweede === 'Je had dit al gemeld. We kijken ernaar.', tweede);

  const verzonden = await evalJs(cdp, 'window.__BE55_MELDINGEN__ || []');
  const apparaat = await evalJs(cdp, `(() => { try { return localStorage.getItem('daghap-apparaat') || ''; } catch (error) { return ''; } })()`);
  check('melden: er zijn twee verzoeken verstuurd', Array.isArray(verzonden) && verzonden.length === 2, JSON.stringify(verzonden));
  check('melden: elk verzoek heeft alleen een apparaatkenmerk', Array.isArray(verzonden) && verzonden.every((body) => Object.keys(body).join(',') === 'apparaat'), JSON.stringify(verzonden && verzonden[0]));
  check('melden: het apparaatkenmerk heeft de vorm uit 0023', /^[A-Za-z0-9_-]{16,64}$/.test(String(verzonden && verzonden[0] && verzonden[0].apparaat)), verzonden && verzonden[0] && verzonden[0].apparaat);
  check('melden: het bewaarde kenmerk is hetzelfde als wat verstuurd is', Boolean(apparaat) && apparaat === (verzonden && verzonden[0] && verzonden[0].apparaat), apparaat);
}

// BE-55 deel 5 (#135) — het zoekresultaat met het label en het filter "Vandaag".
const ZOEK_STAAT = `(() => {
  const kaarten = Array.from(document.querySelectorAll('.dish-group-card'));
  const knop = document.querySelector('.vandaag-filter-btn');
  const labels = Array.from(document.querySelectorAll('.vandaag-label'));
  const eerste = labels[0] || null;
  const stijl = eerste ? getComputedStyle(eerste) : null;
  return {
    thema: document.documentElement.getAttribute('data-theme'),
    groepen: kaarten.length,
    koppen: kaarten.map((kaart) => ((kaart.querySelector('.dish-group-restaurant-name') || {}).textContent || '').trim()),
    labels: labels.map((label) => label.textContent.trim()),
    labelKleur: stijl ? stijl.color : '',
    labelAchtergrond: stijl ? stijl.backgroundColor : '',
    knopTekst: knop ? knop.textContent.trim() : '',
    knopAan: knop ? knop.getAttribute('aria-pressed') : '',
    knopSoort: knop ? knop.tagName : '',
    knopTab: knop ? knop.tabIndex : -1,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

// Het label moet bij de opname echt in het beeld staan, niet alleen bestaan.
const TOON_ZOEK_LABEL = `(() => {
  const label = document.querySelector('.vandaag-label');
  if (!label) return { inBeeld: false, reden: 'geen label' };
  label.scrollIntoView({ block: 'center', inline: 'nearest' });
  const kaart = label.closest('.dish-group-card') || label;
  const r = kaart.getBoundingClientRect();
  const l = label.getBoundingClientRect();
  return {
    inBeeld: r.top < window.innerHeight && r.bottom > 0,
    labelInBeeld: l.top >= 0 && l.bottom <= window.innerHeight,
    boven: Math.round(r.top),
    onder: Math.round(r.bottom),
    scherm: window.innerHeight,
  };
})()`;
async function zoekenScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, `${APP}/search?q=soep`, `Boolean(document.querySelector('.dish-group-card'))`, 120000);

  for (const theme of ['light', 'dark']) {
    await kiesThema(cdp, theme);
    for (const width of [1280, 390, 320]) {
      await setViewport(cdp, width, 900);
      await navigate(cdp, `${APP}/search?q=soep&vandaag=1`, `Boolean(document.querySelector('.dish-group-card'))`, 120000);
      const staat = await evalJs(cdp, ZOEK_STAAT);
      const waar = `${theme}/${width}`;

      check(`zoeken ${waar}: het thema is toegepast`, staat.thema === theme, staat.thema);
      check(`zoeken ${waar}: alleen de treffer staat er nog`, staat.groepen === 1, staat.groepen);
      check(`zoeken ${waar}: het label heet "Vandaag · daghap"`, staat.labels.join('|') === 'Vandaag · daghap', staat.labels.join('|'));
      check(`zoeken ${waar}: het label staat bij de juiste groep`, staat.koppen.join('|') === 'Brasserie Bardot', staat.koppen.join('|'));
      check(`zoeken ${waar}: de filterknop heet "Vandaag"`, staat.knopTekst === 'Vandaag', staat.knopTekst);
      check(`zoeken ${waar}: de filterknop staat aan`, staat.knopAan === 'true', staat.knopAan);
      check(`zoeken ${waar}: de filterknop is een echte knop met toetsenbordfocus`,
        staat.knopSoort === 'BUTTON' && staat.knopTab === 0, `${staat.knopSoort}/${staat.knopTab}`);
      check(`zoeken ${waar}: geen horizontale overflow`, staat.overflow <= 0, staat.overflow);

      const contrast = audit.contrastRatio(staat.labelKleur, staat.labelAchtergrond);
      check(`zoeken ${waar}: het label haalt 4,5:1`, Number(contrast) >= 4.5, contrast);

      const inBeeld = await evalJs(cdp, TOON_ZOEK_LABEL);
      check(`zoeken ${waar}: het label staat in beeld bij de opname`,
        inBeeld.inBeeld && inBeeld.labelInBeeld, JSON.stringify(inBeeld));

      await shot(cdp, `be55-zoeken-${width}-${theme}.png`, { theme, state: 'vandaag' });
    }
  }

  // Zonder filter: geen label. Eén klik op de knop zet het filter aan en de
  // zoekvraag gaat met vandaag=1 naar de API.
  await setViewport(cdp, 390, 900);
  await navigate(cdp, `${APP}/search?q=soep`, `Boolean(document.querySelector('.dish-group-card'))`, 120000);
  const voor = await evalJs(cdp, ZOEK_STAAT);
  check('zoeken: zonder filter geen enkel label', voor.groepen > 1 && voor.labels.length === 0, `${voor.groepen}/${voor.labels.length}`);
  check('zoeken: de knop staat zonder filter uit', voor.knopAan === 'false', voor.knopAan);

  await evalJs(cdp, `document.querySelector('.vandaag-filter-btn').click()`);
  const naGezien = await waitFor(
    cdp,
    `location.search.indexOf('vandaag=1') !== -1 && document.querySelectorAll('.vandaag-label').length === 1`,
    20000,
  );
  const na = await evalJs(cdp, ZOEK_STAAT);
  const zoekUrls = await evalJs(cdp, 'window.__BE55_ZOEK__ || []');
  check('zoeken: de knop zet ?vandaag=1 in de URL', naGezien, naGezien);
  check('zoeken: na de klik alleen de treffer, met label', na.groepen === 1 && na.labels.length === 1, `${na.groepen}/${na.labels.length}`);
  check('zoeken: de knop staat dan aan', na.knopAan === 'true', na.knopAan);
  check('zoeken: de zoekvraag ging met vandaag=1 naar de API',
    Array.isArray(zoekUrls) && zoekUrls.some((url) => url.indexOf('vandaag=1') !== -1),
    Array.isArray(zoekUrls) ? zoekUrls[zoekUrls.length - 1] : zoekUrls);
  await shot(cdp, 'be55-zoeken-filter-aan-390-dark.png', { theme: 'dark', state: 'filter-aan' });
}




const SCENARIOS = [
  { name: 'vandaag', run: (cdp) => vandaagScenario(cdp) },
  { name: 'melden', run: (cdp) => meldenScenario(cdp) },
  { name: 'zoeken', run: (cdp) => zoekenScenario(cdp) },
  { name: 'home', run: (cdp) => homeScenario(cdp) },
];
// "Daghappen vandaag" op de home.
const HOME_STAAT = `(() => {
  const sectie = document.querySelector('.daghappen-vandaag');
  if (!sectie) return { bestaat: false, overflow: document.documentElement.scrollWidth - window.innerWidth };
  const kaarten = Array.from(sectie.querySelectorAll('.daghappen-vandaag-kaart'));
  const titel = sectie.querySelector('#daghappen-vandaag-titel');
  const alle = sectie.querySelector('.daghappen-vandaag-alle');
  sectie.scrollIntoView({ block: 'center' });
  const r = sectie.getBoundingClientRect();
  return {
    bestaat: true,
    thema: document.documentElement.getAttribute('data-theme'),
    titel: titel ? titel.textContent.trim() : '',
    aantal: kaarten.length,
    namen: kaarten.map((kaart) => ((kaart.querySelector('.daghappen-vandaag-naam') || {}).textContent || '').trim()),
    alleHref: alle ? alle.getAttribute('href') : '',
    aria: sectie.getAttribute('aria-labelledby'),
    titelId: titel ? titel.id : '',
    inBeeld: r.top < window.innerHeight && r.bottom > 0,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

async function homeScenario(cdp) {
  await setViewport(cdp, 1280, 900);
  await navigate(cdp, `${APP}/`, `Boolean(document.querySelector('.daghappen-vandaag-kaart'))`, 120000);
  for (const theme of ['light', 'dark']) {
    await kiesThema(cdp, theme);
    for (const width of [1280, 390, 320]) {
      await setViewport(cdp, width, 900);
      await navigate(cdp, `${APP}/`, `Boolean(document.querySelector('.daghappen-vandaag-kaart'))`, 120000);
      const staat = await evalJs(cdp, HOME_STAAT);
      const waar = `${theme}/${width}`;

      check(`home ${waar}: de sectie "Daghappen vandaag" staat er`, staat.bestaat && staat.titel === 'Daghappen vandaag', `${staat.bestaat}/${staat.titel}`);
      check(`home ${waar}: twee kaarten met naam en prijs`, staat.aantal === 2 && staat.namen.join('|') === `${DAGHAP.naam}|${SEIZOEN.naam}`, `${staat.aantal}/${staat.namen.join('|')}`);
      check(`home ${waar}: "Alle" gaat naar het filter Vandaag`, staat.alleHref === '/search?vandaag=1', staat.alleHref);
      check(`home ${waar}: de sectie is gelabeld door zijn kop`, Boolean(staat.titelId) && staat.aria === staat.titelId, `${staat.aria}/${staat.titelId}`);
      check(`home ${waar}: geen horizontale overflow`, staat.overflow <= 0, staat.overflow);
      check(`home ${waar}: de sectie staat in beeld bij de opname`, staat.inBeeld, staat.inBeeld);

      await shot(cdp, `be55-home-daghappen-${width}-${theme}.png`, { theme, state: 'daghappen-vandaag' });
    }
  }
}


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
    try {
      writeEvidence({ error: 'run_timeout (8 min)' });
    } catch (ignored) {
      // Bewijs schrijven is ook hier best effort.
    }
    process.exit(2);
  }, 8 * 60 * 1000);
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
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: RESTAURANT_URL(),
      // De in-page stub antwoordt zelf; de guard moet de route alleen toestaan.
      fixtureRoutes: [
        { id: 'daghap', match: 'prefix', path: '/api/v1/daghap', methods: ['GET', 'POST'] },
        // BE-55 deel 5 (#135): het zoekresultaat met label en filter.
        { id: 'zoeken', match: 'prefix', path: '/api/search', methods: ['GET'] },
      ],
    });
    await enableFetchGuard(cdp, guard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be55StubScript() });

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
