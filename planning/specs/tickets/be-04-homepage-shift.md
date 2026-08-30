# BE-04 — Homepage Shift

## Depends on

BE-02b (hard requirement — see [[004-server-side-search-before-restyle]]),
BE-03, BE-06

## Goal

Make search the primary homepage action, per
`docs/mockups/homepage-v1.png` and `planning/specs/dish-first-discovery.md`.
Restaurant browsing may remain as a secondary route.

## Scope

- New hero copy and layout: headline "Wat wil je vanavond eten?", supporting
  text "Zoek in de menukaarten van restaurants in Breda", search placeholder
  "Zoek steak, sushi, risotto, vegan…".
- Search bar wired to the BE-03/BE-06 result flow.
- Decide explicitly what happens to the current guided day/meal flow and its
  persisted `localStorage` state (`bredaeats_filters_v3`): remove
  deliberately, or keep behind a route variant/feature flag. Do not abandon
  it silently mid-migration.

## Out of scope

- Visual theme change — this ticket changes structure/copy, not the color
  system. It may land before or after the THEME ticket per
  `planning/CONTEXT.md`'s sequencing note, but should not bundle the two
  changes into one diff.
- Reservation CTA logic (BE-07).

## Key risk

Breaking currently-working persisted user state or bookmarked flows that
depend on the existing guided homepage.

## Acceptance criteria

- [ ] Search is the primary above-the-fold action.
- [ ] Homepage is built against the BE-02b server-side layer, not static
      JSON.
- [ ] The fate of the old guided flow is explicit (removed with a decision
      note, or preserved behind a flag/route) — not just deleted or left
      half-working.
- [ ] Popular-cuisine shortcuts (per mockup) link into the BE-03 result flow.
