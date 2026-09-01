# Internal Provenance API (PLATFORM-05)

`GET`/`POST /api/internal/v1/provenance` — the first write-capable,
authenticated endpoint in the `PLATFORM-*` track. Implements
`docs/api/data-trust-model.md`'s schema on the persistence chosen in
`planning/decisions/010-platform-persistence-and-api.md`. Not reachable by
the public. Does not affect, read from, or write to `data/restaurants.json`
or `data/menus.json`, and is not called from any consumer-facing route.

**This ticket does not decide how a confirmed record here ever reaches a
consumer-facing page.** That remains an explicit, open, documented question
for a future ticket — see `planning/decisions/010-platform-persistence-and-api.md`.

## Authentication

Every request requires `Authorization: Bearer <supabase-access-token>`, a
valid Supabase Auth session token. The server verifies it directly against
Supabase (`src/lib/internalAuth.js`) and looks up the caller's role(s) from
`staff_roles` — a request from an authenticated Supabase user with no
`staff_roles` row is rejected (`403`), not silently granted default access.

## Roles and scope

| Role | Can act on |
|---|---|
| `editor` | Any restaurant |
| `internal` | Any restaurant |
| `owner` | Only the restaurant(s) their `staff_roles.restaurant_id` matches |

A caller with no matching role for the requested `restaurantId` gets `403`,
regardless of which other roles they might hold.

## `GET /api/internal/v1/provenance?restaurantId=<id>&fieldName=<optional>`

Returns the current provenance records for a restaurant, optionally
filtered to one `fieldName`.

**Response `200`:**
```json
{
  "records": [
    {
      "id": 1,
      "restaurant_id": "6",
      "field_name": "price",
      "field_ref": "6-diner-2-0",
      "value": { "priceValue": 19.5, "priceDisplay": "€19,50" },
      "source": "editor",
      "confidence": "high",
      "verified_at": "2026-08-30T12:00:00.000Z",
      "verified_by": "b3f1...-uuid",
      "created_at": "2026-08-30T12:00:00.000Z",
      "updated_at": "2026-08-30T12:00:00.000Z"
    }
  ]
}
```

## `POST /api/internal/v1/provenance`

**Request body** — only these four fields are accepted from the client:
```json
{
  "restaurantId": "6",
  "fieldName": "price",
  "fieldRef": "6-diner-2-0",
  "value": { "priceValue": 19.5, "priceDisplay": "€19,50" }
}
```

- `restaurantId` — required.
- `fieldName` — required, one of `price` / `openingHours` /
  `reservationMethod` / `itemAvailability` / `allergens`.
- `fieldRef` — optional, defaults to `''` (empty string, **not** `null` —
  see the schema note below). Identifies a specific item for item-level
  fields (e.g. a menu item key); left as `''` for restaurant-level fields
  like `reservationMethod`.
- `value` — required, any JSON-serializable payload representing the
  proposed/confirmed value.

**`source`, `confidence`, `verified_at`, and `verified_by` are never
accepted from the request body.** They are derived entirely server-side
from the authenticated caller's resolved role
(`src/lib/internalAuth.js#getAccessForRestaurant`), per
`docs/api/data-trust-model.md`'s status-label mapping:

| Caller role | `source` | `confidence` | `verified_at` | `verified_by` |
|---|---|---|---|---|
| `editor` | `editor` | `high` | now (server clock) | caller's user id |
| `owner` (scoped) | `owner` | `high` | now (server clock) | caller's user id |
| `internal` | `imported` | `low` | `null` | `null` |

This is a deliberate design choice, not an oversight: a client can never
claim a higher trust tier than its authenticated role actually earns, which
is exactly `planning/specs/platform-trust-model.md`'s "never silently
upgrade confidence" requirement, enforced structurally rather than by
convention.

Writing again for the same `(restaurantId, fieldName, fieldRef)` **replaces**
the current record (`upsert`) — this table holds current provenance, not a
full history. A separate history/audit log is a possible future extension,
not built here.

**Response `201`:**
```json
{ "record": { "id": 1, "restaurant_id": "6", "...": "..." } }
```

**Error responses** (all endpoints): `401` missing/invalid session, `403`
no matching role for the requested restaurant, `400` invalid/missing
fields, `500` database error.

## Schema note: `field_ref` is `''`, never `null`

Postgres treats `NULL` as distinct in `UNIQUE` constraints, which would
silently break the "one current record per field" invariant this table
depends on. `field_ref` defaults to `''` at the database level and the API
never sends `null` for it — this is why the upsert's conflict target
(`restaurant_id, field_name, field_ref`) works reliably.

## Bootstrap: assigning the first roles

**Correction (`PLATFORM-07`): this is no longer accurate for `owner`.**
It was true through `PLATFORM-06` that role assignment was always manual —
`owner` now also has a second, real path: an approved restaurant claim
grants it automatically via `approve_restaurant_claim`
(`docs/api/owner-claims-api.md`), reviewed by a human editor first, never
by a self-service form directly. `editor`/`internal` still have no
self-service or automated path — the manual steps below remain the only
way to grant those.

1. The person signs in once via Supabase Auth (however your project's auth
   flow is configured) so a row exists in `auth.users`.
2. In the Supabase SQL Editor, insert a row directly:
   ```sql
   insert into staff_roles (user_id, role, restaurant_id)
   values ('<their-auth.users-id>', 'editor', null);
   ```
3. For an `owner` role granted this way (e.g. for testing, bypassing the
   claim flow), `restaurant_id` is required (enforced by a `check`
   constraint in the migration) and must match the restaurant id scheme
   used in `data/restaurants.json` (e.g. `"6"`).

## What has been verified

Verified against a real Supabase project (2026-08-30): the migration runs
cleanly, a real authenticated `POST` and `GET` against
`/api/internal/v1/provenance` both succeed, `source`/`confidence`/
`verified_at`/`verified_by` are confirmed server-derived — a request that
tried to smuggle `source`/`verifiedBy`/`verifiedAt` in the body had all of
it silently ignored, with the response showing the real, role-derived
values instead — and repeated writes to the same
`(restaurant_id, field_name, field_ref)` correctly upsert to one row rather
than duplicating. `npm run build` and every consumer route/bundle size were
unaffected.

One real bug was found and fixed during this verification: the migration
was missing explicit `GRANT` statements for `service_role` on both tables.
`service_role`'s `BYPASSRLS` skips the RLS policies above, but that is a
separate mechanism from Postgres's table-level `GRANT` system — without
them, every query failed with `permission denied` regardless of RLS. Now
part of the migration itself (see its "Grants for service_role" section).

**Verified in a follow-up round (2026-08-31), with a second real test
account**: the `owner` role's per-restaurant scope — allowed (`200`/`201`)
for its own `restaurant_id`, blocked (`403`) for any other restaurant, on
both `GET` and `POST` — and the "authenticated but no `staff_roles` row"
path, which correctly returns `403` before any role has been granted. The
existing `editor` path was re-tested at the same time with a fresh token
and is unaffected. Consumer routes and bundle sizes were re-confirmed
unchanged.

`PLATFORM-05` has no remaining unverified acceptance criteria.
