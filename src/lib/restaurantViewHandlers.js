// BE-57 (#139, deel 1) — de serverkant van de anonieme teller "bekeken".
//
// Eén handler, en die antwoordt altijd hetzelfde: 204 zonder inhoud. Een
// onbekend restaurant, een kapot of te groot verzoek, een tweede verzoek binnen
// de seconde, een ontbrekende sleutel, een ontbrekende tabel of functie, een
// netwerkfout of een time-out — de browser ziet nooit een fout en de pagina
// merkt er niets van (contract: de pagina wacht niet op de teller).
//
// Waarom alles 204 is: deze route is openbaar en anoniem. Elk ander antwoord
// zou verklappen of een bezoek wel of niet geteld is.
//
// De schrijfactie is één aanroep van de databasefunctie
// increment_restaurant_view(p_restaurant_id) uit
// supabase/migrations/0024_be57_bekeken.sql, via de bestaande
// server-admin-client (getSupabaseAdmin, zie restaurantViewRouteDeps.js). De
// tabel is voor anon en authenticated volledig dicht en heeft geen policy;
// alleen deze serverroute schrijft, en niets leest de teller terug.
//
// Bewust CommonJS, zoals dishCounterHandlers.js: de tests bouwen de handler met
// een nep-client en draaien met `node --test`, zonder Supabase.

'use strict';

const {
  NO_CONTENT,
  VIEW_FUNCTION,
  VIEW_MAX_BODY_BYTES,
  VIEW_THROTTLE_MS,
  VIEW_TIMEOUT_MS,
  isMissingViewStorage,
  normalizeRestaurantId,
  viewBody,
} = require('./restaurantViews');

/** De JSON van een telverzoek, of null. Te groot, kapot of geen JSON: null. */
async function readViewBody(request) {
  if (!request || typeof request.json !== 'function') return null;
  const headers = request.headers;
  if (headers && typeof headers.get === 'function') {
    const length = Number(headers.get('content-length'));
    if (Number.isFinite(length) && length > VIEW_MAX_BODY_BYTES) return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/** Een belofte met een bovengrens; een time-out is een gewone afwijzing. */
function withViewTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('restaurant_view_timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/** De limiet van één verzoek per seconde per restaurant, in geheugen. */
function createViewLimiter({ windowMs = VIEW_THROTTLE_MS, now = Date.now } = {}) {
  const window = Number.isFinite(windowMs) && windowMs > 0 ? Number(windowMs) : VIEW_THROTTLE_MS;
  const lastSeen = new Map();

  function prune(current) {
    for (const [key, seenAt] of lastSeen) {
      if (current - seenAt >= window) lastSeen.delete(key);
    }
  }

  return {
    allow(restaurantId) {
      const id = normalizeRestaurantId(restaurantId);
      if (!id) return false;
      const current = Number(now());
      prune(current);
      const previous = lastSeen.get(id);
      if (previous !== undefined && current - previous < window) return false;
      lastSeen.set(id, current);
      return true;
    },
    size() {
      return lastSeen.size;
    },
  };
}

/**
 * De handler, met zijn afhankelijkheden als parameters:
 *   getSupabase  de bestaande server-admin-client (mag gooien als er geen
 *                sleutel is — dat is hier alleen "niets tellen");
 *   restaurants  de echte restaurantindex (data/restaurants.json), zodat een
 *                onbekende id nooit geteld wordt;
 *   now          de klok van de limiet (tests);
 *   timeoutMs    bovengrens per database-aanroep;
 *   windowMs     het venster van de limiet.
 *
 * Elke instantie heeft zijn eigen limiet en zijn eigen "opslag ontbreekt"-
 * vlag: één serverinstantie is genoeg, en een test kan een verse instantie
 * bouwen.
 */
function createRestaurantViewHandlers({
  getSupabase,
  restaurants,
  now = Date.now,
  timeoutMs = VIEW_TIMEOUT_MS,
  windowMs = VIEW_THROTTLE_MS,
} = {}) {
  const limiter = createViewLimiter({ windowMs, now });
  // Zodra de tabel of functie ontbreekt (migratie nog niet toegepast), telt
  // deze instantie niets meer en belt hij de database niet opnieuw.
  let storageMissing = false;

  function isKnownRestaurant(id) {
    const all = restaurants && typeof restaurants === 'object' ? restaurants : null;
    if (!all) return true;
    return Object.prototype.hasOwnProperty.call(all, id);
  }

  async function countRestaurantView(request) {
    if (storageMissing) return NO_CONTENT;
    try {
      const body = viewBody(await readViewBody(request) || {});
      if (!body) return NO_CONTENT;
      if (!isKnownRestaurant(body.restaurant)) return NO_CONTENT;
      if (!limiter.allow(body.restaurant)) return NO_CONTENT;

      const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
      if (!supabase || typeof supabase.rpc !== 'function') return NO_CONTENT;

      const result = await withViewTimeout(
        Promise.resolve(supabase.rpc(VIEW_FUNCTION, { p_restaurant_id: body.restaurant })),
        timeoutMs
      );
      if (result && result.error && isMissingViewStorage(result.error)) storageMissing = true;
    } catch (error) {
      if (isMissingViewStorage(error)) storageMissing = true;
    }
    return NO_CONTENT;
  }

  return {
    countRestaurantView,
    /** Alleen voor tests: is de opslag in deze instantie als ontbrekend gezien? */
    storageMissing() {
      return storageMissing;
    },
  };
}

module.exports = {
  createRestaurantViewHandlers,
  createViewLimiter,
  readViewBody,
  withViewTimeout,
};
