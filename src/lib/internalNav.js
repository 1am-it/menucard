// #62 — pure decision logic behind the internal navigation shell and the
// single "Restaurant of menu toevoegen" entry. Deliberately CommonJS, same
// reasoning as importInbox.js/activationFlow.js: directly testable via this
// project's existing `node --test` tooling, no new dependency, interoperates
// fine with the ESM 'use client' pages/components that import it.
//
// This module never touches Supabase, the DOM, React, the network or a clock.
// It classifies an already-resolved `roles` array (the same shape
// `authenticateInternalRequest` returns: `{ role, restaurant_id }[]`) and an
// already-resolved `counts` object into what the navigation should show. It
// never grants access itself — every existing route keeps its own unchanged
// server-side authenticateInternalRequest/isInternalOnly/isEditor gate; this is
// a discoverability layer only.
//
// #62 (issue contract, criteria 1-3): the top bar shows only "Dekking",
// "Werkvoorraad (N)" and "+ Restaurant of menu toevoegen". "Onboarding
// Restaurant" is no longer a top-bar item, and the old "Beheer" tile page
// (/internal) is no longer a destination: onboarding is reached through the add
// screen, and /internal redirects by the same landing rule as the login page and
// the logo (resolveLandingHref below). Every remaining route and id is
// unchanged; only the visible labels changed (Stadsoverzicht, Restaurantgegevens
// (concept)).
//
// `placement` is the only structural concept this module adds:
//  - 'primary'   — always inline in the top bar (Dekking);
//  - 'open-work' — the counted "Open werk" section of the Werkvoorraad menu,
//                  sorted by real counts (sortOpenWork below);
//  - 'secondary' — below the separating line in that menu, never counted.
// A module with an unrecognized/missing placement appears in no group at all —
// it fails closed to "not shown", never an assumed default, so a future module
// added without an explicit placement is visibly absent in testing rather than
// silently misplaced.

'use strict';

const { isInternalOnly } = require('./importInbox');

// Mirrors the identical, independently-defined `isEditor` in
// app/api/internal/v1/moderation/pending/route.js and
// app/api/internal/v1/claims/pending/route.js exactly (`roles.some((r) =>
// r.role === 'editor')`) — the same one-line definition kept deliberately in
// sync, not a third, subtly different copy.
function isEditorRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'editor');
}

function isOwnerRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'owner');
}

// The three `staff_roles.role` values the column's own `check` constraint
// allows (supabase/migrations/0001_field_provenance.sql). Used only to tell
// "a real but currently destination-less role" (`owner`) apart from "no usable
// role at all" — never to grant anything.
const KNOWN_ROLE_VALUES = ['internal', 'editor', 'owner'];

function hasAnyKnownRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && KNOWN_ROLE_VALUES.includes(r.role));
}

const COVERAGE_HREF = '/internal/coverage';
const ADD_ENTRY_HREF = '/internal/toevoegen';

// The single source for the Werkvoorraad menu. Order inside each placement is
// the contract's own fixed order (issue #62, criteria 1-2): that order is both
// the tie-break for equal counts and the order used when a count is unknown.
const INTERNAL_MODULES = [
  { id: 'coverage', label: 'Dekking', href: COVERAGE_HREF, requiredRole: 'internal', placement: 'primary' },
  { id: 'menu-concepts', label: 'Menuconcepten beoordelen', href: '/internal/menu-concepts', requiredRole: 'internal', placement: 'open-work', countKey: 'menu-concepts', subtitle: 'Concepten controleren en intern goedkeuren' },
  { id: 'source-triage', label: 'Bronnen beoordelen', href: '/internal/bronnen', requiredRole: 'internal', placement: 'open-work', countKey: 'source-triage', subtitle: 'Bronvoorstellen vastleggen en beoordelen' },
  { id: 'import-inbox', label: 'Nieuwe aanleveringen', href: '/internal/import-inbox', requiredRole: 'internal', placement: 'open-work', countKey: 'import-inbox', subtitle: 'Nieuwe bronnen' },
  { id: 'moderation', label: 'Beoordelen', href: '/internal/moderation', requiredRole: 'editor', placement: 'open-work', countKey: 'moderation', subtitle: "Menu's, profielen en eigenaarsclaims" },
  { id: 'source-workqueue', label: 'Stadsoverzicht', href: '/internal/source-workqueue', requiredRole: 'internal', placement: 'secondary', subtitle: 'Bron en menukaart per restaurant' },
  { id: 'profile-drafts', label: 'Restaurantgegevens (concept)', href: '/internal/profile-drafts', requiredRole: 'internal', placement: 'secondary', subtitle: 'Klaarzetten' },
];


/** The union of every section each of the roles individually unlocks — an
 * `internal`+`editor` account gets both sets, never just one (mirrors
 * src/lib/internalAuth.js's getAccessForRestaurant's own "strongest
 * applicable role" reasoning, generalized from one restaurant's write access
 * to "which nav items render"). Unchanged in shape/behavior from before #62 —
 * still a flat, role-filtered list; `placement` is only ever read by
 * `groupModulesByPlacement` below. */
function resolveVisibleModules(roles) {
  const hasInternal = isInternalOnly(roles);
  const hasEditor = isEditorRole(roles);
  return INTERNAL_MODULES.filter((m) => (m.requiredRole === 'internal' ? hasInternal : hasEditor));
}

/** Splits an already role-filtered module list (`resolveVisibleModules`'s own
 * output — this function never resolves roles itself) into
 * `{ primary, openWork, secondary }` by each module's own `placement` field.
 * Every array keeps `INTERNAL_MODULES`'s own relative order. */
function groupModulesByPlacement(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return {
    primary: list.filter((m) => m && m.placement === 'primary'),
    openWork: list.filter((m) => m && m.placement === 'open-work'),
    secondary: list.filter((m) => m && m.placement === 'secondary'),
  };
}

/** A real, computed count or `null`. Anything that is not a non-negative
 * integer (missing key, failed request, a string, a float) is "not
 * computable" — the UI then shows no number at all, never a fabricated 0. */
function resolveCount(counts, key) {
  if (!counts || typeof counts !== 'object' || !key) return null;
  const value = counts[key];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** "Open werk": real counts first, descending; equal counts keep the
 * contract's fixed order; entries whose count is not available go last, still
 * in that fixed order, and are rendered without a number. Never mutates the
 * input array or the module objects. */
function sortOpenWork(modules, counts) {
  const list = Array.isArray(modules) ? modules : [];
  return list
    .map((module, index) => ({ module, count: resolveCount(counts, module && module.countKey), index }))
    .sort((a, b) => {
      if (a.count === null && b.count === null) return a.index - b.index;
      if (a.count === null) return 1;
      if (b.count === null) return -1;
      return b.count - a.count || a.index - b.index;
    });
}

/** The total in "Werkvoorraad (N)". Only a total over *every* visible
 * open-work section counts: when one of them could not be computed the total
 * would understate the real work, so it is `null` and the bar shows no number
 * (issue #62: "Als een aantal niet te berekenen is, staat er geen nep-getal").
 * A real 0 is a number and is shown as such. */
function resolveOpenWorkTotal(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  let total = 0;
  for (const row of list) {
    const count = resolveCount({ value: row && row.count }, 'value');
    if (count === null) return null;
    total += count;
  }
  return total;
}

/** Criterion 3 — the one landing rule, used by the login page, by /internal
 * and (through /internal) by the logo:
 *  - the visible open-work section with the most real open work wins;
 *  - equal counts keep the contract's fixed order (Menuconcepten, Bronnen,
 *    Nieuwe aanleveringen, Beoordelen);
 *  - zero open work (or every count a real 0) lands on Dekking;
 *  - when a visible count is not available the rule never guesses a winner
 *    from partial data: it falls back to Dekking;
 *  - an account without any visible module gets `null` — the caller keeps its
 *    existing "no internal access" status instead of redirecting into a route
 *    that would deny it. */
function resolveLandingHref(roles, counts) {
  const { openWork } = groupModulesByPlacement(resolveVisibleModules(roles));
  if (openWork.length === 0) return null;
  const rows = sortOpenWork(openWork, counts);
  if (rows.some((row) => row.count === null)) return COVERAGE_HREF;
  const best = rows[0];
  return best && best.count > 0 ? best.module.href : COVERAGE_HREF;
}

module.exports = {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  COVERAGE_HREF,
  ADD_ENTRY_HREF,
  INTERNAL_MODULES,
  resolveVisibleModules,
  groupModulesByPlacement,
  resolveCount,
  sortOpenWork,
  resolveOpenWorkTotal,
  resolveLandingHref,
};
