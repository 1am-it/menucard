# BE-05 — Lightweight Restaurant Menu

## Depends on

BE-02b (hard requirement — see [[004-server-side-search-before-restyle]]),
BE-07

## Goal

Refactor the restaurant detail/menu experience toward the lightweight
universal menu view in `planning/specs/restaurant-menu.md` and
`docs/mockups/restaurant-menu-v1.png`.

## Scope

- Category-grouped, text-first menu view (the existing `/menu/[id]` page is
  already structurally close to this — treat this primarily as adapting it
  to the BE-02b data layer plus any remaining structural gaps, not a
  rebuild).
- Reservation CTA wired to BE-07.
- Optional secondary info (opening hours, address, cuisine, distance,
  website, last-updated) shown only when actually available and trustworthy.

## Out of scope

- Visual theme change — do this restyle once, as part of or after the THEME
  ticket, not twice.

## Key risk

Low relative to other tickets, since the existing implementation is already
close. The main risk is doing the restyle here *and* again in the THEME
ticket — coordinate the two rather than duplicating effort.

## Acceptance criteria

- [ ] Matches `planning/specs/restaurant-menu.md`.
- [ ] No dish images required.
- [ ] Reservation CTA visible, correct, and sourced from BE-07.
- [ ] Secondary info only shown when the underlying field is present.
