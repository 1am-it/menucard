# Planning Context

This directory contains product requirements, architecture plans and durable
decisions for the BredaEats dish-first redesign.

Design references live under:

`docs/mockups/`

When a mockup is available, treat it as UX direction rather than a pixel-perfect
implementation requirement.

## Current direction

BredaEats should evolve from:

restaurant → menu → dish

toward:

search → dish → restaurant/menu → reservation

The existing application should be evolved, not rewritten.

## Desired user flow

1. User opens BredaEats.
2. User searches for a dish, ingredient or cuisine.
3. BredaEats shows matching dishes.
4. Each result shows:
   - dish name
   - price
   - restaurant
   - short description
   - relevant dietary tags
   - distance/open status when available
5. User opens the restaurant menu.
6. User reserves through the correct reservation method.

## Example

Search:

`steak`

Result:

Ribeye 300g — €34,50  
Con Fuego · Steakhouse  
Ribeye van de grill · chimichurri  
Rundvlees · Glutenvrij  
600 m · Nu open

Bekijk menu →

## Linear sequence (revised 2026-08-30 — THEME landed early)

BE-01 — Audit + migration plan (done)  
BE-02a — Data model repair (done)  
BE-02b — Server-side search / data access layer (done)  
BE-02c — Dish ranking and result mapping (done)  
BE-03 — Dish search results (done)  
THEME — Theme token system: light + dark, user-selectable (done — see
[[006-theme-token-system-implemented-early]])  
BE-06 — Price / cuisine / allergy filters + URL state (done)  
BE-04 — Text-first homepage (done — see [[007-homepage-shift]])  
BE-07 — Reservation routing (done)  
BE-05 — Lightweight restaurant menu (done)  
BE-08 — Performance cleanup (done — see [[007-homepage-shift]])

THEME was originally sequenced after BE-06/BE-04/BE-07/BE-05 (see
[[005-decouple-theming-from-dish-first]]) on the assumption it would mean a
one-way flip of already-restructured pages from dark to light. When actually
scoped, it turned out to be additive instead — a token layer plus both a
light and a dark palette plus a user toggle, applied to the existing,
structurally unchanged pages — so it was implemented ahead of schedule at
explicit user direction. See
[[006-theme-token-system-implemented-early]] for the full reasoning. The
remaining rationale below still governs BE-06 through BE-08.

Rationale for the remaining order: ship the primary dish-search experience
against a real server-side query layer (done), then refine (filters,
homepage, reservation routing, menu restyle). Server-side search (BE-02b) is
a hard prerequisite for BE-04 and BE-05 — see
[[004-server-side-search-before-restyle]].

Do not implement multiple tickets implicitly.

Each ticket should be independently reviewable and deployable where practical.

BE-04 and BE-05's restyling work should extend the token system THEME
introduced rather than reintroducing hardcoded colors. Use feature flags or
separate route variants where old and new flows coexist, rather than
branching behaviour on ad hoc state.

## Additional risks tracked alongside the migration

- **SEO/deeplinks** — once search results and filters move into URL state,
  existing indexable routes and shared links must be deliberately mapped, not
  silently replaced.
- **Data quality** — price-as-string, inconsistent tags/allergens, and missing
  reservation fields are likely to cost more time than the UI work itself.
  This is why BE-02a exists as its own ticket.
- **Ranking/relevance** — matching a query term is not sufficient; ordering
  exact dish-name matches against ingredient/tag/restaurant-name matches needs
  explicit rules (owned by BE-02c).
- **Fallbacks for incomplete data** — distance, open-status, dietary tags and
  reservation method must degrade gracefully when a restaurant is missing that
  field, not just when it's present.
- **Analytics/baseline** — capture a baseline (conversion, perceived speed)
  before the dish-first flow ships, or there will be no way to tell afterward
  whether it actually improved things.

## Parallel track: PLATFORM-*

A second, parallel ticket track (`PLATFORM-01` through `PLATFORM-10`) covers
MenuCard's evolution into a multi-city horeca data platform: city coverage
tracking, per-field data trust/provenance, persistence/API foundations,
moderation, owner claims and community contributions. See
`planning/architecture/platform-plan.md` for the full phase breakdown and
[[008-platform-track-scope]] for why this is scoped as a separate track
rather than folded into the `BE-*` sequence above.

PLATFORM-01 — Coverage baseline + read-only dashboard (done). Found that
only 16% of Breda restaurants (4/25) have any digitized menu data in the
canonical dataset, and 0% have a confirmed reservation method — see
`docs/coverage/breda-baseline-2026-08-30.md`.

PLATFORM-02 — Low-coverage transparency UX (done). `/search` now discloses,
in the existing empty-state, when a zero-result search is at least partly
explained by restaurants that match the query's filters but have no
digitized menu data yet — computed server-side, no new endpoint.

PLATFORM-03 — Provenance/trust data model (done, documentation only). Schema
finalized in `docs/api/data-trust-model.md`; `planning/specs/platform-trust-model.md`
stays the rationale layer. Staleness window (90 days) documented as a
reasoned default, not empirically derived — no repeated-observation history
exists. Legacy `reservation.verified` gap (no `verifiedBy`) documented as an
open decision for `PLATFORM-05`.

PLATFORM-04 — Persistence + internal/external API architecture decision
(done, decision only). Supabase for persistence, Supabase Auth for the
owner/editor/internal role model, internal API at `/api/internal/v1/...` —
see [[010-platform-persistence-and-api]]. Additive to the existing static
consumer read path, which is unchanged. No infrastructure created yet;
`PLATFORM-05` is the first implementation ticket.

PLATFORM-05 — Internal API foundation (done, live-verified). First real
write-capable code in the platform track: `field_provenance`/`staff_roles`
schema (`supabase/migrations/0001_field_provenance.sql`), a server-only
Supabase client, an auth/role guard, and `GET`/`POST /api/internal/v1/provenance`
— see `docs/api/internal-provenance-api.md`. `source`/`confidence`/
`verified_at`/`verified_by` are derived entirely server-side from the
caller's role, never from client input — confirmed live, including a
rejected attempt to smuggle these fields from the client. No public route,
no consumer-facing change, zero impact on the consumer performance budget
(server-only dependency). A missing `GRANT` for `service_role` was found
and fixed during live verification (`BYPASSRLS` skips RLS policies but not
Postgres's separate table-privilege system) — now part of the migration.
The remaining two open verification points — the `owner` role's
per-restaurant scope and the no-role-assigned `403` path — were closed in a
follow-up live round (2026-08-31) with a second test account: `owner`
correctly allowed within its own restaurant and blocked outside it on both
`GET`/`POST`, and an authenticated caller with no `staff_roles` row
correctly gets `403`. `PLATFORM-05` has no remaining unverified acceptance
criteria. Also documented, in [[010-platform-persistence-and-api]]: a
pre-existing, unrelated `supabase/schema.sql` predating this track was
found and left untouched — it is not the current direction.

PLATFORM-06 — Moderation/review queue (done, live-verified). Editor-only
`pending_changes` table (`supabase/migrations/0002_pending_changes.sql`),
separate from `field_provenance` — pending/approved/rejected state never
touches the current-value table until approval. Approve is atomic via a
`SECURITY INVOKER` Postgres RPC (`approve_pending_change`, `EXECUTE` revoked
from `PUBLIC`, granted only to `service_role`) that writes `field_provenance`
and flips the pending row's status in one transaction; reject only updates
`pending_changes` and never touches live data. `owner` and `internal` are
excluded from every RLS policy and route check — only `editor` can see or
act on the queue, confirmed live (owner gets `403` on both read and
approve). Minimal `/internal/login` + `/internal/moderation` UI reuses
Supabase Auth in the browser strictly for session/login
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`, categorically different from the
server-only service-role key) — see `docs/api/internal-moderation-api.md`
and `docs/guides/internal-api-live-testing.md` for how sessions were minted
for testing without needing test-account passwords. A live-verification
bug was found and fixed: rejecting an already-decided change returned `500`
instead of `404` (`.single()` on a zero-row `update()` throws rather than
returning empty) — corrected and re-verified. Live testing left six
`pending_changes` rows (ids 1–6, approved/rejected/pending) in place
deliberately, as a pre-launch verification audit trail — matching this
table's own permanent-record design. One fully synthetic
`field_provenance` test record it produced (restaurant 6, price) was
removed via a bounded `DELETE`, since it never held a real production value
and this table's own semantics call for holding only genuine current
values. As with `PLATFORM-05`, approving here only updates
`field_provenance` — the route to consumer-facing consumption remains the
open question documented in `planning/decisions/010-platform-persistence-and-api.md`.

PLATFORM-07 — Owner claim and identity verification (done, live-verified).
New `restaurant_claims` table (`supabase/migrations/0003_restaurant_claims.sql`),
separate from `pending_changes`/`field_provenance`. First API surface in
the project reachable by any authenticated user without a `staff_roles`
row (`/api/claims/...`) — kept strictly separate from the editor-only
`/api/internal/v1/claims/...` review side. `email`/`user_id` come only from
the verified session; `restaurantId` is validated server-side against
`data/restaurants.json`. Domain-match (claimant email domain vs. the
restaurant's website domain, both normalized) is advisory evidence shown
to the reviewer only — never an automatic gate; every claim, matched or
not, requires an explicit `editor` decision. A restaurant can end up with
more than one `owner` — the reviewer sees an existing-owner flag
(`hasExistingOwner`) and decides anyway; there is no automatic approval
path of any kind. Approve is atomic via `approve_restaurant_claim` (same
`SECURITY INVOKER`/fixed-`search_path`/`service_role`-only pattern as
`PLATFORM-06`), granting `owner` and marking the claim decided in one
transaction; reject never touches `staff_roles`. `internal` has no RLS
access to claims, matching `PLATFORM-06`'s corrected posture — only
`editor` reviews. This is the first ticket to require a real grant beyond
`PLATFORM-05`'s original assumption that `staff_roles` writes are always
manual — `docs/api/internal-provenance-api.md` is corrected accordingly:
manual bootstrap remains the only path for `editor`/`internal`, but
`owner` now also has this reviewed, automatic path.

**Live-verified**: a real magic-link callback (an admin-generated GoTrue
link, the same verification mechanism a genuinely emailed link uses) was
followed all the way through session recognition and a real claim
submission via an actual click in the `/claim/[restaurantId]` UI — not an
injected session. **Not verified**: actual email delivery of the magic
link through the UI's own send button — Supabase's project-wide email
send-rate-limit was hit during testing (confirmed, via a separate check,
to affect unrelated addresses too, so this is a shared-quota/environment
constraint, not a defect in the claim flow). Tracked as an external,
low-risk follow-up, not a blocker. Domain-match evidence, duplicate-claim
handling, unknown-restaurant validation, editor review, atomic approve
(including the granted role working immediately against `PLATFORM-05`'s
unmodified provenance endpoint), reject, double-decision protection on
both, and every authorization boundary (owner/no-role blocked from the
review routes) were all confirmed live. The synthetic owner role granted
during testing was revoked afterward via a bounded `DELETE`; the claim
records themselves and the synthetic test account were kept deliberately,
as a documented pre-launch verification audit trail — matching
`PLATFORM-06`'s precedent for `pending_changes`.

PLATFORM-09 — City rollout operations (done, decision/documentation only —
`PLATFORM-08` was deliberately skipped, not started). Concrete per-metric
readiness thresholds decided in
[[012-city-market-readiness-thresholds]], calibrated against Breda's real
`PLATFORM-01` baseline only — never against the synthetic Supabase test
data `PLATFORM-05`–`07` left in place. Explicit, deliberate finding: Breda
does not clear its own proposed bar on two of four metrics (menu-data
coverage, reservation confirmation) — stated plainly, not smoothed over.
Three outcome tiers (Go / Conditional go, reusing `PLATFORM-02`'s existing
low-coverage messaging / No-go), a launch-status vocabulary
(`prospective`→`seeding`→`conditional`→`live`→`paused`, resolving the item
`[[011-market-foundation-and-international-growth]]` left open), and the
operational process live in `docs/guides/city-rollout-playbook.md`. No
code, database, import tooling, or second market — and this decision
explicitly restates, not removes, that no second market can launch until
the mandatory `MARKET-*` foundation and market-aware consumer read path
(`planning/architecture/market-data-foundation-plan.md`) exist.

This track does not change, reorder, or depend on the `BE-*` sequence — both
can proceed independently. It follows the same discipline: one ticket per
commit, stop for approval after each, doc updates land in the same commit as
the ticket they describe.

## Future direction: market foundation (principles accepted, nothing built)

`planning/decisions/011-market-foundation-and-international-growth.md`
accepts the terminology and architecture principles for growing MenuCard
beyond Breda via a neutral `market_id` concept (a market can be a city
first, later a region or country), a future hybrid canonical-dataset +
published-snapshot data architecture, and governance rules (proposals
only, never direct mutation of published data; completeness before
popularity in acquisition; source/AI/risk-data governance). None of this
is built — the current static consumer read path is unchanged, and
`planning/decisions/010-platform-persistence-and-api.md` is not rewritten.
See `planning/architecture/market-data-foundation-plan.md` for the
proposed, not-yet-scheduled `MARKET-*` track this would require — a third,
separate track alongside `BE-*` and `PLATFORM-*`.

MARKET-01 — Market entity (done, documentation/schema contract only).
Defines the market entity per `[[011-market-foundation-and-international-growth]]`:
an immutable `id` separate from a mutable `slug`/`name`, geographic
boundary, country code, timezone, default currency, supported languages,
and — corrected during this ticket's own drafting, not merged as
originally drafted — two independent status fields, `launch_status`
(operational: `draft`/`seeding`/`live`/`paused`) and `readiness_status`
(the `PLATFORM-09` outcome: `go`/`conditional_go`/`no_go`). See
`docs/api/market-entity-schema.md`. Breda modeled as the first, retroactive
reference value: `launch_status: live`, `readiness_status: conditional_go`
(honestly — Breda does not clear its own `[[012-city-market-readiness-thresholds]]`
bar on two metrics) — its geographic `boundary` is explicitly documented
as not yet defined, a real gap, not a placeholder. No code, migration,
Supabase change, storage choice, market selector, or second market.

MARKET-02 — Canonical restaurant/menu schema (done, documentation/schema
contract only). See `docs/api/canonical-restaurant-menu-schema.md`:
canonical `Restaurant`/`Menu`/`MenuSection`/`MenuItem`/`SourceReference`/
`FieldAssertion` objects, distinct from both today's static JSON and the
future publication-snapshot shape. Four status concepts stay explicitly
separate — `market.launch_status`, `market.readiness_status`,
`restaurant.operational_status` (`open`/`temporarily_closed`/
`permanently_closed`/`unknown`, no bare `inactive`), and
`menu_item.availability.status`. `Money` defines four mutually-exclusive
pricing states (`known`/`multiple_undecomposed`/`on_request`/`unknown`)
with minor-units amounts and required-when-applicable ISO-4217 currency.
Allergens use an extensible `{scheme, code}` model with `EU-14` named as
the first, not universal, scheme. `FieldAssertion.field_path` addresses
sub-fields (e.g. `reservation.url`, `opening_hours.tuesday`) individually,
reusing `docs/api/data-trust-model.md`'s exact `trust_source`/`confidence`
vocabulary unchanged, for exactly the same five mandatory risk-sensitive
fields — neither expanded nor reduced. `source_references[]` are sets of
references to `SourceReference` identities, never copies. Breda's
retroactive mapping stays conservative: real gaps (13 genuinely
price-`unknown` items, no legacy `operational_status` at all) are recorded
as gaps, not filled with invented certainty. Whether `operational_status`
should join the five mandatory risk-sensitive fields remains an explicit,
undecided open question. No code, migration, Supabase change, storage
choice, market selector, or second market.
