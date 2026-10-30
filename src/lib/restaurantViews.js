// BE-57 (#139, deel 1) — de anonieme teller "bekeken".
//
// Eén plek voor alles wat deze teller bepaalt, aan beide kanten van de lijn:
//   - de vorm van een telverzoek: exact `{ restaurant }`, niets anders. Geen
//     cookie, geen id, geen pad, geen verwijzer en dus niets dat een bezoeker
//     zou kunnen identificeren;
//   - de enige geldige id: dezelfde korte id als data/restaurants.json en de
//     routes /restaurant/<id> en /menu/<id>;
//   - het één keer tellen: per pagina (een Set in dit proces) én per sessie
//     (sessionStorage), zodat een herlaadactie en een terugkeer binnen dezelfde
//     sessie niet nog eens tellen;
//   - de respectvolle kant: bij "Do Not Track" of "Global Privacy Control"
//     wordt er niets verstuurd;
//   - de browserkant: na het laden, fire-and-forget met `sendBeacon` (of
//     `fetch(..., { keepalive: true })` als die er niet is). De pagina wacht
//     nooit op de teller en een fout is nooit zichtbaar;
//   - het stil falen zonder migratie: de codes waarmee Postgres en PostgREST
//     zeggen dat de tabel of functie nog niet bestaat.
//
// De opslag staat in supabase/migrations/0024_be57_bekeken.sql: per restaurant
// per UTC-dag één opgeteld aantal, zonder identiteit. Deze module schrijft
// alleen; niets leest de teller hier terug (de houderstatistieken hebben hun
// eigen, geteste module).
//
// Bewust CommonJS, zoals dishCounters.js: direct testbaar met `node --test`,
// zonder browser, React of netwerk.

'use strict';

// De route uit deze opdracht (POST). Eén letterlijke waarde, zodat de browser en
// de server het niet uit elkaar kunnen lopen.
const VIEW_ENDPOINT = '/api/v1/bekeken';
// De namen uit supabase/migrations/0024_be57_bekeken.sql.
const VIEW_FUNCTION = 'increment_restaurant_view';
const VIEW_TABLE = 'restaurant_views';
// De opslagsleutel in de browser: welke restaurants er in deze sessie al geteld
// zijn. Geen bezoekers-id, alleen de ids van de pagina's zelf.
const VIEW_SESSION_KEY = 'bredaeats_bekeken';

// Een telverzoek is klein; alles groter is geen telverzoek.
const VIEW_MAX_BODY_BYTES = 512;
// Eén verzoek per seconde per restaurant (dezelfde orde als BE-44).
const VIEW_THROTTLE_MS = 1000;
// De databasefunctie is één upsert. Duurt hij langer, dan telt deze aanvraag
// niet mee — de pagina wacht nooit op de teller.
const VIEW_TIMEOUT_MS = 2000;
// De kolom `restaurant_id` in de migratie staat 1 tot 24 tekens toe.
const RESTAURANT_ID_PATTERN = /^[a-z0-9]{1,24}$/;

// De codes waarmee Postgres en PostgREST zeggen dat de tabel of de functie nog
// niet bestaat: de migratie is dan nog niet toegepast. De teller stopt dan stil
// en probeert het in deze instantie niet opnieuw (zelfde posture als BE-44).
const MISSING_VIEW_STORAGE_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const NO_CONTENT = { status: 204, body: null };

// Wat er in deze pagina al geteld is. Eén Set per paginalading: een tweede
// aanroep voor hetzelfde restaurant telt niet nog eens, ook niet als React een
// effect twee keer laat lopen (StrictMode) of de component opnieuw monteert.
const pageSends = new Set();

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/**
 * De restaurant-id zoals de routes hem kennen, of null. Alleen een korte
 * kleine-letter-/cijfer-id als tekenreeks: een getal, een pad of HTML is geen
 * restaurant.
 */
function normalizeRestaurantId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return RESTAURANT_ID_PATTERN.test(id) ? id : null;
}

/** De JSON van een telverzoek: exact `{ restaurant }`, of null. */
function viewBody({ restaurant } = {}) {
  const id = normalizeRestaurantId(restaurant);
  return id ? { restaurant: id } : null;
}

/**
 * Heeft deze bezoeker zich afgemeld? "Do Not Track" (`1`, `yes` of de oude
 * `msDoNotTrack`-vorm) en "Global Privacy Control" (een boolean) tellen allebei:
 * dan versturen we niets, ook geen anoniem aantal.
 */
function isTrackingOptedOut(navigatorLike) {
  const nav = navigatorLike && typeof navigatorLike === 'object' ? navigatorLike : null;
  if (!nav) return false;
  if (nav.globalPrivacyControl === true) return true;
  for (const value of [nav.doNotTrack, nav.msDoNotTrack]) {
    const text = textOf(value).toLowerCase();
    if (text === '1' || text === 'yes') return true;
  }
  return false;
}

/** Zegt deze fout dat de tabel of functie nog niet bestaat? */
function isMissingViewStorage(error) {
  if (!error) return false;
  const code = textOf(error.code).toUpperCase();
  if (MISSING_VIEW_STORAGE_CODES.has(code)) return true;
  const message = textOf(error.message || error.details || error.hint);
  return /does not exist|schema cache/i.test(message);
}

/** De al getelde restaurant-ids van deze sessie (leeg bij elke fout). */
function sessionViewedIds(storage) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(VIEW_SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch (error) {
    return [];
  }
}

/** Onthoudt in deze sessie dat dit restaurant geteld is. Faalt stil. */
function rememberInSession(storage, restaurantId) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    const ids = sessionViewedIds(storage);
    if (ids.includes(restaurantId)) return true;
    ids.push(restaurantId);
    // Alleen de ids van bezochte pagina's, nooit meer dan een handvol.
    storage.setItem(VIEW_SESSION_KEY, JSON.stringify(ids.slice(-50)));
    return true;
  } catch (error) {
    // Volle of geblokkeerde opslag: de pagina-Set voorkomt alsnog dubbel tellen
    // binnen deze pagina, en er gaat niets kapot.
    return false;
  }
}

/**
 * Mag deze pagina gezien worden als één bezoek?
 *   - een ongeldige id: nee;
 *   - "Do Not Track" of "Global Privacy Control": nee;
 *   - al geteld op deze pagina: nee;
 *   - al geteld in deze sessie: nee.
 * Een ontbrekende of kapotte opslag telt als "nog niet gezien".
 */
function shouldCountRestaurantView({
  restaurantId,
  navigator: navigatorLike,
  storage,
  pageSent = pageSends,
} = {}) {
  const id = normalizeRestaurantId(restaurantId);
  if (!id) return false;
  if (isTrackingOptedOut(navigatorLike)) return false;
  if (pageSent && typeof pageSent.has === 'function' && pageSent.has(id)) return false;
  if (sessionViewedIds(storage).includes(id)) return false;
  return true;
}

/**
 * De teller vanuit de browser: fire-and-forget. De caller wacht niet en de
 * uitkomst is nooit zichtbaar. `sendBeacon` heeft de voorkeur (die overleeft
 * ook een navigatie); zonder die functie gaat het met `fetch` en
 * `keepalive: true`. Elke fout geeft `false` en laat de pagina met rust.
 *
 * Retourneert `false` zodra er niet geteld mag worden, en anders het resultaat
 * van het versturen — nooit een belofte waar de pagina op moet wachten.
 */
function sendRestaurantView({
  restaurantId,
  navigator: navigatorLike,
  storage,
  pageSent = pageSends,
  fetchRef,
} = {}) {
  const body = viewBody({ restaurant: restaurantId });
  if (!body) return false;
  if (!shouldCountRestaurantView({ restaurantId, navigator: navigatorLike, storage, pageSent })) return false;

  const id = body.restaurant;
  if (pageSent && typeof pageSent.add === 'function') pageSent.add(id);
  rememberInSession(storage, id);

  const payload = JSON.stringify(body);
  const nav = navigatorLike && typeof navigatorLike === 'object' ? navigatorLike : null;
  try {
    if (nav && typeof nav.sendBeacon === 'function') {
      // Een Blob met application/json: sendBeacon stuurt anders een tekst/plain
      // body die de route niet als JSON leest.
      const queued = nav.sendBeacon(VIEW_ENDPOINT, new Blob([payload], { type: 'application/json' }));
      if (queued !== false) return true;
    }
    const doFetch = typeof fetchRef === 'function'
      ? fetchRef
      : (typeof nav?.fetch === 'function' ? nav.fetch.bind(nav) : (typeof fetch === 'function' ? fetch : null));
    if (!doFetch) return false;
    const pending = doFetch(VIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      // Geen cookie, geen herkomst en geen wachttijd: de teller is anoniem.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      keepalive: true,
    });
    // De pagina wacht hier niet op; een afwijzing is geen fout voor de bezoeker.
    if (pending && typeof pending.then === 'function') pending.then(() => {}, () => {});
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Na het laden tellen, zonder dat de pagina erop wacht. De browser krijgt eerst
 * de kans om te tekenen (`requestIdleCallback`, anders een korte time-out);
 * daarna gaat de beacon weg. Er wordt niets opgeruimd: een beacon is juist
 * bedoeld om ook na een navigatie nog aan te komen.
 */
function scheduleRestaurantView({
  restaurantId,
  navigator: navigatorLike,
  storage,
  pageSent = pageSends,
  window: windowLike,
  fetchRef,
  delayMs = 0,
} = {}) {
  const count = () => sendRestaurantView({ restaurantId, navigator: navigatorLike, storage, pageSent, fetchRef });
  const win = windowLike && typeof windowLike === 'object' ? windowLike : null;
  if (win && typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(count, { timeout: 2000 });
    return true;
  }
  if (typeof setTimeout === 'function') {
    setTimeout(count, Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0);
    return true;
  }
  return count() !== false;
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
