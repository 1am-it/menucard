# Spec — Search and Filters

## Goal

Allow users to quickly narrow menu results without loading unnecessary data.

## Search should support

Where supported by the real dataset:

- dish names
- ingredients
- cuisine
- menu categories
- dietary terms
- restaurant names

## Primary filters

- Vandaag
- Lunch
- Diner
- Borrel
- Prijs
- Keuken
- Allergieën
- Nu open

## Price

Prefer dish-level price filtering when the data supports it.

Example ranges:

- € — budget
- €€ — gemiddeld
- €€€ — hoger
- €€€€ — luxe

Exact price ranges may be chosen later based on real menu distribution.

## Behaviour

Filters should:

- work on mobile
- not reload unrelated data
- be represented in URL/query state where practical
- support back/forward navigation
- avoid sending the entire menu dataset to the browser

## Data fetching

Prefer requests such as:

`/api/search?q=steak&meal=dinner&maxPrice=35`

The client should receive only fields required to render the current results.

## Pagination

Return a bounded result set.

Preferred behaviour:

- initial result page
- "Meer resultaten laden"
- or cursor-based pagination

Do not fetch every matching item at once.

## Empty-result transparency (PLATFORM-02)

When a search returns zero results, the response may include an optional
`lowCoverage` field:

```json
{ "results": [], "total": 0, "lowCoverage": { "relevantRestaurantCount": 3, "missingMenuDataCount": 3 } }
```

Omitted entirely when there's nothing honest to disclose (no restaurant
matches the request's cuisine/buurt/day/nowOpen filters at all, or every
matching restaurant already has menu data — a true no-dish-match). Computed
server-side in `src/services/dishSearch.js`, independent of `PLATFORM-01`'s
coverage dashboard. Every non-empty response is unaffected.
