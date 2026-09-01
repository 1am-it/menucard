# Spec — City Coverage Baseline & Rollout Readiness

**Terminology note (2026-09-01):** `[[011-market-foundation-and-international-growth]]`
introduces "market"/`market_id` as the neutral technical concept for any
future launch area, with "city"/"stad" reserved for what visitors actually
see. This spec's use of "city" throughout remains accurate today — Breda
is the first market, and it is a city — this note exists only so "city"
here is read as the current, concrete instance of the more general future
"market" concept, not as a contradiction of it. Nothing in this spec's
scope, metrics, or thresholds changes.

## Goal

Define what "launch ready" means for a city, in measurable terms, before
MenuCard expands beyond Breda — and establish a repeatable coverage baseline
per city rather than a one-off Breda-specific calculation.

## Coverage metrics (per the reference mockup)

For a given city, track at minimum:

- % of restaurants with basic info (name, address, hours, cuisine)
- % of restaurants with any digitized menu data
- % of menu items with a price
- % of restaurants with a confirmed reservation method

Each metric should also be breakable down by cuisine/neighbourhood (e.g. the
mockup's "Italiaans en Grill & Steak hebben nog extra datadekking nodig"),
since city-wide averages can hide category-level gaps that matter to a user
searching that cuisine specifically.

## Baseline vs. live dashboard

`PLATFORM-01` produces two related but distinct things:

1. **A baseline** — a recorded snapshot of these metrics at a point in time
   for Breda, written down (not just computed on demand), so later progress
   can be measured against it the same way `docs/changelog/README.md`'s
   release log gives the `BE-*` track a fixed reference point.
2. **A read-only dashboard** — a live view recomputing the same metrics from
   current data, for ongoing monitoring.

Both are needed: the baseline anchors "have we actually improved," the
dashboard shows "where do we stand right now."

## Launch readiness (decided in PLATFORM-09)

A city is not "launch ready" purely on restaurant count. Coverage
*usability* matters more than volume: a city with 200 restaurants and 20%
menu coverage is less launch-ready than one with 80 restaurants and 70%
coverage. **Concrete per-metric thresholds, the Go/Conditional-go/No-go
tiers, and the operational process are now decided** — see
`[[012-city-market-readiness-thresholds]]` and
`docs/guides/city-rollout-playbook.md`. Calibrated against Breda's real
`PLATFORM-01` baseline only, never against Supabase's `PLATFORM-05`–`07`
test data. Note the explicit finding there: Breda itself does not clear
its own proposed bar on two of the four metrics — a deliberate disclosure,
not an oversight.

## Requirements

- Metrics must be computed from the same underlying data trust model
  (`platform-trust-model.md`) once it exists — e.g. "confirmed reservation
  method" should mean provenance-backed confirmation, not merely a
  non-null field.
- Category/neighbourhood breakdowns must degrade gracefully for a city with
  too little data to break down meaningfully (e.g. a brand-new city with 5
  restaurants shouldn't show a confusing 15-category breakdown).
- The dashboard is an internal/admin surface — see
  [[009-consumer-vs-internal-performance-budget]] — unless and until
  `PLATFORM-10` decides to publish a public-facing version.

## Out of scope for this spec

- The actual dashboard UI/implementation (`PLATFORM-01`, done).
- The concrete numeric launch-readiness thresholds themselves — decided in
  `[[012-city-market-readiness-thresholds]]`, not restated here to avoid
  the two documents drifting apart.
- Any second-city operational/logistics planning (sourcing, legal, etc.) —
  purely a data-coverage concern here.
- Whether the application can actually serve a second market at all —
  that is `[[011-market-foundation-and-international-growth]]`'s and
  `planning/architecture/market-data-foundation-plan.md`'s concern, not
  this spec's.
