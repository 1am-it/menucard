# Market Entity Schema (MARKET-01)

The concrete, implementable schema contract for the `market` entity — the
neutral technical unit `[[011-market-foundation-and-international-growth]]`
introduced for growth beyond Breda. Documentation contract only — nothing
in the current app constructs, stores, or reads this shape yet. The
product-level rationale lives in
[`planning/decisions/011-market-foundation-and-international-growth.md`](../../planning/decisions/011-market-foundation-and-international-growth.md);
this file defines the exact fields, mirroring the convention
`docs/api/data-trust-model.md` used for `PLATFORM-03`.

## Fields

| Field | Type | Notes |
|---|---|---|
| `id` | stable technical identifier | **Immutable.** Never changes once assigned, regardless of rebranding, boundary changes, or anything else. The only field safe to use as a long-term reference (e.g. a future foreign key). **Format resolved 2026-09-04 for the physical/operational layer: UUIDv7** — see "Amendment (2026-09-04): physical operational base" below. |
| `slug` | string | Readable, used in routes/UI (e.g. `breda`). **Mutable** — can change later (renaming, restructuring) without changing `id`. Never use `slug` where a stable reference is needed. |
| `name` | string | Display name (e.g. "Breda"). **Mutable**, independent of `slug`. |
| `boundary` | reference to the market's current `MarketBoundaryVersion` | **Amended (2026-09-04, `MARKET-04` gate 1) — see "Amendment: versioned market boundary" below.** `market.boundary` is never a bare, unversioned value; it resolves through a versioned `MarketBoundaryVersion` record. The concrete representation for a specific version (polygon, postal-code list, named administrative region) is chosen per version — see Open questions for what is and isn't decided yet. **A valid, defined boundary version is a hard precondition** — not optional — for `MARKET-04`/`05` (automated imports, market-level deduplication), `MARKET-07` (coverage metrics), and any new market launch. **Physical realization named 2026-09-04**: `current_boundary_version_id` — see "Amendment (2026-09-04): physical operational base" below. |
| `country_code` | string | ISO-style country code. |
| `timezone` | string | e.g. IANA timezone name. |
| `default_currency` | string | e.g. ISO currency code. Multi-currency display/real-time FX is not addressed here. |
| `supported_languages` | string[] | At least one. Deeper localization behaviour is not addressed here. |
| `launch_status` | `'draft' \| 'seeding' \| 'live' \| 'paused'` | **Operational state only.** Says nothing about data quality or readiness — that is `readiness_status`, entirely independent. Fixed in `[[012-city-market-readiness-thresholds]]`. |
| `readiness_status` | `'go' \| 'conditional_go' \| 'no_go'` | The `PLATFORM-09` outcome (`[[012-city-market-readiness-thresholds]]`), re-evaluated independently of `launch_status`. **Never conflate with `launch_status`** — a market can be operationally `live` while honestly `conditional_go`. |

## Why `launch_status` and `readiness_status` are two fields, not one

An earlier draft of this schema (during `MARKET-01`'s own drafting) merged
these into one vocabulary. That was caught and corrected before this
contract was finalized: collapsing them would let "live" silently imply
"fully ready," which is exactly the kind of quiet overclaim this project
has consistently avoided elsewhere (e.g. `BE-07`'s reservation-verification
honesty, `PLATFORM-01`'s own unflattering coverage numbers). Keeping them
separate lets a market be truthfully described as both operational *and*
still catching up on data quality — which is precisely Breda's own real
state today.

## Breda — retroactive reference values

| Field | Value |
|---|---|
| `id` | `01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb` — **assigned 2026-09-04**, UUIDv7, see "Amendment (2026-09-04): physical operational base" below. Previously "format not yet decided." |
| `slug` | `breda` |
| `name` | `Breda` |
| `boundary` | **Semantically decided (2026-09-04): the administrative/municipal boundary of Gemeente Breda.** Breda has never needed one before now — there has only ever been one market — this is the first time the gap is being closed, not a retraction of the earlier "not yet defined" finding, which was accurate at the time. **Update (2026-09-04, later the same day): a concrete `MarketBoundaryVersion` (`v1`) has since been captured and recorded — see "Registered version — actual instance" below.** |
| `country_code` | `NL` |
| `timezone` | `Europe/Amsterdam` |
| `default_currency` | `EUR` |
| `supported_languages` | `["nl"]` |
| `launch_status` | `live` — Breda operationally serves real visitors today. |
| `readiness_status` | `conditional_go` — per `[[012-city-market-readiness-thresholds]]`'s own table: Breda clears basic-info and price coverage, but not menu-data coverage (16% vs. a ≥50% threshold) or reservation confirmation (0% vs. ≥20%). **Deliberately not `go`** — `launch_status: live` must never be read as an implicit readiness claim. |

## Amendment (2026-09-04, `MARKET-04` gate 1): versioned market boundary — `MarketBoundaryVersion`

**Trigger**: `MARKET-04`'s own hard gate 1 requires a "programmatically
-testable" Breda boundary before any real import run. This amendment
makes `boundary` concrete and testable, mirroring the versioning
discipline `docs/api/source-registry-schema.md`'s `MARKET-04` amendment
already established for `Source` — for the same reason: a later boundary
correction must never be able to silently rewrite whether a past import
run or canonical candidate was correctly judged "in the market" at the
time.

### Semantic decision — settled, not open

**Breda's market boundary is the administrative/municipal boundary of
Gemeente Breda** (the Dutch municipality) — not a colloquial "the city of
Breda," not a commercial or delivery notion, and not any of the four
concepts `[[011-market-foundation-and-international-growth]]` already
reserves for other meanings: **verzorgingsgebied** (a single
restaurant's own catchment area), **bezorggebied** (delivery coverage),
or **marktsegment** (an audience segment). Those stay exactly as
distinct as decision 011 already requires; `market.boundary` is never
any of them.

This is a semantic decision, independent of both the technical geometry
representation and the legal review of whatever data source eventually
supplies that geometry — see "What this amendment does not decide" below.

### `MarketBoundaryVersion`

| Field | Type | Notes |
|---|---|---|
| `id` | **UUIDv7** (amended 2026-09-04, decided) | The version's own technical identity — distinct from `market.id`. **Format resolved for this record type specifically** (unlike `Market.id`/`Source.id`, which remain open elsewhere — see Open questions): UUIDv7 rather than UUIDv4, chosen for its time-ordered sort property, matching this record's append-only, chronologically-versioned nature. `id` is the only value safe to use as a stable technical reference (e.g. `ImportRun.market_boundary_version_id`) — never `business_key` below. |
| `business_key` **(added 2026-09-04)** | `{ market_slug, version_number }` | A **human-readable lookup key, never a stable technical reference.** Using `market_slug` here mirrors why `Market.id` and `Market.slug` are already kept separate ("never use `slug` where a stable reference is needed") — `market_slug` is mutable, so a value built from it must never be treated as a permanent identity. Useful for humans browsing a repository-realization (e.g. `boundaries/breda/v1/`) or a future UI; `id` is what code and foreign keys actually use. |
| `market_id` | FK → `market.id` | Which market this version belongs to. |
| `version_number` | integer | Sequential, human-readable. Duplicated inside `business_key` for lookup convenience — `business_key` does not replace this field, it packages it with `market_slug` for readability. |
| `representation_type` | enum: `polygon` \| `postal_code_list` \| `named_administrative_region` | The three candidate representations this contract already named are now the fixed, enumerable vocabulary for this field — which one a given version actually uses is chosen per version, not globally. |
| `definition_ref` | reference/locator | Points to the actual geometry/list data for this version (a file, a query, a dataset row — physical storage not chosen here). Distinct from `source` below: this is *where the data for this version lives*, not *who is authoritative for it*. **Amended 2026-09-05, clarified**: `definition_ref` always points to the **official source artifact as published** (e.g. a government dataset's own downloadable file) — never a self-made, locally derived, or pre-extracted file. Where a specific feature must be selected out of a larger official artifact (e.g. one municipality out of a nationwide file), that selection is a separate, explicit step — see `feature_selection_rule` below — not a reason to substitute a derived file as the reference of record. |
| `source_id` **(resolved 2026-09-04, replaces the earlier vague `source` text/reference field)** | FK → `Source.id` | The authoritative origin of this specific boundary definition. **This document already said** a boundary provider "should be registered and reviewed the same way any other external data origin is, reusing `docs/api/source-registry-schema.md`'s `Source`/`SourceAuthorizationVersion` mechanism" — this amendment makes that literal: a real FK, not free text. For Breda's `v1`: Kadaster/PDOK's `Source.id` — see "Amendment (2026-09-04): physical operational base" below. |
| `source_authorization_version_id` **(added 2026-09-04)** | FK → `SourceAuthorizationVersion.id` | **Not a copy** — the exact immutable authorization version that was current/applicable when this boundary version was captured, same reference-not-copy discipline as `ImportRun`'s own source references (`docs/api/import-run-schema.md`). Must belong to `source_id` above — enforced via a composite foreign key, not just application code; see the physical-operational-base amendment below. |
| `source_version` | text, nullable | The source's own versioning/edition, where it publishes one. |
| `valid_from` (peildatum) | date | The date this boundary definition is asserted accurate as of — administrative boundaries do occasionally change (mergers, border adjustments). |
| `retrieved_at` (vastleggingsdatum) | timestamp | When this version's data was actually fetched/recorded — distinct from `valid_from`, same distinction `docs/api/source-registry-schema.md` already draws between `terms_retrieved_at` and `reviewed_at`. |
| `inclusion_rule` | text, explicit | How membership is tested against this specific representation (e.g. "a coordinate is in-market if it falls within or on the polygon boundary" for `polygon`; "an address is in-market if its official postal code appears in the list" for `postal_code_list`). Never implicit — every version states its own rule in terms of its own `representation_type`. |
| `effective_from` | timestamp | When this version became the market's recorded boundary. **Required on any actually-registered version — see "Completeness required for a real, registered version" below.** |
| `supersedes_version` **(replaces `superseded_by`/`superseded_at` — amended 2026-09-04, corrected)** | FK → `MarketBoundaryVersion.id`, nullable | **Set once, at this version's own creation** — points backward to the version it replaces. `null` on a market's first version. See "Amendment: immutable succession" below for why this replaces the previous, self-contradictory fields. |
| `feature_selection_rule` **(added 2026-09-05)** | text, explicit | The deterministic rule for selecting *which* feature within `definition_ref`'s official artifact this version actually uses — distinct from `inclusion_rule` above, which tests whether an external coordinate/address falls *inside* the already-selected boundary. `feature_selection_rule` answers "which feature is Breda's," `inclusion_rule` answers "is this point inside Breda's boundary." A selection rule names one **primary selector** (a stable code, never a database-internal UUID/feature id, even one that looks stable — see the invariant below) plus one or more **required validation assertions** that must independently match; if a validation assertion fails, selection must halt as an error, never silently proceed on the primary selector alone. |
| `source_artifact_hash_algorithm` **(added 2026-09-05)** | text (e.g. `SHA-256`) | The hash algorithm used for `source_artifact_hash` below. |
| `source_artifact_hash` **(added 2026-09-05)** | text (hex digest) | A cryptographic hash of the **entire official source artifact** at `definition_ref`, exactly as retrieved, computed *before* any derivation step. Proves which exact file was used, independent of retaining the file itself. |
| `geometry_hash` **(added 2026-09-05)** | text (hex digest) | A hash of the **exact, serialized operational geometry bytes** produced by `derivation` below — i.e. the actual `breda.geojson`-equivalent file this version ships, after `feature_selection_rule` and coordinate reprojection/serialization have all been applied. Distinct from `source_artifact_hash`: that one proves which *original* file was fetched; this one proves which *derived* artifact was actually recorded from it. Reproducibility of this hash depends entirely on `derivation`'s recorded procedure — it is not expected to match across different, undocumented tool invocations. |
| `derivation` **(added 2026-09-04)** | object, see below | Mandatory metadata describing exactly how the operational geometry was produced from the official source artifact. See "Amendment: mandatory `derivation` metadata" below for the full sub-field list. |
| `manifest_path` **(added 2026-09-04)** | text | Repo-relative path to this version's `manifest.json` — see "Amendment (2026-09-04): physical operational base" below. The geometry itself is never duplicated into a database; this is a pointer to it. |
| `geojson_path` **(added 2026-09-04)** | text | Repo-relative path to this version's operational GeoJSON. |
| `artifact_git_ref` **(added 2026-09-04)** | text | **A path alone is not a stable reference.** The exact git commit SHA at which `manifest_path`/`geojson_path` were committed, immutable once set. Reuses git's own content-addressed identity — no new hash invented. |

### Invariants

1. **(Corrected 2026-09-04 — see the amendment below.)** `market.boundary`
   is the **only** mutable pointer to "which version is current" — it is
   a field on `market` (`MARKET-01`'s own entity), not on any
   `MarketBoundaryVersion` record. Resolving "the current version" means
   dereferencing `market.boundary`; it is never determined by scanning
   version records for a mutable flag on the version itself.
   `boundaries/<market>/current.json` is the repository-realization;
   **`markets.current_boundary_version_id` is the physical, DB-column
   realization — decided 2026-09-04, see "Amendment (2026-09-04):
   physical operational base" below** (previously "not decided here").
   `market.boundary` is never a bare, unversioned value — it always names
   one specific `MarketBoundaryVersion.id`.
2. A `MarketBoundaryVersion`, once created, is **never edited** — any
   change, including a minor correction, creates a new version.
3. Membership tests (an address, a coordinate, a candidate record) are
   evaluated against a **specific, referenced** boundary version, not
   implicitly "whatever the market's boundary currently is." A process
   that tests membership (`MARKET-05`'s matching step; an `ImportRun`'s
   own scoping — see `docs/api/import-run-schema.md`'s amendment) records
   which `market_boundary_version_id` it used — the same reference-not
   -copy discipline already established for `SourceAuthorizationVersion`.
4. **Uncertain or missing location data is never treated as "inside the
   market."** A location without enough data to test membership against
   the `inclusion_rule` is recorded as `unknown`/`unresolved` — a third,
   honest state, distinct from both "in" and "out." This extends
   `[[011-market-foundation-and-international-growth]]` §9's
   risk-sensitive-data honesty principle (no fabricated certainty) to
   geographic inclusion specifically.
5. A future larger region, merged market, or cross-border market gets its
   **own** `market_id` and its **own** `MarketBoundaryVersion` chain — it
   never silently redefines or absorbs an existing market's boundary or
   identity. Breda's `market_id` and boundary history stay exactly what
   they were, regardless of what MenuCard later expands into around it.
6. **(Added 2026-09-05)** `feature_selection_rule`'s primary selector is
   always a stable, externally meaningful identifier (e.g. an official
   administrative code) — **never a source-internal database id or
   feature UUID, even one that appears stable.** A source's own internal
   identifiers are an implementation detail of that source's database,
   not a guarantee available to MenuCard; a stable-looking UUID today is
   still not the product rule. The required validation assertions (e.g. a
   name check) exist precisely to catch a primary-selector mismatch
   before it silently corrupts a boundary version.
7. **(Added 2026-09-04)** A record is only a real, registered
   `MarketBoundaryVersion` if every field required by "Completeness
   required for a real, registered version" below is actually filled in
   — no `null` placeholders. An incomplete record is not a lesser or
   draft version of this type; it is not a `MarketBoundaryVersion` at
   all, only a documentation example of one (see that section).

### Amendment (2026-09-04): immutable succession — `supersedes_version` replaces `superseded_by`/`superseded_at`

**The problem this corrects**: the fields this document previously named,
`superseded_by`/`superseded_at` ("set once a later version replaces this
one"), directly contradicted invariant 2 ("a `MarketBoundaryVersion`,
once created, is never edited") — setting them necessarily meant writing
to an *older*, already-created record after the fact. This was a real
inconsistency in the committed contract, not a hypothetical one, and is
corrected here rather than left standing.

**The correction**: `market.boundary` (`MARKET-01`'s own field, on
`market`, not on `MarketBoundaryVersion`) was already documented as "a
reference to the market's current `MarketBoundaryVersion`" — it was
always the correct mutable pointer; this amendment simply stops
duplicating that same responsibility onto the immutable version records
themselves. Concretely:

- Every `MarketBoundaryVersion` may record `supersedes_version`, naming
  the version it replaces — but only **at its own creation**, never
  edited afterward. A version never needs to know whether or by what it
  is later replaced; only which version, if any, it itself replaces.
- "Which version is current" is answered exclusively by `market.boundary`
  — never by inspecting version records for a mutable flag. A
  repository-realization's equivalent of `market.boundary` (e.g. a
  `current.json`-style pointer file) is the *only* thing that changes
  when a new version supersedes an old one; every `vN/` version record
  itself, once committed, is never touched again.
- This fully resolves the invariant-2 contradiction: no
  `MarketBoundaryVersion` field is ever written to after that record's
  own creation.

**Update (2026-09-04): the parallel gap is now fixed.**
`docs/api/source-registry-schema.md`'s `SourceAuthorizationVersion` had
the identical `superseded_by`/`superseded_at` inconsistency, repeatedly
flagged here as a "known parallel gap, not fixed here." It has since been
corrected there, using the identical `supersedes_version` pattern — see
that document's own "Amendment (2026-09-04): immutable succession
correction." No gap remains between the two documents.

### Amendment (2026-09-04): mandatory `derivation` metadata

Every `MarketBoundaryVersion` whose operational geometry is *derived*
from a larger or differently-projected official artifact (true for
Breda's case — see `docs/api/source-registry-schema.md`'s registered
Kadaster/PDOK source) must record exactly how that derivation was
performed, so `geometry_hash` means something verifiable rather than an
unreproducible number.

**`derivation` (object)**

| Sub-field | Notes |
|---|---|
| `input_crs` | The official source artifact's own coordinate reference system (e.g. `EPSG:28992`). |
| `output_crs` | The operational geometry's coordinate reference system (e.g. `EPSG:4326` — GeoJSON/RFC 7946 mandates WGS84, so a source in a different CRS necessarily requires reprojection, not just format conversion). |
| `tool` | The exact tool name **and version** used to perform selection/reprojection/serialization (e.g. a specific GDAL/ogr2ogr version). A bare tool name without a pinned version does not satisfy this field. |
| `tool_reference` | An immutable reference to that exact tool build — a pinned container image digest, or an exact package name/version plus lockfile hash. Exists so "the tool" is reproducible even if a mutable tag (e.g. `latest`) would otherwise drift over time. |
| `procedure_ref` | A reference to a versioned, written, step-by-step procedure (a script, a runbook, or equivalent) that performed the derivation — not a free-text description of intent. |
| `serialization_rule` | The fixed output format and precision rule (e.g. `{ format: "GeoJSON Feature (RFC 7946)", coordinate_precision_decimals: 7, key_order: "sorted" }`) — without a fixed rule, re-running the same tool can still produce different bytes and an unreproducible `geometry_hash`. |

### Completeness required for a real, registered version

**A `MarketBoundaryVersion` that is actually registered — referenced by
`market.boundary`, or by any `ImportRun`/`MarketBoundaryVersion` chain —
must have every field filled in. None of the following may be `null` on
a real, registered version**: `retrieved_at`, `source_artifact_hash`,
`geometry_hash`, `derivation.tool`, `derivation.tool_reference`,
`derivation.procedure_ref`, `effective_from`.

**An incomplete record — one with any of the above still `null` — is not
a `MarketBoundaryVersion`.** It may exist only as a clearly labeled,
**non-canonical, pre-capture example** in documentation (e.g. a
worked-through template showing the intended shape before the actual
controlled retrieval/hashing has happened) — never committed as a
`vN/manifest.json`-equivalent, never referenced by `market.boundary`,
and never mistaken for a registered version. The distinction is
binary, not a matter of degree: a record is either a complete, real,
immutable `MarketBoundaryVersion`, or it is documentation illustrating
one that does not yet exist.

### Amendment (2026-09-04): physical operational base — `MARKET-04A`

**Trigger**: closing `MARKET-04`'s hard gate 4A requires an actual,
minimal Supabase/Postgres base — see `docs/api/import-run-schema.md`'s
own amendment of the same name for the full `ImportRun` design; this
section records what changes for `Market`/`MarketBoundaryVersion`
specifically. **This section decides the design; it does not, by itself,
close gate 4A** — see "Gate status" below.

**`id` strategy**: `Market.id` and `MarketBoundaryVersion.id` use
**UUIDv7**, generated application-side (reusing
`ops/scripts/capture-market-boundary.js`'s already-tested
`generateUuidV7()` — no new dependency, no Postgres extension), never
Postgres's native `gen_random_uuid()` (UUIDv4). This resolves `Market.id`'s
previously-open format question for the physical layer, matching
`MarketBoundaryVersion.id`'s already-established choice.

**Referential integrity as database constraints, not application
convention**:

- `MarketBoundaryVersion(market_id, id)` is unique. `Market`'s own
  `(id, current_boundary_version_id)` is a composite foreign key against
  that pair — `markets.current_boundary_version_id` can only ever point
  at a boundary version that actually belongs to that same market. **This
  pointer is specific to `Market`** — a market genuinely has exactly one
  current boundary at a time, unlike a `Source`'s authorization, which is
  scope- and time-bound and does **not** get an equivalent global "current
  version" pointer (see `docs/api/source-registry-schema.md`'s correction:
  an earlier draft of that amendment proposed one, mirroring this field
  exactly, and removed it as semantically wrong once reviewed).
- `SourceAuthorizationVersion(source_id, id)` is unique (defined in
  `docs/api/source-registry-schema.md`). `MarketBoundaryVersion`'s own
  `(source_id, source_authorization_version_id)` is a composite foreign
  key against it — a boundary version's authorization reference is
  physically guaranteed to belong to its own `source_id`, never a
  different source's version by accident.
- `ImportRun(id, market_boundary_version_id)` is unique
  (`docs/api/import-run-schema.md`). `ImportExtractionRecord`'s
  `(import_run_id, market_boundary_version_id)` is a composite foreign
  key against it — an extraction record can only reference the exact
  boundary version its own run used. No override/exception mechanism is
  built for this — a genuinely motivated future exception is a separate,
  explicitly-decided schema change, not a built-in escape hatch.

**Database vs. repository**: once this amendment is actually implemented
(migration + seed built and live-verified — not true yet today), the
database is the operational source of truth for relations and runtime
audit (which boundary version is current, which authorization version a
boundary/run used). The existing repository artifacts
(`market-data/boundaries/breda/v1/breda.geojson` and its `manifest.json`)
remain the versionable geometry source of truth — never duplicated into
Postgres; the DB row instead carries `manifest_path`/`geojson_path`/
`artifact_git_ref` (see the field table above) pointing at them.

**Physical security**: RLS on all six operational tables
(`markets`, `market_boundary_versions`, `sources`,
`source_authorization_versions`, `import_runs`,
`import_extraction_records`), zero policies for `anon`/`authenticated`
— `owner`, `editor`, and `internal` (the existing `staff_roles` values)
get no direct access either — plus explicit `revoke all ... from public,
anon, authenticated`. `service_role` gets only: `select, insert, update`
on `markets`/`sources` (contractually mutable identity/description
fields); **`select, insert` only — no `update`, no `delete`** on
`market_boundary_versions`/`source_authorization_versions`/
`import_extraction_records` (physically enforcing their append-only,
never-edited contracts, even against `service_role` itself); `select,
insert`, plus **column-scoped** `update` limited to `status`,
`completed_at`, `record_counts`, `error_log`, `checkpoint` on
`import_runs` — identity, both source-reference pairs, the boundary
-version reference, and `idempotency_key` never get an update grant. Full
detail and the reasoning: `docs/api/import-run-schema.md`'s own amendment.

### Completeness required for the DB-row realization (distinct from the
manifest completeness list above)

The "Completeness required for a real, registered version" list above
governs the `manifest.json` artifact itself and the capture tool that
produces it (`ops/scripts/capture-market-boundary.js`'s own
`assertComplete()`) — **unchanged by this amendment**. A **DB row**
realizing a `MarketBoundaryVersion` has its own, additional completeness
requirement: `source_id`, `source_authorization_version_id`,
`manifest_path`, `geojson_path`, and `artifact_git_ref` may never be
`null` on a row actually referenced by `markets.current_boundary_version_id`
or by any `ImportRun`. These fields do not need to exist inside the
manifest JSON file's own schema — they are the DB layer's superset,
recorded once at seed/insert time.

### Gate status

Hard gate 4 is **split, 2026-09-04**, matching
`docs/api/import-run-schema.md`'s own split:

- **`4A`** (this amendment, plus `docs/api/import-run-schema.md`'s and
  `docs/api/source-registry-schema.md`'s matching amendments): **closed
  2026-09-04.** Documentation approved; the migration and seed were
  implemented, locally validated in a disposable PostgreSQL container,
  and then applied live to the actual Supabase project — exactly one
  Breda market, one boundary version (`v1`, the same record described in
  "Registered version — actual instance" above), three sources, and three
  `SourceAuthorizationVersion`s now exist there, with `import_runs`/
  `import_extraction_records` still empty. Full access-control and
  referential-integrity test matrix live-verified, including manual
  confirmation that RLS is active on all six tables and that
  `service_role` can read but delete nothing. See
  `docs/api/import-run-schema.md`'s own "Gate 4 status" for the complete
  record.
- **`4B`**: fully open, untouched.

### Registered version — actual instance (2026-09-04)

Breda's first `MarketBoundaryVersion` has been captured via the controlled,
reproducible procedure in `ops/scripts/capture-market-boundary.js` — a
real, digest-pinned GDAL container invocation against a guarded live
download of the one registered Kadaster/PDOK source (see
`docs/api/source-registry-schema.md`'s "Registered sources" section). This
closes `MARKET-04`'s hard gate 1 for Breda — see that ticket's own "Hard
gates" section.

| Field | Value |
|---|---|
| `id` | `01a06ddc-a892-7170-8440-18b932764195` |
| `business_key` | `{ market_slug: "breda", version_number: 1 }` |
| `representation_type` | `polygon` (recorded as a GeoJSON `MultiPolygon` — Gemeente Breda's administrative area is not simply connected) |
| `definition_ref` | `https://service.pdok.nl/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg` |
| `source_id` **(added 2026-09-04, replaces the earlier prose `source` value)** | `01a06e1e-aa9f-7acc-a5cb-61d8c501befb` — Kadaster/PDOK's `Source.id`, see `docs/api/source-registry-schema.md`'s "Registered sources" section. |
| `source_authorization_version_id` **(added 2026-09-04)** | `01a06e1e-aa9f-7cc6-a59c-d3280676b896` — Kadaster/PDOK's v1 `SourceAuthorizationVersion.id`. |
| `source_version` | Bestuurlijke Gebieden 2026 (definitieve editie) |
| `valid_from` | `2026-01-01` |
| `retrieved_at` / `effective_from` | `2026-09-04T19:19:32.752Z` |
| `feature_selection_rule` | primary selector `identificatie = "GM0758"`; validations `code = "0758"` and `naam = "Breda"` — all three confirmed present and matching on the actual retrieved artifact |
| `source_artifact_hash_algorithm` | `SHA256` |
| `source_artifact_hash` | `1efa5bbed78bb5aa9d918d48bcabcd9a3c0e816671545e42cd68be057b8423e6` |
| `geometry_hash` | `3b0cf4ee30911f67af5502a16b54ccb46849c14ed7a2d8ae6671eaa9ce8cbf84` |
| `derivation.input_crs` → `output_crs` | `EPSG:28992` → `EPSG:4326` |
| `derivation.tool` | `GDAL 3.13.3 "Iowa City", released 2026/08/13` |
| `derivation.tool_reference` | `ghcr.io/osgeo/gdal@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40` |
| `derivation.procedure_ref` | `ops/scripts/capture-market-boundary.js` at git revision `8f996c2bc5140c9e22f42c5edaecd14e0fbc0050` — the capture *script's own* revision at the time it ran. Distinct from `artifact_git_ref` below, which is the commit that added the resulting files to the repo. |
| `supersedes_version` | `null` (Breda's first version) |
| `manifest_path` **(added 2026-09-04)** | `market-data/boundaries/breda/v1/manifest.json` |
| `geojson_path` **(added 2026-09-04)** | `market-data/boundaries/breda/v1/breda.geojson` |
| `artifact_git_ref` **(added 2026-09-04)** | `c5d71febe0ab4ef69d18842778c55ed9d8c96983` — confirmed via `git log --follow` against this exact repository (commit "feat(market): record Breda boundary version 1"), not assumed from memory. |

Repository realization: `market-data/boundaries/breda/v1/manifest.json` (this
record) and `market-data/boundaries/breda/v1/breda.geojson` (the operational
geometry `geometry_hash` was computed over). `market-data/boundaries/breda/current.json`
is the repo-realization of `market.boundary`, pointing at this version — see
`market-data/CONTEXT.md` for that directory's own rules, including that the
downloaded national GeoPackage is never retained: `source_artifact_hash`
proves which exact upstream file was used without keeping the file itself.

**Attribution required wherever this geometry is used or displayed**:
"Kadaster, Bestuurlijke Gebieden" (CC BY 4.0).

This records only Breda's geographic boundary. It is not a restaurant,
menu, or reservation import of any kind, and does not touch
`data/restaurants.json`/`data/menus.json`, any database, or Supabase.
`MARKET-04`'s hard gates 3 (OpenStreetMap's separate Collective/
Derivative-Database legal assessment) and 4 (physical raw-storage
technology and encryption mechanism) remain open and are unrelated to
this capture.

### What this amendment does not decide

- **The concrete geometry/data source for Breda's actual boundary.**
  **Update (2026-09-02)**: a provider — Kadaster/PDOK "Bestuurlijke
  Gebieden" — has since been formally reviewed and registered as
  `allowed` (see `docs/api/source-registry-schema.md`'s "Registered
  sources" section). This still does not record a concrete
  `MarketBoundaryVersion` for Breda — approving the source is not the
  same as retrieving, hashing, and canonically recording a version from
  it (see "Completeness required for a real, registered version" above).
  **Update (2026-09-04): no longer accurate — a concrete version (`v1`)
  has since been captured and recorded; see "Registered version — actual
  instance" above.**
- **Which `representation_type` Breda's first real version will use**
  (polygon vs. postal-code list vs. named administrative region) — the
  vocabulary is now fixed; the choice for Breda's actual first version is
  not. **Update (2026-09-04): decided for `v1` — `polygon` — see
  "Registered version — actual instance" above.**
- **Physical storage technology** for `definition_ref` — not chosen,
  matching the "logical, not physical" precedent this contract and
  `docs/api/canonical-restaurant-menu-schema.md` already set. **Partially
  resolved 2026-09-04**: the DB-row realization of a `MarketBoundaryVersion`
  (Supabase/Postgres — see "Amendment (2026-09-04): physical operational
  base" above) is now decided; the official source artifact's own hosting
  (PDOK's, not MenuCard's) was never MenuCard's to decide and stays n/a.
- **No `MarketBoundaryVersion` has been recorded for Breda.** The Breda
  reference row above records the *semantic* decision (Gemeente Breda's
  administrative boundary) only — there is no version 1 yet. **Update
  (2026-09-04): no longer accurate — see "Registered version — actual
  instance" above.**

## Open questions (not decided here)

- Concrete `id` format for `Market`/`Source` — **resolved 2026-09-04 for
  the physical/operational layer**: UUIDv7, matching
  `MarketBoundaryVersion.id`'s already-established choice — see "Amendment
  (2026-09-04): physical operational base" above. `MARKET-02`'s own
  canonical-schema ids remain a separate, still-open question.
- Concrete `representation_type` for Breda's actual first
  `MarketBoundaryVersion`, and the concrete geometry to record — see the
  amendment above; the versioning *contract* is now fixed, the concrete
  first value is not. **Resolved 2026-09-04 for `v1` specifically**:
  `polygon` (`MultiPolygon` GeoJSON) — see "Registered version — actual
  instance" above. Whether a *future* version or a *different* market ever
  uses `postal_code_list`/`named_administrative_region` instead remains
  open.
- Whether/how `readiness_status` gets recomputed automatically once
  `MARKET-07` exists, versus staying a manually-recorded decision as it is
  today.
- Multi-currency and deeper localization handling beyond a single
  `default_currency`/`supported_languages` pair.

## Out of scope for this contract

- Any canonical database, storage engine, or persistence choice.
- A market selector, a second market, or any change to the current Breda
  consumer read path.
- Automatic transitions between `launch_status` values (e.g. what
  triggers `seeding` → `live`) — not defined here.
