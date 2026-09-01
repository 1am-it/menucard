# Owner Claim API (PLATFORM-07)

Two trust tiers, deliberately split across two namespaces:

- **`/api/claims/...`** — reachable by any authenticated Supabase user, no
  `staff_roles` row required. This is the first API surface in the project
  that isn't staff-only.
- **`/api/internal/v1/claims/...`** — editor-only, same boundary as
  `PLATFORM-06`'s moderation queue (not `owner`, not `internal`).

Builds on `PLATFORM-05`'s auth verification and `PLATFORM-06`'s atomic-RPC
pattern. Approving a claim only grants a `staff_roles` row — the resulting
owner then edits data through `PLATFORM-05`'s existing
`/api/internal/v1/provenance` unchanged; nothing about that endpoint needed
to change for this ticket.

## `POST /api/claims`

**Auth**: any authenticated user (`src/lib/claimAuth.js#authenticateAnyUser`
— verifies the session, does not require a `staff_roles` row).

**Request body**: `{ "restaurantId": "6" }`. `restaurantId` is validated
server-side against the real dataset (`data/restaurants.json`) — an unknown
id is `404`, never silently accepted.

`email`/`user_id` are taken **only** from the verified session, never from
the request body.

**Behavior, in order:**
1. Already the verified `owner` of this restaurant? → `409`
   `{ "error": "...", "alreadyOwner": true }`. No claim created.
2. Already has a `pending` claim for this restaurant? → `200`
   `{ "claim": {...}, "alreadyExists": true }` — a repeat submission is
   handled gracefully as an existing-status response, not an error.
   (A claim that was previously `rejected` does **not** block a fresh
   attempt — only a currently-`pending` one does.)
3. Otherwise, computes `domain_match` (see below) and creates the claim.
   **Response `201`:** `{ "claim": {...} }`.

## `GET /api/claims/mine?restaurantId=<optional>`

**Auth**: any authenticated user. Returns only the caller's own claims,
filtered server-side by their verified `user_id` — never by a
client-supplied id.

## Domain-match evidence

`computeDomainMatch(email, restaurant.website)`
(`src/utils/domainMatch.js`): lowercases both sides and strips a leading
`www.`, then compares for an exact match. Deliberately simple — no
subdomain-suffix matching. **This is advisory evidence for the reviewing
editor, never an automatic gate** — every claim goes through
`/api/internal/v1/claims/...` review regardless of whether it matched.

## `GET /api/internal/v1/claims/pending`

**Auth**: `editor` only (not `owner`, not `internal`).

Returns pending claims paired with restaurant context (name, website) and
whether that restaurant already has an approved owner —
`hasExistingOwner: true` is shown, never used to auto-block a decision; the
editor decides. Multiple pending claims from different claimants on the
same restaurant are listed side by side, unresolved by the system — an
explicit editor decision is required, per the ticket's own requirement not
to silently drop or auto-resolve conflicting claims.

**Response `200`:**
```json
{
  "items": [
    {
      "claim": { "id": 1, "restaurant_id": "6", "user_id": "...", "claim_email": "eigenaar@restaurant.nl", "domain_match": true, "status": "pending", "...": "..." },
      "restaurantName": "Brasserie Bardot",
      "restaurantWebsite": "https://www.brasseriebardot.nl",
      "hasExistingOwner": false
    }
  ]
}
```

## `POST /api/internal/v1/claims/{id}/approve`

**Auth**: `editor` only. Calls the `approve_restaurant_claim` Postgres
function (server/service-role only — `EXECUTE` revoked from `PUBLIC`),
which in one transaction:

1. Inserts a `staff_roles` row (`role: 'owner'`, the claim's
   `restaurant_id`, the claim's `user_id`) — `ON CONFLICT DO NOTHING`, so
   approving twice for the same person/restaurant is harmless.
2. Marks the claim `approved` with `decided_by`/`decided_at`.

Both succeed or both roll back. **Response `200`:** the updated claim.
**Response `404`:** already decided by someone else (checked with
`FOR UPDATE`, so two simultaneous approvals can't both succeed).

**A restaurant can end up with more than one `owner`.** Nothing here
prevents it, by design: `GET /api/internal/v1/claims/pending` shows the
reviewer a `hasExistingOwner` flag when a restaurant already has one, but
that is informational only — the editor decides whether to approve anyway.
There is no automatic-approval path anywhere in this ticket; every
additional owner exists only because a human editor explicitly chose to
grant it.

## `POST /api/internal/v1/claims/{id}/reject`

**Auth**: `editor` only. Request body (optional): `{ "note": "..." }`.
Marks the claim `rejected`. Never touches `staff_roles`. **Response `200`:**
the updated claim. **Response `404`:** already decided.

## Error responses (all endpoints)

`401` missing/invalid session, `403` (internal routes only) caller has no
`editor` role, `400` invalid/missing fields, `404` unknown restaurant or
already-decided claim, `409` duplicate/already-owner, `500` database error.

## Correction to a previous documented assumption

`docs/api/internal-provenance-api.md`'s "Bootstrap" section (`PLATFORM-05`)
stated role assignment is "always manual... no UI for this yet." That
remains true for `editor`/`internal` roles — there is still no self-service
or automated path for those. **It is no longer true for `owner`**: an
approved claim grants that role automatically via the RPC above, after
human editor review. `supabase/migrations/0003_restaurant_claims.sql` adds
the one specific, narrow `GRANT INSERT ON staff_roles TO service_role` this
requires — nothing else about `staff_roles`'s access model changed.

## What has been verified

Verified against a real Supabase project (2026-09-01), with a fully
synthetic aspirant-owner test account (an email on a made-up domain, no
real inbox) and the existing `editor`/`owner` accounts:

- **The magic-link callback itself**: an admin-generated GoTrue magic
  link — the same verification mechanism a genuinely emailed link uses —
  was followed all the way through to session recognition on
  `/claim/[restaurantId]` and a real claim submission via an actual click
  in the UI, not an injected session.
- **Not verified**: actual email delivery through the claim page's own
  "Stuur inlogkoppeling" send button. Supabase's project-wide email
  send-rate-limit was hit while testing — confirmed, via a separate direct
  check, to also affect an unrelated address, so this is a shared-quota/
  environment constraint of this Supabase project, not a defect in the
  send flow itself. Tracked as an external, low-risk follow-up.
- Domain-match evidence computed correctly and shown as advisory only
  (the claim was created and reviewable despite not matching).
- Duplicate-claim handling (`200` with the existing claim, not an error),
  unknown-`restaurantId` validation (`404`), and a caller already the
  verified owner of a restaurant being blocked from re-claiming it (`409`,
  exercised by inspection of the code path — the live round covered
  duplicate-pending and unknown-restaurant explicitly).
- Editor review showing restaurant context and the `hasExistingOwner`
  flag; non-editors (an existing `owner` account) blocked with `403` from
  both viewing the queue and approving.
- Atomic approve — the granted `owner` role worked immediately against
  `PLATFORM-05`'s unmodified `/api/internal/v1/provenance` endpoint, with
  no code change needed there — and reject, both with double-decision
  protection (`404` on a second decision).
- Consumer routes unaffected.

The synthetic owner role granted during testing was revoked afterward via
a bounded `DELETE` on its specific `staff_roles.id`. The claim records and
the synthetic test account were kept deliberately, as a documented
pre-launch verification audit trail — the same treatment
`PLATFORM-06` gave its own `pending_changes` test rows.
