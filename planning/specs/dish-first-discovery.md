# Spec — Dish-first Discovery

## Goal

Make dishes, rather than restaurant cards, the primary unit of discovery.

## User story

As a visitor, I want to search for what I feel like eating so that I can compare
actual dishes and prices across restaurants.

## Homepage

Primary headline:

> Wat wil je vanavond eten?

Supporting text:

> Zoek in de menukaarten van restaurants in Breda

Primary search placeholder:

> Zoek steak, sushi, risotto, vegan…

## Result hierarchy

Each dish result should prioritize information in this order:

1. Dish name
2. Price
3. Restaurant
4. Short description
5. Relevant dietary/category tags
6. Distance/open status where reliable
7. "Bekijk menu" action

Restaurant branding should not visually overpower the dish.

## Example result

Ribeye 300g                         €34,50  
Con Fuego · Steakhouse  
Ribeye van de grill · chimichurri  
Rundvlees · Glutenvrij  
600 m · Nu open

Bekijk menu →

## Requirements

- No dish photography in result listings.
- No restaurant photography in result listings.
- Search must work at dish/menu-item level.
- Prices should be immediately visible.
- Results must remain useful on narrow mobile screens.
- Empty and no-result states must be handled gracefully.
- Existing restaurant browsing may remain available as a secondary route.

## Non-goals

This phase does not require:

- social functionality
- advanced recommendations
- user-generated reviews
- image galleries
- elaborate personalization

### Note (2026-08-30) — scope of "user-generated reviews"

The `PLATFORM-*` track (see `planning/architecture/platform-plan.md`)
introduces community micro-task contributions (`PLATFORM-08`) — small,
structured confirmations/corrections to factual data (opening hours, price,
reservation method), not reviews, ratings, or opinion content. That remains
out of scope for both tracks. Structured contribution to factual data is a
deliberate, separately-planned exception to this non-goal, not a silent
reversal of it — see [[008-platform-track-scope]].
