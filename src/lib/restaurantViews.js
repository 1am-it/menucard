// BE-57 (#139) — de serverkant van de anonieme teller "bekeken".
//
// De browsercode (id-controle, één keer per pagina en per sessie, Do Not Track,
// Global Privacy Control, sendBeacon) staat in src/lib/viewBeacon.js. Die
// scheiding is bewust: alleen dát bestand komt in het client-bundel van
// /restaurant/[id] en /menu/[id], zodat de eerste laadgrootte van de publieke
// pagina's vrijwel gelijk blijft (contract: maximaal 1 kB groei). Hier staan de
// namen en grenzen die alleen de server gebruikt: de databasefunctie, de tabel,
// de limieten en de codes waarmee Postgres en PostgREST "bestaat nog niet"
// zeggen (migratie 0024 nog niet toegepast).
//
// Niets leest de teller hier terug: de houderstatistieken hebben hun eigen,
// geteste module (src/lib/ownerRestaurantStats.js, ownerStatsHandlers.js).

'use strict';

const {
  RESTAURANT_ID_PATTERN,
  VIEW_ENDPOINT,
  VIEW_SESSION_KEY,
  isTrackingOptedOut,
  normalizeRestaurantId,
  rememberInSession,
  scheduleRestaurantView,
  sendRestaurantView,
  sessionViewedIds,
  shouldCountRestaurantView,
  viewBody,
} = require('./viewBeacon');

// De naam uit supabase/migrations/0024_be57_bekeken.sql.
const VIEW_FUNCTION = 'increment_restaurant_view';
const VIEW_TABLE = 'restaurant_views';

// Een telverzoek is klein; alles groter is geen telverzoek.
const VIEW_MAX_BODY_BYTES = 512;
// Eén verzoek per seconde per restaurant (dezelfde orde als BE-44).
const VIEW_THROTTLE_MS = 1000;
// De databasefunctie is één upsert. Duurt hij langer, dan telt deze aanvraag
// niet mee — de pagina wacht nooit op de teller.
const VIEW_TIMEOUT_MS = 2000;

// De codes waarmee Postgres en PostgREST zeggen dat de tabel of de functie nog
// niet bestaat: de teller stopt dan stil en probeert het in deze instantie niet
// opnieuw (zelfde posture als BE-44).
const MISSING_VIEW_STORAGE_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const NO_CONTENT = { status: 204, body: null };

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Zegt deze fout dat de tabel of functie nog niet bestaat? */
function isMissingViewStorage(error) {
  if (!error) return false;
  const code = textOf(error.code).toUpperCase();
  if (MISSING_VIEW_STORAGE_CODES.has(code)) return true;
  const message = textOf(error.message || error.details || error.hint);
  return /does not exist|schema cache/i.test(message);
}

module.exports = {
  MISSING_VIEW_STORAGE_CODES,
  NO_CONTENT,
  RESTAURANT_ID_PATTERN,
  VIEW_ENDPOINT,
  VIEW_FUNCTION,
  VIEW_MAX_BODY_BYTES,
  VIEW_SESSION_KEY,
  VIEW_TABLE,
  VIEW_THROTTLE_MS,
  VIEW_TIMEOUT_MS,
  isMissingViewStorage,
  isTrackingOptedOut,
  normalizeRestaurantId,
  rememberInSession,
  scheduleRestaurantView,
  sendRestaurantView,
  sessionViewedIds,
  shouldCountRestaurantView,
  viewBody,
};
