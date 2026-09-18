// BE-12 — pure, presentation-independent validation for a dish search
// result's deep link into its exact position on a menu
// (app/menu/[id]/MenuView.js). Deliberately CommonJS, same reasoning as
// moderationFormatting.js/internalNav.js: directly testable via this
// project's existing `node --test` tooling (MenuView.js itself contains
// JSX and cannot be `require()`d from a plain Node test), no new
// dependency, interoperates fine with the ESM 'use client' page that
// imports it.
//
// This module never touches the DOM, React, or any network/API call — it
// only decides, from data already loaded by the menu route itself,
// whether a `dish`/`name`/`cat` combination resolves to exactly one real
// item. It never guesses, never picks a "closest" match, and never
// mutates its inputs.

'use strict';

// Resolves the additive `dish`/`name`/`cat` query params
// (be-12-dish-result-deep-link-scroll-highlight.md's own route/query
// contract) to an exact { catIdx, itemIdx } position within `categories`,
// or `null` when any of the required checks fails. `categories` must be
// the route's own, unfiltered category list — never an already-filtered
// one — so an active `?q=`/allergen/diet/price filter can never change
// which dish this resolves to.
//
// All checks are required, not best-effort: a missing param, a wrong
// route-id prefix, a malformed or out-of-range position, a name mismatch,
// or a category mismatch each independently invalidate the whole result —
// there is no partial match, only "valid" or "the caller falls back to
// the plain, unfiltered, unhighlighted menu."
function resolveDishTarget(rawDish, expectedName, expectedCat, routeId, categories) {
  if (!rawDish || !expectedName || !expectedCat) return null;
  if (typeof rawDish !== 'string' || !rawDish.startsWith(`${routeId}-`)) return null;

  const suffix = rawDish.slice(routeId.length + 1);
  const match = suffix.match(/^(\d+)-(\d+)$/);
  if (!match) return null;

  const catIdx = Number(match[1]);
  const itemIdx = Number(match[2]);
  const category = categories[catIdx];
  if (!category) return null;

  const item = category.items[itemIdx];
  if (!item) return null;

  if ((item.name || '').trim().toLowerCase() !== expectedName.trim().toLowerCase()) return null;
  if (category.name !== expectedCat) return null;

  return { catIdx, itemIdx };
}

module.exports = {
  resolveDishTarget,
};
