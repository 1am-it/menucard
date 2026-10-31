// BE-65 (#157, uitkomst 4) — het venster "Stuur je lijstje", de beslissingen.
//
// Eén plek voor alles wat dit venster bepaalt, zonder React en zonder DOM, zodat
// `node --test` het direct kan toetsen:
//   - de twee keuzes ("Gewoon delen" en "Laat stemmen"), met "Gewoon delen" als
//     standaard en de twee regels uitleg uit het contract;
//   - de drie deelmanieren in één rij: de favorieten uit "Delen via" (hooguit
//     twee, zodat de rij drie knoppen houdt) en "Meer…" (het systeemmenu of het
//     klembord — precies wat "Meer…" elders doet);
//   - de grens van 12 gerechten en de bestaande melding daarbij;
//   - het maken van de stemlink via de bestaande API (POST /api/v1/kies), met
//     de bestaande meldingen en zonder ooit iets te delen als het mislukt.
//
// De teksten van de fouten zijn letterlijk die van KiesStartButton
// (`Samen kiezen kan met hooguit 12 gerechten.` en `De stemlink is niet
// gemaakt. Probeer het opnieuw.`). savedListSend.test.js vergelijkt ze met de
// bron van die component, zodat er geen tweede waarheid ontstaat.
//
// Bewust CommonJS, zoals dishList.js, dishShare.js en kiesStemming.js: direct
// testbaar met `node --test`, zonder browser of React.

'use strict';

const {
  KIES_ENDPOINT,
  KIES_MAX_DISHES,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_STARTED_MESSAGE,
  kiesHref,
} = require('./kiesStemming');
const { SHARE_MORE_LABEL, normalizeSharePreference, shareMethodLabel } = require('./sharePreference');

// De titel, de sluitknop en de vraag uit het contract (uitkomst 4).
const SEND_TITLE = 'Stuur je lijstje';
const SEND_CLOSE_LABEL = 'Sluiten';
const SEND_MODE_QUESTION = 'Hoe wil je het sturen?';
const SEND_DISHES_TITLE = 'Deze gerechten gaan mee';

// De twee keuzes. "Gewoon delen" is de standaard.
const SEND_PLAIN_MODE = 'plain';
const SEND_VOTE_MODE = 'vote';
const SEND_PLAIN_LABEL = 'Gewoon delen';
const SEND_PLAIN_HINT = 'Je vrienden zien je lijstje met prijzen en restaurants.';
const SEND_VOTE_LABEL = 'Laat stemmen';
const SEND_VOTE_HINT = "Iedereen kiest 'lekker' of 'liever niet'. Jij ziet de winnaar. Zonder account.";

// De bestaande meldingen, letterlijk zoals KiesStartButton ze toont.
const SEND_TOO_MANY_MESSAGE = `Samen kiezen kan met hooguit ${KIES_MAX_DISHES} gerechten.`;
const SEND_FAILED_MESSAGE = 'De stemlink is niet gemaakt. Probeer het opnieuw.';

// De rij met deelmanieren: hooguit twee favorieten uit "Delen via" en "Meer…".
// Zonder bewaarde voorkeur staan er twee gewone manieren; "Meer…" is het
// systeemmenu (of het klembord) en heet hier net als elders zo.
const SEND_MORE_METHOD = 'phone';
const SEND_DEFAULT_METHODS = ['whatsapp', 'copy'];
const SEND_FAVORITE_METHODS = 2;
const SEND_METHOD_COUNT = SEND_FAVORITE_METHODS + 1;

/** 'plain' of 'vote'; al het andere is de standaard "Gewoon delen". */
function normalizeSendMode(value) {
  return value === SEND_VOTE_MODE ? SEND_VOTE_MODE : SEND_PLAIN_MODE;
}

/** De uitleg die bij een keuze hoort. */
function sendModeHint(mode) {
  return normalizeSendMode(mode) === SEND_VOTE_MODE ? SEND_VOTE_HINT : SEND_PLAIN_HINT;
}

/** Past het lijstje binnen de grens van de stemming (maximaal 12 gerechten)? */
function canSendVote(count) {
  const n = Number(count);
  return Number.isFinite(n) && n > 0 && n <= KIES_MAX_DISHES;
}

/** Zegt het aantal dat "Laat stemmen" niet meer kan? */
function tooManyForVote(count) {
  const n = Number(count);
  return Number.isFinite(n) && n > KIES_MAX_DISHES;
}

/**
 * De drie knoppen in de rij: de favorieten uit "Delen via" (hooguit twee) en
 * daarna "Meer…". Een bewaarde voorkeur met meer favorieten of met alleen het
 * telefoonmenu valt terug op de gewone twee, zodat de rij altijd drie knoppen
 * houdt (contract: "drie knoppen in een rij").
 */
function sendMethods(preference) {
  const stored = normalizeSharePreference(preference);
  const favorites = stored && !stored.phone ? stored.methods.slice(0, SEND_FAVORITE_METHODS) : [];
  const methods = [];
  // Eerst de favorieten, dan aanvullen met de gewone manieren tot twee; zo staat
  // er altijd dezelfde rij van drie knoppen.
  for (const method of [...favorites, ...SEND_DEFAULT_METHODS]) {
    if (methods.length >= SEND_FAVORITE_METHODS) break;
    if (!methods.includes(method)) methods.push(method);
  }
  return [...methods, SEND_MORE_METHOD];
}

/** Het label van één knop in de rij. */
function sendMethodLabel(method) {
  return method === SEND_MORE_METHOD ? SHARE_MORE_LABEL : shareMethodLabel(method);
}

/** "Kies mee: 2 gerechten" — dezelfde titel als de bestaande stemlink. */
function voteTitle(count) {
  const n = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `Kies mee: ${n} ${n === 1 ? 'gerecht' : 'gerechten'}`;
}

/**
 * De stemlink maken met de bestaande API (POST /api/v1/kies), net als
 * KiesStartButton: alleen de id's van het lijstje en géén sluitingstijd (dit
 * venster vraagt er niet naar). Elke uitkomst is een gewoon object, zodat de
 * component niets hoeft te raden:
 *   { ok: true,  href, message }       — de link staat klaar en mag gedeeld;
 *   { ok: false, href: null, message } — niets delen, alleen de melding.
 */
async function createVoteLink({ dishKeys = [], fetchRef, endpoint = KIES_ENDPOINT, theme = null } = {}) {
  const keys = (Array.isArray(dishKeys) ? dishKeys : []).map((key) => String(key || '').trim()).filter(Boolean);
  if (tooManyForVote(keys.length)) {
    return { ok: false, href: null, message: SEND_TOO_MANY_MESSAGE, reason: 'too_many' };
  }
  if (keys.length === 0) {
    return { ok: false, href: null, message: SEND_FAILED_MESSAGE, reason: 'empty' };
  }
  const doFetch = typeof fetchRef === 'function'
    ? fetchRef
    : (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, href: null, message: SEND_FAILED_MESSAGE, reason: 'no_fetch' };
  try {
    const response = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dish_keys: keys, sluit_om: null }),
      // Geen cookie en geen herkomst: de stemming is anoniem.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    const href = response.ok && body && body.code ? kiesHref(body.code, theme) : null;
    if (href) {
      return {
        ok: true,
        href,
        message: KIES_STARTED_MESSAGE,
        reason: 'started',
        code: body.code,
        sluitOm: body.sluitOm || null,
      };
    }
    if (response.status === 503) {
      return {
        ok: false,
        href: null,
        message: body && body.message ? body.message : KIES_NOT_AVAILABLE_MESSAGE,
        reason: 'unavailable',
      };
    }
    return { ok: false, href: null, message: SEND_FAILED_MESSAGE, reason: 'failed' };
  } catch (error) {
    return { ok: false, href: null, message: SEND_FAILED_MESSAGE, reason: 'failed' };
  }
}

module.exports = {
  KIES_MAX_DISHES,
  SEND_CLOSE_LABEL,
  SEND_DEFAULT_METHODS,
  SEND_DISHES_TITLE,
  SEND_FAILED_MESSAGE,
  SEND_FAVORITE_METHODS,
  SEND_METHOD_COUNT,
  SEND_MODE_QUESTION,
  SEND_MORE_METHOD,
  SEND_PLAIN_HINT,
  SEND_PLAIN_LABEL,
  SEND_PLAIN_MODE,
  SEND_TITLE,
  SEND_TOO_MANY_MESSAGE,
  SEND_VOTE_HINT,
  SEND_VOTE_LABEL,
  SEND_VOTE_MODE,
  canSendVote,
  createVoteLink,
  normalizeSendMode,
  sendMethodLabel,
  sendMethods,
  sendModeHint,
  tooManyForVote,
  voteTitle,
};
