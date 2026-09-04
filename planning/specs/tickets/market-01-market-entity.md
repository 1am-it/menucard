# MARKET-01 — Market Entity

## Depends on

`[[011-market-foundation-and-international-growth]]` (the accepted
principles this schema implements) and `[[012-city-market-readiness-thresholds]]`
(the `readiness_status` vocabulary this schema references).

## Objective

Define and document the `market` entity's schema — the neutral technical
unit MenuCard would expand through — as a documentation/contract-only
ticket, with Breda modeled as its first, retroactive reference value.

## User story

As whoever eventually builds `MARKET-02`+ or a future market-aware
consumer read path, I want one settled, unambiguous schema for what a
"market" is, so every later ticket builds against the same fields instead
of re-deriving them.

## Scope

- Define the market entity's fields: immutable technical `id`; a separate,
  mutable `slug` and `name`; geographic boundary; country code; timezone;
  default currency; supported languages; `launch_status`; `readiness_status`.
- Document Breda's own values for every field, as the retroactive first
  reference — including where Breda itself does not yet have a defined
  value (the geographic boundary).
- Document the geographic boundary as a hard precondition for `MARKET-04`/`05`
  (automated imports, deduplication), `MARKET-07` (coverage metrics), and
  any new market launch — without choosing its representation.

## Out of scope

- Choosing the geographic boundary's concrete representation (polygon,
  postal-code list, named region — left open).
- Any canonical database, storage engine, or persistence choice.
- A market selector, a second market, or any change to the current Breda
  consumer read path.
- Any code, migration, or Supabase change of any kind.

## Dependencies

None for definition — this is a from-scratch schema decision, informed by
`[[011-market-foundation-and-international-growth]]`'s already-accepted
principles and `[[012-city-market-readiness-thresholds]]`'s already-fixed
`readiness_status` vocabulary.

## Data model needs

This ticket **is** the data model definition — output is a documented
schema (`docs/api/market-entity-schema.md`), matching the convention
`BE-02a` and `PLATFORM-03` used for their own shape contracts. No
implementation.

## Moderation/verification needs

None directly — `readiness_status` values are set by whatever process
`[[012-city-market-readiness-thresholds]]` describes (currently manual,
per its own operational process), not by this ticket.

## Risks

- Conflating `launch_status` (operational) with `readiness_status` (data
  quality outcome) into one field — explicitly guarded against here after
  being caught and corrected in this exact ticket's own drafting; the two
  must stay independent so "live" is never read as an implicit "fully
  ready" claim.
- Using the readable `slug` as if it were a stable identifier anywhere
  code would reference a market long-term (foreign keys, stored
  associations) — `id` is the only field guaranteed not to change.

## Acceptance criteria

- [x] A documented schema exists for the market entity, with `launch_status`
      and `readiness_status` as clearly separate fields.
- [x] `id` is documented as immutable; `slug`/`name` are documented as
      mutable and never suitable as a long-term reference key.
- [x] Breda's own values are filled in for every field, including an
      honest gap where one doesn't exist yet (the boundary).
- [x] The geographic boundary is documented as a precondition for
      `MARKET-04`/`05`/`07` and any new market launch, without its
      representation being chosen.
- [x] No code, migration, storage choice, market selector, or second
      market introduced.

## Amendment (2026-09-04, `MARKET-04` gate 1)

This ticket's own scope and acceptance criteria above are unchanged and
remain accurate for what was decided at the time — the geographic
boundary's representation was correctly left open. `docs/api/market-entity-schema.md`
has since been amended to make `boundary` a versioned, testable
`MarketBoundaryVersion` reference, and to settle the semantic question
`MARKET-04`'s own hard gate 1 needed answered: Breda's market boundary is
Gemeente Breda's administrative/municipal boundary. The concrete
geometry/data source and representation type for Breda's actual first
boundary version remained open at the time this amendment was written.
**Update (2026-09-04, later the same day)**: no longer open — a concrete
`MarketBoundaryVersion` (`v1`, `polygon`/`MultiPolygon`, sourced from
Kadaster/PDOK "Bestuurlijke Gebieden") has since been captured; see
`docs/api/market-entity-schema.md`'s "Registered version — actual
instance" section. This ticket's own status stays `done`; the amendment
lives in the schema document it always pointed to.

## Suggested order

First ticket of the `MARKET-*` track's Wave 1 (market dimension &
canonical schema, modeling only) — see
`planning/architecture/market-data-foundation-plan.md`.
