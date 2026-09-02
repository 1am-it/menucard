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

1. [market-01-market-entity.md](./market-01-market-entity.md) — done, documentation/schema contract only
2. [market-02-canonical-restaurant-menu-schema.md](./market-02-canonical-restaurant-menu-schema.md) — done, documentation/schema contract only
3. [market-03-source-registry.md](./market-03-source-registry.md) — done, documentation/schema contract only
4. [market-04-raw-imports-import-runs.md](./market-04-raw-imports-import-runs.md) —
   contract documented and approved, not started; blocked on four hard
   gates (Breda `market.boundary` amendment, per-source authorization,
   OpenStreetMap's separate Collective/Derivative-Database legal
   assessment, raw-storage technology) — see the ticket's own "Hard
   gates" section
5. MARKET-05 — normalization & deduplication (not started)
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
