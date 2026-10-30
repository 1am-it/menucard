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
//   - de hele route van maken tot uitslag: "Samen kiezen" in Mijn lijstje, de
//     sluitingstijd, de stemlink delen via BE-49 met de gedeeld-teller,
//     roepnaam, kaartenstapel en uitslag;
//   - de stemlink zelf: roepnaam, kaartenstapel, uitslag;
//   - swipen met de muis/vinger (pointer-events) over de drempel van 30%, met
//     het label "Lekker →" tijdens het slepen en niets onder de drempel;
//   - de pijltjestoetsen links en rechts doen hetzelfde als de knoppen;
//   - "Vorige stem ongedaan maken" brengt het vorige gerecht terug;
//   - de staat zonder migratie: "Samen kiezen is nog niet beschikbaar";
//   - de uitslag als echte lijst, met de favoriet en "Reserveer"/"Route";
//   - de opbouw van de goedgekeurde mockup: een kaart van ±85% breed en 440 px
//     hoog met een tweede kaart erachter, een dunne voortgangsbalk, twee knoppen
//     van ±132 × 56 px met een icoon, "Vorige stem ongedaan maken" als
//     tekstlink met een terug-pijl en per gerecht een balk met het aandeel;
//   - licht en donker op 390 px: het thema wordt per opname expliciet gezet en
//     vóór de opname gecontroleerd (data-theme, de actieve themaknop en de
//     helderheid van de achtergrond staan in het bewijs bij elke schermafdruk);
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

// Het lijstje van de maker in "Mijn lijstje": dezelfde vier gerechten, in de
// vorm die `readSavedList` (src/lib/dishList.js) bewaart.
const SAVED_ENTRIES = FIXTURE_DISHES.map((dish) => ({
  id: dish.id,
  name: dish.name,
  category: dish.category,
  price: dish.price,
  restaurant: dish.restaurant,
}));

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

const THEME_KEY = 'bredaeats_theme';
const PROGRESS_KEY = 'bredaeats_kies';

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    // Het bewijs dat bij de opname hoort: het thema zoals de pagina het toont.
    themeProof: meta.themeProof || null,
    state: meta.state || null,
  });
  return file;
}

/**
 * Het thema zoals de pagina het echt toont: het `data-theme`-attribuut op
 * <html>, de achtergrondkleur van de body (het token `--bg`) met zijn helderheid
 * en de knop die de app zelf actief noemt. Een bestandsnaam met "-light" is
 * daarmee geen bewijs meer op zichzelf.
 */
async function themeProof(cdp) {
  return evalJs(cdp, `(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const numbers = (bg || '').match(/[0-9]+/g) || [];
    const luminance = numbers.length >= 3
      ? Math.round(0.2126 * Number(numbers[0]) + 0.7152 * Number(numbers[1]) + 0.0722 * Number(numbers[2]))
      : null;
    const active = [...document.querySelectorAll('.theme-btn')]
      .filter((button) => button.classList.contains('active'))
      .map((button) => (button.textContent || '').trim());
    return {
      attr: document.documentElement.getAttribute('data-theme'),
      bodyBackground: bg,
      luminance,
      active,
    };
  })()`);
}

/**
 * Het thema van een scenario expliciet zetten: de opslag, de knop van de app
 * zelf (zodat "Licht"/"Donker" ook echt actief staat) en het attribuut op
 * <html>. Geeft het bewijs terug waarmee de opname wordt gecontroleerd.
 */
async function setTheme(cdp, want) {
  const label = want === 'light' ? 'Licht' : 'Donker';
  await evalJs(cdp, `(() => {
    try { localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(want)}); } catch (error) {}
    const target = [...document.querySelectorAll('.theme-btn')]
      .find((button) => (button.textContent || '').trim() === ${JSON.stringify(label)});
    if (target && !target.classList.contains('active')) target.click();
    document.documentElement.setAttribute('data-theme', ${JSON.stringify(want)});
    return document.documentElement.getAttribute('data-theme');
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 220));
  return themeProof(cdp);
}

/**
 * Een opname in een expliciet thema, met een controle vóór de opname: het
 * attribuut is het gevraagde thema, de app noemt precies die knop actief en de
 * achtergrond is echt licht (helderheid > 200) of echt donker (< 80).
 */
async function shotInTheme(cdp, name, want, state) {
  const proof = await setTheme(cdp, want);
  const isLight = want === 'light';
  const activeLabel = isLight ? 'Licht' : 'Donker';
  const ok = proof.attr === want
    && Array.isArray(proof.active) && proof.active.length === 1 && proof.active[0] === activeLabel
    && Number.isFinite(proof.luminance)
    && (isLight ? proof.luminance > 200 : proof.luminance < 80);
  check(`thema: ${name} staat echt in ${want}`, ok, JSON.stringify(proof));
  return shot(cdp, name, { theme: want, themeProof: proof, state });
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
  // De anonieme \`gedeeld\`-teller van BE-44 komt hier ook langs: hij wordt
  // vastgelegd en met 204 beantwoord, zodat het delen van de stemlink te
  // controleren is zonder de echte tellerroute.
  const shared = (window.__KIES_TELLERS__ = []);
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
    if (raw.indexOf('/api/v1/tellers') === 0) {
      if (shared.length < 100) shared.push(options.body ? JSON.parse(options.body) : null);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
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
      // De maker: een stemming uit de id's van het lijstje. Zelfde antwoord als
      // createStemming in src/lib/kiesHandlers.js (201 met code, href en
      // sluitOm).
      if (body && Array.isArray(body.dish_keys)) {
        return Promise.resolve(json({
          code: code,
          href: '/kies/' + code,
          dishKeys: body.dish_keys,
          dishes: body.dish_keys.length,
          sluitOm: body.sluit_om || null,
        }, 201));
      }
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

/** Op het eerste element met deze selector klikken; false als het er niet is. */
async function clickSelector(cdp, selector) {
  return evalJs(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

/** Een waarde in een invoerveld zetten zoals React hem leest. */
async function setInputValue(cdp, selector, value) {
  return evalJs(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return null;
    const proto = input instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
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

/** Een schone start: geen eigen voortgang uit een vorige stap. Het thema van de
 *  pagina blijft staan — anders valt de pagina terug op donker en is een
 *  "lichte" opname dat niet. */
async function resetProgress(cdp) {
  await evalJs(cdp, `(() => { try { localStorage.removeItem(${JSON.stringify(PROGRESS_KEY)}); } catch (error) {} return true; })()`);
}

// De serverpagina toont al "Bezig…" vóór React werkt; wie daarop wacht leest te
// vroeg (de SSR-HTML heeft immers ook een `.kies-status`). De pagina doet altijd
// één GET naar de gestubde API, dus een gevulde `__KIES_CALLS__` is het bewijs
// dat de clientkant echt draait.
const HYDRATED = `Boolean((window.__KIES_CALLS__ || []).length)`;
const PAGE_READY = `${HYDRATED} && Boolean(document.querySelector('#kies-roepnaam') || document.querySelector('.kies-dish-card') || document.querySelector('.kies-uitslag') || document.querySelector('.kies-status'))`;

async function join(cdp, name = 'Sam') {
  await typeName(cdp, name);
  await clickButtonByText(cdp, 'Meedoen');
  return waitFor(cdp, `Boolean(document.querySelector('.kies-dish-card'))`, 15000);
}

async function openFresh(cdp, query = '', want = 'light') {
  await navigate(cdp, PAGE_URL(query), HYDRATED);
  await resetProgress(cdp);
  // Opnieuw laden zodat de pagina de schone opslag ziet.
  await cdp.send('Page.reload', { ignoreCache: false });
  await waitFor(cdp, PAGE_READY, 30000);
  // Het thema hoort bij het scenario, niet bij de vorige pagina.
  await setTheme(cdp, want);
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

/**
 * De maten en de opbouw van de kaartenstapel, voor de mockup-controle: de kaart
 * (breedte, hoogte, volgorde van de inhoud), de kaart erachter, de dunne
 * voortgangsbalk, de twee knoppen met hun icoon en kleur, de undo-link en de
 * balken in de uitslag.
 */
async function readStack(cdp) {
  return evalJs(cdp, `(() => {
    const card = document.querySelector('.kies-dish-card');
    const ghost = document.querySelector('.kies-card-ghost');
    const wrap = document.querySelector('.kies-card-wrap');
    const bar = document.querySelector('.kies-progress-bar');
    const fill = document.querySelector('.kies-progress-fill');
    const undo = document.querySelector('.kies-undo');
    const undoStyle = undo ? getComputedStyle(undo) : null;
    const rectOf = (el) => (el ? el.getBoundingClientRect() : null);
    const cardRect = rectOf(card);
    const ghostRect = rectOf(ghost);
    // De primaire knopkleur als rgb, zodat hij met de echte knop te vergelijken is.
    const probe = document.createElement('span');
    probe.style.color = 'var(--button-primary-bg)';
    document.body.appendChild(probe);
    const primaryColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      viewportWidth: window.innerWidth,
      cardWidth: cardRect ? Math.round(cardRect.width) : null,
      cardHeight: cardRect ? Math.round(cardRect.height) : null,
      cardRatio: cardRect ? Math.round((cardRect.width / window.innerWidth) * 100) : null,
      contentOrder: card ? [...card.children].map((el) => el.className).join(' ') : '',
      ghostBehind: Boolean(cardRect) && Boolean(ghostRect)
        && Math.round(ghostRect.top) > Math.round(cardRect.top)
        && Math.round(ghostRect.width) < Math.round(cardRect.width),
      wrapTouchAction: wrap ? getComputedStyle(wrap).touchAction : null,
      hasBar: Boolean(bar) && Boolean(fill),
      barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
      fillShare: fill ? fill.style.width : null,
      buttons: [...document.querySelectorAll('.kies-vote-btn')].map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          text: (button.textContent || '').trim(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          icon: Boolean(button.querySelector('svg')),
          background: getComputedStyle(button).backgroundColor,
        };
      }),
      primaryColor,
      undo: undo
        ? {
          text: (undo.textContent || '').trim(),
          height: Math.round(undo.getBoundingClientRect().height),
          icon: Boolean(undo.querySelector('svg')),
          underline: undoStyle.textDecorationLine,
          background: undoStyle.backgroundColor,
          borderWidth: undoStyle.borderTopWidth,
        }
        : null,
      resultBars: [...document.querySelectorAll('.kies-uitslag-bar-fill')].map((el) => el.style.width),
    };
  })()`);
}

/**
 * De kaart vasthouden tijdens het slepen: drukken, naar `ratio` × de breedte
 * schuiven en daar blijven. De opname gebeurt terwijl het label zichtbaar is;
 * `release()` laat pas daarna los (en stemt dus pas dan).
 */
async function holdCard(cdp, ratio) {
  const box = await evalJs(cdp, `(() => {
    const el = document.querySelector('.kies-dish-card');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 140), width: rect.width };
  })()`);
  if (!box) return null;
  const targetX = Math.round(box.x + box.width * ratio);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: box.y, button: 'left', buttons: 1 });
  await new Promise((resolve) => setTimeout(resolve, 220));
  return {
    width: box.width,
    label: (await readState(cdp)).swipeLabel,
    release: async () => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: box.y, button: 'left', clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 400));
    },
  };
}



// ─── Scenario's ─────────────────────────────────────────────────────────────

/**
 * De hele route van maken tot uitslag: "Samen kiezen" in Mijn lijstje, de
 * sluitingstijd, de stemlink delen via de bestaande deelroute van BE-49, de
 * roepnaam, de kaartenstapel en de uitslag. De maker en de stemmer zijn hier
 * dezelfde browser; de gestubde API onthoudt de stemmen in het venster, ook na
 * de client-side navigatie naar de stemlink.
 */
async function createScenario(cdp) {
  // 900 px hoog: het blad met de sluitingstijd past dan helemaal in beeld.
  await setViewport(cdp, 390, 900);
  await navigate(cdp, `${APP}/mijn-lijstje`, `Boolean(document.querySelector('.lijst-title'))`);

  // Het lijstje van de maker en de deelvoorkeur op het klembord, in dezelfde
  // opslag als BE-44 ("bredaeats_bewaard") en BE-49 ("deelvoorkeur"). De
  // themakeuze gaat mee: anders valt de pagina na het laden terug op donker en
  // is een "lichte" opname dat niet.
  const seeded = await evalJs(cdp, `(() => {
    try {
      localStorage.clear();
      localStorage.setItem('bredaeats_bewaard', ${JSON.stringify(JSON.stringify(SAVED_ENTRIES))});
      localStorage.setItem('deelvoorkeur', ${JSON.stringify(JSON.stringify({ methods: ['copy'] }))});
      localStorage.setItem(${JSON.stringify(THEME_KEY)}, 'light');
      return true;
    } catch (error) {
      return false;
    }
  })()`);
  check('maken: het lijstje van de maker staat klaar', seeded === true, String(seeded));
  await cdp.send('Page.reload', { ignoreCache: false });
  const listed = await waitFor(cdp, `Boolean(document.querySelector('.kies-start-btn'))`, 30000);
  check('maken: "Samen kiezen" staat in Mijn lijstje', listed);
  await setTheme(cdp, 'light');

  const neighbours = await evalJs(cdp, `(() => {
    const start = document.querySelector('.kies-start-btn');
    const labels = [...document.querySelectorAll('button, a')].map((el) => (el.textContent || '').trim());
    return {
      label: start ? (start.textContent || '').trim() : null,
      hasPopup: start ? start.getAttribute('aria-haspopup') : null,
      neighbour: labels.some((label) => label.indexOf('Lijstje delen') >= 0),
    };
  })()`);
  check(
    'maken: de knop heet "Samen kiezen", naast "Lijstje delen", en opent een blad',
    neighbours.label === 'Samen kiezen' && neighbours.hasPopup === 'dialog' && neighbours.neighbour,
    JSON.stringify(neighbours),
  );

  // De gestubde API en een klembord dat de gedeelde link bewaart.
  await evalJs(cdp, stubSource());
  await evalJs(cdp, `(() => {
    window.__KIES_CLIPBOARD__ = [];
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text) => { window.__KIES_CLIPBOARD__.push(String(text)); return Promise.resolve(); } },
      });
    } catch (error) {}
    return true;
  })()`);

  check('maken: een tik opent het blad met de sluitingstijd', await clickSelector(cdp, '.kies-start-btn'));
  const sheet = await waitFor(cdp, `Boolean(document.querySelector('#kies-sluit-tijd'))`, 15000);
  const dialog = await evalJs(cdp, `(() => {
    const panel = document.querySelector('.kies-panel');
    const title = panel ? panel.querySelector('.share-panel-title') : null;
    return {
      role: panel ? panel.getAttribute('role') : null,
      modal: panel ? panel.getAttribute('aria-modal') : null,
      title: title ? (title.textContent || '').trim() : null,
      noTime: (document.body.innerText || '').indexOf('Geen sluitingstijd') >= 0,
    };
  })()`);
  check('maken: het blad vraagt "Tot wanneer mag er gestemd worden?"', sheet && dialog.title === 'Tot wanneer mag er gestemd worden?', JSON.stringify(dialog));
  check('maken: het blad is een echt dialoogvenster', dialog.role === 'dialog' && dialog.modal === 'true', JSON.stringify(dialog));
  check('maken: zonder tijd geldt "Geen sluitingstijd"', dialog.noTime, String(dialog.noTime));
  await shotInTheme(cdp, 'be46-sluitingstijd-390-light.png', 'light', 'sluitingstijd');
  await shotInTheme(cdp, 'be46-sluitingstijd-390-dark.png', 'dark', 'sluitingstijd');
  await setTheme(cdp, 'light');

  const time = await setInputValue(cdp, '#kies-sluit-tijd', '18:00');
  check('maken: de sluitingstijd is in te vullen', time === '18:00', String(time));

  check('maken: "Maak de stemlink" maakt de stemming', await clickButtonByText(cdp, 'Maak de stemlink'));
  const started = await waitFor(cdp, `(document.body.innerText || '').indexOf('Stemlink gemaakt') >= 0`, 15000);
  check('maken: de stemming is gemaakt', started);

  const calls = await callsOf(cdp);
  const created = calls.find((call) => call.method === 'POST' && call.body && Array.isArray(call.body.dish_keys));
  check(
    'maken: de POST draagt de id\'s van het lijstje en een sluitingstijd, niets anders',
    Boolean(created)
      && created.url === '/api/v1/kies'
      && JSON.stringify(created.body.dish_keys) === JSON.stringify(SAVED_ENTRIES.map((entry) => entry.id))
      && Object.keys(created.body).sort().join(',') === 'dish_keys,sluit_om',
    JSON.stringify(created && created.body),
  );
  check(
    'maken: de gekozen sluitingstijd gaat als ISO-tijd mee',
    Boolean(created) && typeof created.body.sluit_om === 'string' && !Number.isNaN(Date.parse(created.body.sluit_om)),
    created && created.body.sluit_om,
  );

  const panel = await evalJs(cdp, `(() => {
    const link = document.querySelector('.kies-started-link a');
    const sheetEl = document.querySelector('.kies-panel');
    return {
      href: link ? link.getAttribute('href') : null,
      text: link ? (link.textContent || '').trim() : null,
      body: sheetEl ? (sheetEl.innerText || '') : '',
    };
  })()`);
  check(
    'maken: "Open de stemlink" wijst naar /kies/<code>',
    panel.href === `/kies/${CODE}` && panel.text === 'Open de stemlink',
    JSON.stringify({ href: panel.href, text: panel.text }),
  );
  check('maken: het blad noemt de gekozen tijd', panel.body.indexOf('18:00') >= 0, panel.body.slice(0, 120));
  await shotInTheme(cdp, 'be46-gemaakt-390-light.png', 'light', 'gemaakt');

  // Delen via de bestaande deelroute van BE-49, met de voorkeur op het klembord.
  check('maken: "Deel de stemlink" deelt de link', await clickButtonByText(cdp, 'Deel de stemlink'));
  const copied = await waitFor(cdp, `(window.__KIES_CLIPBOARD__ || []).length > 0`, 15000);
  const clipboard = await evalJs(cdp, 'window.__KIES_CLIPBOARD__ || []');
  check(
    'maken: het klembord krijgt de stemlink en niets anders',
    copied && clipboard.length === 1 && clipboard[0].indexOf(`/kies/${CODE}`) > 0,
    JSON.stringify(clipboard),
  );
  const shareMessage = await evalJs(cdp, `(() => {
    const status = document.querySelector('.kies-share .lijst-status');
    return status ? (status.textContent || '').trim() : null;
  })()`);
  check('maken: de melding is "Link gekopieerd"', shareMessage === 'Link gekopieerd', String(shareMessage));

  const counted = await evalJs(cdp, 'window.__KIES_TELLERS__ || []');
  check(
    'maken: de teller "gedeeld" telt elk gerecht van de stemlink één keer',
    counted.length === SAVED_ENTRIES.length
      && counted.every((entry) => entry
        && entry.event === 'gedeeld'
        && SAVED_ENTRIES.some((saved) => saved.id === entry.dish)),
    JSON.stringify(counted),
  );

  // Door naar de stemlink: dezelfde browser stemt en ziet daarna de uitslag.
  check('maken: "Open de stemlink" opent de stemming', await clickSelector(cdp, '.kies-started-link a'));
  const arrived = await waitFor(cdp, `Boolean(document.querySelector('#kies-roepnaam') || document.querySelector('.kies-dish-card'))`, 30000);
  check('maken: de stemlink begint met de roepnaam', arrived);
  check('maken: "Meedoen" opent de kaartenstapel', await join(cdp, 'Sam'));

  const order = [
    [`Lekker: ${FIXTURE_DISHES[0].name}`, 'Gerecht 2 van 4'],
    [`Lekker: ${FIXTURE_DISHES[1].name}`, 'Gerecht 3 van 4'],
    [`Liever niet: ${FIXTURE_DISHES[2].name}`, 'Gerecht 4 van 4'],
    [`Liever niet: ${FIXTURE_DISHES[3].name}`, null],
  ];
  for (const [label, expectedProgress] of order) {
    check(`maken: de stem "${label.split(':')[0]}" gaat naar de server`, await voteByLabel(cdp, label));
    if (expectedProgress) {
      await waitFor(cdp, `(document.querySelector('.kies-progress') || {}).textContent === ${JSON.stringify(expectedProgress)}`, 15000);
    }
  }
  await waitFor(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`, 15000);
  const result = await readState(cdp);
  check(
    'maken: de gemaakte stemming eindigt in de uitslag',
    result.resultIsList && result.rows.length === FIXTURE_DISHES.length,
    String(result.rows.length),
  );
  check(
    'maken: de uitslag noemt de stemmer bij de stemmen',
    Boolean(result.rows[0]) && result.rows[0].text.indexOf('Sam') >= 0,
    result.rows[0] ? result.rows[0].text : '',
  );
  await shotInTheme(cdp, 'be46-uitslag-na-maken-390-light.png', 'light', 'uitslag-na-maken');
}

/** De hele route: roepnaam, vier gerechten, de uitslag, licht en donker. */
async function routeScenario(cdp) {
  // 900 px hoog: de kaart van 440 px plus de knoppen en de undo-link passen dan
  // in één opname. De breedte blijft 390 px.
  await setViewport(cdp, 390, 900);
  await openFresh(cdp, '', 'light');

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

  // De mockup (schermen 4 en 5): kaart, stapel, voortgangsbalk en knoppen.
  const stack = await readStack(cdp);
  check(
    'mockup: de kaart is ±85% van de breedte op 390 px',
    Number(stack.cardRatio) >= 80 && Number(stack.cardRatio) <= 95,
    JSON.stringify({ cardWidth: stack.cardWidth, ratio: stack.cardRatio }),
  );
  check('mockup: de kaart is ±440 px hoog', Number(stack.cardHeight) >= 430 && Number(stack.cardHeight) <= 450, String(stack.cardHeight));
  check('mockup: er staat een tweede kaart achter de stapel', stack.ghostBehind, String(stack.ghostBehind));
  check(
    'mockup: de kaart toont restaurant, gerecht, prijs en beschrijving, in die volgorde',
    /kies-rest[\s\S]*kies-dish[\s\S]*kies-price[\s\S]*kies-desc/.test(stack.contentOrder),
    stack.contentOrder,
  );
  check(
    'mockup: naast "Gerecht 1 van 4" staat een dunne voortgangsbalk',
    stack.hasBar && stack.barWidth > 40 && /%$/.test(String(stack.fillShare)),
    JSON.stringify({ hasBar: stack.hasBar, width: stack.barWidth, fill: stack.fillShare }),
  );
  check(
    'mockup: twee knoppen naast elkaar van ±132 px breed en 56 px hoog, met een icoon',
    stack.buttons.length === 2
      && stack.buttons.every((button) => button.width >= 120 && button.width <= 140 && button.height >= 56 && button.icon),
    JSON.stringify(stack.buttons),
  );
  check(
    'mockup: "Lekker" heeft de primaire knopkleur, "Liever niet" een rand',
    stack.buttons.length === 2
      && stack.buttons[1].background === stack.primaryColor
      && stack.buttons[0].background !== stack.primaryColor,
    JSON.stringify({ primary: stack.primaryColor, buttons: stack.buttons.map((button) => button.background) }),
  );
  const undo = stack.undo;
  check(
    'mockup: "Vorige stem ongedaan maken" is een tekstlink met een terug-pijl',
    Boolean(undo)
      && undo.text === 'Vorige stem ongedaan maken'
      && undo.icon
      && /underline/.test(undo.underline)
      && undo.background === 'rgba(0, 0, 0, 0)'
      && undo.borderWidth === '0px'
      && undo.height >= 44,
    JSON.stringify(undo),
  );
  await shotInTheme(cdp, 'be46-stapel-390-light.png', 'light', 'stapel');
  await shotInTheme(cdp, 'be46-stapel-390-dark.png', 'dark', 'stapel');
  await setTheme(cdp, 'light');

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
  const top = result.rows[0] || { favourite: false, text: '' };
  check('route: de uitslag is een echte lijst', result.resultIsList, String(result.resultIsList));
  check('route: alle vier gerechten staan in de uitslag', result.rows.length === 4, String(result.rows.length));
  check('route: de favoriet staat bovenaan met "Favoriet"', top.favourite && /favoriet/i.test(top.text), top.text);
  check('route: de favoriet is "Fictieve pasta"', top.text.indexOf(FIXTURE_DISHES[0].name) >= 0, top.text);
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
  // De uitslag (mockup, scherm 6): per gerecht een balk met het aandeel "lekker".
  const stackAfter = await readStack(cdp);
  check(
    'mockup: elk gerecht in de uitslag heeft een balk met het aandeel "lekker"',
    stackAfter.resultBars.length === FIXTURE_DISHES.length
      && stackAfter.resultBars.every((width) => /^[0-9]+%$/.test(String(width)))
      && stackAfter.resultBars[0] === '100%',
    JSON.stringify(stackAfter.resultBars),
  );
  await shotInTheme(cdp, 'be46-uitslag-390-light.png', 'light', 'uitslag');

  // De stemmen van deze sessie, nog vóór de herlaadbeurt: de gestubde API
  // begint in een nieuwe pagina leeg, dus dit is het enige juiste moment.
  const calls = await callsOf(cdp);

  // Dezelfde uitslag in donker, ook vóór de herlaadbeurt: anders staat er in de
  // opname een lege uitslag (de stub kent de stemmen na een herlaadbeurt niet
  // meer) en dat is geen bruikbaar bewijs voor de mockup.
  const dark = await readState(cdp);
  check('route: de uitslag staat er ook in donker', dark.resultIsList && dark.rows.length === 4, String(dark.rows.length));
  await shotInTheme(cdp, 'be46-uitslag-390-dark.png', 'dark', 'uitslag');
  await setTheme(cdp, 'light');

  // De eigen stem is bewaard: opnieuw openen geeft meteen de uitslag.
  await cdp.send('Page.reload', { ignoreCache: false });
  const reopened = await waitFor(cdp, `Boolean(document.querySelector('ul.kies-uitslag'))`, 20000);
  check('route: opnieuw openen toont meteen de uitslag', reopened);

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
  await setViewport(cdp, 390, 900);
  await openFresh(cdp, '', 'light');
  await join(cdp, 'Sam');

  // Een opname terwijl de kaart vasthangt: het label staat op de kaart, in
  // licht én donker. 24% is onder de drempel, dus loslaten stemt hier niet.
  const held = await holdCard(cdp, 0.24);
  check('swipen: het label "Lekker →" staat op de kaart tijdens het slepen', Boolean(held) && (held.label || '').indexOf('Lekker') >= 0, held && held.label);
  await shotInTheme(cdp, 'be46-sleep-390-light.png', 'light', 'sleep-lekker');
  await shotInTheme(cdp, 'be46-sleep-390-dark.png', 'dark', 'sleep-lekker');
  await setTheme(cdp, 'light');
  if (held) await held.release();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterHold = await readState(cdp);
  check('swipen: onder de drempel blijft het eerste gerecht staan', afterHold.dish === FIXTURE_DISHES[0].name, afterHold.dish);

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

  await shotInTheme(cdp, 'be46-stapel-na-swipen-390-dark.png', 'dark', 'stapel-na-swipen');
  await setTheme(cdp, 'light');
}

/** De pijltjestoetsen doen hetzelfde als de knoppen. */
async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 780);
  await openFresh(cdp, '', 'light');
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
  await openFresh(cdp, '', 'light');
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
  await navigate(cdp, PAGE_URL('?zonder=migratie'), PAGE_READY);
  const ready = await waitFor(cdp, `(document.body.innerText || '').indexOf('Samen kiezen is nog niet beschikbaar') >= 0`, 20000);
  const state = await readState(cdp);
  check('zonder migratie: de pagina toont de ene melding', ready && state.unavailable, String(state.unavailable));
  check('zonder migratie: er is geen kaartenstapel', state.hasCard === false, String(state.hasCard));
  await shotInTheme(cdp, 'be46-zonder-migratie-390-light.png', 'light', 'zonder-migratie');
  await shotInTheme(cdp, 'be46-zonder-migratie-390-dark.png', 'dark', 'zonder-migratie');
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
      'niet machinaal te vergelijken: de goedgekeurde mockup is een extern Claude-artifact. De opnames in evidence/be-46/ zijn voor de visuele vergelijking door de Lead/eigenaar; elke opname heeft daarnaast themeProof (data-theme, de helderheid van de achtergrond en de actieve themaknop) en de gemeten maten van de kaart, de knoppen en de balken.',
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
  const ready = await waitFor(cdp, PAGE_READY, 120000);
  check('warm-up: de pagina en de gestubde API antwoorden', ready);
  await resetProgress(cdp);
}

// Elk scenario is één benoemde stap; `--alleen=<naam>` draait alleen die stap.
const KIES_SCENARIOS = [
  { name: 'maken', run: (cdp) => createScenario(cdp) },
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

