# Dish Search Ranking (BE-02c)

Documents the ranking rules implemented in `src/services/dishSearch.js`
(`getMatchTier` + the sort in `searchDishes`). This complements
[dish-result-shape.md](./dish-result-shape.md), which defines *what* a
result contains; this file defines *what order* results come back in.

Ranking runs entirely server-side, inside the `/api/search` query layer.
Nothing re-sorts results client-side — a client that needs a different order
should ask the endpoint for one, not resort what it received.

## Tiers

When a search query (`q`, 2+ characters after trimming) is present, every
surviving dish (after the hard filters below) is assigned exactly one tier —
the best one it qualifies for:

| Tier | Meaning | Example (`q = "steak"`) |
|------|---------|--------------------------|
| 0 | Exact dish-name match (case-insensitive, full string) | dish named exactly "Steak" |
| 1 | Dish name contains the query | "Ribeye Steak 300g" |
| 2 | Description, supplement note, or wine-pairing suggestion contains the query | desc: "Malse steak van de grill" |
| 3 | A tag contains the query | tag: "steak-special" |

A dish matching none of the above is excluded from the results entirely —
it is not given a lowest tier, it simply isn't a match.

**Amendment (BE-13): a dish's own restaurant name is no longer a match
field.** A tier 4 ("Restaurant name contains the query") previously
existed here and matched any dish belonging to a restaurant whose name
contained the query, regardless of whether the dish's own name,
description, supplement note, wine-pairing suggestion, or tags matched
anything. Verified against real data before removal: `q = "Bardot"`
against restaurant 6 ("Brasserie Bardot", 111 dishes across its 4 menus)
returned 111 results, of which 110 matched only via this restaurant-name
tier and just 1 ("Café Spécial", a real description match) was a genuine
content match — effectively returning the restaurant's entire menu under
a query that named the restaurant, not a dish. Restaurant-name search was
never this endpoint's job to begin with — it already, independently
lives in `src/services/restaurantIndex.js`'s own `searchRestaurants()` /
`getMatchTier()`, which this change does not touch. A dish now needs a
match on one of its own fields (tiers 0-3) to appear in `Gerechten
gevonden`, full stop; a restaurant-name-only "match" produces zero dish
results, no matter how the restaurant name relates to the query. See
`planning/specs/tickets/be-13-remove-restaurant-name-only-dish-matches.md`
for the full rationale, including why a mixed query like `q = "Bardot
friet"` is a distinct, separately-scoped problem this change does not
solve (it returns 0 results both before and after this amendment).

When there is no query (or it's under 2 characters, matching the same
minimum-length convention used elsewhere in the app), every dish is treated
as tier 0 and ordering falls through entirely to the tie-break below. This
replaces the implicit dataset-iteration order from BE-02b with a
deterministic one.

## Tie-break (within the same tier)

1. **Distance** — ascending, when both dishes have a non-null
   `distanceMeters`. No restaurant currently has location data, so
   `distanceMeters` is always `null` and this step is presently a no-op. It
   stays first in the tie-break order so it activates automatically once a
   location field is added, without another ranking change.
2. **Restaurant name** — alphabetical (`localeCompare`, Dutch locale).
3. **Dish name** — alphabetical (`localeCompare`, Dutch locale).

A **rating** tie-break was suggested during planning but is not implemented:
no restaurant record has a rating field today. Fabricating one was rejected
— add this step only once real rating data exists.

## What ranking deliberately ignores

- **Price** is never a ranking input. It's a hard filter (`maxPrice`) only.
  A "sort by price" feature, if wanted, is a distinct sort mode for
  BE-03/BE-06 to add — not part of relevance ranking.
- **Allergens** are never a ranking input, only a hard filter
  (`excludeAllergens`). The known `allergens: []` ambiguity (unknown vs.
  confirmed-none, see dish-result-shape.md) is unaffected by ranking.
- **`category`** (e.g. "Hoofdgerechten") is not a searched/ranked field. The
  ticket that defined these tiers named name/description/tag only (see the
  BE-13 amendment above for why restaurant name, once also a match field,
  no longer is).
- **Accent-insensitive matching** (e.g. a query of "cafe" matching "café")
  is not implemented. This isn't a regression — no prior code did this
  either — but it's a known gap, not a handled case.
