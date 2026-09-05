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

- `possible_duplicate`/`quality_status`/`missing_fields` are computed
  fresh on every request from `extracted_fields` (`src/lib/importInbox.js`)
  — **never** a stored column, **never** `MARKET-05B`'s eventual real
  deduplication logic. `possible_duplicate` is computed over the *entire*
  candidate set before any filter is applied, so a cross-run duplicate is
  still flagged even when filtering down to one run.
- **`review_status` (addition, 2026-09-05) is resolved, not computed**:
  the `status` of the *latest* `import_candidate_reviews` row for that
  candidate (by `decided_at`), or `"new"` when no review row exists yet
  — see "Candidate reviews" below for the full model. Every review row
  across every candidate is fetched in one bounded query (capped at 4000)
  and reduced in `src/lib/importInbox.js`'s `buildReviewStatusByCandidateId`;
  no per-candidate round trip.
- `run_id` — exact `import_run_id` match.
- `category` — exact match against `extracted_fields.category` (the
  OSM `amenity` value).
- `name` — case-insensitive substring match against
  `extracted_fields.name`.
- `possible_duplicate` — `"true"` or `"false"`.
- `quality` — `"complete"` or `"incomplete"`.
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
        "name": "...", "address": "...", "phone": "...", "website": "...",
        "category": "restaurant", "location": { "lat": 51.58, "lon": 4.78 }, "osm_node_id": "4001"
      },
      "possible_duplicate": false,
      "quality_status": "complete",
      "missing_fields": [],
      "review_status": "new"
    }
  ],
  "total_before_filters": 500,
  "total_after_filters": 120
}
```
An incomplete candidate's `missing_fields` names exactly which of
`name`/`address`/`phone`/`website` are absent, e.g. `["phone"]` — shown
in `/internal/import-inbox`'s per-candidate detail view as
`Missing: phone`.

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
      "note": "phone number confirmed via a second look"
    },
    {
      "id": 1,
      "candidate_id": "...",
      "reviewer_id": "...",
      "decided_at": "2026-09-05T10:00:00.000Z",
      "status": "needs_enrichment",
      "rejection_reason": null,
      "note": null
    }
  ]
}
```
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
- `note` — optional, at most 2000 characters.

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

## Error responses (all endpoints)

`401` missing/invalid session, `403` caller has no `internal` role, `500`
database error (`{"error": "Query failed"}` — never the raw Supabase
error message).

## Browser-side auth for the UI (`/internal/import-inbox`)

Same pattern as `/internal/moderation`: `src/lib/supabaseBrowser.js` is
used **only** for sign-in/session lookup; the page never queries Supabase
directly, only these routes (now three, since the 2026-09-05 review
addition), with the session's `access_token`.

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
