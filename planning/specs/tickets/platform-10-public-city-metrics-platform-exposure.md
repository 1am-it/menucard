# PLATFORM-10 — Public-facing City Metrics / Platform Exposure

## Depends on

`PLATFORM-01` (metrics), `PLATFORM-04` (external API boundary decision),
`PLATFORM-09` (multi-city readiness framing).

## Objective

Decide what, if anything, from the internal coverage/metrics tooling is
worth exposing publicly, and expose it correctly if so — as a deliberate
product decision, not a default assumption.

## User story

As a visitor or partner, I might want to see how complete MenuCard's data is
for a given city, so I can judge whether to trust or rely on it — but only if
the team decides this is worth building.

## Scope

- Evaluate whether/which coverage metrics are appropriate to publish
  publicly (e.g. a simplified "X% of Breda restaurants covered" versus the
  full internal breakdown).
- If publishing, re-evaluate the chosen surface against the consumer-facing
  performance budget (`planning/decisions/003-performance-budget.md`) — it
  does not inherit the internal budget exemption from `PLATFORM-01`/`06`.
- If exposing any part of the API externally, do so only within the boundary
  already decided in `PLATFORM-04` — no new ad hoc external surface.

## Out of scope

- Full external API productization (docs, keys, terms of use, rate-limit
  tiers) — a larger, separate future decision, not assumed here.
- Any metric or endpoint not already covered by the `PLATFORM-04` boundary.

## Dependencies

Depends on `PLATFORM-01`, `PLATFORM-04`, and `PLATFORM-09` all existing
first — this is explicitly the last ticket in the initial roadmap.

## Data model needs

None new — exposes a subset of already-modeled data.

## Moderation/verification needs

None directly, though published metrics should reflect trust-aware data
once `PLATFORM-03` is fully wired through, not raw presence counts.

## Risks

- Publishing an internal-tooling-grade surface directly, without
  re-evaluating it against the consumer performance budget — the single
  biggest risk this ticket must guard against explicitly.
- Exposing more of the API than the `PLATFORM-04` boundary intended, under
  time pressure to "just ship the public page."

## Acceptance criteria

- [ ] An explicit decision is recorded on what (if anything) is published
      publicly.
- [ ] Anything published is re-evaluated against the consumer-facing
      performance budget, not grandfathered from its internal equivalent.
- [ ] No external surface exceeds the boundary decided in `PLATFORM-04`.

## Suggested order

Tenth ticket — last in the initial roadmap.
