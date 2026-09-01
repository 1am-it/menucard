# City/Market Rollout Playbook

The operational how-to for `planning/decisions/012-city-market-readiness-thresholds.md`'s
readiness process. That decision record holds the *why* (thresholds,
tiers, rationale); this guide holds the *how*, so one can be revised
without editing the other.

**Status today: not executable.** Every step below assumes tooling that
doesn't exist yet — this playbook documents the intended process, not a
runbook you can follow right now. See "What's missing today" at the end.

## Steps

1. **Candidate sourcing** — identify the market's geographic boundary and
   assemble a *complete* restaurant candidate list within it.
   Business/legal sourcing decisions are out of scope for this playbook
   (per `planning/specs/tickets/platform-09-city-rollout-operations.md`'s
   own scope boundary) — this step only requires that the list be
   complete before anything else happens. Popularity must never gate
   inclusion — see `[[011-market-foundation-and-international-growth]]`'s
   completeness-before-popularity principle. Deliberately extra attention
   goes to unknown, independent, new, local, and underrepresented
   restaurants at this stage, not just the ones easiest to find.

2. **Initial seeding** — basic info first (name, address, hours, cuisine),
   menu data where available. Every source used must be traceable and
   permitted: source, licence/usage right, import date, republish
   permission, freshness — no unauthorized scraping of search-engine
   results pages. Popularity may influence the *order* restaurants get
   enriched in, never whether they're seeded at all.

3. **Measurement** — compute the same four coverage metrics `PLATFORM-01`
   established for Breda, for the new market. Requires a market-scoped
   version of today's coverage tooling (`MARKET-07`, not built).

4. **Toetsing** — compare the measurement against
   `[[012-city-market-readiness-thresholds]]`'s table: Go / Conditional go
   / No-go.

5. **Decision** — "the team" decides, per the ticket's own framing. A
   conditional go requires `PLATFORM-02`'s low-coverage transparency
   messaging to be active for whichever categories fall short before
   anything is shown to a visitor.

6. **Escalation on no-go** — a no-go requires a concrete, named
   additional data-sourcing action (e.g. "source menus for the 12
   Italian restaurants still missing one") before re-measuring. An undated
   "revisit later" is not an acceptable escalation outcome.

## What's missing today

This playbook cannot actually run for a real second market yet:

- No market dimension exists anywhere in the data model or consumer app
  (`MARKET-01` not built).
- No canonical schema, source registry, import pipeline, or
  normalization/deduplication tooling exists (`MARKET-02`–`05` not built).
- No market-scoped version of the coverage dashboard exists — `PLATFORM-01`'s
  tooling is Breda-only today (`MARKET-07` not built).
- The consumer app has no way to select or serve a second market's data at
  all, even conditionally (`MARKET-08`, mandatory, not built — see
  `planning/architecture/market-data-foundation-plan.md`).

This guide exists so the process is documented and ready to execute once
that foundation exists — not to suggest it can be run today.
