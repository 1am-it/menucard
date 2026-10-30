'use strict';

// BE-57 (#139, deel 1) — de cijfers van "Mijn restaurant", als één geteste
// beslissing.
//
// Deze module kent geen Supabase, geen React, geen netwerk en geen klok: ze
// rekent met rijen die de houderstatistieken al hebben opgehaald. Ze levert:
//   - "Deze week" tegenover "vorige week", in UTC-dagen (7 + 7, vandaag
//     meegerekend), per restaurant;
//   - de top 4 van gerechten die het meest opvallen (bekeken + bewaard +
//     gedeeld tellen samen op);
//   - de privacydrempel: elk getal onder 5 verschijnt als "minder dan 5";
//   - de stand "nog geen cijfers" voor als de migratie (0024) nog niet is
//     toegepast of er nog niets geteld is.
//
// Wat "keer favoriet in Samen kiezen" is (contract, punt 1, eigen keuze):
// kies_stemmen (0022) kent per stem alleen `lekker` (true) of `liever niet`
// (false); er is geen "winnaar per stemming" en geen favorietmarkering. Het
// aantal keer dat een gerecht "als favoriet eindigde" is dus niet betrouwbaar
// af te leiden, het aantal "lekker"-stemmen wel. Daarom telt deze module de
// `lekker`-stemmen op de gerechten van dít restaurant. Dat is precies de
// terugvaloptie die het contract noemt, en het is de enige die de bestaande
// gegevens echt opleveren.
//
// Alleen totalen: geen enkel getal is te herleiden tot een gast. Een verschil
// met vorige week wordt daarom alleen getoond als beide weken de drempel halen;
// anders blijft het bij "te weinig gegevens om te vergelijken".

const { parseDishId } = require('./dishList');

// De privacydrempel uit het contract: elk getal onder 5 wordt "minder dan 5".
const MINIMUM_VISIBLE = 5;
const UNDER_MINIMUM_LABEL = 'minder dan 5';
const COMPARE_UNAVAILABLE_LABEL = 'te weinig gegevens om te vergelijken';
const NO_DATA_MESSAGE = 'Nog geen cijfers.';
const NO_DATA_STATUS = 'geen-cijfers';
const READY_STATUS = 'cijfers';

// Zeven dagen, vandaag meegerekend, in UTC — dezelfde daggrens als de tellers.
const WEEK_DAYS = 7;
// De top 4 uit het contract.
const TOP_LIMIT = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

// De labels van de vier cijfers van "Deze week". `key` is het veld van
// periodTotals; `id` is de naam die het scherm en de API gebruiken.
const WEEK_METRICS = [
  { id: 'bekeken', key: 'viewed', label: 'keer bekeken' },
  { id: 'bewaard', key: 'saved', label: 'keer bewaard' },
  { id: 'gedeeld', key: 'shared', label: 'keer gedeeld' },
  { id: 'favoriet', key: 'favourite', label: 'keer favoriet in Samen kiezen' },
];
const WEEK_METRIC_IDS = WEEK_METRICS.map((metric) => metric.id);

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Een teller is een niet-negatief geheel getal; al het andere telt als 0. */
function countOf(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/** De UTC-dag als `YYYY-MM-DD`, of null. */
function utcDayOf(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return date.toISOString().slice(0, 10);
}

/** De UTC-dag `daysAgo` dagen vóór `day` (`YYYY-MM-DD`), of null. */
function shiftDay(day, daysAgo) {
  const text = textOf(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * De twee periodes van "Deze week": de laatste zeven UTC-dagen (vandaag
 * meegerekend) en de zeven daarvoor. `{ week: {van, tot}, vorigeWeek: {van, tot} }`.
 */
function weekWindow(now = new Date()) {
  const today = utcDayOf(now);
  if (!today) return { week: { van: null, tot: null }, vorigeWeek: { van: null, tot: null } };
  return {
    week: { van: shiftDay(today, WEEK_DAYS - 1), tot: today },
    vorigeWeek: { van: shiftDay(today, WEEK_DAYS * 2 - 1), tot: shiftDay(today, WEEK_DAYS) },
  };
}

/** Haalt dit aantal de privacydrempel? */
function isVisibleCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= MINIMUM_VISIBLE;
}

/** Het getal zoals het scherm het toont: het aantal, of "minder dan 5". */
function formatCount(value) {
  const number = countOf(value);
  return isVisibleCount(number) ? String(number) : UNDER_MINIMUM_LABEL;
}

/**
 * Het restaurant van een gerecht-id: de menukaart-id `<restaurant>-<maaltijd>`
 * zonder de maaltijd (`6-diner-0-0` → `6`). Onbekend of ongeldig: null.
 */
function restaurantOfDishKey(dishKey) {
  const parsed = parseDishId(dishKey);
  if (!parsed) return null;
  const restaurant = textOf(parsed.menuId).split('-')[0];
  return /^[a-z0-9]{1,24}$/.test(restaurant) ? restaurant : null;
}

/** Ligt deze UTC-dag in het venster (grenzen meegerekend)? */
function dayInRange(day, range) {
  const text = textOf(day);
  if (!range || !range.van || !range.tot || !text) return false;
  return text >= range.van && text <= range.tot;
}

/**
 * Telt de tellerrijen van één periode op, per gerecht.
 * `viewed` bestaat (nog) niet per gerecht: de "bekeken"-teller is per restaurant
 * per dag (0024). Een rij met een `viewed`-veld telt gewoon mee, zodat de top 4
 * automatisch klopt als dat veld er ooit bij komt; bestaande rijen dragen 0.
 */
function aggregateDishCounts(rows) {
  const perDish = new Map();
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const dishKey = textOf(row.dish_key || row.dishKey);
    if (!dishKey) continue;
    const current = perDish.get(dishKey) || { dishKey, viewed: 0, saved: 0, shared: 0 };
    current.viewed += countOf(row.viewed);
    current.saved += countOf(row.saved);
    current.shared += countOf(row.shared);
    perDish.set(dishKey, current);
  }
  return [...perDish.values()].map((entry) => ({ ...entry, total: entry.viewed + entry.saved + entry.shared }));
}

/**
 * De vier cijfers van één periode. `viewed` komt uit de bekeken-teller
 * (restaurant_views), `saved` en `shared` uit dish_counters en `favourite` uit
 * de "lekker"-stemmen van dit restaurant.
 */
function periodTotals({ viewRows, counterRows, votes } = {}) {
  const totals = { viewed: 0, saved: 0, shared: 0, favourite: 0 };
  for (const row of Array.isArray(viewRows) ? viewRows : []) {
    if (row && typeof row === 'object') totals.viewed += countOf(row.viewed);
  }
  for (const row of Array.isArray(counterRows) ? counterRows : []) {
    if (!row || typeof row !== 'object') continue;
    totals.saved += countOf(row.saved);
    totals.shared += countOf(row.shared);
  }
  for (const row of Array.isArray(votes) ? votes : []) {
    if (row && typeof row === 'object' && row.lekker === true) totals.favourite += 1;
  }
  return totals;
}

/**
 * Het verschil met vorige week. Een verschil wordt alleen getoond als beide
 * weken de drempel halen: anders zou een klein verschil alsnog iets over een
 * paar gasten zeggen.
 */
function weekChange(current, previous) {
  const now = countOf(current);
  const before = countOf(previous);
  const shaped = {
    current: now,
    previous: before,
    delta: now - before,
    comparable: isVisibleCount(now) && isVisibleCount(before),
  };
  if (!shaped.comparable) {
    return { ...shaped, direction: null, label: COMPARE_UNAVAILABLE_LABEL };
  }
  if (shaped.delta === 0) return { ...shaped, direction: 'gelijk', label: 'gelijk aan vorige week' };
  const amount = Math.abs(shaped.delta);
  return shaped.delta > 0
    ? { ...shaped, direction: 'meer', label: `${amount} meer dan vorige week` }
    : { ...shaped, direction: 'minder', label: `${amount} minder dan vorige week` };
}

/** De balkjes van de top 4: het hoogste gerecht vult de balk, de rest naar rato. */
function topDishes(rows, { limit = TOP_LIMIT } = {}) {
  const max = Number.isInteger(limit) && limit > 0 ? limit : TOP_LIMIT;
  const aggregated = aggregateDishCounts(rows)
    // Bij een gelijk aantal eerst op naam van de sleutel: altijd dezelfde volgorde.
    .sort((a, b) => (b.total - a.total) || a.dishKey.localeCompare(b.dishKey, 'nl'));
  const highest = aggregated.length > 0 ? aggregated[0].total : 0;
  return aggregated.slice(0, max).map((entry) => ({
    dishKey: entry.dishKey,
    restaurantId: restaurantOfDishKey(entry.dishKey),
    total: entry.total,
    label: formatCount(entry.total),
    enough: isVisibleCount(entry.total),
    // 0–100 voor de breedte van het balkje; nooit een deling door nul.
    barPercent: highest > 0 ? Math.round((entry.total / highest) * 100) : 0,
  }));
}

/** De stand "nog geen cijfers": de migratie ontbreekt of er is nog niets geteld. */
function noDataState(message = NO_DATA_MESSAGE) {
  return { status: NO_DATA_STATUS, message, hasData: false, week: [], top: [] };
}

/**
 * Het volledige overzicht van één restaurant: twee periodes, vier cijfers met
 * hun verandering, en de top 4.
 *
 * Deze module gaat ervan uit dat `viewRows`, `counterRows` en `votes` al bij dít
 * restaurant horen (de handler filtert op restaurant-id en op de
 * dish-key-prefix). Ze verdeelt ze daarna over de twee weken.
 */
function buildWeekOverview({
  restaurantId,
  viewRows,
  counterRows,
  votes,
  now = new Date(),
  limit = TOP_LIMIT,
} = {}) {
  const range = weekWindow(now);
  if (!range.week.van || !range.week.tot) return noDataState();

  const pick = (rows, filter) => (Array.isArray(rows) ? rows.filter(filter) : []);
  const dayOf = (row) => (row && (row.day || row.gestemd_op)) || null;
  const inWeek = (row) => dayInRange(dayOf(row), range.week);
  const inPreviousWeek = (row) => dayInRange(dayOf(row), range.vorigeWeek);

  const current = periodTotals({
    viewRows: pick(viewRows, inWeek),
    counterRows: pick(counterRows, inWeek),
    votes: pick(votes, inWeek),
  });
  const previous = periodTotals({
    viewRows: pick(viewRows, inPreviousWeek),
    counterRows: pick(counterRows, inPreviousWeek),
    votes: pick(votes, inPreviousWeek),
  });

  const week = WEEK_METRICS.map((metric) => {
    const value = current[metric.key] || 0;
    const before = previous[metric.key] || 0;
    return {
      id: metric.id,
      label: metric.label,
      value,
      shown: formatCount(value),
      enough: isVisibleCount(value),
      previous: before,
      previousShown: formatCount(before),
      change: weekChange(value, before),
    };
  });

  const rowsInWeek = pick(counterRows, inWeek);
  const top = topDishes(rowsInWeek, { limit });
  const hasData = Object.values(current).concat(Object.values(previous)).some((value) => value > 0)
    || rowsInWeek.length > 0;

  if (!hasData) return noDataState();

  return {
    status: READY_STATUS,
    restaurantId: textOf(restaurantId) || null,
    period: range,
    hasData: true,
    week,
    top,
  };
}

module.exports = {
  COMPARE_UNAVAILABLE_LABEL,
  MINIMUM_VISIBLE,
  NO_DATA_MESSAGE,
  NO_DATA_STATUS,
  READY_STATUS,
  TOP_LIMIT,
  UNDER_MINIMUM_LABEL,
  WEEK_DAYS,
  WEEK_METRICS,
  WEEK_METRIC_IDS,
  aggregateDishCounts,
  buildWeekOverview,
  countOf,
  dayInRange,
  formatCount,
  isVisibleCount,
  noDataState,
  periodTotals,
  restaurantOfDishKey,
  shiftDay,
  topDishes,
  utcDayOf,
  weekChange,
  weekWindow,
};

