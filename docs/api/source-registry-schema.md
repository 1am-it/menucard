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
| `terms_version` **→ moved** | text, nullable | The specific version/date of the terms, where the source publishes one (many don't — nullable, not forced). |
| `terms_retrieved_at` **→ moved** | timestamp | When the terms evidence itself was fetched/read — distinct from `reviewed_at` (§ below), which is when a person made a judgement call about it. |
| `next_review_due` **→ moved** | timestamp | Every reviewed source gets a re-review date — terms and technical access can both change silently. |
| `allowed_data_categories[]` / `excluded_data_categories[]` **→ moved** | enum list | See "Data categories" below — this is the primary data-minimisation control point. |
| `reuse_rights` **→ moved** | `{redistribution_allowed, attribution_required, commercial_use_allowed, geographic_restrictions}` | `commercial_use_allowed` is `true \| false \| 'unknown'` — never defaulted to `true` when actually unstated. |
| `allowed_access_method` **→ moved** | enum | `manual_entry`, `owner_submission`, `automated_fetch_source_approved_domain`, `authenticated_api`, `licensed_dataset_download`. **There is no "scrape a third-party search-results page" option in this vocabulary at all** — not excluded per-row, structurally absent. |
| `access_provider_note` **→ moved** | text | Records that *licence* and *technical access channel* are reviewed separately — e.g. "ODbL covers the data; this entry's access method is a static extract, not the public Overpass instance, which has its own separate usage policy." |
| `refresh_policy` | text/enum | e.g. `manual_on_demand`, `periodic_30d`, `event_driven`. |
| `freshness_expectation` | duration | How stale this source's data may become before it's no longer trusted as current. Independent of, but informed by, `docs/api/data-trust-model.md`'s 90-day reasoned default — a source-specific value that differs from it must state why. |
| `geographic_applicability` **→ moved** | `{country_codes[], market_ids[]}` | A source approved for one country/market is not implicitly approved everywhere — re-review is required to extend its use to a new market, not an automatic carry-over. |
| `status` **→ moved** | `pending_review` \| `allowed` \| `restricted` \| `blocked` | `pending_review` is the **mandatory initial status** for every new entry — nothing starts anywhere else. |
| `status_reason` **→ moved** | text | **Required whenever `status ≠ pending_review`.** |
| `reviewed_by`, `reviewed_at` **→ moved** | | **Required whenever `status ≠ pending_review`.** |

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

## Open questions (technical implementation choices only)

- Exact `id` format (UUID vs. an internal key scheme) — same open item as
  `MARKET-01`/`MARKET-02`.
- Whether `reviewed_by` references an individual account or a role —
  `PLATFORM-06`'s `editor` role is the natural fit, but not fixed here.
- Exact re-review cadence per `source_type` (a government open-data
  portal's terms likely change less often than an individual restaurant's
  website) — `next_review_due` exists as a field; the policy for setting
  it is not defined here.
