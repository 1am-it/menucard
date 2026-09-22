# URL Intake Schema (BE-19)

The concrete, implementable contract for `url_intakes` — a small,
additive, internal audit/traceability record for the practical workflow
`planning/specs/tickets/be-19-onboarding-restaurant-via-url.md` names:
one restaurant URL → a safe, staff-triggered analysis → a restaurant
concept plus zero or more menu concepts → human review → any later
publication, with the employee never typing a restaurant id, menu
context, JSON, menu URL, or PDF URL. Documentation/schema contract only —
no code, migration, route, UI, or Supabase change exists yet, matching
the `MARKET-01`–`03`/`05C` precedent of shipping the contract before the
implementation.

This document defines `url_intakes` itself. The resulting change to
`restaurant_profile_drafts`/`restaurant_profile_draft_field_facts` (a new
origin, not a new table) is defined in
`docs/api/restaurant-profile-drafts-schema.md`'s own "Amendment
(2026-09-22, BE-19)" section — read both together; neither is complete on
its own.

## What this is not

`url_intakes` is **not** a second `MARKET-04` import pipeline, not a
second `MARKET-05A` candidate-review queue, and not a competing model to
either. `MARKET-04`'s `ImportRun`/`ImportExtractionRecord` remain the
mechanism for registered-source, repeatable, bulk acquisition (e.g. the
existing OSM/Geofabrik/Kadaster work) — gated by a reviewed `Source`/
`SourceAuthorizationVersion` per `docs/api/source-registry-schema.md`.
`url_intakes` is a structurally lighter, deliberately narrower mechanism
for a categorically different action: one authenticated staff member,
one specific restaurant's own declared web presence, one deliberate
click. See "Governance exception" below for exactly why these two stay
separate instead of forcing the lighter action through the heavier
pipeline.

## Governance exception — staff-triggered single-URL onboarding fetch

**This is the load-bearing decision this contract adds.** `docs/api/source-registry-schema.md`'s
own invariants require every source an `ImportRun` targets to have a
`SourceAuthorizationVersion` with `status ∈ {allowed, restricted}` —
correct and unchanged for bulk/repeatable acquisition. Two features
already shipped before this contract — `MARKET-05A`'s "Suggest data from
website" (`app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js`)
and `BE-18`'s onboarding-menu URL read
(`app/api/internal/v1/onboarding-menu/read-url/route.js`) — already fetch
a specific restaurant's own website without any `Source`/
`SourceAuthorizationVersion` registration, using `src/lib/safeOutboundFetch.js`'s
SSRF hardening and `classifyRobotsGate`'s fail-closed robots.txt check as
their only gate. This was never reconciled in writing against
`MARKET-03`/`04`'s stated "every source needs a reviewed authorization"
rule. This amendment closes that gap by naming the exception explicitly,
rather than leaving two already-shipped features silently inconsistent
with a documented hard rule.

**The exception, precisely bounded** — a fetch qualifies for this lighter
governance tier if and only if all of the following hold:

- Triggered by one explicit action from one authenticated `internal`-role
  account — never scheduled, never automatic, never triggered by any
  other event.
- Exactly one target URL per action — never a list, never a crawl of
  discovered links, never a second hop beyond redirects `safeOutboundFetch.js`
  already bounds and re-validates.
- `robots.txt` honored fail-closed, identically to `suggest-from-website`/
  `BE-18` today — a technical, self-imposed gate, never a claim of legal
  permission, per `[[011-market-foundation-and-international-growth]]` §7.
- No browser login, session, or credential of any kind is used or
  forwarded — `safeOutboundFetch.js`'s existing "no cookies/session state
  ever sent" guarantee, unchanged.
- No personal data beyond `docs/api/source-registry-schema.md`'s existing
  `basic_info` allowlist is ever extracted or retained — the same
  standing exclusion (owner/staff names, personal contact details, likely
  home addresses) already enforced for every other intake path in this
  project.
- No automatic publication of anything the fetch produces — every result
  is, at most, a reviewable concept (see below), never canonical or
  public data.

**Why this doesn't need a registered `Source`**: a `SourceAuthorizationVersion`
answers "may MenuCard repeatedly, automatically acquire data from this
origin at scale, and what may it do with it once acquired." A
staff-triggered single fetch of one specific, already-known-or-being-
onboarded business's own declared website answers a narrower, different
question — "may an authorized human read this one already-public page,
once, to propose facts about the business that page itself represents."
The technical SSRF/robots defense is identical either way and is never
weakened by this exception; only the source-registration *paperwork* is
what this exception waives, and only for exactly the bounded action above.

**What this exception does not cover** — general same-host page discovery
(finding a menu link from a homepage), PDF fetching/processing, any form
of crawl beyond the one fetched URL and its own bounded redirect chain,
and any bulk/CSV list of URLs. Each remains either already out of scope
(per `be-18-onboarding-menu-via-url.md`'s own "Non-goals") or a separate,
later, explicitly-scoped decision — this amendment does not pre-authorize
any of them by association.

**What this exception does not exempt downstream**: the fetch step alone
is lighter-governed. Everything that happens *after* a fetch — turning it
into a restaurant concept, turning a menu into a `BE-17` snapshot
proposal, any moderation or publication — goes through exactly the same
human-review gates as any other source, unchanged. This exception is
scoped to the acquisition step only, never to what may be done with its
result.

## `url_intakes` — audit/traceability record, not a review queue

**One row per confirmed human action on an analyzed URL — never one row
per page load.** Reading a URL (`BE-18`'s existing, unchanged, ephemeral
read-url step) produces no database row at all, exactly as today. A row
is written here only at the moment a staff member takes the *first*
durable action on that analysis: either "create a restaurant concept" or,
for an already-matched existing restaurant, the moment just before its
first `BE-17` menu snapshot proposal is created from this same URL. This
keeps `url_intakes` a factual record of what was decided and acted on —
never a second, independently-reviewable pending queue with its own
approval workflow.

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid primary key` | App-generated UUIDv7, matching `markets`/`import_runs`/`restaurant_profile_drafts`' own convention — not Postgres's `gen_random_uuid()`. |
| `market_id` | `uuid not null references markets(id)` | Same requirement every market-bound record in this project already carries. |
| `source_url` | `text not null check (source_url ~* '^https?://')` | The exact URL a staff member submitted — same shape check as `menu_snapshot_proposals.source_url`. |
| `source_hostname` | `text not null` | Normalized the same way `src/lib/restaurantHostMatch.js`'s `normalizeHostname` already does — stored redundantly with `source_url` purely for cheap lookup/audit, never re-derived inconsistently. |
| `fetched_at` | `timestamptz not null` | When the underlying fetch actually happened — may predate `created_at` below by the time it takes a reviewer to decide. |
| `actor_user_id` | `uuid not null references auth.users(id)` | The authenticated `internal` account that triggered the fetch and the resulting action. |
| `restaurant_match_type` | `text not null check (restaurant_match_type in ('exact', 'none', 'multiple'))` | Mirrors `src/lib/restaurantHostMatch.js`'s existing `matchType` vocabulary exactly — descriptive of what the fetch found, never itself an authorization to act. |
| `matched_restaurant_id` | `text` (nullable) | Set only when `restaurant_match_type = 'exact'` **and** a human confirmed it. The existing `data/restaurants.json` string key — never a `restaurant_profile_drafts` id, never any other identifier shape. This is the **only** field in this entire contract that a future `BE-17` menu-snapshot call may ever read `restaurant_id` from. |
| `created_profile_draft_id` | `uuid references restaurant_profile_drafts(id)` (nullable) | Set exactly once, at the moment a staff member explicitly creates a new restaurant concept from this intake (see the coupling section below) — never overwritten, never set automatically. |
| `created_at` | `timestamptz not null default now()` | When this audit row itself was written (the first durable action), distinct from `fetched_at`. |

No status column. No decision/review vocabulary. No `pending`/`approved`/
`rejected` value of any kind exists on this table — there is nothing here
for a second workflow to move through.

## Data minimisation

**No raw HTML, no full JSON-LD payload, no PDF, and no full source
document is ever stored by this contract, at any point.** This matches
`docs/api/import-run-schema.md`'s own "extraction against an allowlist,
not capture of the full response" default, applied here even more
narrowly, since this path never even reaches durable storage until a
human has already decided to act.

**What may be retained, and where**: exactly the same, already-existing
allowlists this project already uses one layer up — never a new, wider
field list invented for this contract:

- **Selected restaurant-candidate fields** — `name`/`category`/`address`/
  `phone`/`website` only, the identical fixed set
  `restaurant_profile_draft_field_facts.field_name` already enforces.
  These live on that table, as facts with `origin = 'url_intake'` (see
  `docs/api/restaurant-profile-drafts-schema.md`'s matching amendment) —
  **not** duplicated onto `url_intakes` itself, so there is exactly one
  place a restaurant concept's field values ever live.
- **Selected menu-candidate summaries** — see "Limited, normalized
  retention of selected menu candidates" below. Never the full
  `captured_content` shape `BE-17`'s `menu_snapshot_proposals` itself
  uses — only enough to let a staff member resume without re-fetching.
- **Source references** — `source_url`/`source_hostname`/`fetched_at` on
  `url_intakes` itself, exactly as listed above.

Anything outside these allowlists — including any field
`docs/api/source-registry-schema.md`'s `basic_info` exclusion list
already names (owner/staff names, personal contact details, likely home
addresses) — is never extracted into a durable record by this contract,
the same standing exclusion every other intake path in this project
already honors.

## Coupling to `restaurant_profile_drafts` — two real foreign keys, one symmetric check

**Never a polymorphic association.** `restaurant_profile_drafts.source_candidate_id`
is today a single, `not null` foreign key to `import_extraction_records(id)`.
This contract requires it to become **nullable**, paired with a new,
equally real, nullable `source_url_intake_id uuid references url_intakes(id)`,
with a new check ensuring **exactly one** of the two is ever set:

```
check ((source_candidate_id is null) <> (source_url_intake_id is null))
```

This is the same symmetric-check idiom this project already uses
elsewhere for "exactly one of two possible origins" (e.g.
`restaurant_profile_draft_field_facts`'s own
`check ((origin = 'import') = (source_enrichment_id is null))`, and
`import_runs`' `data_origin_source_id`/`access_provider_source_id` dual-
reference pattern) — never a bare discriminator column pointing at
different tables without its own foreign key, and never a single column
whose meaning depends on an untyped string tag.

**This is a real schema change to an already-shipped table, not a
cosmetic addition.** It requires, at minimum: widening the existing
partial unique index (`... where status = 'draft'`) to cover both origin
columns instead of only `source_candidate_id`, and a second code path in
`promote_candidate_to_profile_draft()` for the `source_url_intake_id`
case (which has no `import_runs` row to join through for `market_id` —
`url_intakes.market_id` is read directly instead). See
`docs/api/restaurant-profile-drafts-schema.md`'s own amendment section
for the authoritative statement of this change; it is recorded there,
not duplicated here, since it is a change to that table's own contract.

## Field-level provenance — extends the existing ledger, never a second one

`restaurant_profile_draft_field_facts.origin` gains a third value,
`'url_intake'`, alongside a new, equally nullable `source_url_intake_id`
column, extending the existing symmetric check to a three-way form
(exactly one of `source_enrichment_id`/`source_url_intake_id` set,
depending on `origin`; neither when `origin = 'import'`). No new ledger
table is introduced — the existing, already-tested, append-only
field-facts table is the only place a draft's field values, and their
origin, are ever recorded, regardless of which pipeline produced them.
See `docs/api/restaurant-profile-drafts-schema.md`'s matching amendment
for the authoritative column/check definitions.

## Hard boundary: a BE-17 menu snapshot proposal never references a concept

**This contract adds no column, foreign key, or relaxation of any kind to
`menu_snapshot_proposals` or `menu_snapshot_reviews`.** Both tables, and
`0011_be17_menu_snapshot_foundation.sql`, stay byte-for-byte unchanged.
`menu_snapshot_proposals.restaurant_id` remains a plain, unconstrained
`text` column — `src/lib/menuSnapshotProposals.js` already documents it
as accepting "any non-empty string," which means the database itself
cannot, and this contract does not attempt to make it, refuse a
`restaurant_profile_drafts` id or a `url_intakes` id at the schema level.

**The boundary is therefore enforced by construction, not by a new
constraint on an already-reviewed table**: a "create menu concept" action
is only ever offered, by whatever future UI/route implements it, once a
real, existing `data/restaurants.json` key is known — either because
`url_intakes.matched_restaurant_id` was already set to one (an existing
restaurant), or, for a brand-new restaurant concept, only once a separate,
not-yet-designed "concept → real restaurant record" step (explicitly out
of scope for this contract — see below) has produced one. **Until that
future step exists, a `url_intakes` row whose `restaurant_match_type` is
`'none'` may produce a `restaurant_profile_drafts` concept, and nothing
more** — no menu concept, no `BE-17` snapshot proposal, may ever be
created against it. This mirrors `be-18-onboarding-menu-via-url.md`'s own,
already-stated hard architecture agreement ("Onboarding Menu handles
exclusively menu content for an existing, already-trusted restaurant
record ... never restaurant identity, never a candidate, never a draft")
— this contract restates and extends that same boundary to
`url_intakes`/`restaurant_profile_drafts` specifically, it does not
relax it.

## Limited, normalized retention of selected menu candidates

To avoid forcing a staff member to re-paste and re-fetch the same URL
after a restaurant concept is eventually promoted, a `url_intakes` row
may carry a small, normalized summary of the menu contexts `BE-18`'s
existing read-url analysis already found on that page — **never** the
full `captured_content` shape `menu_snapshot_proposals` itself stores.
Illustrative shape only (not a migration): a bounded `jsonb` array, one
entry per menu context the staff member marked as worth keeping, each
entry limited to the same fields `BE-18`'s own preview already shows
(context label, category names, item names — never prices, allergens, or
full descriptions beyond what a preview already renders) plus the exact
menu-context slug `menuJsonLdExtraction.js` derived. This is a resumption
aid, not a second copy of proposal content — once a real restaurant
identity exists and a staff member acts on one of these remembered
candidates, the actual `BE-17` proposal is still created the normal way,
via the existing, unchanged `POST /api/internal/v1/menu-snapshots` call,
reading fresh `captured_content` from this stored summary rather than
from a re-fetch. Exact retention window/cleanup policy for a
`url_intakes` row whose menu candidates are never acted on is an open
question (see below), not decided by this contract.

## Explicit separation

- **From `MARKET-04` registered-source bulk import**: no `ImportRun`, no
  `Source`, no `SourceAuthorizationVersion` is created, read, or required
  by any action this contract describes — see "Governance exception"
  above.
- **From `MARKET-05A` internal candidate review**: a `url_intakes` row and
  anything it produces never appears in `/internal/import-inbox`'s
  candidate queue, and `import_candidate_reviews`/`import_candidate_enrichments`
  are never read or written by this contract.
- **From public/canonical data**: nothing here is ever read by
  `data/restaurants.json`, `data/menus.json`, `GET /api/restaurants`, or
  `GET /api/search` — those remain webapp routes, not a partner contract,
  unchanged by this document.
- **From a future partner API**: out of scope here, and structurally
  unreachable by design — a future external API (per
  `[[011-market-foundation-and-international-growth]]` §11 and
  `market-02b-menu-proposal-publication-contract.md`) would read only
  published, canonical snapshots (`MARKET-06`), never `url_intakes`,
  `restaurant_profile_drafts`, or `menu_snapshot_proposals` in any status.

## Restaurant promotion boundary — explicitly not designed here

Whether, and how, a `restaurant_profile_drafts` concept ever becomes a
real `data/restaurants.json` entry (or a future canonical restaurant
record) is **not designed, built, or implicitly promised by this
contract** — the same stance `docs/api/restaurant-profile-drafts-schema.md`'s
own "Relationship to a future Restaurant Onboarding" section already
takes for claim-triggered onboarding. This remains a separate, later,
explicitly-scoped ticket. Until it exists, a restaurant concept created
through this contract has no path to ever back a `BE-17` menu snapshot
proposal — see "Hard boundary" above.

## Open questions (technical implementation choices only)

- Exact retention window/cleanup for a `url_intakes` row whose stored
  menu-candidate summary (see above) is never acted on — not decided
  here.
- Whether `url_intakes` needs its own index beyond primary-key lookup
  (e.g. by `source_hostname`, to warn a staff member "this site was
  already analyzed") — a reasonable later addition, not required by this
  contract's own read pattern.
- Exact bounded size of the stored menu-candidate summary `jsonb` — a
  physical-layer decision for whoever implements the migration, not fixed
  here.

## Out of scope for this contract

- Any code, migration, RLS policy, or Supabase change of any kind.
- General same-host source discovery, PDF fetching/processing, OCR, or
  bulk/CSV intake of multiple URLs — all remain separate, later,
  explicitly-scoped tickets, per `be-18-onboarding-menu-via-url.md`'s own
  "Non-goals."
- Any change to `menu_snapshot_proposals`/`menu_snapshot_reviews` or
  `0011_be17_menu_snapshot_foundation.sql` — see "Hard boundary" above.
- Any change to `BE-18`'s current fase-1 functionality.
- Any new navigation, route, or UI.
- Construction of, or any claim that this project already has, an
  external partner-API layer.
- The "concept → real restaurant record" promotion mechanism — see
  "Restaurant promotion boundary" above.
- Automatic publication of any kind, and any single, combined
  "accept everything" action — restaurant-concept creation and each
  individual menu-concept proposal remain separate, explicit, human
  actions, exactly as `BE-17`/`MARKET-05C` already require of their own
  write paths.
