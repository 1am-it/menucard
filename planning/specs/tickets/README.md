# Ticket specs

This directory contains the executable breakdown of three tracks: the
completed `BE-*` dish-first migration, the `PLATFORM-*` data-platform
track, and the proposed, not-yet-scheduled `MARKET-*` market-foundation
track. Each track has its own file per ticket. It complements the
feature-level specs one level up (`planning/specs/*.md`, which describe
product behaviour) and the phase overviews in
`planning/architecture/migration-plan.md` (`BE-*`),
`planning/architecture/platform-plan.md` (`PLATFORM-*`), and
`planning/architecture/market-data-foundation-plan.md` (`MARKET-*`).

Read `planning/CONTEXT.md` for the current ticket order before starting any
of these.

## BE-* order (done)

1. [be-02a-data-model-repair.md](./be-02a-data-model-repair.md) — done
2. [be-02b-server-side-search.md](./be-02b-server-side-search.md) — done
3. [be-02c-dish-ranking.md](./be-02c-dish-ranking.md) — done
4. [be-03-dish-search-results.md](./be-03-dish-search-results.md) — done
5. [theme-design-tokens.md](./theme-design-tokens.md) — done, implemented
   ahead of its originally listed position; see
   `planning/decisions/006-theme-token-system-implemented-early.md`
6. [be-06-filters-url-state.md](./be-06-filters-url-state.md) — done
7. [be-04-homepage-shift.md](./be-04-homepage-shift.md) — done; see
   `planning/decisions/007-homepage-shift.md`
8. [be-07-reservation-routing.md](./be-07-reservation-routing.md) — done
9. [be-05-restaurant-menu.md](./be-05-restaurant-menu.md) — done
10. [be-08-performance-cleanup.md](./be-08-performance-cleanup.md) — done
11. [be-09-consumer-ux-polish.md](./be-09-consumer-ux-polish.md) — done;
    small independent polish ticket added after this track was otherwise
    closed
12. [be-10-results-sort-card-hierarchy-mobile.md](./be-10-results-sort-card-hierarchy-mobile.md) — done;
    small independent polish ticket, same basis as `BE-09`
13. [be-11-public-menu-discovery-intent-aware-results.md](./be-11-public-menu-discovery-intent-aware-results.md) —
    not started, documentation/planning + static prototype only;
    **replaces the `Restaurants`/`Menukaarten` primary navigation with two
    permanent, text-only destinations — `Zoeken` (default, active for any
    search/filter/meal-type-driven view) and `Alle restaurants` (the
    deliberate browse route, active only there)** — see the ticket's own
    "Primary navigation" section. Search/browse results group one card
    per restaurant instead of one per menu type, with an intention-aware
    primary action that resolves an explicit meal-type or general search
    intent directly to the right existing menu route (or an honest,
    explicit choice among matches) — never a guess. Names, but does not
    design or build, a lightweight restaurant-summary data shape and a
    future address/buurt server-side search extension. `Daghap vandaag`
    explicitly out of scope — see the ticket's own dedicated section.
14. [be-12-dish-result-deep-link-scroll-highlight.md](./be-12-dish-result-deep-link-scroll-highlight.md) —
    not started, documentation/planning only; a small, independent
    extension of `BE-11`'s dish search results — a click on a specific
    dish result scrolls, focuses, and briefly highlights that exact item
    on its existing menu route, keeping the full menu visible. Validates
    the existing `dishId` against its own expected name and category
    before ever highlighting anything (verified against a real,
    12-way "friet" spread and a real 3-way identical-name duplicate in
    `data/menus.json`); never guesses among same-name matches, and falls
    back silently to the plain, unfiltered menu when validation fails.
    Extends `docs/api/dish-result-shape.md`'s existing `dishId`/`name`/
    `category` fields via new, additive `dish`/`name`/`cat`/`fromQuery`
    query parameters on `/menu/[id]` — `?q=`'s existing filter behavior
    is unchanged and unconditional. Also closes part of `BE-11` Fase 3's
    open "back to results" question for this specific entry point.
15. [be-13-remove-restaurant-name-only-dish-matches.md](./be-13-remove-restaurant-name-only-dish-matches.md) —
    not started, documentation/planning only; a small, independent
    amendment to `BE-02c`'s dish-search ranking contract — removes tier 4
    (a dish matching only because its restaurant's name contains the
    query) entirely and unconditionally from `Gerechten gevonden`.
    Verified against real data: `q=Bardot` today returns 111 dishes for
    restaurant 6 ("Brasserie Bardot"), of which 110 match only via
    restaurant name and just 1 ("Café Spécial") is a real content match —
    after this change, only the real match remains. Real dish-content
    matches (name/description/supplement/wine/tag) are never affected;
    `q=friet` and every other pure dish query are unchanged; restaurant-
    name search stays exactly where it already lives, in
    `restaurantIndex.js`, with no new coupling between the two modules.
    Explicitly does not attempt mixed, tokenized queries like `q=Bardot
    friet` (verified: already returns 0 results today, unchanged by this
    ticket) — that remains a distinct, later, separately-scoped ticket.
16. [be-14-fix-alle-restaurants-back-navigation.md](./be-14-fix-alle-restaurants-back-navigation.md) —
    not started, documentation/planning only; a small, independent
    navigation correction — the permanent `Alle restaurants` tab points at
    `/alle-restaurants`, but the homepage's `Bekijk alle restaurants` link
    and the back-links on `/restaurant/[id]`/`/menu/[id]` still point at
    the older `/restaurants`. Adopts the canonical hierarchy `Alle
    restaurants → Restaurant → Menukaart`: `app/page.js` and
    `RestaurantDetailView.js`'s links keep their exact visible text but
    now target `/alle-restaurants`; `/menu/[id]`'s back-link becomes an
    honest `← {restaurantnaam}` link to its own restaurant, its real
    structural parent. No herkomst-tracking, query parameter,
    `document.referrer`, or `sessionStorage` — a deliberately bounded,
    static fix, not context-aware routing. Should land before `BE-12`,
    which plans its own, separate, conditional back-to-search link on the
    same page.
17. [be-15-group-broad-dish-search-results.md](./be-15-group-broad-dish-search-results.md) —
    not started, documentation/planning only; proposes grouping a broad
    dish query's results (e.g. `q=kip`, verified: 11 dishes across 3
    restaurants and 7 restaurant+menu combinations today) by restaurant
    and menu instead of one flat card per dish, once a restaurant+menu's
    own match count passes a threshold. Preserves BE-12's exact-dish deep
    link unchanged; proposes reusing the existing `?q=`+`fromQuery`
    combination (already safe, already shipped) for a new "view all
    matches on this filtered menu, no highlight" action — no new query
    parameter. Names, but does not choose between, a client-side (no
    backend change) and a server-side aggregation option, and does not
    authorize any implementation.
18. [be-16-uniform-restaurant-grouped-dish-search-results.md](./be-16-uniform-restaurant-grouped-dish-search-results.md) —
    not started, documentation/planning only; revises `BE-15`'s delivered
    presentation rule so every restaurant with at least one matching
    dish always renders as one restaurant group (never a flat individual
    card), removing the old "4 or more matches" qualification threshold
    and the separate leftover-individual-dishes section entirely. Every
    menu subgroup always shows the same shape — name, full-sentence
    count, up to three example dishes, `+N meer` past three, one
    primary "view filtered menu" action — and each shown example is
    itself a secondary, exact BE-12 deep link, so a one-match restaurant
    keeps a precise path to its one dish. Reuses BE-15's server-side
    aggregation, restaurant-level pagination, and `lowCoverage`
    independence unchanged; the one deliberate BE-12 change is the
    highlight's visible duration (2750ms → 4000ms) — validation,
    scroll/focus, and `aria-live` are otherwise untouched.
19. [be-17-menu-proposal-snapshot-foundation.md](./be-17-menu-proposal-snapshot-foundation.md) —
    not started, documentation/planning only; a small, additive, internal
    Breda-only foundation for capturing a restaurant menu as a reviewable
    snapshot (source, hash, version, quality score) with a separate,
    append-only review-event history — deriving effective status from the
    latest review event rather than any mutable status column. Does not
    reuse `field_provenance` or `pending_changes` as the audit log (both
    have real mutation paths), does not promote anything to public menu
    data, and does not run the pilot itself — see the ticket's own
    "Relationship to `MARKET-02B`" and "Non-goals" sections.
20. [be-18-onboarding-menu-via-url.md](./be-18-onboarding-menu-via-url.md) —
    not started, documentation/planning only; fase 1 of a URL-driven
    replacement for BE-17's raw restaurant-ID/menu-context/JSON pilot
    input — the reviewer pastes only a menu URL, the app reads it,
    matches it to an existing restaurant (asking only on genuine
    ambiguity), distinguishes separate menu contexts (e.g. Lunch/Diner)
    from categories within one card, and creates one BE-17 proposal per
    confirmed menu via the existing, unchanged creation route. HTML with
    JSON-LD menu data only in this fase; PDF sources and batch/CSV intake
    of multiple URLs are explicitly later, separate tickets.

## PLATFORM-* order (not started)

See [[008-platform-track-scope]] for why this is a separate track. Wave
order is read-only first, modeling/architecture second, internal write path
third, external-facing contribution flows last.

1. [platform-01-coverage-baseline-dashboard.md](./platform-01-coverage-baseline-dashboard.md) — done
2. [platform-02-low-coverage-transparency-ux.md](./platform-02-low-coverage-transparency-ux.md) — done
3. [platform-03-provenance-trust-data-model.md](./platform-03-provenance-trust-data-model.md) — done
4. [platform-04-persistence-api-architecture-decision.md](./platform-04-persistence-api-architecture-decision.md) — done
5. [platform-05-internal-api-foundation.md](./platform-05-internal-api-foundation.md) — done
6. [platform-06-moderation-review-queue.md](./platform-06-moderation-review-queue.md) — done
7. [platform-07-owner-claim-identity-verification.md](./platform-07-owner-claim-identity-verification.md) — done
8. [platform-08-community-microtask-contributions.md](./platform-08-community-microtask-contributions.md) — not started, deliberately skipped for now (see `planning/CONTEXT.md`)
9. [platform-09-city-rollout-operations.md](./platform-09-city-rollout-operations.md) — done, decision/documentation only (its only dependency, `PLATFORM-01`, was already done)
10. [platform-10-public-city-metrics-platform-exposure.md](./platform-10-public-city-metrics-platform-exposure.md)
11. [platform-11-role-aware-internal-navigation-home.md](./platform-11-role-aware-internal-navigation-home.md) — not started, documentation/planning only; a role-aware `/internal` home and shared navigation across the existing internal surfaces (Import Inbox, Restaurant Profile Drafts, Moderation/Owner claims, Coverage) — server-side authorization per route remains the real boundary, this only adds discoverability
13. [platform-08b-community-evidence-submissions.md](./platform-08b-community-evidence-submissions.md) —
    not started, documentation/planning only; **renamed 2026-09-13 from
    "Community Photo Evidence Submission"** — now one coherent plan for
    reporting a missing restaurant, a single targeted correction, and
    submitting an official menu link (the preferred, photo-free
    contribution: link out only, no preview/scrape/copy of any kind),
    with private photo evidence carried forward unchanged as a later,
    gated Fase 4 rather than the ticket's sole subject; no automatic
    publication in any phase, no new owner role (reuses `PLATFORM-07`'s
    existing/future claim flow), no new `pending_changes` field invented
    ad hoc — the name/address/phone/website correction gap and the
    menu-link record's shape are recorded as explicit open decisions; see
    the ticket's own "Data model needs" and "Open policy decisions"
    sections

## MARKET-* order (proposed, not scheduled — three tickets done as documentation, one contract documented but blocked)

See `planning/decisions/011-market-foundation-and-international-growth.md`
for why this is a third, separate track from `BE-*`/`PLATFORM-*`. Every
ticket here is documentation/schema-contract only until explicitly
otherwise approved — no code, migration, or Supabase change. `MARKET-04`
is documented and approved as a contract but deliberately **not** marked
done, unlike `MARKET-01`–`03` — its eventual deliverable is a working
import mechanism, not the documentation itself, and four hard gates block
implementation (see its own ticket).

1. [market-01-market-entity.md](./market-01-market-entity.md) — done, documentation/schema contract only; amended 2026-09-04 with a versioned `MarketBoundaryVersion` mechanism, see `docs/api/market-entity-schema.md`; Breda's first concrete version (`v1`) captured 2026-09-04 — see that document's "Registered version — actual instance" section
2. [market-02-canonical-restaurant-menu-schema.md](./market-02-canonical-restaurant-menu-schema.md) — done, documentation/schema contract only
3. [market-03-source-registry.md](./market-03-source-registry.md) — done, documentation/schema contract only
4. [market-04-raw-imports-import-runs.md](./market-04-raw-imports-import-runs.md) —
   contract documented and approved; no restaurant-data **import** has run
   and none is authorized to. **Update 2026-09-05: the mechanism now
   exists and is locally tested** (`ops/scripts/import-breda-osm.js` — see
   that ticket's own "Status" section). **Correction 2026-09-05 (later the
   same day): `--dry-run` was enabled and twice actually run** against the
   real Geofabrik endpoint and the real live Supabase project (read-only
   preflight only) — `netherlands-260904.osm.pbf`, 665 candidates after
   amenity+bbox pre-filter, 500 exactly inside Breda boundary v1, 165
   outside, 0 errors, and **still zero `ImportRun`s / extraction records,
   no database write, no data retained** — read-only-verified before and
   after both runs. `--live` was not used and remains refused. Of
   its four hard gates: **gate 1** (Breda boundary)
   **closed 2026-09-04** — a concrete `MarketBoundaryVersion` has been
   captured and recorded; **gate 2** (per-source authorization) satisfied
   per-source for Kadaster/PDOK, OpenStreetMap, and Geofabrik specifically
   — any other source still requires its own review; **gate 3** split
   into **3A** (internal OSM candidate register, **closed 2026-09-04**)
   and **3B** (OSM Collective/Derivative-Database legal assessment,
   **open**, blocking merge/publication/API/redistribution); **gate 4**
   split into **4A** (blobless Supabase/Postgres storage foundation,
   **closed 2026-09-04, completeness gap found and resolved 2026-09-05,
   now operationally complete** — the six-table schema and eight-record
   seed were live first; a gap (`import_runs` missing
   `source_artifact_hash`/`source_artifact_hash_algorithm`) was found
   afterward and fixed by
   `supabase/migrations/0006_market04a_import_runs_artifact_hash.sql`,
   which has since been **applied live and live-verified** — both
   columns exist, `not null`, and `service_role` cannot update either
   after insert; the design and prior live security verification
   remained valid throughout) and **4B** (encrypted raw-blob exception,
   **open**). Still **zero** `ImportRun`s executed — no OpenStreetMap,
   Geofabrik, or restaurant-data import has run — see the ticket's own
   "Hard gates" section for the full record.
5. [market-05-normalization-deduplication.md](./market-05-normalization-deduplication.md) —
   **first ticket content created 2026-09-05**, split into **`05A`**
   (data-inbox: internal, read-only candidate review, triggered by the
   two real 2026-09-05 Breda dry-runs) and **`05B`** (normalization &
   deduplication, the original scope, still not started/designed).
   **Update, later the same day: `05A` built** — `/internal/import-inbox`
   + `/api/internal/v1/import-inbox/{runs,candidates}` (see
   `docs/api/import-inbox-api.md`). `403`-denial for `owner`/`editor`
   live-verified against real accounts; the `internal`-role success path
   is not yet live-verifiable — no working `internal` account exists
   (its email-activation flow is still blocked on a manual Supabase
   email-template edit) and zero `ImportRun`s exist to browse yet.
   **Update (2026-09-06): a third sub-ticket, `05C` — Restaurant Profile
   Drafts — designed as documentation/schema contract only.** Explicit
   internal promotion of one already-`approved_internal` candidate into a
   durable draft, with field-level provenance back to import/enrichment,
   duplicate-promotion handling, `internal`-only access, and an audit
   trail — see `docs/api/restaurant-profile-drafts-schema.md`. Does not
   depend on or wait for `05B` (no cross-source merge is involved, so
   `MARKET-04` hard gate 3B does not apply). Corrects an earlier,
   imprecise equating of "Restaurant Profile Drafts" with `05B` itself —
   see the ticket file's own dated correction. No code, migration, or
   Supabase change made.
   **Update (2026-09-06, later still): `05C` built, not yet applied
   live.** Migration `0010`, both RPCs (`promote_candidate_to_profile_draft`,
   `discard_profile_draft`), `POST /api/internal/v1/profile-drafts`, and
   the "Create Restaurant Profile Draft" action on `/internal/import-inbox`
   now exist — locally validated end to end in a disposable Postgres
   container. `record_profile_draft_field_sync` and any discard UI/route
   are explicitly deferred, not part of this round — see the ticket
   file's own "Implementation" section for the full detail.
6. MARKET-06 — publication snapshots (not started)
7. MARKET-07 — market-scoped coverage metrics (not started)
8. MARKET-08 — minimal market-aware consumer read path (not started; mandatory before any second market can launch — see `planning/architecture/market-data-foundation-plan.md`)
9. MARKET-09 — full snapshot/CDN-optimized publication layer (not started; optional later scale step)
10. [market-10-shareable-links.md](./market-10-shareable-links.md) — not
    started; blocked on `MARKET-02`, `MARKET-06`, `MARKET-08`, the existing
    trust model, and an undecided URL/metadata strategy — see the ticket's
    own "Dependencies" section
11. [market-11-import-batch-operations-scalable-review-queue.md](./market-11-import-batch-operations-scalable-review-queue.md) —
    not started; an operational-scale extension of `05A`/`05C` (Wave 2),
    not a new wave — cursor pagination, real server-side filtering, batch
    context, and safe (never bulk-promotion) bulk actions for large import
    batches. See the ticket's own "Depends on" and "Non-goals" sections.
12. [market-04b-controlled-csv-jsonl-intake.md](./market-04b-controlled-csv-jsonl-intake.md) —
    not started; a controlled, source-agnostic CSV/JSONL extension of
    `MARKET-04`/`04A`'s existing `ImportRun` contract and
    `ops/scripts/import-breda-osm.js`'s proven discipline (Wave 2), not a
    new import platform — same preflight/idempotency/dry-run/hard-cap
    pattern, reusing `computePossibleDuplicateIds`/
    `candidateNormalization.js` unchanged. Blocked on registering a new
    source under `MARKET-03` first (Fase 0); no upload UI, connector
    platform, or new dependency in this phase — see the ticket's own
    "Non-goals" and "Open datamodelvragen" sections.
13. [market-02b-menu-proposal-publication-contract.md](./market-02b-menu-proposal-publication-contract.md) —
    not started; a second, separate schema contract extending `MARKET-02`
    (Wave 1), not a new wave — defines a writable, moderatable
    `MenuProposal` model and a canonical menu-publication layer for
    complete, structured menus (sections/items/prices/allergens), closing
    the gap that today's scalar `pending_changes`/`field_provenance` and
    `restaurant_profile_drafts` contracts cannot carry a whole menu.
    Contract/documentation only — no migration, route, UI, or
    `data/menus.json` change; independent of `MARKET-05B` (unrelated,
    still blocked) and does not gate `MARKET-04B`/`PLATFORM-08B`'s own
    current-phase scope, though both eventually need this contract before
    they can carry menu content specifically — see the ticket's own
    "Relationship to `MARKET-05B`" and "Suggested order" sections.

Do not start a ticket whose dependencies aren't done. Each ticket should be
independently reviewable and deployable where practical. The three tracks
do not block each other.
