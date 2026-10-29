// BE-44 (#105, criterium 4) — het lijstje: bewaren, tonen, delen.
//
// Eén plek voor alles wat het lijstje bepaalt:
//   - de vorm van een bewaard gerecht (`entry`) en de id die erbij hoort
//     (`<menukaart>-<categorie>-<gerecht>`, dezelfde id als het BE-29-anker);
//   - de opslag in de browser (`localStorage`, altijd in try/catch: zonder
//     opslag werkt de pagina gewoon, er wordt alleen niets onthouden);
//   - de gedeelde lijstlink (de id's in de URL, geen opslag op de server);
//   - het limiet van 20 en het stil overslaan van onbekende of verdwenen id's,
//     met een telling voor de pagina;
//   - de teksten die het contract letterlijk noemt.
//
// Geen account, geen server, geen identiteit: het lijstje bestaat alleen in de
// browser van wie het maakt. De gedeelde link draagt hooguit de id's.
//
// Bewust CommonJS, zoals dishDeepLink.js en dishShare.js: direct testbaar met
// `node --test`, zonder browser of React.

'use strict';

const { buildDishDeepLink } = require('./dishDeepLink');
const { dishSharePrice, normalizeShareTheme, withShareTheme } = require('./dishShare');

// Opslagsleutel in dezelfde stijl als `bredaeats_theme` (app/layout.js).
const SAVED_LIST_KEY = 'bredaeats_bewaard';
const SAVED_LIST_LIMIT = 20;
// De gedeelde lijst staat op de eigen pagina, met de id's in de URL.
const LIST_PARAM = 'lijst';
const LIST_PAGE = '/mijn-lijstje';
// Een eigen event, zodat de knop, de onderbalk en de lijstpagina dezelfde stand
// zien zonder dat er een tweede bron van waarheid ontstaat.
const SAVED_LIST_EVENT = 'bredaeats:bewaard';

// Letterlijk de teksten uit het contract (criterium 4).
const SAVE_LABEL = 'Bewaren';
const SAVED_LABEL = 'Bewaard';
const LIST_SHARE_LABEL = 'Lijstje delen';
const SHARED_LIST_HEADING = 'Gedeeld lijstje';
const ADD_TO_OWN_LIST_LABEL = 'Zet ze op mijn eigen lijstje';
const REMOVE_LABEL = 'Verwijderen';
const VIEW_LIST_LABEL = 'Bekijken →';
const NOT_AVAILABLE_MESSAGE = 'Niet meer beschikbaar';

// De og:image van het lijstje toont hooguit vier regels en zegt hoeveel er
// daarna nog komen; een lijstje van 20 past nooit leesbaar op 1200 × 630.
const LIST_IMAGE_MAX_ROWS = 4;

const PRICE_FALLBACK = 'op aanvraag';

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/**
 * De id van een bewaard gerecht: `<menukaart>-<categorie>-<gerecht>`.
 * Alleen die vorm is geldig; al het andere is geen gerecht-id. De menukaart
 * bestaat uit stukken zonder lege streepjes (`6-diner`), de positie uit twee
 * getallen.
 */
function parseDishId(value) {
  const text = textOf(value);
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d+)-(\d+)$/i.exec(text);
  if (!match) return null;
  return { menuId: match[1], catIdx: Number(match[2]), itemIdx: Number(match[3]) };
}

/** De canonieke id van een positie in een menukaart. */
function dishIdOf({ menuId, catIdx, itemIdx } = {}) {
  const menu = textOf(menuId);
  const cat = Number(catIdx);
  const item = Number(itemIdx);
  if (!menu || !Number.isInteger(cat) || !Number.isInteger(item) || cat < 0 || item < 0) return null;
  return `${menu}-${cat}-${item}`;
}

/** Eén bewaard gerecht, uit echte menukaartdata. */
function buildEntry({ menuId, catIdx, itemIdx, item, category, restaurantName } = {}) {
  const id = dishIdOf({ menuId, catIdx, itemIdx });
  const name = textOf(item && item.name);
  if (!id || !name) return null;
  return {
    id,
    menuId: textOf(menuId),
    catIdx: Number(catIdx),
    itemIdx: Number(itemIdx),
    name,
    category: textOf(category),
    price: dishSharePrice(item),
    restaurant: textOf(restaurantName),
  };
}

/**
 * Een opgeslagen of uit de URL gelezen waarde weer bruikbaar maken. Een entry
 * zonder geldige id of zonder naam is geen gerecht: die telt als overgeslagen.
 */
function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const parsed = parseDishId(value.id);
  const name = textOf(value.name);
  if (!parsed || !name) return null;
  return {
    id: dishIdOf(parsed),
    menuId: parsed.menuId,
    catIdx: parsed.catIdx,
    itemIdx: parsed.itemIdx,
    name,
    category: textOf(value.category),
    price: textOf(value.price) || PRICE_FALLBACK,
    restaurant: textOf(value.restaurant),
  };
}

/** Een lijst zonder dubbelen, zonder ongeldige waarden en met hooguit 20. */
function normalizeEntries(values) {
  const list = Array.isArray(values) ? values : [];
  const entries = [];
  const seen = new Set();
  for (const value of list) {
    const entry = normalizeEntry(value);
    if (!entry || seen.has(entry.id)) continue;
    if (entries.length >= SAVED_LIST_LIMIT) break;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

/**
 * De id's van een lijstje, in dezelfde volgorde, zonder dubbelen. Accepteert
 * zowel bewaarde gerechten (`entry`) als losse id's: de pagina heeft op de
 * server alleen de id's van de gedeelde link, de lijstpagina heeft de hele
 * bewaarde gerechten.
 */
function dishIds(values) {
  const list = Array.isArray(values) ? values : [];
  const ids = [];
  const seen = new Set();
  for (const value of list) {
    const parsed = typeof value === 'string' ? parseDishId(value) : parseDishId(value && value.id);
    const id = parsed ? dishIdOf(parsed) : null;
    if (!id || seen.has(id)) continue;
    if (ids.length >= SAVED_LIST_LIMIT) break;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * De id's voor in de URL: komma's, geen andere opmaak. Zonder id's is er geen
 * link (dan is er niets te delen).
 */
function encodeListParam(values) {
  const ids = dishIds(values);
  return ids.length ? ids.join(',') : null;
}

/**
 * De id's uit de URL. Ongeldige id's, dubbelen en alles boven het limiet van 20
 * worden overgeslagen en geteld: de pagina zegt eerlijk hoeveel dat er waren.
 */
function decodeListParam(value) {
  const raw = textOf(value);
  if (!raw) return { ids: [], skipped: 0 };
  const ids = [];
  const seen = new Set();
  let skipped = 0;
  for (const part of raw.split(',')) {
    const parsed = parseDishId(part);
    const id = parsed ? dishIdOf(parsed) : null;
    if (!id || seen.has(id) || ids.length >= SAVED_LIST_LIMIT) {
      if (textOf(part)) skipped += 1;
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return { ids, skipped };
}

/** Bewaren of juist niet meer bewaren. */
function toggleEntry(entries, entry) {
  const current = normalizeEntries(entries);
  const normalized = normalizeEntry(entry);
  if (!normalized) return { entries: current, saved: false, changed: false };
  const exists = current.some((candidate) => candidate.id === normalized.id);
  const next = exists
    ? current.filter((candidate) => candidate.id !== normalized.id)
    : normalizeEntries([...current, normalized]);
  return { entries: next, saved: !exists, changed: true };
}

/** Alles van een gedeeld lijstje in één keer op het eigen lijstje zetten. */
function addEntries(entries, additions) {
  const current = normalizeEntries(entries);
  const merged = normalizeEntries([...current, ...(Array.isArray(additions) ? additions : [])]);
  return { entries: merged, added: merged.length - current.length };
}

// ─── Opslag: alleen de browser, en nooit een harde fout ──────────────────────

/**
 * `localStorage`, of null als er geen venster is of de browser hem weigert
 * (privémodus, beleid). Alle lezers en schrijvers hieronder accepteren null.
 */
function safeBrowserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (error) {
    return null;
  }
}

/** Lezen. Zonder opslag, met een fout of met kapotte JSON: een leeg lijstje. */
function readSavedList(storage) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(SAVED_LIST_KEY);
    if (!raw) return [];
    return normalizeEntries(JSON.parse(raw));
  } catch (error) {
    return [];
  }
}

/**
 * Schrijven. De knop en de pagina blijven werken als dit niet lukt; het verschil
 * is alleen dat het lijstje de volgende keer leeg is.
 */
function writeSavedList(storage, entries) {
  const normalized = normalizeEntries(entries);
  if (!storage || typeof storage.setItem !== 'function') return { ok: false, entries: normalized };
  try {
    storage.setItem(SAVED_LIST_KEY, JSON.stringify(normalized));
    return { ok: true, entries: normalized };
  } catch (error) {
    return { ok: false, entries: normalized };
  }
}

/** De knop "Bewaren"/"Bewaard": de stand komt altijd uit de opslag zelf. */
function toggleSavedDish(storage, entry) {
  const current = readSavedList(storage);
  const result = toggleEntry(current, entry);
  if (!result.changed) return { saved: false, entries: current, ok: false };
  const written = writeSavedList(storage, result.entries);
  return { saved: result.saved, entries: written.entries, ok: written.ok };
}

/** Een gedeeld lijstje overnemen op het eigen lijstje. */
function addSavedDishes(storage, entries) {
  const current = readSavedList(storage);
  const result = addEntries(current, entries);
  const written = writeSavedList(storage, result.entries);
  return { entries: written.entries, added: result.added, ok: written.ok };
}

function isDishSaved(storage, id) {
  const parsed = parseDishId(id);
  if (!parsed) return false;
  return readSavedList(storage).some((entry) => entry.id === dishIdOf(parsed));
}

// ─── De gedeelde lijstlink en de gegevens erachter ───────────────────────────

/** De link naar het gedeelde lijstje, met de stand van de deler erbij. */
function listShareHref({ values, theme } = {}) {
  const encoded = encodeListParam(values);
  if (!encoded) return null;
  // `withShareTheme` houdt de komma's van de id's leesbaar (geen %2C).
  return withShareTheme(`${LIST_PAGE}?${LIST_PARAM}=${encoded}`, theme);
}

/** Het adres van de voorvertoningsafbeelding (1200 × 630) van het lijstje. */
function listShareImageHref({ values, theme } = {}) {
  const encoded = encodeListParam(values);
  if (!encoded) return null;
  return `${LIST_PAGE}/share-image?${LIST_PARAM}=${encoded}&stand=${normalizeShareTheme(theme)}`;
}

/** De link van één gerecht uit het lijstje: dezelfde BE-12-deeplink. */
function listDishHref(entry, theme) {
  const parsed = parseDishId(entry && entry.id);
  if (!parsed || !entry.name || !entry.category) return null;
  const link = buildDishDeepLink({
    menuLink: `/menu/${parsed.menuId}`,
    dishId: dishIdOf(parsed),
    name: entry.name,
    category: entry.category,
  });
  if (!link) return null;
  return withShareTheme(link, theme);
}

/**
 * De id's uit een gedeelde link opzoeken in de echte menukaarten. Een id dat
 * niet (meer) bestaat wordt stil overgeslagen en geteld.
 */
function resolveListDishes({ ids, menus, restaurants } = {}) {
  const list = Array.isArray(ids) ? ids : [];
  const dishes = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of list) {
    const parsed = parseDishId(raw);
    const id = parsed ? dishIdOf(parsed) : null;
    if (!id || seen.has(id) || dishes.length >= SAVED_LIST_LIMIT) {
      skipped += 1;
      continue;
    }
    const menu = (menus && menus[parsed.menuId]) || null;
    const category = menu && Array.isArray(menu.categories) ? menu.categories[parsed.catIdx] : null;
    const item = category && Array.isArray(category.items) ? category.items[parsed.itemIdx] : null;
    if (!item) {
      skipped += 1;
      continue;
    }
    const restaurant = (restaurants && restaurants[parsed.menuId.split('-')[0]]) || {};
    const entry = buildEntry({
      menuId: parsed.menuId,
      catIdx: parsed.catIdx,
      itemIdx: parsed.itemIdx,
      item,
      category: category.name,
      restaurantName: restaurant.name || menu.name,
    });
    if (!entry) {
      skipped += 1;
      continue;
    }
    seen.add(id);
    dishes.push(entry);
  }
  return { dishes, skipped };
}



// ─── Teksten en de voorvertoning ─────────────────────────────────────────────

function dishCountLabel(count) {
  const n = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${n} ${n === 1 ? 'gerecht' : 'gerechten'}`;
}

/** "<n> bewaard" voor de onderbalk op de menupagina. */
function savedBarLabel(count) {
  return `${Number(count) || 0} ${SAVED_LABEL.toLowerCase()}`;
}

/** "Gedeeld lijstje · <n> gerechten" voor de ontvanger. */
function sharedListHeading(count) {
  return `${SHARED_LIST_HEADING} · ${dishCountLabel(count)}`;
}

/** "<n> gerechten om uit te kiezen" — de kop van de voorvertoning van het lijstje. */
function listImageTitle(count) {
  return `${dishCountLabel(count)} om uit te kiezen`;
}

/** De regels op de voorvertoning: hooguit vier, met een telling voor de rest. */
function listImageRows(entries) {
  const list = normalizeEntries(entries);
  return {
    rows: list.slice(0, LIST_IMAGE_MAX_ROWS),
    more: Math.max(list.length - LIST_IMAGE_MAX_ROWS, 0),
  };
}

/** De restaurants van een lijstje, zonder dubbelen, voor de og:description. */
function listRestaurants(entries) {
  const names = [];
  for (const entry of normalizeEntries(entries)) {
    if (entry.restaurant && !names.includes(entry.restaurant)) names.push(entry.restaurant);
  }
  return names;
}

/** Een relatieve link absoluut maken; zonder basis blijft hij relatief. */
function absoluteUrl(href, baseUrl) {
  if (!href) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(String(href))) return String(href);
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  return `${base}${String(href).startsWith('/') ? '' : '/'}${href}`;
}

/**
 * De metadata van een gedeeld lijstje: eigen titel, beschrijving met de
 * restaurants, og:url en de voorvertoningsafbeelding van het lijstje.
 */
function listShareMetadata({ count, entries, baseUrl, href, imageHref } = {}) {
  const title = listImageTitle(count);
  const restaurants = listRestaurants(entries);
  const description = restaurants.length ? `${title} — ${restaurants.join(', ')}` : title;
  const metadata = { title, description };
  if (baseUrl && /^https?:\/\//i.test(String(baseUrl))) {
    try {
      metadata.metadataBase = new URL(String(baseUrl));
    } catch (error) {
      // Geen geldige basis: dan geen metadataBase, geen gok.
    }
  }
  const openGraph = {
    title,
    description,
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

module.exports = {
  ADD_TO_OWN_LIST_LABEL,
  LIST_IMAGE_MAX_ROWS,
  LIST_PAGE,
  LIST_PARAM,
  LIST_SHARE_LABEL,
  NOT_AVAILABLE_MESSAGE,
  REMOVE_LABEL,
  SAVED_LABEL,
  SAVED_LIST_EVENT,
  SAVED_LIST_KEY,
  SAVED_LIST_LIMIT,
  SAVE_LABEL,
  SHARED_LIST_HEADING,
  VIEW_LIST_LABEL,
  absoluteUrl,
  addEntries,
  addSavedDishes,
  buildEntry,
  decodeListParam,
  dishCountLabel,
  dishIdOf,
  dishIds,
  encodeListParam,
  isDishSaved,
  listDishHref,
  listImageRows,
  listImageTitle,
  listRestaurants,
  listShareHref,
  listShareImageHref,
  listShareMetadata,
  normalizeEntries,
  normalizeEntry,
  parseDishId,
  readSavedList,
  resolveListDishes,
  safeBrowserStorage,
  savedBarLabel,
  sharedListHeading,
  toggleEntry,
  toggleSavedDish,
  writeSavedList,
};
