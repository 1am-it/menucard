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
