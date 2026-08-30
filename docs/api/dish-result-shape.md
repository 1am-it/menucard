# Dish Result Shape

This is the data-shape contract produced by BE-02a's model repair, to be
queried/returned by BE-02b's server-side search layer and ranked by BE-02c.
It is a documentation contract only — nothing in the current app constructs
this shape yet.

## Fields

| Field              | Type                     | Notes |
|---------------------|--------------------------|-------|
| `dishId`            | string                   | Stable id, e.g. `{restaurantId}-{mealType}-{categoryIndex}-{itemIndex}` until a real primary key exists. |
| `name`               | string                   | From menu item `name`. |
| `description`        | string \| null           | From menu item `desc`. |
| `priceValue`         | number \| null           | From menu item `priceValue` (see below). `null` when `priceOnRequest` or `priceIsMultiple` is true. |
| `priceDisplay`       | string                   | The original `price` display string — always render this, never reformat `priceValue` back into a string. |
| `priceOnRequest`     | boolean                  | From menu item `priceOnRequest`. |
| `priceIsFrom`        | boolean                  | From menu item `priceIsFrom` — render as "vanaf €X" when true. |
| `priceIsMultiple`    | boolean                  | From menu item `priceIsMultiple` — render `priceDisplay` as-is (e.g. glass/bottle), do not attempt single-price filtering/sorting on these until a real design exists (see open item below). |
| `restaurantId`       | string                   | Key into the restaurant record. |
| `restaurantName`     | string                   | Denormalized for direct rendering. |
| `mealType`           | `'lunch' \| 'diner' \| 'borrel' \| 'specialiteiten'` | From the menu key suffix. |
| `category`           | string                   | Menu category name (e.g. "Hoofdgerechten"). |
| `tags`               | string[]                 | From menu item `tags` (e.g. `aanbevolen`, `vegetarisch`). |
| `allergens`          | number[]                 | EU-14 allergen ids. **See known limitation below** — an empty array does not currently mean "confirmed allergen-free." |
| `distanceMeters`     | number \| null           | Not currently available in any data source — always `null` until a location field is added to the restaurant model. |
| `openStatus`         | `'open' \| 'closed' \| null` | Derivable from `restaurant.openingHours`; `null` only if opening hours are entirely missing for a restaurant (not currently the case for any of the 25). |
| `menuLink`           | string                   | Route to the full menu, e.g. `/menu/{restaurantId}-{mealType}`. |

## Known limitations carried over from BE-02a

- **`allergens` ambiguity is not resolved.** 233 of 367 items (63%) have
  `allergens: []`. There is no per-item way to distinguish "confirmed
  allergen-free" from "not yet documented" anywhere in the source data — no
  item uses `null` or omits the key. Consumers of this shape (e.g. an
  NVWA-style compliance view) must not treat `allergens: []` as a verified
  claim without new source data.
- **`distanceMeters` has no backing data yet.** No restaurant record has a
  location field. This must return `null` until that's added — do not fake a
  value.
- **`priceIsMultiple` items have no single-number representation.** 13 of
  367 items are dual-priced (glass/bottle or portion-size). `priceValue` is
  `null` for these; a price *filter* should decide explicitly whether to
  exclude them, include them via the lower bound, or surface them separately
  — this decision belongs to BE-02c/BE-06, not this contract.
