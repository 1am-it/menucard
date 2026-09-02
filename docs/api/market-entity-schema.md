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
| `id` | stable technical identifier | **Immutable.** Never changes once assigned, regardless of rebranding, boundary changes, or anything else. The only field safe to use as a long-term reference (e.g. a future foreign key). Concrete format (UUID vs. an internal key scheme) not chosen — see Open questions. |
| `slug` | string | Readable, used in routes/UI (e.g. `breda`). **Mutable** — can change later (renaming, restructuring) without changing `id`. Never use `slug` where a stable reference is needed. |
| `name` | string | Display name (e.g. "Breda"). **Mutable**, independent of `slug`. |
| `boundary` | reference to the market's current `MarketBoundaryVersion` | **Amended (2026-09-04, `MARKET-04` gate 1) — see "Amendment: versioned market boundary" below.** `market.boundary` is never a bare, unversioned value; it resolves through a versioned `MarketBoundaryVersion` record. The concrete representation for a specific version (polygon, postal-code list, named administrative region) is chosen per version — see Open questions for what is and isn't decided yet. **A valid, defined boundary version is a hard precondition** — not optional — for `MARKET-04`/`05` (automated imports, market-level deduplication), `MARKET-07` (coverage metrics), and any new market launch. |
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
| `id` | Breda's own stable identity (format not yet decided — see Open questions) |
| `slug` | `breda` |
| `name` | `Breda` |
| `boundary` | **Semantically decided (2026-09-04): the administrative/municipal boundary of Gemeente Breda.** No concrete `MarketBoundaryVersion` has been recorded yet — see the amendment below. Breda has never needed one before now — there has only ever been one market — this is the first time the gap is being closed, not a retraction of the earlier "not yet defined" finding, which was accurate at the time. |
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
| `id` | stable identity | The version's own identity — distinct from `market.id`. |
| `market_id` | FK → `market.id` | Which market this version belongs to. |
| `version_number` | integer | Sequential, human-readable. |
| `representation_type` | enum: `polygon` \| `postal_code_list` \| `named_administrative_region` | The three candidate representations this contract already named are now the fixed, enumerable vocabulary for this field — which one a given version actually uses is chosen per version, not globally. |
| `definition_ref` | reference/locator | Points to the actual geometry/list data for this version (a file, a query, a dataset row — physical storage not chosen here). Distinct from `source` below: this is *where the data for this version lives*, not *who is authoritative for it*. **Amended 2026-09-05, clarified**: `definition_ref` always points to the **official source artifact as published** (e.g. a government dataset's own downloadable file) — never a self-made, locally derived, or pre-extracted file. Where a specific feature must be selected out of a larger official artifact (e.g. one municipality out of a nationwide file), that selection is a separate, explicit step — see `feature_selection_rule` below — not a reason to substitute a derived file as the reference of record. |
| `source` | text/reference | The authoritative origin of this specific boundary definition (e.g. a named geodata registry or the municipality's own published boundary). **For a market boundary sourced from outside MenuCard's own records, this should be registered and reviewed the same way any other external data origin is** — reusing `docs/api/source-registry-schema.md`'s `Source`/`SourceAuthorizationVersion` mechanism rather than inventing a parallel one, since a boundary provider is exactly the same kind of thing MARKET-03 already governs: an external source with its own terms, licence, and version. Not yet filled in for Breda — see "What this amendment does not decide." |
| `source_version` | text, nullable | The source's own versioning/edition, where it publishes one. |
| `valid_from` (peildatum) | date | The date this boundary definition is asserted accurate as of — administrative boundaries do occasionally change (mergers, border adjustments). |
| `retrieved_at` (vastleggingsdatum) | timestamp | When this version's data was actually fetched/recorded — distinct from `valid_from`, same distinction `docs/api/source-registry-schema.md` already draws between `terms_retrieved_at` and `reviewed_at`. |
| `inclusion_rule` | text, explicit | How membership is tested against this specific representation (e.g. "a coordinate is in-market if it falls within or on the polygon boundary" for `polygon`; "an address is in-market if its official postal code appears in the list" for `postal_code_list`). Never implicit — every version states its own rule in terms of its own `representation_type`. |
| `effective_from` | timestamp | When this version became the market's recorded boundary. |
| `superseded_by`, `superseded_at` | FK / timestamp, nullable | Set once a later version replaces this one. `null` on the current version. |
| `feature_selection_rule` **(added 2026-09-05)** | text, explicit | The deterministic rule for selecting *which* feature within `definition_ref`'s official artifact this version actually uses — distinct from `inclusion_rule` above, which tests whether an external coordinate/address falls *inside* the already-selected boundary. `feature_selection_rule` answers "which feature is Breda's," `inclusion_rule` answers "is this point inside Breda's boundary." A selection rule names one **primary selector** (a stable code, never a database-internal UUID/feature id, even one that looks stable — see the invariant below) plus one or more **required validation assertions** that must independently match; if a validation assertion fails, selection must halt as an error, never silently proceed on the primary selector alone. |
| `source_artifact_hash_algorithm` **(added 2026-09-05)** | text (e.g. `SHA-256`) | The hash algorithm used for `source_artifact_hash` below. |
| `source_artifact_hash` **(added 2026-09-05)** | text (hex digest) | A cryptographic hash of the **entire official source artifact** at `definition_ref`, exactly as retrieved — not of any extracted subset. Proves which exact file was used, independent of retaining the file itself. |
| `geometry_hash` **(added 2026-09-05)** | text (hex digest), nullable | A separate hash of only the **selected feature's geometry**, after `feature_selection_rule` has been applied — distinct from `source_artifact_hash`, which covers the whole official artifact. Nullable because selection may not always produce an isolable geometry blob to hash independently of the source artifact; where it does, recording both hashes lets a later audit tell apart "the official source file changed" from "the same source file's Breda feature was extracted differently." |

### Invariants

1. `market.boundary` always resolves through the current
   `MarketBoundaryVersion` (the one version per market with
   `superseded_at = null`) — never a bare, unversioned value.
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

### What this amendment does not decide

- **The concrete geometry/data source for Breda's actual boundary.** No
  provider is named, registered, or reviewed here — per this ticket's own
  scope, only an already-reviewed, legally-confirmed source could be
  named, and none has gone through `MARKET-03`'s review yet. This is the
  next concrete step, not this amendment.
- **Which `representation_type` Breda's first real version will use**
  (polygon vs. postal-code list vs. named administrative region) — the
  vocabulary is now fixed; the choice for Breda's actual first version is
  not.
- **Physical storage technology** for `definition_ref` — not chosen,
  matching the "logical, not physical" precedent this contract and
  `docs/api/canonical-restaurant-menu-schema.md` already set.
- **No `MarketBoundaryVersion` has been recorded for Breda.** The Breda
  reference row above records the *semantic* decision (Gemeente Breda's
  administrative boundary) only — there is no version 1 yet.

## Open questions (not decided here)

- Concrete `id` format (UUID vs. an internal key scheme).
- Concrete geodata source and `representation_type` for Breda's actual
  first `MarketBoundaryVersion` — see the amendment above; the versioning
  *contract* is now fixed, the concrete first value is not.
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
