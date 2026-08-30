# BE-02c — Dish Ranking and Result Mapping

## Depends on

BE-02b

## Goal

Matching a query term is not enough — decide how competing matches are
ordered, and implement it server-side so BE-03 doesn't have to.

## Scope

- Document explicit ranking rules, e.g.: exact dish-name match ranks above
  ingredient/description match, which ranks above tag match, which ranks
  above restaurant-name match. Ties broken by a defined secondary rule
  (e.g. distance, then rating, then name).
- Implement this ranking inside the BE-02b query layer.
- Map ranked results into the BE-02a dish-result shape ready for direct
  rendering by BE-03.

## Out of scope

- Any client-side re-sorting — if BE-03 needs to resort, that's a sign
  ranking belongs server-side and wasn't fully covered here.
- Personalization/recommendations (explicitly a non-goal per
  `planning/specs/dish-first-discovery.md`).

## Key risk

Implicit/undocumented ranking is where "search works" quietly becomes "search
returns confusing results" — this must be a written rule set, not
emergent behaviour from whatever order the data happens to be in.

## Acceptance criteria

- [ ] Ranking rules are written down (which match type wins, tie-breakers).
- [ ] Ranking is implemented in the BE-02b query layer, not duplicated or
      overridden client-side.
- [ ] A manual check against a few real queries (e.g. "steak", "vegan",
      a restaurant name) produces a sensible order.
