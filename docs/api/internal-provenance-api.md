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

There is no UI for this yet — deliberately, per this ticket's scope
(`PLATFORM-06`/`07` build role-granting surfaces later). To grant a role:

1. The person signs in once via Supabase Auth (however your project's auth
   flow is configured) so a row exists in `auth.users`.
2. In the Supabase SQL Editor, insert a row directly:
   ```sql
   insert into staff_roles (user_id, role, restaurant_id)
   values ('<their-auth.users-id>', 'editor', null);
   ```
3. For an `owner` role, `restaurant_id` is required (enforced by a `check`
   constraint in the migration) and must match the restaurant id scheme
   used in `data/restaurants.json` (e.g. `"6"`).

## What has and hasn't been verified

Verified locally: `npm run build` succeeds with these files in place; the
route handler fails safely (a clear thrown error, not a crash or silent
no-op) when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are unset, which is
the actual state of this environment right now — no Supabase project has
been created yet.

**Not verified, and cannot be until a real Supabase project exists**: an
actual authenticated request reaching the endpoint, the SQL migration
running cleanly against a real Supabase database, the RLS policies
behaving as written, and a real upsert/read round-trip. None of this was
simulated or assumed to work — it's reported here as untested, not as
passing.
