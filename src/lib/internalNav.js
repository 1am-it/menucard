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

// Compact internal navigation (issue #53). Primary navigation is exactly
// three task-oriented choices: `Werkvoorraad | Nieuwe import | Beheer`.
//
// `placement` decides where a module shows:
//  - `'primary'` — inline in the top bar (Werkvoorraad, Nieuwe import,
//    Beheer).
//  - `'beheer'` — listed on the Beheer overview (/internal) only:
//    overview, history, settings and reference data, never a daily
//    action list.
//  - `'contextual'` — no nav and no overview card; offered only as a
//    follow-up action where the flow asks for it (Onboarding Restaurant,
//    for an imported website that cannot reliably be linked to an
//    existing restaurant). The route itself is unchanged.
//
// `matches` lists extra path prefixes that keep the item marked current
// (e.g. the pre-existing batch route that Nieuwe import now fronts), so
// every old link still works and still orients the user.
//
// Nothing here grants access: every route keeps its own server-side
// authorization; this only classifies what to show.
const INTERNAL_MODULES = [
  { id: 'workqueue', label: 'Werkvoorraad', href: '/internal/source-workqueue', requiredRole: 'internal', placement: 'primary', subtitle: 'Wat nu actie van een medewerker nodig heeft', matches: ['/internal/source-triage', '/internal/menu-concepts', '/internal/profile-drafts', '/internal/import-inbox', '/internal/onboarding-restaurant', '/internal/onboarding-menu'] },
  { id: 'new-import', label: 'Nieuwe import', href: '/internal/nieuwe-import', requiredRole: 'internal', placement: 'primary', subtitle: 'Websites importeren', matches: ['/internal/source-triage/batch'] },
  { id: 'manage', label: 'Beheer', href: '/internal', requiredRole: 'staff', placement: 'primary', subtitle: 'Overzicht, historie en referentiegegevens', matches: ['/internal/coverage', '/internal/moderation'] },
  { id: 'coverage', label: 'Dekkingsoverzicht', href: '/internal/coverage', requiredRole: 'internal', placement: 'beheer', subtitle: 'Overzicht van restaurants en bronnen' },
  { id: 'import-inbox', label: 'Nieuwe aanleveringen', href: '/internal/import-inbox', requiredRole: 'internal', placement: 'beheer', subtitle: 'Aangeleverde bronnen' },
  { id: 'source-triage', label: 'Bronnen beoordelen', href: '/internal/source-triage', requiredRole: 'internal', placement: 'beheer', subtitle: 'Bronvoorstellen en historie' },
  { id: 'menu-concepts', label: 'Menuconcepten beoordelen', href: '/internal/menu-concepts', requiredRole: 'internal', placement: 'beheer', subtitle: 'Concepten controleren en intern goedkeuren' },
  { id: 'profile-drafts', label: 'Profielconcepten', href: '/internal/profile-drafts', requiredRole: 'internal', placement: 'beheer', subtitle: 'Klaarzetten voor publicatie' },
  { id: 'moderation', label: 'Beoordelen', href: '/internal/moderation', requiredRole: 'editor', placement: 'beheer', subtitle: "Menu's, profielen en eigenaarsclaims" },
  { id: 'onboarding-restaurant', label: 'Onboarding Restaurant', href: '/internal/onboarding-restaurant', requiredRole: 'internal', placement: 'contextual', subtitle: 'Alleen als een restaurant niet gekoppeld kan worden' },
];

/** The union of every section each of the roles individually unlocks — an
 * `internal`+`editor` account gets both sets. `requiredRole: 'staff'`
 * means either of the two (Beheer is the editor-only account's way in). */
function resolveVisibleModules(roles) {
  const hasInternal = isInternalOnly(roles);
  const hasEditor = isEditorRole(roles);
  return INTERNAL_MODULES.filter((m) => {
    if (m.requiredRole === 'internal') return hasInternal;
    if (m.requiredRole === 'editor') return hasEditor;
    return hasInternal || hasEditor;
  });
}

/** Splits an already role-filtered module list into `{ primary, beheer }`
 * by `placement`, keeping `INTERNAL_MODULES`'s order. `contextual` and
 * unrecognized placements appear in neither array — fails closed to "not
 * shown." */
function groupModulesByPlacement(modules) {
  const list = Array.isArray(modules) ? modules : [];
  return {
    primary: list.filter((m) => m && m.placement === 'primary'),
    beheer: list.filter((m) => m && m.placement === 'beheer'),
  };
}

/** True when `pathname` is the module's page, one of its subpages, or a
 * path it fronts (`matches`). The more specific primary item wins: a path
 * claimed by a longer matching href/prefix of another module is not
 * current here. */
function isCurrentModule(pathname, module, allModules) {
  if (typeof pathname !== 'string' || !module) return false;
  const score = (m) => {
    const ps = [m.href, ...(m.matches || [])];
    let best = -1;
    for (const p of ps) {
      if (pathname === p || (p !== '/internal' && pathname.startsWith(`${p}/`))) best = Math.max(best, p.length);
    }
    return best;
  };
  const own = score(module);
  if (own < 0) return false;
  return !(allModules || []).some((m) => m !== module && score(m) > own);
}

module.exports = {
  isEditorRole,
  isOwnerRole,
  hasAnyKnownRole,
  INTERNAL_MODULES,
  resolveVisibleModules,
  groupModulesByPlacement,
  isCurrentModule,
};
