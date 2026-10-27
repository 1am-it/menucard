'use strict';

// BE-35 (#84, criterion 4 — owner addition 27 Oct) — one pure rule for the
// automatic restaurant choice in the name search of /internal/menu-import and
// /internal/toevoegen (and any later search field).
//
// The typed name decides only when it is unambiguous:
//   - exactly one match  → that restaurant is chosen;
//   - several matches    → chosen only when exactly one is the exact name;
//   - otherwise          → a clear question ("Kies één van de N restaurants
//                          hieronder"), never a guess.
// The chosen restaurant is shown with its neighbourhood, exactly as the pages
// display it, so the human sees what was picked before continuing.
//
// Pure and offline: no fetch, no React, no state. The caller owns the debounce,
// the stale-response guard and the visible text; this module owns the decision.

const MIN_RESTAURANT_QUERY = 2;

/** Diacritics-free, punctuation-free name, the same fold the server search uses. */
function foldRestaurantName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "✓ Al Dente Ristorante · Binnenstad" — the chosen restaurant as one line. */
function restaurantChoiceLabel(choice) {
  if (!choice || typeof choice.name !== 'string' || choice.name.trim() === '') return '';
  const buurt = typeof choice.buurt === 'string' && choice.buurt.trim() !== '' ? ` · ${choice.buurt.trim()}` : '';
  return `✓ ${choice.name.trim()}${buurt}`;
}

/** "Kies één van de N restaurants hieronder." */
function restaurantChoiceQuestion(count) {
  const total = Number.isInteger(count) && count > 0 ? count : 0;
  return `Kies één van de ${total} ${total === 1 ? 'restaurant' : 'restaurants'} hieronder.`;
}

/**
 * The decision for one typed query and the choices the existing server search
 * returned for exactly that query. Statuses:
 *   idle     — fewer than two letters: nothing to decide;
 *   none     — no choice for this name;
 *   chosen   — one unambiguous restaurant (its label is the visible text);
 *   multiple — several restaurants: ask, do not guess.
 */
function decideRestaurantPick({ query, choices } = {}) {
  const needle = foldRestaurantName(query);
  const seen = new Set();
  const list = (Array.isArray(choices) ? choices : []).filter((choice) => {
    if (!choice || typeof choice.id !== 'string' || choice.id.trim() === '') return false;
    if (typeof choice.name !== 'string' || choice.name.trim() === '') return false;
    if (seen.has(choice.id)) return false;
    seen.add(choice.id);
    return true;
  });
  if (needle.length < MIN_RESTAURANT_QUERY) {
    return { status: 'idle', choice: null, label: null, message: null, count: list.length };
  }
  if (list.length === 0) {
    return { status: 'none', choice: null, label: null, message: null, count: 0 };
  }
  if (list.length === 1) {
    return { status: 'chosen', choice: list[0], label: restaurantChoiceLabel(list[0]), message: restaurantChoiceLabel(list[0]), count: 1 };
  }
  const exact = list.filter((choice) => foldRestaurantName(choice.name) === needle);
  if (exact.length === 1) {
    return { status: 'chosen', choice: exact[0], label: restaurantChoiceLabel(exact[0]), message: restaurantChoiceLabel(exact[0]), count: list.length };
  }
  const question = restaurantChoiceQuestion(list.length);
  return { status: 'multiple', choice: null, label: null, message: question, count: list.length };
}

module.exports = {
  MIN_RESTAURANT_QUERY,
  decideRestaurantPick,
  foldRestaurantName,
  restaurantChoiceLabel,
  restaurantChoiceQuestion,
};
