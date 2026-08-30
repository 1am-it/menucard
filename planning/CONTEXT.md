# Planning Context

This directory contains product requirements, architecture plans and durable
decisions for the BredaEats dish-first redesign.

Design references live under:

`docs/mockups/`

When a mockup is available, treat it as UX direction rather than a pixel-perfect
implementation requirement.

## Current direction

BredaEats should evolve from:

restaurant → menu → dish

toward:

search → dish → restaurant/menu → reservation

The existing application should be evolved, not rewritten.

## Desired user flow

1. User opens BredaEats.
2. User searches for a dish, ingredient or cuisine.
3. BredaEats shows matching dishes.
4. Each result shows:
   - dish name
   - price
   - restaurant
   - short description
   - relevant dietary tags
   - distance/open status when available
5. User opens the restaurant menu.
6. User reserves through the correct reservation method.

## Example

Search:

`steak`

Result:

Ribeye 300g — €34,50  
Con Fuego · Steakhouse  
Ribeye van de grill · chimichurri  
Rundvlees · Glutenvrij  
600 m · Nu open

Bekijk menu →

## Linear sequence (revised 2026-08-30 — THEME landed early)

BE-01 — Audit + migration plan (done)  
BE-02a — Data model repair (done)  
BE-02b — Server-side search / data access layer (done)  
BE-02c — Dish ranking and result mapping (done)  
BE-03 — Dish search results (done)  
THEME — Theme token system: light + dark, user-selectable (done — see
[[006-theme-token-system-implemented-early]])  
BE-06 — Price / cuisine / allergy filters + URL state (done)  
BE-04 — Text-first homepage (done — see [[007-homepage-shift]])  
BE-07 — Reservation routing (done)  
BE-05 — Lightweight restaurant menu (done)  
BE-08 — Performance cleanup (done — see [[007-homepage-shift]])

THEME was originally sequenced after BE-06/BE-04/BE-07/BE-05 (see
[[005-decouple-theming-from-dish-first]]) on the assumption it would mean a
one-way flip of already-restructured pages from dark to light. When actually
scoped, it turned out to be additive instead — a token layer plus both a
light and a dark palette plus a user toggle, applied to the existing,
structurally unchanged pages — so it was implemented ahead of schedule at
explicit user direction. See
[[006-theme-token-system-implemented-early]] for the full reasoning. The
remaining rationale below still governs BE-06 through BE-08.

Rationale for the remaining order: ship the primary dish-search experience
against a real server-side query layer (done), then refine (filters,
homepage, reservation routing, menu restyle). Server-side search (BE-02b) is
a hard prerequisite for BE-04 and BE-05 — see
[[004-server-side-search-before-restyle]].

Do not implement multiple tickets implicitly.

Each ticket should be independently reviewable and deployable where practical.

BE-04 and BE-05's restyling work should extend the token system THEME
introduced rather than reintroducing hardcoded colors. Use feature flags or
separate route variants where old and new flows coexist, rather than
branching behaviour on ad hoc state.

## Additional risks tracked alongside the migration

- **SEO/deeplinks** — once search results and filters move into URL state,
  existing indexable routes and shared links must be deliberately mapped, not
  silently replaced.
- **Data quality** — price-as-string, inconsistent tags/allergens, and missing
  reservation fields are likely to cost more time than the UI work itself.
  This is why BE-02a exists as its own ticket.
- **Ranking/relevance** — matching a query term is not sufficient; ordering
  exact dish-name matches against ingredient/tag/restaurant-name matches needs
  explicit rules (owned by BE-02c).
- **Fallbacks for incomplete data** — distance, open-status, dietary tags and
  reservation method must degrade gracefully when a restaurant is missing that
  field, not just when it's present.
- **Analytics/baseline** — capture a baseline (conversion, perceived speed)
  before the dish-first flow ships, or there will be no way to tell afterward
  whether it actually improved things.
