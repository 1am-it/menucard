# BE-02b — Server-side Search / Data Access Layer

## Depends on

BE-02a

## Goal

Stop shipping the full restaurants/menus dataset to the client. Introduce a
server-side query layer that returns only what the current view needs.

See [[004-server-side-search-before-restyle]] for why this must land before
BE-04/BE-05.

## Scope

- A query endpoint (route handler or server component) accepting a search
  query plus filters (per `planning/specs/search-and-filters.md`, e.g.
  `q`, `meal`, `maxPrice`) and returning a bounded, paginated result set in
  the BE-02a dish-result shape.
- Move the dataset itself (or the data-access call, if it stays as JSON
  files initially) behind this server boundary — no client component may
  `import` the full `restaurants.json`/`menus.json` directly anymore.
- Pagination/cursor support sufficient for a "Meer resultaten laden" pattern.

## Out of scope

- Ranking/relevance logic beyond basic filtering — that's BE-02c.
- Migrating to the Postgres/Supabase schema (`supabase/schema.sql`) — that's
  a valid future step but not required to satisfy this ticket; a
  server-side module wrapping the existing JSON is an acceptable first
  implementation as long as the client no longer receives the full dataset.
- Any new UI — BE-03 consumes this.

## Key risk

Building this before BE-02a is finished means building against a data shape
that's still changing. Don't parallelize.

## Acceptance criteria

- [ ] A search/query endpoint exists and returns only fields required for
      the current view.
- [ ] No page ships the full restaurants/menus dataset to the client.
- [ ] A typical search response stays within the project's performance
      budget (`planning/specs/performance.md`).
- [ ] Results are paginated or cursor-based — never "fetch everything".
