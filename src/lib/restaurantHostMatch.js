// BE-18 (fase 1) — pure hostname matching against the existing restaurant
// list. Never queries a database: restaurant identity lives entirely in
// `data/restaurants.json` (this project's own existing convention — see
// menu_snapshot_proposals.restaurant_id's own design in BE-17). Never
// creates a restaurant record — an unmatched or ambiguous hostname is
// always resolved by an explicit reviewer choice from this same,
// existing list, never invented.
//
// Deliberately CommonJS, same reasoning as src/lib/importInbox.js.

'use strict';

/**
 * Lowercased hostname, with a leading `www.` stripped, from either a
 * full URL string or a bare hostname. `null` for anything unparseable —
 * never guessed at.
 */
function normalizeHostname(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  let hostname;
  try {
    hostname = new URL(value).hostname;
  } catch (err) {
    hostname = value.trim();
  }
  hostname = hostname.trim().toLowerCase();
  if (hostname.startsWith('www.')) hostname = hostname.slice(4);
  return hostname.length > 0 ? hostname : null;
}

/**
 * `restaurants` is the plain object shape `data/restaurants.json` already
 * uses (`{ [id]: { name, website, ... } }`). Compares the given source
 * URL's hostname against each restaurant's own `website` hostname —
 * deliberately exact hostname matching only, never fuzzy name/address
 * matching (src/lib/importInbox.js's computePossibleDuplicateIds solves
 * a different problem — candidate-to-candidate duplicate detection
 * during import — and is not reused here to avoid introducing
 * fuzzy-match false positives against production restaurant identity).
 *
 * Returns `{ matchType: 'exact' | 'none' | 'multiple', restaurantId,
 * candidates }` — `restaurantId` is only ever set for `'exact'`.
 * `'none'` and `'multiple'` are both resolved the same way: an explicit
 * reviewer choice, never a guess. A hostname that matches zero or more
 * than one restaurant is reported plainly; the caller decides how to
 * ask.
 */
function matchRestaurantByHostname(restaurants, sourceUrlOrHostname) {
  const targetHost = normalizeHostname(sourceUrlOrHostname);
  if (!targetHost) return { matchType: 'none', restaurantId: null, candidates: [] };

  const matches = [];
  for (const [id, restaurant] of Object.entries(restaurants || {})) {
    const restaurantHost = normalizeHostname(restaurant && restaurant.website);
    if (restaurantHost && restaurantHost === targetHost) {
      matches.push({ id, name: (restaurant && restaurant.name) || id });
    }
  }

  if (matches.length === 1) {
    return { matchType: 'exact', restaurantId: matches[0].id, candidates: matches };
  }
  if (matches.length > 1) {
    return { matchType: 'multiple', restaurantId: null, candidates: matches };
  }
  return { matchType: 'none', restaurantId: null, candidates: [] };
}

/** `[{ id, name }]` for every restaurant, sorted by name — the full
 * explicit-choice list shown whenever hostname matching is not exact. */
function buildRestaurantChoiceList(restaurants) {
  return Object.entries(restaurants || {})
    .map(([id, restaurant]) => ({ id, name: (restaurant && restaurant.name) || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  normalizeHostname,
  matchRestaurantByHostname,
  buildRestaurantChoiceList,
};
