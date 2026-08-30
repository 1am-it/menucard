# Breda Coverage Baseline — August 30, 2026

This is a recorded, dated snapshot of MenuCard's Breda data coverage. It
exists so future progress can be measured against a fixed reference point,
the same way `docs/changelog/README.md`'s release log gives the `BE-*` track
one. See `planning/specs/tickets/platform-01-coverage-baseline-dashboard.md`
(`PLATFORM-01`) for the ticket this snapshot belongs to, and
`app/internal/coverage` for the live, always-current version of these same
numbers.

**Snapshot date: August 30, 2026.** The numbers below are a point-in-time
measurement, not a live figure — they will not update as the underlying data
changes. Check the live dashboard for the current state.

## Headline finding: menu data covers 16% of restaurants

**Only 4 of Breda's 25 restaurants (16%) have any digitized menu data** in
`data/menus.json`, the dataset MenuCard's dish search actually queries. The
other 21 restaurants — 84% of the directory — have no menu items anywhere in
the current data, not even in an older, unused copy. In plain terms: today,
dish search can only ever find dishes from 4 restaurants, no matter how good
search itself gets. This is the single most important number in this
snapshot, and the clearest argument for why closing this gap should be a
priority before investing further in search/discovery polish.

## Full metric breakdown

| Metric | Result | What it means |
|---|---|---|
| Restaurants with basic info (name, address, hours, cuisine) | **100%** (25 / 25) | Every restaurant has the basics filled in. |
| Restaurants with any digitized menu data | **16%** (4 / 25) | See headline finding above. |
| Menu items with a price (numeric or explicit "price on request") | **96.5%** (354 / 367) | Of the items that exist (all within those 4 restaurants), price data is nearly complete. 13 items have neither, a small residual gap. |
| Restaurants with a confirmed reservation method | **0%** (0 / 25) | Not one restaurant's reservation method is currently marked verified. Every reservation CTA in the app today (`BE-07`) is running on the honest "unverified, show all plausible options" fallback path, not a confirmed single method. |

## Neighbourhood (buurt) breakdown

Only groups with 3 or more restaurants get a percentage — smaller groups show
a raw count instead, since a percentage of 1 or 2 restaurants isn't
meaningful.

| Buurt | Restaurants | With menu data | Coverage |
|---|---|---|---|
| Binnenstad | 16 | 2 | 12.5% |
| Brabantpark | 2 | 0 | too few restaurants for a % |
| Wolfslaar | 1 | 1 | too few restaurants for a % |
| Princenhage | 1 | 0 | too few restaurants for a % |
| Heusdenhout | 1 | 0 | too few restaurants for a % |
| Mastbos | 1 | 0 | too few restaurants for a % |
| Blauwe Kei | 1 | 0 | too few restaurants for a % |
| Valkenberg | 1 | 1 | too few restaurants for a % |
| Station | 1 | 0 | too few restaurants for a % |

Binnenstad, with 16 of Breda's 25 restaurants, is the only neighbourhood
large enough to draw a real conclusion from — and even there, menu-data
coverage is just 12.5%.

## Cuisine breakdown — a data-quality note, not just a result

The current `cuisine` field turns out to be a near-unique, free-text
description per restaurant (e.g. "Modern Frans", "Baskisch · Grill",
"Zuid-Afrikaans · Frans Creatief") rather than a shared category a group of
restaurants would fall into. Across 25 restaurants there are 24 distinct
values. That means a cuisine-level breakdown, as originally imagined (e.g.
"Italian restaurants are behind"), isn't meaningfully computable from today's
data — almost every group has exactly one restaurant in it. This is worth
recording plainly rather than forcing a misleading grouping: a normalized
cuisine-category field (grouping "Frans · Fine Dining" and "Franse Brasserie
· Wijnbar" both under "Frans", for instance) would need to exist before a
cuisine-level coverage breakdown could say anything real.

## What this baseline does and doesn't tell us

- It measures **data presence**, not verified accuracy — a restaurant
  counted as having "basic info" has non-empty fields, not fields
  independently confirmed to be correct. The per-field trust model
  (`PLATFORM-03`) doesn't exist yet; once it does, these numbers should be
  recomputed against verified data, not just present data.
- It reflects Breda only. There is no second-city data to compare against
  yet.
- It's a snapshot, not a trend — this is the first measurement, so there's
  nothing yet to compare it to. The next dated snapshot will be the first
  point where actual progress becomes visible.
