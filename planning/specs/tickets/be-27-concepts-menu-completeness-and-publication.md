# BE-27 — Concepten, menukaartvolledigheid en publicatie (v1)

## Status

Documentation only. Recorded 2026-10-10 under
`planning/decisions/016-publication-path.md`. Nothing is built. Depends
on BE-26 (active sources).

## Voortgang

BE-27 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt — made together with this
  text; checked in the next status update
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md`.

## Goal

Data from an active source becomes an internal concept. A staff member
sees only what needs a human, and publishes business data per field and
a menu only as one complete version, through decision 016's reviewed
export.

## Depends on

- BE-26 (active source per kind, stored result, evidence, hash).
- BE-17 menu snapshot proposals and reviews (0011).
- `pending_changes` and `field_provenance` (0001, 0002) and
  `docs/api/data-trust-model.md`, "Amendment (2026-10-10, decision 016)".
- `docs/api/source-registry-schema.md`, "Amendment (2026-10-10, decision
  016)" (v1 fields).
- BE-22 (nothing recognised is not evidence of absence).

## Concepts (no fetch, no public change)

Concepts are prepared only as a direct result of a human activation
(BE-26), never on a schedule.

- **Business data** (`bedrijfsgegevens` source): each v1 field (name,
  visiting address, general phone, website URL, reservation link) that
  differs from the current value becomes a `pending_changes` row with
  `source: imported` and a reference to job, source URL and content hash.
  Opening hours are not filled in v1.
- **Menu** (`menukaart` source): the stored result becomes one BE-17
  snapshot proposal (next `version`, its `content_hash`), compared with
  the last approved version: new, changed and disappeared dishes.
- **Identical content is never re-raised.** A menu whose `content_hash`
  equals an already rejected or already approved version, or a field
  value a human already rejected, creates no new concept and no new
  attention point; it is visible only in the audit trail.

## Attention points and blockers

- **Attention point:** something a human must decide on a menu version —
  a dish without a price, a dish without a category, a dish that could
  not be linked, a dish that disappeared since the last approved version.
- **Blocker:** anything that stops publication — an unresolved attention
  point; a business value that conflicts with an `owner`- or
  `editor`-verified value; a value that may be personal data; a source
  block on the active source.
- **Default view:** only attention points and blockers. Normal changes
  are summarised as counts (new, changed, disappeared) with the full list
  and audit one step away, never as one row each in a work queue.
- A rejection records a fixed reason (BE-17's reasons, including
  `duplicate_snapshot`) and stays in the audit trail.

## Publication (decision 016)

- **Business data:** an `internal` staff member publishes all safe,
  conflict-free field changes with one action, "Publiceer {n}
  wijzigingen". Each field publishes on its own; published values are
  recorded in `field_provenance` with `source: editor`, `verifiedAt` and
  `verifiedBy`.
- **Menu:** "Publiceer volledige menukaart" is available only when every
  recognised dish has a price and a category, every attention point is
  resolved and every disappeared dish is explicitly confirmed as removed.
  No percentage threshold. Until then the previous approved menu stays
  live, unchanged.
- **Export:** a publication produces a deterministic export of the
  changed entries into `data/restaurants.json` / `data/menus.json` as a
  pull request for review. Merging it is the publication; nothing merges
  automatically. Each published menu version records its export, pull
  request and publication time.
- **Rollback:** a published menu version can be rolled back to the
  previous approved version through the same export path.
- **Source blocks never erase:** a blocked or failed active source never
  overwrites or removes live data.

## Data and routes (input for the build)

- One additive migration (number assigned at build time): extend the
  `pending_changes`/`field_provenance` field lists with the v1 fields;
  a menu-publication record per published version (version, export,
  pull request, time, actor). RLS and privileges per the 0015 pattern.
- Reuses the existing internal routes for menu snapshots and moderation
  where possible; any new route is `internal` only, actor from the
  session, `editor`/`owner` refused.
- The export mechanism (script or workflow, who opens the pull request)
  is decided in the readiness review; it never merges automatically and
  needs no change to the consumer read path.

## Non-goals

Automatic publication; a live database read for consumers (`MARKET-09`);
`SYNC-0` or periodic synchronisation; opening hours; external sources;
OCR/AI; per-dish trust labels.

## Acceptance criteria

- [ ] Concepts are created only from an active source's stored result,
      without a fetch and without a public change.
- [ ] Identical rejected or approved content creates no new concept or
      attention point.
- [ ] The default view shows only attention points and blockers.
- [ ] A menu cannot be published unless the completeness rule holds;
      the previous version stays live until a complete one is merged.
- [ ] Business fields publish per field with one human action; conflicts
      and possible personal data block.
- [ ] Every publication is an export pull request; nothing merges
      automatically; rollback to the previous menu version works.
- [ ] A source block never changes live data.

## Time estimate (decision 015)

Large: migration, concept builder, completeness check, review views,
export. Split into blocks; estimate and report each before starting it.
