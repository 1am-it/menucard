# Restaurant Summary Shape

This is the data-shape contract for `GET /api/restaurants` (BE-11 Fase 1),
implemented by `src/services/restaurantIndex.js`. It is a **restaurant-
level** contract — deliberately separate from
[dish-result-shape.md](./dish-result-shape.md), which this file never
extends or replaces. The two exist side by side for a specific, load-
bearing reason: only 4 of Breda's 25 restaurants had any entry in
`data/menus.json` at the time this was written (a dated snapshot, see
`planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`
"Problem" — re-run `src/services/coverageMetrics.js`'s own
`withMenuData`/`withoutMenuData` computation to check today's real
ratio). A restaurant-summary source derived from grouping
`src/services/dishSearch.js`'s dish-level results would silently exclude
every restaurant without menu data. `GET /api/restaurants` therefore
reads **only** `data/restaurants.json` — never `data/menus.json`, and
never the legacy `menus` blob still embedded in individual restaurant
records.

## Fields

| Field          | Type                          | Notes |
|----------------|-------------------------------|-------|
| `restaurantId` | string                        | Key into the restaurant record. |
| `name`         | string                        | From `restaurant.name`. |
| `cuisine`      | string                        | `restaurant.cuisineLabel` if present, else `restaurant.cuisine`. |
| `priceLevel`   | `1 \| 2 \| 3 \| null`         | From `restaurant.priceLevel`, passed through as-is — `null` when absent, **never a fallback/invented default** (do not reuse `app/restaurants/page.js`'s `getPriceLevel()` `\|\| 2` pattern; that pattern is explicitly rejected for this contract). Indicative only, per BE-11 §2 — never an exact price or a verified/trust claim. |
| `buurt`        | string \| null                | From `restaurant.buurt`. |
| `address`      | string \| null                | From `restaurant.address`, **only when it passes `isValidAddress()`** — see "Known limitations" below. `null` when the address is missing or a known placeholder; never the placeholder text itself. |
| `openStatus`   | `'open' \| 'closed' \| null`  | Today's status only — this endpoint has no day parameter yet. `null` when opening hours are missing for today. |
| `menuLinks`    | `{ id: string, label: string }[]` | From `restaurant.menuLinks`, passed through as-is (including its emoji-prefixed `label` — a future UI is free to derive a cleaner label from `id`, this contract does not do that itself). Empty array when the restaurant has no menu data. |
| `hasMenu`      | boolean                       | `true` only when `menuLinks` is a non-empty array. Exists so a caller never has to infer "no menu" from an empty-array-vs-null-vs-missing-key ambiguity — the same class of ambiguity `dish-result-shape.md` already flags for `allergens`. |

Nothing else is returned. No long description, no phone/website/
reservation fields, no tags, no legacy `menus` blob.

## Query parameters

| Param    | Type   | Notes |
|----------|--------|-------|
| `q`      | string | Free text, 2+ characters after trimming (same minimum-length convention as `dishSearch.js`). Matches against `name`, `buurt`, and a **valid** `address` only — never menu/dish content, which this endpoint has no access to. |
| `cursor` | number | Offset into the filtered, sorted result set. |
| `limit`  | number | Bounded to 1–50 (`DEFAULT_LIMIT = 20`, `MAX_LIMIT = 50`), same defaults as `dishSearch.js`. |

## Ranking

When `q` is present, every restaurant is assigned one tier (lower =
better), mirroring (not sharing code with) `dishSearch.js`'s tier
philosophy:

| Tier | Meaning |
|------|---------|
| 0 | Exact name match |
| 1 | Name contains the query |
| 2 | Buurt contains the query |
| 3 | Valid address contains the query |

A restaurant matching none of these is excluded, not given a lowest tier.
Ties break on restaurant name (`localeCompare`, Dutch locale) — no other
sort value exists yet, per this ticket's own non-goal against new ranking
logic beyond what grouping/navigation requires.

## Known limitations

- **Restaurant id `10` ("Salon de Provence") has a placeholder address**
  (`"Salon de Provence Breda"` — its own name plus the city, not a real
  street address) in the underlying `data/restaurants.json` record. This
  contract's `isValidAddress()` check excludes it: the restaurant still
  appears in every browse/search result it's otherwise entitled to (its
  `buurt`, `name`, `cuisine`, etc. are all fine), but `address` is `null`
  for it, and it cannot be found via free-text address matching. The
  restaurant's own `cardDescription` field mentions a real street
  ("...aan de Ginnekenweg"), suggesting the real address is known
  somewhere, just never entered into the structured `address` field —
  this was not corrected here, since guessing or writing an unverified
  address is explicitly out of scope for this endpoint. The correct fix
  path is `PLATFORM-07` (owner claim → owner-provenance edit) or
  `PLATFORM-08` (community micro-task → moderation queue) per
  `planning/architecture/platform-plan.md` — not a direct data edit.
  `isValidAddress()` is a narrow, specific check (address equals name +
  ", Breda") — deliberately **not** a blanket "no digit means invalid"
  rule, which would wrongly reject a legitimate address with no house
  number.
  - **Known, accepted consequence:** a query like `q=Breda` matches
    restaurant id `10` on neither `name` nor `buurt`, and — correctly —
    not via its invalid address either, since that address was never
    indexed. This restaurant is therefore genuinely absent from a
    `"Breda"` search result, by design, not by accident. This is
    unrelated to, and does **not** cause, any exclusion from plain
    browse results (no `q`), from a name search (e.g. `q=Provence`), or
    from a real buurt match (e.g. `q=Binnenstad`) — restaurant `10`
    appears normally in all three of those.
- **`priceLevel` has no source/confidence model yet** — same caveat as
  `dish-result-shape.md`'s price-related fields; see
  `docs/api/data-trust-model.md`.
- **No cuisine, buurt-exact, day, or "now open" filter yet** — this first
  vertical slice implements only `q` and pagination. See the BE-11
  ticket's own "Open technical questions" for what remains undecided.
- **No restaurant-level price-level filter** — `priceLevel` is display-
  only in this contract; filtering by it is explicitly out of scope here
  (no agreed filter semantics exist yet — exact tier vs. multi-select vs.
  ceiling is an open product decision, not made by this contract).
- **No GPS, distance, or coordinates** — `data/restaurants.json` has no
  latitude/longitude field for any restaurant today; "near me" is not
  technically possible yet, not merely deferred.
