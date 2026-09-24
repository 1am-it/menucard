// PLATFORM-11 — pure decision logic behind the role-aware internal
// navigation shell (Phase 1/2: /internal home + shared nav). Deliberately
// CommonJS, same reasoning as importInbox.js/activationFlow.js: directly
// testable via this project's existing `node --test` tooling, no new
// dependency, interoperates fine with the ESM 'use client' pages/
// components that import it.
//
// This module never touches Supabase, the DOM, or React — it only
// classifies an already-resolved `roles` array (the same shape
// `authenticateInternalRequest` returns: `{ role, restaurant_id }[]`) into
// what the navigation should show. It never grants access itself — every
// existing route keeps its own unchanged server-side
// `authenticateInternalRequest`/`isInternalOnly`/`isEditor` gate; this is
// a discoverability layer only, per PLATFORM-11's own "Technical
// constraints."

'use strict';

const { isInternalOnly } = require('./importInbox');

// Mirrors the identical, independently-defined `isEditor` in
// app/api/internal/v1/moderation/pending/route.js and
// app/api/internal/v1/claims/pending/route.js exactly (`roles.some((r) =>
// r.role === 'editor')`) — not a "third, subtly different copy," the same
// one-line definition kept deliberately in sync. PLATFORM-11's own ticket
// ("Open questions") explicitly leaves consolidating all three into one
// shared export as later, orthogonal cleanup, not required here.
function isEditorRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'editor');
}

function isOwnerRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && r.role === 'owner');
}

// The three `staff_roles.role` values the column's own `check` constraint
// allows (supabase/migrations/0001_field_provenance.sql). Used only to
// tell "a real but currently destination-less role" (`owner`) apart from
// "no usable role at all" — never to grant anything.
const KNOWN_ROLE_VALUES = ['internal', 'editor', 'owner'];

function hasAnyKnownRole(roles) {
  return Array.isArray(roles) && roles.some((r) => r && KNOWN_ROLE_VALUES.includes(r.role));
}

// BE-20 — simplified navigation structure, replacing the earlier flat
// list. Implements be-20-general-restaurant-source-extraction.md's own
// "Visual contract" ("Main navigation shows only Dekkingsoverzicht and
// Onboarding Restaurant... Nieuwe aanleveringen, Profielconcepten, and
// Beoordelen stay reachable through a compact, accessible Werkvoorraad
// control") plus the current, explicit user direction that additionally
// groups a `manage` ("Beheer") entry alongside those three under the same
// Werkvoorraad control — the earlier, not-yet-simplified nav (still shown
// in docs/mockups/onboarding-restaurant-workflow-v1.png's own top bar,
// itself superseded for navigation structure by
// docs/mockups/internal-navigation-workqueue-v1.png) listed `Beheer` as
// its own separate top-level link; this build keeps it reachable, just
// relocated into Werkvoorraad rather than dropped.
//
// `placement` is the only new concept this module adds:
//  - `'primary'` — always inline in the top bar (Dekkingsoverzicht,
//    Onboarding Restaurant).
//  - `'workqueue'` — grouped under the compact Werkvoorraad control
//    (Beheer, Nieuwe aanleveringen, Profielconcepten, Beoordelen).
// `onboarding-menu` deliberately has NO nav placement at all (and so is
// no longer listed in INTERNAL_MODULES below) — per the current,
// explicit direction it "blijft bereikbaar vanuit de bredere Onboarding
// Restaurant-context, maar is geen los prominent hoofdmenu-item meer":
// it is linked directly from app/internal/onboarding-restaurant/page.js's
// own content instead, never through this shared nav mechanism. Its
// route, page, and every existing deep link to it are completely
// unchanged — removing it from this list only removes it from the shared
// nav rendering, never the route itself.
//
// **`id: 'manage'` ("Beheer") is this build's own explicit design
// choice, not literally named as a destination anywhere in the approved
// mockups or ticket text** — the current, explicit instruction names
// "Beheer" as one of the four items Werkvoorraad groups, but neither
// approved mockup shows what it should link to (the workqueue mockup's
// own dropdown shows only three rows; the older, superseded-for-navigation
// mockup shows "Beheer" as a bare top-level label with no visible
// destination of its own either). Mapped here to `/internal` itself
// (the existing, unchanged PLATFORM-11 role-aware overview that already
// lists every accessible module as a card) — the closest existing,
// already-built destination that matches "Beheer"'s own general-
// management meaning, reusing an existing route rather than inventing a
// new one. Flagged explicitly in this round's own report for
// confirmation or correction.
const INTERNAL_MODULES = [
  { id: 'coverage', label: 'Dekkingsoverzicht', href: '/internal/coverage', requiredRole: 'internal', placement: 'primary' },
  { id: 'onboarding-restaurant', label: 'Onboarding Restaurant', href: '/internal/onboarding-restaurant', requiredRole: 'internal', placement: 'primary' },
  { id: 'manage', label: 'Beheer', href: '/internal', requiredRole: 'internal', placement: 'workqueue', subtitle: 'Alle modules' },
  { id: 'import-inbox', label: 'Nieuwe aanleveringen', href: '/internal/import-inbox', requiredRole: 'internal', placement: 'workqueue', subtitle: 'Nieuwe bronnen' },
  { id: 'profile-drafts', label: 'Profielconcepten', href: '/internal/profile-drafts', requiredRole: 'internal', placement: 'workqueue', subtitle: 'Klaarzetten' },
  // BE-17/PLATFORM-06's existing `editor`-only Moderation module — route,
  // authorization, and data model completely unchanged. Per BE-20's own
  // "Visual contract": "gets no own top-level nav item and folds
  // functionally into the same Werkvoorraad → Beoordelen entry" — the
  // subtitle below is that same section's own suggested description,
  // verbatim.
  { id: 'moderation', label: 'Beoordelen', href: '/internal/moderation', requiredRole: 'editor', placement: 'workqueue', subtitle: "Menu's, profielen en eigenaarsclaims" },
];

/** The union of every section each of the roles individually unlocks — an
 * `internal`+`editor` account gets both sets, never just one (mirrors
 * src/lib/internalAuth.js's getAccessForRestaurant's own "strongest
 * applicable role" reasoning, generalized from one restaurant's write
 * access to "which nav items render"). Unchanged in shape/behavior from
 * before BE-20 — still a flat, role-filtered list; `placement` is only
 * ever read by `groupModulesByPlacement` below, a separate, later step,
 * so any existing caller that only needs "which modules can this account
 * see" keeps working exactly as it always did. */
function resolveVisibleModules(roles) {
  const hasInternal = isInternalOnly(roles);
  const hasEditor = isEditorRole(roles);
  return INTERNAL_MODULES.filter((m) => (m.requiredRole === 'internal' ? hasInternal : hasEditor));
}

/** Splits an already role-filtered module list (`resolveVisibleModules`'s
 * own output — this function never resolves roles itself) into
 * `{ primary, workqueue }` by each module's own `placement` field, both
 * arrays keeping `INTERNAL_MODULES`'s own original relative order. A
 * module with an unrecognized/missing `placement` appears in neither
 * array — fails closed to "not shown," never an assumed default
 * placement, so a future module added without an explicit `placement`
 * is visibly absent from testing rather than silently misplaced. */
function groupModulesByPlacement(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return {
    primary: list.filter((m) => m && m.placement === 'primary'),
    workqueue: list.filter((m) => m && m.placement === 'workqueue'),
  };
}

module.exports = {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  INTERNAL_MODULES,
  resolveVisibleModules,
  groupModulesByPlacement,
};
