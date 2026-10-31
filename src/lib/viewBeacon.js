// BE-57 (#139) — de browsercode van de anonieme teller "bekeken".
//
// Dit bestand is de enige plek die in het client-bundel terechtkomt: de beacon
// op /restaurant/<id> en /menu/<id> importeert alleen dit bestand, niet de
// serverkant (src/lib/restaurantViews.js). Zo blijven de route-constanten,
// foutcodes en limieten van de server uit de eerste laadgrootte van de publieke
// pagina's (contract: maximaal 1 kB groei).
//
// Wat hier staat:
//   - de vorm van een telverzoek: exact `{ restaurant }`, niets anders;
//   - de enige geldige id: dezelfde korte id als data/restaurants.json;
//   - één keer tellen: per pagina (Set in dit proces) én per sessie
//     (sessionStorage);
//   - "Do Not Track" en "Global Privacy Control": dan gaat er niets weg;
//   - fire-and-forget met `sendBeacon` (of `fetch(..., { keepalive: true })`),
//     na het laden en zonder dat de pagina erop wacht.
//
// Bewust CommonJS, zoals dishCounters.js: direct testbaar met `node --test`,
// zonder browser of React.

'use strict';

// De route uit deze opdracht (POST). Eén letterlijke waarde, zodat de browser en
// de server het niet uit elkaar kunnen lopen.
const VIEW_ENDPOINT = '/api/v1/bekeken';
// De opslagsleutel in de browser: welke restaurants er in deze sessie al geteld
// zijn. Geen bezoekers-id, alleen de ids van de pagina's zelf.
const VIEW_SESSION_KEY = 'bredaeats_bekeken';
// De kolom `restaurant_id` in de migratie staat 1 tot 24 tekens toe.
const RESTAURANT_ID_PATTERN = /^[a-z0-9]{1,24}$/;

// Wat er in deze pagina al geteld is. Eén Set per paginalading: een tweede
// aanroep voor hetzelfde restaurant telt niet nog eens, ook niet als React een
// effect twee keer laat lopen (StrictMode) of de component opnieuw monteert.
const pageSends = new Set();

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** De restaurant-id zoals de routes hem kennen, of null. */
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
  if (!navigatorLike || typeof navigatorLike !== 'object') return false;
  if (navigatorLike.globalPrivacyControl === true) return true;
  return [navigatorLike.doNotTrack, navigatorLike.msDoNotTrack]
    .some((value) => /^(1|yes)$/i.test(textOf(value)));
}

/** De al getelde restaurant-ids van deze sessie (leeg bij elke fout). */
function sessionViewedIds(storage) {
  try {
    const parsed = JSON.parse((storage && storage.getItem(VIEW_SESSION_KEY)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/** Onthoudt in deze sessie dat dit restaurant geteld is. Faalt stil. */
function rememberInSession(storage, restaurantId) {
  try {
    const ids = sessionViewedIds(storage);
    if (!ids.includes(restaurantId)) {
      // Alleen de ids van bezochte pagina's, nooit meer dan een handvol.
      storage.setItem(VIEW_SESSION_KEY, JSON.stringify(ids.concat(restaurantId).slice(-50)));
    }
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
      if (nav.sendBeacon(VIEW_ENDPOINT, new Blob([payload], { type: 'application/json' })) !== false) return true;
    }
    const doFetch = typeof fetchRef === 'function' ? fetchRef : (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return false;
    // Terugval zonder sendBeacon: keepalive, geen cookie en geen verwijzer.
    const pending = doFetch(VIEW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'omit',
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
} = {}) {
  const count = () => sendRestaurantView({ restaurantId, navigator: navigatorLike, storage, pageSent, fetchRef });
  const win = windowLike && typeof windowLike === 'object' ? windowLike : null;
  if (win && typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(count, { timeout: 2000 });
    return true;
  }
  if (typeof setTimeout === 'function') {
    setTimeout(count, 0);
    return true;
  }
  return count() !== false;
}

module.exports = {
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
};
