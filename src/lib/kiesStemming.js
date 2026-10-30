// BE-46 (#106) — samen kiezen: de rekenregels, zonder React, netwerk of DOM.
//
// Eén plek voor alles wat een stemming bepaalt:
//   - de grenzen uit het contract (maximaal 12 gerechten, 50 stemmers, een
//     roepnaam van hooguit 24 tekens, opruimen na 7 dagen);
//   - de code van een stemlink en het anonieme kenmerk van een stemmer, allebei
//     een willekeurige url-veilige waarde (16 bytes = 128 bit), nooit afgeleid
//     van een gerecht, een persoon of een teller;
//   - de gerechten van een stemming uit de echte statische data (naam, prijs,
//     restaurant, beschrijving), met de bestaande reserveerroutering (BE-07) en
//     dezelfde routelink als de menukaart;
//   - de uitslag en het sorteren: eerst de meeste "lekker", bij gelijkspel de
//     minste "liever niet", daarna de volgorde van de stemming;
//   - de teksten die het contract letterlijk noemt;
//   - het browserkenmerk en de eigen voortgang in `localStorage`, altijd in
//     try/catch: zonder opslag werkt de pagina gewoon, er wordt alleen niets
//     onthouden en dus niet meteen de uitslag getoond.
//
// Wat hier nooit langskomt: een IP-adres, een user agent, een account, een
// cookie of een sessie. Een stemming kent alleen een roepnaam, een anoniem
// browserkenmerk en de stemmen.
//
// Bewust CommonJS, zoals dishList.js en dishCounters.js: direct testbaar met
// `node --test`, zonder browser, React of Supabase.

'use strict';

const crypto = require('node:crypto');

const { dishCountLabel, dishIdOf, parseDishId, absoluteUrl } = require('./dishList');
const { dishSharePrice, normalizeShareTheme, withShareTheme } = require('./dishShare');
const { MISSING_STORAGE_CODES } = require('./dishCounters');

// De grenzen uit het contract (keuzes 30 oktober).
const KIES_MAX_DISHES = 12;
const KIES_MAX_STEMMERS = 50;
const KIES_ROEPNAAM_MAX = 24;
const KIES_RETENTION_DAYS = 7;
// 16 willekeurige bytes: 128 bit, 22 tekens base64url. Dezelfde ondergrens als
// de check op `code` en `stemmer` in supabase/migrations/0022 (22 respectievelijk
// 16 tekens).
const KIES_CODE_BYTES = 16;
const KIES_CODE_PATTERN = /^[A-Za-z0-9_-]{22,86}$/;
const KIES_STEMMER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// De ene route (server) en de ene pagina (stemlink) uit het contract.
const KIES_ENDPOINT = '/api/v1/kies';
const KIES_PAGE = '/kies';

// De opslagsleutels in dezelfde stijl als `bredaeats_bewaard` (BE-44).
const KIES_STEMMER_KEY = 'bredaeats_stemmer';
const KIES_PROGRESS_KEY = 'bredaeats_kies';

// De teksten uit het contract (criterium 2, 4, 5 en 6).
const KIES_LABEL = 'Samen kiezen';
const KIES_SLUIT_TITLE = 'Tot wanneer mag er gestemd worden?';
const KIES_SLUIT_HINT = 'Laat leeg als er geen sluitingstijd nodig is.';
const KIES_SLUIT_NONE_LABEL = 'Geen sluitingstijd';
const KIES_START_LABEL = 'Maak de stemlink';
const KIES_STARTED_MESSAGE = 'Stemlink gemaakt';
const KIES_OPEN_LINK_LABEL = 'Open de stemlink';
const KIES_NOT_AVAILABLE_MESSAGE = 'Samen kiezen is nog niet beschikbaar';
const KIES_CLOSED_MESSAGE = 'De stemming is gesloten';
const KIES_FULL_MESSAGE = 'Deze stemming heeft het maximum van 50 stemmers bereikt';
const KIES_ROEPNAAM_LABEL = 'Roepnaam';
const KIES_ROEPNAAM_HINT = 'Zo zie je je naam bij de stemmen. Maximaal 24 tekens.';
const KIES_JOIN_LABEL = 'Meedoen';
const KIES_LEKKER_LABEL = 'Lekker';
const KIES_LIEVER_NIET_LABEL = 'Liever niet';
const KIES_UNDO_LABEL = 'Vorige stem ongedaan maken';
const KIES_RESULT_TITLE = 'De uitslag';
const KIES_RESULT_FAVOURITE = 'Favoriet';
const KIES_RESERVE_LABEL = 'Reserveer';
const KIES_ROUTE_LABEL = 'Route';
const KIES_VOTED_MESSAGE = 'Je stem is opgeslagen';
const KIES_VOTE_FAILED_MESSAGE = 'Je stem is niet opgeslagen. Probeer het opnieuw.';
const KIES_EMPTY_RESULT_MESSAGE = 'Nog geen stemmen. Stem als eerste.';
const KIES_IMAGE_PREFIX = 'Kies mee:';

const PRICE_FALLBACK = 'op aanvraag';

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Base64url van willekeurige bytes: alleen A-Z, a-z, 0-9, - en _. */
function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function defaultRandom(count) {
  return crypto.randomBytes(count);
}

/** Een code voor een stemlink, of null als de bron geen echte bytes gaf. */
function generateKiesCode({ random = defaultRandom } = {}) {
  try {
    const code = base64url(random(KIES_CODE_BYTES));
    return KIES_CODE_PATTERN.test(code) ? code : null;
  } catch (error) {
    return null;
  }
}

/** De code zoals hij in een link staat, of null als het geen code is. */
function normalizeKiesCode(value) {
  const text = textOf(value);
  return KIES_CODE_PATTERN.test(text) ? text : null;
}

function isKiesCode(value) {
  return normalizeKiesCode(value) !== null;
}

/**
 * Het anonieme kenmerk van deze browser (localStorage), nooit het IP-adres.
 * Dezelfde vorm als de code, zodat de database hem met één check kan afwijzen
 * als hij niet willekeurig genoeg is.
 */
function generateStemmerId({ random = defaultRandom } = {}) {
  try {
    const id = base64url(random(KIES_CODE_BYTES));
    return KIES_STEMMER_PATTERN.test(id) ? id : null;
  } catch (error) {
    return null;
  }
}

function normalizeStemmer(value) {
  const text = textOf(value);
  return KIES_STEMMER_PATTERN.test(text) ? text : null;
}

/**
 * Een roepnaam: witruimte plat, hooguit 24 tekens. Leeg of te lang is geen
 * roepnaam — er wordt niet stil afgekapt, want dan zou iemand een andere naam
 * zien dan hij typte.
 */
function normalizeRoepnaam(value) {
  const text = textOf(value).split(/\s+/).filter(Boolean).join(' ');
  if (!text || text.length > KIES_ROEPNAAM_MAX) return null;
  return text;
}

/** Alleen een echte boolean telt: geen "ja", geen 1, geen lege waarde. */
function normalizeLekker(value) {
  return typeof value === 'boolean' ? value : null;
}

// ─── De gerechten van een stemming ──────────────────────────────────────────

/**
 * De id's van een stemming: 1 tot 12 geldige gerecht-id's, zonder dubbelen, in
 * de volgorde van de maker. Al het andere valt af; de aanroeper ziet hoeveel.
 */
function normalizeDishKeys(values) {
  const list = Array.isArray(values) ? values : [];
  const keys = [];
  const seen = new Set();
  let skipped = 0;
  for (const value of list) {
    const parsed = parseDishId(value);
    const id = parsed ? dishIdOf(parsed) : null;
    if (!id || seen.has(id) || keys.length >= KIES_MAX_DISHES) {
      skipped += 1;
      continue;
    }
    seen.add(id);
    keys.push(id);
  }
  return { dishKeys: keys, skipped };
}

/** De routelink van de menukaart (app/menu/[id]/MenuView.js): het adres in Maps. */
function mapsRouteHref(address) {
  const text = textOf(address);
  if (!text) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${text}, Breda`)}`;
}

/**
 * De gerechten van een stemming uit de echte statische data. Een id dat niet
 * (meer) bestaat wordt overgeslagen en geteld, net als bij het lijstje.
 *
 * `reservationFor(restaurant)` komt van buiten (src/lib/kiesRouteDeps.js) en is
 * de bestaande reserveerroutering (BE-07); dit bestand verzint er geen tweede.
 */
function resolveKiesDishes({ dishKeys, menus, restaurants, reservationFor } = {}) {
  const list = Array.isArray(dishKeys) ? dishKeys : [];
  const dishes = [];
  let skipped = 0;
  for (const raw of list) {
    const parsed = parseDishId(raw);
    const id = parsed ? dishIdOf(parsed) : null;
    const menu = parsed && menus ? menus[parsed.menuId] || null : null;
    const category = menu && Array.isArray(menu.categories) ? menu.categories[parsed.catIdx] : null;
    const item = category && Array.isArray(category.items) ? category.items[parsed.itemIdx] : null;
    const name = textOf(item && item.name);
    if (!id || !item || !name) {
      skipped += 1;
      continue;
    }
    const restaurant = (restaurants && restaurants[parsed.menuId.split('-')[0]]) || {};
    const restaurantName = textOf(restaurant.name) || textOf(menu.name);
    let reserve = null;
    if (typeof reservationFor === 'function') {
      try {
        reserve = reservationFor(restaurant) || null;
      } catch (error) {
        // Zonder reserveerroute blijft het gerecht staan; alleen de knop valt weg.
        reserve = null;
      }
    }
    dishes.push({
      id,
      menuId: parsed.menuId,
      catIdx: parsed.catIdx,
      itemIdx: parsed.itemIdx,
      name,
      price: dishSharePrice(item) || PRICE_FALLBACK,
      restaurant: restaurantName,
      description: textOf(item.desc),
      category: textOf(category.name),
      reserve,
      route: mapsRouteHref(restaurant.address),
    });
  }
  return { dishes, skipped };
}

// ─── De stemmen en de uitslag ───────────────────────────────────────────────

/** De stemmen van de database, zonder de velden die niemand nodig heeft. */
function normalizeVotes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const votes = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const stemmer = normalizeStemmer(row.stemmer);
    const roepnaam = normalizeRoepnaam(row.roepnaam);
    const dishKey = textOf(row.dish_key);
    const lekker = normalizeLekker(row.lekker);
    if (!stemmer || !roepnaam || !dishKey || lekker === null) continue;
    votes.push({ stemmer, roepnaam, dishKey, lekker, gestemdOp: textOf(row.gestemd_op) });
  }
  return votes;
}

/** Hoeveel verschillende stemmers er zijn (het maximum is 50). */
function stemmerCount(votes) {
  const list = Array.isArray(votes) ? votes : [];
  return new Set(list.map((vote) => vote && vote.stemmer).filter(Boolean)).size;
}

/** De stem van deze stemmer op dit gerecht, of null. */
function voteOf(votes, stemmer, dishKey) {
  const list = Array.isArray(votes) ? votes : [];
  return list.find((vote) => vote && vote.stemmer === stemmer && vote.dishKey === dishKey) || null;
}

/** De laatste stem van deze stemmer, of null. Voor "ongedaan maken". */
function lastVoteOf(votes, stemmer) {
  const list = (Array.isArray(votes) ? votes : []).filter((vote) => vote && vote.stemmer === stemmer);
  if (list.length === 0) return null;
  return list.reduce((last, vote) => (vote.gestemdOp >= last.gestemdOp ? vote : last));
}

/**
 * De uitslag: per gerecht het aantal "lekker" en "liever niet", met de
 * roepnamen erbij (die zijn zichtbaar, contract keuze).
 *
 * Sorteren (contract): eerst de meeste "lekker", bij gelijkspel de minste
 * "liever niet", daarna de volgorde waarin de maker de gerechten koos. Dat
 * laatste maakt de uitslag stabiel: twee keer lezen geeft dezelfde volgorde.
 */
function stemmingResult({ dishes, votes } = {}) {
  const list = Array.isArray(dishes) ? dishes : [];
  const normalized = Array.isArray(votes) ? votes : [];
  const rows = list.map((dish, index) => {
    const own = normalized.filter((vote) => vote.dishKey === dish.id);
    const lekker = own.filter((vote) => vote.lekker).length;
    const lieverNiet = own.length - lekker;
    return {
      ...dish,
      lekker,
      lieverNiet,
      kiezers: own.filter((vote) => vote.lekker).map((vote) => vote.roepnaam),
      lieverNietKiezers: own.filter((vote) => !vote.lekker).map((vote) => vote.roepnaam),
      index,
    };
  });
  rows.sort((a, b) => {
    if (b.lekker !== a.lekker) return b.lekker - a.lekker;
    if (a.lieverNiet !== b.lieverNiet) return a.lieverNiet - b.lieverNiet;
    return a.index - b.index;
  });
  return {
    uitslag: rows.map(({ index, ...row }) => row),
    stemmers: stemmerCount(normalized),
    stemmen: normalized.length,
  };
}

// ─── De sluitingstijd ───────────────────────────────────────────────────────

/**
 * Een sluitingstijd als ISO-tijdstip. `{ ok: true, value: null }` betekent
 * "geen sluitingstijd" (contract: optioneel); `ok: false` betekent dat er wel
 * iets is opgegeven maar dat het geen tijd is — dat is een fout van de maker,
 * geen stille "geen sluitingstijd".
 */
function parseSluitOm(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const text = textOf(value);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) return { ok: false, value: null };
  return { ok: true, value: new Date(time).toISOString() };
}

/**
 * De tijd die de maker in het blad koos ("18:00"): vandaag om die tijd, of
 * morgen als die tijd vandaag al voorbij is. Zo kan "tot 18:00" nooit in het
 * verleden liggen. Zonder geldige tijd: null, dus geen sluitingstijd.
 */
function sluitOmFromTime(value, now = Date.now) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(textOf(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const current = new Date(Number(now()));
  const target = new Date(current.getTime());
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= current.getTime()) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

/** Is deze stemming gesloten op dit moment? Zonder sluitingstijd nooit. */
function isStemmingClosed(stemming, at = Date.now()) {
  const sluitOm = stemming && stemming.sluitOm ? Date.parse(stemming.sluitOm) : NaN;
  if (!Number.isFinite(sluitOm)) return false;
  return sluitOm <= Number(at);
}

/** Een rij uit `kies_stemmingen` als `{ code, dishKeys, sluitOm, createdAt }`. */
function normalizeStemming(row) {
  if (!row || typeof row !== 'object') return null;
  const code = normalizeKiesCode(row.code);
  if (!code) return null;
  const keys = normalizeDishKeys(row.dish_keys !== undefined ? row.dish_keys : row.dishKeys);
  if (keys.dishKeys.length === 0) return null;
  const sluitOm = parseSluitOm(row.sluit_om !== undefined ? row.sluit_om : row.sluitOm);
  return {
    code,
    dishKeys: keys.dishKeys,
    sluitOm: sluitOm.ok ? sluitOm.value : null,
    createdAt: textOf(row.created_at !== undefined ? row.created_at : row.createdAt),
  };
}

// ─── Voortgang in de stapel ─────────────────────────────────────────────────

/** "Gerecht 2 van 4" — de tekst in `role="status"` (contract, criterium 6). */
function kiesProgressLabel(index, total) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  if (count === 0) return '';
  const current = Math.min(Math.max(0, Math.floor(Number(index) || 0)) + 1, count);
  return `Gerecht ${current} van ${count}`;
}

/**
 * Het eerste gerecht dat deze stemmer nog niet beoordeelde. Alles gehad: -1.
 * De volgorde van de stemming blijft de volgorde van de stapel.
 */
function nextDishIndex(dishes, votedKeys) {
  const list = Array.isArray(dishes) ? dishes : [];
  const voted = new Set(Array.isArray(votedKeys) ? votedKeys.map(textOf) : []);
  for (let index = 0; index < list.length; index += 1) {
    const dish = list[index];
    if (!dish || !dish.id || !voted.has(String(dish.id))) return index;
  }
  return -1;
}

// ─── De link, de voorvertoning en de fouten ─────────────────────────────────

/** De stemlink zelf: `/kies/<code>`, optioneel met de stand voor de preview. */
function kiesHref(code, theme) {
  const key = normalizeKiesCode(code);
  if (!key) return null;
  const href = `${KIES_PAGE}/${key}`;
  // Zonder stand blijft de link kaal: de stand hoort alleen bij een gedeelde
  // link (BE-44), niet bij het adres dat de maker zelf opent.
  return theme ? withShareTheme(href, theme) : href;
}

/** De voorvertoningsafbeelding van een stemlink. */
function kiesImageHref({ code, theme } = {}) {
  const key = normalizeKiesCode(code);
  if (!key) return null;
  const query = theme ? `?stand=${normalizeShareTheme(theme)}` : '';
  return `${KIES_PAGE}/${key}/share-image${query}`;
}

/** "Kies mee: 4 gerechten" — de kop van de voorvertoning (contract, criterium 4). */
function kiesImageTitle(count) {
  return `${KIES_IMAGE_PREFIX} ${dishCountLabel(count)}`;
}

/** De metadata van een stemlink, in de stijl van BE-44 (og:title, url, image). */
function kiesMetadata({ count, baseUrl, href, imageHref } = {}) {
  const hasCount = Number.isFinite(Number(count)) && Number(count) > 0;
  const title = hasCount ? kiesImageTitle(count) : 'Kies mee';
  const metadata = { title };
  if (baseUrl && /^https?:\/\//i.test(String(baseUrl))) {
    try {
      metadata.metadataBase = new URL(String(baseUrl));
    } catch (error) {
      // Geen geldige basis: dan geen metadataBase, geen gok.
    }
  }
  const openGraph = {
    title,
    locale: 'nl_NL',
    type: 'website',
    siteName: 'Onze Menukaarten',
  };
  const url = absoluteUrl(href, baseUrl);
  if (url) openGraph.url = url;
  const image = absoluteUrl(imageHref, baseUrl);
  if (image) openGraph.images = [{ url: image, width: 1200, height: 630, alt: title }];
  metadata.openGraph = openGraph;
  return metadata;
}

/**
 * Zegt deze fout dat de tabellen van 0022 nog niet bestaan? Dezelfde codes als
 * de tellers (BE-44): de app blijft dan werken en toont één nette melding.
 */
function isMissingKiesStorage(error) {
  if (!error) return false;
  const code = textOf(error.code).toUpperCase();
  if (MISSING_STORAGE_CODES.has(code)) return true;
  const message = textOf(error.message || error.details || error.hint);
  return /does not exist|schema cache/i.test(message);
}

// ─── De eigen voortgang in `localStorage` ───────────────────────────────────

function normalizeKiesProgress(value) {
  if (!value || typeof value !== 'object') return null;
  const stemmer = normalizeStemmer(value.stemmer);
  if (!stemmer) return null;
  const roepnaam = normalizeRoepnaam(value.roepnaam);
  const gestemd = Array.isArray(value.gestemd)
    ? [...new Set(value.gestemd.map(textOf).filter(Boolean))]
    : [];
  return { stemmer, roepnaam, gestemd };
}

function readKiesProgressMap(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(KIES_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

/** De eigen stand van deze stemming (roepnaam, kenmerk, gestemde gerechten). */
function readKiesProgress(storage, code) {
  const key = normalizeKiesCode(code);
  if (!key) return null;
  const map = readKiesProgressMap(storage);
  return normalizeKiesProgress(map[key]);
}

/**
 * Bewaren. Zonder opslag of met een fout blijft de pagina werken; er wordt dan
 * alleen niets onthouden en dus na het herladen opnieuw gevraagd.
 */
function writeKiesProgress(storage, code, progress) {
  const key = normalizeKiesCode(code);
  const value = normalizeKiesProgress(progress);
  if (!key || !value) return { ok: false, progress: value };
  if (!storage || typeof storage.setItem !== 'function') return { ok: false, progress: value };
  try {
    const map = readKiesProgressMap(storage);
    map[key] = value;
    storage.setItem(KIES_PROGRESS_KEY, JSON.stringify(map));
    return { ok: true, progress: value };
  } catch (error) {
    return { ok: false, progress: value };
  }
}

// ─── Swipen ─────────────────────────────────────────────────────────────────

// Een drempel van ±30% van de kaartbreedte (contract, criterium 5).
const SWIPE_THRESHOLD = 0.3;
// Vanaf deze afstand is de richting zichtbaar als label, ook vóór de drempel:
// de stemmer ziet meteen wat links en rechts betekent.
const SWIPE_CUE_PX = 8;

/**
 * De uitkomst van een sleep: 'lekker', 'liever-niet', of null zolang de drempel
 * niet gehaald is. `dx` en `width` zijn CSS-pixels; een onbekende breedte
 * (0 of geen getal) geeft nooit een keuze.
 */
function swipeOutcome({ dx, width, threshold = SWIPE_THRESHOLD } = {}) {
  const distance = Number(dx);
  const cardWidth = Number(width);
  const share = Math.abs(Number(threshold) || SWIPE_THRESHOLD);
  if (!Number.isFinite(distance) || !Number.isFinite(cardWidth) || cardWidth <= 0) return null;
  const limit = share * cardWidth;
  if (distance >= limit) return 'lekker';
  if (distance <= -limit) return 'liever-niet';
  return null;
}

/**
 * Wat de stemmer tijdens het slepen ziet: het label van de richting en of die
 * richting de drempel al haalt. Zonder beweging (`dx` 0): geen label.
 */
function swipeFeedback({ dx, width, threshold = SWIPE_THRESHOLD } = {}) {
  const distance = Number(dx);
  if (!Number.isFinite(distance) || Math.abs(distance) < SWIPE_CUE_PX) {
    return { label: null, direction: null, outcome: null };
  }
  const direction = distance > 0 ? 'lekker' : 'liever-niet';
  return {
    label: direction === 'lekker' ? `${KIES_LEKKER_LABEL} →` : `← ${KIES_LIEVER_NIET_LABEL}`,
    direction,
    outcome: swipeOutcome({ dx: distance, width, threshold }),
  };
}

module.exports = {
  KIES_CLOSED_MESSAGE,
  KIES_CODE_BYTES,
  KIES_CODE_PATTERN,
  KIES_EMPTY_RESULT_MESSAGE,
  KIES_ENDPOINT,
  KIES_FULL_MESSAGE,
  KIES_IMAGE_PREFIX,
  KIES_JOIN_LABEL,
  KIES_LABEL,
  KIES_LEKKER_LABEL,
  KIES_LIEVER_NIET_LABEL,
  KIES_MAX_DISHES,
  KIES_MAX_STEMMERS,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_OPEN_LINK_LABEL,
  KIES_PAGE,
  KIES_PROGRESS_KEY,
  KIES_RESERVE_LABEL,
  KIES_RESULT_FAVOURITE,
  KIES_RESULT_TITLE,
  KIES_RETENTION_DAYS,
  KIES_ROEPNAAM_HINT,
  KIES_ROEPNAAM_LABEL,
  KIES_ROEPNAAM_MAX,
  KIES_ROUTE_LABEL,
  KIES_SLUIT_HINT,
  KIES_SLUIT_NONE_LABEL,
  KIES_SLUIT_TITLE,
  KIES_STARTED_MESSAGE,
  KIES_START_LABEL,
  KIES_STEMMER_KEY,
  KIES_STEMMER_PATTERN,
  KIES_UNDO_LABEL,
  KIES_VOTED_MESSAGE,
  KIES_VOTE_FAILED_MESSAGE,
  SWIPE_CUE_PX,
  SWIPE_THRESHOLD,
  generateKiesCode,
  generateStemmerId,
  isKiesCode,
  isMissingKiesStorage,
  isStemmingClosed,
  kiesHref,
  kiesImageHref,
  kiesImageTitle,
  kiesMetadata,
  kiesProgressLabel,
  lastVoteOf,
  mapsRouteHref,
  nextDishIndex,
  normalizeDishKeys,
  normalizeKiesCode,
  normalizeLekker,
  normalizeRoepnaam,
  normalizeStemmer,
  normalizeStemming,
  normalizeVotes,
  parseSluitOm,
  readKiesProgress,
  resolveKiesDishes,
  sluitOmFromTime,
  stemmerCount,
  stemmingResult,
  swipeFeedback,
  swipeOutcome,
  voteOf,
  writeKiesProgress,
};
