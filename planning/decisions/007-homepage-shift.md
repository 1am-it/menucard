# Decision — Homepage Shift: Relocate, Don't Delete, the Guided Flow

## Status

Accepted

## Context

BE-04 required making search the primary homepage action. The pre-BE-04
homepage (`app/page.js`) was a large, self-contained page: a guided
day/meal-type flow, ingredient/name search over the full restaurant/menu
dataset, price/buurt/cuisine filters, sort, allergen exclusion, a restaurant
grid, and a "Menukaarten" overview mode — all client-side, all persisted to
`localStorage` under `bredaeats_filters_v3`, plus scroll-position restoration
under `bredaeats_scroll_v1`.

The BE-04 ticket spec required an explicit decision on this flow's fate:
removed with a decision note, or preserved behind a flag/route — not
silently abandoned mid-migration.

## Decision

Relocate the entire guided-flow homepage, unchanged, to a new route:
`app/restaurants/page.js`. Replace `app/page.js` with a new, lightweight,
search-first homepage that forwards into `/search` (BE-03/BE-06).

The only changes made to the relocated page: the header logo and a new
"← Zoeken" link now point at `/` instead of the page linking to itself, and
the export was renamed `RestaurantsPage`. No behavioural, structural, or
data-loading change.

## Consequences

- **Zero regression risk on existing browsing functionality** — it's the
  same code, same component tree, same `localStorage` keys, just served from
  `/restaurants` instead of `/`. A user who had filters saved under
  `bredaeats_filters_v3` still gets them restored, just on the new URL.
- The new `/` is dramatically lighter: first-load JS dropped from ~145 KB to
  ~107 KB, because the homepage no longer imports the full
  `restaurants.json`/`menus.json` datasets. That weight now lives on
  `/restaurants`, which is exactly the trade-off intended — the primary,
  most-visited entry point (search) is cheap; the secondary, opt-in browsing
  route can afford to be heavier.
- `/restaurants` is not linked from primary navigation as prominently as
  search — it's a secondary "Bekijk alle restaurants" link and a small
  header link — matching the requirement that restaurant browsing remain
  available but not compete with the search-first direction.
- No bookmarked link breaks: `/restaurant/[id]`, `/menu/[id]`, `/nvwa/[id]`
  and now `/restaurants` all still resolve. Only `/` itself changed content,
  which is exactly BE-04's scope.

## Rejected alternatives

- **Delete the guided flow entirely.** Rejected: throws away working
  functionality (25 restaurants' worth of browsing, filtering, and the
  NVWA/menu entry points it surfaces) for no functional gain, and violates
  "preserve existing working functionality unless a planning/spec document
  explicitly replaces it" (`CLAUDE.md`).
- **Keep it behind a feature flag on the same `/` route.** Rejected: a
  same-route flag would mean `/` still ships both implementations' code
  (or a runtime branch deciding which to render), undermining the exact
  performance win a dedicated lightweight homepage route provides. A
  separate route achieves the same "both still exist, nothing deleted"
  outcome without that cost.
