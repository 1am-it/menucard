'use strict';

// BE-46 (#106) — browsercheck voor "samen kiezen": de stemlink /kies/<code>.
//
// Dit start de echte app (`next dev`, zonder Supabase-sleutel) en de echte
// pagina, met een GESTUBDE API: de antwoorden van /api/v1/kies* komen uit dit
// bestand, met dezelfde vorm als src/lib/kiesHandlers.js. Het is dus FIXTURE
// EVIDENCE: geen echte database, geen echte stemming, geen acceptatie. De
// serverkant is met een nep-client getest in src/lib/kiesHandlers.test.js.
//
// Wat deze check in de browser bewijst:
//   - de hele route van maken tot uitslag: roepnaam, kaartenstapel, uitslag;
//   - swipen met de muis/vinger (pointer-events) over de drempel van 30%, met
//     het label "Lekker →" tijdens het slepen en niets onder de drempel;
//   - de pijltjestoetsen links en rechts doen hetzelfde als de knoppen;
//   - "Vorige stem ongedaan maken" brengt het vorige gerecht terug;
//   - de staat zonder migratie: "Samen kiezen is nog niet beschikbaar";
//   - de uitslag als echte lijst, met de favoriet en "Reserveer"/"Route";
//   - licht en donker op 390 px, met schermafdrukken;
//   - geen geblokkeerde netwerkopdracht en geen onafgevangen fout.
//
// Gebruik: `node ops/browser/run-be46-browser-check.js`,
// `--lijst` voor de namen, `--alleen=<naam>[,<naam>]` voor één scenario.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
// De schermafdrukken horen bij de levering en staan daarom in de repository.
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-46');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be46-browser-evidence.json');
const SCRIPT_NAME = 'run-be46-browser-check.js';
const PORT = Number(process.env.BE46_FIXTURE_PORT || 3166);
const APP = `http://localhost:${PORT}`;
const CODE = 'FictieStemCode00000022';
const PAGE_URL = (query = '') => `${APP}/kies/${CODE}${query}`;

// De fictieve gerechten: dezelfde vorm als de echte uitlezing (naam, prijs,
// restaurant, beschrijving, categorie, reserveeractie en routelink). Geen
// echte horecagegevens, geen echte namen.
const FIXTURE_DISHES = [
  {
    id: '77-diner-0-0',
    name: 'Fictieve pasta',
    price: '€14,50',
    restaurant: 'Fictief Restaurant Een',
    description: 'Pasta met fictieve tomatensaus.',
    category: 'Hoofdgerechten',
    reserve: { method: 'phone', label: 'Bel restaurant', href: 'tel:0760000001' },
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+1%2C+Breda',
  },
  {
    id: '77-diner-0-1',
    name: 'Fictieve burger',
    price: '€16,00',
    restaurant: 'Fictief Restaurant Een',
    description: 'Een fictieve burger met friet.',
    category: 'Hoofdgerechten',
    reserve: { method: 'phone', label: 'Bel restaurant', href: 'tel:0760000001' },
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+1%2C+Breda',
  },
  {
    id: '77-diner-1-0',
    name: 'Fictieve salade',
    price: 'op aanvraag',
    restaurant: 'Fictief Restaurant Twee',
    description: 'Seizoenssalade, fictief.',
    category: 'Voorgerechten',
    reserve: null,
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+2%2C+Breda',
  },
  {
    id: '77-diner-1-1',
    name: 'Fictieve soep',
    price: '€5,50',
    restaurant: 'Fictief Restaurant Twee',
    description: '',
    category: 'Voorgerechten',
    reserve: null,
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+2%2C+Breda',
  },
];

const checks = [];
const shots = [];
let viewport = { width: 390, height: 780 };
let scenarioRuns = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    state: meta.state || null,
  });
  return file;
}

async function setTheme(cdp, theme) {
  await evalJs(cdp, `(() => {
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
    try { localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)}); } catch (error) {}
    return document.documentElement.getAttribute('data-theme');
  })()`);
}

// ─── De gestubde API ─────────────────────────────────────────────────────────
//
// Alleen /api/v1/kies* wordt beantwoord, met precies de vorm van de echte
// routes; elk ander verzoek gaat ongewijzigd door naar de lokale app. De stemmen
// leven in het geheugen van de pagina, dus elke herlaadbeurt begint leeg.
// `?zonder=migratie` laat de stub het antwoord van een ontbrekende migratie
// geven (503 + de ene melding).

function stubSource() {
  return `(() => {
  const code = ${JSON.stringify(CODE)};
  const dishes = ${JSON.stringify(FIXTURE_DISHES)};
  const search = new URLSearchParams(location.search);
  const withoutMigration = search.get('zonder') === 'migratie';
  const votes = [];
  const calls = (window.__KIES_CALLS__ = []);
  let sequence = 0;

  function outcome() {
    const rows = dishes.map((dish, index) => {
      const own = votes.filter((vote) => vote.dishKey === dish.id);
      const lekker = own.filter((vote) => vote.lekker).length;
      const row = Object.assign({}, dish);
      row.lekker = lekker;
      row.lieverNiet = own.length - lekker;
      row.kiezers = own.filter((vote) => vote.lekker).map((vote) => vote.roepnaam);
      row.lieverNietKiezers = own.filter((vote) => !vote.lekker).map((vote) => vote.roepnaam);
      row.position = index;
      return row;
    });
    rows.sort((a, b) => (b.lekker - a.lekker) || (a.lieverNiet - b.lieverNiet) || (a.position - b.position));
    return {
      uitslag: rows.map((row) => {
        const copy = Object.assign({}, row);
        delete copy.position;
        return copy;
      }),
      stemmers: new Set(votes.map((vote) => vote.stemmer)).size,
      stemmen: votes.length,
    };
  }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const native = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const options = init || {};
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (raw.indexOf('/api/v1/kies') !== 0) return native(input, init);
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    if (calls.length < 100) calls.push({ method: method, url: raw, body: body });
    if (withoutMigration) {
      return Promise.resolve(json({ error: 'kies_unavailable', message: 'Samen kiezen is nog niet beschikbaar' }, 503));
    }
    if (method === 'GET') {
      return Promise.resolve(json(Object.assign({ code: code, dishes: dishes, sluitOm: null, gesloten: false }, outcome())));
    }
    if (method === 'POST') {
      const index = votes.findIndex((vote) => vote.stemmer === body.stemmer && vote.dishKey === body.dishKey);
      const replaced = index >= 0;
      sequence += 1;
      const record = {
        stemmer: body.stemmer,
        roepnaam: body.roepnaam,
        dishKey: body.dishKey,
        lekker: Boolean(body.lekker),
        gestemdOp: new Date(Date.now() + sequence).toISOString(),
      };
      if (replaced) votes[index] = record;
      else votes.push(record);
      return Promise.resolve(json(Object.assign({ ok: true, vervangen: replaced }, outcome())));
    }
    if (method === 'DELETE') {
      const own = votes.filter((vote) => vote.stemmer === body.stemmer);
      const last = own[own.length - 1];
      if (!last) return Promise.resolve(json(Object.assign({ ok: true, undone: false }, outcome())));
      votes.splice(votes.indexOf(last), 1);
      return Promise.resolve(json(Object.assign({ ok: true, undone: true, dishKey: last.dishKey }, outcome())));
    }
    return Promise.resolve(json({ error: 'unsupported' }, 404));
  };
})();`;
}


// ─── De pagina lezen en bedienen ─────────────────────────────────────────────

async function readState(cdp) {
  return evalJs(cdp, `(() => {
    const text = (selector) => {
      const el = document.querySelector(selector);
      return el ? (el.innerText || el.textContent || '').trim() : '';
    };
    const progress = document.querySelector('.kies-progress');
    const wrap = document.querySelector('.kies-card-wrap');
    const undo = document.querySelector('.kies-undo');
    return {
      hasNameInput: Boolean(document.querySelector('#kies-roepnaam')),
      progress: progress ? (progress.textContent || '').trim() : null,
      progressRole: progress ? progress.getAttribute('role') : null,
      dish: text('.kies-dish'),
      hasCard: Boolean(document.querySelector('.kies-dish-card')),
      buttons: [...document.querySelectorAll('.kies-vote-btn')].map((button) => ({
        label: button.getAttribute('aria-label'),
        text: (button.textContent || '').trim(),
        height: Math.round(button.getBoundingClientRect().height),
      })),
      undoDisabled: undo ? Boolean(undo.disabled) : null,
      undoHeight: undo ? Math.round(undo.getBoundingClientRect().height) : null,
      resultIsList: Boolean(document.querySelector('ul.kies-uitslag')),
      rows: [...document.querySelectorAll('.kies-uitslag-row')].map((row) => ({
        text: (row.innerText || '').trim(),
        favourite: row.classList.contains('is-favoriet'),
      })),
      favouriteActions: [...document.querySelectorAll('.kies-uitslag-actions a')].map((link) => ({
        label: link.getAttribute('aria-label'),
        href: link.getAttribute('href'),
      })),
      swipeLabel: text('.kies-swipe-label'),
      touchAction: wrap ? getComputedStyle(wrap).touchAction : null,
      unavailable: (document.body.innerText || '').indexOf('Samen kiezen is nog niet beschikbaar') >= 0,
    };
  })()`);
}

async function callsOf(cdp) {
  return evalJs(cdp, 'window.__KIES_CALLS__ || []');
}

async function typeName(cdp, name) {
  return evalJs(cdp, `(() => {
    const input = document.querySelector('#kies-roepnaam');
    if (!input) return false;
    // React leest de native setter, niet een losse toewijzing.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
}

async function clickButtonByText(cdp, needle) {
  return evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => (entry.textContent || '').indexOf(${JSON.stringify(needle)}) >= 0);
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function voteByLabel(cdp, prefix) {
  return evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('.kies-vote-btn')].find((entry) => (entry.getAttribute('aria-label') || '').indexOf(${JSON.stringify(prefix)}) === 0);
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

/** Een schone start: geen eigen voortgang uit een vorige stap. */
async function resetProgress(cdp) {
  await evalJs(cdp, `(() => { try { localStorage.clear(); } catch (error) {} return true; })()`);
}

async function join(cdp, name = 'Sam') {
  await typeName(cdp, name);
  await clickButtonByText(cdp, 'Meedoen');
  return waitFor(cdp, `Boolean(document.querySelector('.kies-dish-card'))`, 15000);
}

async function openFresh(cdp, query = '') {
  await navigate(cdp, PAGE_URL(query), `Boolean(document.querySelector('#kies-roepnaam') || document.querySelector('.kies-dish-card') || document.querySelector('.kies-status'))`);
  await resetProgress(cdp);
  // Opnieuw laden zodat de pagina de schone opslag ziet.
  await cdp.send('Page.reload', { ignoreCache: false });
  await waitFor(cdp, `Boolean(document.querySelector('#kies-roepnaam') || document.querySelector('.kies-uitslag') || document.querySelector('.kies-status'))`, 30000);
}

/** Slepen met de muis: van het midden naar `ratio` × de kaartbreedte. */
async function dragCard(cdp, ratio) {
  const box = await evalJs(cdp, `(() => {
    const el = document.querySelector('.kies-dish-card');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width };
  })()`);
  if (!box) return null;
  const targetX = box.x + box.width * ratio;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: box.y, button: 'left', buttons: 1 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const during = await readState(cdp);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: box.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { width: box.width, label: during.swipeLabel, calls: await callsOf(cdp) };
}


// ─── Scenario's ─────────────────────────────────────────────────────────────

/** De hele route: roepnaam, vier gerechten, de uitslag, licht en donker. */
async function routeScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await setTheme(cdp, 'light');
  await openFresh(cdp, '');

  const start = await readState(cdp);
  check('route: de stemlink begint met de roepnaam', start.hasNameInput, String(start.hasNameInput));

  check('route: "Meedoen" opent de kaartenstapel', await join(cdp, 'Sam'));
  const first = await readState(cdp);
  check('route: de stapel begint bij het eerste gerecht', first.dish === FIXTURE_DISHES[0].name, first.dish);
  check('route: de voortgang staat in role="status"', first.progressRole === 'status' && first.progress === 'Gerecht 1 van 4', first.progress);
  check(
    'route: de knoppen noemen het gerecht in hun aria-label',
    first.buttons.length === 2
      && first.buttons[0].label === `Liever niet: ${FIXTURE_DISHES[0].name}`
      && first.buttons[1].label === `Lekker: ${FIXTURE_DISHES[0].name}`,
    JSON.stringify(first.buttons),
  );
  check('route: de knoppen zijn minstens 44 px hoog', first.buttons.every((button) => button.height >= 44), JSON.stringify(first.buttons.map((button) => button.height)));
  check('route: "Vorige stem ongedaan maken" is uit zonder stem', first.undoDisabled === true, String(first.undoDisabled));
  check('route: verticaal scrollen blijft werken (touch-action: pan-y)', first.touchAction === 'pan-y', first.touchAction);
  await shot(cdp, 'be46-stapel-390-light.png', { theme: 'light', state: 'stapel' });

  // Vier stemmen: lekker, lekker, liever niet, liever niet.
  const votes = [
    [`Lekker: ${FIXTURE_DISHES[0].name}`, 'Gerecht 2 van 4'],
    [`Lekker: ${FIXTURE_DISHES[1].name}`, 'Gerecht 3 van 4'],
    [`Liever niet: ${FIXTURE_DISHES[2].name}`, 'Gerecht 4 van 4'],
    [`Liever niet: ${FIXTURE_DISHES[3].name}`, null],
  ];
  for (const [label, expectedProgress] of votes) {
    const clicked = await voteByLabel(cdp, label);
    check(`route: de knop "${label.split(':')[0]}" werkt`, clicked);
    if (expectedProgress) {
      await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === ${JSON.stringify(expectedProgress)}`, 15000);
      const state = await readState(cdp);
      check(`route: de voortgang staat op "${expectedProgress}"`, state.progress === expectedProgress, state.progress);
    }
  }
  await waitFor(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`, 15000);

  const result = await readState(cdp);
  check('route: de uitslag is een echte lijst', result.resultIsList, String(result.resultIsList));
  check('route: alle vier gerechten staan in de uitslag', result.rows.length === 4, String(result.rows.length));
  check('route: de favoriet staat bovenaan met "Favoriet"', result.rows[0].favourite && result.rows[0].text.indexOf('Favoriet') >= 0, result.rows[0].text);
  check('route: de favoriet is "Fictieve pasta"', result.rows[0].text.indexOf(FIXTURE_DISHES[0].name) >= 0, result.rows[0].text);
  check(
    'route: de favoriet heeft "Reserveer" en "Route"',
    result.favouriteActions.length === 2
      && result.favouriteActions[0].label.startsWith('Reserveer')
      && result.favouriteActions[1].label.startsWith('Route'),
    JSON.stringify(result.favouriteActions),
  );
  check(
    'route: de knoppen leiden naar de eigen route van het restaurant en naar Maps',
    result.favouriteActions[0].href === 'tel:0760000001'
      && result.favouriteActions[1].href.indexOf('google.com/maps') > 0,
    JSON.stringify(result.favouriteActions.map((action) => action.href)),
  );
  await shot(cdp, 'be46-uitslag-390-light.png', { theme: 'light', state: 'uitslag' });

  // De eigen stem is bewaard: opnieuw openen geeft meteen de uitslag.
  await cdp.send('Page.reload', { ignoreCache: false });
  const reopened = await waitFor(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`, 20000);
  check('route: opnieuw openen toont meteen de uitslag', reopened);

  await setTheme(cdp, 'dark');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const dark = await readState(cdp);
  check('route: de uitslag staat er ook in donker', dark.resultIsList && dark.rows.length === 4, String(dark.rows.length));
  await shot(cdp, 'be46-uitslag-390-dark.png', { theme: 'dark', state: 'uitslag' });

  const calls = await callsOf(cdp);
  const posts = calls.filter((call) => call.method === 'POST');
  check(
    'route: elke stem is precies één POST met alleen de vier velden',
    posts.length === 4
      && posts.every((call) => Object.keys(call.body).sort().join(',') === 'dishKey,lekker,roepnaam,stemmer'),
    JSON.stringify(posts.map((call) => call.body)),
  );
  check('route: de pagina leest de stemming via GET', calls.some((call) => call.method === 'GET'), String(calls.length));
}


/** Swipen met de muis: over de drempel, onder de drempel, en het label. */
async function swipeScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await setTheme(cdp, 'light');
  await openFresh(cdp, '');
  await join(cdp, 'Sam');

  const right = await dragCard(cdp, 0.4);
  check('swipen: slepen naar rechts toont "Lekker →"', Boolean(right) && right.label.indexOf('Lekker') >= 0 && right.label.indexOf('→') >= 0, right && right.label);
  check(
    'swipen: 40% naar rechts is een stem "lekker"',
    Boolean(right) && right.calls.some((call) => call.method === 'POST' && call.body.lekker === true),
    JSON.stringify(right && right.calls),
  );
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 2 van 4'`, 15000);
  const second = await readState(cdp);
  check('swipen: na de stem staat het tweede gerecht vooraan', second.dish === FIXTURE_DISHES[1].name, second.dish);

  const before = (await callsOf(cdp)).length;
  const small = await dragCard(cdp, -0.1);
  check('swipen: slepen naar links toont "← Liever niet"', Boolean(small) && small.label.indexOf('Liever niet') >= 0 && small.label.indexOf('←') >= 0, small && small.label);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = await callsOf(cdp);
  check('swipen: 10% is onder de drempel en telt niet', after.length === before, `${before} -> ${after.length}`);
  const stillSecond = await readState(cdp);
  check('swipen: onder de drempel blijft dezelfde kaart staan', stillSecond.dish === FIXTURE_DISHES[1].name, stillSecond.dish);

  const left = await dragCard(cdp, -0.45);
  check(
    'swipen: 45% naar links is een stem "liever niet"',
    Boolean(left) && left.calls.some((call) => call.method === 'POST' && call.body.lekker === false),
    JSON.stringify(left && left.calls),
  );
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 3 van 4'`, 15000);
  const third = await readState(cdp);
  check('swipen: na links staat het derde gerecht vooraan', third.dish === FIXTURE_DISHES[2].name, third.dish);
}

/** De pijltjestoetsen doen hetzelfde als de knoppen. */
async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await setTheme(cdp, 'light');
  await openFresh(cdp, '');
  await join(cdp, 'Noa');

  const focused = await evalJs(cdp, `(() => {
    const stack = document.querySelector('.kies-stack');
    if (!stack) return false;
    stack.focus();
    return document.activeElement === stack;
  })()`);
  check('toetsenbord: de kaartenstapel is met het toetsenbord te bereiken', focused);

  await pressKey(cdp, 'ArrowRight', 'ArrowRight', 39);
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 2 van 4'`, 15000);
  let calls = await callsOf(cdp);
  check('toetsenbord: ArrowRight stemt "lekker"', calls.some((call) => call.method === 'POST' && call.body.lekker === true), JSON.stringify(calls));

  await pressKey(cdp, 'ArrowLeft', 'ArrowLeft', 37);
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 3 van 4'`, 15000);
  calls = await callsOf(cdp);
  check('toetsenbord: ArrowLeft stemt "liever niet"', calls.some((call) => call.method === 'POST' && call.body.lekker === false), JSON.stringify(calls));
  const state = await readState(cdp);
  check('toetsenbord: de voortgang telt mee', state.progress === 'Gerecht 3 van 4', state.progress);
}

/** "Vorige stem ongedaan maken" brengt het vorige gerecht terug. */
async function undoScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await setTheme(cdp, 'light');
  await openFresh(cdp, '');
  await join(cdp, 'Pip');

  await voteByLabel(cdp, 'Lekker:');
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 2 van 4'`, 15000);
  const afterVote = await readState(cdp);
  check('ongedaan: na een stem is de undo-knop actief', afterVote.undoDisabled === false, String(afterVote.undoDisabled));
  check('ongedaan: de undo-knop is minstens 44 px hoog', afterVote.undoHeight >= 44, String(afterVote.undoHeight));

  await clickButtonByText(cdp, 'Vorige stem ongedaan maken');
  await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === 'Gerecht 1 van 4'`, 15000);
  const afterUndo = await readState(cdp);
  check('ongedaan: het eerste gerecht staat weer vooraan', afterUndo.dish === FIXTURE_DISHES[0].name, afterUndo.dish);
  check('ongedaan: de knop is weer uit', afterUndo.undoDisabled === true, String(afterUndo.undoDisabled));

  const calls = await callsOf(cdp);
  const deletes = calls.filter((call) => call.method === 'DELETE');
  check(
    'ongedaan: de pagina stuurt één DELETE met alleen de stemmer',
    deletes.length === 1 && Object.keys(deletes[0].body).join(',') === 'stemmer',
    JSON.stringify(deletes),
  );
}

/** Zonder migratie: één nette melding, geen crash en geen lege pagina. */
async function withoutMigrationScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await setTheme(cdp, 'light');
  await navigate(cdp, PAGE_URL('?zonder=migratie'), `Boolean(document.querySelector('.kies-status'))`);
  const ready = await waitFor(cdp, `(document.body.innerText || '').indexOf('Samen kiezen is nog niet beschikbaar') >= 0`, 20000);
  const state = await readState(cdp);
  check('zonder migratie: de pagina toont de ene melding', ready && state.unavailable, String(state.unavailable));
  check('zonder migratie: er is geen kaartenstapel', state.hasCard === false, String(state.hasCard));
  await shot(cdp, 'be46-zonder-migratie-390-light.png', { theme: 'light', state: 'zonder-migratie' });
}


// ─── Bewijs ──────────────────────────────────────────────────────────────────

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (error) {
    return null;
  }
}

function writeEvidence(extra = {}) {
  const record = {
    category: 'fixture evidence (stubbed /api/v1/kies*; not real acceptance)',
    issue: '#106',
    script: SCRIPT_NAME,
    generatedAt: new Date().toISOString(),
    port: PORT,
    head: headSha(),
    stub: {
      dishes: FIXTURE_DISHES.map((dish) => dish.name),
      note: 'the API answers come from stubSource() in this file, with the shape of src/lib/kiesHandlers.js; the database and the migration are not involved',
    },
    mockupComparison:
      'not machine-verifiable here: the approved mockup is an external Claude artifact; the screenshots in evidence/be-46/ are saved for the Lead/human visual comparison',
    // BE-43 (#101): een gefilterde run noemt zijn keuze en is nooit het volledige bewijs.
    filter: SELECTION.filter,
    scenarios: scenarioRuns,
    checks,
    screenshots: shots,
    passed: checks.length > 0 && checks.every((entry) => entry.passed),
    ...extra,
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}

async function warmUp(cdp) {
  await setViewport(cdp, 390, 780);
  await navigate(cdp, PAGE_URL(), `Boolean(document.querySelector('.kies-main'))`);
  const ready = await waitFor(cdp, `Boolean(document.querySelector('#kies-roepnaam') || document.querySelector('.kies-status'))`, 120000);
  check('warm-up: de pagina en de gestubde API antwoorden', ready);
  await resetProgress(cdp);
}

// Elk scenario is één benoemde stap; `--alleen=<naam>` draait alleen die stap.
const KIES_SCENARIOS = [
  { name: 'route', run: (cdp) => routeScenario(cdp) },
  { name: 'swipen', run: (cdp) => swipeScenario(cdp) },
  { name: 'toetsenbord', run: (cdp) => keyboardScenario(cdp) },
  { name: 'ongedaan', run: (cdp) => undoScenario(cdp) },
  { name: 'zonder-migratie', run: (cdp) => withoutMigrationScenario(cdp) },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), KIES_SCENARIOS);
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: KIES_SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    try {
      writeEvidence({ error: 'run_timeout (10 min)' });
    } catch (ignored) {
      // Het schrijven van het bewijs is ook hier best effort.
    }
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
    // Eerst de ontwikkelserver, dan de browser: één check tegelijk (de machine
    // is klein en er kan een tweede runner actief zijn).
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: '/mijn-lijstje' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource() });

    console.log('warm-up: de pagina en de gestubde API compileren');
    await warmUp(cdp);
    scenarioRuns = await runScenarioSelection({ entries: KIES_SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence({});
    console.log(
      JSON.stringify(
        {
          passed: record.passed,
          checks: checks.length,
          failed: checks.filter((entry) => !entry.passed).length,
          screenshots: shots.length,
          evidence: EVIDENCE_PATH,
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
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main();

