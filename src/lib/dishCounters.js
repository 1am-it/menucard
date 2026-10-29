// BE-44 (#105, criterium 5) — de anonieme tellers van een gerecht.
//
// Eén plek voor alles wat een teller bepaalt, aan beide kanten van de lijn:
//   - de drie gebeurtenissen (`gedeeld`, `bewaard`, `reserveren`) en niets
//     anders — dezelfde woorden als de controle in de databasefunctie;
//   - de vorm van een telverzoek: exact `{ dish, event }`, geen cookie, geen
//     eigen id en niets anders dat een bezoeker zou kunnen identificeren;
//   - het opzoeken van een gerecht in de echte menukaarten (dezelfde id-vorm
//     als de BE-12-deeplink en het BE-29-anker), zodat een onbekend of
//     verdwenen gerecht nooit geteld wordt;
//   - de limiet van één verzoek per seconde per gerecht en gebeurtenis, in
//     geheugen (één serverinstantie is genoeg, Lead-ontwerp);
//   - de browserkant: fire-and-forget, zonder await en zonder dat een fout
//     ooit zichtbaar wordt of een knop breekt.
//
// Er wordt hier niets getoond: de tellers hebben (nog) geen weergave. Dat is
// een apart ticket; dit bestand schrijft alleen.
//
// Bewust CommonJS, zoals dishList.js en dishShare.js: direct testbaar met
// `node --test`, zonder browser, React of netwerk.

'use strict';

const { dishIdOf, parseDishId } = require('./dishList');

// De route uit de opdracht (POST). Eén letterlijke waarde, zodat de browser en
// de server het niet uit elkaar kunnen lopen.
const DISH_COUNTER_ENDPOINT = '/api/v1/tellers';
// De naam van de databasefunctie uit supabase/migrations/0021_be44_dish_counters.sql.
const DISH_COUNTER_FUNCTION = 'increment_dish_counter';

// Precies de drie gebeurtenissen uit het contract (criterium 5). De database
// accepteert geen vierde; deze lijst is de client- en serverkant daarvan.
const SHARED_EVENT = 'gedeeld';
const SAVED_EVENT = 'bewaard';
const RESERVATION_EVENT = 'reserveren';
const DISH_COUNTER_EVENTS = [SHARED_EVENT, SAVED_EVENT, RESERVATION_EVENT];

// Eén verzoek per seconde per gerecht en gebeurtenis (Lead-ontwerp).
const COUNTER_THROTTLE_MS = 1000;
// Een telverzoek is klein; alles groter is geen telverzoek.
const COUNTER_MAX_BODY_BYTES = 1024;
// De databasefunctie is één upsert. Duurt hij langer, dan telt deze aanvraag
// niet mee — de knop wacht nooit op de teller.
const COUNTER_TIMEOUT_MS = 2000;
// De kolom `dish_key` in de migratie staat 3 tot 96 tekens toe.
const DISH_KEY_MAX_LENGTH = 96;

// De codes waarmee Postgres en PostgREST zeggen dat de tabel of de functie nog
// niet bestaat: de migratie is dan nog niet toegepast (eigenaarsbesluit 28
// oktober: het bestand gaat mee, de eigenaar past het na de merge toe). De
// teller stopt dan stil en probeert het in deze instantie niet opnieuw.
const MISSING_STORAGE_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const NO_CONTENT = { status: 204, body: null };

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** De gebeurtenis zoals de database hem kent, of null voor al het andere. */
function normalizeCounterEvent(value) {
  const text = textOf(value).toLowerCase();
  return DISH_COUNTER_EVENTS.includes(text) ? text : null;
}

function isCounterEvent(value) {
  return normalizeCounterEvent(value) !== null;
}

/**
 * De canonieke gerecht-id (`<menukaart>-<categorie>-<gerecht>`), of null.
 * Dezelfde vorm en dezelfde lezer als het lijstje (dishList.parseDishId): één
 * id-vorm voor de deeplink, het anker, de opslag en de teller.
 */
function normalizeDishKey(value) {
  const parsed = parseDishId(value);
  const id = parsed ? dishIdOf(parsed) : null;
  if (!id || id.length > DISH_KEY_MAX_LENGTH) return null;
  return id;
}

/**
 * De inhoud van een telverzoek: alleen `dish` en `event`. Alles wat een caller
 * er verder bij zet, valt weg — er gaat nooit een gebruikers-id, cookie of
 * ander identificerend veld mee, ook niet per ongeluk.
 */
function counterBody({ dish, event } = {}) {
  const dishKey = normalizeDishKey(dish);
  const name = normalizeCounterEvent(event);
  if (!dishKey || !name) return null;
  return { dish: dishKey, event: name };
}

/**
 * Het gerecht achter een id, uit de echte menukaarten. Onbekende menukaarten,
 * categorieën en gerechten geven null: er wordt dan niets geteld. Dezelfde
 * controle als de deeplink (BE-12) en het lijstje (resolveListDishes), zonder
 * een naam of rubriek uit de client te vertrouwen.
 */
function resolveCounterDish(value, menus) {
  const dishKey = normalizeDishKey(value);
  if (!dishKey) return null;
  const parsed = parseDishId(dishKey);
  const menu = (menus && menus[parsed.menuId]) || null;
  const category = menu && Array.isArray(menu.categories) ? menu.categories[parsed.catIdx] : null;
  const item = category && Array.isArray(category.items) ? category.items[parsed.itemIdx] : null;
  if (!item || typeof item !== 'object') return null;
  return {
    dishKey,
    menuId: parsed.menuId,
    catIdx: parsed.catIdx,
    itemIdx: parsed.itemIdx,
    name: textOf(item.name),
    category: textOf(category.name),
  };
}

/**
 * De geheugenlimiet: één verzoek per seconde per gerecht en gebeurtenis. Een
 * tweede verzoek binnen dat venster telt niet mee en is geen fout. De sleutel
 * is (gerecht, gebeurtenis), dus delen en bewaren staan elkaar niet in de weg.
 */
function createCounterLimiter({ windowMs = COUNTER_THROTTLE_MS, now = Date.now } = {}) {
  const lastSeen = new Map();
  const window = Number(windowMs) > 0 ? Number(windowMs) : COUNTER_THROTTLE_MS;

  function prune(current) {
    // Een lange sessie mag geen onbegrensde map achterlaten: alles buiten het
    // venster is toch vergeten.
    for (const [key, seenAt] of lastSeen) {
      if (current - seenAt >= window) lastSeen.delete(key);
    }
  }

  return {
    /** Mag deze (gerecht, gebeurtenis) nu geteld worden? */
    allow(dishKey, event) {
      const dish = normalizeDishKey(dishKey);
      const name = normalizeCounterEvent(event);
      if (!dish || !name) return false;
      const current = Number(now());
      prune(current);
      const key = `${dish}|${name}`;
      const previous = lastSeen.get(key);
      if (previous !== undefined && current - previous < window) return false;
      lastSeen.set(key, current);
      return true;
    },
    /** Alleen voor tests en diagnostics: hoeveel sleutels onthoudt hij nu? */
    size() {
      return lastSeen.size;
    },
  };
}

/**
 * De teller vanuit de browser: fire-and-forget. De caller wacht niet en de
 * uitkomst is nooit zichtbaar. Een ontbrekende fetch, een netwerkfout, een
 * time-out of een 500 geven allemaal `false` en laten de knop met rust.
 */
function sendDishCounter({ fetchRef, dish, event } = {}) {
  const body = counterBody({ dish, event });
  if (!body) return Promise.resolve(false);
  const doFetch = typeof fetchRef === 'function'
    ? fetchRef
    : (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return Promise.resolve(false);
  try {
    const pending = doFetch(DISH_COUNTER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Geen cookie, geen herkomst en geen wachttijd: de teller is anoniem.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      keepalive: true,
    });
    return Promise.resolve(pending).then(() => true, () => false);
  } catch (error) {
    return Promise.resolve(false);
  }
}

/** Zegt deze fout dat de tabel of functie nog niet bestaat? */
function isMissingCounterStorage(error) {
  if (!error) return false;
  const code = textOf(error.code).toUpperCase();
  if (MISSING_STORAGE_CODES.has(code)) return true;
  const message = textOf(error.message || error.details || error.hint);
  return /does not exist|schema cache/i.test(message);
}

/** Een belofte met een bovengrens; een time-out is een gewone afwijzing. */
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    // Bewust geen unref: deze timer is de enige garantie dat de route ooit
    // antwoordt, ook als de database nooit terugkomt.
    const timer = setTimeout(() => reject(new Error('dish_counter_timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

module.exports = {
  COUNTER_MAX_BODY_BYTES,
  COUNTER_THROTTLE_MS,
  COUNTER_TIMEOUT_MS,
  DISH_COUNTER_ENDPOINT,
  DISH_COUNTER_EVENTS,
  DISH_COUNTER_FUNCTION,
  DISH_KEY_MAX_LENGTH,
  MISSING_STORAGE_CODES,
  NO_CONTENT,
  RESERVATION_EVENT,
  SAVED_EVENT,
  SHARED_EVENT,
  counterBody,
  createCounterLimiter,
  isCounterEvent,
  isMissingCounterStorage,
  normalizeCounterEvent,
  normalizeDishKey,
  resolveCounterDish,
  sendDishCounter,
  withTimeout,
};
