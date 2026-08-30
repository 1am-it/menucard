# Spec — Per-field Data Trust / Provenance Model

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

## Proposed shape (subject to refinement in PLATFORM-03's implementation)

Each trust-bearing field is accompanied by:

- `source` — one of: `owner`, `community`, `editor`, `imported`, `unknown`
- `confidence` — one of: `high`, `medium`, `low`
- `verifiedAt` — ISO date of last confirmation, nullable
- `verifiedBy` — reference to the confirming owner/editor/contribution,
  nullable

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

A freshness window (e.g. "confirmed >90 days ago becomes Stale") needs a
concrete value chosen during `PLATFORM-03` implementation, informed by how
often real menu data actually changes — not fixed in this spec.

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
