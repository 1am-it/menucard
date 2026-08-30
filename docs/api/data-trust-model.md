# Data Trust / Provenance Model

This is the concrete, implementable schema contract for `PLATFORM-03`, to be
built against by `PLATFORM-04` (persistence) and `PLATFORM-05` (internal API)
and consumed by `PLATFORM-06` (moderation) and any later consumer-facing
display. It is a documentation contract only — nothing in the current app
constructs or stores this shape yet. The product-level goal and rationale
live in [`planning/specs/platform-trust-model.md`](../../planning/specs/platform-trust-model.md);
this file defines the exact shape.

## Fields this applies to (initial set)

- Price
- Opening hours
- Reservation method (extends, does not replace, the existing
  `reservation.verified` boolean)
- Menu item availability
- Allergen/dietary tags

Other fields may gain provenance later; these five are the ones later
`PLATFORM-*` tickets need to build against first.

## Per-field provenance shape

Each trust-bearing field is accompanied by this record, stored alongside the
value (not fetched separately — see Requirements below):

| Field | Type | Notes |
|---|---|---|
| `source` | `'owner' \| 'community' \| 'editor' \| 'imported' \| 'unknown'` | Who last confirmed this value. `'unknown'` is for data with no traceable origin at all — distinct from `'imported'`, which means "we know it came from the original scrape." |
| `confidence` | `'high' \| 'medium' \| 'low'` | Derived from `source` via the mapping below, not set independently. |
| `verifiedAt` | ISO date string \| `null` | When `source` last confirmed this value. `null` for `'imported'`/`'unknown'`, which were never actively confirmed. |
| `verifiedBy` | string \| `null` | Reference to the confirming identity or contribution record. The exact reference shape (a user id, a claim id, a contribution id) is a `PLATFORM-04`/`05` persistence decision, not fixed here — this contract only requires that *some* traceable reference exists once persistence is built. |

## Status labels → shape mapping

| Status label | `source` | `confidence` | `verifiedAt` |
|---|---|---|---|
| **Owner verified** | `owner` | `high` | set |
| **Community confirmed** | `community` | `medium` | set |
| **Editor verified** | `editor` | `high` | set |
| **Imported** | `imported` | `low` | `null` |
| **Stale** | *(previous `source` retained)* | downgraded one tier from what it was | set, but older than the staleness window below |

`Stale` is a derived display state, not a distinct `source` value — it's
computed by checking `verifiedAt` against the staleness window for whatever
`source` was already recorded. A restaurant that was `owner`-verified 200
days ago still has `source: owner` in storage; it displays as `Stale`
because it's overdue for reconfirmation, not because its origin changed.

## Staleness window: a reasoned default, not an empirical one

**The staleness window is 90 days.**

This is a **reasoned default**, not a value derived from MenuCard's own
observed history. As of **August 30, 2026**, `data/menus.json` contains
exactly one `scraped` date per menu — every one of the 11 menus was scraped
once, within a single four-day window (2026-03-24 to 2026-03-28), and never
re-scraped or re-verified since. There is no repeated-observation history
anywhere in the current dataset, so there is no empirical basis to infer how
often a Breda restaurant's menu actually changes. 90 days is chosen as a
generic, defensible starting point for a quarterly-ish menu revision cadence
common in hospitality generally — it should be treated as a placeholder to
revisit once real re-verification history exists (after `PLATFORM-05` ships
and owners/editors start actually reconfirming data over time), not as a
finding.

**Open follow-up, not decided here**: a single global window may not fit
every restaurant equally — a seasonal fine-dining menu (e.g. Restaurant
Wolfslaar's Michelin-starred, seasonally-driven menu) plausibly changes on a
different cadence than a casual, fixed-menu establishment. Whether to tune
the window per restaurant type is left open for whoever implements the
staleness check.

## Legacy data gap: `reservation.verified`

`data/restaurants.json`'s existing `reservation.verified` field (introduced
in `BE-02a`, used by `BE-07`'s reservation routing) is a plain boolean. It
records *whether* a restaurant's reservation method was confirmed, but not
*who* confirmed it or *when* — there is no `verifiedBy` or `verifiedAt`
equivalent anywhere in the current data.

This means `reservation.verified: true` **cannot be losslessly mapped**
into the model above as-is. `PLATFORM-01`'s baseline found this is
currently moot in practice (0 of 25 restaurants have `verified: true`
today), but the gap is real and will matter the moment any restaurant is
verified before this model's persistence exists.

**This is an explicit open decision for `PLATFORM-05`, not resolved here.**
Options for whoever implements the backfill, none chosen:

- Treat any pre-existing `verified: true` restaurant as `source: editor`
  by convention, since no owner/community system predates it.
- Mark `verifiedAt`/`verifiedBy` as `null`/`'unknown'` and let the
  restaurant re-earn a real provenance record under the new model.
- Require fresh re-verification under `PLATFORM-05`/`07` rather than
  carrying forward any pre-model trust claim.

## Requirements

- **Never silently upgrade confidence.** A `community`-sourced correction
  does not become `owner`-level trust without actually going through the
  owner (`PLATFORM-07`) or editor (`PLATFORM-06`) path.
- **Consumer-facing display must degrade gracefully** for `unknown`/
  `imported` provenance — the same principle `BE-07`'s reservation fallback
  already established, not a new pattern.
- **No N+1 provenance fetches.** This record travels alongside the current
  value in whatever a page/API already returns for that field — a page must
  never issue a separate query per field just to learn its provenance.

## Out of scope for this contract

- The actual persistence/storage mechanism (`PLATFORM-04`).
- The UI for displaying any of these labels (each consuming ticket's own
  scope).
- Automated confidence decay/scoring beyond the simple staleness window
  above.
- Resolving either open item above (staleness calibration, legacy
  `reservation.verified` backfill) — both are documented gaps for later
  tickets, not decisions made by this contract.
