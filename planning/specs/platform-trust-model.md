# Spec — Per-field Data Trust / Provenance Model

**Status (2026-08-30): the concrete schema is finalized.** This file
remains the product-level goal/rationale layer; the exact, implementable
shape lives in [`docs/api/data-trust-model.md`](../../docs/api/data-trust-model.md)
— read that file for the actual `source`/`confidence`/`verifiedAt`/
`verifiedBy` contract, the staleness window decision, and the documented
legacy `reservation.verified` gap. This split mirrors `BE-02a`'s
`planning/specs/dish-first-discovery.md` (why/what) vs.
`docs/api/dish-result-shape.md` (exact contract).

## Goal

Let MenuCard show not just *what* the data says, but *how sure* it is, at
the level of an individual field — not just per restaurant.

## Why per-field, not per-restaurant

A restaurant can have an owner-verified reservation method and a
three-week-stale, scraped price on the same menu item. A single
restaurant-level trust flag would hide that. This generalizes the pattern
already shipped in `data/restaurants.json`'s `reservation.verified` boolean
(see [[BE-07]] reservation routing) from one field to every field that can
carry independent provenance.

## Fields this applies to

At minimum: price, opening hours, reservation method (extending the existing
`reservation.verified` field rather than replacing it), menu item
availability, and allergen/dietary tags.

## Shape (finalized in PLATFORM-03 — see docs/api/data-trust-model.md)

Each trust-bearing field is accompanied by:

- `source` — one of: `owner`, `community`, `editor`, `imported`, `unknown`
- `confidence` — one of: `high`, `medium`, `low`
- `verifiedAt` — ISO date of last confirmation, nullable
- `verifiedBy` — reference to the confirming owner/editor/contribution,
  nullable (the exact reference shape is left to `PLATFORM-04`/`05`'s
  persistence design)

`docs/api/data-trust-model.md` also documents an explicit legacy gap: the
existing `reservation.verified` boolean has no `verifiedBy`/`verifiedAt`
equivalent and cannot be losslessly mapped into this shape as-is — an open
decision for `PLATFORM-05`, not resolved here.

## Status labels (consumer + internal display)

Matching the reference mockup (`outputs/menucard-data-playbook-mockups.html`):

- **Owner verified** — confirmed by the restaurant itself
- **Community confirmed** — confirmed by one or more contributors, not the
  owner
- **Editor verified** — confirmed by a trusted editor during moderation
  (`PLATFORM-06`)
- **Imported** — from the original scrape/import, unconfirmed since
- **Stale** — previously verified, past a to-be-defined freshness window

## Staleness

**Decided in `PLATFORM-03`, see `docs/api/data-trust-model.md`:** 90 days,
documented explicitly as a reasoned default rather than one derived from
MenuCard's own history — as of 2026-08-30, the current data has no
repeated-observation history to derive a real interval from. Whether this
should later be tuned per restaurant type is an open follow-up, not decided.

## Requirements

- Never silently upgrade confidence — a `community`-sourced correction does
  not become `owner`-level trust without going through the owner or editor
  path.
- Every consumer-facing display of a trust-bearing field must degrade
  gracefully when provenance is `unknown`/`imported` — same principle as the
  existing reservation-routing fallback behaviour, not a new pattern.
- This model must not require a page to fetch full provenance history to
  render current values — provenance is metadata alongside the current
  value, not a separate query per field.

## Out of scope for this spec

- The actual persistence/storage mechanism (`PLATFORM-04`).
- The UI for displaying trust labels in each specific surface (each
  consuming ticket's own scope).
- Automated confidence decay/scoring algorithms beyond the simple staleness
  window above.
