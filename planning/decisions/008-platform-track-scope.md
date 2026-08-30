# Decision — Introduce a Parallel PLATFORM-* Track

## Status

Accepted

## Context

MenuCard's `BE-*` track (BE-01 through BE-08, all done) migrated the
Breda-focused consumer app from restaurant-first browsing to dish-first
search. That work assumed, throughout, a fully static data layer: two JSON
files checked into git, no backend, no persistence, no write path, no
authentication.

The product direction now also includes evolving MenuCard into a multi-city
horeca data platform: collecting and verifying restaurant/menu data across
cities beyond Breda, exposing it through an internal (and eventually
external) API, and accepting contributions from restaurant owners and the
community rather than relying solely on manual/scraped updates.

This is a different kind of change than anything in the `BE-*` track. It
requires:

- persistent, write-capable storage where none exists today
- authentication/identity, which does not exist today
- a moderation/trust model for data that is no longer solely first-party
- planning explicitly scoped beyond a single city

Folding this into the `BE-*` sequence would misrepresent it as a continuation
of the consumer dish-first migration, when it is a distinct architectural and
product expansion with its own risk profile.

## Decision

Track this work as a new, separate ticket sequence: `PLATFORM-01` through
`PLATFORM-10`, documented in `planning/architecture/platform-plan.md`. It
runs in parallel with, and does not reorder or block, the `BE-*` sequence.

Wave order (read-only first, modeling/architecture second, internal write
path third, external-facing contribution flows last):

1. `PLATFORM-01` — Coverage baseline + read-only dashboard
2. `PLATFORM-02` — Low-coverage transparency UX
3. `PLATFORM-03` — Provenance/trust data model
4. `PLATFORM-04` — Persistence + internal/external API architecture decision
5. `PLATFORM-05` — Internal API foundation
6. `PLATFORM-06` — Moderation/review queue
7. `PLATFORM-07` — Owner claim and identity verification
8. `PLATFORM-08` — Community micro-task contributions
9. `PLATFORM-09` — City rollout operations
10. `PLATFORM-10` — Public-facing city metrics / platform exposure

Public contribution (`PLATFORM-08`) is deliberately not an early ticket —
persistence, the trust model, an internal API and a moderation queue must
exist first so public input has somewhere safe to land.

## Consequences for existing docs

- `CLAUDE.md`'s mission statement is amended to acknowledge the multi-city
  platform direction, since it previously implied Breda as the product's
  permanent scope.
- `planning/specs/dish-first-discovery.md` lists "user-generated reviews" as
  a non-goal for the dish-first phase. Community micro-task contributions
  (`PLATFORM-08`) are not reviews, but are user-generated content, so that
  non-goal is amended with a dated carve-out rather than silently read as
  either covering or ignoring this new scope. The dish-first phase's non-goal
  still stands for anything resembling reviews/ratings — that remains out of
  scope for both tracks.
- `planning/decisions/003-performance-budget.md`'s budget was written with
  only consumer-facing surfaces in mind. See
  [[009-consumer-vs-internal-performance-budget]] for the explicit amendment
  needed once `PLATFORM-01`/`06` introduce admin/internal surfaces.

## Rejected alternative

Add these tickets to the end of the `BE-*` sequence (e.g. `BE-09` onward).

Reason: implies this is a continuation of the same migration with the same
assumptions (static data, no auth, single city), which is false for nearly
every ticket in this track. A separate track makes the different risk
profile visible rather than hidden inside a familiar numbering scheme.
