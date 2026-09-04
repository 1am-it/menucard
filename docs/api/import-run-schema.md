# Import Run Schema (MARKET-04)

The concrete, implementable contract for `ImportRun` — the staging layer
that records each attempt to fetch data from a registered source, before
any normalization. Documentation contract only — nothing in the current
app constructs, stores, or reads this shape yet, and no import has been
run. Mirrors the convention `docs/api/market-entity-schema.md`,
`docs/api/canonical-restaurant-menu-schema.md`, and
`docs/api/source-registry-schema.md` used for `MARKET-01`–`03`, and
depends directly on the `SourceAuthorizationVersion` amendment in the
latter.

**An `ImportRun` records facts about one fetch attempt against one
source. It never matches, deduplicates, normalizes into canonical
records, or publishes anything.** Those are `MARKET-05` (normalization &
deduplication), the existing moderation flow (`PLATFORM-06`, generalized
per `[[011-market-foundation-and-international-growth]]` §5), and
`MARKET-06` (publication snapshots), respectively — none of which this
document builds or changes.

## Why this exists

`[[011-market-foundation-and-international-growth]]` §7 requires every
imported record to track source, licence/usage right, import date,
republish permission, and freshness. `docs/api/canonical-restaurant-menu-schema.md`
already names the mechanism ("Menu-level `source`/`scraped` → one
`SourceReference`... a bad normalization can be diagnosed or replayed
against the original source"). This document is that mechanism, made
concrete.

## Hard gates — this contract cannot execute a real run without all of these

None of these are resolved by this document. They are named here so a
future implementer cannot mistake "the contract is documented" for "the
contract can run."

1. **A programmatically-testable Breda market boundary.** **Closed
   2026-09-04**: a concrete, complete `MarketBoundaryVersion` (`v1`) has
   been captured for Breda via the controlled, guarded
   `ops/scripts/capture-market-boundary.js` live-capture procedure,
   sourced from the registered Kadaster/PDOK "Bestuurlijke Gebieden"
   dataset — see `docs/api/market-entity-schema.md`'s "Registered version
   — actual instance" section and `market-data/CONTEXT.md`. **This closes
   the gate for Breda specifically, not as a general guarantee that every
   future market's boundary is automatically available.** See
   `ImportRun.market_boundary_version_id` below for how a run references
   this version.
2. **Every source an `ImportRun` targets has a `SourceAuthorizationVersion`
   with `status ∈ {allowed, restricted}`** (`docs/api/source-registry-schema.md`'s
   amendment) — checked against that specific version, at the time the
   run executes. No source, including well-known or generally permissive
   ones, is exempt from this review. **Always source- and scope-specific
   — never a single, general resolution.** Satisfied, 2026-09-02, for
   Kadaster/PDOK "Bestuurlijke Gebieden": `allowed` — see
   `docs/api/source-registry-schema.md`'s "Registered sources" section.
   **Also satisfied, 2026-09-04, for OpenStreetMap and Geofabrik**: each
   `restricted`, scoped to `raw_import`/`internal_quality_review`/
   `moderation_preparation` only (gate 3A) — neither authorizes
   `canonical_merge`, `public_publication`, `api_exposure`, or
   `redistribution`, which stay separately blocked by gate 3B regardless
   of gate 2's status. KVK Open Dataset and every restaurant-website
   source each still require their own, separate review.
3. **OpenStreetMap specifically requires an additional, separate legal
   assessment before any pilot**: whether MenuCard's intended combination
   of OSM data with its own/other data forms a *Collective Database*
   (independent datasets kept side by side, each under its own licence)
   or a *Derivative Database* under ODbL (data extracted/adapted/merged
   into a new combined database, which must then itself be offered under
   ODbL). This matters concretely here because `MARKET-05`'s own design —
   matching and deduplicating multiple sources into one canonical record
   — plausibly leans toward "Derivative Database" for the OSM-derived
   portion. **Split 2026-09-04** into two independently-gatable parts —
   see `docs/api/source-registry-schema.md`'s "Amendment: OSM
   candidate-register processing-stage constraint" and
   `planning/specs/tickets/market-04-raw-imports-import-runs.md`'s own
   hard gate 3 for the precise, current wording:
   - **3A** (internal OSM candidate register, `raw_import`/
     `internal_quality_review`/`moderation_preparation` only): **closed
     2026-09-04** — both required `restricted` `SourceAuthorizationVersion`
     registrations now exist (OpenStreetMap and Geofabrik, its Netherlands
     -extract access provider) — see
     `docs/api/source-registry-schema.md`'s "Registered sources — actual
     instances". No data has been fetched under either registration.
   - **3B** (`canonical_merge`/`public_publication`/`api_exposure`/
     `redistribution`): blocked pending a qualified legal review (never
     AI research alone) of the Collective-vs-Derivative-Database
     question for `MARKET-05`'s merge design. Not answered here.
4. **Physical raw-storage technology and the encryption mechanism for the
   unredacted-retention exception** (see "Data minimisation" below) are
   decided before implementation. **Split 2026-09-04** — see "Amendment
   (2026-09-04): physical operational base" below for the full design:
   - **4A** (blobless operational storage base, Supabase/Postgres):
     design decided; **not yet closed** — requires the documentation
     approval, the actual migration/seed implementation, and live
     verification of the full access-control and referential-integrity
     test matrix, in that order.
   - **4B** (encrypted, unredacted raw-blob exception): fully open,
     untouched, out of scope.

## `ImportRun`

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | Immutable. **UUIDv7** — see "Amendment (2026-09-04): physical operational base" below. |
| `source_id` **→ superseded** | FK → `Source.id` | **Superseded 2026-09-04 by the dual data-origin/access-provider model** — see the amendment below. Left here for history; a real `ImportRun` uses `data_origin_source_id`/`access_provider_source_id` instead. |
| `source_authorization_version_id` **→ superseded** | FK → `SourceAuthorizationVersion.id` | **Superseded 2026-09-04** — see the amendment below. |
| `market_id` | FK → `market.id` | Requires `MARKET-01`'s boundary to actually be defined for this market — see hard gate 1. |
| `market_boundary_version_id` | FK → `MarketBoundaryVersion.id`, nullable | **Amendment (2026-09-04).** Not a copy. The specific boundary version this run's own scoping (e.g. a bounding query) was informed by, where applicable — reference-not-copy, same discipline as `source_authorization_version_id`. This is *not* the authoritative "is this candidate in the market" test — that is `MARKET-05`'s job, tested against a specific `MarketBoundaryVersion` at normalization time, per `docs/api/market-entity-schema.md`'s amendment (invariant 3). A record whose location cannot be tested against that version's `inclusion_rule` is `unknown`/`unresolved`, never defaulted to "in the market" (that document's invariant 4) — `MARKET-05`'s concern, not enforced by `ImportRun` itself, but the raw extraction record must preserve whatever location data exists so that test remains possible downstream. This field only lets a run itself stay traceable to which boundary definition it was run under, even for a run whose own fetch wasn't boundary-scoped at all (`null` in that case). |
| `access_method_used` | enum, drawn from the referenced version's `allowed_access_method` | Recorded per run, not merely inherited, since a source can gain additional allowed methods across later versions. |
| `access_provider_note` | text | The concrete technical provider/instance used for this run (e.g. "Overpass instance X" vs. "bulk extract from provider Y") — distinct from the licence question, matching `MARKET-03`'s existing licence-vs-access-provider separation. |
| `source_locator` | URL/query/file reference | The exact endpoint, query, or file this specific run used. |
| `source_version` / `source_version_note` | text, nullable | Whatever versioning the source itself exposes (an extract's timestamp, an ETag, a "last updated" date). Nullable where the source has none — freshness then relies on `retrieved_at` per record instead. |
| `started_at`, `completed_at` | timestamp | |
| `status` | `pending` \| `running` \| `succeeded` \| `partial` \| `failed` \| `aborted` | `partial` covers a run that completed for some records but not others — a real, expected state, not an error to hide. |
| `record_counts` | `{fetched, stored, skipped, errored}` | Numeric, recorded by the run itself — never derived after the fact by counting rows elsewhere. |
| `error_log[]` | structured list | Enough detail to diagnose without replaying the run. |
| `checkpoint` | opaque cursor/offset, nullable | Where a resumable run left off — required for any source large enough to need pagination. |
| `idempotency_key` | text, deterministic | See "Idempotency" below. |
| `triggered_by` | text/enum | `manual` \| `scheduled` \| `retry`. |
| `retried_from_run_id` | FK → `ImportRun.id`, nullable | Set only when this run is an explicit retry of a prior `failed`/`partial` run. The prior run is never mutated or deleted. |

### Idempotency

`idempotency_key` is a deterministic function of, at minimum:
`data_origin_source_id`, `data_origin_source_authorization_version_id`
(and, where set, `access_provider_source_id`/
`access_provider_source_authorization_version_id` — see the amendment
below), `market_id`, the concrete `source_locator`/route or query,
`source_version` (where the source exposes one), and a fingerprint of the
relevant execution configuration (e.g. which allowlist/extraction
ruleset version was used — see "Data minimisation" below). This means:

- Re-triggering the "same" import does not silently double-count or
  double-store.
- A source being re-reviewed to a new `SourceAuthorizationVersion` between
  two otherwise-identical requests produces a genuinely new key — the two
  runs are not conflated, since what was authorized may have changed.
- A change to *how* extraction/minimisation is performed (a bug fix, a
  stricter allowlist) also produces a new key, so old runs remain
  traceable to the exact rules that were actually applied to them.

## Amendment (2026-09-04): physical operational base — `MARKET-04A`

**Trigger**: closing `MARKET-04`'s hard gate 4 requires an actual, minimal
physical Supabase/Postgres base before a real Breda OSM candidate import
can run — this amendment records that design decision. **It does not, by
itself, close gate 4A** — see "Gate 4 status" below for what closing it
still requires (this documentation approval is one precondition among
several, not the whole thing).

### Corrected: `ImportRun` needs two, independently-versioned source
references, not one

**The problem this corrects**: the original `source_id`/
`source_authorization_version_id` pair (marked "→ superseded" above)
assumed one source per run. A Breda OSM import genuinely has two,
separately-reviewed roles per `docs/api/source-registry-schema.md`'s own
licence-vs-access-provider principle: OpenStreetMap is the licence-bearing
**data origin**; Geofabrik is a separate **access provider** for the
concrete Netherlands extract. A single pair cannot represent both without
conflating them.

**New fields, replacing `source_id`/`source_authorization_version_id`:**

| Field | Type | Notes |
|---|---|---|
| `data_origin_source_id` | FK → `Source.id`, **not nullable** | The licence-bearing source — every run has exactly one. For Kadaster/PDOK-style sources that are both licensor and technical channel, this is the only reference needed. |
| `data_origin_source_authorization_version_id` | FK → `SourceAuthorizationVersion.id`, **not nullable** | **Not a copy** — the exact immutable version current when the run executed, same discipline as before. Must belong to `data_origin_source_id` — enforced physically, not just in application code (see "Referential integrity" below). |
| `access_provider_source_id` | FK → `Source.id`, **nullable** | A separate technical-channel source (e.g. Geofabrik), only where one genuinely exists apart from the data origin. |
| `access_provider_source_authorization_version_id` | FK → `SourceAuthorizationVersion.id`, **nullable** | Same discipline as the data-origin version. Must belong to `access_provider_source_id`. |

**Invariant**: `access_provider_source_id` and
`access_provider_source_authorization_version_id` are set **together or
not at all** — never one without the other. A run with no separate access
provider (e.g. against Kadaster/PDOK) simply leaves both `null`; this is
the normal case for a source that is its own access provider, not a
degraded or incomplete state.

### Corrected: `MarketBoundaryVersion` needs the same source-authorization
reference `docs/api/market-entity-schema.md` already implied

`docs/api/market-entity-schema.md`'s `MarketBoundaryVersion.source` field
was documented as a vague "text/reference." This amendment resolves it:
see that document's own "Amendment (2026-09-04): physical operational
base" section for `source_id`/`source_authorization_version_id` and the
composite foreign key proving they belong together — the identical
discipline applied here to `ImportRun`.

### Referential integrity is a database constraint, not an application
convention

Every "X must belong to Y" relationship below is enforced via a composite
foreign key against a composite unique key on the referenced table — not
merely checked in application code before an insert:

- `SourceAuthorizationVersion(source_id, id)` is unique. `ImportRun`'s
  `(data_origin_source_id, data_origin_source_authorization_version_id)`
  and, where set, `(access_provider_source_id,
  access_provider_source_authorization_version_id)` are each a composite
  foreign key against that same unique pair — a mismatched pairing is a
  constraint violation, not a bug that silently inserts.
- `MarketBoundaryVersion(market_id, id)` is unique. `ImportRun`'s
  `(market_id, market_boundary_version_id)` is a composite foreign key
  against it, and `Market`'s own `(id, current_boundary_version_id)` is a
  composite foreign key against the same pair (a boundary version can
  only ever be "current" for the market it actually belongs to).
- `ImportRun(id, market_boundary_version_id)` is unique.
  `ImportExtractionRecord`'s `(import_run_id, market_boundary_version_id)`
  is a composite foreign key against it — an extraction record can only
  reference the exact boundary version its own run used, never a
  different one. No override/exception mechanism is built for this in
  `MARKET-04A` — a genuinely motivated future exception would be a
  separate, explicitly-decided schema change, not a built-in escape hatch.
- **Corrected 2026-09-04**: `Source` does **not** get a
  `current_authorization_version_id` pointer. An earlier draft of this
  amendment proposed one, mirroring `Market.current_boundary_version_id`
  — that mirroring was wrong and has been removed. A market has exactly
  one current boundary; a `Source`'s authorization does not work the same
  way — the same source can have distinct, simultaneously-valid
  `SourceAuthorizationVersion`s per market, country, access route, or
  processing stage, so a single global "current" pointer would suggest an
  answer that does not actually exist and could name the wrong version
  once a second market or access route is reviewed for the same source.
  See `docs/api/source-registry-schema.md`'s own correction for the full
  reasoning. Instead: **every `ImportRun` and every `MarketBoundaryVersion`
  names its own exact, applicable `SourceAuthorizationVersion.id` directly**
  (via the composite foreign keys above) — there is no intermediate
  "current" pointer on `Source` to go through. No query or view for
  "the current version for a given scope" exists yet; a future one is only
  authorized once market, time, access route, and processing stage are
  all explicit inputs to it.

### ID strategy

Every table introduced by this amendment (`Market`, `MarketBoundaryVersion`,
`Source`, `SourceAuthorizationVersion`, `ImportRun`,
`ImportExtractionRecord`) uses **UUIDv7** for `id`, generated
application-side (reusing the already-built, already-tested
`generateUuidV7()` in `ops/scripts/capture-market-boundary.js` — no new
dependency, no Postgres extension) — never Postgres's native
`gen_random_uuid()` (UUIDv4), which would be inconsistent with
`MarketBoundaryVersion.id`'s already-established UUIDv7 choice. This
resolves, for the physical/operational layer specifically, the "not yet
decided" `id`-format open question both this document and
`docs/api/source-registry-schema.md` have carried since `MARKET-01`/`03`.

### Database vs. repository — which is the source of truth for what

**Once this amendment is actually implemented** (migration + seed built
and live-verified — see "Gate 4 status" below; not true yet today), the
database becomes the operational source of truth for **relations and
runtime audit**: which boundary version is current, which authorization
version a run used, how an extraction record traces back to its run — all
resolved by querying real foreign keys, never by re-deriving state from
git at request time.

The **existing repository artifacts remain the versionable geometry
source** — `market-data/boundaries/breda/v1/breda.geojson`'s bytes are
never duplicated into Postgres. Every `MarketBoundaryVersion` row instead
carries:

| Field | Type | Notes |
|---|---|---|
| `manifest_path` | text, not null | Repo-relative path to the version's `manifest.json`. |
| `geojson_path` | text, not null | Repo-relative path to the version's operational GeoJSON. |
| `artifact_git_ref` | text, not null | **New — a path alone is not a stable reference.** The exact git commit SHA at which `manifest_path`/`geojson_path` were committed, immutable once set. For Breda's `v1`: `c5d71febe0ab4ef69d18842778c55ed9d8c96983` (confirmed via `git log --follow` against this exact repository, not assumed). |

No new geometry or source value is invented here — `artifact_git_ref`
reuses git's own content-addressed commit identity alongside the already
-existing `source_artifact_hash`/`geometry_hash` inside the manifest
itself.

### Physical security principles

RLS enabled on all six tables above, with **zero policies** for `anon` or
`authenticated` — `owner`, `editor`, and `internal` (the existing
`staff_roles` values) get no direct access either; none of them have any
documented business with raw import data at this stage. Explicit
`revoke all ... from public, anon, authenticated` alongside RLS, matching
the lesson already learned live in `supabase/migrations/0001_field_provenance.sql`
(RLS bypass and table-level `GRANT` are separate mechanisms). `service_role`
gets only the minimal grants each table's own contract actually requires:

| Table | `service_role` grants | Why |
|---|---|---|
| `Market`, `Source` | `select, insert, update` | Identity/description fields are contractually mutable (renaming, re-describing) — see `docs/api/source-registry-schema.md`'s existing "Fields that stay on Source" reasoning. |
| `MarketBoundaryVersion`, `SourceAuthorizationVersion`, `ImportExtractionRecord` | **`select, insert` only — no `update`, no `delete`** | Append-only by contract (invariant 2 for boundary versions; the versioning discipline for authorization versions; one row per fetched item for extraction records). Physically enforced — not even `service_role` can update these, regardless of application-code bugs. |
| `ImportRun` | `select, insert`, plus **column-scoped** `update` limited to `status`, `completed_at`, `record_counts`, `error_log`, `checkpoint` | Only the contractually-required lifecycle transitions are mutable. Identity, both source-reference pairs, the boundary-version reference, and `idempotency_key` get no update grant at all, ever. |

No `delete` grant anywhere.

### `reviewed_by` — actor-reference convention, going forward

`docs/api/source-registry-schema.md`'s existing `product_owner` bootstrap
reference (see that document's own explainer) remains the **only**
currently-sanctioned value for `reviewed_by`. Going forward, until a real
identity/account system exists: any future reviewer reference must follow
the identical bootstrap-reference discipline — an explicit, documented,
non-fabricated label denoting a real, specific, authorized human decision
— never an ad hoc free-text name, and never a real `auth.users.id` UUID
asserted without an actual Supabase Auth account behind it. Migrating to a
formal identity/account convention remains the same open follow-up
already recorded — this amendment only makes the interim rule explicit
rather than implicit.

### Gate 4 status

Hard gate 4 (originally: *"Physical raw-storage technology and the
encryption mechanism for the unredacted-retention exception... are
decided before implementation"*) is **split, 2026-09-04**, into two
independently-gatable parts:

- **`4A` — blobless operational storage base (this amendment).** Design
  decided by this documentation. **Not yet closed.** Closing it requires,
  in order: (1) this documentation actually approved — the step this
  amendment records; (2) the schema migration and seed migration actually
  written and applied; (3) live verification of the full access-control
  test matrix (`service_role` positive; `anon`/`authenticated`-without
  -role/`owner` negative on all six tables) **and** the referential
  -integrity test matrix (mismatched source/authorization pairs,
  cross-market boundary pointers, and mismatched extraction-record
  boundary references all correctly rejected). No `ImportRun` may execute
  against real data before all three are done.
- **`4B` — encrypted, unredacted raw-blob exception.** Fully open, out of
  scope, untouched by this amendment. The six existing conditions in
  "Data minimisation" above still all apply, unchanged.

Closing `4A` does not touch `4B`, and neither touches gate 3B — `MARKET-05`
canonical merge, public publication, API exposure, and redistribution
remain blocked there, independently.

### Repeatability, error handling, safe restart

- Imports are **append-only**: a new attempt is always a new `ImportRun`,
  never a mutation of a previous one — including a retry (see
  `retried_from_run_id` above).
- Large sources are fetched with pagination/cursor checkpointing
  (`checkpoint`), so a `partial`/`failed` run records exactly how far it
  got and a retry can resume rather than restart blind.
- Retries respect the **same** access-method constraints (rate limits,
  backoff) as the original run — a retry is not a licence to hammer a
  rate-limited endpoint. A maximum retry count, after which the run
  requires manual intervention rather than auto-retrying indefinitely, is
  an implementation detail not fixed here.

## Data minimisation — before durable storage, not after

**The default behaviour is extraction against an allowlist, not capture
of the full response.** This is a stronger default than "store raw, then
redact" — the goal is that data outside the authorized scope never
reaches durable storage in the first place, wherever the source's shape
allows that.

### Structured sources (e.g. a JSON API response with named fields)

Only fields present on the current `SourceAuthorizationVersion`'s
`allowed_data_categories` are extracted and stored. Fields outside that
allowlist — including anything matching `docs/api/source-registry-schema.md`'s
`basic_info` exclusion list (owner/staff names, personal contact details,
likely home addresses, anything identifying a natural person alone or in
combination) — are dropped before storage, not stored-then-filtered.

### Unstructured sources (e.g. a scraped web page)

**Full raw HTML is not the default stored artifact.** The default
durable record is a small, structured **extraction record**:

| Field | Notes |
|---|---|
| `record_locator` | Stable identity for this raw item *within the run* — its own natural key if the source has one, else locator+hash. Distinct from any future canonical id (`MARKET-02`) — never conflated. |
| `source_locator` | Where within the source this specific item came from. |
| `retrieved_at` | When it was fetched. |
| `content_hash` | A hash (e.g. SHA-256) of the original fetched bytes, computed *before* minimisation. Lets a later audit prove what was actually fetched and that minimisation was applied to it, without retaining the bytes themselves. |
| `extracted_fields` | Only the allowlisted subset, already minimized. |

This record — not the page — is what `MARKET-05` reads from and what a
bad-normalization diagnosis replays against in the overwhelming majority
of cases: structure, shape, and every authorized field are intact: only
content outside the authorized scope is absent.

### Blob redaction is a secondary safeguard, not the primary one

Masking detected personal-data spans inside a retained blob is an
*additional* protection used only within the exception path below — it
is never the sole or primary control, and it does not by itself justify
retaining a full blob that allowlist-extraction would otherwise have
avoided capturing at all.

### The exception: retaining an unredacted raw capture

Reserved for genuinely narrow cases (e.g. reproducing a normalization bug
that depends on exact original bytes). Retaining the full, unredacted
original response requires **all** of the following — none optional:

1. **Explicit grounds**, recorded per case — never a blanket policy
   covering a source or run type wholesale.
2. **Strict, internal-only access** — at least as narrow as claim
   evidence and other private-business data under
   `[[011-market-foundation-and-international-growth]]` §10's data
   separation, not general editor access.
3. **Encryption at rest** (mechanism not chosen here — hard gate 4).
4. **A short, defined retention period** — shorter than, and independent
   of, the retention of the (already-minimized) default extraction
   record.
5. **An explicit, auditable deletion process** at the end of that
   retention period.
6. **A full audit trail of access** — every read of the unredacted
   capture is logged: who, when, why.

Storing the unredacted original **is not automatically justified** by
this document's own stated diagnostic purpose — that purpose is served by
the minimized extraction record in almost every case. The unredacted
exception exists for the narrow remainder, gated by all six conditions
above, not as a default fallback.

## Strict separation of layers

| Layer | Reads from | Writes | Never |
|---|---|---|---|
| `ImportRun` (this document, `MARKET-04`) | The registered `Source`/`SourceAuthorizationVersion` | Extraction records (and, exceptionally, gated raw captures) | Writes to canonical tables or public snapshots |
| Normalization & deduplication (`MARKET-05`) | `ImportRun` extraction records | Canonical candidate records, each with `SourceReference`s pointing back to the originating `import_run` (already anticipated in `docs/api/canonical-restaurant-menu-schema.md` §5: `SourceReference.import_run_id`) | Mutates raw extraction records; bypasses moderation |
| Moderation (`PLATFORM-06`, generalized per `[[011-market-foundation-and-international-growth]]` §5) | Canonical candidate records | Reviewed/approved canonical data | Publishes directly |
| Publication snapshots (`MARKET-06`) | Reviewed canonical data only | Versioned, publishable snapshots | Reads raw imports or unreviewed candidates directly |

## Pilot source research (researched further, still not decided)

Building on `docs/api/source-registry-schema.md`'s existing candidate
research, specifically for how an `ImportRun` would execute:

- **OpenStreetMap** remains the strongest lead for the import mechanism
  itself, but is explicitly gated by hard gate 3 above (now split into
  3A/3B) before any pilot — not a shortcut merely because its licence is
  well-documented. Its licence (ODbL), its access provider (e.g. the
  shared public Overpass API vs. a third-party extract provider such as
  Geofabrik), and the concrete route (a specific query or a specific
  extract) remain three separately reviewed questions, per `MARKET-03`'s
  existing licence-vs-access-provider principle — not collapsed into one.
  **Update (2026-09-04, research completed)**: a regional extract via
  Geofabrik is the recommended **primary, reproducible** route — the
  public Overpass API's own stated usage policy limits regular/automated
  use to a small fraction of its already-modest one-off allowance and
  directs heavier or commercial use elsewhere, so it may only ever serve
  as a `supplementary_access_methods` entry (validation/freshness
  -checking), never as the basis for a repeatable bulk import. Geofabrik
  itself needed its own `SourceAuthorizationVersion`, distinct from
  "OpenStreetMap" as the underlying data origin. **Update (2026-09-04):
  both are now registered**, `status: restricted`, scoped to
  `raw_import`/`internal_quality_review`/`moderation_preparation` only
  (gate 3A) — see `docs/api/source-registry-schema.md`'s "Registered
  sources — actual instances". This still does not select OpenStreetMap
  as the pilot source or decide a final access route for a real import —
  it only makes internal candidate-list work against these two sources
  possible; `canonical_merge`/`public_publication`/`api_exposure`/
  `redistribution` remain blocked (gate 3B).
- **KVK Open Dataset** stays a `restricted`, enrichment-only candidate
  (BV/NV-only coverage risk, already documented). Its API's numeric rate
  limit (1 req/min per IP, 200/5min combined) is a concrete, operational
  constraint an `ImportRun` targeting it must pace against explicitly —
  a clear example of dataset licence (CC BY 4.0, permissive) and access
  limits (specific, restrictive) being genuinely different questions.
- **Gemeente Breda open data**: re-checked; still no specific horeca/
  vestigingen dataset could be confirmed. The portal is a
  JavaScript-rendered single-page application, which is itself a concrete
  reason simple automated verification hasn't settled this — it would
  need direct, interactive investigation. Not a candidate yet.
- **Individual restaurant websites** remain the existing per-site
  enrichment layer, not a first `ImportRun` pilot target given the
  per-site review burden already documented in `MARKET-03`.

**No pilot source or final access route is selected for a real import.**
**Update (2026-09-04)**: this no longer means "no source is registered" —
OpenStreetMap and Geofabrik are now registered, `restricted` to internal
candidate-list processing only (gate 3A); Kadaster/PDOK is separately
registered `allowed` for the Breda boundary (unrelated to restaurant
data). No source is registered for restaurant-data merge, publication, or
API exposure, and no restaurant-data import has run.

## Open questions (technical implementation choices only)

- Exact `id` formats — **resolved 2026-09-04 for the physical/operational
  layer**: UUIDv7, see "Amendment (2026-09-04): physical operational
  base" above. Whether every future record type follows suit remains
  the general precedent, not a re-litigated question per type.
- Physical storage technology for extraction records — **resolved
  2026-09-04**: Supabase/Postgres, see the amendment above (gate 4A).
  Separately, for the gated unredacted-capture exception (gate 4B):
  still fully open.
- Concrete retry/backoff thresholds.
- Whether a lightweight "technical connectivity check" (confirming an
  endpoint responds, without fetching or storing restaurant data) is
  formalized as a distinct, lesser action from a real `ImportRun` — named
  as a useful distinction, not mandated here.
- Exact allowlist/extraction ruleset format and how its version is
  fingerprinted for the idempotency key.
