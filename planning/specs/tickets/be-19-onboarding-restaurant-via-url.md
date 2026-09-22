# BE-19 — Onboarding Restaurant via URL (Concept Intake Bridge)

## Status

Proposed; not started. Documentation/schema contract only — no product
code, migration, route, API, data, dashboard, commit, push, deploy,
database, account, storage, or navigation change has been made for this
ticket. This ticket is the narrative/rationale layer; the exact,
implementable shape lives in `docs/api/url-intake-schema.md` (new) and
`docs/api/restaurant-profile-drafts-schema.md`'s own "Amendment
(2026-09-22, BE-19)" section — the same "ticket = rationale,
`docs/api/*.md` = exact contract" split this project already uses for
`MARKET-02`/`canonical-restaurant-menu-schema.md`.

## Voortgang

BE-19 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means and how it must be kept up to date.

## Depends on

`be-17-menu-proposal-snapshot-foundation.md` (`menu_snapshot_proposals`/
`menu_snapshot_reviews`, reused **entirely unchanged** — this ticket adds
no column, foreign key, or relaxation to either table) and
`be-18-onboarding-menu-via-url.md` (the existing URL-read/JSON-LD-extraction/
restaurant-hostname-match core, `src/lib/safeOutboundFetch.js`,
`src/lib/menuJsonLdExtraction.js`, `src/lib/restaurantHostMatch.js`, all
reused unchanged). `docs/api/restaurant-profile-drafts-schema.md`
(`MARKET-05C` — `restaurant_profile_drafts`/`_field_facts`, the
promote/discard RPCs, and `src/lib/importInbox.js`'s
`computePossibleDuplicateIds`, all reused with one additive amendment,
not replaced). `docs/api/source-registry-schema.md`/`import-run-schema.md`
(`MARKET-03`/`04` — read, not modified; this ticket's own "Governance
exception" is defined against their existing invariants, in
`docs/api/url-intake-schema.md`). `docs/api/data-trust-model.md`'s
`source`/`confidence`/`verified_at`/`verified_by` vocabulary — referenced
for future alignment only, not consumed directly by this ticket's own
`origin` (`import`/`enrichment`/`url_intake`) vocabulary, which stays the
narrower, already-established `MARKET-05C` scope (see
`docs/api/restaurant-profile-drafts-schema.md`'s existing "Field-level
provenance" section for why the two vocabularies are deliberately not
merged yet).

## Problem

`be-18-onboarding-menu-via-url.md`'s fase 1 only ever produces a menu
concept for an **existing, already-matched** restaurant
(`restaurant_match_type: 'exact'` in the terms this ticket's own contract
introduces). When a staff member pastes a URL for a restaurant that has
no match in `data/restaurants.json`, the flow dead-ends — there is no
next step, even though the exact same safe, staff-triggered fetch already
happened. Separately, `restaurant_profile_drafts` (`MARKET-05C`) already
provides exactly the right shape for a reviewable restaurant concept
(append-only field-facts, duplicate detection, promote/discard), but its
`source_candidate_id` is a hard, `not null` foreign key to
`import_extraction_records(id)` — a row that only exists after a full
`MARKET-04` `ImportRun` against a registered, human-reviewed `Source`.
That pipeline is correct for bulk, repeatable, registered-source
acquisition (the existing OSM/Geofabrik/Kadaster work); it is the wrong
shape, and the wrong governance weight, for "a staff member pastes one
restaurant's own homepage URL and wants an immediate, reviewable
concept." This ticket closes that specific, named gap between BE-18 and
MARKET-05C — nothing else.

## Product decision (explicit, user-provided)

- A staff-triggered, single-URL onboarding fetch gets a light, explicit
  governance exception — it does **not** require a full `MARKET-03`
  `Source`/`SourceAuthorizationVersion` registration per restaurant
  website first. This exception stays strictly bounded to safe,
  robots.txt-honoring, staff-triggered single-URL intake — no browser
  login, no crawl, no automatic publication, no processing of personal
  data beyond what already-existing allowlists permit. See
  `docs/api/url-intake-schema.md`'s own "Governance exception" section
  for the precise, bounded definition.
- A small, additive, internal audit/traceability object,
  `url_intakes`, is introduced. It is **not** a second review queue and
  carries no approval/rejection status of its own.
- It stores no raw HTML, no full JSON-LD payload, no PDF, and no full
  source document — only a bounded, already-established allowlist of
  selected, normalized restaurant- and menu-candidate fields plus source
  references (URL, hostname, timestamp, actor), so a staff member never
  has to re-submit the same URL after a restaurant is promoted.
- An unmatched URL may produce a `restaurant_profile_drafts` concept.
- A `BE-17` menu snapshot proposal may **never** reference a
  `restaurant_profile_drafts` id, a `url_intakes` id, or any identifier
  outside `data/restaurants.json`'s own existing string-key space. A real
  menu concept only ever arises for an existing, already-trusted
  restaurant record — unchanged from `be-18-onboarding-menu-via-url.md`'s
  own, already-stated hard architecture agreement.
- The future "concept → real restaurant record" promotion step is
  **explicitly not designed, built, or implicitly promised here** — a
  separate, later, explicitly-scoped ticket, whenever it is decided to
  exist at all.
- `BE-17`'s review flow, `MARKET-05C`'s field-facts ledger, duplicate
  detection, and promote/discard patterns are reused to the maximum
  extent possible — no parallel model, no second reviewer workflow.
- Any extension to more than one possible origin uses separate, real
  foreign keys and a symmetric database check for exactly one valid
  origin — never a polymorphic foreign key or an untyped discriminator
  column.

## Contract

The exact, implementable shape is defined in two sibling documents, not
restated here:

1. `docs/api/url-intake-schema.md` — the `url_intakes` table itself, the
   "Governance exception" section, data minimisation, the hard boundary
   against `menu_snapshot_proposals`, the limited/normalized retention of
   selected menu candidates, and the explicit separation from bulk
   import, internal candidates, public data, and any future partner API.
2. `docs/api/restaurant-profile-drafts-schema.md`'s own "Amendment
   (2026-09-22, BE-19)" section — the `source_candidate_id`/
   `source_url_intake_id` dual-origin change on `restaurant_profile_drafts`,
   the matching `origin`/`source_url_intake_id` extension on
   `restaurant_profile_draft_field_facts`, and the named, not-yet-resolved
   consequences for the existing partial unique index and the
   `promote_candidate_to_profile_draft()` RPC.

## Non-goals / later work (explicitly out of scope for this ticket)

- **General same-host source discovery** (finding a menu link from a
  restaurant's homepage) — separate, later, explicitly-scoped ticket, per
  `be-18-onboarding-menu-via-url.md`'s own "Non-goals."
- **PDF sources, OCR, and bulk/CSV intake of multiple URLs** — unchanged,
  separate, later work, same as `BE-18`'s own non-goals.
- **Any AI-generated/heuristic extraction beyond the existing, unchanged
  JSON-LD path** — not introduced by this ticket.
- **Any change to `menu_snapshot_proposals`/`menu_snapshot_reviews` or
  `0011_be17_menu_snapshot_foundation.sql`.** Both stay byte-for-byte
  unchanged — see the contract's own "Hard boundary" section.
- **Any change to `BE-18`'s current fase-1 functionality or UI.** This
  ticket adds a new, separate path for the unmatched case; it does not
  modify the existing, already-shipped matched-restaurant flow.
- **The "concept → real restaurant record" promotion mechanism.** Not
  designed, built, or scheduled here — see "Restaurant promotion
  boundary" in `docs/api/url-intake-schema.md`.
- **Any new navigation.** The future `Beheer` → `Onboarding Restaurant`
  structure (`Nieuwe aanleveringen` / `Conceptprofielen` / `Onboarding
  Menu`) named in prior advisory rounds remains context only — no
  navigation change is proposed or authorized by this ticket.
- **Construction of, or any claim that this project already has, an
  external partner-API.** `GET /api/restaurants`/`GET /api/search` remain
  webapp routes, unaffected and unreferenced by this ticket.
- **Automatic publication or a combined "accept everything" action.**
  Restaurant-concept creation and each individual menu-concept proposal
  remain separate, explicit, human actions.

## Acceptance criteria

- [ ] `docs/api/url-intake-schema.md` exists with the `url_intakes` field
      list, the "Governance exception" section precisely bounded, and the
      data-minimisation allowlist stated exactly (no raw HTML/JSON-LD/PDF/
      full source document ever stored).
- [ ] `docs/api/restaurant-profile-drafts-schema.md`'s amendment defines
      `source_candidate_id`/`source_url_intake_id` as two real, separate,
      nullable foreign keys with a symmetric "exactly one" check — no
      polymorphic reference of any kind.
- [ ] The amendment explicitly names the required, not-yet-implemented
      changes to the existing partial unique index and to
      `promote_candidate_to_profile_draft()` — not silently assumed to be
      free.
- [ ] `restaurant_profile_draft_field_facts.origin` gains exactly one new
      value (`url_intake`) with a matching, equally nullable
      `source_url_intake_id` column and an extended symmetric check — no
      second ledger table introduced.
- [ ] The contract states, unambiguously, that a `menu_snapshot_proposals`
      row may only ever reference an existing `data/restaurants.json` key
      — never a `restaurant_profile_drafts` id or a `url_intakes` id —
      and that this is enforced by construction (which future action is
      offered), not by a new constraint on `BE-17`'s already-shipped
      tables.
- [ ] The contract states that the "concept → real restaurant record"
      promotion step is explicitly out of scope and not implicitly
      promised.
- [ ] `menu_snapshot_proposals`, `menu_snapshot_reviews`, and every
      currently-shipped `BE-18` route/UI file are byte-for-byte unchanged
      after this ticket's documentation lands.
- [ ] `planning/specs/tickets/README.md`'s `BE-*` index lists this ticket
      accurately, without altering any other entry's own status text.

## Suggested order

This ticket's later implementation is deliberately split into distinct,
separately-reviewable phases — not one combined step:

1. This ticket's own documentation commit (this round), made and pushed.
2. An independent, read-only implementation-readiness review of this
   ticket and its two sibling `docs/api/*.md` contracts.
3. **Migration** — the `url_intakes` table itself, the
   `restaurant_profile_drafts`/`_field_facts` amendment (nullable
   `source_candidate_id`, new `source_url_intake_id` columns, the
   widened partial unique index, the extended symmetric checks), written
   and locally validated in a disposable Postgres container before any
   live application.
4. **Server logic** — the new route(s) that create a `url_intakes` row on
   first durable action, the widened `promote_candidate_to_profile_draft()`
   call path (or its own dedicated RPC branch) for the
   `source_url_intake_id` origin, and the unchanged, existing
   `POST /api/internal/v1/menu-snapshots` call reused as-is once a real
   restaurant identity exists.
5. **UI** — wiring `BE-18`'s existing "no restaurant match" dead end into
   an explicit "create restaurant concept" action, with menu-concept
   creation visibly gated until a real restaurant identity exists.
6. **Tests** — unit tests for the new pure decision logic (mirroring
   `restaurantProfileDrafts.test.js`'s own shape), plus structural
   safety-net tests asserting `menu_snapshot_proposals`/`0011`'s own
   migration file remain untouched and that no route in this feature ever
   calls the menu-snapshots route with anything other than a value traced
   back to `url_intakes.matched_restaurant_id`.
7. An independent pre-commit review, a combined pre-push review, the code
   push, and a production check — tracked in this ticket's own
   `## Voortgang` checklist above, per
   `015-be-ticket-structure-and-time-boxing.md`.
8. The "concept → real restaurant record" promotion step, PDF intake,
   general source discovery, and any partner-API work each remain
   separate, later, explicitly-scoped tickets — not phases of this one.
