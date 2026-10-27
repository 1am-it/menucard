'use strict';

// #62 — the route choice behind the single entry "Restaurant of menu
// toevoegen". Pure and directly testable: it never starts anything itself and
// never invents a destination. It reuses the existing batch validation
// (src/lib/batchAnalysis.js) — same URL shape, same duplicate rule, same
// maximum — so the entry can never accept what the batch page would refuse.
//
// The three routes from the issue contract (criterion 4, and the Lead's own
// "kies de route zonder iets te verzinnen"):
//  - a known restaurant with exactly one URL → the existing analysis (the
//    batch page's own single-URL batch); a failed or empty read there already
//    offers "Lees met AI" (#59) through the existing result card;
//  - a new restaurant (no existing restaurant chosen) with one URL → the
//    existing Onboarding Restaurant flow, with the URL already filled in;
//  - more than one URL → the existing batch analysis, whatever the restaurant.
// "Liever zelf invoeren of plakken" always points at the existing manual import.

const { MAX_BATCH_URLS, precheckLines } = require('./batchAnalysis');

const ONBOARDING_HREF = '/internal/onboarding-restaurant';
// BE-31 (#74): the existing batch analysis screen moved under the one address
// "Bronnen beoordelen". It is still the same BE-25/BE-30 screen with the same
// API, limits and confirmation route; only its visible address changed.
const BATCH_HREF = '/internal/bronnen/batch';
const MANUAL_IMPORT_HREF = '/internal/menu-import';

const MESSAGES = {
  empty: 'Voer minimaal één URL in.',
  tooMany: `Gebruik maximaal ${MAX_BATCH_URLS} URL's per keer.`,
  invalid: 'Controleer de URL: alleen volledige http(s)-adressen met een punt in de host worden geaccepteerd.',
};

function batchHref(urls) {
  const params = new URLSearchParams();
  params.set('urls', urls.join('\n'));
  return `${BATCH_HREF}?${params.toString()}`;
}

function onboardingHref(url) {
  return `${ONBOARDING_HREF}?url=${encodeURIComponent(url)}`;
}

/** The existing manual import page, optionally already scoped to the chosen
 * restaurant (the same `?restaurant=&name=` deeplink that page already reads). */
function manualImportHref(restaurant) {
  if (!restaurant || restaurant.id === undefined || restaurant.id === null || restaurant.id === '') {
    return MANUAL_IMPORT_HREF;
  }
  const params = new URLSearchParams({ restaurant: String(restaurant.id) });
  if (restaurant.name) params.set('name', String(restaurant.name));
  return `${MANUAL_IMPORT_HREF}?${params.toString()}`;
}

function normalizeRestaurant(restaurant) {
  if (!restaurant || restaurant.id === undefined || restaurant.id === null || restaurant.id === '') return null;
  return {
    id: String(restaurant.id),
    name: restaurant.name ? String(restaurant.name) : '',
  };
}

/**
 * decideAddEntry({ restaurant, urls }) →
 *   { ok: false, error }
 * | { ok: true, kind: 'onboarding', urls, href }
 * | { ok: true, kind: 'batch', urls, href }
 * `urls` is the raw, trimmed input text (one URL per line); the existing
 * screens re-validate it exactly as they always do.
 */
function decideAddEntry(input) {
  const restaurant = normalizeRestaurant(input && input.restaurant);
  const check = precheckLines(input && input.urls);
  if (check.entries.length === 0) return { ok: false, error: MESSAGES.empty };
  if (check.tooMany) return { ok: false, error: MESSAGES.tooMany };
  if (check.entries.some((entry) => entry.status === 'invalid')) return { ok: false, error: MESSAGES.invalid };

  const urls = check.entries.filter((entry) => entry.status === 'ok').map((entry) => entry.raw);
  if (urls.length === 0) return { ok: false, error: MESSAGES.empty };

  if (!restaurant && urls.length === 1) {
    return { ok: true, kind: 'onboarding', urls, href: onboardingHref(urls[0]) };
  }
  return { ok: true, kind: 'batch', urls, href: batchHref(urls) };
}

module.exports = {
  ONBOARDING_HREF,
  BATCH_HREF,
  MANUAL_IMPORT_HREF,
  MESSAGES,
  MAX_BATCH_URLS,
  batchHref,
  onboardingHref,
  manualImportHref,
  decideAddEntry,
};
