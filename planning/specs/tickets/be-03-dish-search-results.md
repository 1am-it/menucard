# BE-03 — Dish Search Results

## Depends on

BE-02b, BE-02c

## Goal

Ship the primary dish-first search results UI, per
`planning/specs/dish-first-discovery.md` and
`docs/mockups/search-results-v1.png`.

## Scope

- Text-first result list: dish name, price, restaurant, short description,
  dietary tags, distance/open-status where reliable, "Bekijk menu" action —
  in that priority order.
- Pagination / "Meer resultaten laden" against the bounded server response
  from BE-02b.
- Empty and no-result states.
- **Keep the existing dark theme.** Do not restyle as part of this ticket —
  see [[005-decouple-theming-from-dish-first]].

## Out of scope

- Filters beyond what's needed to demonstrate the result list (full filter
  UI + URL state is BE-06).
- Any homepage change (BE-04).
- Visual theme change (THEME ticket).

## Key risk

Conflating this with the theme change. If a reviewer can't tell whether a
diff is "new dish-result UI" or "restyle", scope has leaked — split it back
out.

## Acceptance criteria

- [ ] Result list matches the information hierarchy in
      `planning/specs/dish-first-discovery.md`.
- [ ] No dish or restaurant photography in the result list.
- [ ] Works on narrow mobile screens.
- [ ] Pagination works against the real server response, not a client-side
      slice of a fully-fetched array.
- [ ] Empty/no-result state is handled explicitly, not left blank.
- [ ] Visual theme is unchanged from what existed before this ticket.
