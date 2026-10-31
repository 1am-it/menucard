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
// BE-67 (ronde 3, #164) — dezelfde route telt ook een aanbod: krijgt `dish` de
// aanbodsleutel `daghap-<restaurant>-<aanbod>` (daghapAanbod.aanbodSleutel),
// dan schrijft de route één regel `bewaard` of `gedeeld` in
// daghap_gebeurtenissen, precies zoals `telBekeken` dat met `bekeken` doet. Nog
// geen 0026? Dan weigert de check op `actie` de rij, de fout blijft binnen deze
// handler en de browser merkt niets.
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
  SAVED_EVENT,
  SHARED_EVENT,
  counterBody,
  createCounterLimiter,
  isMissingCounterStorage,
  normalizeCounterEvent,
  resolveCounterDish,
  withTimeout,
} = require('./dishCounters');
const { parseAanbodSleutel } = require('./daghapAanbod');

// BE-67 (ronde 3) — de geschiedenistabel van 0023, waar 0026 de acties
// `bekeken`, `bewaard` en `gedeeld` aan toevoegt. Dezelfde tabel, dezelfde
// schrijfwijze als `telBekeken` in src/lib/daghapHandlers.js; er is geen nieuwe
// tabel en geen nieuwe teller.
const DAGHAP_TABLE_GEBEURTENISSEN = 'daghap_gebeurtenissen';
// Een aanbod kent geen reserveren: alleen deze twee tellen.
const AANBOD_EVENTS = Object.freeze([SAVED_EVENT, SHARED_EVENT]);

/**
 * Het aanbod achter een telverzoek, of null. `dish` is dan de aanbodsleutel
 * (`daghap-<restaurant>-<aanbod>`, zie daghapAanbod.aanbodSleutel) en `event`
 * alleen `bewaard` of `gedeeld`.
 */
function aanbodTelling(raw) {
  const sleutel = parseAanbodSleutel(raw && raw.dish);
  if (!sleutel) return null;
  const event = normalizeCounterEvent(raw && raw.event);
  if (!event || !AANBOD_EVENTS.includes(event)) return null;
  return { ...sleutel, event };
}

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
    try {
      const raw = (await readBody(request)) || {};
      // BE-67 (ronde 3) — de bewaar- en deelknop bij een daghap of dagmenu
      // telt in de bestaande geschiedenistabel: één regel per klik, net als
      // `bekeken`, en zonder iets over de bezoeker (geen id, geen cookie, geen
      // apparaat). Mislukt het schrijven — bijvoorbeeld omdat 0026 nog niet is
      // toegepast en de actie nog niet in de check staat — dan gebeurt er niets
      // en blijft het antwoord 204.
      const aanbod = aanbodTelling(raw);
      if (aanbod) {
        if (!limiter.allow(aanbod.sleutel, aanbod.event)) return NO_CONTENT;
        const beheer = typeof getSupabase === 'function' ? getSupabase() : null;
        if (!beheer || typeof beheer.from !== 'function') return NO_CONTENT;
        await withTimeout(
          Promise.resolve(beheer.from(DAGHAP_TABLE_GEBEURTENISSEN).insert({
            aanbod_id: aanbod.aanbodId,
            restaurant_id: aanbod.restaurantId,
            actie: aanbod.event,
            door: null,
            apparaat: null,
            gegevens: {},
            moment: new Date(Number(now())).toISOString(),
          })),
          timeoutMs
        );
        return NO_CONTENT;
      }

      if (storageMissing) return NO_CONTENT;
      const body = counterBody(raw);
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
  AANBOD_EVENTS,
  DAGHAP_TABLE_GEBEURTENISSEN,
  aanbodTelling,
  createDishCounterHandlers,
  readBody,
};
