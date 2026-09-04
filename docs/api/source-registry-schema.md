# Source Registry Schema (MARKET-03)

The concrete, implementable contract for the `Source` registry —
implementing `[[011-market-foundation-and-international-growth]]`'s
source-governance principle ("every imported record must track: source,
licence/usage right, import date, republish/reuse permission, freshness.
No unauthorized scraping of search-engine results pages"). Documentation
contract only — nothing in the current app constructs, stores, or reads
this shape yet. Mirrors the convention `docs/api/data-trust-model.md`,
`docs/api/market-entity-schema.md`, and
`docs/api/canonical-restaurant-menu-schema.md` used for `PLATFORM-03`,
`MARKET-01`, and `MARKET-02`.

**A source is never `allowed` merely because its data is publicly
visible.** Public visibility and reuse permission are different
questions; this registry only ever answers the second one, explicitly,
per source.

## `Source`

**Amended (2026-09-03, `MARKET-04`) — see "Amendment: versioned source
authorization" below.** The table immediately below is the field list as
originally specified by this ticket. Rows marked **→ moved** no longer
live on `Source` itself; they moved into the new, immutable, versioned
`SourceAuthorizationVersion` record so that a source's authorization
history can never be silently rewritten by a later re-review. Read this
table for the original shape and rationale, then the amendment section
for where each field actually lives now.

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | Immutable. The only value `SourceReference.source_id` (`MARKET-02`) and the future `import_run.source_id` (`MARKET-04`) may point to. |
| `legacy_ids[]` / `external_ids[]` | `{scheme, value}[]` | Same convention as `MARKET-02`. |
| `name` | text | |
| `operator` | text | Who runs/owns the source (e.g. a specific restaurant, a government body, a foundation). |
| `source_type` | enum | `restaurant_own_website`, `restaurant_pdf_menu`, `owner_direct_submission`, `government_open_data`, `poi_directory`, `community_contribution` (future `PLATFORM-08`), `other`. |
| `official_location` | URL/locator | The canonical place this source lives. |
| `terms_reference` **→ moved** | URL/text | The actual terms/licence document reviewed. **Required before `allowed`/`restricted`.** |
| `terms_version` **→ moved** | text, nullable | The specific version/date of the *legal terms/licence* text, where the source publishes one (many don't — nullable, not forced). **Amended 2026-09-05, clarified**: this is never the dataset/data edition (e.g. "2026 edition" of a yearly-published dataset) — that is a separate concept, recorded per use on `ImportRun.source_version`/`MarketBoundaryVersion.source_version`, not here. A source's licence can stay at the same `terms_version` across many different dataset editions. |
| `terms_retrieved_at` **→ moved** | timestamp | When the terms evidence itself was fetched/read — distinct from `reviewed_at` (§ below), which is when a person made a judgement call about it. |
| `next_review_due` **→ moved** | timestamp | Every reviewed source gets a re-review date — terms and technical access can both change silently. |
| `allowed_data_categories[]` / `excluded_data_categories[]` **→ moved** | enum list | See "Data categories" below — this is the primary data-minimisation control point. **Amended 2026-09-05** — see "Amendment: geospatial reference data support" for the new `geospatial_reference_data` category. |
| `reuse_rights` **→ moved** | `{redistribution_allowed, attribution_required, commercial_use_allowed, geographic_restrictions}` | `commercial_use_allowed` is `true \| false \| 'unknown'` — never defaulted to `true` when actually unstated. |
| `allowed_access_method` **→ moved** | enum | `manual_entry`, `owner_submission`, `automated_fetch_source_approved_domain`, `authenticated_api`, `licensed_dataset_download`. **There is no "scrape a third-party search-results page" option in this vocabulary at all** — not excluded per-row, structurally absent. **Amended 2026-09-05** — see "Amendment: geospatial reference data support" for two added values and the new primary/supplementary distinction. |
| `access_provider_note` **→ moved** | text | Records that *licence* and *technical access channel* are reviewed separately — e.g. "ODbL covers the data; this entry's access method is a static extract, not the public Overpass instance, which has its own separate usage policy." |
| `refresh_policy` | text/enum | e.g. `manual_on_demand`, `periodic_30d`, `event_driven`. **Amended 2026-09-05** — `periodic_annual` added, see below. |
| `freshness_expectation` | duration | How stale this source's data may become before it's no longer trusted as current. Independent of, but informed by, `docs/api/data-trust-model.md`'s 90-day reasoned default — a source-specific value that differs from it must state why. |
| `geographic_applicability` **→ moved** | `{country_codes[], market_ids[]}` | A source approved for one country/market is not implicitly approved everywhere — re-review is required to extend its use to a new market, not an automatic carry-over. |
| `status` **→ moved** | `pending_review` \| `allowed` \| `restricted` \| `blocked` | `pending_review` is the **mandatory initial status** for every new entry — nothing starts anywhere else. |
| `status_reason` **→ moved** | text | **Required whenever `status ≠ pending_review`.** |
| `reviewed_by`, `reviewed_at` **→ moved** | | **Required whenever `status ≠ pending_review`.** **Amended 2026-09-05, clarified**: `reviewed_by` must be a real, authorized human reviewer — never an AI system, and never left implicit. See "Amendment: geospatial reference data support" for the explicit invariant. |

### Invariants (original — see the amendment's own invariants for the current, per-version form)

1. `status` defaults to `pending_review` on creation; no other initial
   value is valid.
2. `status ∈ {allowed, restricted}` requires `terms_reference`,
   `reviewed_by`, `reviewed_at`, and `status_reason` all to be set. A
   source cannot be marked usable on the strength of "the data is public"
   alone.
3. `status = blocked` requires `status_reason` and `reviewed_by`/
   `reviewed_at`, but not necessarily `terms_reference` — a source can be
   blocked on the basis of known prohibited behaviour (e.g. "this is a
   search-results page") without ever having obtained its full terms.
4. `allowed_access_method` is drawn only from the fixed enum above.
   Fetching a third-party search engine's results page is not a
   representable value — this is a structural prohibition, not a
   convention to remember.
5. A `Source` approved (`allowed`/`restricted`) for one
   `geographic_applicability` entry is not automatically approved for
   another market or country — extending its use requires its own review
   event, not silent reuse.

## Data categories — data minimisation for `basic_info`

`basic_info` is one of the `allowed_data_categories[]` values, but it is
**narrowly scoped**, not a general "public business info" catch-all.

**After a valid source review, permitted as `basic_info` (business
information):**

- restaurant name
- restaurant visiting address
- a general business phone number
- a general business contact address
- website URL
- reservation link

**Explicitly excluded from automated import and public display, always:**

- names of owners, staff, or other natural persons
- personal mobile numbers
- personal email addresses
- likely home addresses (a particular risk for sole proprietorships,
  where the registered business address and a person's home address can
  be the same)
- any data that, alone or combined with other fields, makes a natural
  person identifiable

**Publicly visible is not automatically freely reusable.** Where a field
might be personal data, purpose limitation, data minimisation, legal
basis, transparency, and deletion/correction requests must each be
assessed on their own — this registry does not assume public visibility
settles any of them. **Owner submission remains the preferred route** for
any data a restaurant owner wants to add or correct themselves — see
`PLATFORM-07`'s existing claim flow, which this principle extends rather
than replaces.

### `geospatial_reference_data` (added 2026-09-05)

A second, deliberately separate data category for administrative/
geographic boundary data and comparable reference geometry (e.g. a
market's boundary source — `MARKET-01`'s `MarketBoundaryVersion`). This
does **not** restructure or reinterpret `basic_info` above — restaurant
data sources still classify their fields under `basic_info` exactly as
before; this is a new, additional value in the same
`allowed_data_categories[]` enum for a structurally different kind of
source (geographic reference data, not business or personal information).

By its nature, `geospatial_reference_data`:

- carries no personal or business data — a municipal boundary polygon
  identifies a place, never a person or a specific restaurant's private
  information;
- is used exclusively for programmatic membership testing (`MARKET-01`'s
  `inclusion_rule`), never displayed to consumers as business or listing
  information;
- still requires the same full source review before use (`allowed`/
  `restricted` with terms, reviewer, date, reason) — "it's just map data"
  is not an exemption from review, any more than "the data is public" is.

## Relationship to the canonical schema

`docs/api/canonical-restaurant-menu-schema.md`'s `SourceReference.source_id`
must reference a `Source` registered here (at minimum `pending_review`) —
never a bare, unreviewed URL. See that document's amendment
cross-referencing this one.

## Amendment (2026-09-03, `MARKET-04`): versioned source authorization — `SourceAuthorizationVersion`

**This amends how `Source`'s regulated fields are stored — it does not
change any of the invariants above, which now apply per version instead
of per row.** The trigger: an `import_run` (`MARKET-04`) must be able to
record, permanently and unambiguously, exactly what a source was
authorized to do *at the moment that run executed* — and a later
re-review (even a downgrade to `blocked`) must never be able to rewrite
that historical record. A single mutable `Source` row cannot guarantee
that on its own. This also brings `Source` in line with a discipline this
project already established elsewhere: `docs/api/canonical-restaurant-menu-schema.md`
§6 requires `source_references[]` to be *references, never copies* — the
same reasoning applies here. An `ImportRun` must reference an
authorization state, never embed a copy of it.

**What changes:** the fields below move off the mutable `Source` row and
into a new, immutable, append-only `SourceAuthorizationVersion` record.
`Source.id` remains the one stable, permanent identity everything else
(`SourceReference.source_id`, `ImportRun.source_id`) points to — that
does not change. `Source` itself becomes a thin identity/description
record plus a pointer to its current version.

**Fields moved from `Source` into `SourceAuthorizationVersion`:**

| Field | Same meaning as before |
|---|---|
| `status` | `pending_review` \| `allowed` \| `restricted` \| `blocked` |
| `status_reason` | Unchanged requirement: set whenever `status ≠ pending_review` |
| `terms_reference`, `terms_version`, `terms_retrieved_at` | Unchanged |
| `allowed_data_categories[]`, `excluded_data_categories[]` | Unchanged |
| `allowed_access_method`, `access_provider_note` | Unchanged |
| `reuse_rights` | Unchanged. Not explicitly named in the triggering request, but it is exactly the same kind of "what did this review conclude" fact as the others — leaving it mutable on `Source` while everything else is versioned would be an inconsistent half-measure, so it moves too. Flagged here rather than silently included. |
| `geographic_applicability` | Unchanged |
| `reviewed_by`, `reviewed_at` | Unchanged |
| `next_review_due` | Now scoped to the version it belongs to — each review sets its own next-due date, rather than one field floating free of which review it followed |

**Fields that stay on `Source`** (identity/description, not authorization
facts — renaming or re-describing a source does not need historical
immutability the way "what was it authorized to do" does): `id`,
`legacy_ids[]`/`external_ids[]`, `name`, `operator`, `source_type`,
`official_location`, `refresh_policy`, `freshness_expectation`.

### `SourceAuthorizationVersion`

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | The version's own identity — distinct from `Source.id`. |
| `source_id` | FK → `Source.id` | Which source this version belongs to. |
| `version_number` | integer | Sequential, human-readable (1, 2, 3…). |
| `effective_from` | timestamp | When this version became the recorded truth. |
| `superseded_by`, `superseded_at` | FK / timestamp, nullable | Set once a later version replaces this one. `null` on the current version. |
| *(all fields in the table above)* | | |

### Invariants (extend, do not replace, `Source`'s original five)

1. Every `Source` has at least one `SourceAuthorizationVersion` from the
   moment it's created — the initial `pending_review` state *is* version
   1 (with `reviewed_by`/`reviewed_at`/`status_reason` left unset, exactly
   as the original invariant 1 already required). There is no
   special-cased "unversioned" state.
2. A `SourceAuthorizationVersion`, once created, is **never edited**. Any
   change — including a re-review that reaches the identical conclusion —
   creates a new version.
3. Exactly one version per `Source` has `superseded_at = null` at any
   time — that is the current, authoritative version for review UIs and
   for registering new `SourceReference`s.
4. The original invariants 2–5 (terms/reviewer/date/reason required for
   `allowed`/`restricted`; `blocked` requires reason+reviewer+date but not
   necessarily terms; the structural absence of a search-results-page
   access method; no automatic cross-market carry-over) now apply to each
   `SourceAuthorizationVersion` individually, not to a `Source` row as a
   whole.
5. `ImportRun.source_authorization_version_id` (`MARKET-04`) must
   reference a version whose `status ∈ {allowed, restricted}` — checked
   against that specific version, at the time the run executes.

### What does not change

`SourceReference.source_id` (`MARKET-02`) still points at `Source.id`,
not at a specific `SourceAuthorizationVersion` — a factual "this came
from this source" reference is a lighter claim than an authorization
-gated action, and does not need point-in-time freezing the way an
`ImportRun` does. Only `ImportRun` gets the version-specific reference.

## Amendment (2026-09-05): geospatial reference data support

**Trigger**: preparing Breda's `MarketBoundaryVersion` (`MARKET-01` gate 1)
against a real candidate source (Kadaster/PDOK's "Bestuurlijke Gebieden")
surfaced several gaps in this registry's vocabulary — it was written with
restaurant/menu sources in mind and had no good fit for a government
open-geodata source published as an annual dataset edition with both a
bulk-download route and a separate live query API. This amendment closes
those specific gaps. **It does not reclassify or change any existing
restaurant/menu `Source` entry** — every addition here is a new,
additional enum value or field, never a redefinition of an existing one.

### New `refresh_policy` value

`periodic_annual` — added alongside the existing `manual_on_demand`,
`periodic_30d`, `event_driven` values, for sources published on a
predictable yearly cadence (e.g. a government dataset republished every
January).

### New `allowed_access_method` values

Added to the existing enum (`manual_entry`, `owner_submission`,
`automated_fetch_source_approved_domain`, `authenticated_api`,
`licensed_dataset_download`):

- **`open_dataset_download`** — a direct, unauthenticated download of a
  publicly published dataset file (e.g. an Atom-feed-listed GeoPackage or
  GML export). No API key, account, or registration step beyond
  attribution. Distinct from `licensed_dataset_download`, which implies
  some licensing/registration friction beyond simple attribution.
- **`open_api_query`** — an unauthenticated, public, query-based API
  (e.g. an OGC API Features endpoint) used to read or validate data
  directly, without a bulk file download.

The structural absence of a "scrape a third-party search-results page"
value is unchanged — neither addition touches that.

### `SourceAuthorizationVersion.supplementary_access_methods[]` (new field)

| Field | Type | Notes |
|---|---|---|
| `supplementary_access_methods[]` | enum list, drawn from the same `allowed_access_method` vocabulary, nullable/empty | Zero or more *additional* access methods explicitly permitted for this version, used only for validation or freshness-checking — never to establish or replace the authoritative artifact on their own. |

**New invariant (extends invariant 4)**: `allowed_access_method` names
exactly the **one** primary, reproducible route used to establish or
update a source's authoritative version-of-record (e.g. the specific
bulk-download artifact an `ImportRun` or `MarketBoundaryVersion` was
built from). `supplementary_access_methods[]` may separately permit
additional routes (e.g. a live query API) for confirming a specific
feature or checking whether the source has changed since the primary
artifact was retrieved — a supplementary route is never sufficient, on
its own, to create a new version; only a fetch via the primary
`allowed_access_method` can do that.

### Human review cannot be delegated to AI research (explicit invariant)

**New invariant (extends invariant 2)**: `reviewed_by` must identify a
real, authorized human reviewer. AI-assisted research (fact-finding,
verifying licence text, checking technical access, drafting proposed
field values) may **prepare evidence** for a review — exactly as this
project's own AI-assisted research into candidate sources already does —
but it never satisfies `reviewed_by`/`reviewed_at` itself, and a
`SourceAuthorizationVersion` may not move to `allowed`/`restricted` on
the strength of AI research alone, however thorough. This extends
`[[011-market-foundation-and-international-growth]]` §8's existing
principle ("AI may never publish independently as a source of truth —
every AI-assisted extraction is itself a proposal, subject to the same
review flow as any human-submitted one") explicitly to source
authorization decisions, not only to restaurant/menu data.

## Amendment (2026-09-04): OSM candidate-register processing-stage constraint — `allowed_processing_stages[]`

**Trigger**: read-only legal/technical research for `MARKET-04` hard gate 3
(OpenStreetMap as a candidate restaurant list for Breda) found that
`status` alone (`pending_review`/`allowed`/`restricted`/`blocked`) cannot
express what that research actually needs: OSM data may plausibly be used
for internal candidate-list purposes without triggering ODbL share-alike,
but `MARKET-05`'s own matching/merging design — combining an OSM-derived
candidate with a non-OSM source for the same feature type (a restaurant)
— plausibly makes the result a *Derivative Database*, which is a
materially different question from whether the source may be used
*internally at all*. Neither `allowed_data_categories` nor
`allowed_access_method` can express "usable for this pipeline stage, not
that one" either. This amendment adds that missing, per-pipeline-stage
constraint. **It does not reclassify or change any existing, already
-registered `SourceAuthorizationVersion`** — see "What does not change"
below.

### New fields on `SourceAuthorizationVersion`

| Field | Type | Notes |
|---|---|---|
| `allowed_processing_stages[]` | enum list, nullable/empty | **Optional.** Absent or empty means `status` alone governs, exactly as today — this is additive, not a redefinition of any existing version. When present, it narrows what this specific, immutable version may be used for, independent of `status`: any pipeline stage not listed is prohibited for this version, checked at run time the same way `allowed_data_categories`/`allowed_access_method` already are. Enum values, mirroring `docs/api/import-run-schema.md`'s own layer-separation table (raw import → `MARKET-05` normalization → moderation → `MARKET-06` publication), extended with two forward-looking stages for a not-yet-built public/partner-facing surface: `raw_import`, `internal_quality_review`, `moderation_preparation`, `canonical_merge`, `public_publication`, `api_exposure`, `redistribution`. |
| `restricted_pending` | text, nullable | **Required whenever `allowed_processing_stages[]` excludes at least one stage.** States, in plain language, the specific condition that must be satisfied before a *new* version could add the excluded stage(s) — e.g. naming the category of legal review required. Never mutates the current version to lift a restriction: per invariant 2 (immutability), satisfying the condition requires creating a new `SourceAuthorizationVersion`, not editing this one. |

### New invariant (extends the per-version invariants above)

6. If `allowed_processing_stages[]` is set on a `SourceAuthorizationVersion`,
   any pipeline stage not in that list is prohibited for that version —
   this sits alongside, and independently of, `status`,
   `allowed_data_categories`, and `allowed_access_method`, none of which
   alone can express a stage-level constraint. `restricted_pending` is
   mandatory whenever the list excludes at least one stage, and must name
   the specific condition required to lift it, not merely restate that a
   restriction exists.

### What does not change

This amendment touches no existing entry. `basic_info`'s permitted/excluded
field lists, `geospatial_reference_data`, the primary/supplementary
access-method distinction, and Kadaster/PDOK's already-registered
`SourceAuthorizationVersion` (see "Registered sources" above) are all
unaffected — none of them sets `allowed_processing_stages`, so all
continue to be governed by `status` alone, exactly as before. The KVK Open
Dataset candidate row in `planning/specs/tickets/market-03-source-registry.md`
is a proposed research candidate, not a registered
`SourceAuthorizationVersion` — this amendment does not touch it either.

### OpenStreetMap — the future scope this constraint is intended for (not yet registered)

**No `Source` or `SourceAuthorizationVersion` for OpenStreetMap, or for any
extract provider, is registered by this amendment.** This section records
the *scope* a future registration is intended to have — see "Next concrete
step" below for what actually closing it requires.

- **OpenStreetMap** (the underlying ODbL data origin) — intended future
  scope: `status: restricted`, `allowed_processing_stages: [raw_import,
  internal_quality_review, moderation_preparation]`. Explicitly excluded:
  `canonical_merge`, `public_publication`, `api_exposure`,
  `redistribution`. `restricted_pending`: "`canonical_merge`,
  `public_publication`, `api_exposure`, and `redistribution` require a
  qualified legal review (external, or demonstrably authorized internal
  counsel — never AI research alone, per the existing invariant above) of
  the ODbL Collective-vs-Derivative-Database question for `MARKET-05`'s
  merge of OSM-derived candidates with non-OSM sources for the same
  feature type. See `MARKET-04`'s hard gate 3B."
- **Geofabrik** (a specific extract provider) is a **separate** `Source`
  from "OpenStreetMap" itself — the licence (ODbL, via OSM) and the
  technical access channel (Geofabrik's periodic regional extract) are
  reviewed as two different questions, per this document's existing
  licence-vs-access-provider principle. Intended future scope: its own
  `status: restricted` entry, `allowed_access_method:
  open_dataset_download` (primary, reproducible), same
  `allowed_processing_stages`/`restricted_pending` values as OpenStreetMap
  above, since it inherits the same merge/publication question once its
  data reaches that stage.
- **The public Overpass API** is not a candidate for a primary,
  reproducible import route at all — read-only research found its main
  instance's own stated usage policy limits regular/automated use to a
  small fraction of its already-modest one-off allowance and explicitly
  directs heavier or commercial use elsewhere. It may only ever appear as
  a `supplementary_access_methods` entry (validation/freshness-checking
  of a specific feature), never as `allowed_access_method`, and never as
  the basis for a repeatable bulk import.

### Next concrete step to actually close gate 3A

Registering the two `SourceAuthorizationVersion` entries above (OpenStreetMap
and Geofabrik) — each with a real, authorized human `reviewed_by`/
`reviewed_at`, per the existing invariant that AI research may prepare
evidence but never substitutes for review. **Gate 3A is not closed by this
amendment** — this amendment only makes the mechanism available; see
`planning/specs/tickets/market-04-raw-imports-import-runs.md`'s hard gate
3A status for the precise, current wording.

## Relationship to `MARKET-04` (import runs)

An `import_run` references exactly one `Source.id` **and** exactly one
`SourceAuthorizationVersion.id` (never a copy of either), and operates
only within that specific version's `allowed_data_categories`,
`allowed_access_method`, and `geographic_applicability` — checked against
that version at the time the run executes, per the invariant above. See
`docs/api/import-run-schema.md` for the full `ImportRun` contract; this
document does not build that enforcement, only defines what it checks
against.

## Breda — retroactive registry entries (proposed, not final)

Per the approved starting point: **existing Breda restaurant websites are
entered as `pending_review`, not retroactively marked `allowed`.** No
formal terms review was ever recorded for any of them — informal past use
is not evidence of a review that didn't happen.

| Source (example) | `source_type` | Proposed status | Why |
|---|---|---|---|
| An individual restaurant's own website (e.g. the ones already scraped for today's 11 menus) | `restaurant_own_website` | `pending_review` | No terms evidence on file for any of them; per-site review still needed. |

No blanket "all restaurant websites are equivalent" entry is proposed —
each is its own `Source` row, since terms genuinely differ site to site.

## Registered sources — actual instances (2026-09-02)

**Distinct from the proposed, not-final table above.** The entry below is
not a candidate or an example — it is the first source this project has
actually reviewed and formally approved, per an explicit human product
-owner decision (see "reviewed_by bootstrap" below), documented here as
the source-of-truth record until a real database exists to hold it. Only
this specific `Source`/`SourceAuthorizationVersion` pair is approved by
this entry — no other source is affected, reclassified, or implicitly
approved by association.

### Kadaster/PDOK — Bestuurlijke Gebieden

**`Source`**

| Field | Value |
|---|---|
| `name` | Kadaster — Bestuurlijke Gebieden |
| `operator` | Kadaster (Dienst voor het kadaster en de openbare registers) |
| `source_type` | `government_open_data` |
| `official_location` | `https://www.pdok.nl/introductie/-/article/bestuurlijke-gebieden` |
| `refresh_policy` | `periodic_annual` |
| `freshness_expectation` | ~365 days — a reasoned default matching the dataset's documented annual (January) republication cadence, not an empirical measurement. |

**`SourceAuthorizationVersion` (version 1)**

| Field | Value |
|---|---|
| `status` | `allowed` |
| `status_reason` | CC BY 4.0, explicitly "no further usage restrictions" beyond mandatory attribution, per the official National Georegister (NGR) metadata record and the PDOK Atom feed's own licence statement; an official, primary Kadaster/PDOK source for geospatial reference data. |
| `terms_reference` | National Georegister metadata record (`nationaalgeoregister.nl/geonetwork/opensearch/api/records/208bc283-7c66-4ce7-8ad3-1cf3e8933fb5`) and `pdok.nl/copyright` |
| `terms_version` | CC BY 4.0 — the *legal terms* version. **Not** the dataset edition (2026) — see the amendment above distinguishing the two; the licence itself is not versioned separately by year. |
| `terms_retrieved_at` | 2026-09-02 |
| `allowed_data_categories[]` | `geospatial_reference_data` |
| `excluded_data_categories[]` | — (not applicable to this source) |
| `allowed_access_method` | `open_dataset_download` (primary) |
| `supplementary_access_methods[]` | `open_api_query` |
| `access_provider_note` | Primary: PDOK's Atom download service (GeoPackage, 2026 edition). Supplementary: PDOK OGC API Features (`gemeentegebied` collection) — for feature validation and freshness-checking only, never as the primary version-of-record route (per `supplementary_access_methods[]`'s own invariant above). |
| `reuse_rights` | `{redistribution_allowed: true, attribution_required: true, commercial_use_allowed: true, geographic_restrictions: none}` |
| `geographic_applicability` | `{country_codes: ["NL"], market_scope: "Breda market (slug: breda)"}` — **not** a `market_id` value. `MARKET-01`'s `id` format is still an open question (see Open questions below); recording a made-up placeholder id here would misrepresent it as decided. This human-readable scope reference stands in until a real id format and value exist, at which point this row is updated, not silently reinterpreted. |
| `reviewed_by` | `product_owner` — **bootstrap reference, see below.** |
| `reviewed_at` | 2026-09-02 |
| `effective_from` | 2026-09-02 |
| `next_review_due` | 2027-09-02 — one year out, matching the source's own annual cadence; a reasoned default, not policy fixed elsewhere. |

**Required attribution (exact text)**: "Kadaster, Bestuurlijke Gebieden"

**For a future `MarketBoundaryVersion`** (not registered by this entry —
see `docs/api/market-entity-schema.md`): `definition_ref` must point to
the official national GeoPackage artifact itself
(`https://service.pdok.nl/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg`)
together with an explicit `feature_selection_rule` — never a derived,
Breda-only file. The agreed selection rule: primary selector
`identificatie = "GM0758"`; required validation assertions `code =
"0758"` and `naam = "Breda"` (per `MarketBoundaryVersion`'s own
invariant 6: a source-internal id is never the primary selector on its
own without independent validation — `identificatie` here plays that
primary-selector role, cross-checked by two independent fields, which is
exactly the pattern that invariant requires).

#### `reviewed_by: product_owner` — bootstrap reference, not a fabricated identity

This project has no live user-account system yet (documentation only, no
database) and `docs/api/source-registry-schema.md` itself has, until now,
left open whether `reviewed_by` names an individual account or a role.
`product_owner` is recorded here as an explicit **bootstrap reference**:
it denotes *the human product owner*, and this specific authorization was
formally approved by that human product owner as an explicit project
decision (not an AI determination — AI research prepared the evidence
above, per this document's own human-review invariant). It is
deliberately **not** a fabricated personal name, email address, user id,
or staff role. **Open follow-up, not decided here**: migrating this
bootstrap reference to a formal identity/account convention (e.g. an
actual `PLATFORM-06`-style role or account system) once one exists — this
entry should be updated, not silently reinterpreted, when that happens.

## Open questions (technical implementation choices only)

- Exact `id` format (UUID vs. an internal key scheme) — same open item as
  `MARKET-01`/`MARKET-02`.
- Whether `reviewed_by` references an individual account or a role —
  **partially addressed 2026-09-02** by the `product_owner` bootstrap
  reference above for the one entry that exists so far; the underlying
  question (a formal, general identity/account convention for every
  future reviewer) remains open.
- Exact re-review cadence per `source_type` (a government open-data
  portal's terms likely change less often than an individual restaurant's
  website) — `next_review_due` exists as a field; the policy for setting
  it is not defined here.
