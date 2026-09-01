# Architecture — PLATFORM-* Plan

See [[008-platform-track-scope]] for why this is a separate track from
`migration-plan.md`'s `BE-*` sequence, and `planning/CONTEXT.md` for how the
two tracks relate. A third, separate, proposed-but-not-yet-scheduled track
(`MARKET-*`, see `planning/architecture/market-data-foundation-plan.md` and
`[[011-market-foundation-and-international-growth]]`) covers the future,
not-yet-built market/canonical-data foundation for growth beyond Breda —
this document and every `PLATFORM-*` ticket in it are unaffected by that
proposal.

## Strategy

Evolve MenuCard from a Breda-only, fully static consumer app into a
multi-city horeca data platform, without disrupting the `BE-*` consumer
experience or its performance guarantees.

Read-only and modeling work ships before any write-capable backend exists.
Internal-only write access ships before any public-facing contribution flow.
Public contribution (`PLATFORM-08`) is deliberately not an early ticket.

## Current state

- No persistence layer: `data/restaurants.json` / `data/menus.json`, static,
  git-committed, no runtime writes.
- No authentication or identity of any kind.
- No API beyond the read-only `/api/search` route handler.
- Single city (Breda) assumed implicitly throughout every existing doc and
  page.

## Wave 1 — Read-only, no new infrastructure

### PLATFORM-01 — Coverage baseline + read-only dashboard

**Scope**: Compute and record a coverage baseline for Breda (see
`planning/specs/platform-city-rollout.md`) from the existing static dataset,
and build a live, read-only internal dashboard showing the same metrics.
This is both a one-time recorded snapshot and an ongoing view — not just the
dashboard.

**Key risk**: Treating this as "just a dashboard" and skipping the recorded
baseline, which is what makes future progress measurable at all.

**Acceptance criteria**:
- A written, dated baseline snapshot exists for Breda's current coverage
  metrics.
- A live internal dashboard recomputes the same metrics from current data.
- No schema change, no persistence layer, no authentication required.

### PLATFORM-02 — Low-coverage transparency UX

**Scope**: Consumer-facing messaging for low/no-coverage search results and
categories (per the mockup's "We missen nog menudata voor Italiaanse
restaurants" pattern), extending the existing empty-state requirement in
`planning/specs/dish-first-discovery.md`.

**Key risk**: Scope creep into a contribution flow — this ticket is
messaging only. Any "help improve this" call-to-action is a link/pointer at
most; the actual contribution mechanism is `PLATFORM-08`, which does not
exist yet when this ticket ships.

**Acceptance criteria**:
- Low-coverage categories/cities show honest, specific messaging instead of
  a generic empty state.
- No new write path, no new data model, no contribution UI.
- Consumer-facing — subject to the existing performance budget
  (`planning/decisions/003-performance-budget.md`), unlike PLATFORM-01.

## Wave 2 — Modeling and architecture decisions, before any write path exists

### PLATFORM-03 — Provenance/trust data model

**Scope**: Design the per-field trust/provenance schema per
`planning/specs/platform-trust-model.md`. A modeling ticket — defines the
shape, not yet a live write path.

**Key risk**: Under-scoping this to restaurant-level trust (like the
existing `reservation.verified` flag) instead of true per-field provenance,
which is the entire point of this ticket.

**Acceptance criteria**:
- Documented schema for `source`/`confidence`/`verifiedAt`/`verifiedBy` per
  trust-bearing field.
- Documented staleness window definition.
- No implementation of write access yet.

### PLATFORM-04 — Persistence + internal/external API architecture decision

**Scope**: Decide the actual persistence technology, how it coexists with
the current fully-static deployment, and the internal/external API boundary
per `planning/specs/platform-api.md`. A decision ticket, likely producing its
own `planning/decisions/0XX-*.md` record.

**Key risk**: Choosing a persistence approach without deciding the
internal/external API boundary at the same time — retrofitting that
boundary later is expensive.

**Acceptance criteria**:
- A documented, accepted decision record for the persistence technology.
- A documented internal/external API boundary and versioning approach.
- No application code changes yet — this is the decision that unblocks
  Wave 3.

## Wave 3 — Write path, internal/trusted callers only

### PLATFORM-05 — Internal API foundation

**Scope**: Authenticated, internal-only endpoints that can write using
`PLATFORM-03`'s schema, on the persistence layer chosen in `PLATFORM-04`, per
`planning/specs/platform-api.md`. No public submission surface.

**Key risk**: Building this without scoped auth (a single is-admin flag
instead of real permission scopes), which would need rework once owner and
editor roles (`PLATFORM-06`/`07`) arrive.

**Acceptance criteria**:
- Internal endpoints can read and write trust-bearing fields with correct
  provenance recorded.
- Not reachable without authentication; no public route exists yet.
- Versioned per `platform-api.md`'s principles.

### PLATFORM-06 — Moderation/review queue

**Scope**: Admin-only review queue UI/workflow for pending data changes,
built and testable against internally-seeded edits (since no public
contribution exists yet at this point in the sequence).

**Key risk**: Building this only against hypothetical future public
contributions instead of real internal edits, making it hard to validate
before `PLATFORM-08` exists.

**Acceptance criteria**:
- An editor can view, approve, or reject a pending change with its
  provenance visible.
- Approving a change updates the live data with correct provenance recorded.
- Internal/admin surface — see
  [[009-consumer-vs-internal-performance-budget]].

## Wave 4 — External-facing write surfaces

### PLATFORM-07 — Owner claim and identity verification

**Scope**: Let a restaurant owner claim and verify their own listing (email
or domain verification per the mockup), then edit their own data through the
`PLATFORM-05` API with `owner`-level provenance.

**Key risk**: Weak identity verification allowing a non-owner to claim a
listing — the verification method itself needs explicit scrutiny before
building the flow around it.

**Acceptance criteria**:
- A claim requires a real verification step before granting write access.
- Owner-made changes carry `owner` provenance and the highest confidence
  tier per `platform-trust-model.md`.
- Claim status (pending/verified) is visible to the restaurant and, where
  relevant, to editors.

### PLATFORM-08 — Community micro-task contributions

**Scope**: Small, structured public contribution tasks (confirm a fact, fill
a missing price, answer a yes/no question) per the mockup's micro-task
pattern, feeding into the `PLATFORM-06` moderation queue rather than writing
directly to live data.

**Key risk**: Spam/abuse from unauthenticated or lightly-authenticated public
submissions — rate limiting and abuse mitigation must be designed as part of
this ticket, not bolted on after.

**Acceptance criteria**:
- Contributions are structured (not free-form) and scoped to a single fact.
- Contributions land in the moderation queue with `community` provenance,
  never written directly to live data without review.
- Basic abuse/rate-limiting protection exists before this ships publicly.

## Wave 5 — Scale-out

### PLATFORM-09 — City rollout operations

**Scope**: Generalize `PLATFORM-01`'s coverage baseline into a repeatable,
per-city launch-readiness checklist with concrete thresholds, informed by
Breda's real numbers, per `planning/specs/platform-city-rollout.md`.

**Key risk**: Setting arbitrary thresholds instead of calibrating them
against what Breda's actual baseline showed was workable at launch.

**Acceptance criteria**:
- A documented, reusable per-city readiness checklist with concrete
  thresholds.
- Breda's own historical rollout is usable as the worked example/calibration
  point.

### PLATFORM-10 — Public-facing city metrics / platform exposure

**Scope**: A public-facing version of coverage metrics and/or the first
externally-exposed slice of the API boundary decided in `PLATFORM-04`.

**Key risk**: Publishing internal-tooling-grade surfaces (built under the
relaxed internal performance budget) directly to the public without
re-evaluating them against the consumer-facing budget first.

**Acceptance criteria**:
- Any publicly-exposed metric or endpoint is explicitly re-evaluated against
  `planning/decisions/003-performance-budget.md`, not grandfathered in from
  its internal equivalent.

## Technical principles

- Read-only and modeling work ships before any write-capable backend exists.
- Internal-only access ships before any public-facing contribution flow.
- Every write-capable ticket records provenance — no anonymous, unattributed
  writes to live data.
- Internal/admin surfaces are exempt from the consumer performance budget;
  anything reachable by the public is not — see
  [[009-consumer-vs-internal-performance-budget]].
- This track does not reorder, block, or require changes to the `BE-*`
  sequence.
