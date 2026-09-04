# MARKET-04 — Raw Imports & Import Runs

## Status

**Contract documented and approved. Not started — not a built import
pipeline.** This is a documentation/schema-contract ticket, same category
as `MARKET-01`–`03`, but it is deliberately **not** marked `done` the way
those were: `MARKET-01`–`03`'s entire scope *was* the documentation.
`MARKET-04`'s eventual deliverable is a working, repeatable import
mechanism — the contract below is the design that mechanism must follow,
not the mechanism itself. See "Hard gates" for what must resolve before
any implementation or first real run.

## Depends on

`[[011-market-foundation-and-international-growth]]` §6 (completeness
before popularity), §7 (source governance), §9 (risk-sensitive data), §10
(data separation); `MARKET-01` (`market.boundary` — see hard gate 1);
`MARKET-02` (canonical schema this eventually feeds, via
`SourceReference.import_run_id`); `MARKET-03` and its `MARKET-04`
amendment (`SourceAuthorizationVersion` — see
`docs/api/source-registry-schema.md`).

## Objective

Design a controlled, repeatable import lane through which Breda data can
later be lawfully brought in — without ever conflating raw source data
with canonical or published consumer data, and without ever letting a
later source re-review silently rewrite the legitimacy of a past import.

## User story

As whoever eventually builds `MARKET-05` (normalization), I want every
canonical candidate record to trace back to an exact, immutable record of
what was fetched, from where, under what authorization, and when — so a
bad normalization can be diagnosed or replayed against the original
source, and so an import's legitimacy can always be proven after the
fact, even if the source's approval status has since changed.

## Scope

- The `ImportRun` contract — see `docs/api/import-run-schema.md` for the
  full field list: source/authorization-version/market linkage, access
  method and provider actually used, source locator/version, run
  lifecycle and counts, structured error logging, checkpointing,
  idempotency, and retry lineage.
- The `SourceAuthorizationVersion` amendment to `MARKET-03` — see
  `docs/api/source-registry-schema.md`'s amendment section: `Source`'s
  regulated fields (status, terms evidence, allowed/excluded categories,
  access method, geographic applicability, reviewer, date, reason) become
  an immutable, append-only version history instead of mutable fields on
  `Source` itself.
- A data-minimisation-before-storage default: allowlist extraction for
  structured sources; a small structured extraction record (not full raw
  HTML) as the default artifact for unstructured sources; blob redaction
  demoted to a secondary safeguard; a narrowly-gated exception for
  retaining an unredacted raw capture.
- Strict separation of raw import (this ticket) from `MARKET-05`
  normalization, moderation, and `MARKET-06` publication.
- Research (not a final decision) into which pilot source and access
  route would suit a first `ImportRun` for Breda, and the specific,
  additional legal gate an OpenStreetMap pilot requires.

## Out of scope

- Actually building the `ImportRun` mechanism, any code, migration, or
  Supabase change.
- Actually running any import, against any source.
- Registering any `Source` as `allowed`/`restricted` (that is `MARKET-03`'s
  own, separate review action, per source, whenever it happens).
- A final pilot-source or access-route decision.
- `MARKET-05`'s normalization/deduplication logic itself.
- Choosing `market.boundary`'s representation or drawing Breda's actual
  boundary (`MARKET-01`'s call — see hard gate 1).
- The legal conclusion of the OpenStreetMap Collective-vs-Derivative
  -Database assessment (hard gate 3) — this ticket names the requirement,
  not the answer.
- Physical raw-storage technology and encryption mechanism (hard gate 4).

## Dependencies

Hard dependency on `MARKET-02` (`SourceReference.import_run_id`, which
this ticket's `ImportRun.id` becomes the target of) and `MARKET-03`
(amended, not redesigned, by this ticket — see
`docs/api/source-registry-schema.md`'s `MARKET-04` amendment section).

**Amendment (2026-09-04)**: `MARKET-01` (`docs/api/market-entity-schema.md`)
is now also amended by (the work toward) this gate — see hard gate 1
below and that document's own amendment section for the
`MarketBoundaryVersion` mechanism.

## Data model needs

This ticket **is** the data model definition for `ImportRun` and the
`SourceAuthorizationVersion` amendment. Output:
`docs/api/import-run-schema.md` (new) and
`docs/api/source-registry-schema.md` (amended, visibly, not silently). No
implementation.

## Moderation/verification needs

None directly — an `ImportRun` produces raw extraction records, not
canonical data or proposals; it does not touch `PLATFORM-06`'s moderation
queue. `MARKET-05` is what eventually turns raw imports into candidates
that eventually *do* go through moderation.

## Hard gates (must resolve before implementation or any real run)

1. **A programmatically-testable Breda market boundary. Narrowed further
   2026-09-02.** `docs/api/market-entity-schema.md` has
   been amended: `boundary` is now a versioned `MarketBoundaryVersion`
   reference, and the semantic question is settled — Breda's boundary is
   Gemeente Breda's administrative/municipal boundary, distinct from any
   verzorgingsgebied/bezorggebied/marktsegment notion. The candidate data
   source (Kadaster/PDOK "Bestuurlijke Gebieden") is now formally
   reviewed and `allowed` — see gate 2 below and
   `docs/api/source-registry-schema.md`'s "Registered sources" section.
   **Closed 2026-09-04**: a concrete, complete `MarketBoundaryVersion`
   (`v1`) has been captured for Breda via the controlled, guarded
   `ops/scripts/capture-market-boundary.js` live-capture procedure —
   real, digest-pinned GDAL container, real download against the
   registered PDOK source only, `source_artifact_hash`/`geometry_hash`
   both present and verified. See
   `docs/api/market-entity-schema.md`'s "Registered version — actual
   instance" section for the full record, and `market-data/CONTEXT.md`
   for how it is stored. **This closes gate 1 for Breda specifically —
   it is not a general statement that every future market's boundary is
   automatically available.** This is a boundary capture only, not a
   restaurant/menu import of any kind; gates 3 and 4 below remain open
   and are unaffected by this closure.
2. **Every targeted source has a `SourceAuthorizationVersion` with
   `status ∈ {allowed, restricted}`**, checked against that specific
   version at run time — no exceptions, including for well-known,
   generally permissive sources like OpenStreetMap. **Satisfied for one
   specific source, 2026-09-02**: Kadaster/PDOK "Bestuurlijke Gebieden"
   is now documented as `allowed`, approved by explicit human
   product-owner decision — see
   `docs/api/source-registry-schema.md`'s "Registered sources" section.
   This closes the gate **only for that one source**; every other source
   this ticket might ever target (OpenStreetMap, KVK Open Dataset, any
   restaurant-website source, anything else) still requires its own,
   separate review — this is not a general resolution of gate 2.
3. **OpenStreetMap requires a separate legal assessment before any
   pilot**: whether MenuCard's intended combination of OSM data with its
   own/other data forms a Collective Database or a Derivative Database
   under ODbL, given `MARKET-05`'s own matching/merging design — in
   addition to, not instead of, the ordinary licence/access-provider/
   route review. **Split 2026-09-04**, following read-only legal/technical
   research, into two independently-gatable parts — see
   `docs/api/source-registry-schema.md`'s "Amendment: OSM candidate-register
   processing-stage constraint" for the underlying mechanism
   (`SourceAuthorizationVersion.allowed_processing_stages[]` /
   `restricted_pending`):

   - **Gate 3A — internal OSM candidate register.**
     `3A: framework documented; still pending separate restricted
     SourceAuthorizationVersion registrations for both the OSM data
     source and the Geofabrik access provider.` **Not closed.** The
     mechanism that *would* let an internal, non-popularity-driven OSM
     candidate register be used — `status: restricted`,
     `allowed_processing_stages: [raw_import, internal_quality_review,
     moderation_preparation]` — is now documented and requires no
     external legal review to *close*, but no actual `Source`/
     `SourceAuthorizationVersion` for OpenStreetMap or for Geofabrik (its
     proposed extract provider) has been registered yet. **No OSM import
     may start on the strength of this amendment alone.**
   - **Gate 3B — merge and publication of OSM-derived data.**
     `3B: blocked pending qualified legal review before canonical merge
     or any public/API exposure.` No `SourceAuthorizationVersion` for
     OpenStreetMap or Geofabrik may ever add `canonical_merge`,
     `public_publication`, `api_exposure`, or `redistribution` to its
     `allowed_processing_stages` until a qualified legal review (external,
     or demonstrably authorized internal counsel — never AI research
     alone, per `docs/api/source-registry-schema.md`'s existing
     invariant) specifically addresses whether `MARKET-05`'s
     matching/merging design makes the OSM-derived portion a Collective
     Database or a Derivative Database under ODbL.

   Closing 3A (by actually registering both sources, restricted to the
   three permitted stages) does not narrow, weaken, or resolve 3B — they
   are independently gated, per `allowed_processing_stages`'s own
   per-stage design, not a single blanket "OSM approved" flag.
4. **Physical raw-storage technology and the encryption mechanism** for
   the unredacted-retention exception are decided before implementation.

## Risks

- Treating a source's general reputation (e.g. "OSM is well-documented
  and permissive") as equivalent to it being reviewed — guarded against
  by hard gate 2 applying uniformly, and hard gate 3's OSM-specific
  addition.
- A later source re-review silently changing the legitimacy of a past
  import — guarded against by `SourceAuthorizationVersion`'s immutability
  and `ImportRun`'s reference (never copy) to a specific version.
- Capturing more than authorized because a source's raw response happens
  to include extra fields — guarded against by allowlist-first extraction
  as the default, not redaction-after-capture.
- An unredacted-capture exception becoming a de facto default because
  it's operationally convenient — guarded against by requiring all six
  conditions (explicit grounds, strict access, encryption, short
  retention, deletion process, full audit trail) together, with none
  optional.
- Conflating a dataset's licence with a specific API/provider's technical
  access limits (e.g. assuming CC BY permissiveness implies no rate
  limit) — guarded against by keeping licence, access provider, and
  concrete route as three separately reviewed questions.

## Acceptance criteria

- [x] `ImportRun`'s full contract is documented, including idempotency,
      retry/checkpoint discipline, and structured status/error tracking.
- [x] `SourceAuthorizationVersion` is documented as a visible amendment to
      `docs/api/source-registry-schema.md`, not a silent rewrite — moved
      fields are marked, invariants extended, and what does *not* change
      (`SourceReference.source_id` still points at `Source.id`) is stated
      explicitly.
- [x] `ImportRun` references exactly one `Source.id` and one
      `SourceAuthorizationVersion.id` — never a copy of either.
- [x] The idempotency key is documented as covering source, authorization
      version, market, concrete route/query, source version, and
      execution configuration.
- [x] Data minimisation before durable storage is the documented default
      (allowlist extraction; a minimal extraction record replacing full
      raw HTML by default), with blob redaction demoted to a secondary
      safeguard and the unredacted-capture exception gated by all six
      required conditions.
- [x] Strict separation between raw import, `MARKET-05` normalization,
      moderation, and `MARKET-06` publication is documented.
- [x] Four hard gates are recorded explicitly, none resolved by this
      ticket.
- [x] Pilot source/access-route research is recorded with no final
      selection and no source registered.
- [x] No code, migration, Supabase change, API key, restaurant data,
      import, or live change of any kind.

## Suggested order

Fourth ticket of the `MARKET-*` track's Wave 2 (import & sourcing
infrastructure) — see `planning/architecture/market-data-foundation-plan.md`.
Documented and approved as a contract; blocked from implementation by the
hard gates above.
