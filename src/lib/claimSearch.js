'use strict';

// BE-54 (#133) — de zoekregel achter /mijn-restaurant/claimen.
//
// Bewust een pure module, dezelfde conventie als src/lib/restaurantBrowse.js:
// de pagina haalt de bestaande restaurantdata via GET /api/restaurants
// (dezelfde bron en dezelfde paginering als /alle-restaurants) en deze module
// bepaalt daarna — zonder nieuwe API, data of dependency — welke regels er
// staan. Zo is het gedrag met `node --test` te bewijzen zonder React of browser.
//
// De velden en de rangorde zijn precies die van de bestaande zoeklogica in
// src/services/restaurantIndex.js (getMatchTier): eerst naam, dan buurt, dan
// het adres, alle drie hoofdletterongevoelig en als deel van de tekst. De
// volgorde binnen een trap is alfabetisch op naam, net als daar. Het verschil is
// alleen de paginering: hier staan er maximaal 20 regels in één keer, want dit
// is een keuzelijst en geen catalogus.
//
// De drempel van twee tekens komt uit dezelfde module (`hasQuery`), zodat een
// zoekterm van één letter niet opeens de hele lijst toont.
//
// Er staat bewust geen claimstatus in een regel: of een restaurant al geclaimd
// is, blijft op /claim/[id] (privacy, contractpunt 5).

const MAX_CLAIM_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;

const CLAIM_SEARCH_MESSAGES = Object.freeze({
  label: 'Naam, straat of buurt',
  placeholder: 'Bijv. Wolfslaar, Haagdijk of Baronielaan',
  hint: 'Zoek op (een deel van) de naam, de straat of de buurt.',
  typeToSearch: 'Typ minimaal twee letters om te zoeken.',
  noneFound: 'Geen restaurant gevonden met deze zoekterm.',
  emptyHelp: 'Zoek op een deel van de naam of op straat.',
  contactLabel: 'Laat het ons weten',
  claimButton: 'Dit is mijn restaurant',
  howTitle: 'Zo werkt het',
  loading: 'Restaurants laden…',
  loadError: 'De restaurants konden niet geladen worden. Probeer het opnieuw.',
});

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

/** De zoekterm zoals de gebruiker hem bedoelt: zonder spaties aan de randen. */
function normalizeClaimQuery(rawQuery) {
  return textOf(rawQuery).trim();
}

function boundedLimit(limit) {
  if (!Number.isFinite(limit)) return MAX_CLAIM_RESULTS;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_CLAIM_RESULTS);
}

// Zelfde drie trappen als restaurantIndex.getMatchTier(), in dezelfde volgorde.
function claimMatchTier(restaurant, needle) {
  if (textOf(restaurant.name).toLowerCase().includes(needle)) return 1;
  if (textOf(restaurant.buurt).toLowerCase().includes(needle)) return 2;
  if (textOf(restaurant.address).toLowerCase().includes(needle)) return 3;
  return null;
}

/** Alle treffers, gesorteerd; het afkappen gebeurt daarna pas. */
function sortedClaimMatches(restaurants, rawQuery) {
  const query = normalizeClaimQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const needle = query.toLowerCase();
  const scored = [];
  for (const restaurant of Array.isArray(restaurants) ? restaurants : []) {
    if (!restaurant || typeof restaurant !== 'object') continue;
    const tier = claimMatchTier(restaurant, needle);
    if (tier === null) continue;
    scored.push({ restaurant, tier });
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return textOf(a.restaurant.name).localeCompare(textOf(b.restaurant.name), 'nl');
  });

  return scored.map((entry) => entry.restaurant);
}

/**
 * De restaurants die bij deze zoekterm horen, in de volgorde van de bestaande
 * zoeklogica, met maximaal 20 resultaten. Een lege of te korte zoekterm geeft
 * een lege lijst. De aangeleverde lijst blijft onaangeroerd.
 */
function matchClaimRestaurants(restaurants, rawQuery, { limit = MAX_CLAIM_RESULTS } = {}) {
  return sortedClaimMatches(restaurants, rawQuery).slice(0, boundedLimit(limit));
}

/** Het aantal treffers zonder de lijst af te kappen; voor de tekst onder het veld. */
function countClaimMatches(restaurants, rawQuery) {
  return sortedClaimMatches(restaurants, rawQuery).length;
}

/** Eén regel van de keuzelijst: naam, adres, buurt en de bestaande claimroute. */
function claimResultRow(restaurant) {
  const address = textOf(restaurant.address).trim();
  const buurt = textOf(restaurant.buurt).trim();
  const restaurantId = textOf(restaurant.restaurantId).trim() || String(restaurant.restaurantId ?? '').trim();

  return {
    restaurantId,
    name: textOf(restaurant.name).trim(),
    address: address || null,
    buurt: buurt || null,
    detail: [address, buurt].filter(Boolean).join(' · '),
    claimHref: `/claim/${encodeURIComponent(restaurantId)}`,
    claimLabel: CLAIM_SEARCH_MESSAGES.claimButton,
  };
}

function claimResultRows(restaurants, rawQuery, options) {
  return matchClaimRestaurants(restaurants, rawQuery, options).map(claimResultRow);
}

/**
 * De tekst met `role="status"`: altijd eerlijk over wat er te zien is. Zonder
 * bruikbare zoekterm staat er geen telling, bij meer dan 20 treffers staat het
 * echte totaal erbij in plaats van een halve lijst als volledig te presenteren.
 */
function claimResultStatus(rawQuery, { matched = 0, shown = 0 } = {}) {
  const query = normalizeClaimQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return CLAIM_SEARCH_MESSAGES.typeToSearch;
  if (matched <= 0) return CLAIM_SEARCH_MESSAGES.noneFound;
  if (shown < matched) return `Eerste ${shown} van ${matched} restaurants.`;
  return `${matched} ${matched === 1 ? 'restaurant' : 'restaurants'} gevonden.`;
}

/**
 * Alleen een echte `mailto:` als NEXT_PUBLIC_CONTACT_EMAIL gevuld en bruikbaar
 * is. Zonder die variabele is er geen link en geen verzonnen adres.
 */
function contactMailto(email) {
  const value = textOf(email).trim();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return `mailto:${value}`;
}

module.exports = {
  CLAIM_SEARCH_MESSAGES,
  MAX_CLAIM_RESULTS,
  MIN_QUERY_LENGTH,
  claimResultRow,
  claimResultRows,
  claimResultStatus,
  contactMailto,
  countClaimMatches,
  matchClaimRestaurants,
  normalizeClaimQuery,
};
