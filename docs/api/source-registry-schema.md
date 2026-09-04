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
- **(added 2026-09-05)** a source-structural category/type tag used to
  classify the candidate (e.g. OpenStreetMap's `amenity` value, such as
  `restaurant`/`cafe`/`fast_food`) — this is metadata about how the
  *source* classifies the record, not owner/personal/staff data, and is
  necessary for any automated candidate list to be minimally useful for
  later moderation. Omitted from the original list, which predates any
  source carrying this kind of structural tagging (Kadaster/PDOK's
  `geospatial_reference_data` category has no equivalent need). Does not
  change what `basic_info` excludes, below.

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

**Correction (2026-09-04)**: this document previously said, in prose
above, that "`Source` itself becomes a thin identity/description record
plus a pointer to its current version," and a same-dated amendment
briefly named that pointer as an explicit field,
`current_authorization_version_id`. **That field is removed — it was
semantically wrong, not just unspecified.** A `SourceAuthorizationVersion`
is scope- and time-bound: the same `Source` can have different validly
-applicable versions per market, country, access route, or processing
stage. A single, global "current version" pointer on `Source` would
suggest one universally-current answer that does not actually exist, and
could point to the wrong version entirely once a second market or a
second access route is ever reviewed for the same source. See "Amendment
(2026-09-04): physical operational base" below for what replaces it.

### `SourceAuthorizationVersion`

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | The version's own identity — distinct from `Source.id`. **UUIDv7 — see the physical-operational-base amendment below.** |
| `source_id` | FK → `Source.id` | Which source this version belongs to. |
| `version_number` | integer | Sequential, human-readable (1, 2, 3…). |
| `effective_from` | timestamp | When this version became the recorded truth. |
| `supersedes_version` **(replaces `superseded_by`/`superseded_at` — corrected 2026-09-04)** | FK → `SourceAuthorizationVersion.id`, nullable | **Set once, at this version's own creation** — points backward to the version it replaces. `null` on a source's first version. See "Amendment (2026-09-04): immutable succession correction" below for why this replaces the previous, self-contradictory fields — the identical fix already applied to `docs/api/market-entity-schema.md`'s `MarketBoundaryVersion`. |
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
3. **Corrected 2026-09-04, twice.** The old `superseded_at = null` test
   this invariant used to name no longer exists as a field (see the
   immutable-succession correction below). It was briefly replaced by a
   single `Source.current_authorization_version_id` pointer, which has
   itself since been removed as semantically wrong (see "Fields that stay
   on `Source`" above) — a `SourceAuthorizationVersion` is scope- and
   time-bound, so no single "the current one" exists globally for a
   `Source`. **There is no global current-version pointer for `Source`.**
   Any record that needs a specific, applicable authorization version
   (an `ImportRun`, a `MarketBoundaryVersion`) names that exact version
   directly, itself — see "Amendment (2026-09-04): physical operational
   base" below.
4. The original invariants 2–5 (terms/reviewer/date/reason required for
   `allowed`/`restricted`; `blocked` requires reason+reviewer+date but not
   necessarily terms; the structural absence of a search-results-page
   access method; no automatic cross-market carry-over) now apply to each
   `SourceAuthorizationVersion` individually, not to a `Source` row as a
   whole.
5. **Corrected 2026-09-04** — `ImportRun.data_origin_source_authorization_version_id`,
   and, where set, `access_provider_source_authorization_version_id`
   (`docs/api/import-run-schema.md`'s amendment; these fields superseded
   the original single `source_authorization_version_id`) must each
   reference a version whose `status ∈ {allowed, restricted}` — checked
   against that specific version, at the time the run executes.

### What does not change

`SourceReference.source_id` (`MARKET-02`) still points at `Source.id`,
not at a specific `SourceAuthorizationVersion` — a factual "this came
from this source" reference is a lighter claim than an authorization
-gated action, and does not need point-in-time freezing the way an
`ImportRun` does. Only `ImportRun` gets the version-specific reference.

## Amendment (2026-09-04): immutable succession correction —
`supersedes_version` replaces `superseded_by`/`superseded_at`

**The problem this corrects**: `superseded_by`/`superseded_at` ("set once
a later version replaces this one") directly contradicted invariant 2 ("a
`SourceAuthorizationVersion`, once created, is never edited") — setting
them necessarily meant writing to an *older*, already-created record after
the fact. This was flagged repeatedly across this project as a **known
parallel gap** to the identical bug already found and fixed in
`docs/api/market-entity-schema.md`'s `MarketBoundaryVersion` — "not fixed
here" each time. It is corrected now, as a direct prerequisite for
`MARKET-04A`'s physical implementation: a physical table cannot encode a
self-contradictory field pair, and building one that quietly diverged from
this document's own words would itself be a silent rewrite.

**The correction**, identical in shape to `MarketBoundaryVersion`'s own
fix: every `SourceAuthorizationVersion` may record `supersedes_version`,
naming the version it replaces, but only **at its own creation** — never
edited afterward. **Unlike `MarketBoundaryVersion` (where `market.boundary`
is a genuine, single, global "current version" pointer)**, `Source` has no
equivalent — see "Fields that stay on `Source`" above for why a global
current-authorization pointer would be semantically wrong here. "Which
version is applicable" is instead answered by whatever specific record
needs one (an `ImportRun`, a `MarketBoundaryVersion`) naming that exact
`SourceAuthorizationVersion.id` directly, itself. This still fully
resolves the invariant-2 contradiction: no `SourceAuthorizationVersion`
field is ever written to after that record's own creation — succession
is recorded forward-only via `supersedes_version`, never by mutating an
older row.

## Amendment (2026-09-04): physical operational base — `MARKET-04A`

**Trigger**: identical to `docs/api/import-run-schema.md`'s own amendment
of the same name — closing `MARKET-04` hard gate 4A requires a real,
minimal Supabase/Postgres base. That document holds the full `ImportRun`/
`MarketBoundaryVersion` design; this section records only what changes
for `Source`/`SourceAuthorizationVersion` specifically.

### `id` strategy

`Source.id` and `SourceAuthorizationVersion.id` use **UUIDv7**, generated
application-side (reusing `ops/scripts/capture-market-boundary.js`'s
already-tested `generateUuidV7()` — no new dependency), matching
`MarketBoundaryVersion.id`'s already-established choice. This resolves,
for the physical layer, the "not yet decided" `Source.id` format open
question below.

### No global "current authorization" pointer — corrected 2026-09-04

An earlier draft of this amendment gave `Source` its own
`current_authorization_version_id` pointer, directly mirroring
`market.boundary`/`current_boundary_version_id`. **That mirroring was
wrong and has been removed.** A market has exactly one boundary that is
current at a time — the analogy holds. A `Source`'s authorization does
not work the same way: the same source can have distinct, simultaneously
-valid `SourceAuthorizationVersion`s that differ by market, country,
access route, or permitted processing stage. A single global pointer
would suggest one universally-correct "current" version and could point
at the wrong one entirely the moment a second market, a second country,
or a second access route is ever reviewed for the same source.

**What replaces it**: every record that needs a specific, applicable
authorization version names that exact `SourceAuthorizationVersion.id`
directly, itself — never by dereferencing a pointer on `Source`.
`ImportRun.data_origin_source_authorization_version_id`/
`access_provider_source_authorization_version_id`
(`docs/api/import-run-schema.md`) and `MarketBoundaryVersion.source_authorization_version_id`
(`docs/api/market-entity-schema.md`) are still each a composite foreign
key against `SourceAuthorizationVersion(source_id, id)` — proving the
version belongs to the referenced source — but there is no intermediate
"current" pointer on `Source` for them to go through.

**No "current version for a scope" query exists yet, and none is
authorized by this amendment.** A future query or view answering "which
`SourceAuthorizationVersion` is currently applicable within a specific
market/country/access-route/processing-stage combination" may be added
later, but only once market, time, access route, and processing stage
are **all** explicit inputs to it — never a bare, scope-free "the current
one for this source."

### Physical security

RLS, zero `anon`/`authenticated` policies (including `owner`/`editor`/
`internal`), explicit `revoke`, and minimal `service_role` grants — see
`docs/api/import-run-schema.md`'s amendment for the full six-table grant
table. For the two tables this document owns specifically:
`Source` gets `select, insert, update` (identity/description fields are
contractually mutable); `SourceAuthorizationVersion` gets **`select,
insert` only — no `update`, no `delete`**, physically enforcing invariant
2 even against `service_role` itself.

### Concrete `id` values — Registered sources (2026-09-04)

The three already-registered instances below (Kadaster/PDOK, OpenStreetMap,
Geofabrik) are given their first concrete, stable `id` values here — none
had one before. These are the values a future seed migration must use
literally, not regenerate. See "Registered sources — actual instances"
further down this document for the full records these ids belong to.

| Source | `Source.id` | `SourceAuthorizationVersion.id` (v1) |
|---|---|---|
| Kadaster/PDOK — Bestuurlijke Gebieden | `01a06e1e-aa9f-7acc-a5cb-61d8c501befb` | `01a06e1e-aa9f-7cc6-a59c-d3280676b896` |
| OpenStreetMap | `01a06e1e-aa9f-7194-8fb7-e959b765d6f8` | `01a06e1e-aaa0-7035-98e8-e8b636cae82a` |
| Geofabrik — Netherlands extract | `01a06e1e-aaa0-7595-9173-d75b3ab52b0a` | `01a06e1e-aaa0-7a42-8606-fed08df83970` |

Each `SourceAuthorizationVersion.supersedes_version` above is `null`
(first version of each) — there is no `Source`-level "current version"
field to also set (see "No global 'current authorization' pointer"
above).

### Gate status

Same status as `docs/api/import-run-schema.md`'s amendment: **`4A` closed
2026-09-04** — the migration and seed were implemented, locally validated,
applied live to the actual Supabase project, and the full access-control
and referential-integrity test matrix live-verified (including a real
existing `owner` and a real existing `editor` account, each denied direct
access to all six tables via their normal sessions; RLS-enabled and
`service_role`'s read access and inability to delete anything were also
manually confirmed live). `4B` remains untouched and fully open.

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

### OpenStreetMap — the future scope this constraint is intended for

**Update (2026-09-04): registered.** At the time this amendment was
written, no `Source`/`SourceAuthorizationVersion` for OpenStreetMap or any
extract provider existed yet — this section recorded only the *intended*
scope. **Both have since been formally registered**, with the exact same
scope described below — see "Registered sources — actual instances"
further down this document for the two full records. The description
below is left as originally written, as the intended-scope statement it
was; it is no longer a "not yet registered" gap.

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

**Update (2026-09-04): done.** This section originally named registering
the two `SourceAuthorizationVersion` entries (OpenStreetMap and Geofabrik)
as the next concrete step. Both are now registered — with a real,
authorized human `reviewed_by`/`reviewed_at` (`product_owner`), per the
existing invariant that AI research may prepare evidence but never
substitutes for review — see "Registered sources — actual instances"
further down this document. **Gate 3A is closed** as of this
registration; see `planning/specs/tickets/market-04-raw-imports-import-runs.md`'s
hard gate 3A status for the precise, current wording. Gate 3B is
untouched by this and remains open and blocked.

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

## Registered sources — actual instances (2026-09-02; updated 2026-09-04)

**Distinct from the proposed, not-final table above.** Each entry below is
not a candidate or an example — each is a source this project has
actually reviewed and formally approved (to the specific, sometimes
restricted, scope recorded for it), per an explicit human product-owner
decision (see "reviewed_by bootstrap" below), documented here as the
source-of-truth record until a real database exists to hold it. Only the
specific `Source`/`SourceAuthorizationVersion` pair in each entry is
approved by that entry — no other source is affected, reclassified, or
implicitly approved by association, and one entry's scope never implies
another's.

### Kadaster/PDOK — Bestuurlijke Gebieden

**`Source`**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aa9f-7acc-a5cb-61d8c501befb` — UUIDv7, first concrete value assigned; see "Amendment (2026-09-04): physical operational base" above. |
| `name` | Kadaster — Bestuurlijke Gebieden |
| `operator` | Kadaster (Dienst voor het kadaster en de openbare registers) |
| `source_type` | `government_open_data` |
| `official_location` | `https://www.pdok.nl/introductie/-/article/bestuurlijke-gebieden` |
| `refresh_policy` | `periodic_annual` |
| `freshness_expectation` | ~365 days — a reasoned default matching the dataset's documented annual (January) republication cadence, not an empirical measurement. |

**`SourceAuthorizationVersion` (version 1)**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aa9f-7cc6-a59c-d3280676b896` |
| `supersedes_version` **(added 2026-09-04)** | `null` (first version) |
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
| `geographic_applicability` | **Updated 2026-09-04**: `{country_codes: ["NL"], market_id: "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}` — previously recorded as the human-readable placeholder `market_scope: "Breda market (slug: breda)"` because `Market.id` had no concrete value yet; this is the exact update that placeholder's own note promised, not a silent reinterpretation. See `docs/api/market-entity-schema.md`'s physical-operational-base amendment for where this id comes from. |
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

### OpenStreetMap (restricted — internal candidate register only)

**Closes `MARKET-04` gate 3A together with the Geofabrik entry below —
see "What this does and does not authorize" following both entries.**
Primary sources re-verified live on 2026-09-04 immediately before this
registration: [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)
(licence/attribution) and [wiki.openstreetmap.org/wiki/Overpass_API](https://wiki.openstreetmap.org/wiki/Overpass_API)
(public Overpass instance usage policy).

**`Source`**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aa9f-7194-8fb7-e959b765d6f8` |
| `name` | OpenStreetMap |
| `operator` | OpenStreetMap Foundation (OSMF) and the OpenStreetMap contributor community |
| `source_type` | `poi_directory` |
| `official_location` | `https://www.openstreetmap.org/copyright` |
| `refresh_policy` | `periodic_30d` — **nearest existing enum value, not an exact fit, flagged rather than silently misrepresented**: OSM's own data changes continuously (real-time community edits); this vocabulary has no "continuous" or "daily" value yet. Not fixed by this entry — an out-of-scope vocabulary gap, noted so it isn't mistaken for measured fact. |
| `freshness_expectation` | 90 days — `docs/api/data-trust-model.md`'s reasoned default; no compelling reason to deviate for a candidate-list-only use, not yet informed by real usage. |

**`SourceAuthorizationVersion` (version 1)**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aaa0-7035-98e8-e8b636cae82a` |
| `supersedes_version` **(added 2026-09-04)** | `null` (first version) |
| `status` | `restricted` |
| `status_reason` | OpenStreetMap's data is ODbL-licensed and free to reuse, including commercially, but `MARKET-05`'s matching/merging design plausibly makes an OSM-derived candidate combined with a non-OSM source for the same feature type (a restaurant) a Derivative Database under ODbL — a question this project has not had legally reviewed. Restricted to internal, pre-merge, pre-publication processing stages only until that review happens (gate 3B). |
| `terms_reference` | `https://www.openstreetmap.org/copyright` |
| `terms_version` | ODbL 1.0 |
| `terms_retrieved_at` | 2026-09-04 |
| `allowed_data_categories[]` | `basic_info` |
| `excluded_data_categories[]` | — (not applicable to this source) |
| `allowed_access_method` | `open_dataset_download` — a reviewed, reproducible bulk extract of OSM data. **The concrete technical channel is the separately-registered Geofabrik entry below, not this entry** — this entry authorizes the OSM data itself under ODbL, not one specific technical route. |
| `supplementary_access_methods[]` | `open_api_query` — the public Overpass API, **validation/spot-checking of a specific feature only, never the primary or bulk route.** Live-reverified 2026-09-04: the main `overpass-api.de` instance's own usage policy limits regular/automated use to under 100 queries and 10 MB/day (a small fraction of its already-modest one-off allowance of 10,000 queries/1 GB per day) and explicitly directs commercial/heavy use to self-hosted or paid servers — confirming it is unsuitable as a primary or repeatable bulk-import route. |
| `access_provider_note` | Licence (ODbL, this entry) and technical access channel are reviewed separately, per this document's existing principle. The primary, reproducible route is Geofabrik's periodic Netherlands extract (its own, separate `Source` below) — never the public Overpass instance, which appears here only as a supplementary, non-primary validation method. |
| `allowed_processing_stages[]` | `raw_import`, `internal_quality_review`, `moderation_preparation` |
| `restricted_pending` | `canonical_merge`, `public_publication`, `api_exposure`, and `redistribution` require a qualified legal review (external, or demonstrably authorized internal counsel — never AI research alone, per the existing invariant above) of the ODbL Collective-vs-Derivative-Database question for `MARKET-05`'s merge of OSM-derived candidates with non-OSM sources for the same feature type. See `MARKET-04`'s hard gate 3B. |
| `reuse_rights` | `{redistribution_allowed: true (ODbL terms apply — share-alike for any Derivative Database; see allowed_processing_stages/restricted_pending for the procedural gate on when redistribution/merge is actually permitted), attribution_required: true, commercial_use_allowed: true, geographic_restrictions: none}` |
| `geographic_applicability` | **Updated 2026-09-04**: `{country_codes: ["NL"], market_id: "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}` — previously the human-readable `market_scope` placeholder, same update as the Kadaster/PDOK entry above. |
| `reviewed_by` | `product_owner` — same bootstrap reference as the Kadaster/PDOK entry above, see below. |
| `reviewed_at` | 2026-09-04 |
| `effective_from` | 2026-09-04 |
| `next_review_due` | 2027-03-04 — **six months, not the one-year cadence used for Kadaster/PDOK**: community-maintained data and an open legal question (gate 3B) both warrant a shorter re-check than an annually-republished government dataset. |

**Required attribution (exact text)**: "© OpenStreetMap contributors", linked to
`https://www.openstreetmap.org/copyright` (the historical form "© OpenStreetMap"
is also acceptable per the official Attribution Guidelines) — required
wherever OSM-derived data is ever displayed, independent of when (or
whether) gate 3B is later resolved.

### Geofabrik — Netherlands extract (restricted — internal candidate register only, access-provider entry)

**A separate `Source` from OpenStreetMap itself — Geofabrik is a technical
redistributor of OSM data, not an ODbL licensor.** Primary source
re-verified live on 2026-09-04 immediately before this registration:
[download.geofabrik.de/europe/netherlands.html](https://download.geofabrik.de/europe/netherlands.html)
(confirmed today: `netherlands-latest.osm.pbf`, ~1.3 GB, current as of
2026-09-03; page footer states "Data processed by Geofabrik GmbH and
created by OpenStreetMap Contributors" and licenses the data "ODbL 1.0").

**`Source`**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aaa0-7595-9173-d75b3ab52b0a` |
| `name` | Geofabrik — Netherlands OSM extract |
| `operator` | Geofabrik GmbH |
| `source_type` | `poi_directory` |
| `official_location` | `https://download.geofabrik.de/europe/netherlands.html` |
| `refresh_policy` | `periodic_30d` — **same flagged nearest-fit as OpenStreetMap's own entry**: Geofabrik's own page shows daily-dated extract files; the vocabulary has no daily value yet. |
| `freshness_expectation` | 90 days — same reasoning as the OpenStreetMap entry above. |

**`SourceAuthorizationVersion` (version 1)**

| Field | Value |
|---|---|
| `id` **(added 2026-09-04)** | `01a06e1e-aaa0-7a42-8606-fed08df83970` |
| `supersedes_version` **(added 2026-09-04)** | `null` (first version) |
| `status` | `restricted` |
| `status_reason` | Geofabrik is a well-established, widely-used technical redistributor of OpenStreetMap data under the same ODbL terms OSM itself publishes under — it holds no separate rights of its own and is not itself the licensor (see "What this does and does not authorize" below). Restricted to the identical internal-only processing stages as the OpenStreetMap entry above, for the identical reason: `MARKET-05`'s merge question (gate 3B) is unresolved, and it applies equally to data obtained via this channel. |
| `terms_reference` | `https://download.geofabrik.de/europe/netherlands.html` (page footer licence/attribution statement) |
| `terms_version` | ODbL 1.0 (via OpenStreetMap — Geofabrik asserts no additional licence terms of its own on this extract) |
| `terms_retrieved_at` | 2026-09-04 |
| `allowed_data_categories[]` | `basic_info` |
| `excluded_data_categories[]` | — (not applicable to this source) |
| `allowed_access_method` | `open_dataset_download` (primary, reproducible) — the periodically-updated `netherlands-latest.osm.pbf` file at `download.geofabrik.de/europe/netherlands.html`. No account, key, or registration required beyond attribution. |
| `supplementary_access_methods[]` | — none. (The public Overpass API is a separate access channel to OSM data, not a supplementary method *of Geofabrik* — its supplementary, validation-only status is recorded on the OpenStreetMap entry above, not duplicated here.) |
| `access_provider_note` | Geofabrik is the technical access channel only. **This entry does not authorize Geofabrik as an ODbL rights-holder or licensor** — the licence itself is authorized by the separate OpenStreetMap entry above; this entry only reviews Geofabrik's specific extract/download service as a technical route to the same, already-licensed data. |
| `allowed_processing_stages[]` | `raw_import`, `internal_quality_review`, `moderation_preparation` |
| `restricted_pending` | Identical condition to the OpenStreetMap entry above: `canonical_merge`, `public_publication`, `api_exposure`, and `redistribution` require the same qualified legal review of `MARKET-05`'s merge question (gate 3B) before any version of this entry could add them — the data obtained via Geofabrik is the same OSM data, subject to the same open question. |
| `reuse_rights` | `{redistribution_allowed: true (ODbL terms apply, same as the OpenStreetMap entry above), attribution_required: true, commercial_use_allowed: true, geographic_restrictions: none}` |
| `geographic_applicability` | **Updated 2026-09-04**: `{country_codes: ["NL"], market_id: "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}` — same update as the other two entries above. |
| `reviewed_by` | `product_owner` — same bootstrap reference as the Kadaster/PDOK entry above, see below. |
| `reviewed_at` | 2026-09-04 |
| `effective_from` | 2026-09-04 |
| `next_review_due` | 2027-03-04 — same six-month reasoning as the OpenStreetMap entry above. |

**Required attribution (exact text)**: identical to the OpenStreetMap
entry above — attribution is to OpenStreetMap, not to Geofabrik. Geofabrik
itself does not require its own separate attribution credit per its
stated terms.

### What this does and does not authorize (both entries above)

- **Closes `MARKET-04` gate 3A**: both restricted registrations required
  to close it now exist — see that ticket's own "Hard gates" section for
  the precise, current wording.
- **Does not close, narrow, or otherwise touch gate 3B.** No data has been
  fetched under either entry. `allowed_processing_stages` permits only
  `raw_import`, `internal_quality_review`, and `moderation_preparation` —
  building and testing the raw-import mechanism against these sources.
  `canonical_merge`, `public_publication`, `api_exposure`, and
  `redistribution` remain structurally prohibited for both entries until a
  new version is created following a qualified legal review, per
  `restricted_pending` above.
- **Does not constitute legal advice or a legal conclusion** about the
  Collective-vs-Derivative-Database question — that question remains
  explicitly open (gate 3B) and is a human-authorized product decision
  about internal processing scope, not a resolution of the underlying
  legal question.

#### `reviewed_by: product_owner` — bootstrap reference, not a fabricated identity

This project has no live user-account system yet (documentation only, no
database) and `docs/api/source-registry-schema.md` itself has, until now,
left open whether `reviewed_by` names an individual account or a role.
`product_owner` is recorded here — for the Kadaster/PDOK entry above and
for both the OpenStreetMap and Geofabrik entries above — as an explicit
**bootstrap reference**: it denotes *the human product owner*, and each of
these authorizations was formally approved by that human product owner as
an explicit project decision (not an AI determination — AI research
prepared the evidence for each, per this document's own human-review
invariant). It is deliberately **not** a fabricated personal name, email
address, user id, or staff role. **Open follow-up, not decided here**:
migrating this bootstrap reference to a formal identity/account
convention (e.g. an actual `PLATFORM-06`-style role or account system)
once one exists — every entry using it should be updated, not silently
reinterpreted, when that happens.

## Open questions (technical implementation choices only)

- Exact `id` format — **resolved 2026-09-04 for the physical/operational
  layer**: UUIDv7, see "Amendment (2026-09-04): physical operational
  base" above. `MARKET-02`'s own canonical-schema ids remain a separate,
  still-open question.
- Whether `reviewed_by` references an individual account or a role —
  **partially addressed 2026-09-02** by the `product_owner` bootstrap
  reference above, now used for three entries; **the go-forward interim
  rule was made explicit 2026-09-04** (see
  `docs/api/import-run-schema.md`'s amendment: any future reviewer
  reference must follow the identical bootstrap-reference discipline
  until a real identity/account system exists). The underlying question
  (a formal, general identity/account convention) remains open.
- Exact re-review cadence per `source_type` (a government open-data
  portal's terms likely change less often than an individual restaurant's
  website) — `next_review_due` exists as a field; the policy for setting
  it is not defined here.
