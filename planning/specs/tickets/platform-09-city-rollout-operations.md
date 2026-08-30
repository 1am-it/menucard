# PLATFORM-09 — City Rollout Operations

## Depends on

`PLATFORM-01` (Breda baseline numbers to calibrate thresholds against).

## Objective

Turn Breda's one-off coverage baseline into a repeatable, concrete
launch-readiness checklist usable for any future city.

## User story

As the team deciding whether to launch MenuCard in a second city, I want a
concrete, numeric checklist informed by what actually worked for Breda,
rather than a subjective judgment call each time.

## Scope

- Define concrete per-metric thresholds (per
  `planning/specs/platform-city-rollout.md`) for what counts as
  "launch ready," calibrated against Breda's real `PLATFORM-01` numbers at
  the point Breda was considered usable.
- Document the operational steps a new city rollout requires (data sourcing,
  initial seeding, baseline measurement) at a planning level.

## Out of scope

- Actually launching a second city — this ticket produces the checklist and
  process, not an executed rollout.
- Legal/business operational concerns (contracts, licensing) outside of data
  coverage.
- Any new application code.

## Dependencies

Depends on `PLATFORM-01` existing so real numbers are available to calibrate
against, rather than inventing thresholds from nothing.

## Data model needs

None beyond what `PLATFORM-01`/`03` already define — this ticket is a
process/threshold document, not a new schema.

## Moderation/verification needs

None directly.

## Risks

- Setting thresholds that are either too strict (Breda itself might not have
  cleared them at launch) or too loose (a city launches with unusably sparse
  data) — must be grounded in Breda's actual historical numbers, not
  aspirational ones.

## Acceptance criteria

- [ ] A documented, reusable per-city readiness checklist with concrete
      thresholds exists.
- [ ] Thresholds are explicitly justified against Breda's real baseline
      numbers.
- [ ] No application code changes.

## Suggested order

Ninth ticket — first of the scale-out wave.
