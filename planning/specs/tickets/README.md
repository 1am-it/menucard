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
6. MARKET-06 — publication snapshots (not started)
7. MARKET-07 — market-scoped coverage metrics (not started)
8. MARKET-08 — minimal market-aware consumer read path (not started; mandatory before any second market can launch — see `planning/architecture/market-data-foundation-plan.md`)
9. MARKET-09 — full snapshot/CDN-optimized publication layer (not started; optional later scale step)
10. [market-10-shareable-links.md](./market-10-shareable-links.md) — not
    started; blocked on `MARKET-02`, `MARKET-06`, `MARKET-08`, the existing
    trust model, and an undecided URL/metadata strategy — see the ticket's
    own "Dependencies" section

Do not start a ticket whose dependencies aren't done. Each ticket should be
independently reviewable and deployable where practical. The three tracks
do not block each other.
