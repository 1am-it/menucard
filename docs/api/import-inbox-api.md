# Internal Import Inbox API (`MARKET-05A`)

`GET /api/internal/v1/import-inbox/runs`, `GET /api/internal/v1/import-inbox/candidates`
— a window onto `MARKET-04`'s `import_runs`/`import_extraction_records`
tables, entirely before any normalization, matching, or canonical merge.
Builds on `PLATFORM-05`'s auth/role guard (`src/lib/internalAuth.js`)
unchanged. Not reachable by the public. Full design:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s
"MARKET-05A — Data-inbox: interne kandidaat-review" section.

**`import_runs` and `import_extraction_records` themselves are never
written by anything documented here.** No `.insert()`/`.update()`/
`.delete()` against either table appears anywhere in any of this
feature's route sources. **Addition (2026-09-05): a separate, append-only
review audit log now exists** —
`GET`/`POST /api/internal/v1/import-inbox/candidates/{id}/reviews`, see
below — which does write, but only ever a new row to its own table
(`import_candidate_reviews`, `supabase/migrations/0007_market05a_candidate_reviews.sql`),
never to `import_extraction_records`, never to a canonical or public
table (no such table exists in Supabase for this data yet — see "What
has been verified" below).

**Addition (2026-09-05, later the same day): a second, entirely
independent append-only audit log now exists for manual field
enrichment** —
`GET`/`POST /api/internal/v1/import-inbox/candidates/{id}/enrichments`,
see "Candidate enrichments" below — writing only ever a new row to its
own table (`import_candidate_enrichments`,
`supabase/migrations/0008_market05a_candidate_enrichments.sql`). Same
guarantee as the review log: never a write to `import_extraction_records`,
never to a canonical or public table, and this table has no update or
delete grant either, for any role.

## Authentication and roles

Same Supabase Auth bearer-token pattern as every other internal route.
**Every route here is `internal`-only** — not `editor` (restaurant-scoped
in this app's existing model; import candidates are platform-wide and
entirely unreviewed — see the ticket's own "Access control" section for
the full reasoning), not `owner`. A caller with `owner` or `editor` roles
only (no `internal`) gets `403`; no session at all gets `401`.

## `GET /api/internal/v1/import-inbox/runs`

Every `import_runs` row (newest `started_at` first, capped at 200), with
`data_origin_source_id`/`access_provider_source_id` resolved to their
`sources.name` values.

**Response `200`:**
```json
{
  "runs": [
    {
      "id": "...",
      "status": "succeeded",
      "started_at": "2026-09-05T07:06:25.626Z",
      "completed_at": "2026-09-05T07:07:35.031Z",
      "duration_seconds": 69,
      "record_counts": { "fetched": 665, "stored": 500, "skipped": 165, "errored": 0 },
      "error_log": [],
      "source_locator": "https://download.geofabrik.de/europe/netherlands-260904.osm.pbf",
      "source_version": "netherlands-260904.osm.pbf",
      "data_origin_source_name": "OpenStreetMap",
      "access_provider_source_name": "Geofabrik — Netherlands OSM extract"
    }
  ]
}
```
`access_provider_source_name` is `null` when a run has no separate access
provider (e.g. a future Kadaster/PDOK-style run). `duration_seconds` is
`null` until `completed_at` is set.

## `GET /api/internal/v1/import-inbox/candidates?run_id=&category=&name=&possible_duplicate=&quality=&review_status=`

Every `import_extraction_records` row (newest `retrieved_at` first,
capped at 2000 — a named v1 limitation, not silent: revisit with real
pagination once volume materially exceeds this), enriched with
**computed, read-only, never-stored** fields and then filtered. All
query parameters are optional and combine with AND.

- `possible_duplicate` is computed fresh on every request from
  `extracted_fields` (`src/lib/importInbox.js`) — **never** a stored
  column, **never** `MARKET-05B`'s eventual real deduplication logic.
  Computed over the *entire* candidate set before any filter is applied,
  so a cross-run duplicate is still flagged even when filtering down to
  one run.
- **`enriched_fields`/`enrichment_sources` (addition, 2026-09-05, later
  the same day)**: `enriched_fields` is `extracted_fields` with any
  `address`/`phone`/`website` overridden by its latest, effective
  manually-sourced value (see "Candidate enrichments" below) —
  `extracted_fields` itself is always still returned, unmodified, for
  transparency. `enrichment_sources` names, per enriched field, the
  `source_url`/`recorded_at`/`reviewer_id` behind the value currently
  shown; a field with no enrichment simply has no key here.
  **`quality_status`/`missing_fields` are now computed from
  `enriched_fields`, not `extracted_fields`** — a manually-sourced value
  can move a candidate from `incomplete` to `complete` without the raw
  record ever changing. Every enrichment row across every candidate is
  fetched in one bounded query (capped at 4000) and reduced in
  `src/lib/importInbox.js`'s `buildEnrichmentSourceByCandidateId`; no
  per-candidate round trip.
- **`review_status` (addition, 2026-09-05) is resolved, not computed**:
  the `status` of the *latest* `import_candidate_reviews` row for that
  candidate (by `decided_at`), or `"new"` when no review row exists yet
  — see "Candidate reviews" below for the full model. Every review row
  across every candidate is fetched in one bounded query (capped at 4000)
  and reduced in `src/lib/importInbox.js`'s `buildReviewStatusByCandidateId`;
  no per-candidate round trip.
- **`deferred_reason` (addition, 2026-09-06)**: the *current* deferred
  reason from that same latest review row — `null` unless
  `review_status` is actually `"deferred"` right now (see
  `buildLatestDeferredReasonByCandidateId`; reuses the same one query,
  no second round trip). A candidate that was deferred once and later
  re-reviewed to a different status never still shows its old reason. A
  legacy `deferred` row recorded before
  `supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql`
  existed simply yields `null` here too — exactly like having no reason
  at all, never an error. Built for the client-side "Triage overview"
  section on `/internal/import-inbox` (see that page's own section
  below).
- `run_id` — exact `import_run_id` match.
- `category` — exact match against `extracted_fields.category` (the
  OSM `amenity` value).
- `name` — case-insensitive substring match against
  `extracted_fields.name`.
- `possible_duplicate` — `"true"` or `"false"`.
- `quality` — `"complete"` or `"incomplete"` — evaluated against the
  **enriched** view, per above.
- `review_status` — one of `"new"`, `"needs_enrichment"`,
  `"approved_internal"`, `"rejected"`, `"deferred"`.

**Response `200`:**
```json
{
  "candidates": [
    {
      "id": "...",
      "import_run_id": "...",
      "record_locator": "osm:node:4001",
      "retrieved_at": "...",
      "extracted_fields": {
        "name": "...", "category": "restaurant",
        "location": { "lat": 51.58, "lon": 4.78 }, "osm_node_id": "4001"
      },
      "enriched_fields": {
        "name": "...", "category": "restaurant",
        "location": { "lat": 51.58, "lon": 4.78 }, "osm_node_id": "4001",
        "phone": "+31 76 1234567", "website": "https://restaurant.example"
      },
      "enrichment_sources": {
        "phone": { "value": "+31 76 1234567", "source_url": "https://restaurant.example/contact", "recorded_at": "2026-09-05T14:00:00.000Z", "reviewer_id": "..." },
        "website": { "value": "https://restaurant.example", "source_url": "https://restaurant.example/contact", "recorded_at": "2026-09-05T14:00:00.000Z", "reviewer_id": "..." }
      },
      "possible_duplicate": false,
      "quality_status": "incomplete",
      "missing_fields": ["address"],
      "review_status": "new",
      "deferred_reason": null
    }
  ],
  "total_before_filters": 500,
  "total_after_filters": 120
}
```
An incomplete candidate's `missing_fields` names exactly which of
`name`/`address`/`phone`/`website` are absent **from the enriched view**,
e.g. `["phone"]` — shown in `/internal/import-inbox`'s per-candidate
detail view as `Missing: phone`. A field present only because of a
manual enrichment is not listed as missing.

## Candidate reviews (addition, 2026-09-05) — `GET`/`POST /api/internal/v1/import-inbox/candidates/{id}/reviews`

A separate, **append-only** audit log of human review decisions over one
candidate — never a mutation of `import_extraction_records` itself, and
never a mutation of a previous decision. Full schema/grants:
`supabase/migrations/0007_market05a_candidate_reviews.sql`. Same
`internal`-only guard as every other route on this page.

**Statuses**: `new` (the default — no review row exists yet, never
itself stored), `needs_enrichment`, `approved_internal`, `rejected`,
`deferred`. **`approved_internal` means ready for internal enrichment
only — never public publication, never a MenuCard.** There is no
canonical/public table for this data in this project yet for it to leak
into even by mistake (see "What has been verified" below).

**`GET .../candidates/{id}/reviews`** — every review row for this one
candidate, newest `decided_at` first (ties broken by the higher `id`).
Response `200`:
```json
{
  "reviews": [
    {
      "id": 2,
      "candidate_id": "...",
      "reviewer_id": "...",
      "decided_at": "2026-09-05T12:00:00.000Z",
      "status": "approved_internal",
      "rejection_reason": null,
      "deferred_reason": null,
      "note": "phone number confirmed via a second look"
    },
    {
      "id": 1,
      "candidate_id": "...",
      "reviewer_id": "...",
      "decided_at": "2026-09-05T10:00:00.000Z",
      "status": "needs_enrichment",
      "rejection_reason": null,
      "deferred_reason": null,
      "note": null
    }
  ]
}
```

> **Addition (2026-09-06): `deferred_reason`.** A `deferred` row recorded
> *before* `supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql`
> was applied has `deferred_reason: null` — it predates this field
> entirely, is never backfilled, and stays fully valid, readable history
> exactly as originally recorded. `null` on a `deferred` row therefore
> means one of two distinct things depending on when it was recorded:
> "no reason existed yet as a concept" (a legacy row) — never confused
> with an error, and never re-validated retroactively. A `deferred` row
> recorded *after* that migration always has a non-null
> `deferred_reason` — the API enforces this on every new write (see the
> `POST` addition below).
An empty `reviews` array means the candidate's effective status is `new`
— it does not mean the candidate doesn't exist (that's a separate `404`,
see below, and only surfaces on `POST`).

**`POST .../candidates/{id}/reviews`** — body:
```json
{ "status": "rejected", "rejection_reason": "duplicate", "note": "matches candidate osm:node:4002" }
```
- `status` — required, one of `needs_enrichment`/`approved_internal`/`rejected`/`deferred`
  (never `new` — see `src/lib/importInbox.js`'s `validateReviewDecisionInput`).
- `rejection_reason` — required exactly when `status` is `"rejected"`,
  forbidden otherwise; one of `not_a_restaurant`, `duplicate`,
  `permanently_closed`, `insufficient_data`, `other`.
- `deferred_reason` (added 2026-09-06) — required exactly when `status`
  is `"deferred"`, forbidden otherwise; one of `service_model_unclear`,
  `chain_or_franchise_review`, `ownership_or_permission_needed`,
  `source_conflict`, `verify_later`. Symmetric with `rejection_reason`'s
  own rule, enforced at both the API layer
  (`validateReviewDecisionInput`) and the database layer (a `NOT VALID`
  check constraint — see the migration's own header comment for why it
  is `NOT VALID` rather than a normally-validated constraint: this table
  already held real, live `deferred` rows recorded before this column
  existed, and a normally-validated constraint would have failed
  immediately against exactly those rows at migration time).
- `note` — optional, at most 2000 characters.

Example with the new field:
```json
{ "status": "deferred", "deferred_reason": "ownership_or_permission_needed", "note": "waiting on a reply from the listed operator" }
```

Always performs exactly **one insert** via the
`record_import_candidate_review()` Postgres function — never an update,
never a delete; the database itself grants `select, insert` only on
`import_candidate_reviews`, to `service_role`, with no update/delete
grant to any role at all, for any reason. Recording a second decision
for the same candidate creates a **second row**; it never touches the
first. `reviewer_id` is always `auth.userId` from the caller's own
verified session — never accepted from the request body. Response `201`
with the newly-created row, shaped like one item in the `GET` list
above. `404` (`{"error": "Candidate not found"}`) when `{id}` does not
name a real `import_extraction_records` row. `400` with a specific,
safe message (`src/lib/importInbox.js`'s `reviewValidationMessage`) on
any of the validation failures above.

## Candidate enrichments (addition, 2026-09-05, later the same day) — `GET`/`POST /api/internal/v1/import-inbox/candidates/{id}/enrichments`

A second, **entirely independent**, append-only audit log — this one for
manually-sourced corrections/additions to a candidate's `address`,
`phone`, or `website`. Never a mutation of `import_extraction_records`,
never a mutation of a previous enrichment. Full schema/grants:
`supabase/migrations/0008_market05a_candidate_enrichments.sql`. Same
`internal`-only guard as every other route on this page.

**Scope: `address`/`phone`/`website` only, manual entry only.** No
scraping, no automated website verification, no brand/chain
classification, no publication — this feature only records what a human
reviewer manually typed in, with a source URL they manually provided.

**Enrichment vs. review notes — read before assuming a note already
covers this.** `import_candidate_reviews.note` is optional, free
text, written for a completely different purpose (context on a review
decision) and by a completely different action (`POST .../reviews`).
**Nothing in this feature ever reads, parses, or derives a structured
enrichment from a review's `note` field** — not on a schedule, not on
first use, not ever; see `src/lib/importInbox.js`'s own structural
safety-net tests, which assert the enrichment code path never even
references the review table. Concretely: if a reviewer previously typed
something like a phone number or a website reference for **Do Spaces**
into a review note, that data is **not** automatically available as an
enrichment — a reviewer must read the note and deliberately re-enter the
value, with its source, through this feature's own form. See
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Enrichment vs. review notes" section for the full reasoning.

**Independent of review decisions in both directions.** Recording an
enrichment never sets `import_candidate_reviews.status` to
`approved_internal` (or anything else) — a reviewer who enriches a
candidate's phone number still has to separately record a review
decision if they want one recorded at all. The reverse holds too:
recording a review decision never reads or requires an enrichment.

**`GET .../candidates/{id}/enrichments`** — every enrichment row for
this one candidate, newest `recorded_at` first (ties broken by the
higher `id`). Response `200`:
```json
{
  "enrichments": [
    {
      "id": 2,
      "candidate_id": "...",
      "reviewer_id": "...",
      "field_name": "phone",
      "value": "+31 76 1234567",
      "source_url": "https://restaurant.example/contact",
      "recorded_at": "2026-09-05T14:00:00.000Z"
    },
    {
      "id": 1,
      "candidate_id": "...",
      "reviewer_id": "...",
      "field_name": "website",
      "value": "https://restaurant.example",
      "source_url": "https://restaurant.example/contact",
      "recorded_at": "2026-09-05T14:00:00.000Z"
    }
  ]
}
```
An empty `enrichments` array means no field has ever been manually
enriched for this candidate — it does not mean the candidate doesn't
exist (that's a separate `404`, see below, and only surfaces on `POST`).

**`POST .../candidates/{id}/enrichments`** — body:
```json
{
  "fields": [
    { "field_name": "phone", "value": "+31 76 1234567", "source_url": "https://restaurant.example/contact" },
    { "field_name": "website", "value": "https://restaurant.example", "source_url": "https://restaurant.example/contact" }
  ]
}
```
- `fields` — required, a non-empty array; one or more of `address`,
  `phone`, `website`, each at most once per request
  (`src/lib/importInbox.js`'s `validateEnrichmentRequestInput`).
- `field_name` — one of `address`, `phone`, `website`.
- `value` — required, non-empty, at most 500 characters.
- `source_url` — required, must be a syntactically valid `http://` or
  `https://` URL (`isValidHttpUrl`) — never `ftp:`, `mailto:`, or a bare
  domain with no scheme.

Always performs exactly **one atomic insert** (one transaction, every
submitted field or none) via the `record_candidate_enrichments()`
Postgres function — never an update, never a delete; the database itself
grants `select, insert` only on `import_candidate_enrichments`, to
`service_role`, with no update/delete grant to any role at all, for any
reason. A correction is made by submitting the field again with a new
value/source — this creates a **new row**; it never touches the
previous one. `reviewer_id` is always `auth.userId` from the caller's
own verified session. Response `201` with every newly-created row,
shaped like the items in the `GET` list above. `404`
(`{"error": "Candidate not found"}`) when `{id}` does not name a real
`import_extraction_records` row. `400` with a specific, safe message
(`src/lib/importInbox.js`'s `enrichmentValidationMessage`) on any of the
validation failures above.

**Addition (2026-09-06): `normalized_fields`/`normalization` on
candidates.** `GET .../candidates` now also returns, per candidate:
`normalized_fields` — `extracted_fields`/`enriched_fields` with
`address`/`phone`/`website` run through
`src/lib/candidateNormalization.js`'s conservative, idempotent
normalizers (whitespace/Dutch-postcode-shape formatting for address; a
Netherlands-focused canonical `+31...` storage form *and* a separate
readable `"06 12345678"`-style Dutch display for phone — `normalized_fields`
shows the **display** form; website scheme/host lowercased, path/query/
fragment byte-for-byte untouched) — and `normalization`, the full
per-field detail (`value`/`normalized`/`display`/`changed`/`valid`) for
whichever fields were present. `quality_status`/`missing_fields` are now
computed from `normalized_fields`, one stage later than
`enriched_fields`. Nothing here is ever guessed at: an unrecognized
phone format, for example, is returned with `valid: false` and shown
completely unchanged, never "corrected."

## Website suggestions (addition, 2026-09-06) — `POST /api/internal/v1/import-inbox/candidates/{id}/suggest-from-website`

A **read-only-against-Supabase**, human-confirmation-required feature —
`internal`-only, triggered *exclusively* by an explicit reviewer button
click on `/internal/import-inbox`, never automatically on candidate
load and never scheduled. Uses **only** the candidate's own
already-stored website (re-derived server-side from
`import_extraction_records`/`import_candidate_enrichments` — never a
URL accepted from the request body, which would otherwise turn this
into an open fetch proxy for arbitrary URLs).

**This route never writes to Supabase.** Every Supabase call in it is a
`select`. A suggestion becomes a real, audited enrichment only if a
reviewer explicitly confirms it, per field, through the existing `POST
.../candidates/{id}/enrichments` route above — this route only ever
pre-fills that form's client-side draft; it has no knowledge of, and
never calls, the enrichments route.

**Scope: `address`/`phone`/`website` only.** Extraction
(`src/lib/candidateSuggestions.js`) prefers schema.org JSON-LD
(`Restaurant`/`FoodEstablishment`/`LocalBusiness`/`Organization`/etc.),
falling back to explicit `tel:` links / `<address>` tag content only
when no relevant JSON-LD node exists. **Never** a menu, price, photo,
marketing copy, or any other page content — even fields present on the
very same JSON-LD node (e.g. `menu`, `priceRange`, `image`) are never
read.

**SSRF defenses** (`src/lib/safeOutboundFetch.js`, used for both the
`robots.txt` check and the page fetch itself): `http`/`https` only, no
embedded credentials, `localhost` rejected outright; every DNS
resolution goes through a guarded `lookup` that refuses to open a
socket at all if the resolved address is loopback/private/link-local/
reserved — checked independently on every redirect hop, not just the
initial URL; redirects capped (default 3); response size capped
(default 2 MB); a hard timeout (default 8 s); no cookies, no
`Authorization` header, no browser-like session state of any kind ever
sent.

> **Correction (2026-09-05):** the guarded-`lookup` description above
> was accurate but incomplete — it did not mention that a **literal**
> IP host (e.g. `http://127.0.0.1/…`) bypasses a custom DNS `lookup`
> entirely in Node, since no DNS resolution happens for a literal IP.
> This was a real gap: a candidate website value that was itself a
> private/loopback/link-local/reserved literal IP address could reach
> `http(s).request()` unblocked. Fixed: `isSafeUrlShape` now rejects a
> disallowed literal IPv4/IPv6 host (including IPv4-mapped IPv6, both
> dotted and Node's canonical hex form, e.g. `::ffff:7f00:1`) before
> any request is issued, using `net.BlockList` against the full IANA
> special-purpose address registries — checked on every hop, since
> `isSafeUrlShape` already gates every redirect too. See
> `src/lib/safeOutboundFetch.js` and `src/lib/safeOutboundFetch.test.js`
> for the full range list and test coverage.
>
> **Further correction (2026-09-05):** "the full IANA special-purpose
> address registries" above was itself not yet accurate — the block
> list was still missing several IANA-registered ranges (IPv4:
> AS112-v4, AMT, direct-delegation AS112; IPv6: most `2001::/23`
> sub-ranges, the second NAT64 range, 6to4, the second AS112
> direct-delegation range, and the newer documentation/SRv6 ranges).
> All now added — see `buildDisallowedIpBlockList` in
> `src/lib/safeOutboundFetch.js` for the exact, now-complete list and
> its stated policy (every IANA special-purpose range is disallowed as
> a destination, even one that is technically globally routable).

**`robots.txt` — a product policy this feature applies to itself, never
a claim of legal permission.** The candidate's site's `robots.txt` is
fetched (via the same SSRF-guarded path) and its `User-agent: *`
`Disallow` rules checked against the website's path before the page
itself is ever fetched; a disallowed path is never fetched. Its
*absence*, or an *allowed* result, is never treated as legal permission
to use the site's content beyond this narrow, always-human-confirmed
contact-field suggestion — see
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Website suggestions" section for the full policy reasoning.

> **Correction (2026-09-05):** this previously failed *open* — if the
> `robots.txt` fetch itself failed for any reason (network error,
> non-2xx status, timeout, or a disallowed SSRF target), that was
> treated as "no restriction declared" and the page was fetched anyway.
> Fixed: the gate (`classifyRobotsGate` in
> `src/lib/candidateSuggestions.js`) now fails **closed** — a failed
> robots.txt fetch blocks the page fetch exactly like an explicit
> `Disallow`, reported as its own `"unconfirmed"` status (see the
> response shape below). Redirects are also now disabled entirely
> (`maxRedirects: 0`) on both the `robots.txt` fetch and the page fetch,
> so a redirect can never land on a destination whose own `robots.txt`
> was never checked.

**Response `200`:**
```json
{
  "source_url": "https://restaurant.example/contact",
  "fetched_at": "2026-09-06T10:00:00.000Z",
  "robots_txt_status": "allowed",
  "parsed_from": "json-ld",
  "suggestions": {
    "address": { "status": "new", "value": "Fixturestraat 1, 4811 AA Breda", "source_url": "https://restaurant.example/contact" },
    "phone": { "status": "match", "value": "+31 76 1234567", "source_url": "https://restaurant.example/contact" },
    "website": { "status": "no_data", "value": null, "source_url": null }
  },
  "warnings": []
}
```
- `status` per field — `"new"` (the candidate has no existing value —
  a plain addition), `"match"` (agrees with the candidate's current
  value after normalization), `"needs_review"` (conflicts with the
  candidate's current value, **or** the page's own name/address doesn't
  plausibly match the candidate at all — which downgrades *every*
  suggested field to `needs_review`, not just the mismatched one), or
  `"no_data"` (nothing found for this field). **None of these statuses
  ever implies anything was or will be written automatically.**
- `warnings` — human-readable strings, e.g. naming a name/address
  mismatch between the website and the candidate.
- `robots_txt_status` is one of `"allowed"` (confirmed, page fetched),
  `"disallowed"` (confirmed, path covered by a `Disallow` rule), or
  `"unconfirmed"` (the `robots.txt` fetch itself failed). When it is
  anything other than `"allowed"`, `suggestions` is `null` and the page
  itself was never fetched.

> **Correction (2026-09-05):** this field was previously a boolean
> `robots_txt_allowed` that conflated "explicitly disallowed" with "not
> confirmed" — both were impossible to tell apart, and the latter case
> did not previously exist as a distinct, fail-closed outcome at all
> (see the `robots.txt` correction above). Replaced with the
> three-value `robots_txt_status` shown above.

**Error responses**: `400` (`{"error": "No website on file for this
candidate"}` or `"...is not a valid URL"`) when the candidate has no
usable website; `404` `Candidate not found`; `502` when the fetch itself
fails (`{"error": "Could not fetch the website (<reason>)"}` — `<reason>`
is one of `safeOutboundFetch.js`'s own `SafeFetchError` reasons, e.g.
`resolved-address-not-allowed`, `too-many-redirects`,
`response-too-large`, `timeout`, `bad-status` — never the raw underlying
error message).

**Not yet live-verified.** Both `safeOutboundFetch.js` and
`candidateSuggestions.js` are exhaustively unit-tested against local
fixtures/a local test server only — no real website has ever been
fetched by this feature, in development or otherwise.

## Error responses (all endpoints)

`401` missing/invalid session, `403` caller has no `internal` role, `500`
database error (`{"error": "Query failed"}` — never the raw Supabase
error message).

## Browser-side auth for the UI (`/internal/import-inbox`)

Same pattern as `/internal/moderation`: `src/lib/supabaseBrowser.js` is
used **only** for sign-in/session lookup; the page never queries Supabase
directly, only these routes (now five, since the 2026-09-05 review and
enrichment additions and the 2026-09-06 website-suggestions addition),
with the session's `access_token`.

**Enrichment form UX (2026-09-06, client-only, no API contract change)**:
a "Use one source URL for all filled-in fields" checkbox lets a reviewer
type one URL instead of repeating it per field — applied to every filled-in
field's `source_url` at submit time, still one `POST` with the same body
shape as always. A candidate's detail card now collapses automatically
after a successful "Save decision"/"Save enrichment," and stays open
with the reviewer's input intact after any validation or API failure —
`src/lib/importInbox.js`'s `shouldCollapseCandidateCardAfterAction`.

**Further enrichment form UX (2026-09-06, later the same day,
client-only, no API contract change)**: the source-URL step is now a
distinct, labeled "1. Source" block above the three fields (previously
first in render order but not visually set apart), with the "Use one
source URL for all filled-in fields" checkbox and the existing "Use this
source URL as the website" shortcut both inside it; the three fields
(`Address`/`Phone`/`Website`) are rendered as compact, consistent rows
(label, value, and — only when the shared source is off — its own
source URL) under a "2. Fields" heading. Purely a layout reflow: the
same draft state, the same `POST` body shape, the same security
boundary (the suggest-from-website route still only ever fetches the
candidate's own already-*saved* website — never a value read directly
off this form).

**Addition (2026-09-06, later still the same day) — Triage overview.**
A new, read-only section on `/internal/import-inbox`, between "Import
runs" and "Candidates," giving reviewers a way to quickly overview and
navigate every reviewed candidate without changing any of the existing
detail-view/review/enrichment flow. No migration, no new write endpoint,
no automatic classification of any kind:

- **Summary counts** for the five effective statuses (`new`,
  `needs_enrichment`, `approved_internal`, `deferred`, `rejected`) —
  `src/lib/importInbox.js`'s `computeReviewStatusCounts`, computed
  client-side over a dedicated fetch of `GET .../candidates?run_id=`
  (the same route documented above, called with **only** `run_id` —
  never `category`/`name`/`possible_duplicate`/`quality`/
  `review_status`), so the counts always reflect the true picture for
  the selected run regardless of what the "Candidates" section's own
  browsing filters are currently set to.
- **Filters**: clicking a status count filters the triage list to that
  status; choosing `Deferred` additionally reveals a "deferred reason"
  filter (the same fixed `ALLOWED_DEFERRED_REASONS` set). A text search
  matches candidate name and the *currently displayed* (normalized)
  address/website — entirely client-side
  (`src/lib/importInbox.js`'s `matchesTriageSearch`/
  `filterCandidatesForTriage`), never a new query parameter.
- **Three named buckets** (`computeCandidateTriageBucket`): candidates
  still needing enrichment, candidates deliberately deferred (with their
  reason, via the same `formatDeferredReasonLabel` used everywhere
  else), and candidates internally approved and ready only for a
  *future, not-yet-built* canonical-draft step (`MARKET-05B`) — never a
  claim that such a step is scheduled, running, or automatic. `new` and
  `rejected` candidates are real statuses but deliberately fall outside
  these three named buckets.
- **"View in list"** on a triage row clears the "Candidates" section's
  own browsing filters (never the run filter), expands that candidate's
  existing, unchanged detail view, and scrolls to it — no new fetch
  beyond the same read-only review/enrichment history an ordinary expand
  already triggers, and no decision or enrichment is ever recorded by
  this action.
- Deliberately does **not** attempt chain/franchise name-matching or
  automatic service-model classification — both are separate, later,
  not-yet-built features; this only ever reflects the *human-recorded*
  `review_status`/`deferred_reason` exactly as decided.

> **Correction (2026-09-06, later still) — terminology update, UI text
> only.** The page/section/button names above are now stale: the page
> title is "Imported Restaurant Review" (was "Candidate triage"), this
> section is titled "Review Overview" (was "Triage overview"), the
> browsing section below it is titled "Imported candidates" (was
> "Candidates"), and its row action reads "View details" (was "View in
> list"). The *not-yet-built* future step named above is now called
> **Restaurant Profile Drafts** — the human-facing name for the same
> `MARKET-05B` canonical-draft step, still not built. None of this
> changes the API contract, the query parameters, the pure functions
> named above, or `review_status`/`deferred_reason`'s own values
> (`approved_internal` included) — see
> `planning/specs/tickets/market-05-normalization-deduplication.md`'s
> own terminology note for the full glossary, including **Restaurant
> Onboarding** — a separate, later, owner-facing phase (after an
> explicit claim, consent, or active participation) that this internal
> review page never mentions and has no relationship to.

> **Correction (2026-09-06, later still) — information-hierarchy
> update, UI text and layout order only.** The names in the correction
> above are now themselves partly stale: the page title is "Dashboard
> imported Restaurant Data" (was "Imported Restaurant Review"); the
> browsing section below "Review Overview" is titled "Review queue"
> (was "Imported candidates"), with its detail-view back action reading
> "Back to review queue"; "Review Overview" itself is unchanged. The
> page now renders "Review Overview" then "Review queue" then "Import
> runs" (was "Import runs" first) — the daily review task before import
> administration. "Import runs" is now compact and collapsed by default
> behind a "Show"/"Hide" toggle, without removing run information,
> filtering, or "Show only this run". None of this changes the API
> contract, the query parameters, the pure functions named above, or
> `review_status`/`deferred_reason`'s own values — see
> `planning/specs/tickets/market-05-normalization-deduplication.md`'s
> own "Implementation (2026-09-06, later still) — information-hierarchy
> update" section for the full detail.

> **Correction (2026-09-06, later still) — removed the Review Overview
> / Review queue duplication.** Both corrections above are now
> themselves partly stale: `Review Overview` no longer has its own
> preview list or filter bar — it holds only the five status tiles. The
> `Review queue` heading and its "View details"/"View in list" row
> action (from the two corrections above) no longer exist: there is
> exactly one candidate list on the page, using the original, full
> `di-candidate-card` rendering, directly below **one combined filter
> bar** — search, review status, deferred reason (only when status is
> `deferred`), category, duplicate status, completeness. Clicking a
> status tile now sets this same real filter. Every candidate card's
> always-visible content is now limited to what a reviewer needs to
> triage (name/category/contact/completeness/status/deferred reason);
> `record_locator`, `retrieved_at`, the phone-normalization warning, and
> enrichment-source annotations moved into the expanded "Details &
> review" view. None of this changes the API contract, the query
> parameters, the pure functions named above, or
> `review_status`/`deferred_reason`'s own values — the deferred-reason
> filter is applied client-side over already-fetched candidates, never
> a new query parameter. See
> `planning/specs/tickets/market-05-normalization-deduplication.md`'s
> own "Implementation (2026-09-06, later still) — remove the Review
> Overview / Review queue duplication" section for the full detail,
> including the new design principle it records (one list per screen,
> one combined filter bar per list).

## What has been verified

Verified against the real Supabase project (2026-09-05), using the
existing, real `editor` and `owner` test accounts, with sessions minted
without needing either account's password (see
`docs/guides/internal-api-live-testing.md`) — **no new account, session,
or `staff_roles` row was created for this verification**:

- No `Authorization` header, and a garbage bearer token, → `401` on both
  routes.
- The real, existing `owner` account → `403` on `runs`. The real,
  existing `editor` account → `403` on `runs`.
- The page (`/internal/import-inbox`) renders its shared `noindex,
  nofollow` metadata correctly and returns `200`.

**Not yet verified — a named, honest gap, not an oversight**: the
`internal`-role **success** path. No working `internal` account exists
yet — its email-activation link
(`app/internal/activate/page.js`, built the same day to fix a real,
observed production issue where an email-link scanner consumed
invite/reset tokens before the real recipient could use them) has never
been completed end-to-end, because Supabase's **Reset Password** and
**Invite user** email templates still need a manual dashboard edit
(Authentication → Email Templates) to actually point at
`/internal/activate` instead of the default `{{ .ConfirmationURL }}` —
not performed yet, tracked in
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Access control" section.

**Correction (2026-09-05, later the same day): one real `ImportRun` now
exists.** A single, explicitly-approved, limited live Breda import
(`node ops/scripts/import-breda-osm.js --live --confirm-market=breda
--max-records-to-store=10`) ran — run id `01a07237-1867-760e-a714-50675078d3a1`,
10 stored candidates, all independently re-verified inside Breda's real
boundary, none outside it, no canonical/public table touched. The
"internal-role success path is unverified" gap above is otherwise
unchanged — no working `internal` account exists yet, so once one does,
`/internal/import-inbox` now has one real run and 10 real candidates to
actually browse, instead of only the empty state.

**Also not yet verified — the candidate-reviews write path (`POST
.../candidates/{id}/reviews`) itself, live.** `record_import_candidate_review()`
and its table's grants were locally validated in a disposable,
containerized PostgreSQL instance (applied 0001 through 0007 in
sequence, including the real seed data) — happy path, the not-found
case, both check-constraint directions, and the append-only
update/delete refusal (even for `service_role`) all behaved exactly as
designed. None of this has been exercised against the actual live
Supabase project, and the migration itself has not been applied there
either — both remain separate, later, explicitly-approved steps.

**Correction (2026-09-05, later the same day): migration `0007` has
since been applied live to the actual Supabase project**, manually, in
the SQL Editor, and read-only re-verified afterward: `import_candidate_reviews`
exists with the intended columns (confirmed via PostgREST's own OpenAPI
introspection); a live `UPDATE`/`DELETE` attempt against it, as
`service_role`, is refused (`permission denied for table
import_candidate_reviews`, code `42501`) for both; the one real
`ImportRun` and its 10 `import_extraction_records` are byte-for-byte
unchanged (same run id, `source_artifact_hash`, and 10 `record_locator`
values); no canonical or public table exists. `import_candidate_reviews`
holds **zero rows** — applying the migration did not itself record any
review decision. **The write path (`POST .../candidates/{id}/reviews`)
remains genuinely unexercised against the live project** — a named,
honest gap, not an oversight: no real review decision has been recorded
yet, live or otherwise, since doing so was explicitly out of scope for
the verification round that confirmed the above.

**Also not yet applied or verified live (2026-09-05, later the same
day) — the candidate-enrichments feature.** Migration `0008` and
`record_candidate_enrichments()` were locally validated the same way as
`0007` above (disposable, containerized PostgreSQL instance, 0001
through 0008 applied in sequence): a multi-field enrichment recorded in
one call, a correction for the same field creating a second row without
touching the first, the not-found case, every check-constraint direction
(`field_name` outside the fixed set, an empty `value`, a non-`http(s)`
`source_url`), and the append-only `UPDATE`/`DELETE` refusal — even for
`service_role` — all behaved exactly as designed. **None of this has
been exercised against the actual live Supabase project, and the
migration itself has not been applied there either** — both remain
separate, later, explicitly-approved steps, exactly like `0007` before
it was applied.

**Correction (2026-09-05, later still the same day): migration `0008`
has since been applied live to the actual Supabase project**, manually,
in the SQL Editor, and read-only re-verified afterward: `import_candidate_enrichments`
exists with the intended columns (confirmed via PostgREST's own OpenAPI
introspection); a live `UPDATE`/`DELETE` attempt against it, as
`service_role`, is refused (`permission denied for table
import_candidate_enrichments`, code `42501`) for both; the one real
`ImportRun` and its 10 `import_extraction_records` are unchanged; no
canonical or public table exists. `import_candidate_enrichments` holds
**zero rows** — applying the migration did not itself record any
enrichment. **The write path (`POST .../candidates/{id}/enrichments`)
remains genuinely unexercised against the live project.**

Separately noted during this same verification, not caused by it: **`import_candidate_reviews`
now holds 10 rows** (one review decision per existing candidate,
recorded between this migration's own live-verification rounds) —
meaning a working `internal` session has evidently completed at least
once since the "no working `internal` account exists yet" note above
was written. That note is not corrected here in full (it concerns the
review feature and the account-activation flow, both out of scope for
this migration's own verification) — flagged here only because it was
directly observed while confirming this migration's effects, and left
for a dedicated update rather than folded silently into this one.

**Addition (2026-09-06) — `deferred_reason`, migration `0009`, NOT YET
APPLIED live.** Because `import_candidate_reviews` already held those 10
real, live rows by the time this need was identified — and because it is
entirely plausible some of them are `deferred` — the new
`deferred_reason` column and its "required exactly when deferred" check
were written and locally validated (a fresh, disposable, containerized
PostgreSQL instance; 0004/0006/0007/0008 applied first, then a synthetic
row seeded with `status = 'deferred'` and no `deferred_reason`, to
exactly reproduce that live scenario, before applying `0009` on top)
specifically to prove: the migration applies cleanly despite that
pre-existing row (the `NOT VALID` constraint is what makes this
possible — a normally-validated constraint would have failed
immediately); the pre-existing row remains completely unmodified and
fully readable afterward; a new `deferred` decision with no reason, an
invalid reason, or a reason on a non-`deferred` status are all correctly
refused; a new `deferred` decision with a valid reason succeeds; the
append-only `UPDATE`/`DELETE` refusal (even for `service_role`) still
holds; and exactly one overload of `record_import_candidate_review()`
exists afterward (the old 5-argument version is explicitly dropped, not
left callable alongside the new 6-argument one). **None of this has been
exercised against the actual live Supabase project, and the migration
itself has not been applied there either** — both remain separate,
later, explicitly-approved steps, exactly like `0007`/`0008` before they
were applied. The real, live `import_candidate_reviews` rows themselves
were not read, queried, or otherwise touched while preparing this round.
