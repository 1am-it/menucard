'use strict';

// BE-68 (#168) — browsercheck van /mijn-restaurant/qr, het QR-kaartje.
//
// Eén run, vijf scenario's, met dezelfde harness als BE-57/BE-59: `next start`
// op de eigen productieopbouw (mode 'start', eigen bouwmap via NEXT_DIST_DIR) en
// de sessie-stub van een houder (ops/browser/lib/be48-auth-stub.js) met gestubde
// API's. Geen echt Supabase-project, geen productiegegeven, geen credential,
// geen internet.
//
// Wat de check bewijst (contract #168, acceptatie 2):
//  - de pagina: titel, intro, de keuzes, het voorbeeld met een echte QR-code
//    (een SVG met modules) en zonder horizontale overloop, in licht en donker op
//    1280, 390 en 320 px, met het themabewijs van lib/theme-proof.js;
//  - de keuzes: het doel wisselt de URL achter de QR-code (data-url én een andere
//    matrix) en de tekst verandert in het voorbeeld;
//  - mobiel: het voorbeeld bovenaan, "Tekst of formaat aanpassen" klapt de keuzes
//    uit en de knoppen zijn minstens 44 px;
//  - de afdrukweergave via Emulation.setEmulatedMedia({media:'print'}): alleen
//    het kaartje (A6) of vier kaartjes op A4, met kop, keuzes en knoppen weg;
//  - de melding "Druk het af zodra Onze Menukaarten live is" zolang
//    NEXT_PUBLIC_SITE_INDEXABLE niet 'true' is;
//  - daarna de bestaande a11y-audit, gefilterd op deze route, met 0 fouten.
//
// Lokaal alleen: poort 3180 (uit 3180-3189). Bewijs:
// ops/browser/evidence/be68-browser-evidence.json en evidence/be-68/*.png.
// Dit is ontwikkelaarsbewijs, geen onafhankelijke review of echte acceptatie.

const fs = require('node:fs');
const path = require('node:path');

// De productieopbouw van deze check gaat naar een eigen bouwmap en heeft een
// vaste site-URL en een niet-indexeerbare site, zodat de URL achter de QR-code
// en de "nog niet live"-melding deterministisch zijn. Vóór startServer gezet:
// runtime.js neemt de omgeving over en bouwt en start daarmee.
const PORT = Number(process.env.BE68_FIXTURE_PORT || 3180);
const SITE_URL = 'https://www.onze-menukaarten.nl';
process.env.NEXT_DIST_DIR = process.env.NEXT_DIST_DIR || `.next-browser-${PORT}`;
process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
process.env.NEXT_PUBLIC_SITE_INDEXABLE = '';

const { authStubScript } = require('./lib/be48-auth-stub');
const {
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  killTree,
  findBrowser,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');
const { themeProofScript, clickThemeScript, themeProofValue, themeOk } = require('./lib/theme-proof');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const APP = `http://localhost:${PORT}`;
const LOGIN_URL = `${APP}/mijn-restaurant/inloggen`;
const QR_URL = `${APP}/mijn-restaurant/qr`;
const QR_ROUTE = '/mijn-restaurant/qr';

// De fictieve houder: één eigen restaurant (id 1, net als in BE-57).
const OWNER_EMAIL = 'houder@example.invalid';
const EMAIL_CODE = '654321';
const ROLES = [{ role: 'owner', restaurant_id: '1' }];
const RESTAURANT_NAME = 'Pata Negra';

// De vaste teksten van src/lib/qrKaartje.js, hier alleen om te vergelijken.
const TITLE = 'QR-kaartje voor op tafel';
const INTRO =
  'Gasten scannen het kaartje en zien direct je actuele menukaart, met de goede prijzen. Prijs aangepast? Het kaartje toont direct de nieuwe prijs, opnieuw afdrukken is niet nodig.';
const NOT_LIVE = 'Je kunt het kaartje al bekijken. Druk het af zodra Onze Menukaarten live is.';

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-68');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be68-browser-evidence.json');

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 700 },
];

const checks = [];
const errors = [];
const shots = [];
const injectedScripts = [];
let cdp = null;
let server = null;
let browser = null;
let pageOpen = false;

function add(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) errors.push({ name, detail: detail === undefined ? null : String(detail) });
  return Boolean(passed);
}

function writeEvidence(extra = {}) {
  const record = {
    ticket: 'BE-68 (#168)',
    route: QR_ROUTE,
    category: `lokale browsercheck met gestubde API en sessie (next start op poort ${PORT}, NEXT_DIST_DIR ${process.env.NEXT_DIST_DIR}); geen productie, geen echte acceptatie`,
    siteUrl: SITE_URL,
    siteIndexable: '',
    ranAt: new Date().toISOString(),
    passed: errors.length === 0 && !extra.error,
    checks,
    errors,
    shots,
    ...extra,
  };
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(filteredEvidencePath(BASE_EVIDENCE_PATH, extra.filter), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

/** Het thema zetten met de themaknop van de app zelf, met bewijs. */
async function applyTheme(theme) {
  const label = theme === 'light' ? 'Licht' : 'Donker';
  const clicked = await evalJs(cdp, clickThemeScript(label));
  if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
  await sleep(260);
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

async function fillField(selector, value) {
  const filled = await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`,
  );
  if (!filled) throw new Error(`field_missing: ${selector}`);
  return filled;
}

async function submitForm() {
  return evalJs(cdp, `(() => { const form = document.querySelector('form'); if (!form) return false; form.requestSubmit ? form.requestSubmit() : form.submit(); return true; })()`);
}

/** Inloggen als houder via de echte loginpagina, met de gestubde Supabase. */
async function signIn() {
  await navigate(cdp, LOGIN_URL, `document.querySelector('#owner-email') !== null`);
  const hydrated = await waitFor(
    cdp,
    `(() => {
      const el = document.querySelector('form');
      if (!el) return false;
      return Object.keys(el).some((key) => key.indexOf('__reactProps') === 0);
    })()`,
    30000,
  );
  if (!hydrated) throw new Error('form_not_hydrated');
  await fillField('#owner-email', OWNER_EMAIL);
  await sleep(120);
  await submitForm();
  const codeScreen = await waitFor(cdp, `document.querySelector('#owner-code') !== null`, 25000);
  if (!codeScreen) throw new Error('code_screen_missing');
  await fillField('#owner-code', EMAIL_CODE);
  await sleep(120);
  await submitForm();
  await waitFor(cdp, `document.querySelector('#owner-code') === null`, 25000);
}

async function resetStorage() {
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
  await evalJs(
    cdp,
    `(() => {
      const stale = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && key.indexOf('sb-') === 0) stale.push(key);
      }
      stale.forEach((key) => localStorage.removeItem(key));
      return stale.length;
    })()`,
  );
}

/**
 * De QR-pagina openen als houder: eigen stub, eigen sessie en thema. De pagina
 * stuurt zonder sessie naar de login; daar loggen we in en komen we terug.
 */
async function ensurePage(theme = 'light') {
  if (pageOpen) return;
  await resetStorage();
  for (const identifier of injectedScripts) {
    try {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    } catch (error) {
      /* een verdwenen script is geen fout */
    }
  }
  injectedScripts.length = 0;
  const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: authStubScript({ theme, email: OWNER_EMAIL, emailCode: EMAIL_CODE, roles: ROLES }),
  });
  if (added && added.identifier) injectedScripts.push(added.identifier);

  await navigate(cdp, QR_URL, `document.readyState === 'complete'`);
  if (!(await waitFor(cdp, `document.querySelector('#owner-email') === null`, 15000))) {
    await signIn();
    await navigate(cdp, QR_URL, `document.readyState === 'complete'`);
  }
  const ready = await waitFor(
    cdp,
    `document.querySelector('.qr-kaartje-voorbeeld .qr-kaartje-code-svg path') !== null`,
    30000,
  );
  if (!ready) {
    const text = await evalJs(cdp, 'document.body ? document.body.innerText.slice(0, 500) : ""');
    throw new Error(`qr_preview_missing: ${text}`);
  }
  pageOpen = true;
}



/** Alles wat de check van de pagina leest; niets wordt gezet. */
async function readPage() {
  return evalJs(
    cdp,
    `(() => {
      const text = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.innerText.trim() : null;
      };
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
      };
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const page = document.querySelector('.qr-kaartje-pagina');
      const card = page ? page.querySelector('.qr-kaartje-kaart') : null;
      const svg = card ? card.querySelector('svg.qr-kaartje-code-svg') : null;
      const modulePath = svg ? svg.querySelector('path') : null;
      const d = modulePath ? modulePath.getAttribute('d') || '' : '';
      const buttons = [...document.querySelectorAll('.qr-kaartje-knop')];
      const preview = document.querySelector('.qr-kaartje-voorbeeld');
      const keuzes = document.querySelector('#qr-kaartje-keuzes');
      return {
        path: location.pathname,
        h1: text('h1'),
        intro: text('.owner-intro'),
        back: text('.qr-kaartje-back'),
        notLive: text('.qr-kaartje-nietlive'),
        previewTitle: text('.qr-kaartje-voorbeeld-titel'),
        cardName: text('.qr-kaartje-naam'),
        cardText: text('.qr-kaartje-tekst'),
        cardFooter: text('.qr-kaartje-voet'),
        cardLogo: text('.qr-kaartje-merk'),
        dataUrl: card ? card.getAttribute('data-url') : null,
        svg: svg ? {
          viewBox: svg.getAttribute('viewBox'),
          label: svg.getAttribute('aria-label'),
          modules: d ? d.split('M').length - 1 : 0,
          // Een kleine vingerafdruk van de matrix: een andere URL hoort een
          // andere code te geven, ook als het aantal modules gelijk blijft.
          signature: (() => {
            let hash = 0;
            for (let index = 0; index < d.length; index += 1) {
              hash = (hash * 31 + d.charCodeAt(index)) | 0;
            }
            return hash;
          })(),
          empty: Boolean(card.querySelector('.qr-kaartje-code-leeg')),
        } : null,
        doelLegend: text('.qr-kaartje-veld legend'),
        doelen: [...document.querySelectorAll('.qr-kaartje-doel')].map((el) => ({
          label: (el.querySelector('.qr-kaartje-doel-label') || {}).innerText || '',
          actief: el.getAttribute('data-actief'),
        })),
        tekstLabel: text('label[for="qr-kaartje-tekst"]'),
        tekstValue: (document.querySelector('#qr-kaartje-tekst') || {}).value || null,
        teller: text('#qr-kaartje-tekst-teller'),
        formaten: [...document.querySelectorAll('.qr-kaartje-formaat')].map((el) => ({
          label: el.innerText.trim(),
          actief: el.getAttribute('data-actief'),
        })),
        buttons: buttons.map((el) => ({ label: el.innerText.trim(), height: Math.round(el.getBoundingClientRect().height) })),
        printHint: text('.qr-kaartje-hint'),
        adjust: (() => {
          const el = document.querySelector('.qr-kaartje-aanpassen');
          if (!el) return null;
          return {
            label: el.innerText.trim(),
            expanded: el.getAttribute('aria-expanded'),
            height: Math.round(el.getBoundingClientRect().height),
          };
        })(),
        keuzes: keuzes ? { hidden: keuzes.hasAttribute('hidden'), visible: visible(keuzes), rect: rect(keuzes) } : null,
        previewTop: preview ? Math.round(preview.getBoundingClientRect().top + window.scrollY) : null,
        keuzesTop: keuzes ? Math.round(keuzes.getBoundingClientRect().top + window.scrollY) : null,
        tekstFout: (() => {
          const el = document.querySelector('.qr-kaartje-veld .qr-kaartje-error');
          return el ? el.innerText.trim() : null;
        })(),
        tekstInvalid: (() => {
          const el = document.querySelector('#qr-kaartje-tekst');
          return el ? el.getAttribute('aria-invalid') : null;
        })(),
        previewRect: rect(preview),
        cardRect: rect(card),
        scrollY: Math.round(window.scrollY),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        theme: document.documentElement.getAttribute('data-theme'),
        openPanel: Boolean(document.querySelector('[data-open="true"], dialog[open]')),
      };
    })()`,
  );
}

    errors,
    shots,

/** De afdrukstand van de pagina: wat is zichtbaar op papier, en hoe groot? */
async function readPrint() {
  return evalJs(
    cdp,
    `(() => {
      const state = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { display: style.display, width: Math.round(r.width), height: Math.round(r.height) };
      };
      const sheet = document.querySelector('.qr-kaartje-afdruk');
      const cards = [...document.querySelectorAll('.qr-kaartje-kaart--afdruk')];
      const svgs = cards.map((card) => {
        const svg = card.querySelector('svg.qr-kaartje-code-svg');
        const modulePath = svg ? svg.querySelector('path') : null;
        const d = modulePath ? modulePath.getAttribute('d') || '' : '';
        return { hasSvg: Boolean(svg), modules: d ? d.split('M').length - 1 : 0 };
      });
      return {
        header: state('.site-header'),
        main: state('main.owner-main'),
        preview: state('.qr-kaartje-voorbeeld'),
        keuzes: state('#qr-kaartje-keuzes'),
        actions: state('.qr-kaartje-acties'),
        adjust: state('.qr-kaartje-aanpassen'),
        sheet: state('.qr-kaartje-afdruk'),
        formaat: sheet ? sheet.getAttribute('data-formaat') : null,
        columns: sheet ? getComputedStyle(sheet).gridTemplateColumns : null,
        count: cards.length,
        cards: cards.map((card) => {
          const r = card.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
        }),
        svgs,
      };
    })()`,
  );
}

/** Een keuze in de pagina zelf aanklikken (radio, knop of label). */
async function clickSelector(selector) {
  const clicked = await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`click_target_missing: ${selector}`);
  await sleep(260);
}

/** De tekst in het tekstveld zetten zoals een gebruiker typt. */
async function typeText(value) {
  await fillField('#qr-kaartje-tekst', value);
  await sleep(260);
}

/** Een opname met het themabewijs ernaast; het paneel is dicht voor de opname. */
async function shot(name, meta) {
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({ name, ...meta, ...file });
  return file;
}

const a11yResults = [];

/** Scenario 1 — de pagina zelf, in licht en donker op 1280, 390 en 320 px. */
async function runPagina() {
  await ensurePage('light');
  for (const width of WIDTHS) {
    await setViewport(width.width, width.height);
    for (const theme of ['light', 'dark']) {
      const proof = await applyTheme(theme);
      await sleep(200);
      const measured = await readPage();
      const label = `pagina ${width.name}/${theme}`;
      add(`${label}: de route is ${QR_ROUTE}`, measured.path === QR_ROUTE, measured.path);
      add(`${label}: de h1 is "${TITLE}"`, measured.h1 === TITLE, measured.h1);
      add(
        `${label}: de intro noemt de actuele prijs en het niet-opnieuw-afdrukken`,
        measured.intro === INTRO,
        measured.intro,
      );
      add(`${label}: de melding "nog niet live" staat er`, measured.notLive === NOT_LIVE, measured.notLive);
      add(
        `${label}: de keuzes staan er: doel, tekst en formaat`,
        measured.doelen.length === 2 &&
          measured.tekstLabel === 'Tekst op het kaartje' &&
          measured.formaten.length === 3,
        JSON.stringify({ doelen: measured.doelen, tekstLabel: measured.tekstLabel, formaten: measured.formaten }),
      );
      add(
        `${label}: het voorbeeld toont naam, tekst, voet en logo`,
        measured.cardName === RESTAURANT_NAME &&
          measured.cardText === 'Bekijk onze menukaart' &&
          measured.cardFooter === 'Scan met je camera · altijd met prijzen' &&
          String(measured.cardLogo || '').includes('onze menukaarten'),
        JSON.stringify({
          naam: measured.cardName,
          tekst: measured.cardText,
          voet: measured.cardFooter,
          logo: measured.cardLogo,
        }),
      );
      add(
        `${label}: de QR-code is een echte SVG met modules`,
        Boolean(measured.svg) &&
          measured.svg.modules > 40 &&
          /^0 0 [0-9]+ [0-9]+$/.test(String(measured.svg.viewBox)) &&
          measured.svg.empty === false,
        JSON.stringify(measured.svg),
      );
      add(
        `${label}: de URL achter de QR is de menukaart met ?bron=qr`,
        measured.dataUrl === `${SITE_URL}/menu/1?bron=qr`,
        measured.dataUrl,
      );
      add(`${label}: geen horizontale overloop`, measured.overflowX <= 0, String(measured.overflowX));
      add(`${label}: het thema is echt ${theme}`, themeOk(proof, theme), JSON.stringify(proof));
      add(`${label}: geen paneel open bij de opname`, measured.openPanel === false, String(measured.openPanel));

      // Het voorbeeld volledig in beeld: eerst naar het kaartje scrollen, dan
      // pas meten en opnemen. Een kaartje dat half buiten het scherm valt is
      // geen geslaagde weergave.
      const framing = await evalJs(
        cdp,
        `(() => {
          const card = document.querySelector('.qr-kaartje-voorbeeld .qr-kaartje-kaart');
          if (!card) return null;
          card.scrollIntoView({ block: 'center' });
          const r = card.getBoundingClientRect();
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            left: Math.round(r.left),
            right: Math.round(r.right),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        })()`,
      );
      add(
        `${label}: het kaartje staat volledig in beeld`,
        Boolean(framing) &&
          framing.top >= 0 &&
          framing.left >= 0 &&
          framing.bottom <= framing.viewportHeight &&
          framing.right <= framing.viewportWidth,
        JSON.stringify(framing),
      );
      await shot(`be68-pagina-${width.name}-${theme === 'light' ? 'licht' : 'donker'}.png`, {
        viewport: `${width.width}x${width.height}`,
        theme,
        themeProof: proof,
        framing,
      });
    }
  }
  await applyTheme('light');
}

/** Scenario 2 — de keuzes wisselen de URL, de QR-code en de tekst. */
async function runKeuzes() {
  await ensurePage('light');
  await setViewport(1280, 900);
  await applyTheme('light');
  const voor = await readPage();
  add('keuzes: de menukaart is het standaarddoel', (voor.doelen[0] || {}).actief === 'ja', JSON.stringify(voor.doelen));
  add('keuzes: de teller begint op 21/40', voor.teller === '21/40', voor.teller);

  await clickSelector('.qr-kaartje-doel input[value="restaurant"]');
  const naDoel = await readPage();
  add(
    'keuzes: het doel "De restaurantpagina" is actief',
    (naDoel.doelen.find((doel) => doel.actief === 'ja') || {}).label === 'De restaurantpagina',
    JSON.stringify(naDoel.doelen),
  );
  add(
    'keuzes: de URL in de QR wisselt mee naar de restaurantpagina',
    naDoel.dataUrl === `${SITE_URL}/restaurant/1?bron=qr`,
    naDoel.dataUrl,
  );
  add(
    'keuzes: de QR-matrix zelf verandert mee',
    Boolean(voor.svg && naDoel.svg) && voor.svg.signature !== naDoel.svg.signature,
    JSON.stringify({ voor: voor.svg && voor.svg.signature, na: naDoel.svg && naDoel.svg.signature }),
  );

  await typeText('Vandaag verse vis');
  const naTekst = await readPage();
  add('keuzes: de tekst verandert in het voorbeeld', naTekst.cardText === 'Vandaag verse vis', naTekst.cardText);
  add('keuzes: de teller telt mee', naTekst.teller === '17/40', naTekst.teller);

  await typeText('x'.repeat(41));
  const teLang = await readPage();
  add(
    'keuzes: 41 tekens geeft de melding over 40 tekens',
    teLang.tekstFout !== null && String(teLang.tekstFout).includes('maximaal 40 tekens'),
    teLang.tekstFout,
  );

  const formaatVoor = await evalJs(cdp, `document.querySelector('.qr-kaartje-afdruk').getAttribute('data-formaat')`);
  await clickSelector('.qr-kaartje-formaat input[value="a4"]');
  const formaatNa = await evalJs(
    cdp,
    `(() => {
      const sheet = document.querySelector('.qr-kaartje-afdruk');
      return { formaat: sheet.getAttribute('data-formaat'), kaartjes: sheet.querySelectorAll('.qr-kaartje-kaart--afdruk').length };
    })()`,
  );
  add(
    'keuzes: het formaat "4 op een A4" zet vier kaartjes klaar',
    formaatVoor === 'a6' && formaatNa.formaat === 'a4' && formaatNa.kaartjes === 4,
    JSON.stringify({ formaatVoor, formaatNa }),
  );

  // Terug naar de standaard, zodat de volgende scenario's dezelfde beginstand zien.
  await clickSelector('.qr-kaartje-formaat input[value="a6"]');
  await clickSelector('.qr-kaartje-doel input[value="menu"]');
  await typeText('Bekijk onze menukaart');
}

/** Scenario 3 — mobiel: voorbeeld bovenaan, keuzes achter één knop, 44 px. */
async function runMobiel() {
  await ensurePage('light');
  for (const width of [WIDTHS[1], WIDTHS[2]]) {
    await setViewport(width.width, width.height);
    await applyTheme('light');
    await sleep(320);
    const gemeten = await readPage();
    const label = `mobiel ${width.name}`;
    add(
      `${label}: het voorbeeld staat bovenaan, boven de keuzes`,
      gemeten.previewTop !== null && gemeten.keuzesTop !== null && gemeten.previewTop < gemeten.keuzesTop,
      JSON.stringify({ previewTop: gemeten.previewTop, keuzesTop: gemeten.keuzesTop }),
    );
    add(
      `${label}: de keuzes zijn dichtgeklapt`,
      Boolean(gemeten.keuzes) && gemeten.keuzes.hidden === true && gemeten.keuzes.visible === false,
      JSON.stringify(gemeten.keuzes),
    );
    add(
      `${label}: "Tekst of formaat aanpassen" staat er en is minstens 44 px`,
      Boolean(gemeten.adjust) &&
        gemeten.adjust.label === 'Tekst of formaat aanpassen' &&
        gemeten.adjust.expanded === 'false' &&
        gemeten.adjust.height >= 44,
      JSON.stringify(gemeten.adjust),
    );
    add(
      `${label}: de knoppen zijn minstens 44 px hoog`,
      gemeten.buttons.length >= 3 && gemeten.buttons.every((knop) => knop.height >= 44),
      JSON.stringify(gemeten.buttons),
    );
    add(
      `${label}: "Deel de QR-afbeelding" staat er op mobiel`,
      gemeten.buttons.some((knop) => knop.label === 'Deel de QR-afbeelding'),
      JSON.stringify(gemeten.buttons.map((knop) => knop.label)),
    );
    add(`${label}: geen horizontale overloop`, gemeten.overflowX <= 0, String(gemeten.overflowX));

    await shot(`be68-mobiel-${width.name}-dicht.png`, { viewport: `${width.width}x${width.height}`, stand: 'keuzes dicht' });

    await clickSelector('.qr-kaartje-aanpassen');
    const open = await readPage();
    add(
      `${label}: "Tekst of formaat aanpassen" klapt de keuzes uit`,
      Boolean(open.keuzes) &&
        open.keuzes.hidden === false &&
        open.keuzes.visible === true &&
        Boolean(open.adjust) &&
        open.adjust.expanded === 'true',
      JSON.stringify({ keuzes: open.keuzes, adjust: open.adjust }),
    );
    await shot(`be68-mobiel-${width.name}-open.png`, { viewport: `${width.width}x${width.height}`, stand: 'keuzes open' });

    await clickSelector('.qr-kaartje-aanpassen');
    await sleep(200);
  }
  await setViewport(1280, 900);
}

// A6 is 105 × 148 mm; bij 96 dpi is dat 397 × 559 px. De ruimte eromheen is
// bewust een bandbreedte: het gaat om de maat, niet om een halve pixel.
const A6_BREEDTE = Math.round((105 / 25.4) * 96);
const A6_HOOGTE = Math.round((148 / 25.4) * 96);
const MAAT_MARGE = 2;

/** Scenario 4 — de afdrukweergave: alleen het kaartje, op A6 en 4 op A4. */
async function runAfdruk() {
  await ensurePage('light');
  await setViewport(1280, 900);
  await applyTheme('light');

  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(400);
  const a6 = await readPrint();
  add(
    'afdruk a6: kop, keuzes, voorbeeld en knoppen zijn verborgen',
    Boolean(a6.header) &&
      a6.header.display === 'none' &&
      Boolean(a6.main) &&
      a6.main.display === 'none' &&
      Boolean(a6.preview) &&
      a6.preview.display === 'none' &&
      Boolean(a6.actions) &&
      a6.actions.display === 'none',
    JSON.stringify({ header: a6.header, main: a6.main, preview: a6.preview, actions: a6.actions }),
  );
  add(
    'afdruk a6: alleen het afdrukvel met precies één kaartje blijft over',
    Boolean(a6.sheet) && a6.sheet.display !== 'none' && a6.formaat === 'a6' && a6.count === 1,
    JSON.stringify({ sheet: a6.sheet, formaat: a6.formaat, count: a6.count }),
  );
  add(
    `afdruk a6: het kaartje is ${A6_BREEDTE} × ${A6_HOOGTE} px (105 × 148 mm)`,
    Boolean(a6.cards[0]) &&
      Math.abs(a6.cards[0].width - A6_BREEDTE) <= MAAT_MARGE &&
      Math.abs(a6.cards[0].height - A6_HOOGTE) <= MAAT_MARGE,
    JSON.stringify(a6.cards[0]),
  );
  add(
    'afdruk a6: de QR-code staat ook op het afdrukvel met modules',
    a6.svgs.length === 1 && a6.svgs[0].hasSvg && a6.svgs[0].modules > 40,
    JSON.stringify(a6.svgs),
  );
  await shot('be68-afdruk-a6-1280-licht.png', { media: 'print', formaat: 'a6', measured: a6 });

  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
  await sleep(200);
  await clickSelector('.qr-kaartje-formaat input[value="a4"]');
  await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(400);
  const a4 = await readPrint();
  add(
    'afdruk a4: vier kaartjes in twee kolommen op één vel',
    a4.formaat === 'a4' &&
      a4.count === 4 &&
      String(a4.columns || '').trim().split(/\s+/).length === 2,
    JSON.stringify({ formaat: a4.formaat, count: a4.count, columns: a4.columns }),
  );
  add(
    `afdruk a4: elk kaartje is ${A6_BREEDTE} × ${A6_HOOGTE} px`,
    a4.cards.length === 4 &&
      a4.cards.every(
        (kaart) =>
          Math.abs(kaart.width - A6_BREEDTE) <= MAAT_MARGE && Math.abs(kaart.height - A6_HOOGTE) <= MAAT_MARGE,
      ),
    JSON.stringify(a4.cards),
  );
  add(
    'afdruk a4: de kop blijft ook hier verborgen',
    Boolean(a4.header) && a4.header.display === 'none' && Boolean(a4.main) && a4.main.display === 'none',
    JSON.stringify({ header: a4.header, main: a4.main }),
  );
  await shot('be68-afdruk-a4-1280-licht.png', { media: 'print', formaat: 'a4', measured: a4 });

  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
  await sleep(200);
  await clickSelector('.qr-kaartje-formaat input[value="a6"]');
}

/** Scenario 5 — de bestaande a11y-audit, gefilterd op deze route. */
async function runA11y() {
  await ensurePage('light');
  await setViewport(1280, 900);
  for (const theme of ['light', 'dark']) {
    const proof = await applyTheme(theme);
    add(`a11y: het thema ${theme} staat echt voor de audit`, themeOk(proof, theme), JSON.stringify(proof));
    const measuredA11y = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
    const review = audit.checksFromAudit(QR_ROUTE, theme === 'light' ? 'licht' : 'donker', measuredA11y, {
      minTarget: 44,
    });
    for (const check of review.checks) add(check.name, check.passed, check.detail);
    for (const failure of review.errors) {
      add(
        `${QR_ROUTE} (${theme}) · a11y-fout · ${failure.criterion}`,
        false,
        `${failure.reason} · ${failure.name} · ${failure.detail || ''}`,
      );
    }
    add(`${QR_ROUTE} (${theme}) · a11y-audit zonder fouten`, review.errors.length === 0, `${review.errors.length} fouten`);
    a11yResults.push({ route: QR_ROUTE, theme, errors: review.errors.length });
  }
  await applyTheme('light');
}

const SCENARIOS = [
  { name: 'pagina', run: runPagina },
  { name: 'keuzes', run: runKeuzes },
  { name: 'mobiel', run: runMobiel },
  { name: 'afdruk', run: runAfdruk },
  { name: 'a11y', run: runA11y },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  console.log(`starting the local app on ${APP} (NEXT_DIST_DIR ${process.env.NEXT_DIST_DIR})`);
  server = await startServer({
    port: PORT,
    appUrl: APP,
    outputDir: path.join(__dirname, 'output', 'be-68'),
    readyPath: '/mijn-restaurant/inloggen',
    mode: 'start',
  });
  browser = await startBrowser(browserPath);
  cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const runs = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

  // Het thema van de laatste opname terug naar licht en de printemulatie uit,
  // zodat een volgende run niet in de afdrukstand begint.
  try {
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
  } catch (error) {
    /* de browser kan al dicht zijn */
  }

  const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
  add('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

  return writeEvidence({ filter: SELECTION.filter, scenarios: runs, a11y: a11yResults });
}

const timeout = setTimeout(() => {
  writeEvidence({ error: 'run_timeout (15 min)', filter: SELECTION.filter });
  try {
    if (browser) killTree(browser.child);
    if (server) killTree(server);
  } catch {
    /* niets */
  }
  process.exit(1);
}, 15 * 60 * 1000);

(async () => {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: 'run-be68-browser-check.js' });
  if (outcome.stop) {
    clearTimeout(timeout);
    process.exitCode = outcome.exitCode;
    return;
  }
  try {
    const record = await run();
    clearTimeout(timeout);
    console.log(
      JSON.stringify({
        evidence: path.relative(process.cwd(), filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter)).replace(/\\/g, '/'),
        passed: record.passed,
        checks: checks.length,
        errors: errors.length,
        shots: shots.length,
      }),
    );
    for (const error of errors.slice(0, 12)) console.log(`FOUT: ${error.name} — ${error.detail}`);
  } catch (error) {
    clearTimeout(timeout);
    writeEvidence({ error: String((error && error.stack) || error), filter: SELECTION.filter });
    console.error(String((error && error.stack) || error));
    process.exitCode = 1;
  } finally {
    try {
      if (cdp) cdp.close();
      if (browser) killTree(browser.child);
      if (server) killTree(server);
    } catch {
      /* afsluiten mag nooit de uitslag verbergen */
    }
  }
  if (errors.length > 0) process.exitCode = 1;
})();

