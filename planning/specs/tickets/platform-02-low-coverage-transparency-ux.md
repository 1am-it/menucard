# PLATFORM-02 — Low-coverage Transparency UX

## Depends on

`PLATFORM-01` (uses its coverage metrics to know what counts as
"low-coverage").

## Objective

Tell consumers honestly when data for their search is incomplete, instead of
showing a generic empty state or silently hiding the gap.

## User story

As a visitor searching for "Italiaans" in Breda, when coverage for that
cuisine is low, I want to see a clear, specific message about that instead of
a confusing empty or misleadingly short result list.

## Scope

- Consumer-facing messaging for low/zero-coverage search results and
  categories, per the mockup's "We missen nog menudata voor Italiaanse
  restaurants" pattern.
- Extends the existing empty-state requirement in
  `planning/specs/dish-first-discovery.md`.
- At most, a link/pointer toward a future contribution mechanism — not the
  mechanism itself.

## Out of scope

- **Any actual contribution flow or form.** This is `PLATFORM-08` and does
  not exist yet when this ticket ships. A "help us improve this" link may
  point at a placeholder or simple contact channel at most, not a built
  feature.
- Changing ranking, search behavior, or the empty-state logic for
  already-well-covered categories.
- Any new data model or write path.

## Dependencies

`PLATFORM-01`'s metrics inform what threshold counts as "low coverage."

## Data model needs

None — reads existing data plus `PLATFORM-01`'s computed metrics.

## Moderation/verification needs

None.

## Risks

- Scope creep into building a contribution flow prematurely — explicitly
  guarded against above per the approved direction that public contribution
  is not an early step.
- Overly alarmist messaging could make well-covered categories look
  incomplete if the low-coverage threshold isn't calibrated against real
  `PLATFORM-01` numbers.

## Acceptance criteria

- [ ] Low-coverage categories/searches show specific, honest messaging
      instead of a generic empty state.
- [ ] No contribution form, submission mechanism, or write path is
      introduced.
- [ ] Subject to the existing consumer-facing performance budget
      (`planning/decisions/003-performance-budget.md`) — this is a
      consumer-facing surface, unlike `PLATFORM-01`.

## Suggested order

Second ticket. Small and independent of the modeling/architecture waves that
follow.
