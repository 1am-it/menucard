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

| Field | Type | Notes |
|---|---|---|
| `id` | stable identity | Immutable. The only value `SourceReference.source_id` (`MARKET-02`) and the future `import_run.source_id` (`MARKET-04`) may point to. |
| `legacy_ids[]` / `external_ids[]` | `{scheme, value}[]` | Same convention as `MARKET-02`. |
| `name` | text | |
| `operator` | text | Who runs/owns the source (e.g. a specific restaurant, a government body, a foundation). |
| `source_type` | enum | `restaurant_own_website`, `restaurant_pdf_menu`, `owner_direct_submission`, `government_open_data`, `poi_directory`, `community_contribution` (future `PLATFORM-08`), `other`. |
| `official_location` | URL/locator | The canonical place this source lives. |
| `terms_reference` | URL/text | The actual terms/licence document reviewed. **Required before `allowed`/`restricted`.** |
| `terms_version` | text, nullable | The specific version/date of the terms, where the source publishes one (many don't — nullable, not forced). |
| `terms_retrieved_at` | timestamp | When the terms evidence itself was fetched/read — distinct from `reviewed_at` (§ below), which is when a person made a judgement call about it. |
| `next_review_due` | timestamp | Every reviewed source gets a re-review date — terms and technical access can both change silently. |
| `allowed_data_categories[]` / `excluded_data_categories[]` | enum list | See "Data categories" below — this is the primary data-minimisation control point. |
| `reuse_rights` | `{redistribution_allowed, attribution_required, commercial_use_allowed, geographic_restrictions}` | `commercial_use_allowed` is `true \| false \| 'unknown'` — never defaulted to `true` when actually unstated. |
| `allowed_access_method` | enum | `manual_entry`, `owner_submission`, `automated_fetch_source_approved_domain`, `authenticated_api`, `licensed_dataset_download`. **There is no "scrape a third-party search-results page" option in this vocabulary at all** — not excluded per-row, structurally absent. |
| `access_provider_note` | text | Records that *licence* and *technical access channel* are reviewed separately — e.g. "ODbL covers the data; this entry's access method is a static extract, not the public Overpass instance, which has its own separate usage policy." |
| `refresh_policy` | text/enum | e.g. `manual_on_demand`, `periodic_30d`, `event_driven`. |
| `freshness_expectation` | duration | How stale this source's data may become before it's no longer trusted as current. Independent of, but informed by, `docs/api/data-trust-model.md`'s 90-day reasoned default — a source-specific value that differs from it must state why. |
| `geographic_applicability` | `{country_codes[], market_ids[]}` | A source approved for one country/market is not implicitly approved everywhere — re-review is required to extend its use to a new market, not an automatic carry-over. |
| `status` | `pending_review` \| `allowed` \| `restricted` \| `blocked` | `pending_review` is the **mandatory initial status** for every new entry — nothing starts anywhere else. |
| `status_reason` | text | **Required whenever `status ≠ pending_review`.** |
| `reviewed_by`, `reviewed_at` | | **Required whenever `status ≠ pending_review`.** |

### Invariants

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

## Relationship to future `MARKET-04` (import runs)

An `import_run` (not built) will reference exactly one `Source.id` and
operate only within that source's `allowed_data_categories`,
`allowed_access_method`, and `geographic_applicability` at the time the
run executes — this document does not build that enforcement, only
defines what it will check against.

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
