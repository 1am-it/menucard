// Kleurtaal v2 — which business states get which semantic status role.
// Deliberately CommonJS, same reasoning as internalNav.js/importInbox.js:
// directly testable via `node --test`, importable from 'use client' pages.
//
// A shared CSS class name is no proof that every use means the same thing,
// so each screen maps its own states here, per meaning. Conservative by
// design: a role other than 'neutral' is only returned where the design
// source (docs/guides/design-reference.md, "Kleurtaal v2") names that state
// explicitly:
//   positive — real approval or reachability (goedgekeurd, compleet, Nu open,
//              Bereikbaar, domain match, a successful password set);
//   blocked  — a real technical block or error (Niet bereikbaar, a failed
//              import run or request);
//   old / file — only the BE-23 source/menu states in
//              app/internal/source-workqueue/page.js.
// 'action' ("Actie nodig") is a reserved design role. Assigning it to a
// business state is a future product decision, so nothing here returns it.
// Presentation only: no state, permission or data changes.

'use strict';

/** Import inbox / onboarding review status. Only an internal approval is positive. */
function reviewStatusRole(status) {
  return status === 'approved_internal' ? 'positive' : 'neutral';
}

/** Data completeness of an imported candidate (list and detail alike). */
function qualityStatusRole(qualityStatus) {
  return qualityStatus === 'complete' ? 'positive' : 'neutral';
}

/** An import run: only a failed run is a real technical error. */
function importRunRole(status) {
  return status === 'failed' ? 'blocked' : 'neutral';
}

/** Creating a menu proposal from onboarding: only a failed request is an error. */
function proposalRequestRole(status) {
  return status === 'error' ? 'blocked' : 'neutral';
}

/** A Restaurant Profile Draft (active or discarded) is not an approval. */
function profileDraftRole() {
  return 'neutral';
}

/** Owner claim domain check: a match is positive, a mismatch is not decided. */
function domainMatchRole(domainMatch) {
  return domainMatch ? 'positive' : 'neutral';
}

module.exports = {
  reviewStatusRole,
  qualityStatusRole,
  importRunRole,
  proposalRequestRole,
  profileDraftRole,
  domainMatchRole,
};
