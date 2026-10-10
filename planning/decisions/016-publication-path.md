# Decision — Publication path for source-derived data (v1)

## Status

Accepted (2026-10-10, product owner). Documentation only: nothing is
built. Implemented by BE-26 (source activation) and BE-27 (concepts,
menu completeness and publication).

## Context

BE-24 records source proposals and BE-25 confirms high-certainty batch
results as accepted BE-24 proposals, but nothing connects an accepted
source to visible data. Approved data today ends inside the database:
`pending_changes` approval only updates `field_provenance` (0002), and a
BE-17 menu snapshot proposal ends at `approved_internal` (0011). The
consumer site reads only the static `data/restaurants.json` and
`data/menus.json`. Decision 010 left the consumer path open; decision 011
names published snapshots as a later step (`MARKET-09`, not scheduled)
and requires "proposals only, never direct publication" (§5).

This decision fixes the minimal v1 path from a found source to public
data, without a live database read for consumers.

## Decision

1. **The consumer path stays static in v1.** The public site keeps
   reading `data/restaurants.json` and `data/menus.json`. Approved changes
   reach those files only through a controlled export that produces a
   reviewed pull request. Merging that pull request is the publication.
   A live database path for consumers stays out of scope until
   `MARKET-09`. This answers decision 010's open consumer-path question
   for v1 only and does not change decision 011.
2. **Four separate steps, never merged:**
   - *Find* — BE-20/BE-25 analysis, bounded as in
     `docs/api/url-intake-schema.md`.
   - *Activate* — a human confirms a source (an accepted BE-24 proposal)
     and it becomes the restaurant's active source of one kind. No public
     data changes (BE-26).
   - *Concept* — data from the already stored analysis result becomes an
     internal concept: business data as `pending_changes`, a menu as a
     BE-17 snapshot proposal (BE-27). This happens only as a direct
     result of the human activation, never on a schedule, so every step
     towards a proposal stays an explicit human action
     (`url-intake-schema.md`, BE-25 amendment).
   - *Publish* — a human action, then the reviewed export pull request
     (BE-27).
3. **Business data never publishes automatically.** An authorised
   `internal` user publishes safe, conflict-free basic data with one
   action, "Publiceer {n} wijzigingen". Each field publishes on its own;
   a conflict is a blocker, not a silent overwrite.
4. **A menu publishes only as one complete, coherent version.** There is
   no percentage threshold. A version is publishable only when every
   recognised dish has a price and a category, every attention point is
   resolved, and every dish that disappeared since the last approved
   version is explicitly confirmed as removed. Otherwise the previous
   approved menu stays live, unchanged.
5. **Rollback.** Every published menu version can be rolled back to the
   previous approved version through the same reviewed export path.
6. **Blocks never erase.** A source block (`Robots geblokkeerd`, an
   unreachable source, a failed analysis) never overwrites or removes
   existing live data.
7. **Rejected identical content does not return.** Content that a human
   already rejected (same menu `content_hash`, or same field and value)
   is never raised again as a new attention point; it stays visible in
   the audit trail only.
8. **Out of v1:** opening hours from a website source (a reservation page
   is at most recorded as a source link), automatic publication of
   anything, `SYNC-0` and any periodic synchronisation, external sources,
   OCR/AI and broad crawling.

## Consequences

- `url-intake-schema.md`, `source-registry-schema.md` and
  `data-trust-model.md` each carry a dated amendment for this decision.
- A future `SYNC-0` is not blocked: an active source keeps its URL, last
  check and content hash, menu versions are immutable, and identical
  content is deduplicated by hash. `SYNC-0` still needs its own
  governance amendment (BE-25 B1 forbids scheduled acquisition) and an
  infrastructure decision.
- The export mechanism (script or workflow, who opens the pull request)
  is a BE-27 build decision; it must never merge automatically.
