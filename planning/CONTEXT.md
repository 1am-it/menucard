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

## Linear sequence (revised 2026-08-29 after audit review)

BE-01 — Audit + migration plan (done)  
BE-02a — Data model repair (price normalization, reservation fields, dish-result shape)  
BE-02b — Server-side search / data access layer  
BE-02c — Dish ranking and result mapping  
BE-03 — Dish search results  
BE-06 — Price / cuisine / allergy filters + URL state  
BE-04 — Text-first homepage  
BE-07 — Reservation routing  
BE-05 — Lightweight restaurant menu  
THEME — Design-token / light theme migration (separate ticket, see [[005-decouple-theming-from-dish-first]])  
BE-08 — Performance cleanup

Rationale for this order: fix the data/search foundation first, then ship the
primary dish-search experience against a real server-side query layer, then
refine (filters, homepage, reservation routing, menu restyle), and only flip
the visual theme once the new flow is proven. Server-side search
(BE-02b) is a hard prerequisite for BE-04 and BE-05 — see
[[004-server-side-search-before-restyle]].

Do not implement multiple tickets implicitly.

Each ticket should be independently reviewable and deployable where practical.

Keep the existing dark theme in place through BE-02a/b/c, BE-03 and BE-06 so
functional regressions and visual regressions are never introduced in the same
change. Use feature flags or separate route variants where old and new flows
coexist, rather than branching behaviour on ad hoc state.

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
