# Decision — Separate Performance Expectations for Internal/Admin Surfaces

## Status

Accepted

## Context

`planning/decisions/003-performance-budget.md` and `planning/specs/performance.md`
define a performance budget (<250 KB initial transfer, no full dataset
shipped, minimal client JS, etc.) written entirely with the public,
consumer-facing discovery experience in mind (`/`, `/search`,
`/restaurant/[id]`, `/menu/[id]`).

The `PLATFORM-*` track introduces surfaces that are not part of that
discovery experience and are not used by the general public: a coverage
dashboard (`PLATFORM-01`), a moderation/review queue (`PLATFORM-06`), and
internal API tooling (`PLATFORM-05`). These surfaces legitimately need to
show more data at once (aggregate stats, pending-item queues, full listings
for an editor to act on) than the budget above was designed to allow, and
they are used by a small number of trusted operators, not by every visitor
on a slow mobile connection.

Neither existing document says whether the budget applies to these surfaces.
Left undecided, this could go wrong in either direction: internal tooling
either gets wrongly constrained in ways that make it less useful for the
people operating it, or the whole performance-first principle gets quietly
abandoned everywhere without anyone deciding that on purpose.

## Decision

The performance budget in `planning/decisions/003-performance-budget.md` and
`planning/specs/performance.md` applies, unchanged, to all consumer-facing
surfaces: everything in the `BE-*` track, plus any `PLATFORM-*` surface a
member of the public can reach (e.g. `PLATFORM-02`'s low-coverage messaging,
`PLATFORM-07`'s owner-claim flow, `PLATFORM-10`'s public city metrics if
published as a public page).

Internal/admin-only surfaces — surfaces reachable only by authenticated
operators or trusted editors, never by the general public — are exempt from
the <250 KB / no-full-dataset budget. They still follow the same underlying
principles in spirit (avoid unnecessary payload, avoid large new
dependencies, paginate large lists) but are not held to the same numeric
target, since their audience and usage pattern are different by design.

This applies to: `PLATFORM-01`'s dashboard, `PLATFORM-06`'s moderation
queue, and `PLATFORM-05`'s internal API tooling/UI, if any.

## Consequences

- Each `PLATFORM-*` ticket must state explicitly which category its surface
  falls into (consumer-facing vs. internal/admin), so this isn't left
  ambiguous ticket by ticket.
- A surface that starts as internal-only and later becomes public-facing
  (e.g. if `PLATFORM-10`'s metrics are published publicly) must be
  re-evaluated against the consumer-facing budget at that point, not
  grandfathered in under the relaxed internal standard.

## Rejected alternative

Apply the existing consumer-facing budget uniformly to every surface,
including internal tooling.

Reason: would either make internal tooling for a handful of operators
worse than it needs to be, or invite pressure to quietly ignore the budget
once it starts feeling unreasonable — better to make the exception explicit
and scoped than to leave it undecided.
