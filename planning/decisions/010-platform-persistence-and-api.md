# Decision — Platform Persistence: Supabase, for the New Write-capable Track Only

## Status

Accepted

## Context

`PLATFORM-03` defined the per-field trust/provenance schema
(`docs/api/data-trust-model.md`) that any write-capable `PLATFORM-*` ticket
depends on. Nothing in the current app can persist writes at all: MenuCard
is Vercel-hosted Next.js reading two static JSON files
(`data/restaurants.json`, `data/menus.json`), with one existing serverless
route handler (`/api/search`) that is read-only. `PLATFORM-04`'s job is to
decide where new write-capable data lives, how it's authenticated, and how
it coexists with what already exists — before `PLATFORM-05` writes a single
line of implementation code.

## Decision

**Persistence: Supabase** (managed Postgres, with Row Level Security).
**Auth: Supabase Auth**, backed by an explicit roles/scopes table — not a
single admin flag, per `planning/specs/platform-api.md`'s existing
requirement.

### What Supabase stores — and what it explicitly does not

Supabase holds only the **new**, write-capable platform data: per-field
provenance records (`docs/api/data-trust-model.md`'s schema), restaurant
owner claims, community contributions, and moderation queue items.

**It does not replace or migrate `data/restaurants.json` or
`data/menus.json`.** The existing consumer-facing read path — `/`,
`/search`, `/restaurant/[id]`, `/menu/[id]`, `/nvwa/[id]`, `/restaurants`,
and `PLATFORM-01`/`02`'s coverage dashboard and low-coverage messaging — is
completely unaffected by this decision and keeps reading the same static
JSON, exactly as it does today. Whether/when the static consumer dataset
itself should ever move into Supabase is a separate, larger question this
decision deliberately does not answer — it is out of scope here, and would
need its own future decision if it's ever proposed.

This is an **additive platform layer for new functionality**, not a rewrite
or migration of the existing app.

### Auth / role model

Three roles, checked as explicit scopes per action (never a single
`isAdmin` boolean):

- **`editor`** — a trusted internal reviewer. Can act on any item in the
  `PLATFORM-06` moderation queue.
- **`owner`** — granted per-restaurant, only after a claim is approved
  (`PLATFORM-07`). Can write only to the specific restaurant(s) they're
  scoped to, never to arbitrary restaurants.
- **internal/system** — used by `PLATFORM-05`'s own internal tooling and
  any future internal contribution-intake surface. Not public.

No role here is granted to the general public. Community contributions
(`PLATFORM-08`) land in the moderation queue for an `editor` to act on —
contributors do not get a Supabase Auth role at all in this initial model.

### Internal API boundary

Per the already-decided principles in `planning/specs/platform-api.md`:
versioned routes under `/api/internal/v1/...`, as Next.js route handlers
following the exact same pattern as the existing `/api/search/route.js`.
Every request is authenticated via a Supabase Auth session/JWT, checked
against the role/scope it requires. No public-facing route or API key
exists yet — that remains explicitly out of scope until `PLATFORM-10` or
later, per `platform-api.md`.

### Coexistence with the current deployment

Vercel continues to host the app exactly as it does today. Supabase is
reached only from new internal route handlers (`PLATFORM-05` onward), via
`@supabase/supabase-js`, used strictly server-side — it never ships to the
client bundle and has zero effect on the consumer-facing performance budget
(`planning/decisions/003-performance-budget.md`).

### What comes next

**`PLATFORM-05` is the first implementation ticket that follows from this
decision.** It creates the actual Supabase project, provisions
environment variables, writes the table schema for `docs/api/data-trust-model.md`,
and implements the first authenticated internal endpoints. Nothing in
`PLATFORM-04` itself creates any infrastructure, installs any dependency, or
touches application code.

## Trade-offs (stated plainly, not resolved here)

- **Vendor lock-in**: Row Level Security policies and Supabase's Auth user
  model are Supabase-specific patterns. A future move to a different
  backend would require rewriting both, not just swapping a connection
  string — a real cost, accepted here in exchange for standing up
  persistence + auth as a single, faster-to-implement unit rather than two
  separately-integrated services.
- **Rate limiting** is still unbuilt. `platform-api.md` already noted this
  as a "hooks, not yet enforcement" concern — choosing Supabase doesn't
  solve it; `PLATFORM-05`/`08` still need to design it.
- **Exact schema (table DDL, RLS policy definitions)** is not written here
  — this decision fixes the vendor and the conceptual role model;
  `PLATFORM-05` turns `docs/api/data-trust-model.md`'s shape into actual
  tables and policies.

## Note (2026-08-30) — `supabase/schema.sql` is not this decision

While implementing `PLATFORM-05`, an existing, already-committed
`supabase/schema.sql` was found — a complete, alternative relational schema
for the entire consumer dataset (`restaurants`, `menus`, `menu_items`,
`allergens`, `restaurant_accounts`, public-read RLS policies, etc.),
predating the `PLATFORM-*` track entirely (committed in
`d232211 chore: move project files from bredaeats17/ to repo root`).

**That file is not the current direction and is not used by anything in
this decision or in `PLATFORM-05`'s migration.** It answers exactly the
question this decision deliberately leaves open — whether/when the static
consumer dataset moves into Supabase — in a much larger, different way than
anything approved here. It has been left in place, untouched, rather than
deleted, since removing pre-existing work isn't this ticket's call to make
unilaterally. If it's genuinely obsolete, a future ticket should propose
removing or archiving it explicitly; until then, treat it as inert and
unrelated to the `field_provenance`/`staff_roles` schema this decision and
`PLATFORM-05` actually implement.

## Note (2026-09-01) — the deferred question now has a principle-level answer

This decision's "separate, larger question" (whether/when the static
consumer dataset moves off static JSON) is addressed — at the principle
level only, nothing built or scheduled — in
`[[011-market-foundation-and-international-growth]]`. That decision
describes a future hybrid canonical-dataset + published-snapshot
architecture and names two separate, not-yet-approved tickets in
`planning/architecture/market-data-foundation-plan.md`: `MARKET-08` (a
minimal market-aware consumer read path, needed before any second market
can launch at all, not tied to the snapshot mechanism) and `MARKET-09`
(cutting the consumer app over to read from published snapshots, an
optional later scaling step). **Nothing in this decision changes**:
Supabase remains scoped to `PLATFORM-*`'s write-capable data only, and
`data/restaurants.json`/
`data/menus.json` remain exactly what this decision already said they are.

## Rejected alternatives

- **A plain Postgres provider (e.g. Vercel Postgres/Neon) + a separate auth
  library (Auth.js).** More vendor-neutral, but two integrations to stand
  up and keep in sync instead of one — rejected in favor of the faster,
  single-vendor path for this stage of the platform track.
- **Migrating `data/restaurants.json`/`data/menus.json` into Supabase now,
  alongside the new write-capable data.** Rejected: conflates this
  decision (new platform data) with a much larger, separately-justified
  question (moving the entire consumer dataset off static JSON), which
  nothing in the current `PLATFORM-*` or `BE-*` tickets has asked for.
