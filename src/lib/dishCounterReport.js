// BE-45 (#114) — de tellertabel in het interne beheer.
//
// De rekenkant van GET /api/internal/v1/tellers en van /internal/tellers, op één
// plek en zonder Supabase, React of browser:
//   - de drie periodes (vandaag, 7 dagen, 30 dagen) en hun UTC-daggrenzen;
//   - het optellen per `dish_key` over de periode;
//   - het opzoeken van gerecht en restaurant met dezelfde resolutie als de
//     deeplink (BE-12) en het lijstje (BE-44) — nooit uit de database;
//   - een onbekende sleutel blijft staan, met de sleutel als naam;
//   - het sorteren en de standaardsortering "Gedeeld, aflopend";
//   - de teksten van de lege staat, de foutstaat en het Verboden-antwoord.
//
// De tabel uit supabase/migrations/0021_be44_dish_counters.sql is per gerecht
// per UTC-dag opgeteld en bevat geen identiteit. Deze module telt alleen op en
// toont alleen aantallen: geen export, geen grafiek, geen
// restauranthouder-inzage (contract 6 en "Grenzen en niet-doelen").
//
// Bewust CommonJS, zoals dishCounters.js en dishList.js: direct testbaar met
// `node --test`, en de ESM-route en -pagina kunnen hem gewoon importeren.

'use strict';

const { buildDishDeepLink } = require('./dishDeepLink');
const { dishIdOf, parseDishId } = require('./dishList');
const { DISH_KEY_MAX_LENGTH } = require('./dishCounters');

// Precies de drie periodes uit het contract (criterium 1). `dagen` is inclusief
// vandaag, in UTC: 7 betekent vandaag plus de zes UTC-dagen daarvoor.
const PERIODS = [
  { id: 'vandaag', label: 'Vandaag', dagen: 1 },
  { id: '7', label: '7 dagen', dagen: 7 },
  { id: '30', label: '30 dagen', dagen: 30 },
];
const PERIOD_IDS = PERIODS.map((period) => period.id);
// Een ongeldige periode valt terug op 7 (criterium 1).
const DEFAULT_PERIOD = '7';

// Maximaal 500 rijen (criterium 1). De totalen blijven over alle gerechten van
// de periode gaan; alleen de lijst is begrensd.
const MAX_ROWS = 500;

// De kolommen van de tabel, in de volgorde van de goedgekeurde mockup.
const COLUMNS = [
  { id: 'gerecht', label: 'Gerecht', numeric: false },
  { id: 'restaurant', label: 'Restaurant', numeric: false },
  { id: 'gedeeld', label: 'Gedeeld', numeric: true },
  { id: 'bewaard', label: 'Bewaard', numeric: true },
  { id: 'reserveren', label: 'Reserveer', numeric: true },
];
const COLUMN_IDS = COLUMNS.map((column) => column.id);

// De standaardsortering uit het contract: "Gedeeld", aflopend.
const DEFAULT_SORT = Object.freeze({ kolom: 'gedeeld', richting: 'aflopend' });
const SORT_DIRECTIONS = ['oplopend', 'aflopend'];

// De teksten die het contract letterlijk noemt.
const EMPTY_MESSAGE = 'Nog geen tellingen in deze periode.';
const UNAVAILABLE_MESSAGE = 'Tellers zijn nu niet beschikbaar.';
const UNKNOWN_DISH_LABEL = 'onbekend gerecht';
const FORBIDDEN_MESSAGE = 'Alleen interne medewerkers kunnen de tellers zien.';
const PAGE_TITLE = 'Tellers';
const PERIOD_GROUP_LABEL = 'Periode';
const SORT_LABEL = 'Sorteren op';
const TOTALS_LABEL = 'Totalen in deze periode';
const TABLE_CAPTION = 'Tellingen per gerecht';
const TRUNCATED_MESSAGE = `De tabel toont de eerste ${MAX_ROWS} gerechten; de totalen gaan over alle gerechten in deze periode.`;

const DAY_MS = 24 * 60 * 60 * 1000;

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Een teller is een niet-negatief geheel getal; al het andere telt als 0. */
function countOf(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/** De periode zoals de API hem kent, of de standaardperiode (7). */
function normalizePeriod(value) {
  const text = textOf(value).toLowerCase();
  return PERIOD_IDS.includes(text) ? text : DEFAULT_PERIOD;
}

/** Het aantal dagen van een periode, inclusief vandaag. */
function periodDays(period) {
  const found = PERIODS.find((entry) => entry.id === normalizePeriod(period));
  return found ? found.dagen : PERIODS[1].dagen;
}

/** Het label bij een periode ("Vandaag", "7 dagen", "30 dagen"). */
function periodLabel(period) {
  const found = PERIODS.find((entry) => entry.id === normalizePeriod(period));
  return found ? found.label : PERIODS[1].label;
}

/** Het begin van de UTC-dag van een moment, in milliseconden, of null. */
function utcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * De UTC-dag als `YYYY-MM-DD`. Bewust de UTC-kalenderdag en niet de lokale dag
 * van de server: de database schrijft elke telling op de UTC-dag (zie 0021), dus
 * "vandaag" moet precies die dag zijn.
 */
function utcDayOf(value) {
  const start = typeof value === 'number' ? value : utcDayStart(value);
  if (start === null || Number.isNaN(start)) return null;
  const date = new Date(start);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * De UTC-dagen van een periode: `{ periode, dagen, van, tot }`, waarbij `van`
 * en `tot` de eerste en de laatste UTC-dag zijn (beide inclusief).
 */
function periodRange(period, now = new Date()) {
  const id = normalizePeriod(period);
  const dagen = periodDays(id);
  const today = utcDayStart(now);
  if (today === null) return { periode: id, dagen, van: null, tot: null };
  const van = utcDayOf(today - (dagen - 1) * DAY_MS);
  return { periode: id, dagen, van, tot: utcDayOf(today) };
}


/**
 * De rijen van `dish_counters` optellen per `dish_key`. Een rij buiten de
 * periode telt niet mee (de query filtert al, dit is de tweede grens), een rij
 * zonder bruikbare sleutel valt af, en een onbekende sleutel blijft staan —
 * weggegooide tellingen zijn erger dan een rij zonder gerechtnaam.
 */
function aggregateCounterRows(rows, range) {
  const list = Array.isArray(rows) ? rows : [];
  const totals = new Map();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const dishKey = textOf(row.dish_key !== undefined ? row.dish_key : row.dishKey);
    if (!dishKey || dishKey.length > DISH_KEY_MAX_LENGTH) continue;
    const day = textOf(row.day).slice(0, 10);
    if (range && day && ((range.van && day < range.van) || (range.tot && day > range.tot))) continue;
    const entry = totals.get(dishKey) || { dishKey, gedeeld: 0, bewaard: 0, reserveren: 0 };
    entry.gedeeld += countOf(row.shared);
    entry.bewaard += countOf(row.saved);
    entry.reserveren += countOf(row.reservation_clicks);
    totals.set(dishKey, entry);
  }
  return [...totals.values()];
}

/**
 * Eén rij voor de tabel: de opgetelde aantallen plus de namen uit de echte
 * menukaarten, met exact de resolutie van de deeplink (BE-12) en het lijstje
 * (BE-44): `<menukaart>-<categorie>-<gerecht>` → menu, categorie, gerecht, en de
 * restaurantnaam via het restaurantnummer vóór het eerste streepje.
 *
 * `href` is de publieke deeplink van het gerecht (criterium 3: de gerechtnaam
 * linkt naar de publieke gerechtpagina). `onbekend` zegt eerlijk dat de sleutel
 * niet meer in de menudata staat; de rij blijft dan staan met de sleutel als
 * naam, en de pagina zet er "onbekend gerecht" bij.
 */
function resolveReportRow(entry, menus, restaurants) {
  const dishKey = textOf(entry && entry.dishKey);
  const parsed = parseDishId(dishKey);
  const canonicalKey = parsed ? dishIdOf(parsed) : dishKey;
  const menu = parsed ? (menus && menus[parsed.menuId]) || null : null;
  const category = menu && Array.isArray(menu.categories) ? menu.categories[parsed.catIdx] : null;
  const item = category && Array.isArray(category.items) ? category.items[parsed.itemIdx] : null;
  const restaurantId = parsed ? parsed.menuId.split('-')[0] : null;
  const restaurant = (restaurantId && restaurants && restaurants[restaurantId]) || null;

  const row = {
    dishKey: canonicalKey,
    gerecht: dishKey,
    restaurant: textOf(restaurant && restaurant.name) || textOf(menu && menu.name),
    restaurantId,
    gedeeld: countOf(entry && entry.gedeeld),
    bewaard: countOf(entry && entry.bewaard),
    reserveren: countOf(entry && entry.reserveren),
    href: null,
    onbekend: true,
  };

  const name = textOf(item && item.name);
  const categoryName = textOf(category && category.name);
  if (!name || !categoryName) return row;

  return {
    ...row,
    gerecht: name,
    href: buildDishDeepLink({
      menuLink: `/menu/${parsed.menuId}`,
      dishId: canonicalKey,
      name,
      category: categoryName,
    }),
    onbekend: false,
  };
}

/** De standaardrichting van een kolom: tekst oplopend, een aantal aflopend. */
function defaultDirectionFor(kolom) {
  const column = COLUMNS.find((entry) => entry.id === kolom);
  return column && column.numeric ? 'aflopend' : 'oplopend';
}

/** Een sorteerwens die altijd bruikbaar is; onbekende waarden vallen terug. */
function resolveSort(sort) {
  const kolom = sort && COLUMN_IDS.includes(sort.kolom) ? sort.kolom : DEFAULT_SORT.kolom;
  const richting = sort && SORT_DIRECTIONS.includes(sort.richting)
    ? sort.richting
    : (kolom === DEFAULT_SORT.kolom ? DEFAULT_SORT.richting : defaultDirectionFor(kolom));
  return { kolom, richting };
}

/**
 * Sorteer de rijen op één kolom. Getallen numeriek, tekst met de Nederlandse
 * collatie; gelijke waarden houden hun eigen volgorde (stabiel), en de
 * invoerarray wordt nooit aangepast.
 */
function sortRows(rows, sort) {
  const list = Array.isArray(rows) ? rows : [];
  const { kolom, richting } = resolveSort(sort);
  const column = COLUMNS.find((entry) => entry.id === kolom);
  const factor = richting === 'aflopend' ? -1 : 1;
  return list
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const difference = column && column.numeric
        ? countOf(a.row && a.row[kolom]) - countOf(b.row && b.row[kolom])
        : textOf(a.row && a.row[kolom]).localeCompare(textOf(b.row && b.row[kolom]), 'nl');
      return difference === 0 ? a.index - b.index : difference * factor;
    })
    .map((entry) => entry.row);
}

/**
 * De volgende sorteerstap bij een klik op een kolomkop: dezelfde kolom keert de
 * richting om, een andere kolom begint met zijn eigen standaardrichting.
 */
function nextSort(sort, kolom) {
  const current = resolveSort(sort);
  if (!COLUMN_IDS.includes(kolom)) return current;
  if (current.kolom === kolom) {
    return { kolom, richting: current.richting === 'aflopend' ? 'oplopend' : 'aflopend' };
  }
  return { kolom, richting: defaultDirectionFor(kolom) };
}

/**
 * Het volledige antwoord van de API: de periode, drie totalen en de rijen.
 *
 * `totalen` gaat over alle gerechten van de periode — ook over de rijen die niet
 * in de eerste 500 passen — zodat een begrensde tabel nooit een te laag totaal
 * suggereert. `aantalGerechten` maakt dat verschil zichtbaar; de pagina zegt het
 * dan in één regel. Buiten de onbekende sleutels is elke rij een echt gerecht.
 */
function buildTellersReport({ periode, rows, menus, restaurants } = {}) {
  const period = normalizePeriod(periode);
  const aggregated = aggregateCounterRows(rows)
    .sort((a, b) => a.dishKey.localeCompare(b.dishKey, 'nl'));
  const rijen = sortRows(
    aggregated.map((entry) => resolveReportRow(entry, menus, restaurants)),
    DEFAULT_SORT
  );
  const totalen = { gedeeld: 0, bewaard: 0, reserveren: 0 };
  for (const row of rijen) {
    totalen.gedeeld += row.gedeeld;
    totalen.bewaard += row.bewaard;
    totalen.reserveren += row.reserveren;
  }
  return {
    periode: period,
    totalen,
    rijen: rijen.slice(0, MAX_ROWS),
    aantalGerechten: rijen.length,
  };
}

module.exports = {
  COLUMNS,
  COLUMN_IDS,
  DEFAULT_PERIOD,
  DEFAULT_SORT,
  EMPTY_MESSAGE,
  FORBIDDEN_MESSAGE,
  MAX_ROWS,
  PAGE_TITLE,
  PERIODS,
  PERIOD_GROUP_LABEL,
  PERIOD_IDS,
  SORT_DIRECTIONS,
  SORT_LABEL,
  TABLE_CAPTION,
  TOTALS_LABEL,
  TRUNCATED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNKNOWN_DISH_LABEL,
  aggregateCounterRows,
  buildTellersReport,
  countOf,
  defaultDirectionFor,
  nextSort,
  normalizePeriod,
  periodDays,
  periodLabel,
  periodRange,
  resolveReportRow,
  resolveSort,
  sortRows,
  utcDayOf,
  utcDayStart,
};

