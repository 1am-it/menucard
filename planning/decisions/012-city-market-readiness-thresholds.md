# Decision — City/Market Readiness Thresholds (PLATFORM-09)

## Status

Accepted (thresholds, process, and terminology only — see "What this
decision does not do"). Closes the launch-status vocabulary question
`[[011-market-foundation-and-international-growth]]` left open pending
this decision.

## Context

`planning/specs/platform-city-rollout.md` defined four coverage metrics
and explicitly deferred concrete numeric thresholds to `PLATFORM-09`,
"once real Breda data from `PLATFORM-01` exists to calibrate against."
That data exists: `docs/coverage/breda-baseline-2026-08-30.md`. **This
decision calibrates against that baseline only — never against the
`field_provenance`/`pending_changes`/`restaurant_claims` rows created
during `PLATFORM-05`–`07`'s live verification, which are explicitly kept
as synthetic test/audit artifacts, not real Breda data.**

Since `PLATFORM-01` shipped, `[[011-market-foundation-and-international-growth]]`
has also established that "city" is the current, concrete instance of a
more general future "market" concept, and that a genuine second market
cannot launch — at all, not even conditionally — without a
not-yet-built `MARKET-*` foundation and a mandatory minimal market-aware
consumer read path. This decision's thresholds answer *how would we know
a market's data is good enough*; they do not, by themselves, answer
*could the app actually serve a second market yet* — it currently cannot,
for reasons entirely independent of data coverage.

## Decision

### Thresholds

| Metric | Threshold | Breda's real baseline | Breda clears it? |
|---|---|---|---|
| Restaurants with basic info | ≥ 95% | 100% | Yes |
| Restaurants with any digitized menu data | ≥ 50% | 16% | **No** |
| Menu items with a price (of items that exist) | ≥ 90% | 96.5% | Yes |
| Restaurants with a confirmed reservation method | ≥ 20% | 0% | **No** |

**Breda does not clear its own proposed bar today, on two of four
metrics.** This is a deliberate, stated finding, not an oversight. The
thresholds are not set at Breda's current numbers — doing so would make
the checklist meaningless, since any equally sparse future market would
trivially "pass." They exist to catch a repeat of Breda's own current gap
in a new market, including in Breda itself if re-measured later.

### Outcome tiers — not a strict binary

- **Go** — clears all four thresholds.
- **Conditional go** — clears basic info and price, not menu-data coverage
  and/or reservation confirmation. Launch is possible only with
  `PLATFORM-02`'s existing low-coverage transparency messaging active for
  the affected categories — reusing already-built infrastructure, not new
  work.
- **No-go** — fails basic info or price. Not usable enough even with
  disclosure.

Breda today would sit in **conditional go** against this table, were the
question of launching it fresh ever asked again.

### Launch-status vocabulary (resolves the open item in `[[011-market-foundation-and-international-growth]]`)

`prospective` → `seeding` → `conditional` → `live` (→ `paused` if a live
market's coverage later degrades below threshold). This is now the fixed
vocabulary for a market's `launch status` field wherever `MARKET-01`
eventually defines it.

### Operational process

Sourcing → initial seeding → measurement → toetsing against the table
above → decision → (if no-go) a concrete additional data-sourcing action
before re-measuring, not an undated "try again later." Full step-by-step
detail lives in `docs/guides/city-rollout-playbook.md`, kept separate from
this decision record so the *why* and the *how* don't have to be edited
together. Decision-making role: "the team," per this ticket's own user
story — no new organizational structure invented that doesn't exist
elsewhere in this project's documentation.

### The hard dependency this decision does not remove

**No second market — not even at "conditional go" — can launch until the
mandatory `MARKET-*` foundation and its market-aware consumer read path
exist.** Per `planning/architecture/market-data-foundation-plan.md`:
`MARKET-01` through `MARKET-07` (market dimension, canonical schema,
source registry, import/normalization, publication snapshots, per-market
coverage metrics) and `MARKET-08` (the mandatory minimal market-aware read
path — today's consumer app has no market dimension or selection
mechanism at all). This decision's thresholds are necessary but not
sufficient for a second market to launch; they answer a data-quality
question, not an application-capability one.

## What this decision does not do

- Build any code, database, import tool, or dashboard change.
- Migrate or touch Supabase in any way.
- Select, plan, or schedule an actual second market.
- Resolve the `MARKET-*` dependency above — it restates it, doesn't
  shorten it.

## Rejected alternatives

- **Set thresholds at Breda's current numbers.** Rejected: makes the
  checklist a rubber stamp for whatever a new market happens to arrive
  with, defeating its stated purpose.
- **Quietly omit that Breda fails its own thresholds.** Rejected: this
  project's standing practice throughout `BE-*`/`PLATFORM-*` has been to
  report inconvenient findings plainly (e.g. `PLATFORM-01`'s own headline
  16%/0% numbers) rather than launder them — this decision follows that
  precedent, not an exception to it.
- **A strict binary go/no-go with no conditional tier.** Rejected: it
  would ignore that `PLATFORM-02`'s transparency messaging already exists
  specifically to make a coverage gap honest rather than disqualifying —
  using it here is reuse, not a new invention.
