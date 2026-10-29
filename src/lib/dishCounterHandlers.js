// BE-44 (#105, criterium 5) — de serverkant van de anonieme tellers.
//
// Eén handler, en die antwoordt altijd hetzelfde: 204 zonder inhoud. Een
// onbekend gerecht, een onbekende gebeurtenis, een tweede verzoek binnen de
// seconde, een ontbrekende sleutel, een ontbrekende tabel of functie, een
// netwerkfout of een time-out — de browser ziet nooit een fout en de knop
// merkt er niets van (contract: "een mislukte telling mag nooit de knop
// breken").
//
// Waarom alles 204 is: deze route is openbaar en anoniem. Elk ander antwoord
// zou verklappen welke gerechten bestaan, welke tabel er is of dat een
// bezoeker te snel klikte. Niets daarvan hoort bij een teller.
//
// De schrijfactie is één aanroep van de databasefunctie
// increment_dish_counter(p_dish_key, p_event) uit
// supabase/migrations/0021_be44_dish_counters.sql, via de bestaande
// server-admin-client (getSupabaseAdmin, zie dishCounterRouteDeps.js). De
// tabel is voor anon en authenticated volledig dicht en heeft geen policy;
// alleen deze serverroute schrijft, en niets leest de tellers terug.
//
// Bewust CommonJS, zoals dishList.js en dishCounters.js: de tests bouwen de
// handler met een nep-client en draaien met `node --test`, zonder Supabase.

'use strict';

const {
  COUNTER_MAX_BODY_BYTES,
  COUNTER_THROTTLE_MS,
  COUNTER_TIMEOUT_MS,
  DISH_COUNTER_FUNCTION,
  NO_CONTENT,
  counterBody,
  createCounterLimiter,
  isMissingCounterStorage,
  resolveCounterDish,
  withTimeout,
} = require('./dishCounters');

/** De JSON van een telverzoek, of null. Te groot, kapot of geen JSON: null. */
async function readBody(request) {
  if (!request || typeof request.json !== 'function') return null;
  const headers = request.headers;
  if (headers && typeof headers.get === 'function') {
    const length = Number(headers.get('content-length'));
    if (Number.isFinite(length) && length > COUNTER_MAX_BODY_BYTES) return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/**
 * De handler, met zijn afhankelijkheden als parameters:
 *   getSupabase  de bestaande server-admin-client (mag gooien als er geen
 *                sleutel is — dat is hier alleen "niets tellen");
 *   menus        de echte menukaarten (data/menus.json), voor het opzoeken van
 *                het gerecht net als bij de deeplink;
 *   now          de klok van de limiet (tests);
 *   timeoutMs    bovengrens per database-aanroep;
 *   windowMs     het venster van de limiet (één verzoek per seconde).
 *
 * Elke instantie heeft zijn eigen limiet en zijn eigen "opslag ontbreekt"-
 * vlag: één serverinstantie is genoeg (Lead-ontwerp), en een test kan een
 * verse instantie bouwen.
 */
function createDishCounterHandlers({
  getSupabase,
  menus,
  now = Date.now,
  timeoutMs = COUNTER_TIMEOUT_MS,
  windowMs = COUNTER_THROTTLE_MS,
} = {}) {
  const limiter = createCounterLimiter({ windowMs, now });
  // Zodra de tabel of functie ontbreekt (migratie nog niet toegepast), telt
  // deze instantie niets meer en belt hij de database niet opnieuw.
  let storageMissing = false;

  async function countDishEvent(request) {
    if (storageMissing) return NO_CONTENT;
    try {
      const body = counterBody(await readBody(request) || {});
      if (!body) return NO_CONTENT;
      const dish = resolveCounterDish(body.dish, menus);
      if (!dish) return NO_CONTENT;
      if (!limiter.allow(dish.dishKey, body.event)) return NO_CONTENT;

      const supabase = typeof getSupabase === 'function' ? getSupabase() : null;
      if (!supabase || typeof supabase.rpc !== 'function') return NO_CONTENT;

      const result = await withTimeout(
        Promise.resolve(supabase.rpc(DISH_COUNTER_FUNCTION, {
          p_dish_key: dish.dishKey,
          p_event: body.event,
        })),
        timeoutMs
      );
      if (result && result.error && isMissingCounterStorage(result.error)) storageMissing = true;
    } catch (error) {
      // Geen sleutel, een netwerkfout, een time-out of een onverwachte fout:
      // stil niets tellen. Alleen "de tabel bestaat niet" is het onthouden
      // waard, zodat elke klik niet opnieuw hoeft te wachten.
      if (isMissingCounterStorage(error)) storageMissing = true;
    }
    return NO_CONTENT;
  }

  return {
    countDishEvent,
    /** Alleen voor tests: is de opslag in deze instantie als ontbrekend gezien? */
    storageMissing() {
      return storageMissing;
    },
  };
}

module.exports = {
  createDishCounterHandlers,
  readBody,
};
