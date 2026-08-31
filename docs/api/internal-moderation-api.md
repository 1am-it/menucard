# Internal Moderation API (PLATFORM-06)

`GET /api/internal/v1/moderation/pending`, `POST /api/internal/v1/moderation/{id}/approve`,
`POST /api/internal/v1/moderation/{id}/reject` — the moderation queue for
proposed data changes. Builds on `PLATFORM-05`'s auth/role guard
(`src/lib/internalAuth.js`) unchanged. Not reachable by the public.

**This ticket does not decide how an approved value ever reaches a
consumer-facing page.** Approving only updates the current
`field_provenance` record — `data/restaurants.json` and `data/menus.json`
are untouched, and that consumption path remains the open question
documented in `planning/decisions/010-platform-persistence-and-api.md`.

## What's new vs. `PLATFORM-05`

A separate `pending_changes` table (`supabase/migrations/0002_pending_changes.sql`)
holds proposed changes. `field_provenance` itself is unchanged — it still
holds only the current, approved value per field, nothing else. There is no
endpoint to *create* a pending change in this ticket — per its own scope,
proposals are seeded via manual SQL until `PLATFORM-07`/`08` add a real
source of them.

## Authentication and roles

Same Supabase Auth bearer-token pattern as `PLATFORM-05`. **Every route
here is editor-only** — not `owner` (even for their own restaurant; owners
have no visibility into the moderation queue in this ticket), not
`internal` (that role represents automated/system writes, not a human
trust decision). A caller with `owner` or `internal` roles only (no
`editor`) gets `403`.

## `GET /api/internal/v1/moderation/pending?restaurantId=<optional>`

Returns pending items (status `pending` only, newest last, capped at 50),
each paired with its current `field_provenance` counterpart if one exists —
so the caller can show old vs. new, matching the reference mockup's
"Oud €18,50 (imported) → Nieuw €19,50" pattern.

**Response `200`:**
```json
{
  "items": [
    {
      "pending": {
        "id": 5, "restaurant_id": "6", "field_name": "price", "field_ref": "6-diner-2-0",
        "proposed_value": { "priceValue": 19.5 }, "proposed_source": "community",
        "proposed_by": null, "status": "pending", "decided_by": null, "decided_at": null,
        "decision_note": null, "created_at": "...", "updated_at": "..."
      },
      "current": {
        "id": 1, "restaurant_id": "6", "field_name": "price", "field_ref": "6-diner-2-0",
        "value": { "priceValue": 18.5 }, "source": "imported", "confidence": "low", "...": "..."
      }
    }
  ]
}
```
`current` is `null` when no live value exists yet for that field.

## `POST /api/internal/v1/moderation/{id}/approve`

No request body. Calls the `approve_pending_change` Postgres function
(server/service-role only — `EXECUTE` is revoked from `PUBLIC`), which in
one transaction:

1. Upserts `field_provenance` for the pending row's `(restaurant_id, field_name, field_ref)` with the proposed value, `source: "editor"`, `confidence: "high"`, and `verified_at`/`verified_by` set to now/the approving editor — the exact same server-derived values `PLATFORM-05`'s own `POST /provenance` would produce for an editor.
2. Marks the `pending_changes` row `approved`, recording `decided_by`/`decided_at`.

Both succeed or both roll back — never a half-applied approval. The
original `proposed_source` (e.g. `community`, `imported`) is preserved on
the (never-deleted) `pending_changes` row, so approving doesn't erase where
the proposal actually came from.

**Response `200`:** the resulting `field_provenance` record, same shape as
`docs/api/internal-provenance-api.md`'s `POST` response.

**Response `404`:** the pending change doesn't exist or was already
decided (approved/rejected) by someone else — checked with `FOR UPDATE`
inside the transaction, so two simultaneous approvals can't both succeed.

## `POST /api/internal/v1/moderation/{id}/reject`

**Request body** (optional): `{ "note": "why this was rejected" }` (max
2000 chars, stored as-is). Marks the `pending_changes` row `rejected` with
`decided_by`/`decided_at`. Never touches `field_provenance` — a single
`UPDATE` is already atomic on its own, so this doesn't need the RPC
approach `approve` uses.

**Response `200`:** the updated `pending_changes` record. **Response
`404`:** same as `approve`.

## Error responses (all endpoints)

`401` missing/invalid session, `403` caller has no `editor` role, `400`
invalid id, `404` pending change not found/already decided, `500` database
error.

## Seeding a pending change for testing (no creation endpoint exists)

```sql
insert into pending_changes (restaurant_id, field_name, field_ref, proposed_value, proposed_source)
values ('6', 'price', '6-diner-verify-test', '{"priceValue": 21.0}'::jsonb, 'community');
```

## Browser-side auth for the UI (`/internal/login`, `/internal/moderation`)

`src/lib/supabaseBrowser.js` uses Supabase Auth **only** for sign-in and
session lookup (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
— see `.env.local.example`). The anon/publishable key is meant to be public
and is not a secret; it is categorically different from
`SUPABASE_SERVICE_ROLE_KEY`, which must never reach the browser and doesn't
here. The moderation page never queries Supabase directly — it calls this
API with the session's `access_token`, exactly like any other authenticated
client of these routes.

## What has been verified

Verified against a real Supabase project (2026-08-31), with the existing
`editor` and `owner` (restaurant `6`) test accounts, using sessions minted
without needing either account's password (see
`docs/guides/internal-api-live-testing.md`):

- `GET` the queue as `editor` → `200`, correctly pairs each pending item
  with its current `field_provenance` counterpart. As `owner` → `403`.
- `approve` as `owner` (even for their own restaurant) → `403`. As `editor`
  → `200`, `field_provenance` updated atomically with `source: editor` and
  a fresh `verified_at`/`verified_by`. Approving the same item again →
  `404`, proving the RPC's `FOR UPDATE` lock prevents a double decision.
- `reject` as `editor`, with a note → `200`; the targeted `field_provenance`
  record was confirmed **unchanged**. Rejecting the same item again → `404`.
- `/internal/login` renders and correctly surfaces "Invalid login
  credentials" for a wrong password. `/internal/moderation`, with a real
  injected editor session, listed the queue and a real click on "Approve"
  produced a genuine new `verified_at` in the database — confirmed
  end-to-end through the UI, not just the API. The same page with an
  `owner` session correctly renders the API's `403` message instead of
  crashing.
- Consumer routes and bundle sizes: unchanged, re-confirmed after the fix
  below.

**One bug found and fixed during this verification**: rejecting an
already-decided change returned `500` instead of `404`, because `.single()`
on an `update()` that matches zero rows throws rather than returning an
empty result. Fixed in `app/api/internal/v1/moderation/[id]/reject/route.js`
(check the returned array's length instead of relying on `.single()`) and
re-verified — now correctly `404`.

**Live test data, and why it looks the way it does**: verification left six
`pending_changes` rows (a mix of approved, rejected, and never-decided)
seeded across this round — kept deliberately, as a permanent, self-evident
pre-launch verification audit trail, consistent with this table's own
never-delete design. One synthetic `field_provenance` record it produced
(restaurant `6`, price) was removed afterward via a bounded `DELETE`,
since it never corresponded to a real value — `field_provenance` is meant
to hold genuine current data, unlike `pending_changes`, whose whole purpose
includes retaining a history of decisions, real or test.
