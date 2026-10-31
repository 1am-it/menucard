'use strict';

// BE-59 deel 3 (#146) — browsercheck voor het accountmenu, /inloggen en de
// footerlink.
//
// Drie scenario's, elk in een echte lokale browser (Edge/Chrome via CDP, geen
// dependency), met een gestubde sessie en API (lib/be59-stub-page.js):
//
//   gast       geen sessiesleutel: geen accountknop, wel de footerlink
//              "Voor restaurants · Inloggen"; /inloggen met beide keuzes en de
//              claimlink naar de juiste bestemmingen;
//   beheerder  internal + editor met zeven openstaande taken: knop met stip,
//              menu met "Beheer · 7 open" en de rol in gewone woorden,
//              toetsenbord (openen, pijltoetsen, Escape, focus terug), op 390 en
//              320 px het paneel van onderen met de sluitknop, en op een interne
//              pagina "Bekijk de site" in het menu;
//   houder     owner zonder openstaand werk: geen stip, wel Mijn restaurant, en
//              op /mijn-restaurant de kop "Mijn restaurant · [naam]".
//
// Per scenario: licht en donker op 1280, 390 en 320 px, elk onderdeel volledig
// op de opname, geen horizontale overloop, plus de bestaande a11y-audit
// (lib/a11y-audit.js, dezelfde als run-a11y-public-check.js) met 0 fouten.
//
// Het thema komt uit de opgeslagen voorkeur die de app zelf bij het laden leest
// (localStorage `bredaeats_theme`, dezelfde sleutel als ThemeToggle en het
// themascript in app/layout.js). Zo werkt licht en donker ook op een pagina waar
// de themaknop op een smal scherm buiten de kop valt.
//
// Lokaal alleen: next dev op poort 3192 (uit 3190-3199), geen productie, geen
// echte sessie en geen externe hosts. Bewijs:
// ops/browser/evidence/be59-browser-evidence.json en evidence/be-59/*.png.

const fs = require('node:fs');
const path = require('node:path');

const {
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  screenshot,
  pressKey,
  killTree,
  findBrowser,
} = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');
const {
  be59StubScript,
  BEHEERDER_NAME,
  BEHEERDER_EMAIL,
  BEHEERDER_ROLES,
  HOLDER_NAME,
  HOLDER_EMAIL,
  HOLDER_ROLES,
  HOLDER_RESTAURANT_NAME,
  OPEN_WORK_COUNTS,
} = require('./lib/be59-stub-page');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const PORT = Number(process.env.BE59_PORT || 3192);
const APP = `http://localhost:${PORT}`;
const HOME_ROUTE = '/';
const LOGIN_ROUTE = '/inloggen';
const OWNER_ROUTE = '/mijn-restaurant';
const INTERNAL_ROUTE = '/internal/tellers';
const ROUTES = [HOME_ROUTE, LOGIN_ROUTE, OWNER_ROUTE, INTERNAL_ROUTE];

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-59');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be59-browser-evidence.json');

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];
const THEMES = ['light', 'dark'];
const OPEN_WORK_TOTAL = Object.values(OPEN_WORK_COUNTS).reduce((sum, value) => sum + value, 0);

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
    ticket: 'BE-59 (#146)',
    routes: ROUTES,
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

async function installStub(options) {
  if (stubScriptId) {
    await cdp
      .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubScriptId })
      .catch(() => {});
    stubScriptId = null;
  }
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be59StubScript(options) });
  stubScriptId = result.identifier || null;
}

// Eén herkansing, net als in run-be58: de eerste navigatie in `next dev` moet
// nog compileren. Pas als het scherm er echt staat, wordt er gemeten.
async function gotoPage(url, readyExpression) {
  for (let poging = 1; poging <= 2; poging += 1) {
    await cdp.send('Page.navigate', { url });
    const klaar = await waitFor(
      cdp,
      `document.readyState !== 'loading' && (${readyExpression})`,
      poging === 1 ? 25000 : 45000,
    );
    if (klaar) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return true;
    }
  }
  const staart = await evalJs(
    cdp,
    `JSON.stringify({
      pad: location.pathname,
      sessie: (() => { try { return Boolean(localStorage.getItem('sb-127-auth-token')); } catch (error) { return null; } })(),
      tekst: document.body ? document.body.innerText.slice(-500) : '',
    })`,
  );
  throw new Error(`page_not_ready: ${url}\n${staart}`);
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
      const fixed = getComputedStyle(el).position === 'fixed';
      return {
        left: rect.left, right: rect.right, width: rect.width, height: rect.height,
        // Een vast paneel (het menu van onderen) hangt aan het venster, niet aan
        // de pagina: daar telt de scrollpositie niet mee.
        pageX: fixed ? rect.left : rect.left + window.scrollX,
        pageY: fixed ? rect.top : rect.top + window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        fixed: fixed,
      };
    })()`,
  );
  if (!info) {
    add(`opname ${name}: onderdeel gevonden`, false, `geen element voor ${selector}`);
    return null;
  }
  await new Promise((resolve) => setTimeout(resolve, 140));
  const fitsHorizontally = info.left >= -1 && info.right <= info.innerWidth + 1;
  // Alleen een vast paneel moet binnen het venster passen; een onderdeel in de
  // pagina ligt in paginacoördinaten en mag onder de vouw staan (de uitsnede
  // loopt daar vanzelf mee).
  const fitsVertically = !info.fixed || (info.pageY >= -1 && info.pageY + info.height <= info.innerHeight + 1);
  const clip = {
    x: Math.max(0, Math.round(info.pageX)),
    y: Math.max(0, Math.round(info.pageY)),
    width: Math.max(1, Math.round(Math.min(info.width, info.innerWidth))),
    height: Math.max(1, Math.round(info.height)),
  };
  const shot = await screenshot(cdp, SHOT_DIR, `${name}.png`, { clip });
  shots.push({ ...shot, selector, clip, fitsHorizontally });
  add(
    `opname ${name}: hele onderdeel in beeld`,
    fitsHorizontally && fitsVertically,
    JSON.stringify({ clip, fitsHorizontally, fitsVertically }),
  );
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

// De bestaande a11y-audit, dezelfde als run-a11y-public-check.js gebruikt.
async function a11y(label, theme) {
  const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
  const review = audit.checksFromAudit(label, theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
  for (const check of review.checks) add(check.name, check.passed, check.detail);
  for (const failure of review.errors) {
    add(`${label} (${theme}) · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
  }
  return review;
}

// ── Het accountmenu zelf ────────────────────────────────────────────────────

const TRIGGER_READY = `document.querySelector('.account-menu-trigger') !== null`;

async function waitForTrigger(label) {
  const gekomen = await waitFor(cdp, TRIGGER_READY, 25000);
  add(`${label}: de accountknop verschijnt`, gekomen);
  return gekomen;
}

async function openMenu(label) {
  const geklikt = await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('.account-menu-trigger');
      if (!knop) return false;
      knop.click();
      return true;
    })()`,
  );
  const open = Boolean(geklikt) && (await waitFor(cdp, `document.querySelector('#account-menu-panel') !== null`, 10000));
  add(`${label}: het menu opent met een klik op de avatar`, open);
  return open;
}

async function closeMenuWithEscape(label) {
  await pressKey(cdp, 'Escape', 'Escape', 27);
  const dicht = await waitFor(cdp, `document.querySelector('#account-menu-panel') === null`, 8000);
  const focus = await evalJs(
    cdp,
    `Boolean(document.activeElement && document.activeElement.classList.contains('account-menu-trigger'))`,
  );
  add(`${label}: Escape sluit het menu`, dicht);
  add(`${label}: de focus keert terug naar de accountknop`, focus);
  return dicht && focus;
}

async function menuSnapshot() {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('#account-menu-panel');
      const knop = document.querySelector('.account-menu-trigger');
      if (!panel || !knop) return null;
      const knopRect = knop.getBoundingClientRect();
      return {
        ariaLabel: knop.getAttribute('aria-label'),
        initials: (knop.querySelector('.account-menu-avatar') || {}).innerText || '',
        dot: Boolean(knop.querySelector('.account-menu-dot')),
        triggerWidth: Math.round(knopRect.width),
        triggerHeight: Math.round(knopRect.height),
        role: (panel.querySelector('.account-menu-roles') || {}).innerText || '',
        name: (panel.querySelector('.account-menu-name') || {}).innerText || '',
        items: Array.from(panel.querySelectorAll('.account-menu-items li')).map((li) => {
          const link = li.querySelector('a');
          return {
            text: (li.innerText || '').replace(/\\s+/g, ' ').trim(),
            label: (li.querySelector('.account-menu-item-label') || {}).innerText || '',
            count: (li.querySelector('.account-menu-item-count') || {}).innerText || '',
            href: link ? link.getAttribute('href') : null,
          };
        }),
        sheet: panel.classList.contains('account-menu-panel--sheet'),
        closeLabel: (panel.querySelector('.account-menu-close') || {}).innerText || '',
      };
    })()`,
  );
}

async function focusTriggerThenOpen(label) {
  const focused = await evalJs(
    cdp,
    `(() => {
      const knop = document.querySelector('.account-menu-trigger');
      if (!knop) return false;
      knop.focus();
      return document.activeElement === knop;
    })()`,
  );
  add(`${label}: de accountknop kan de focus krijgen`, focused);
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const open = await waitFor(cdp, `document.querySelector('#account-menu-panel') !== null`, 8000);
  add(`${label}: Enter op de knop opent het menu`, open);
  return open;
}

async function arrowKeyCheck(label) {
  const activeText = `(document.activeElement && (document.activeElement.innerText || '').trim()) || ''`;
  const eerste = await evalJs(cdp, activeText);
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);
  const tweede = await evalJs(cdp, activeText);
  await pressKey(cdp, 'ArrowUp', 'ArrowUp', 38);
  const terug = await evalJs(cdp, activeText);
  const binnen = await evalJs(
    cdp,
    `Boolean(document.querySelector('#account-menu-panel') && document.querySelector('#account-menu-panel').contains(document.activeElement))`,
  );
  const verschoven = Boolean(eerste) && Boolean(tweede) && eerste !== tweede && terug === eerste;
  add(
    `${label}: de pijltoetsen verplaatsen de focus en blijven in het menu`,
    binnen && verschoven,
    JSON.stringify({ eerste, tweede, terug, binnen }),
  );
  return binnen && verschoven;
}

function itemOf(snapshot, label) {
  if (!snapshot || !Array.isArray(snapshot.items)) return null;
  return snapshot.items.filter((item) => item.label === label)[0] || null;
}

// ── Scenario 1 — de gast ────────────────────────────────────────────────────

const FOOTER_READY = `document.querySelector('.public-footer-link') !== null`;
const LOGIN_READY = `document.querySelector('.inloggen-choice') !== null`;

async function openAsGuest(url, theme, readyExpression) {
  await installStub({ session: false, theme });
  await gotoPage(url, readyExpression);
  // Een verkeerd geladen menu zou binnen deze tijd in beeld zijn; de controle
  // "geen knop" is daarmee een echte meting en geen momentopname.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function runGast() {
  await setViewport(1280, 900);
  await openAsGuest(`${APP}${HOME_ROUTE}`, 'light', FOOTER_READY);

  const thuis = await evalJs(
    cdp,
    `(() => {
      const link = document.querySelector('.public-footer-link');
      return {
        pad: location.pathname,
        thema: document.documentElement.getAttribute('data-theme'),
        trigger: Boolean(document.querySelector('.account-menu-trigger')),
        menu: Boolean(document.querySelector('#account-menu-panel')),
        linkText: link ? (link.innerText || '').trim() : null,
        linkHref: link ? link.getAttribute('href') : null,
        sessie: window.__BE59__ ? window.__BE59__.sessionValue() : 'geen-stub',
        calls: window.__BE59__ ? window.__BE59__.calls : [],
        avatarChunk: performance.getEntriesByType('resource').map((entry) => entry.name).filter((naam) => /accountmenu|account-menu/i.test(naam)),
      };
    })()`,
  );
  add('gast home: geen accountknop', thuis.trigger === false, JSON.stringify({ trigger: thuis.trigger }));
  add('gast home: geen accountmenu in de pagina', thuis.menu === false, JSON.stringify({ menu: thuis.menu }));
  add('gast home: de footerlink heet "Voor restaurants · Inloggen"', thuis.linkText === 'Voor restaurants · Inloggen', thuis.linkText);
  add('gast home: de footerlink gaat naar /inloggen', thuis.linkHref === '/inloggen', thuis.linkHref);
  add('gast home: geen sessiesleutel in de opslag', thuis.sessie === null, String(thuis.sessie));
  // De homepagina vraagt haar eigen, bestaande gegevens op (daghap, zoeken); dat
  // is geen accountmenu-verkeer. Alleen de sessie- en rolopvraag en elk
  // auth-verkeer tellen hier.
  const accountCalls = thuis.calls.filter(
    (call) => call.kind === 'auth' || /\/api\/internal\/v1\/(me|workqueue-counts)$/.test(call.path || ''),
  );
  add(
    'gast home: geen sessie- of rolopvraag en geen auth-verkeer',
    accountCalls.length === 0,
    JSON.stringify({ accountCalls, alleAanroepen: thuis.calls.length }),
  );
  add('gast home: geen accountmenu-bestand geladen', thuis.avatarChunk.length === 0, JSON.stringify(thuis.avatarChunk));
  add('gast home: het lichte thema staat aan', thuis.thema === 'light', String(thuis.thema));
  await noHorizontalOverflow('gast home (light/1280)');
  await a11y('gast home', 'light');
  await capture('.public-footer', 'be59-gast-home-1280-light-footer');

  // Licht en donker op 1280, 390 en 320 px: de footerlink volledig in beeld.
  for (const theme of THEMES) {
    await openAsGuest(`${APP}${HOME_ROUTE}`, theme, FOOTER_READY);
    const thema = await evalJs(cdp, `document.documentElement.getAttribute('data-theme')`);
    add(`gast home (${theme}): het thema staat aan`, thema === theme, String(thema));
    if (theme === 'dark') await a11y('gast home', 'dark');
    for (const size of WIDTHS) {
      await setViewport(size.width, size.height);
      await capture('.public-footer', `be59-gast-home-${size.name}-${theme}-footer`);
      await noHorizontalOverflow(`gast home (${theme}/${size.name})`);
    }
  }
}

// ── Scenario 2 — /inloggen, de ene ingang ───────────────────────────────────

async function runInloggen() {
  await setViewport(1280, 900);
  await openAsGuest(`${APP}${LOGIN_ROUTE}`, 'light', LOGIN_READY);

  const inloggen = await evalJs(
    cdp,
    `(() => ({
      pad: location.pathname,
      trigger: Boolean(document.querySelector('.account-menu-trigger')),
      titel: (document.querySelector('.inloggen-title') || {}).innerText || '',
      intro: (document.querySelector('.inloggen-intro') || {}).innerText || '',
      choices: Array.from(document.querySelectorAll('.inloggen-choice')).map((a) => ({
        label: (a.querySelector('.inloggen-choice-label') || {}).innerText || '',
        href: a.getAttribute('href'),
      })),
      claim: (() => {
        const a = document.querySelector('.inloggen-claim-link');
        return a ? { text: (a.innerText || '').trim(), href: a.getAttribute('href') } : null;
      })(),
    }))()`,
  );
  const keuze = (label) => inloggen.choices.filter((choice) => choice.label === label)[0] || null;
  add('inloggen: de pagina zelf is /inloggen', inloggen.pad === LOGIN_ROUTE, inloggen.pad);
  add('inloggen: de titel is "Inloggen"', inloggen.titel === 'Inloggen', inloggen.titel);
  add('inloggen: een korte uitleg staat er', inloggen.intro.length > 40, inloggen.intro);
  add('inloggen: precies twee keuzes', inloggen.choices.length === 2, JSON.stringify(inloggen.choices));
  add(
    'inloggen: "Ik heb een restaurant" gaat naar /mijn-restaurant/inloggen',
    Boolean(keuze('Ik heb een restaurant')) && keuze('Ik heb een restaurant').href === '/mijn-restaurant/inloggen',
    JSON.stringify(keuze('Ik heb een restaurant')),
  );
  add(
    'inloggen: "Ik werk bij onze menukaarten" gaat naar /internal/login',
    Boolean(keuze('Ik werk bij onze menukaarten')) && keuze('Ik werk bij onze menukaarten').href === '/internal/login',
    JSON.stringify(keuze('Ik werk bij onze menukaarten')),
  );
  add(
    'inloggen: de claimlink gaat naar /mijn-restaurant/claimen',
    Boolean(inloggen.claim) &&
      inloggen.claim.text === 'Nog geen account? Claim je restaurant' &&
      inloggen.claim.href === '/mijn-restaurant/claimen',
    JSON.stringify(inloggen.claim),
  );
  add('inloggen: een gast ziet hier ook geen accountknop', inloggen.trigger === false, String(inloggen.trigger));
  await noHorizontalOverflow('inloggen (light/1280)');
  await a11y('inloggen', 'light');
  await capture('.inloggen-choices', 'be59-inloggen-1280-light-keuzes');
  await capture('.inloggen-claim', 'be59-inloggen-1280-light-claim');

  for (const theme of THEMES) {
    await openAsGuest(`${APP}${LOGIN_ROUTE}`, theme, LOGIN_READY);
    if (theme === 'dark') await a11y('inloggen', 'dark');
    for (const size of WIDTHS) {
      await setViewport(size.width, size.height);
      await capture('.inloggen-choices', `be59-inloggen-${size.name}-${theme}-keuzes`);
      await capture('.inloggen-claim', `be59-inloggen-${size.name}-${theme}-claim`);
      await noHorizontalOverflow(`inloggen (${theme}/${size.name})`);
    }
  }
}

// ── Scenario 3 — de beheerder met openstaand werk ───────────────────────────

const DOT_READY = `document.querySelector('.account-menu-dot') !== null`;

async function openAsBeheerder(theme) {
  await installStub({
    session: true,
    theme,
    userId: 'fixture-beheerder',
    name: BEHEERDER_NAME,
    email: BEHEERDER_EMAIL,
    roles: BEHEERDER_ROLES,
    counts: OPEN_WORK_COUNTS,
  });
  await gotoPage(`${APP}${HOME_ROUTE}`, FOOTER_READY);
  const gekomen = await waitForTrigger('beheerder home');
  const stip = gekomen && (await waitFor(cdp, DOT_READY, 20000));
  add('beheerder home: de knop heeft de stip (openstaand werk)', stip);
  return Boolean(gekomen && stip);
}

async function runBeheerder() {
  await setViewport(1280, 900);
  await openAsBeheerder('light');
  await openMenu('beheerder home');
  const menu = await menuSnapshot();

  add('beheerder: de initialen komen uit de naam (SV)', Boolean(menu) && menu.initials === 'SV', menu && menu.initials);
  add(
    'beheerder: het schermlezerlabel noemt de naam en het aantal taken',
    Boolean(menu) && menu.ariaLabel === `Account van ${BEHEERDER_NAME}, ${OPEN_WORK_TOTAL} openstaande taken`,
    menu && menu.ariaLabel,
  );
  add(
    'beheerder: de knop is 44 bij 44 px',
    Boolean(menu) && menu.triggerWidth === 44 && menu.triggerHeight === 44,
    JSON.stringify({ width: menu && menu.triggerWidth, height: menu && menu.triggerHeight }),
  );
  add('beheerder: de rol staat in gewone woorden', Boolean(menu) && menu.role === 'Beheerder · Redacteur', menu && menu.role);
  add('beheerder: de naam staat bovenin', Boolean(menu) && menu.name === BEHEERDER_NAME, menu && menu.name);
  const beheer = itemOf(menu, 'Beheer');
  add(
    'beheerder: "Beheer · 7 open" met de bestemming /internal',
    Boolean(beheer) && beheer.count === `${OPEN_WORK_TOTAL} open` && beheer.href === '/internal',
    JSON.stringify(beheer),
  );
  add('beheerder: "Mijn lijstje" staat in het menu', Boolean(itemOf(menu, 'Mijn lijstje')));
  add('beheerder: "Uitloggen" staat in het menu', Boolean(itemOf(menu, 'Uitloggen')));
  add('beheerder: geen "Mijn restaurant" zonder owner-rol', !itemOf(menu, 'Mijn restaurant'));
  add('beheerder: op een publieke pagina geen "Bekijk de site"', !itemOf(menu, 'Bekijk de site'));
  add(
    'beheerder: alleen de items die bij de rol horen',
    Boolean(menu) && menu.items.length === 3,
    JSON.stringify(menu && menu.items.map((item) => item.label)),
  );

  // Escape sluit en zet de focus terug op de knop.
  await closeMenuWithEscape('beheerder home');

  // Toetsenbord: openen met Enter, de pijltoetsen, en Escape.
  if (await focusTriggerThenOpen('beheerder toetsenbord')) {
    await arrowKeyCheck('beheerder toetsenbord');
    await closeMenuWithEscape('beheerder toetsenbord');
  }

  // Mobiel: het paneel van onderen met de sluitknop.
  for (const size of WIDTHS.slice(1)) {
    await setViewport(size.width, size.height);
    await openAsBeheerder('light');
    if (!(await openMenu(`beheerder mobiel ${size.name}`))) continue;
    const sheet = await menuSnapshot();
    add(`beheerder ${size.name}: het menu is het paneel van onderen`, Boolean(sheet) && sheet.sheet === true, String(sheet && sheet.sheet));
    add(`beheerder ${size.name}: het paneel heeft een sluitknop`, Boolean(sheet) && sheet.closeLabel === 'Sluiten', sheet && sheet.closeLabel);
    await closeMenuWithEscape(`beheerder mobiel ${size.name}`);
    await openMenu(`beheerder mobiel ${size.name} sluitknop`);
    const geklikt = await evalJs(
      cdp,
      `(() => {
        const knop = document.querySelector('#account-menu-panel .account-menu-close');
        if (!knop) return false;
        knop.click();
        return true;
      })()`,
    );
    const dicht = Boolean(geklikt) && (await waitFor(cdp, `document.querySelector('#account-menu-panel') === null`, 8000));
    add(`beheerder ${size.name}: de sluitknop sluit het paneel`, dicht);
  }

  // Intern: "Bekijk de site" staat in het menu.
  await setViewport(1280, 900);
  await installStub({
    session: true,
    theme: 'light',
    userId: 'fixture-beheerder',
    name: BEHEERDER_NAME,
    email: BEHEERDER_EMAIL,
    roles: BEHEERDER_ROLES,
    counts: OPEN_WORK_COUNTS,
  });
  await gotoPage(`${APP}${INTERNAL_ROUTE}`, `document.body !== null`);
  if (await waitForTrigger('beheerder intern')) {
    await openMenu('beheerder intern');
    const intern = await menuSnapshot();
    const site = itemOf(intern, 'Bekijk de site');
    add('intern: "Bekijk de site" staat in het menu', Boolean(site), JSON.stringify(intern && intern.items.map((item) => item.label)));
    add('intern: "Bekijk de site" gaat naar /', Boolean(site) && site.href === '/', site && site.href);
    add('intern: de rol staat ook hier in gewone woorden', Boolean(intern) && intern.role === 'Beheerder · Redacteur', intern && intern.role);
    const schendingen = await evalJs(cdp, `window.__BE59__ ? window.__BE59__.violations : []`);
    add('intern: geen enkele externe of schrijvende aanroep', schendingen.length === 0, JSON.stringify(schendingen));
    await capture('#account-menu-panel', 'be59-beheerder-intern-1280-light-menu');
    await closeMenuWithEscape('beheerder intern');
  }

  // De a11y-check met het menu open, in licht en donker.
  for (const theme of THEMES) {
    await setViewport(1280, 900);
    await openAsBeheerder(theme);
    if (await openMenu(`beheerder a11y (${theme})`)) await a11y('accountmenu open', theme);
  }

  // Licht en donker op 1280, 390 en 320 px, met de knop en het menu in beeld.
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      await setViewport(size.width, size.height);
      await openAsBeheerder(theme);
      await capture('.account-menu', `be59-beheerder-home-${size.name}-${theme}-knop`);
      if (await openMenu(`beheerder opname (${theme}/${size.name})`)) {
        await capture('#account-menu-panel', `be59-beheerder-home-${size.name}-${theme}-menu`);
        await closeMenuWithEscape(`beheerder opname (${theme}/${size.name})`);
      }
      await noHorizontalOverflow(`beheerder home (${theme}/${size.name})`);
    }
  }
}

// ── Scenario 4 — de houder ──────────────────────────────────────────────────

const OWNER_READY = `document.querySelector('.owner-title') !== null`;

async function openAsHolder(theme, route, readyExpression) {
  await installStub({
    session: true,
    theme,
    userId: 'fixture-houder',
    name: HOLDER_NAME,
    email: HOLDER_EMAIL,
    roles: HOLDER_ROLES,
    counts: {},
  });
  await gotoPage(`${APP}${route}`, readyExpression);
  return waitForTrigger(`houder ${route}`);
}

async function runHouder() {
  await setViewport(1280, 900);
  await openAsHolder('light', HOME_ROUTE, FOOTER_READY);
  await openMenu('houder home');
  const menu = await menuSnapshot();

  // Een houder zonder openstaand werk: geen stip, wel Mijn restaurant.
  const stip = await evalJs(cdp, `Boolean(document.querySelector('.account-menu-dot'))`);
  add('houder: geen stip zonder openstaand werk', stip === false, String(stip));
  add('houder: de initialen komen uit de naam (YK)', Boolean(menu) && menu.initials === 'YK', menu && menu.initials);
  add(
    'houder: de rol staat in gewone woorden met de restaurantnaam',
    Boolean(menu) && menu.role === `Restauranthouder van ${HOLDER_RESTAURANT_NAME}`,
    menu && menu.role,
  );
  const mijnRestaurant = itemOf(menu, 'Mijn restaurant');
  add(
    'houder: "Mijn restaurant" staat in het menu en gaat naar /mijn-restaurant',
    Boolean(mijnRestaurant) && mijnRestaurant.href === '/mijn-restaurant',
    JSON.stringify(mijnRestaurant),
  );
  add('houder: geen "Beheer" zonder werkrol', !itemOf(menu, 'Beheer'));
  add(
    'houder: alleen de items die bij de rol horen',
    Boolean(menu) && menu.items.length === 3,
    JSON.stringify(menu && menu.items.map((item) => item.label)),
  );
  add(
    'houder: het schermlezerlabel noemt geen aantal taken',
    Boolean(menu) && menu.ariaLabel === `Account van ${HOLDER_NAME}`,
    menu && menu.ariaLabel,
  );

  // De kop van Mijn restaurant noemt de naam van het restaurant.
  await openAsHolder('light', OWNER_ROUTE, OWNER_READY);
  const eigen = await evalJs(
    cdp,
    `(() => ({
      pad: location.pathname,
      kop: (document.querySelector('.owner-title') || {}).innerText || '',
      trigger: Boolean(document.querySelector('.account-menu-trigger')),
    }))()`,
  );
  add('houder: /mijn-restaurant blijft op zijn eigen pad', eigen.pad === OWNER_ROUTE, eigen.pad);
  add(
    'houder: de kop is "Mijn restaurant · [naam]"',
    eigen.kop === `Mijn restaurant · ${HOLDER_RESTAURANT_NAME}`,
    eigen.kop,
  );
  add('houder: daar staat ook het accountmenu in de kop', eigen.trigger === true, String(eigen.trigger));
  await capture('.owner-title', 'be59-houder-owner-1280-light-kop');

  // Licht en donker op 1280, 390 en 320 px.
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      await setViewport(size.width, size.height);
      await openAsHolder(theme, HOME_ROUTE, FOOTER_READY);
      await capture('.account-menu', `be59-houder-home-${size.name}-${theme}-knop`);
      if (await openMenu(`houder opname (${theme}/${size.name})`)) {
        await capture('#account-menu-panel', `be59-houder-home-${size.name}-${theme}-menu`);
        await closeMenuWithEscape(`houder opname (${theme}/${size.name})`);
      }
      await noHorizontalOverflow(`houder home (${theme}/${size.name})`);
    }
    await setViewport(1280, 900);
    await openAsHolder(theme, OWNER_ROUTE, OWNER_READY);
    await capture('.owner-title', `be59-houder-owner-1280-${theme}-kop`);
  }
}

const SCENARIOS = [
  { name: 'gast', run: runGast },
  { name: 'inloggen', run: runInloggen },
  { name: 'beheerder', run: runBeheerder },
  { name: 'houder', run: runHouder },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: 'run-be59-browser-check.js' });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('no_local_browser');
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  server = await startServer({ port: PORT, appUrl: APP, outputDir: path.join(__dirname, 'output', 'be-59') });

  // De eerste keer compileren deze routes tientallen seconden; dat mag geen
  // CDP-timeout op de eerste navigatie worden.
  for (const route of ROUTES) {
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
  writeEvidence({ error: 'run_timeout (16 min)' });
  try {
    if (browser) killTree(browser.child);
    if (server) killTree(server);
  } catch {
    // afsluiten mag nooit de uitslag verbergen
  }
  process.exit(1);
}, 16 * 60 * 1000);

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

