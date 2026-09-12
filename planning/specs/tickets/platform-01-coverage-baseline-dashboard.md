# PLATFORM-01 — Coverage Baseline + Read-only Dashboard

## Depends on

None. Computed entirely from the existing static dataset.

## Objective

Establish a recorded, dated coverage baseline for Breda, and a live
read-only internal dashboard that recomputes the same metrics on demand.

## User story

As the team deciding what to build next in the `PLATFORM-*` track, I want to
know exactly how complete our current data is — and by cuisine/neighbourhood,
not just city-wide — so prioritization is based on real numbers, not
impressions.

## Scope

- Compute: % restaurants with basic info, % with menu data, % dishes with
  price, % with confirmed reservation method (per
  `planning/specs/platform-city-rollout.md`).
- Break metrics down by cuisine and/or neighbourhood where the data supports
  it.
- Record the computed numbers as a dated, written baseline (not only a live
  view).
- Build an internal, read-only dashboard UI recomputing the same metrics.

## Out of scope

- Any write path or data correction — read-only.
- Public/consumer-facing exposure of this dashboard (see `PLATFORM-10`).
- Trust/provenance-aware metrics (depends on `PLATFORM-03`; this ticket uses
  simple presence/non-null checks, documented as such).
- Second-city data — Breda only.

## Dependencies

None on other `PLATFORM-*` tickets. Independent of the `BE-*` track.

## Data model needs

None — reads existing `data/restaurants.json` / `data/menus.json` shape
as-is.

## Moderation/verification needs

None.

## Risks

- Computing metrics from raw presence/non-null checks (since
  `PLATFORM-03`'s trust model doesn't exist yet) may overstate "confirmed"
  data quality — this must be stated explicitly in the baseline write-up,
  not silently implied to be trust-verified.
- Category/neighbourhood breakdowns can mislead on very small sample sizes
  (e.g. a cuisine with 2 restaurants) — must degrade to a plain count instead
  of a misleading percentage below a reasonable sample threshold.

## Acceptance criteria

- [ ] A dated, written baseline document exists recording Breda's current
      coverage metrics.
- [ ] An internal dashboard recomputes the same metrics live.
- [ ] Metrics are broken down by cuisine/neighbourhood where sample size
      allows.
- [ ] No schema change, no persistence layer, no authentication introduced.
- [ ] Explicitly documented that metrics reflect data presence, not
      provenance-verified trust (until `PLATFORM-03` lands).

**Correction (2026-09-12): the "no authentication introduced" line above is
no longer accurate.** It was true and correctly scoped at the time this
ticket was written — `PLATFORM-05`, which introduced this project's
internal-only authentication mechanism, did not exist yet. `/internal/coverage`
has since been gated behind the exact same `authenticateInternalRequest`/
`isInternalOnly('internal')` check every other internal page already uses,
via a new `GET /api/internal/v1/coverage` route — no new role, no bypass,
no different mechanism. Nothing else about this ticket's original scope
(the metrics themselves, the breakdowns, the baseline document) changed.

## Suggested order

First ticket in the `PLATFORM-*` track. No prerequisites.
