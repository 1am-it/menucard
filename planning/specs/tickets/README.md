# Ticket specs

This directory contains the executable breakdown of the dish-first migration,
one file per ticket. It complements the feature-level specs one level up
(`planning/specs/*.md`, which describe product behaviour) and the phase
overview in `planning/architecture/migration-plan.md` (which describes
sequencing and rationale).

Read `planning/CONTEXT.md` for the current ticket order before starting any
of these.

## Order

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
9. [be-05-restaurant-menu.md](./be-05-restaurant-menu.md)
10. [be-08-performance-cleanup.md](./be-08-performance-cleanup.md)

Do not start a ticket whose dependencies aren't done. Each ticket should be
independently reviewable and deployable where practical.
