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

1. **A programmatically-testable Breda market boundary. Narrowed
   2026-09-04, still not closed.** `docs/api/market-entity-schema.md` has
   been amended with a versioned `MarketBoundaryVersion` mechanism and
   settles the semantic question — Breda's boundary is Gemeente Breda's
   administrative/municipal boundary. **What's still missing**: no
   concrete `MarketBoundaryVersion` — geometry, reviewed data source,
   chosen representation type — has actually been recorded for Breda.
   This document does not record that concrete version either; see
   `ImportRun.market_boundary_version_id` below for how a run references
   one once it exists.
2. **Every source an `ImportRun` targets has a `SourceAuthorizationVersion`
   with `status ∈ {allowed, restricted}`** (`docs/api/source-registry-schema.md`'s
   amendment) — checked against that specific version, at the time the
   run executes. No source, including well-known or generally permissive
   ones, is exempt from this review.
3. **OpenStreetMap specifically requires an additional, separate legal
   assessment before any pilot**: whether MenuCard's intended combination
   of OSM data with its own/other data forms a *Collective Database*
   (independent datasets kept side by side, each under its own licence)
   or a *Derivative Database* under ODbL (data extracted/adapted/merged
   into a new combined database, which must then itself be offered under
   ODbL). This matters concretely here because `MARKET-05`'s own design —
   matching and deduplicating multiple sources into one canonical record
   — plausibly leans toward "Derivative Database" for the OSM-derived
   portion. **This document does not answer that question** — it is a
   legal assessment, not a technical one, and is named as a precondition,
   not resolved here. It is in addition to, not a replacement for, the
   ordinary review of OSM's licence, its access provider, and the
   concrete access route (see "Pilot source research" below).
4. **Physical raw-storage technology and the encryption mechanism for the
   unredacted-retention exception** (see "Data minimisation" below) are
   decided before implementation. Not chosen here — matches the "logical,
   not physical" precedent `docs/api/canonical-restaurant-menu-schema.md`
   already set.

## `ImportRun`

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | Immutable. |
| `source_id` | FK → `Source.id` | Exactly one source per run. |
| `source_authorization_version_id` | FK → `SourceAuthorizationVersion.id` | **Not a copy.** The exact immutable version that was current when this run executed — see `docs/api/source-registry-schema.md`'s amendment. A run's legitimacy is judged against this reference forever, even after the source is later re-reviewed. |
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

`idempotency_key` is a deterministic function of, at minimum: `source_id`,
`source_authorization_version_id`, `market_id`, the concrete
`source_locator`/route or query, `source_version` (where the source
exposes one), and a fingerprint of the relevant execution configuration
(e.g. which allowlist/extraction ruleset version was used — see "Data
minimisation" below). This means:

- Re-triggering the "same" import does not silently double-count or
  double-store.
- A source being re-reviewed to a new `SourceAuthorizationVersion` between
  two otherwise-identical requests produces a genuinely new key — the two
  runs are not conflated, since what was authorized may have changed.
- A change to *how* extraction/minimisation is performed (a bug fix, a
  stricter allowlist) also produces a new key, so old runs remain
  traceable to the exact rules that were actually applied to them.

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
  itself, but is explicitly gated by hard gate 3 above (Collective vs.
  Derivative Database) before any pilot — not a shortcut merely because
  its licence is well-documented. Its licence (ODbL), its access provider
  (e.g. the shared public Overpass API vs. a third-party extract
  provider such as Geofabrik), and the concrete route (a specific query
  or a specific extract) remain three separately reviewed questions, per
  `MARKET-03`'s existing licence-vs-access-provider principle — not
  collapsed into one. A regional extract via a reviewed third-party
  provider carries less live-service/rate-limit risk for a first test run
  than the shared Overpass API, which is a operational observation, not a
  decision — the extract provider itself would need its own
  `SourceAuthorizationVersion`, distinct from "OpenStreetMap" as the
  underlying data origin.
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

**No pilot source or access route is selected. No source is registered.**

## Open questions (technical implementation choices only)

- Exact `id` formats — same open item as `MARKET-01`–`03`.
- Physical storage technology for extraction records and, separately, for
  the gated unredacted-capture exception (hard gate 4).
- Concrete retry/backoff thresholds.
- Whether a lightweight "technical connectivity check" (confirming an
  endpoint responds, without fetching or storing restaurant data) is
  formalized as a distinct, lesser action from a real `ImportRun` — named
  as a useful distinction, not mandated here.
- Exact allowlist/extraction ruleset format and how its version is
  fingerprinted for the idempotency key.
