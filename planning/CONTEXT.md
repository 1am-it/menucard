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
BE-09 — Consumer UX polish: contact validity, calmer filters, nav
consistency, a11y (done — see
`planning/specs/tickets/be-09-consumer-ux-polish.md`)
BE-10 — Results sort placement, filter/results boundary, card hierarchy,
mobile overflow (done — see
`planning/specs/tickets/be-10-results-sort-card-hierarchy-mobile.md`)

BE-09 and BE-10 were added after this track was otherwise considered
closed — small, independent polish tickets against the already-shipped
consumer app, not a reopening of the original migration sequence.

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
bar on two metrics). **Correction (2026-09-04)**: its geographic
`boundary` was originally documented as not yet defined — a real gap at
the time, not a placeholder — and has since been partially closed:
`docs/api/market-entity-schema.md` was amended with a versioned
`MarketBoundaryVersion` mechanism and now settles that Breda's boundary
is Gemeente Breda's administrative/municipal boundary (the semantic
question). No concrete boundary version — geometry, reviewed data
source, representation type — had actually been recorded for Breda at
that point, so this remained an open, narrower gap, not a placeholder
either. **Update (2026-09-04, later the same day): no longer open** — a
concrete `MarketBoundaryVersion` (`v1`) has since been captured for real
via a controlled, guarded live download from the registered Kadaster/PDOK
source (`ops/scripts/capture-market-boundary.js`), closing `MARKET-04`'s
hard gate 1 for Breda. See `docs/api/market-entity-schema.md`'s
"Registered version — actual instance" section and
`market-data/CONTEXT.md`. This is a geographic boundary capture only —
not a restaurant/menu import — and does not touch
`data/restaurants.json`/`data/menus.json`. No database, Supabase,
migration, storage choice beyond the small repo-committed manifest/
GeoJSON pair, market selector, or second market.

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

MARKET-03 — Source registry, usage rights, and data minimisation (done,
documentation/schema contract only). See
`docs/api/source-registry-schema.md`: a four-value `Source.status`
vocabulary (`pending_review` mandatory initial state → `allowed`/
`restricted`/`blocked`), with `allowed`/`restricted` structurally requiring
`terms_reference`, `reviewed_by`, `reviewed_at`, and `status_reason` — a
source is never `allowed` merely because its data is publicly visible.
`allowed_access_method`'s enum structurally excludes scraping third-party
search-results pages (no such value exists, not a per-row exclusion).
Licence/reuse rights and technical access channel are tracked as separate
fields (`reuse_rights` vs. `allowed_access_method`/`access_provider_note`),
so a permissive data licence is never read as blanket permission for any
fetch method. A narrowly-scoped `basic_info` data category permits only
name/visiting-address/general-phone/general-contact-address/website/
reservation-link, with a standing exclusion of owner/staff names, personal
contact details, and likely home addresses (a particular sole-proprietorship
risk) — "publicly visible" is documented as never implying "freely
reusable." `MARKET-02`'s `SourceReference.source_id` is amended to require
a registered `Source` (at minimum `pending_review`), never a bare URL.
Breda's own existing restaurant websites are registered `pending_review`,
not retroactively `allowed` — no informal past use counts as a review that
never happened. Four candidate pilot sources were researched, none
selected: OpenStreetMap (strong for a complete, non-popularity-driven
candidate list; ODbL licence and access-provider policy — extract vs.
public Overpass instance — reviewed as separate questions); KVK Open
Dataset Basis Bedrijfsgegevens (proposed `restricted` enrichment-only
candidate, explicitly not the primary list, since its BV/NV-only coverage
is a completeness risk specifically for small/independent restaurants);
individual restaurant websites (per-site `pending_review`, the existing
informal enrichment layer, no blanket licence); Gemeente Breda open data
(no specific dataset could be confirmed to exist — not yet a candidate).
No code, migration, Supabase change, or restaurant data imported.

MARKET-04 — Raw imports & import runs (contract documented and approved;
the import mechanism itself is not run for real — see
`docs/api/import-run-schema.md`. **Update 2026-09-05: the import tool
now exists** — `ops/scripts/import-breda-osm.js` and its config/tests,
locally tested against fakes and one synthetic `.osm` fixture via the
real, pinned GDAL container, tightened preflight (exact source/SAV ids,
exact `restricted` status, `basic_info`, `open_dataset_download`, Breda's
exact market scope, `raw_import`), an artifact-hash-inclusive idempotency
key, and a strictly-bounded Geofabrik redirect rule. **Correction
2026-09-05 (later the same day): `--dry-run` was subsequently enabled
and, twice, actually run** against the real Geofabrik endpoint and the
real live Supabase project (read-only preflight only) —
`netherlands-260904.osm.pbf`, hash
`0241c8e5269a5cd8c0f19162bec0b419b4b6db12136b443b5feb783705378c0a`; 665
candidates after amenity+bbox pre-filter, 500 exactly inside Breda
boundary v1, 165 outside, 0 errors. **Still zero `ImportRun`s, zero
`import_extraction_records`, no database write, no restaurant data
retained anywhere** — read-only-verified before and after both runs;
the downloaded file and all working files were deleted afterward. `--live`
was not used and remains refused. Gate 3B stays legally blocked, gate 4B
stays fully open, and node-only remains a first-pass scope decision (the
500/665 figures are node-based candidates only), not a completeness
claim. **Addition (2026-09-05, later the same day): a mandatory
`maxRecordsToStore` storage cap has been added to the tool.** Every
`runImport()` call (`--fixture`, `--dry-run`, or `--live`) now requires an
explicit, positive-integer `maxRecordsToStore`, enforced both where
extraction records are built and again immediately before any database
write, so a run can never store more candidates than explicitly
requested; the CLI requires a matching `--max-records-to-store=<n>` flag
for every mode. This does not change the existing Breda-boundary check
or source/licence guardrails — see `ops/scripts/import-breda-osm.js` and
its test suite. **Correction (2026-09-05, still the same day): the
"`--live` was not used and remains refused"/"still zero `ImportRun`s"
claims two sentences above are no longer accurate.** One real, limited
`ImportRun` has since executed — `--live --confirm-market=breda
--max-records-to-store=10`, run id
`01a07237-1867-760e-a714-50675078d3a1`, 10 stored candidates (the
requested cap), all independently re-verified inside Breda's real
boundary, 0 outside, no canonical/public table touched (none exists yet
for this data). **Also built the same day, on top of this run: the
MARKET-05A candidate review workflow** — an append-only
`import_candidate_reviews` audit log (`needs_enrichment`/
`approved_internal`/`rejected`/`deferred`; `approved_internal` means
ready for internal enrichment only, never public/MenuCard), its
`record_import_candidate_review()` RPC, two API routes, and a detail
view on `/internal/import-inbox` — migration written and locally
validated in a disposable Postgres container, **not yet applied to the
live Supabase project**. See
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-05, later the same day) — candidate review
workflow" section for the full detail. See
`planning/specs/tickets/market-04-raw-imports-import-runs.md`'s
own "Status" section for the full record). Blocked on four hard gates, tracked
independently: **gate 1** (Breda boundary) closed 2026-09-04 — see the
`MARKET-01` entry above. **Gate 2** (per-source `SourceAuthorizationVersion`)
satisfied per-source for Kadaster/PDOK, OpenStreetMap, and Geofabrik —
any other source still needs its own review. **Gate 3** split into 3A
(internal OSM candidate register, closed 2026-09-04 — two `restricted`
`SourceAuthorizationVersion`s registered, scoped to
`raw_import`/`internal_quality_review`/`moderation_preparation` only) and
3B (OSM Collective-vs-Derivative-Database legal assessment — open,
blocking `canonical_merge`/`public_publication`/`api_exposure`/
`redistribution`). **Gate 4** split into 4A and 4B. **4A closed
2026-09-04; completeness gap found and resolved 2026-09-05, now
operationally complete (see below)**:
`supabase/migrations/0004_market04a_import_foundation.sql`
(six tables — `markets`, `sources`, `source_authorization_versions`,
`market_boundary_versions`, `import_runs`, `import_extraction_records` —
UUIDv7 ids, composite foreign keys enforcing source+authorization-version
and market+boundary-version pairs, RLS with zero `anon`/`authenticated`
policies, column-scoped `import_runs` update grant) and
`0005_market04a_import_foundation_seed.sql` (the eight already-decided
records: Breda market, Breda boundary `v1`, and the three sources with
their authorization versions) were locally validated in a disposable,
digest-pinned PostgreSQL container, then **applied live to the actual
Supabase project**. Live-verified: exact record counts and values match
the committed documentation; `import_runs`/`import_extraction_records`
are empty; `anon`, a roleless `authenticated` session, a real existing
`owner` account, and a real existing `editor` account each get
`permission denied` on all six tables; RLS-active, `service_role`'s read
access, its inability to delete anything, and its `import_runs`
column-scoped update grant were all manually confirmed live.
`internal` was not separately tested — no real `internal`-role account
exists — noted as low-risk since every logged-in account shares the same
`authenticated` database role and these tables carry no distinguishing
policy. **No `ImportRun` has executed** — no OpenStreetMap, Geofabrik, or
restaurant-data import has run; this is a storage foundation only. **4B**
(encrypted, unredacted raw-blob exception) remains fully open, untouched.

**Correction (2026-09-05)**: preparing the first real OSM/Geofabrik
import script surfaced a gap in the 4A schema — `import_runs` never got
`source_artifact_hash`/`source_artifact_hash_algorithm` (only
`market_boundary_versions` did), so an `ImportRun` could not yet prove
which exact upstream file it processed. The design and the live
security/access-control verification recorded above **remained valid
throughout and were not retracted**; this was a completeness gap, not
an error in what was verified. Fix: `supabase/migrations/0006_market04a_import_runs_artifact_hash.sql`,
written and locally validated (same disposable-Postgres method as
`0004`/`0005`).

**Resolved (2026-09-05)**: `0006` has since been applied live to the
actual Supabase project and manually confirmed live: `import_runs` now
has both `source_artifact_hash` and `source_artifact_hash_algorithm`,
each `text`, each `not null`; `service_role` cannot update either
column after insert. `import_runs`/`import_extraction_records` remain
empty — **zero `ImportRun`s have executed** (no OpenStreetMap,
Geofabrik, or restaurant-data import has run). Gate **4A is now
operationally complete**. 3B remains legally blocked and 4B remains
fully open, both unchanged. See `docs/api/import-run-schema.md`'s
matching "Amendment (2026-09-05): import_runs completeness fix"
section. Next: building the first internal Breda OSM/Geofabrik import
script, as a separate, explicitly-approved step.

MARKET-05 — Normalization & deduplication. **First ticket content
created 2026-09-05** — see
`planning/specs/tickets/market-05-normalization-deduplication.md`,
split into **`05A`** (data-inbox: internal, read-only candidate review)
and **`05B`** (normalization & deduplication, the original scope, still
not started/designed). `05A` was prepared directly on the strength
of the two successful, write-free Breda dry-runs recorded in the
`MARKET-04` entry above (665 candidates after amenity/bbox pre-filter,
500 exactly inside Breda boundary v1) — it is a read-only window onto
`MARKET-04`'s `ImportRun`/`ImportExtractionRecord` tables, explicitly
separate from `PLATFORM-06`'s existing moderation queue (which reviews
`pending_changes` against live data, not raw import candidates) and from
`05B`'s eventual real matching/deduplication logic.

**Update (2026-09-05, later the same day): `05A` built.**
`/internal/import-inbox` + `/api/internal/v1/import-inbox/{runs,candidates}`
(`internal`-only; see `docs/api/import-inbox-api.md` for the full
contract) now exist, with `src/lib/importInbox.js`'s pure decision logic
(role check, run-summary shaping, computed read-only quality/
possible-duplicate hints, filtering, empty-state classification) fully
unit-tested. Live-verified against the real Supabase project, reusing
real existing `owner`/`editor` accounts (no new account/session/role
created): unauthenticated → `401`; `owner`/`editor` → `403`. **Not yet
live-verifiable**: the `internal`-role success path — no working
`internal` account exists (its email-activation flow,
`app/internal/activate/page.js`, still needs a manual Supabase
Reset-Password/Invite-user email-template edit before any real account
can complete it). No canonical merge, `pending_changes`, restaurant
record, public route, migration, or Supabase configuration change was
made for either `05A` or `05B` in this round.

**Correction (2026-09-05, still the same day): "zero `ImportRun`s exist
to browse" above is no longer accurate** — one real, limited `ImportRun`
now exists (see the `MARKET-04` entry above's own correction); once an
`internal` account exists, there is real data to browse.

**Update (2026-09-05, still the same day): `05A` extended with the
candidate review workflow.** Statuses `needs_enrichment`/
`approved_internal`/`rejected`/`deferred` (plus the never-stored default
`new`); `approved_internal` means ready for internal enrichment only —
never public publication, never a MenuCard. A separate, append-only
`import_candidate_reviews` table (`supabase/migrations/0007_market05a_candidate_reviews.sql`)
plus its `record_import_candidate_review()` RPC is the only way a
decision is ever written — always exactly one insert, never an update of
a previous decision, never a mutation of `import_extraction_records`
itself; locally validated (disposable Postgres container) that even
`service_role` gets `permission denied` on `UPDATE`/`DELETE` against
this table. Two new/extended API routes and a per-candidate detail view
(missing-fields line, review history, decision form) on
`/internal/import-inbox`. Automatic chain/franchise classification was
deliberately not built this round — deferred to a later, evidence-based
signal (OSM `brand`/`brand:wikidata` tags or an explicit manual marking),
never an inferred name-similarity guess. Full detail:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-05, later the same day) — candidate review
workflow" section. Still no canonical merge or public route.

**Correction (2026-09-05, still the same day): migration `0007` has
since been applied live**, manually, in the Supabase SQL Editor —
read-only re-verified afterward: `import_candidate_reviews` exists with
the intended columns; a live `UPDATE`/`DELETE` attempt as `service_role`
is refused (`permission denied`, code `42501`); the one real `ImportRun`
and its 10 candidates are unchanged; no canonical/public table exists.
The table holds zero rows — applying the migration recorded no review
decision, and the write path itself (`POST .../candidates/{id}/reviews`)
remains genuinely unexercised live.

**Update (2026-09-05, still the same day): a second, independent,
append-only audit log added for manual candidate enrichment.** Scope:
`address`/`phone`/`website` only, manual entry only — no scraping, no
automated website verification, no brand/chain classification, no
publication. `import_candidate_enrichments`
(`supabase/migrations/0008_market05a_candidate_enrichments.sql`) plus
its `record_candidate_enrichments()` RPC record
one or more field corrections atomically, always as new rows — a
correction never edits or removes a previous enrichment, and the raw
`import_extraction_records` row is never touched; locally validated
(disposable Postgres container, 0001–0008 applied in sequence) that even
`service_role` gets `permission denied` on `UPDATE`/`DELETE`. Candidate
`quality_status`/`missing_fields` are now computed from the raw fields
plus the latest, effective enrichment per field — a manually-sourced
value can move a candidate from incomplete to complete without the raw
record changing. **Deliberately, structurally independent of
`import_candidate_reviews`**: nothing in this feature reads a review's
free-text note to derive an enrichment — a reviewer who had previously
written, e.g., a phone number or website reference for **Do Spaces**
into a review note must deliberately re-enter it through this feature's
own form; enforced by dedicated structural tests, not just documented
intent. Recording an enrichment never sets a review's status to
`approved_internal`, and vice versa — the two remain fully independent
actions. Full detail:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-05, later still the same day) — candidate
enrichment layer" section. Still no canonical merge, public route, or
Supabase configuration change.

**Correction (2026-09-05, later still the same day): migration `0008`
has since been applied live**, manually, in the Supabase SQL Editor —
read-only re-verified afterward: `import_candidate_enrichments` exists
with the intended columns; a live `UPDATE`/`DELETE` attempt as
`service_role` is refused (`permission denied`, code `42501`); the one
real `ImportRun` and its 10 candidates are unchanged; no canonical/public
table exists. The table holds zero rows — applying the migration
recorded no enrichment, and the write path itself
(`POST .../candidates/{id}/enrichments`) remains genuinely unexercised
live. Separately noted during this same check, unrelated to `0008`:
`import_candidate_reviews` now holds 10 rows (one review decision per
existing candidate) — evidence a working `internal` session has
completed at least once, contrary to this document's earlier "no working
`internal` account exists yet" note; flagged here for visibility, not
otherwise investigated or acted on this round.

**Update (2026-09-06): centralized normalization + controlled website
suggestions built. No new migration** — both additions are purely
computational or a new, Supabase-read-only server action.
`src/lib/candidateNormalization.js` (new) provides conservative,
idempotent, never-guessing normalizers for `address` (whitespace +
Dutch-postcode-shape formatting only, no geocoding/lookup), `phone`
(Netherlands-focused: canonical `+31...` storage form + a readable
`"06 12345678"`-style Dutch display for mobile; other valid numbers
shown ungrouped since this project has no verified 2-digit-vs-3-digit
area-code table — a named, deliberate limitation), and `website`
(lowercases only scheme/host, leaves path/query/fragment byte-for-byte
untouched). `import_extraction_records`/`import_candidate_enrichments`
are entirely unaffected — normalization is a pure additional display
layer (`normalized_fields`/`normalization` on the candidates response),
with `quality_status`/`missing_fields` now computed from it.

Also built: a "Suggest data from website" feature — `internal`-only,
`POST .../candidates/{id}/suggest-from-website`, triggered only by an
explicit reviewer click, fetching only the candidate's own already-known
website (never a caller-supplied URL). **Never writes to Supabase** —
suggestions only pre-fill the existing enrichment form's draft; a human
must still confirm each field through the existing enrichments route.
Scoped to `address`/`phone`/`website` only (schema.org JSON-LD
preferred, `tel:`/`<address>` fallback — never menus, prices, photos, or
marketing copy). Hardened against SSRF
(`src/lib/safeOutboundFetch.js`, new): protocol allowlist, a guarded DNS
lookup rejecting private/loopback/link-local addresses on every request
*and* every redirect hop, bounded redirects/response size/timeout, no
cookies/session forwarding. Honors `robots.txt` as a self-imposed
product policy — explicitly never treated as a claim of legal
permission, in either direction. Not yet live-verified: tested
exclusively against local HTML/JSON-LD fixtures and a local test
server — no real website has ever been fetched. Full detail:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-06) — centralized normalization + controlled
website suggestions" section.

**Correction (2026-09-05):** the paragraph above was written before two
release-blocking gaps were closed in this same, still-uncommitted
feature. (1) The guarded-DNS-lookup description was incomplete: a
**literal** IP host in the URL bypassed it entirely, since Node never
invokes a custom `lookup` for a literal IP — fixed with a literal-IP
pre-check (`net.BlockList`, full IANA special-purpose ranges) in
`isSafeUrlShape`, covering every redirect hop too. (2) `robots.txt`
handling previously failed *open* — a failed `robots.txt` fetch was
treated as "no restriction declared" and the page was fetched anyway —
fixed to fail **closed** (`classifyRobotsGate` in
`src/lib/candidateSuggestions.js`), with redirects now disabled entirely
(`maxRedirects: 0`) on both the `robots.txt` fetch and the page fetch.
See the dated corrections in
`planning/specs/tickets/market-05-normalization-deduplication.md` and
`docs/api/import-inbox-api.md` for full detail.

**Further correction (2026-09-05):** "full IANA special-purpose ranges"
above was itself not yet accurate — the block list was still missing
several IANA-registered ranges (IPv4: AS112-v4, AMT, direct-delegation
AS112; IPv6: most `2001::/23` sub-ranges, the second NAT64 range, 6to4,
the second AS112 direct-delegation range, and the newer
documentation/SRv6 ranges). All now added to `buildDisallowedIpBlockList`
in `src/lib/safeOutboundFetch.js`, whose comment states the policy this
project applies: every IANA special-purpose range is disallowed as a
destination for this feature, even one that is technically globally
routable, re-diffed against the live registries rather than assumed to
stay complete forever.

**Update (2026-09-05): Data-inbox detail-view UX fixes, client-side
only.** Two usability gaps in the same, still-uncommitted feature: (1) a
new "Use this source URL as the website" button pre-fills only the
Website field's *value* from the reviewer's already-typed shared source
URL — pure form state, no fetch, no write; the suggest-from-website
button still only activates after that value is actually saved and the
candidate list reloads. (2) "Save decision" is now disabled until a
status is explicitly chosen, and a "Back to candidates" action was added
at the bottom of the expanded detail view (in addition to "Hide details"
above it) so closing a long card never requires scrolling back up —
closing was, and remains, a purely local state change with no API call.
No API response shape, security boundary, or write path changed. Full
detail: `planning/specs/tickets/market-05-normalization-deduplication.md`'s
own "Update (2026-09-05) — Data-inbox detail-view UX fixes" note.

**Update (2026-09-06): structured `deferred_reason` + enrichment-form
reflow.** A `deferred` review decision previously carried no structured
reason, only free-text `note`. New migration
`supabase/migrations/0009_market05a_candidate_reviews_deferred_reason.sql`
(**NOT YET APPLIED live**) adds a nullable, fixed-set `deferred_reason`
column, required exactly when `status = 'deferred'` — enforced via a
`NOT VALID` check constraint specifically because `import_candidate_reviews`
already holds 10 real, live rows (see this document's own 2026-09-05
notes above), so a normally-validated constraint could fail against a
pre-existing `deferred` row recorded before this column existed; `NOT
VALID` skips that one-time scan while still enforcing the rule on every
future insert — no backfill, no update, ever, of any existing row.
`record_import_candidate_review()`'s signature is extended from 5 to 6
arguments, with the old 5-argument overload explicitly dropped first (a
different argument list is a different function to Postgres — leaving
both would risk an ambiguous call). Locally validated in a fresh,
disposable, containerized PostgreSQL instance — including seeding a
synthetic pre-existing `deferred` row with no reason before applying
`0009`, to exactly reproduce the live scenario — never against the live
Supabase project; the migration remains unapplied there. `GET`/`POST
.../candidates/{id}/reviews` and the Data-inbox UI were extended to
match (a "Deferred reason" select shown only for status `Deferred`;
review history now shows it next to status, with a legacy row's `null`
value rendering as nothing extra, never an error). Separately, the
enrichment form was reflowed (client-only, no behavior change): the
shared source URL is now a distinct, labeled "1. Source" step above a
"2. Fields" section holding the three fields as compact, consistent
rows. 13 new tests in `src/lib/importInbox.test.js` (107 → 120). Full
detail: `planning/specs/tickets/market-05-normalization-deduplication.md`'s
own "Implementation (2026-09-06, later the same day) — structured
deferred reason + enrichment-form reflow" section and
`docs/api/import-inbox-api.md`'s matching "Addition (2026-09-06)" notes.

**Update (2026-09-06, later still the same day): read-only Triage
overview.** A new section on `/internal/import-inbox`, between "Import
runs" and "Candidates" — summary counts for the five effective review
statuses, a status/deferred-reason/name-address-website filter and
search (entirely client-side, no new query parameter), and a clear split
into the three buckets this round named: still-needs-enrichment,
deliberately-deferred (with its reason), and internally-approved-but-
only-ready-for-a-future-not-yet-built-canonical-step. No migration, no
write, no website fetch, and deliberately no chain/franchise
name-matching or automatic service-model classification — both stay
separate, later features. The existing detail view, append-only
history, normalization, and manual-enrichment flow are all completely
unchanged; a "View in list" action only expands and scrolls to a
candidate's existing card. `GET .../candidates` gains one additive field
(`deferred_reason`, reusing the same query the route already ran — no
second round trip). 27 new tests in `src/lib/importInbox.test.js`
(127 → 154). Full detail:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-06, later still the same day) — Triage
overview" section and `docs/api/import-inbox-api.md`'s matching
"Addition (2026-09-06, later still the same day)" note.

**Update (2026-09-06, later still the same day): presentation-only
redesign of `/internal/import-inbox` to match `docs/mockups/internal-candidate-triage-v1.png`.**
New `.di-*`-scoped CSS in `app/globals.css` plus a markup rewrite in
`app/internal/import-inbox/page.js` — status summary tiles with icons,
one labeled filter+search bar, redesigned candidate rows, short banners
in place of long paragraphs, and mobile breakpoints. No data, API,
filter/search-logic, or security-boundary change of any kind — every
pure function and test from the two rounds above stayed untouched, and
the full `src/lib/importInbox.test.js` suite (154 tests) still passes
unmodified. One real mobile CSS bug (a desktop `flex-basis` becoming a
height once the filter bar goes column-flex on narrow screens) was
found and fixed during manual visual verification against a disposable,
never-committed static-HTML preview of the same CSS classes — no live
`internal` session was created or used. Full detail:
`planning/specs/tickets/market-05-normalization-deduplication.md`'s own
"Implementation (2026-09-06, later still the same day) — presentation-only
redesign to match the mockup" section.
