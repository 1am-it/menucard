# Canonical Restaurant/Menu Schema (MARKET-02)

The concrete, implementable logical schema contract for the canonical
restaurant/menu record — the source-of-truth for import, management, and
review that `[[011-market-foundation-and-international-growth]]`'s hybrid
architecture describes. Documentation contract only — nothing in the
current app constructs, stores, or reads this shape yet. It is distinct
from both today's static `data/restaurants.json`/`data/menus.json` shape
and the future publication-snapshot shape (`MARKET-06`); neither is
migrated or changed by this document. The product-level rationale lives in
`planning/specs/tickets/market-02-canonical-restaurant-menu-schema.md`;
this file defines the exact fields, mirroring the convention
`docs/api/data-trust-model.md` and `docs/api/market-entity-schema.md` used
for `PLATFORM-03` and `MARKET-01`.

This schema is **logical, not physical**: it fixes the objects,
relationships, and required fields. Table layout, normalization, and
storage technology are explicitly not decided here.

## Naming convention for status fields

Four distinct status concepts exist in this project now, deliberately
named so they never collide or get confused:

| Concept | Field | Level |
|---|---|---|
| Market operational state | `market.launch_status` | `MARKET-01` |
| Market data-readiness outcome | `market.readiness_status` | `MARKET-01` / `PLATFORM-09` |
| Restaurant operational state | `restaurant.operational_status` | this document |
| Menu item availability | `menu_item.availability.status` | this document |

## 1. `CanonicalRestaurant`

| Field | Type | Notes |
|---|---|---|
| `id` | stable canonical id | Immutable — same discipline as `MARKET-01`'s `id`. |
| `market_id` | FK → `market.id` | Required on every market-bound record. |
| `legacy_ids[]` | `{scheme, value}[]` | This project's own prior identifier schemes (e.g. `{scheme: "breda-static-json", value: "6"}`). |
| `external_ids[]` | `{scheme, value}[]` | Third-party system identities for the same real-world entity (e.g. a future Google Place ID). Kept separate from `legacy_ids` — different origin, different purpose. |
| `name` | text + `locale` | |
| `cuisine_label` | text + `locale` | Free text, deliberately — `docs/coverage/breda-baseline-2026-08-30.md` already found this isn't a real taxonomy today; this schema doesn't invent one. |
| `address` | `{street, house_number, postcode, locality, country_code}` | `country_code` is on the address itself, not only inherited from `market_id` — a market may one day span more than one country. |
| `location` | geographic point | Not present in any current data source; fills the gap `docs/api/dish-result-shape.md` already named (`distanceMeters`, permanently `null` today). Exact representation open — see Open questions. |
| `phone` / `phone_display` | text | |
| `website` | URL, **optional** | Breda has 100% coverage today, but the field must not be required for a genuinely international model. |
| `operational_status` | enum: `open` \| `temporarily_closed` \| `permanently_closed` \| `unknown` | Replaces an earlier, ambiguous `status` field. No bare `inactive` value — every state has an exact meaning. **Not currently in `PLATFORM-03`'s mandatory risk-field list** — see Open questions; it gets the same minimum (record-level `source_references[]`) as other non-mandated fields until that's explicitly decided. |
| `opening_hours` | `{monday..sunday: {opens, closes} \| null}` | One of the five mandatory risk-sensitive fields (`docs/api/data-trust-model.md`). Canonical day keys are English (`monday`…`sunday`); legacy Dutch abbreviations (`ma`, `di`, …) map onto these directly. |
| `reservation` | `{type, url, phone, whatsapp}` | One of the five mandatory risk-sensitive fields. Each sub-field individually addressable — see `field_path` below. |
| `description` | text + `locale` | |
| `source_references[]` | `SourceReference` id references (see §5) | Record-level minimum for fields not individually asserted. |

## 2. `CanonicalMenu`

`id`, `restaurant_id`, `market_id`, `meal_type` (existing enum:
`lunch`/`diner`/`borrel`/`specialiteiten`), `subtitle` + `locale`, `notes`
+ `locale`, `legacy_ids[]`, `source_references[]`.

## 3. `CanonicalMenuSection`

`id`, `menu_id`, `market_id`, `name` + `locale`, `position`, `legacy_ids[]`,
`source_references[]`.

## 4. `CanonicalMenuItem`

| Field | Type | Notes |
|---|---|---|
| `id` | stable canonical id | The stable item reference `docs/api/dish-result-shape.md` itself named as missing ("`dishId`... until a real primary key exists") — decoupled from position, unlike today's `{restaurantId}-{mealType}-{categoryIndex}-{itemIndex}`. |
| `section_id`, `market_id` | FK | |
| `name`, `description` | text + `locale` | |
| `price` | `Money` (see §4a) | One of the five mandatory risk-sensitive fields. |
| `availability` | `{status, valid_from?, valid_to?}` | One of the five mandatory risk-sensitive fields. `status` uses the controlled vocabulary below. |
| `tags[]` | text + `locale` | Free text, matching today exactly — no controlled vocabulary introduced. |
| `allergens[]` | `{scheme, code}[]` | See §4b. |
| `legacy_ids[]`, `source_references[]` | | |

### 4a. `Money` — explicit states and forbidden combinations

```
Money {
  pricing_status: 'known' | 'multiple_undecomposed' | 'on_request' | 'unknown'
  amount_minor_units: integer | null   // always minor units (cents), never a decimal or display string
  currency: ISO-4217 | null
  is_from: boolean                     // "starting from" framing; only meaningful when pricing_status = 'known'
  variants: [{ label?: text, amount_minor_units: integer }] | null
}
```

**Four distinct, non-overlapping states** — chosen specifically so "unknown"
is never confused with "on request" or with "known to be multiple, not yet
broken down":

| `pricing_status` | `amount_minor_units` | `variants` | `currency` | Meaning |
|---|---|---|---|---|
| `known` | set, **or** `variants` has ≥2 entries | optional | **required** | A real, usable price exists (single amount, or a fully decomposed set of variants, e.g. glass/bottle). |
| `multiple_undecomposed` | forbidden (`null`) | forbidden (`null`) | optional | We know the item has more than one price (e.g. glass/bottle) but have not captured the breakdown. Breda's honest current state for every `priceIsMultiple` item. |
| `on_request` | forbidden (`null`) | forbidden (`null`) | optional | No number exists to show — by design, not by data gap. |
| `unknown` | forbidden (`null`) | forbidden (`null`) | forbidden (`null`) | We genuinely have no price information at all — distinct from `on_request`, which is a deliberate restaurant choice, not a data gap. |

**Invariants (validation rules, not implementation choices):**

1. `currency` is required if and only if `amount_minor_units` is set or
   `variants` is non-empty; forbidden otherwise.
2. `amount_minor_units`, whenever present, is a non-negative integer in
   minor units — never a float, never a display string.
3. `pricing_status = 'on_request'` forbids any concrete
   `amount_minor_units` or non-empty `variants` in the same record — a
   price can never simultaneously claim "on request" and a number.
4. `pricing_status = 'unknown'` forbids `amount_minor_units`, `variants`,
   `is_from`, and `currency` — none of the surrounding detail is
   meaningful when the price is simply not known.

### 4b. Allergens — extensible scheme, not a hardcoded list

```
allergens: [{ scheme: text, code: text }]
```

**`EU-14` is documented as the first supported scheme, not a universal
ceiling.** A future regulatory profile (e.g. a different market's own
allergen labelling rules) is added as a new `scheme` value, never by
extending or renumbering `EU-14`'s own codes.

### Availability vocabulary

`available` | `temporarily_unavailable` | `seasonal` | `unknown`.

## 5. `SourceReference` — the factual origin

`id`, `source_id` (→ future `MARKET-03` source registry), `import_run_id`
(→ future `MARKET-04` import-run log), `source_locator` (URL/PDF/etc.),
`retrieved_at`.

**Amendment (2026-09-01, `MARKET-03`):** `source_id` must reference a
registered `Source` identity from `docs/api/source-registry-schema.md` —
never a bare, unreviewed URL or an ad hoc string. A `SourceReference`
cannot exist for a source that hasn't at least been entered into the
registry (as `pending_review` at minimum). This doesn't change anything
about `SourceReference`'s own shape — it makes explicit a constraint on
`source_id` that was previously only implied by "→ future `MARKET-03`
source registry."

## 6. `source_references[]` — a set of references, never copies

Wherever this document says a record or `FieldAssertion` has
`source_references[]`, that is **a set of `SourceReference` identities
(foreign keys)**, not a set of embedded/copied source objects. The same
physical `SourceReference` (e.g. "this menu was scraped from this URL on
this date") is referenced by every item on that menu — recorded once,
linked many times. A record or assertion may reference more than one
`SourceReference` at once (e.g. a menu confirmed by both a website scrape
and later owner input).

## 7. `FieldAssertion` — the trust/provenance layer

| Field | Type | Notes |
|---|---|---|
| `id` | | |
| `entity_type`, `entity_id` | | Which canonical object this concerns. |
| `field_path` | text | Precise enough to address sub-fields — see the table below. Replaces a generic `field_name`. |
| `trust_source` | `owner` \| `community` \| `editor` \| `imported` \| `unknown` | Exact reuse of `docs/api/data-trust-model.md`'s existing enum — no new vocabulary. |
| `confidence` | `high` \| `medium` \| `low` | Same mapping already established: `owner`/`editor` → `high`, `community` → `medium`, `imported` → `low`. |
| `verified_at`, `verified_by` | | Same semantics as `docs/api/data-trust-model.md`. |
| `source_references[]` | `SourceReference` id references | See §6 — a set, never a single value, never copies. |

### Mandatory risk-sensitive `field_path` values

Exactly the five fields `docs/api/data-trust-model.md` already named —
this document does not add or remove any:

| Risk field | `entity_type` | `field_path` |
|---|---|---|
| Price | `MenuItem` | `price` (the whole `Money` object as one unit — its internal invariants make asserting only part of it incoherent) |
| Opening hours | `Restaurant` | `opening_hours.<day>` (e.g. `opening_hours.tuesday`) |
| Reservation method | `Restaurant` | `reservation.type`, `reservation.url`, `reservation.phone`, `reservation.whatsapp` (individually) |
| Item availability | `MenuItem` | `availability.status` |
| Allergens | `MenuItem` | `allergens` (the whole list as one unit) |

Every other field requires, at minimum, a record-level `source_references[]`
on its parent object — not an individual `FieldAssertion`.

## Breda — conservative retroactive mapping

No invented certainty, variants, or verification beyond what the current
data actually supports:

- **Price**: a normal item (`priceValue: 21.0`, no flags) → `pricing_status: 'known'`,
  `amount_minor_units: 2100`, `currency: 'EUR'` (now explicit — today it is
  only ever implicit). `priceIsMultiple: true` → `pricing_status: 'multiple_undecomposed'`,
  no invented `variants`. The 13 of 367 items with neither `priceValue`
  nor `priceOnRequest` set (per the `PLATFORM-05` verification round's own
  count) → `pricing_status: 'unknown'` — a real, previously-unnamed data
  state that now has an honest, distinct home instead of being an implicit
  gap.
- **Allergens**: existing EU-14 numeric codes → `{scheme: "EU-14", code: <1-14>}`.
- **`website`**: stays 100% populated for Breda; the field itself is now
  optional in the schema, not because Breda needs it to be.
- **`address.country_code`**: `"NL"` for every Breda restaurant, on the
  address itself.
- **Reservation**: each sub-field gets its own `FieldAssertion`
  (`field_path: "reservation.url"`, etc.) instead of one blob. The
  existing `reservation.verified: false` (100% of Breda today) remains the
  same open mapping question `docs/api/data-trust-model.md` already
  documented — not resolved here.
- **`operational_status`**: no legacy equivalent exists anywhere in
  today's data. A retroactive value is **not asserted here** — inventing
  "all 25 are `open`" would itself be an unverified claim this document's
  own principles reject. Left for whoever implements `MARKET-02` to decide
  how (or whether) to backfill, explicitly.
- Menu-level `source`/`scraped` → one `SourceReference`, linked from every
  item on that menu via `source_references[]` — never promoted to
  per-field confirmation it doesn't actually represent.

## Open questions (technical implementation choices only)

- Physical database layout / table normalization; concrete storage
  technology.
- Exact `id` format (UUID vs. an internal key scheme) — same open item as
  `MARKET-01`.
- Precise classification of an AI-originated proposal within `trust_source`
  — same open item as `MARKET-01`/`[[011-market-foundation-and-international-growth]]`.
- Exact representation of `location` (precision, coordinate system).
- Exact syntax of `field_path` strings (dot-notation vs. another scheme) —
  the requirement that sub-fields be individually addressable is settled;
  the notation is not.

## Explicitly flagged, not decided here

- **Whether `operational_status` should join the five mandatory
  risk-sensitive fields.** A permanently-closed restaurant shown as open
  is real, tangible harm — but `docs/api/data-trust-model.md`'s five-field
  list is documented as a settled, specific set. This document does not
  expand that list unilaterally; it flags the question for whoever makes
  that call next, and gives `operational_status` only the standard
  record-level `source_references[]` minimum until then.
