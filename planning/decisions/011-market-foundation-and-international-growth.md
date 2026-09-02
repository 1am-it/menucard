# Decision — Market Foundation and International Growth Principles

## Status

Accepted (principles and terminology). The data architecture described here
is an accepted **future foundation** — nothing in this decision is built
yet, and nothing here changes current application behaviour. See "What
this decision does not do" below.

## Context

MenuCard's mission (`CLAUDE.md`) already acknowledges evolution "toward a
multi-city horeca data platform," and `planning/architecture/platform-plan.md`
/ `planning/specs/platform-city-rollout.md` already talk about a second
city in Breda-shaped terms. Neither has settled a neutral vocabulary for
expansion beyond another city, nor how a future canonical dataset would
relate to the consumer-facing static data path. `planning/decisions/010-platform-persistence-and-api.md`
explicitly named this as "a separate, larger question this decision
deliberately does not answer" when it scoped Supabase to `PLATFORM-*`'s
write-capable data only. This decision answers that question **at the
principle level** — it does not implement it.

## Decision

### 1. Terminology — accepted now, applies to all future product/technical writing

- **Market** (technical) / **marktgebied** or **launch market** (product
  and operational language) — the neutral unit MenuCard expands into.
  Identified by a stable `market_id`. A market can be a city first, later a
  region or a country — the concept does not assume city-sized forever.
- **Stad** (city) / **regio** (region) — the terms shown in the **visitor
  UI**. Visitors never see "market" or "markt" — that word stays internal
  and operational.
- **Verzorgingsgebied** / *catchment area* / *trade area* — reserved
  **exclusively** for a single restaurant's own customer draw radius.
  Never used for a market.
- **Bezorggebied** — reserved **exclusively** for delivery coverage. Never
  conflated with a verzorgingsgebied or a market.
- **Marktsegment** — reserved **exclusively** for target-audience/demographic
  segments (e.g. "fine dining," "budget lunch"). Never used to mean a
  geographic market.

These four concepts are semantically distinct and must not be used
interchangeably in code, data, documentation, or UI copy going forward.
Existing docs that say "city" for what is really the market concept (e.g.
`planning/specs/platform-city-rollout.md`) are not wrong today — Breda
*is* the first market, and it *is* a city — but new writing should use
"market"/`market_id` for the neutral technical concept and reserve "stad"
for what visitors actually see.

### 2. Market entity — accepted shape, not yet built

**Correction (2026-09-01):** an earlier version of this section treated
"launch status" as one merged vocabulary that conflated an operational
state with a `PLATFORM-09` readiness outcome. Those are two independent
fields — a market can be operationally `live` while its readiness outcome
is honestly `conditional_go`, and the two must never be collapsed into one
value that implies "live" also means "fully ready." See
`docs/api/market-entity-schema.md` (`MARKET-01`) for the full contract.

Every market has, at minimum:

- a stable, immutable technical `id`
- a separate, human-readable `slug` (used in routes/UI, e.g. `breda`) and
  `name` (display name) — both can change over time without changing `id`
- a geographic boundary (**amended 2026-09-04** — versioned via
  `MarketBoundaryVersion`, see `docs/api/market-entity-schema.md`; the
  concrete representation per version is chosen per version, still not
  fixed globally — see Open questions; a *valid* boundary version is a
  hard precondition for automated imports, market-level deduplication,
  coverage metrics, or any new market launch — not merely a nice-to-have
  field)
- a country code
- a timezone
- a default currency
- a set of supported languages
- `launch_status` — the market's own operational state:
  `draft` → `seeding` → `live` → `paused`
- `readiness_status` — the `PLATFORM-09` outcome, evaluated independently:
  `go` / `conditional_go` / `no_go`, per
  `[[012-city-market-readiness-thresholds]]`

**Resolved (2026-09-01), corrected**: the vocabularies above are fixed as
two separate fields, not one — see `docs/api/market-entity-schema.md` for
Breda's own reference values, including its honest current
`readiness_status`.

### 3. Hybrid data architecture — accepted direction, future foundation

Two layers, not one:

- **Canonical/operational dataset** — the source of truth for import,
  management, provenance, and review. Extends the per-field provenance
  concept already built in `docs/api/data-trust-model.md` and
  `PLATFORM-05`/`06`/`07`'s propose → review → apply pattern from a single
  field to a full canonical restaurant/menu record, per market.
- **Published snapshots** — versioned, per-market, generated *from* the
  canonical dataset only after review. This is what a future consumer app
  would read — never the canonical/operational store directly. Each
  snapshot carries a market, a version, a publication date, and a
  changelog, so a bad publish can be rolled back and the consumer
  experience stays light, cacheable, and fast (the same performance
  values `planning/decisions/003-performance-budget.md` already commits
  to, applied to a future data source rather than today's static files).

### 4. What this decision does not do

**The current static consumer read path (`data/restaurants.json`,
`data/menus.json`) is unchanged and is not being replaced by this
decision.** It does not migrate it, does not schedule its migration, and
does not contradict or rewrite
`planning/decisions/010-platform-persistence-and-api.md` — it answers the
question that decision explicitly deferred, at the principle level only.
Two separate, future, not-decided/not-scheduled/not-started steps are
named in `planning/architecture/market-data-foundation-plan.md`:
`MARKET-08` (a minimal market-aware consumer read path — mandatory
*before* any second market can launch, since today's app has no market
dimension at all, but not itself tied to the snapshot mechanism) and
`MARKET-09` (cutting the consumer app over to read from published
snapshots — an optional later scaling step, not required just to launch a
second market).

### 5. Governance — proposals only, never direct publication

Users, owners, and community members never mutate canonical or published
data directly. They submit **proposals**. The existing trust/claim/
moderation flow (`PLATFORM-03` provenance model, `PLATFORM-06` moderation
queue, `PLATFORM-07` owner claims) reviews them — this is the same flow,
generalized to a canonical record, not a new one. Only after review does a
controlled publication step produce a new snapshot version. This is a
direct extension of the `pending_changes` / `restaurant_claims` pattern
already live today.

### 6. Data acquisition — completeness before popularity, bias against invisibility

- Acquisition starts from a **complete candidate list** within a market's
  geographic boundary. Inclusion is never popularity-gated.
- Popularity may only affect the **order** of enrichment and review — never
  whether a restaurant is included at all.
- Unknown, independent, new, local, and underrepresented restaurants
  receive deliberate extra attention in both acquisition and quality
  strategy — a stated counterweight to the natural bias of
  popularity-first data collection.
- **Paid visibility must never buy placement in neutral/organic search
  results.** This extends `CLAUDE.md`'s existing "real menu data over
  visual decoration" ethos into a hard rule for the platform era: any
  future monetization stays structurally separate from neutral
  ranking/search logic.

### 7. Source governance

Every imported record must track: source, licence/usage right, import
date, republish/reuse permission, and freshness. **No unauthorized
scraping of search-engine results pages.** (Scraping a restaurant's own
public website for its own menu, as already practised — see the
`source`/`scraped` fields in today's `data/menus.json` — is a different,
already-established practice and is not what this prohibits.)

### 8. AI's role — assistant, never sole source of truth

AI may read, extract, translate, structure, and propose menu data. AI may
**never** publish independently as a source of truth — every AI-assisted
extraction is itself a proposal, subject to the same review flow as any
human-submitted one. Exactly how an AI-originated proposal is tagged
against `docs/api/data-trust-model.md`'s existing `source` enum (`owner` /
`community` / `editor` / `imported` / `unknown`) is an **open question**,
not decided here — see Open questions.

### 9. Risk-sensitive data

Allergens, diet claims, price, opening hours, and availability are
risk-sensitive. Their display must always show provenance and freshness —
extending the honesty principle `BE-02a`/`docs/api/dish-result-shape.md`
already established for allergens ("`allergens: []` does not mean
confirmed allergen-free") into a general rule across all risk-sensitive
fields. No medical guarantees. Appropriate warnings where relevant.

### 10. Data separation

Public data (meant for publication), private business data (e.g. claim
evidence, owner contact details), and personal data (accounts, emails)
remain strictly separated. This extends the role/RLS separation already
built (`editor`/`owner`/`internal`) but does not, by itself, define which
specific fields belong to which category — that classification exercise
is future work, not decided here.

### 11. Future public API

A future public API is a **published, attributed data layer** for
visitors, horeca, local partners, and integrations — built from snapshots,
never direct access to internal operational or private data. This extends
`planning/specs/platform-api.md`'s existing internal/external boundary
(already decided in `PLATFORM-04`/`010`): the internal API stays what it
is today; an eventual external API is a snapshot-backed, attributed
surface, not a relaxation of internal access.

## Naming this as a track

This work does not extend `PLATFORM-*` (which is Breda-scoped, static-data
era) or `BE-*`. It is proposed as a new, separate, **not-yet-scheduled**
track named `MARKET-*` — see
`planning/architecture/market-data-foundation-plan.md` — following the
exact precedent `[[008-platform-track-scope]]` set when `PLATFORM-*` was
introduced alongside `BE-*`: a structurally different kind of work gets a
visibly different track, not a number appended to a familiar one.

## Open questions (explicitly not decided here)

- The concrete representation of a market's geographic boundary per
  version (polygon, postal-code list, named administrative region — the
  vocabulary is now fixed by `docs/api/market-entity-schema.md`'s
  `MARKET-04`-gate amendment; which one Breda's actual first version uses,
  and from what reviewed data source, is still not chosen).
- The concrete canonical schema (tables/fields for the operational
  dataset) — `MARKET-02`'s job, not this decision's.
- The concrete snapshot storage/format (files, database table, CDN-hosted
  export — not chosen).
- How an AI-originated proposal is tagged against the existing `source`
  enum (reuse `imported`, or add a new value — not decided).
- The concrete data-classification taxonomy for the public/private-business/
  personal separation (which fields go where — not enumerated).
- Any concrete second-market candidate or timeline — business/legal,
  explicitly out of scope here as it was for `PLATFORM-09`.
- Snapshot publishing cadence/triggers (manual per review, batched,
  continuous — not chosen).
- Multi-currency/localization handling beyond storing a market's default
  currency (real-time FX, display formatting — not addressed).

## Rejected alternative

Fold this directly into `PLATFORM-*` as later-numbered tickets (e.g.
`PLATFORM-11`+).

Reason: `PLATFORM-*` was scoped, from `[[008-platform-track-scope]]`
onward, around Breda's existing static data and Supabase's write-capable
addition to it. Market-scoped canonical data + publishable snapshots is a
different kind of architecture change, with its own risk profile — the
same reasoning that separated `PLATFORM-*` from `BE-*` applies again here.
