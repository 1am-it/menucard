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

// Every existing internal module the nav can link to, in the fixed
// display order PLATFORM-11 specifies, each tagged with the exact
// server-side role its own route/API already requires (see PLATFORM-11's
// route/role matrix). Adding a future page here is a deliberate
// PLATFORM-11 "Phase 4" step — never automatic, never derived from the
// roles array itself.
const INTERNAL_MODULES = [
  { id: 'import-inbox', label: 'Import Inbox', href: '/internal/import-inbox', requiredRole: 'internal' },
  { id: 'profile-drafts', label: 'Restaurant Profile Drafts', href: '/internal/profile-drafts', requiredRole: 'internal' },
  { id: 'coverage', label: 'Coverage Dashboard', href: '/internal/coverage', requiredRole: 'internal' },
  { id: 'moderation', label: 'Moderation', href: '/internal/moderation', requiredRole: 'editor' },
  // BE-17 — phase 1 deliberately shows this card to `internal` only (the
  // role that creates a proposal), using the existing single-role
  // contract unchanged. Making it also visible to an `editor`-only
  // account is explicitly deferred, later work — see
  // planning/specs/tickets/be-17-menu-proposal-snapshot-foundation.md.
  { id: 'onboarding-menu', label: 'Onboarding Menu', href: '/internal/onboarding-menu', requiredRole: 'internal' },
];

// The union of every section each of the roles individually unlocks — an
// `internal`+`editor` account gets both sets, never just one (mirrors
// src/lib/internalAuth.js's getAccessForRestaurant's own "strongest
// applicable role" reasoning, generalized from one restaurant's write
// access to "which nav items render").
function resolveVisibleModules(roles) {
  const hasInternal = isInternalOnly(roles);
  const hasEditor = isEditorRole(roles);
  return INTERNAL_MODULES.filter((m) => (m.requiredRole === 'internal' ? hasInternal : hasEditor));
}

module.exports = {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  INTERNAL_MODULES,
  resolveVisibleModules,
};
