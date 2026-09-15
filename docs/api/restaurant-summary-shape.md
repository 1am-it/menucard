# Restaurant Summary Shape

This is the data-shape contract for `GET /api/restaurants` (BE-11 Fase 1;
extended, not replaced, by Fase 2's `uniqueNameMatch` field below),
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

Nothing else is returned per restaurant. No long description, no phone/
website/reservation fields, no tags, no legacy `menus` blob.

## Response envelope

The endpoint's top-level JSON response is:

```
{ results: [...], total: number, nextCursor: number | null, hasMore: boolean, uniqueNameMatch: boolean }
```

`results`/`total`/`nextCursor`/`hasMore` are pagination as usual (see
`searchRestaurants()`). `uniqueNameMatch` is BE-11 Fase 2's group-
ordering signal — see "Name-token match for group ordering" below.

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
| 1 | Name contains the query, **or** the query is a unique whole-word/token match against this restaurant's name (see "Name-token match for group ordering" below) even when it isn't a literal substring |
| 2 | Buurt contains the query |
| 3 | Valid address contains the query |

A restaurant matching none of these is excluded, not given a lowest tier.
Ties break on restaurant name (`localeCompare`, Dutch locale) — no other
sort value exists yet, per this ticket's own non-goal against new ranking
logic beyond what grouping/navigation requires.

## Name-token match for group ordering (BE-11 Fase 2)

The response also carries a boolean `uniqueNameMatch`, computed by
`findRestaurantsByNameToken()`/`hasUniqueRestaurantNameMatch()` in
`src/services/restaurantIndex.js`. It exists for one primary consumer:
`/search` (BE-11 Fase 2), which shows a separate "Restaurants gevonden"
group alongside its existing "Gerechten gevonden" dish group, and needs a
reliable, server-computed signal for which group to show first. It is
computed against the query text itself (never against the current page/
cursor), so it is correct regardless of pagination.

**Consistency guarantee, corrected 2026-09-15:** `uniqueNameMatch: true`
always means the matched restaurant is present in that same call's
`results` and counted in `total`. This was not true in an earlier version
of this endpoint: `getMatchTier()`'s tier 0/1 name check is a plain
substring test with no separator normalization, while the token rule
below treats a space, hyphen, and `&` as equivalent — so a query like
`"T Huis"` could satisfy the token rule against the stored name
`"T-Huis"` (`"t-huis".includes("t huis")` is `false`, since a hyphen and a
space differ to a plain substring check) while `getMatchTier()` excluded
it entirely, yielding `uniqueNameMatch: true` with `total: 0`. This is
fixed in `searchRestaurants()`: when the token rule uniquely identifies a
restaurant that `getMatchTier()` did **not** already include (or only
included at a weaker tier, 2 or 3), that restaurant is added to the
candidate set at tier 1 ("name match") before ranking and pagination —
see the "Ranking" table's tier 1 row above. This never changes or weakens
`getMatchTier()`'s own substring/buurt/address matching for any query,
and never affects a **non-unique** token match (e.g. `"Restaurant"`,
which matches 8 names) — those are left exactly as the substring tiers
already handle them.

`uniqueNameMatch` is deliberately a **different, stricter** rule than
the tier-based `q` matching above for *deciding whether the rule fires at
all* — it still never changes which restaurants are returned beyond the
single, guaranteed injection described above, and a buurt or address
match, however exact, never sets it. Only a match against a restaurant's
own **name**, on whole word/token boundaries, does:

1. Lowercase the query; **keep accents** — no accent-folding. This is
   the same documented gap as `dish-search-ranking.md`'s "Accent-
   insensitive matching... is not implemented" note. No restaurant name
   in the current dataset carries an accent, so this gap is not
   exercised today, but the rule does not attempt to fold one if a name
   with an accent is added later.
2. Tokenize both the query and each restaurant name on Unicode-aware
   runs of non-letter/non-digit characters (`/[^\p{L}\p{N}]+/u`) —
   spaces, hyphens, "&", and apostrophes are all separators alike. This
   is why `"T-Huis"`, `"T Huis"`, and `"Huis"` all tokenize to the same
   single token, `["huis"]`.
3. Drop tokens shorter than 3 characters from the query. This is what
   keeps `"De"` from matching `"Salon de Provence"` or `"De Beyerd"` —
   `"de"` is a real, full token in both of those names, not a substring
   coincidence that a naive filter might miss.
4. Every remaining query token must equal a **whole token** in the same
   restaurant name — never a substring, never fuzzy/edit-distance
   matching. This is what keeps `"Bar"` from matching `"Beers &
   Barrels"` — `"bar"` is only a substring of `"barrels"`, never its own
   token there.
5. The signal is `true` only when exactly **one** restaurant name
   matches this way. A query with zero remaining tokens after step 3,
   or one matching zero or more than one restaurant name, is `false`.

On `/search`, `uniqueNameMatch` only ever affects **group order** — it
never hides or excludes a result in either group, and (per the
consistency guarantee above) the one restaurant it can add was always a
legitimate, exact whole-name-token match that a plain substring check
simply missed due to a separator difference, never a fuzzy or partial
match. Both groups, when non-empty, are always shown in full; this field
only decides which one appears first.

Verified against the real, current 25-restaurant dataset (see
`src/services/restaurantIndex.test.js`): `"Bardot"`, `"Brasserie
Bardot"`, `"T-Huis"`/`"T Huis"`/`"Huis"`, `"Beers Barrels"` (finds
`"Beers & Barrels"`), `"Con  Fuego"` (double space, finds `"Con
Fuego"`), and `"Blossem"` each match exactly one name (`true`) **and**
that match is present in `results`/`total` for every one of them; `"Bar"`
matches none (`false`, not a substring match on "Barrels"); `"De"`
matches none (`false`, filtered by the 3-character floor before any name
comparison happens); `"Restaurant"` matches 8 names (`false`, not
unique, `total` unaffected by the injection since it never fires for a
non-unique match); `"Binnenstad"` (buurt) and `"Wolfslaardreef"` (a real
street) both match restaurants but never set this field, since neither
is a name-token match.

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
