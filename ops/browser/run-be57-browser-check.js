'use strict';

// BE-57 (#139, deel 2) — browsercheck van de schermen van "Mijn restaurant".
//
// Eén run, drie standen, met een gestubde API en een gestubde sessie: het
// overzicht, "Net geclaimd" en "nog geen cijfers". Alles komt uit
// ops/browser/lib/be48-auth-stub.js (fictieve Supabase) plus de nieuwe
// `ownerStats`-map voor `GET /api/mijn-restaurant/<id>/cijfers`. Geen echt
// Supabase-project, geen productiegegeven, geen credential, geen internet.
//
// Wat de check bewijst: de vier cijfers met de verandering, "minder dan 5" bij
// elk getal onder de drempel, de top 4 met balkjes, de privacyregel, "Je
// menukaart" met datum en publieke link, de welkomststand zonder dode links,
// licht en donker op 1280, 390 en 320 px, een zichtbare focus bij toetsenbord,
// en de bestaande a11y-audit voor deze pagina.
//
// Lokaal alleen: next start op poort 3187 (uit 3180-3189). Bewijs:
// ops/browser/evidence/be57-browser-evidence.json en evidence/be-57/*.png.
// Dit is ontwikkelaarsbewijs, geen onafhankelijke review of echte acceptatie.

const fs = require('node:fs');
const path = require('node:path');

const { authStubScript } = require('./lib/be48-auth-stub');
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
const { CdpClient } = require('./lib/cdp');
const audit = require('./lib/a11y-audit');

const PORT = Number(process.env.BE57_FIXTURE_PORT || 3187);
const APP = `http://localhost:${PORT}`;
const LOGIN_URL = `${APP}/mijn-restaurant/inloggen`;
const DASHBOARD_URL = `${APP}/mijn-restaurant`;
const OWNER_EMAIL = 'houder@example.invalid';
const EMAIL_CODE = '654321';

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-57');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be57-browser-evidence.json');

const WIDTHS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 700 },
];

const ROLES = [{ role: 'owner', restaurant_id: '1' }];
const CLAIMS = [{ id: 'claim-approved', restaurant_id: '1', status: 'approved', created_at: '2026-10-01T09:00:00.000Z' }];

const checks = [];
const errors = [];
const shots = [];
const injectedScripts = [];
let cdp = null;
let server = null;
let browser = null;

function add(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) errors.push({ name, detail: detail === undefined ? null : String(detail) });
  return Boolean(passed);
}

function writeEvidence(extra = {}) {
  const record = {
    ticket: 'BE-57 (#139, deel 2)',
    route: '/mijn-restaurant',
    category: `lokale browsercheck met gestubde API en sessie (next start op poort ${PORT}); geen productie, geen echte acceptatie`,
    ranAt: new Date().toISOString(),
    passed: errors.length === 0 && !extra.error,
    checks,
    errors,
    shots,
    ...extra,
  };
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// ─── de fictieve antwoorden van GET /api/mijn-restaurant/1/cijfers ──────────

const PERIOD = {
  week: { van: '2026-10-23', tot: '2026-10-29' },
  vorigeWeek: { van: '2026-10-16', tot: '2026-10-22' },
  maand: { van: '2026-09-30', tot: '2026-10-29' },
};

function shownOf(value) {
  return value >= 5 ? String(value) : 'minder dan 5';
}

function weekFigure(id, label, value, previous, changeLabel, direction) {
  const comparable = value >= 5 && previous >= 5;
  return {
    id,
    label,
    value,
    shown: shownOf(value),
    enough: value >= 5,
    previous,
    previousShown: shownOf(previous),
    change: {
      current: value,
      previous,
      delta: value - previous,
      comparable,
      direction: comparable ? direction : null,
      label: comparable ? changeLabel : 'te weinig gegevens om te vergelijken',
    },
  };
}

const READY_STATS = {
  status: 'cijfers',
  restaurantId: '1',
  period: PERIOD,
  hasData: true,
  week: [
    weekFigure('bekeken', 'keer bekeken', 128, 96, '32 meer dan vorige week', 'meer'),
    weekFigure('bewaard', 'keer bewaard', 14, 18, '4 minder dan vorige week', 'minder'),
    weekFigure('gedeeld', 'keer gedeeld', 3, 2, '1 meer dan vorige week', 'meer'),
    weekFigure('favoriet', 'keer favoriet in Samen kiezen', 41, 41, 'gelijk aan vorige week', 'gelijk'),
  ],
  top: [
    { dishKey: '1-diner-0-0', restaurantId: '1', total: 22, label: '22', enough: true, barPercent: 100 },
    { dishKey: '1-lunch-0-1', restaurantId: '1', total: 11, label: '11', enough: true, barPercent: 50 },
    { dishKey: '1-diner-1-0', restaurantId: '1', total: 6, label: '6', enough: true, barPercent: 27 },
    { dishKey: '1-lunch-0-0', restaurantId: '1', total: 2, label: 'minder dan 5', enough: false, barPercent: 9 },
  ],
  month: {
    period: PERIOD.maand,
    totals: { viewed: 402, saved: 51, shared: 12, favourite: 140 },
    figures: [
      { id: 'bekeken', label: 'keer bekeken', value: 402, shown: '402', enough: true },
      { id: 'bewaard', label: 'keer bewaard', value: 51, shown: '51', enough: true },
      { id: 'gedeeld', label: 'keer gedeeld', value: 12, shown: '12', enough: true },
      { id: 'favoriet', label: 'keer favoriet in Samen kiezen', value: 140, shown: '140', enough: true },
    ],
  },
};

const WELCOME_STATS = {
  status: 'geen-cijfers',
  message: 'Nog geen cijfers.',
  hasData: false,
  period: PERIOD,
  week: [],
  top: [],
  month: {
    period: PERIOD.maand,
    totals: { viewed: 7, saved: 2, shared: 0, favourite: 3 },
    figures: [
      { id: 'bekeken', label: 'keer bekeken', value: 7, shown: '7', enough: true },
      { id: 'bewaard', label: 'keer bewaard', value: 2, shown: shownOf(2), enough: false },
      { id: 'gedeeld', label: 'keer gedeeld', value: 0, shown: shownOf(0), enough: false },
      { id: 'favoriet', label: 'keer favoriet in Samen kiezen', value: 3, shown: shownOf(3), enough: false },
    ],
  },
};

const EMPTY_STATS = {
  status: 'geen-cijfers',
  message: 'Nog geen cijfers.',
  hasData: false,
  period: PERIOD,
  week: [],
  top: [],
  month: {
    period: PERIOD.maand,
    totals: { viewed: 0, saved: 0, shared: 0, favourite: 0 },
    figures: ['bekeken', 'bewaard', 'gedeeld', 'favoriet'].map((id, index) => ({
      id,
      label: ['keer bekeken', 'keer bewaard', 'keer gedeeld', 'keer favoriet in Samen kiezen'][index],
      value: 0,
      shown: shownOf(0),
      enough: false,
    })),
  },
};

const STATES = [
  { name: 'overzicht', stats: READY_STATS, expected: 'Deze week' },
  { name: 'net-geclaimd', stats: WELCOME_STATS, expected: 'Net geclaimd' },
  { name: 'geen-cijfers', stats: EMPTY_STATS, expected: 'Net geclaimd' },
];

// ─── helpers ───────────────────────────────────────────────────────────────

async function setViewport(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Het thema zoals de pagina het echt toont: `data-theme` op <html>, de knop die
 * de app zelf actief noemt (aria-pressed/`active` in ThemeToggle), de
 * achtergrondkleur van de body met zijn helderheid, en de hoogte van de kop.
 * Een bestandsnaam met "-donker" is daarmee geen bewijs meer op zichzelf.
 */
async function themeProof() {
  return evalJs(
    cdp,
    `(() => {
      const bg = getComputedStyle(document.body).backgroundColor;
      const numbers = (bg || '').match(/[0-9]+/g) || [];
      const luminance = numbers.length >= 3
        ? Math.round(0.2126 * Number(numbers[0]) + 0.7152 * Number(numbers[1]) + 0.0722 * Number(numbers[2]))
        : null;
      const buttons = [...document.querySelectorAll('.theme-btn')];
      const active = buttons
        .filter((button) => button.getAttribute('aria-pressed') === 'true' || button.classList.contains('active'))
        .map((button) => (button.textContent || '').trim());
      const header = document.querySelector('.site-header');
      return {
        attr: document.documentElement.getAttribute('data-theme'),
        bg,
        luminance,
        active,
        buttons: buttons.map((button) => (button.textContent || '').trim()),
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : null,
      };
    })()`,
  );
}

/**
 * Het thema zetten via de themaknop van de app zelf (BE-46 deel 2): een klik op
 * "Licht" of "Donker" in ThemeToggle, geen los attribuut. Geeft het bewijs terug
 * waarmee de opname wordt gecontroleerd.
 */
async function applyTheme(theme) {
  const label = theme === 'light' ? 'Licht' : 'Donker';
  const clicked = await evalJs(
    cdp,
    `(() => {
      const target = [...document.querySelectorAll('.theme-btn')]
        .find((button) => (button.textContent || '').trim() === ${JSON.stringify(label)});
      if (!target) return 'missing';
      target.click();
      return 'clicked';
    })()`,
  );
  if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
  await sleep(260);
  return themeProof();
}

/** Het bewijs moet kloppen: attribuut, actieve knop én de helderheid van --bg. */
function themeOk(proof, want) {
  const label = want === 'light' ? 'Licht' : 'Donker';
  return Boolean(proof)
    && proof.attr === want
    && Array.isArray(proof.active)
    && proof.active.length === 1
    && proof.active[0] === label
    && Number.isFinite(proof.luminance)
    && (want === 'light' ? proof.luminance > 200 : proof.luminance < 80);
}

/** De pagina zo ver scrollen dat het cijferblok direct onder de vaste kop begint. */
async function framePanel() {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('.owner-stats');
      if (!panel) return null;
      const header = document.querySelector('.site-header');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const target = panel.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo(0, Math.max(0, Math.round(target)));
      return Math.round(headerHeight);
    })()`,
  );
}

/**
 * Wat de opname echt laat zien: staat de titel van deze stand volledig in beeld,
 * en (bij het overzicht) ook de vier cijfers? "In beeld" betekent: onder de
 * vaste kop en boven de vaste tabbar, dus niet weggeschoven of bedekt.
 */
async function measureFraming(wantTitle) {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('.owner-stats');
      if (!panel) return null;
      const header = document.querySelector('.site-header');
      const tabbar = document.querySelector('.mobile-tabbar');
      const headerHeight = header ? Math.round(header.getBoundingClientRect().height) : 0;
      const tabbarVisible = tabbar ? getComputedStyle(tabbar).display !== 'none' : false;
      const safeBottom = tabbarVisible
        ? Math.min(window.innerHeight, Math.round(tabbar.getBoundingClientRect().top))
        : window.innerHeight;
      const fully = (element) => {
        const box = element.getBoundingClientRect();
        return box.top >= headerHeight - 1 && box.bottom <= safeBottom + 1;
      };
      const titles = [...panel.querySelectorAll('.owner-stats-subtitle')]
        .map((element) => ({ text: element.innerText.trim(), ok: fully(element) }));
      const figures = [...panel.querySelectorAll('.owner-figure')];
      const wanted = titles.find((title) => title.text === ${JSON.stringify(wantTitle)});
      return {
        wantTitle: ${JSON.stringify(wantTitle)},
        headerHeight,
        tabbarVisible,
        safeBottom,
        viewportHeight: window.innerHeight,
        titleInView: Boolean(wanted && wanted.ok),
        titles,
        figureCount: figures.length,
        figuresInView: figures.filter(fully).length,
        allFiguresInView: figures.length === 4 && figures.every(fully),
        panelTop: Math.round(panel.getBoundingClientRect().top),
      };
    })()`,
  );
}

/**
 * De kop zelf: hoe hoog is hij, welk nav-landmark is zichtbaar, en begint de
 * inhoud onder de kop in plaats van eronder te verdwijnen?
 */
async function measureHeader() {
  return evalJs(
    cdp,
    `(() => {
      window.scrollTo(0, 0);
      const header = document.querySelector('.site-header');
      const box = header ? header.getBoundingClientRect() : null;
      const navs = [...document.querySelectorAll('nav')]
        .filter((nav) => {
          const style = getComputedStyle(nav);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = nav.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((nav) => nav.getAttribute('aria-label') || '');
      const first = document.querySelector('.owner-main > *');
      const firstBox = first ? first.getBoundingClientRect() : null;
      return {
        headerHeight: box ? Math.round(box.height) : null,
        headerBottom: box ? Math.round(box.bottom) : null,
        position: header ? getComputedStyle(header).position : null,
        navs,
        firstContentTop: firstBox ? Math.round(firstBox.top) : null,
        firstContentTag: first ? first.tagName.toLowerCase() + '.' + (first.className || '') : null,
      };
    })()`,
  );
}

async function fillField(selector, value) {
  const filled = await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  if (!filled) throw new Error(`field_missing: ${selector}`);
  return filled;
}

async function submitForm() {
  return evalJs(cdp, `(() => { const form = document.querySelector('form'); if (!form) return false; form.requestSubmit ? form.requestSubmit() : form.submit(); return true; })()`);
}

async function signIn() {
  await navigate(cdp, LOGIN_URL, `document.querySelector('#owner-email') !== null`);
  // Eerst wachten tot React het formulier echt bedient: zonder hydratatie doet
  // requestSubmit() een gewone GET en verschijnt het codescherm nooit.
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
  await new Promise((resolve) => setTimeout(resolve, 120));
  await submitForm();
  const codeScreen = await waitFor(cdp, `document.querySelector('#owner-code') !== null`, 25000);
  if (!codeScreen) throw new Error('code_screen_missing');
  await fillField('#owner-code', EMAIL_CODE);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await submitForm();
  await waitFor(cdp, `document.querySelector('#owner-code') === null`, 25000);
}

async function resetStorage(theme) {
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
  // De keuze van de bezoeker staat in dezelfde opslag die ThemeToggle gebruikt.
  // Bewijs dat het thema echt staat komt pas op de pagina zelf, via de themaknop
  // van de app (applyTheme); de inlogpagina heeft geen themaknop.
  if (theme) {
    await evalJs(
      cdp,
      `(() => {
        try { localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)}); } catch (error) {}
        return true;
      })()`,
    );
  }
}

/** De pagina openen voor één stand: eigen stub, eigen sessie, eigen thema. */
async function openState(state, theme) {
  await resetStorage(theme);
  // Alleen de nieuwste stub telt; de vorige scripts worden opgeruimd zodat een
  // oude stand nooit door een latere documentlaad heen sijpelt.
  for (const identifier of injectedScripts) {
    try {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    } catch (error) {
      /* een verdwenen script is geen fout */
    }
  }
  injectedScripts.length = 0;
  const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: authStubScript({
      theme,
      email: OWNER_EMAIL,
      emailCode: EMAIL_CODE,
      roles: ROLES,
      claims: CLAIMS,
      ownerStats: { '/api/mijn-restaurant/1/cijfers': { status: 200, body: state.stats } },
    }),
  });
  if (added && added.identifier) injectedScripts.push(added.identifier);

  await navigate(cdp, DASHBOARD_URL, `document.readyState === 'complete'`);
  // Zonder sessie stuurt de pagina naar de login; daar loggen we in en komen we
  // terug op het overzicht.
  if (!(await waitFor(cdp, `document.querySelector('#owner-email') === null`, 15000))) {
    await signIn();
  }
  const panelText = `document.querySelector('.owner-stats') && document.querySelector('.owner-stats').innerText.indexOf(${JSON.stringify(state.expected)}) >= 0`;
  let ready = await waitFor(cdp, panelText, 30000);
  if (!ready) {
    // Eén herlaadpoging: de eerste keer kan de dev-server nog compileren.
    await navigate(cdp, DASHBOARD_URL, `document.readyState === 'complete'`);
    ready = await waitFor(cdp, panelText, 30000);
  }
  if (!ready) throw new Error(`stats_missing: ${state.name}`);
  return evalJs(cdp, 'window.__BE48__ ? window.__BE48__.violations : []');
}

async function readState() {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('.owner-stats');
      const text = (selector) => {
        const el = panel ? panel.querySelector(selector) : null;
        return el ? el.innerText.trim() : null;
      };
      const all = (selector) => (panel ? Array.from(panel.querySelectorAll(selector)) : []);
      return {
        panelText: panel ? panel.innerText.trim() : null,
        subtitles: all('.owner-stats-subtitle').map((el) => el.innerText.trim()),
        figures: all('.owner-figure').map((row) => ({
          label: row.querySelector('.owner-figure-label').innerText.trim(),
          value: row.querySelector('.owner-figure-number').innerText.trim(),
          change: row.querySelector('.owner-figure-change') ? row.querySelector('.owner-figure-change').innerText.trim() : '',
        })),
        privacy: text('.owner-privacy'),
        top: all('.owner-top-row').map((row) => ({
          name: row.querySelector('.owner-top-name').innerText.trim(),
          value: row.querySelector('.owner-top-value').innerText.trim(),
          barWidth: Math.round(row.querySelector('.owner-top-bar').getBoundingClientRect().width),
          trackWidth: Math.round(row.querySelector('.owner-top-track').getBoundingClientRect().width),
        })),
        menuNote: text('.owner-menu .owner-note'),
        menuLink: panel && panel.querySelector('.owner-menu a') ? {
          text: panel.querySelector('.owner-menu a').innerText.trim(),
          href: panel.querySelector('.owner-menu a').getAttribute('href'),
          height: Math.round(panel.querySelector('.owner-menu a').getBoundingClientRect().height),
        } : null,
        monthFigures: all('.owner-month-figure').map((row) => ({
          label: row.querySelector('.owner-figure-label').innerText.trim(),
          value: row.querySelector('.owner-figure-value').innerText.trim(),
        })),
        startItems: all('.owner-start-item').map((el) => el.innerText.trim()),
        welcomeLinks: all('.owner-welcome a').length,
        statsLinks: all('a').map((el) => el.getAttribute('href')),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    })()`,
  );
}


/**
 * Eén opname van het cijferblok: eerst het thema via de themaknop van de app met
 * het bewijs daarvan, dan zo scrollen dat de titel van deze stand direct onder
 * de vaste kop staat, en dan pas de opname. De opname bewijst zichzelf: het
 * themabewijs en wat er in beeld staat, staan ernaast in het bewijsbestand.
 */
async function shotOfPanel(state, width, theme) {
  await setViewport(width.width, width.height);
  const proof = await applyTheme(theme);
  await framePanel();
  await sleep(260);
  const framing = await measureFraming(state.expected);
  const name = `be57-${state.name}-${width.name}-${theme === 'light' ? 'licht' : 'donker'}.png`;
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({
    name,
    state: state.name,
    theme,
    viewport: `${width.width}x${width.height}`,
    themeProof: proof,
    framing,
    ...file,
  });
  return { framing, proof };
}

function checkReadyState(state, measured) {
  const prefix = `${state.name}:`;
  add(`${prefix} vier cijfers van "Deze week" in vaste volgorde`, measured.figures.length === 4, JSON.stringify(measured.figures));
  const byLabel = Object.fromEntries(measured.figures.map((figure) => [figure.label, figure]));
  add(`${prefix} keer bekeken is 128 met de verandering van vorige week`,
    byLabel['keer bekeken'] && byLabel['keer bekeken'].value === '128' &&
      byLabel['keer bekeken'].change === '32 meer dan vorige week',
    JSON.stringify(byLabel['keer bekeken']));
  add(`${prefix} keer bewaard noemt 14 en "4 minder dan vorige week"`,
    byLabel['keer bewaard'] && byLabel['keer bewaard'].value === '14' &&
      byLabel['keer bewaard'].change === '4 minder dan vorige week',
    JSON.stringify(byLabel['keer bewaard']));
  // De drempel: 3 gedeeld blijft "minder dan 5", ook in de verandering.
  add(`${prefix} een getal onder 5 heet "minder dan 5"`,
    byLabel['keer gedeeld'] && byLabel['keer gedeeld'].value === 'minder dan 5' &&
      byLabel['keer gedeeld'].change === 'te weinig gegevens om te vergelijken',
    JSON.stringify(byLabel['keer gedeeld']));
  add(`${prefix} favoriet in Samen kiezen telt 41 en is gelijk aan vorige week`,
    byLabel['keer favoriet in Samen kiezen'] && byLabel['keer favoriet in Samen kiezen'].value === '41' &&
      byLabel['keer favoriet in Samen kiezen'].change === 'gelijk aan vorige week',
    JSON.stringify(byLabel['keer favoriet in Samen kiezen']));
  add(`${prefix} de privacyregel staat er`, measured.privacy === 'Alleen totalen, nooit wie.', measured.privacy);
  add(`${prefix} de top 4 staat er met namen en zichtbare balkjes`,
    measured.top.length === 4 &&
      measured.top[0].name.length > 0 &&
      measured.top[0].barWidth > 0 &&
      measured.top[0].barWidth > measured.top[1].barWidth &&
      measured.top[1].barWidth > measured.top[3].barWidth,
    JSON.stringify(measured.top));
  add(`${prefix} het vierde gerecht onder de drempel toont "minder dan 5"`,
    measured.top[3] && measured.top[3].value === 'minder dan 5',
    JSON.stringify(measured.top[3]));
  add(`${prefix} "Je menukaart" noemt de datum en linkt naar de publieke pagina`,
    measured.menuNote === 'Laatst bijgewerkt op 25 maart 2026.' &&
      measured.menuLink && measured.menuLink.href === '/menu/1-lunch' &&
      measured.menuLink.height >= 44,
    JSON.stringify({ note: measured.menuNote, link: measured.menuLink }));
  // Wat bij een volgend ticket hoort, staat er niet.
  const text = measured.panelText || '';
  add(`${prefix} geen "Bevestigd", geen "Menukaart bijwerken" en geen QR`,
    ['Bevestigd', 'Menukaart bijwerken', 'QR'].every((word) => text.indexOf(word) === -1),
    text.slice(0, 200));
}

function checkWelcomeState(state, measured) {
  const prefix = `${state.name}:`;
  add(`${prefix} de welkomstmelding staat er`, (measured.panelText || '').indexOf('Welkom') >= 0, (measured.panelText || '').slice(0, 160));
  add(`${prefix} het cijfer van de afgelopen maand staat er`, measured.monthFigures.length === 4, JSON.stringify(measured.monthFigures));
  add(`${prefix} "Drie dingen om mee te beginnen" heeft drie punten`, measured.startItems.length === 3, JSON.stringify(measured.startItems));
  add(`${prefix} het welkomstblok bevat geen enkele link`, measured.welcomeLinks === 0, String(measured.welcomeLinks));
  add(`${prefix} "Je menukaart" staat er ook in deze stand`,
    (measured.menuNote || '').indexOf('Laatst bijgewerkt op') === 0,
    measured.menuNote);
}


// ─── de run ────────────────────────────────────────────────────────────────

async function run() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  console.log(`starting the local app on ${APP}`);
  server = await startServer({
    port: PORT,
    appUrl: APP,
    outputDir: path.join(__dirname, 'output', 'be-57'),
    readyPath: '/mijn-restaurant/inloggen',
  });
  browser = await startBrowser(browserPath);
  cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // Warm-up met de gewone stub: de routes zijn dan al gecompileerd voordat de
  // echte metingen beginnen.
  const warm = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: authStubScript({}) });
  if (warm && warm.identifier) injectedScripts.push(warm.identifier);
  await navigate(cdp, LOGIN_URL, `document.readyState === 'complete'`);
  await navigate(cdp, DASHBOARD_URL, `document.readyState === 'complete'`);

  const stateResults = [];
  for (const state of STATES) {
    const violations = await openState(state, 'light');
    add(`${state.name}: geen extern of onbekend verzoek`, violations.length === 0, JSON.stringify(violations.slice(0, 3)));

    await setViewport(1280, 900);
    const measured = await readState();
    if (state.name === 'overzicht') checkReadyState(state, measured);
    else checkWelcomeState(state, measured);

    // Toetsenbord en focus op het overzicht, 1280 px, terwijl de pagina al open
    // is: geen tweede sessie nodig en geen extra navigatie.
    let walk = [];
    if (state.name === 'overzicht') {
      await evalJs(cdp, `(() => { const body = document.body; body.setAttribute('tabindex', '-1'); body.focus(); return document.activeElement === body; })()`);
      await evalJs(cdp, audit.inPageSource('prepareFocusWalk', [{ scope: 'page' }]));
      for (let step = 0; step < 14; step += 1) {
        await pressKey(cdp, 'Tab', 'Tab', 9);
        const info = await evalJs(cdp, audit.inPageSource('readFocusStep', []));
        if (!info || info.done) break;
        walk.push({ selector: info.selector, name: info.name, visible: Boolean(info.indicator && info.indicator.visible) });
      }
      add(
        'toetsenbord: minstens vijf stappen, elk met een zichtbare focusring',
        walk.length >= 5 && walk.every((entry) => entry.visible),
        JSON.stringify(walk),
      );
      add(
        'toetsenbord: de link naar de menukaart komt langs',
        walk.some((entry) => entry.name && entry.name.toLowerCase().indexOf('menukaart') >= 0),
        JSON.stringify(walk.map((entry) => entry.name)),
      );
    }

    // De bestaande a11y-audit voor deze pagina, in licht en donker.
    for (const theme of ['light', 'dark']) {
      const proof = await applyTheme(theme);
      add(
        `a11y ${state.name}: het thema ${theme} staat echt voor de audit`,
        themeOk(proof, theme),
        JSON.stringify(proof),
      );
      await setViewport(1280, 900);
      const measuredA11y = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
      const review = audit.checksFromAudit(`mijn-restaurant-cijfers/${state.name}`, theme === 'light' ? 'licht' : 'donker', measuredA11y, {
        minTarget: 44,
      });
      for (const check of review.checks) add(check.name, check.passed, check.detail);
      for (const failure of review.errors) {
        add(`mijn-restaurant-cijfers (${state.name}, ${theme}) · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name} · ${failure.detail || ''}`);
      }
    }
    await applyTheme('light');

    // Dezelfde stand in licht en donker op 1280, 390 en 320 px, met de titel van
    // de stand en (bij het overzicht) de vier cijfers volledig in beeld.
    const shotResults = [];
    for (const width of WIDTHS) {
      // Eerst de breedte zetten: anders meet de kop hierboven nog de vorige
      // breedte en zegt de check niets over deze breedte.
      await setViewport(width.width, width.height);
      // Het herstelpunt van de review: de kop zelf, per breedte gemeten.
      const header = await measureHeader();
      add(
        `mijn-restaurant: de kop is op ${width.name}px niet hoger dan 96 px`,
        Number.isFinite(header.headerHeight) && header.headerHeight <= 96,
        JSON.stringify(header),
      );
      add(
        `mijn-restaurant: het nav-landmark is zichtbaar op ${width.name}px`,
        header.navs.length >= 1 && header.navs.every((label) => label.length > 0),
        JSON.stringify(header.navs),
      );
      add(
        `mijn-restaurant: de inhoud begint onder de kop op ${width.name}px`,
        header.firstContentTop >= header.headerBottom - 1,
        JSON.stringify({ first: header.firstContentTag, top: header.firstContentTop, headerBottom: header.headerBottom }),
      );

      for (const theme of ['light', 'dark']) {
        const { framing, proof } = await shotOfPanel(state, width, theme);
        shotResults.push({ viewport: width.name, theme, themeProof: proof, framing });
        add(
          `${state.name}: het thema ${theme} is via de themaknop van de app gezet bij ${width.name}px`,
          themeOk(proof, theme),
          JSON.stringify(proof),
        );
        add(
          `${state.name}: de opname ${width.name}/${theme} toont "${state.expected}" volledig in beeld`,
          Boolean(framing && framing.titleInView),
          JSON.stringify(framing && {
            titles: framing.titles,
            panelTop: framing.panelTop,
            headerHeight: framing.headerHeight,
            safeBottom: framing.safeBottom,
          }),
        );
        if (state.name === 'overzicht') {
          add(
            `${state.name}: de vier cijfers staan volledig in beeld bij ${width.name}/${theme}`,
            Boolean(framing && framing.allFiguresInView && framing.figureCount === 4),
            JSON.stringify(framing && {
              figuresInView: framing.figuresInView,
              figureCount: framing.figureCount,
              safeBottom: framing.safeBottom,
              viewportHeight: framing.viewportHeight,
            }),
          );
        }
        const reflow = await readState();
        add(`${state.name}: geen horizontale scroll bij ${width.name}/${theme}`, reflow.overflowX <= 0, String(reflow.overflowX));
        add(`${state.name}: het thema is echt ${theme}`, reflow.theme === theme, String(reflow.theme));
      }
    }
    await applyTheme('light');
    stateResults.push({ name: state.name, measured, walk, shots: shotResults });
  }

  const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
  add('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

  return writeEvidence({ states: stateResults });
}

const timeout = setTimeout(() => {
  writeEvidence({ error: 'run_timeout (10 min)' });
  try {
    if (browser) killTree(browser.child);
    if (server) killTree(server);
  } catch {
    /* niets */
  }
  process.exit(1);
}, 10 * 60 * 1000);

(async () => {
  try {
    const record = await run();
    clearTimeout(timeout);
    console.log(
      JSON.stringify({
        evidence: 'ops/browser/evidence/be57-browser-evidence.json',
        passed: record.passed,
        checks: checks.length,
        errors: errors.length,
        shots: shots.length,
      }),
    );
    for (const error of errors.slice(0, 12)) console.log(`FOUT: ${error.name} — ${error.detail}`);
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
      /* afsluiten mag nooit de uitslag verbergen */
    }
  }
  if (errors.length > 0) process.exitCode = 1;
})();


