# BE-06 — Filters + URL State

## Depends on

BE-03

## Goal

Add/refine price, cuisine and allergy filtering on the new dish-search flow,
per `planning/specs/search-and-filters.md`, represented in URL/query state.

## Scope

- Price, cuisine, allergy (and existing meal-type/day/"nu open") filters
  wired into the BE-02b query endpoint — no client-side filtering of an
  already-fetched full list.
- Filter state reflected in the URL so results are deep-linkable and support
  browser back/forward.
- Mapping of any existing indexable routes/shared links onto the new URL
  scheme — do this deliberately, not as an afterthought.

## Out of scope

- Homepage integration (BE-04) — this ticket can land against the BE-03
  results page on its own route first.
- Visual theme change.

## Key risk

**SEO/deeplinks.** Once filters move into URL state, any previously shared or
indexed link must still resolve sensibly. Treat the URL scheme as a public
contract, not an implementation detail.

## Acceptance criteria

- [ ] Filters work on mobile.
- [ ] Filters do not reload unrelated data or refetch the full dataset.
- [ ] Filter state is represented in the URL and restorable from it
      (reload, back/forward, shared link all work).
- [ ] Existing indexable routes have a deliberate mapping onto the new
      scheme (redirect, alias, or documented deprecation — not silent 404).
