# MARKET-02 — Canonical Restaurant/Menu Schema

## Depends on

`[[011-market-foundation-and-international-growth]]` (the accepted hybrid
architecture this schema implements), `MARKET-01` (the `market` entity
every canonical record references), and `docs/api/data-trust-model.md`
(`PLATFORM-03` — the trust/provenance vocabulary this schema reuses
exactly, not replaces).

## Objective

Define the logical, source-of-truth schema for a restaurant and its menu
— distinct from both today's static JSON shape and the future
publication-snapshot shape (`MARKET-06`) — as a documentation/schema
contract only, with a conservative retroactive mapping of Breda's real
data onto it.

## User story

As whoever eventually builds `MARKET-03`+ (source registry, imports,
normalization) or a future market-aware consumer read path, I want one
settled, internationally-viable canonical schema, so a second market's
data never needs a schema rewrite just because it isn't Breda.

## Scope

- Canonical objects: `Restaurant`, `Menu`, `MenuSection`, `MenuItem`,
  `SourceReference` (factual origin), `FieldAssertion` (reusable trust/
  provenance reference) — full field-level detail in
  `docs/api/canonical-restaurant-menu-schema.md`.
- Stable, immutable canonical `id`s plus explicit `legacy_ids`/`external_ids`
  mapping, so today's Breda JSON ids can later be mapped in a controlled,
  traceable way.
- `market_id` on every market-bound record.
- International data corrections: optional `website`; `address.country_code`;
  an extensible `{scheme, code}` allergen model with `EU-14` as the first,
  not universal, scheme; a `Money` structure in minor units with explicit,
  mutually-exclusive pricing states (`known`/`multiple_undecomposed`/
  `on_request`/`unknown`).
- An unambiguous `operational_status` vocabulary for restaurants
  (`open`/`temporarily_closed`/`permanently_closed`/`unknown`) — no bare
  `inactive`.
- `field_path`-based sub-field addressing on `FieldAssertion`, so
  `reservation.url`, `reservation.phone`, and `availability.status` (etc.)
  carry provenance independently.
- `source_references[]` as sets of `SourceReference` *identities*
  (references), never copies — multiple sources may coexist per record or
  per assertion.
- Mandatory `FieldAssertion` coverage for exactly the five risk-sensitive
  fields `docs/api/data-trust-model.md` already named (price, opening
  hours, reservation method, item availability, allergens) — this ticket
  does not expand or shrink that list.
- A conservative, honest retroactive mapping of Breda's real data,
  including its real gaps (no invented certainty, variants, or
  verification).

## Out of scope

- Any canonical database, storage engine, physical table layout, or
  persistence choice.
- A market selector, a second market, or any change to the current Breda
  consumer read path.
- `MARKET-03`–`07` (source registry, import runs, normalization,
  publication snapshots, coverage metrics) — this ticket defines what they
  will write into, not how they work.
- Expanding `docs/api/data-trust-model.md`'s five-field mandatory-provenance
  list to include `operational_status` — flagged as an open question, not
  decided here.
- Any code, migration, or Supabase change of any kind.

## Dependencies

Hard dependency on `MARKET-01` (for `market_id`) and
`docs/api/data-trust-model.md` (for the trust/provenance vocabulary this
schema reuses without modification).

## Data model needs

This ticket **is** the data model definition. Output:
`docs/api/canonical-restaurant-menu-schema.md`, matching the convention
`BE-02a`, `PLATFORM-03`, and `MARKET-01` used for their own shape
contracts. No implementation.

## Moderation/verification needs

None directly — `FieldAssertion.trust_source` values are set by whatever
process eventually writes them (existing `PLATFORM-06`/`07` review flows,
generalized, per `[[011-market-foundation-and-international-growth]]`'s
governance principle); this ticket only defines the shape they're written
into.

## Risks

- Conflating a restaurant's `operational_status` with a menu item's
  `availability.status` or the market's `launch_status`/`readiness_status`
  — guarded against explicitly via distinct field names and a stated
  naming convention.
- Letting `Money`'s optional fields (`amount_minor_units`, `variants`,
  `currency`) drift into inconsistent combinations (e.g. an "on request"
  price that also claims a concrete amount) — guarded against via
  documented, explicit invariants, not left to implicit convention.
- Asserting more certainty about Breda's legacy data than it actually has
  (e.g. inventing decomposed price variants, or a verified
  `operational_status`, that were never real) — guarded against in the
  retroactive mapping section, which states plainly where no honest value
  can be filled in.

## Acceptance criteria

- [x] A documented logical schema exists for `Restaurant`, `Menu`,
      `MenuSection`, `MenuItem`, `SourceReference`, and `FieldAssertion`.
- [x] `id` is documented as immutable; `legacy_ids`/`external_ids` are
      explicit, separate mapping mechanisms.
- [x] `website` is optional; `address` carries its own `country_code`.
- [x] Allergens use an extensible `{scheme, code}` model with `EU-14`
      named as the first, non-universal scheme.
- [x] `Money` defines minor-units amounts, ISO-4217 currency, and four
      explicit, non-overlapping pricing states with stated invariants
      forbidding invalid combinations.
- [x] `operational_status` uses an unambiguous four-value vocabulary, no
      bare `inactive`.
- [x] `FieldAssertion.field_path` addresses sub-fields precisely enough
      for `reservation.*` and `availability.status`.
- [x] `source_references[]` is documented as a set of references, not
      copies, allowing multiple coexisting sources.
- [x] Mandatory risk-field provenance matches `docs/api/data-trust-model.md`'s
      existing five-field list exactly — neither expanded nor reduced.
- [x] Breda's retroactive mapping is conservative — no invented certainty,
      variants, or verification.
- [x] No code, migration, storage choice, market selector, or second
      market introduced.

## Suggested order

Second ticket of the `MARKET-*` track's Wave 1 (market dimension &
canonical schema, modeling only) — see
`planning/architecture/market-data-foundation-plan.md`.
