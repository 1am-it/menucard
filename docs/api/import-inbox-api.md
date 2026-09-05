# Internal Import Inbox API (`MARKET-05A`)

`GET /api/internal/v1/import-inbox/runs`, `GET /api/internal/v1/import-inbox/candidates`
— a read-only window onto `MARKET-04`'s `import_runs`/
`import_extraction_records` tables, entirely before any normalization,
matching, or canonical merge. Builds on `PLATFORM-05`'s auth/role guard
(`src/lib/internalAuth.js`) unchanged. Not reachable by the public. Full
design: `planning/specs/tickets/market-05-normalization-deduplication.md`'s
"MARKET-05A — Data-inbox: interne kandidaat-review" section.

**Neither route ever writes anything.** No `.insert()`/`.update()`/
`.delete()` appears anywhere in either route's source — both are `GET`
only. Nothing here creates a canonical candidate, a `pending_changes`
row, or a public route.

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

## `GET /api/internal/v1/import-inbox/candidates?run_id=&category=&name=&possible_duplicate=&quality=`

Every `import_extraction_records` row (newest `retrieved_at` first,
capped at 2000 — a named v1 limitation, not silent: revisit with real
pagination once volume materially exceeds this), enriched with two
**computed, read-only, never-stored** fields and then filtered. All
query parameters are optional and combine with AND.

- `possible_duplicate`/`quality_status` are computed fresh on every
  request from `extracted_fields` (`src/lib/importInbox.js`) — **never**
  a stored column, **never** `MARKET-05B`'s eventual real deduplication
  logic. `possible_duplicate` is computed over the *entire* candidate
  set before any filter is applied, so a cross-run duplicate is still
  flagged even when filtering down to one run.
- `run_id` — exact `import_run_id` match.
- `category` — exact match against `extracted_fields.category` (the
  OSM `amenity` value).
- `name` — case-insensitive substring match against
  `extracted_fields.name`.
- `possible_duplicate` — `"true"` or `"false"`.
- `quality` — `"complete"` or `"incomplete"`.

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
      "missing_fields": []
    }
  ],
  "total_before_filters": 500,
  "total_after_filters": 120
}
```

## Error responses (both endpoints)

`401` missing/invalid session, `403` caller has no `internal` role, `500`
database error (`{"error": "Query failed"}` — never the raw Supabase
error message).

## Browser-side auth for the UI (`/internal/import-inbox`)

Same pattern as `/internal/moderation`: `src/lib/supabaseBrowser.js` is
used **only** for sign-in/session lookup; the page never queries Supabase
directly, only these two routes, with the session's `access_token`.

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
"Access control" section. Separately, zero `ImportRun`s exist today, so
even once an `internal` session exists, there is nothing yet to browse
beyond the "no import runs yet" empty state — itself the one state that
**is** live-confirmed correct today.
