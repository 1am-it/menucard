'use strict';

// BE-57 (#139, deel 1) — de houderstatistieken als API voor "Mijn restaurant".
//
// Eén handler voor GET /api/mijn-restaurant/<id>/cijfers. De volgorde is de
// veiligheidsvolgorde, net als bij de andere houders- en beheerroutes:
//   1. authenticeren — zonder sessie 401;
//   2. een onbekend restaurant — 404 (de statische data is openbaar, hier lekt
//      niets);
//   3. alleen een `owner`-rij voor precies dít restaurant — iemand anders 403,
//      en er wordt dan niets uit de database gelezen;
//   4. pas daarna lezen en rekenen.
//
// Er wordt alleen opgeteld: restaurant_views (bekeken, 0024), dish_counters
// (bewaard en gedeeld, 0021) en kies_stemmen (de "lekker"-stemmen, 0022). De
// privacydrempel en de vergelijking staan in src/lib/ownerRestaurantStats.js.
//
// Zonder migratie (0024) geeft de route geen fout: ze antwoordt 200 met de stand
// "nog geen cijfers". Een onbereikbare database geeft dezelfde nette 503 als de
// tellertabel, nooit een crash.
//
// Bewust CommonJS, zoals ownerRestaurantOverview.js: met een nep-client getest
// via `node --test`, zonder Supabase.

const { isMissingCounterStorage } = require('./dishCounters');
const { ownerRestaurantIds } = require('./ownerAccess');
const {
  NO_DATA_MESSAGE,
  buildWeekOverview,
  noDataState,
  weekWindow,
} = require('./ownerRestaurantStats');
const { isMissingViewStorage } = require('./restaurantViews');

const VIEW_TABLE = 'restaurant_views';
const COUNTER_TABLE = 'dish_counters';
const VOTE_TABLE = 'kies_stemmen';
// Alleen deze kolommen: geen identiteit, geen roepnaam, geen stemmer.
const VIEW_COLUMNS = 'day, viewed';
const COUNTER_COLUMNS = 'dish_key, day, saved, shared';
const VOTE_COLUMNS = 'dish_key, lekker, gestemd_op';
// PostgREST geeft standaard hooguit 1000 rijen per verzoek.
const PAGE_SIZE = 1000;
// Een harde bovengrens: 20.000 dag-rijen gaat over honderden gerechten per dag.
const MAX_SOURCE_ROWS = 20000;

const FORBIDDEN_MESSAGE = 'Alleen de eigenaar van dit restaurant kan deze cijfers zien.';
const NOT_FOUND_MESSAGE = 'Restaurant niet gevonden.';
const UNAVAILABLE_MESSAGE = 'Cijfers zijn nu niet beschikbaar.';
const NOT_SIGNED_IN_MESSAGE = 'Niet ingelogd.';

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** De restaurant-id uit het pad, of null. */
function restaurantIdOf(value) {
  const id = textOf(value).toLowerCase();
  return /^[a-z0-9]{1,24}$/.test(id) ? id : null;
}

/** Een pagina's-gewijze leesronde; elke fout gaat terug naar de caller. */
async function readRows(supabase, { table, columns, filters, pageSize, maxRows }) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let query = supabase.from(table).select(columns);
    for (const [method, column, value] of filters) {
      query = query[method](column, value);
    }
    if (typeof query.order === 'function') query = query.order('day', { ascending: true });
    if (typeof query.range === 'function') query = query.range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) return { error };
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return { rows };
}


/**
 * De handler. Afhankelijkheden:
 *   authenticate  de bestaande authenticateInternalRequest;
 *   getSupabase   de bestaande server-admin-client (mag gooien zonder sleutel);
 *   restaurants   data/restaurants.json, om een onbekende id te weigeren;
 *   now           de klok van de periode (tests);
 *   pageSize/maxSourceRows  de grenzen van de leesronde.
 */
function createOwnerStatsHandlers({
  authenticate,
  getSupabase,
  restaurants,
  now = () => new Date(),
  pageSize = PAGE_SIZE,
  maxSourceRows = MAX_SOURCE_ROWS,
} = {}) {
  const page = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : PAGE_SIZE;
  const cap = Number.isInteger(maxSourceRows) && maxSourceRows > 0 ? maxSourceRows : MAX_SOURCE_ROWS;

  function isKnownRestaurant(id) {
    const all = restaurants && typeof restaurants === 'object' ? restaurants : null;
    if (!all) return true;
    return Object.prototype.hasOwnProperty.call(all, id);
  }

  function unavailable() {
    return { status: 503, body: { error: UNAVAILABLE_MESSAGE } };
  }

  /** GET — de cijfers van één restaurant voor deze houder. */
  async function getOwnerStats(request, restaurantIdParam) {
    let auth = null;
    try {
      auth = await authenticate(request);
    } catch (error) {
      auth = null;
    }
    if (!auth || !auth.ok) {
      return {
        status: (auth && auth.status) || 401,
        body: { error: (auth && auth.error) || NOT_SIGNED_IN_MESSAGE },
      };
    }

    const restaurantId = restaurantIdOf(restaurantIdParam);
    if (!restaurantId || !isKnownRestaurant(restaurantId)) {
      return { status: 404, body: { error: NOT_FOUND_MESSAGE } };
    }

    // Alleen een owner-rij voor precies dit restaurant (contract "Toegang").
    // internal of editor is hier geen eigenaar en krijgt geen cijfers.
    if (!ownerRestaurantIds(auth.roles).includes(restaurantId)) {
      return { status: 403, body: { error: FORBIDDEN_MESSAGE } };
    }

    const clock = typeof now === 'function' ? now() : new Date();
    const range = weekWindow(clock);
    if (!range.week.van || !range.week.tot || !range.vorigeWeek.van) return unavailable();

    let supabase;
    try {
      supabase = typeof getSupabase === 'function' ? getSupabase() : null;
    } catch (error) {
      return unavailable();
    }
    if (!supabase || typeof supabase.from !== 'function') return unavailable();

    const prefix = `${restaurantId}-`;
    const dayFilters = [
      ['gte', 'day', range.vorigeWeek.van],
      ['lte', 'day', range.week.tot],
    ];

    try {
      const views = await readRows(supabase, {
        table: VIEW_TABLE,
        columns: VIEW_COLUMNS,
        filters: [['eq', 'restaurant_id', restaurantId]].concat(dayFilters),
        pageSize: page,
        maxRows: cap,
      });
      // Zonder 0024 is er nog geen bekeken-teller: de eerlijke stand, geen fout.
      if (views.error && isMissingViewStorage(views.error)) {
        return { status: 200, body: noDataState(NO_DATA_MESSAGE) };
      }
      if (views.error) return unavailable();

      const counters = await readRows(supabase, {
        table: COUNTER_TABLE,
        columns: COUNTER_COLUMNS,
        filters: [['like', 'dish_key', `${prefix}%`]].concat(dayFilters),
        pageSize: page,
        maxRows: cap,
      });
      if (counters.error && isMissingCounterStorage(counters.error)) {
        return { status: 200, body: noDataState(NO_DATA_MESSAGE) };
      }
      if (counters.error) return unavailable();

      const votes = await readRows(supabase, {
        table: VOTE_TABLE,
        columns: VOTE_COLUMNS,
        filters: [
          ['like', 'dish_key', `${prefix}%`],
          ['eq', 'lekker', true],
          ['gte', 'gestemd_op', range.vorigeWeek.van],
        ],
        pageSize: page,
        maxRows: cap,
      });
      if (votes.error && isMissingCounterStorage(votes.error)) {
        return { status: 200, body: noDataState(NO_DATA_MESSAGE) };
      }
      if (votes.error) return unavailable();

      return {
        status: 200,
        body: buildWeekOverview({
          restaurantId,
          viewRows: views.rows,
          counterRows: counters.rows,
          votes: votes.rows,
          now: clock,
        }),
      };
    } catch (error) {
      // Een netwerk- of clientfout is dezelfde nette foutstaat als een storing.
      if (isMissingViewStorage(error) || isMissingCounterStorage(error)) {
        return { status: 200, body: noDataState(NO_DATA_MESSAGE) };
      }
      return unavailable();
    }
  }

  return { getOwnerStats };
}

module.exports = {
  COUNTER_COLUMNS,
  COUNTER_TABLE,
  FORBIDDEN_MESSAGE,
  MAX_SOURCE_ROWS,
  NOT_FOUND_MESSAGE,
  PAGE_SIZE,
  UNAVAILABLE_MESSAGE,
  VIEW_COLUMNS,
  VIEW_TABLE,
  VOTE_COLUMNS,
  VOTE_TABLE,
  createOwnerStatsHandlers,
  readRows,
  restaurantIdOf,
};
