# Architecture — Market Data Foundation Plan (proposed, not scheduled)

**Status: proposed roadmap only. Nothing below is started, scheduled, or
approved as active work.** See
`planning/decisions/011-market-foundation-and-international-growth.md` for
the accepted principles this roadmap implements, and why it is a separate
`MARKET-*` track rather than an extension of `PLATFORM-*` or `BE-*`.

This document exists to answer one question concretely: *what would
actually need to be built before MenuCard could launch a genuine second
market?* It intentionally does not answer *when*, *which market*, or
*whether* — those are business decisions outside this document's scope,
exactly as `PLATFORM-09` explicitly excludes them.

## Relationship to existing tracks

- **`BE-*`** (done) and **`PLATFORM-01`–`07`** (done) are unaffected. The
  static consumer read path they built stays exactly as it is through
  Waves 1–3 below, until (and unless) `MARKET-08` is separately decided and
  approved — see Wave 4 for why some version of `MARKET-08` is not
  optional the way the rest of this roadmap is.
- **`PLATFORM-09`** (city rollout operations, proposed, not yet approved)
  remains a `PLATFORM-*` ticket about Breda-shaped thresholds and process —
  it is not renumbered or reinterpreted by this roadmap. Its own go/no-go
  framing is reused conceptually here (see `MARKET-01`'s launch-status
  vocabulary), not replaced.
- **`PLATFORM-10`** (public-facing metrics/exposure) and a future public
  API both depend on this roadmap's snapshot mechanism (`MARKET-06`)
  existing first if they are ever to expose more than one market.

## Wave 1 — Market dimension & canonical schema (modeling only)

### MARKET-01 — Market entity (done, documentation/schema contract only)

Defines and documents the `market` schema per
`[[011-market-foundation-and-international-growth]]`: an immutable
technical `id` separate from a mutable, readable `slug`/`name`, geographic
boundary, country code, timezone, default currency, supported languages,
and two independent status fields — `launch_status` (operational:
`draft`/`seeding`/`live`/`paused`) and `readiness_status` (the
`PLATFORM-09` outcome: `go`/`conditional_go`/`no_go`, never conflated with
`launch_status`). See `docs/api/market-entity-schema.md` for the full
contract and Breda's own retroactive reference values. A modeling ticket,
matching `PLATFORM-03`'s "defines the shape, not yet a live write path"
precedent — no live data, no migration. A valid geographic boundary
version is a documented hard precondition for `MARKET-04`/`05`
(automated imports, market-level deduplication) and `MARKET-07`
(coverage metrics) below, and for any new market launch. **Amended
2026-09-04**: the schema contract now defines a versioned
`MarketBoundaryVersion` mechanism and settles that Breda's boundary is
Gemeente Breda's administrative/municipal boundary — but no concrete
version (geometry, source, representation type) has been recorded for
Breda yet, so this precondition is narrowed, not yet satisfied — see the
schema contract's amendment section.

### MARKET-02 — Canonical restaurant/menu schema (done, documentation/schema contract only)

Defines the operational, source-of-truth schema for a restaurant and its
menu, distinct from both today's static JSON shape and the future
publication-snapshot shape. See
`docs/api/canonical-restaurant-menu-schema.md` for the full contract:
`Restaurant`/`Menu`/`MenuSection`/`MenuItem`/`SourceReference`/
`FieldAssertion`, an extensible `{scheme, code}` allergen model
(`EU-14` as the first, not universal, scheme), a `Money` structure in
minor units with four explicit non-overlapping pricing states, an
unambiguous `operational_status` vocabulary, `field_path`-based sub-field
provenance, and `source_references[]` as sets of references rather than
copies. Extends `docs/api/data-trust-model.md`'s exact per-field
provenance shape (not a replacement) and carries a `market_id` on every
market-bound record. Whether `operational_status` should join
`PLATFORM-03`'s five mandatory risk-sensitive fields is flagged as an open
question there, not decided by this ticket.

## Wave 2 — Import & sourcing infrastructure

### MARKET-03 — Source registry, usage rights, and data minimisation (done, documentation/schema contract only)

See `docs/api/source-registry-schema.md`: a four-value status vocabulary
(`pending_review` mandatory initial state → `allowed`/`restricted`/
`blocked`), with `allowed`/`restricted` structurally requiring terms
evidence, a reviewer, a date, and a reason — a source is never `allowed`
merely because its data is publicly visible. `allowed_access_method`'s
vocabulary structurally excludes scraping third-party search-results
pages (no such option exists, not a per-row exclusion). Licence and
technical access channel are tracked as separate questions. A narrowly
scoped `basic_info` data category permits only name/visiting-address/
general-phone/general-contact/website/reservation-link, with an explicit,
standing exclusion of any natural-person names or personal contact/home
address data. `MARKET-02`'s `SourceReference.source_id` is amended to
require a registered `Source`, never a bare URL. Breda's own existing
restaurant websites are registered `pending_review`, not retroactively
`allowed` — no informal past use counts as a review that never happened.
Four candidate pilot sources (OpenStreetMap, KVK Open Dataset, individual
restaurant websites, Gemeente Breda open data) were researched using
primary documentation — none selected; KVK's BV/NV-only coverage is
flagged as a completeness risk specifically for small/independent
restaurants, and Gemeente Breda's portal couldn't be confirmed to have a
relevant dataset at all. Implements
`[[011-market-foundation-and-international-growth]]`'s source-governance
principle concretely.

### MARKET-04 — Raw imports & import runs (contract documented, not started — blocked on hard gates)

A staging layer that preserves raw source data and records each import
run, before any normalization — so a bad normalization can be diagnosed or
replayed against the original source, not just the cleaned result. See
`docs/api/import-run-schema.md` for the full `ImportRun` contract and
`docs/api/source-registry-schema.md`'s amendment for the
`SourceAuthorizationVersion` model it depends on: `Source`'s regulated
fields (status, terms evidence, allowed/excluded categories, access
method, geographic applicability, reviewer, date, reason) become an
immutable, append-only version history, so a later source re-review can
never rewrite a past import's legitimacy — `ImportRun` references one
exact version, never a copy. Data minimisation is enforced *before*
durable storage as the default (allowlist extraction; a small structured
extraction record rather than full raw HTML for unstructured sources),
with a narrowly six-gated exception for retaining an unredacted capture.
Strict separation from `MARKET-05` normalization, moderation, and
`MARKET-06` publication is maintained throughout.

**Documented and approved as a contract — not implementation-ready.**
Four hard gates block any real run: (1) **narrowed 2026-09-04, not
closed** — `MARKET-01`'s `docs/api/market-entity-schema.md` now defines a
versioned `MarketBoundaryVersion` mechanism and settles that Breda's
boundary is Gemeente Breda's administrative/municipal boundary
(semantic decision), but no concrete version — geometry, reviewed data
source, representation type — has actually been recorded for Breda, so
`MARKET-04`/`05` still cannot execute for Breda until one is; (2) every
targeted source needs a `SourceAuthorizationVersion` with `status ∈
{allowed, restricted}`, checked at run time, no exceptions — this now
also applies to whatever source eventually supplies Breda's boundary
geometry, per the `MARKET-01` amendment's own recommendation to reuse
this same mechanism; (3) OpenStreetmap specifically requires a separate
legal assessment — Collective vs. Derivative Database under ODbL, given
`MARKET-05`'s own matching/merging design — before any pilot, in
addition to the ordinary licence/access-provider/route review; (4)
physical raw-storage technology and the encryption mechanism for the
unredacted-capture exception are not yet chosen. Pilot source research
(OpenStreetMap, KVK Open Dataset, Gemeente Breda open data, individual
restaurant websites) continued from `MARKET-03` — still no source
selected, none registered.

### MARKET-05 — Normalization & deduplication

Turns raw imports into canonical candidate records: matching and
deduplicating across sources (e.g. the same restaurant found via two
different imports). The completeness-before-popularity principle applies
here directly — every candidate in the market boundary gets a canonical
record, regardless of how thin its data is yet. Requires `MARKET-01`'s
geographic boundary to actually be defined for the market in question —
"in the market boundary" is not a meaningful test otherwise.

**Update (2026-09-06):** `planning/specs/tickets/market-05-normalization-deduplication.md`
has since split this into three sub-tickets, not described by this
document's original prose above: `05A` (internal candidate review, built),
`05B` (this section's original cross-source matching/dedup scope,
unchanged, still blocked on `MARKET-04` hard gate 3B), and a new `05C`
("Restaurant Profile Drafts" — explicit internal promotion of one
already-approved candidate into a durable draft; does not perform
cross-source matching and does not depend on or wait for `05B`; see
`docs/api/restaurant-profile-drafts-schema.md`). This document's own
prose is the original, still-accurate description of `05B` specifically —
it was never a description of `05C`, which did not exist when this was
written.

## Wave 3 — Publication

### MARKET-06 — Publication snapshots

The versioned, per-market export mechanism: version, publication date,
changelog, generated from canonical data only after review. This is the
first ticket that produces something a consumer-facing surface *could*
read — but nothing consumes it directly here. `MARKET-08`'s minimal
market-aware read path does not need this to exist first; `MARKET-09`'s
later, optional scale step is what actually wires the consumer app to
read from these snapshots.

### MARKET-07 — Market-scoped coverage metrics

Generalizes `PLATFORM-01`'s coverage dashboard (currently implicitly
Breda-only) to compute the same metrics per `market_id`, so `PLATFORM-09`'s
readiness thresholds (`[[012-city-market-readiness-thresholds]]`) become
mechanically repeatable — producing a market's `readiness_status` — rather
than a one-off script. Also requires `MARKET-01`'s geographic boundary to
be defined; "coverage within the market" is not computable without one.

## Wave 4 — Consumer cutover (mandatory minimum, then an optional scale step)

**Correction (2026-09-01):** an earlier version of this document claimed a
second market could launch without any consumer-read-path change, on "the
same static-JSON-per-market pattern Breda uses today." That was wrong.
Today's consumer app (`/`, `/search`, `/restaurant/[id]`, `/menu/[id]`) has
**no market dimension, no market selection, and no market-aware read path
at all** — it is hard-wired to a single, implicit Breda dataset. Even
serving a second market from separate static JSON files would still
require *something* in the consumer app that knows which market a given
visitor/request is for and loads that market's data accordingly. That
mechanism does not exist and is not optional. This document now splits
what was one hypothetical ticket into a mandatory minimum and a genuinely
optional later step.

### MARKET-08 — Minimal market-aware consumer read path (mandatory before a second market launches)

The smallest change that lets the consumer app serve more than one
market: some form of market selection (e.g. per-market routing or an
equivalent mechanism — not chosen here) plus market-scoped data loading,
so `/`, `/search`, `/restaurant/[id]`, `/menu/[id]` read the correct
market's data instead of an implicitly single dataset. This can still read
from simple per-market static data — it does **not** require
`MARKET-06`'s publication-snapshot mechanism to exist first, and it does
**not** replace or reinterpret Breda's current static read path, which
keeps working unchanged as the first market's data source under this same
mechanism. This is the "separate, larger question"
`[[010-platform-persistence-and-api]]` deferred, now named concretely and
scoped to its actual minimum — **not decided or scheduled here**, but no
longer optional the way the rest of this roadmap is: without it, a second
market has no way to be shown to anyone.

### MARKET-09 — Full snapshot/CDN-optimized publication layer (optional, later scale step)

Once `MARKET-06`'s versioned publication snapshots exist, wiring the
consumer app to read from them (instead of hand-maintained per-market
static files) is a genuine scaling optimization — worth doing once several
markets are live and keeping each one's static files in sync by hand
becomes the bottleneck, not before. Explicitly optional relative to
`MARKET-08`: a second market can launch and run correctly without this,
just with more manual per-market data maintenance than a snapshot-fed
version would need.

## Wave 5 — Shareable public surfaces

### MARKET-10 — Shareable menu, dish, and personal-selection links (proposed, not started)

Lets a visitor create a durable, no-account public link to a full menu
(with meal-moment context), a single dish, or a personal multi-dish
selection — not a cart, reservation system, review feature, or paid
placement. See `planning/specs/tickets/market-10-shareable-links.md` for
the full contract: durable/direct-open + factual-only + freshness
-disclosure principles; allergen/diet labels gated on trust-model
confidence; Web Share API with copy-link fallback; strict data
minimisation (no personal, private-business, or internal
provenance/moderation data in a shared payload, mirroring `MARKET-03`'s
`basic_info` discipline); a future, optional rich link-preview card with
explicit anti-ranking/anti-paid-placement/anti-marketing-claim
constraints; ephemeral client-side personal selections by default (a
save-able/collaborative selection is a later, separate privacy decision);
and aggregate-only, never-a-ranking-signal analytics. Hard-blocked on
`MARKET-02` (canonical identities — flagging that "stable" does not
automatically mean "public-URL-safe"), `MARKET-06` (snapshot version/
freshness metadata), `MARKET-08` (an actual consumer-facing page to open),
the existing trust model (`docs/api/data-trust-model.md`), and a URL/
metadata strategy decision that no existing ticket makes. This wave is
downstream of the entire Wave 1–4 sequence, not part of the mandatory
second-market-launch minimum below.

## What must exist before a real second market can launch

At minimum: `MARKET-01` through `MARKET-07` (the market dimension,
canonical schema, source registry, import/normalization pipeline,
publication snapshots, and per-market coverage metrics), **`MARKET-08`'s
minimal market-aware consumer read path** (mandatory — see the correction
above), and `PLATFORM-09`'s own threshold decision approved and evaluated
against that new market's real `MARKET-07` numbers. `MARKET-09` (the full
snapshot/CDN-optimized layer) is not required to launch a second market —
only to serve several simultaneously live markets without hand-maintaining
parallel static files indefinitely.
