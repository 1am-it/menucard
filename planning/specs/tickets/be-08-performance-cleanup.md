# BE-08 — Performance Cleanup

## Depends on

All prior tickets

## Goal

Remove unnecessary asset/dependency weight and confirm the new flow stays
within the performance budget in `planning/specs/performance.md`, measured
against a real baseline.

## Scope

- Audit final bundle size, dependency weight, and payload sizes across the
  new dish-search flow.
- Compare against the analytics/performance baseline captured before BE-03
  shipped (per `planning/CONTEXT.md`'s technical principles) — without this
  baseline, "faster" and "better conversion" are unverifiable claims.
- Remove any leftover dead code from the old guided-flow homepage or
  client-side full-dataset imports, once BE-04 has made a deliberate call on
  their fate.

## Out of scope

- New features. This ticket only removes weight and validates budgets.

## Key risk

Skipping the baseline measurement (should have been captured before BE-03)
makes this ticket unable to prove impact — if that baseline was missed,
capture what can still be reconstructed and flag the gap explicitly rather
than asserting an improvement without evidence.

## Acceptance criteria

- [ ] Initial transferred data is under the target budget
      (`planning/specs/performance.md`) where realistically possible.
- [ ] No route ships the full menu dataset to the client.
- [ ] Comparison against baseline is documented, including an explicit note
      if the baseline is incomplete.
- [ ] Dead code from the pre-migration flow is removed once BE-04's decision
      on the old flow's fate has been executed.
