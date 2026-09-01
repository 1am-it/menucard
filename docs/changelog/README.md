# Changelog & Release Workflow

This is the source of truth for how BredaEats work gets committed,
communicated, and versioned during the dish-first migration. It complements
`planning/` (which tracks *what* is being built and *why*) by documenting
*how* finished work gets shipped and explained.

A second, parallel ticket track (`PLATFORM-*`, see
`planning/architecture/platform-plan.md`) now exists alongside the `BE-*`
track described below. It follows the same commit/versioning/release
workflow — one ticket per commit, doc updates in the same commit, a version
bump per meaningful milestone — so future entries in the release log below
may reference `PLATFORM-*` tickets using the same conventions.

## Commit workflow

- **Commit after each approved ticket or clearly scoped sub-ticket** — not
  before it's approved, and not batched across multiple tickets.
- **Avoid large, mixed commits across unrelated work.** One ticket (e.g.
  `BE-06`) is one commit (or a tight, clearly-related sequence of commits),
  not folded into the next ticket's diff.
- Planning-doc updates that describe a ticket's own completion (marking it
  "(done)", adding a decision record) ship in the *same* commit as that
  ticket's code — they're part of what makes the ticket reviewable, not a
  separate follow-up.

## What to produce for every approved step

Once a ticket or sub-ticket is approved, produce all three of the following.
They serve different audiences and are not interchangeable:

1. **A short technical commit message** — for the git history and other
   engineers. Conventional, terse, references the ticket id.
2. **A plain-language GitHub summary** — for non-technical stakeholders
   reading a PR description or release note. Must cover:
   - what changed
   - why it matters
   - what users or stakeholders will actually notice (if anything)
   - whether existing functionality was preserved
3. **A short changelog-ready description** — one or two lines, written for
   the running log below. Terser than the GitHub summary, plainer than the
   commit message.

### Worked example (BE-06, already completed)

**Commit message:**
```
feat(search): add filters + URL state to /search (BE-06)
```

**Plain-language summary:**
> Added filters (meal type, day, price, cuisine, allergies) to the dish
> search page, and made every filter combination shareable as a link. This
> matters because people can now narrow down results and send someone else
> the exact filtered view they're looking at. Nothing existing changed —
> plain text search on `/search` still works exactly as before, and no
> other page was touched.

**Changelog line:**
> Search results can now be filtered by meal, day, price, cuisine and
> allergies, with shareable filter links.

## Versioning (practical SemVer during the migration)

BredaEats stays on `0.x.y` until the new dish-first flow is stable enough to
call `1.0.0` — a genuinely stable, production-ready milestone, not just "the
migration ticket list is empty."

- **`patch` (0.x.Y)** — small, safe improvements: bug fixes, copy tweaks,
  internal refactors with no visible behaviour change.
- **`minor` (0.X.y)** — visible new functionality or a meaningful product
  milestone: a new page, a new filter, a new user-facing capability.
- **`major`** — reserved. Not used during this migration. Only once the
  dish-first flow is the real, stable product, not a parallel experiment.

**Do not bump the version for every commit.** Bump per meaningful release or
milestone — typically once per completed ticket that changes what a user or
stakeholder can see or do, not per small internal change within it.

Pair the version number with a plain-language release name where it helps a
non-technical reader understand what shipped, e.g.:

- `v0.3.0 — Dish-first search preview`
- `v0.4.0 — Theme selection update`
- `v0.6.0 — Homepage migration`

## GitHub Releases

The "Release log" below is the changelog — a running record of what shipped.
A **GitHub Release** is a separate, additional step: publishing one of those
milestones as an actual tagged release on GitHub, for anyone (technical or
not) browsing the repo's Releases page.

- **Publish a GitHub Release for meaningful milestones, not every commit.**
  The same bar as a `minor` version bump above: a new page, a new
  user-facing capability, a product-visible milestone. Most individual
  ticket commits do *not* need their own release — several tickets often
  accumulate into one release (see the version ladder above, e.g. `v0.2.0`
  bundles `BE-02a`+`BE-02b`+`BE-02c`).
- **Use the documented `0.x.y` migration version as the tag** (e.g. `v0.6.0`
  — with the `v` prefix on the tag/release, matching the version ladder
  above). Don't invent a separate release-numbering scheme.
- **Every release needs three things**, same spirit as the per-commit
  requirement above but at milestone scope:
  1. A clear version number (the tag, e.g. `v0.6.0`).
  2. A plain-language title (e.g. "Homepage migration") — this is what most
     readers of the Releases page actually see first.
  3. Short release notes understandable by non-technical readers: what
     changed, why it matters, what users/stakeholders will notice, and
     whether existing functionality was preserved. This is a slightly
     expanded version of the "Plain-language summary" already required per
     commit — a release's notes may summarize several commits at once.
- **Keep the changelog and release notes aligned.** A release's notes
  should not contradict or omit what the "Release log" entry for that
  version says — draft the changelog entry first (per commit, as work
  lands), then compose the release notes from those entries when the
  milestone is actually published, rather than writing the two
  independently.
- Tag format: `vX.Y.Z` (e.g. `v0.6.0`), annotated, pointing at the commit
  that completes the milestone (typically the last commit of the last
  ticket bundled into that release).

## Release log

Retroactive entries below reconstruct the versioning this project should
have had for work already completed and approved (`BE-02a` through `BE-04`).
**These were not actually tagged as releases when the work happened** — see
the note at the end of this section. Numbers here are the recommended
version ladder going forward; new work should continue it (next version
after `v0.9.0` is `v0.10.0`, for whichever ticket ships next).

### v0.2.0 — Dish search foundation
*(`BE-02a` data model repair, `BE-02b` server-side search endpoint, `BE-02c` ranking — bundled as one milestone since none were independently user-visible on their own)*

- **What changed**: Repaired the underlying data (numeric prices, explicit
  reservation fields, consistent allergen data), added a server-side search
  endpoint (`/api/search`) so the client no longer needs the full
  restaurant/menu dataset, and defined explicit rules for how search results
  are ranked.
- **Why it matters**: This is the plumbing the entire dish-first search
  experience is built on — nothing user-facing shipped yet, but nothing
  after this point could have worked without it.
- **What users notice**: Nothing directly yet — no page changed.
- **Existing functionality**: Fully preserved; verified byte-for-byte
  against the pre-existing pages at each step.

### v0.3.0 — Dish-first search preview
*(`BE-03`)*

- **What changed**: Added a new, standalone dish search results page
  (`/search`) — search by dish, ingredient or cuisine and see price,
  restaurant, and a link to the full menu, not tied to any one restaurant.
- **Why it matters**: This is the first real piece of the dish-first
  product direction — finding a dish first, then the restaurant it's on.
- **What users notice**: A new page exists at `/search`, not yet linked
  from the homepage.
- **Existing functionality**: Fully preserved — nothing else changed.

### v0.4.0 — Theme selection update
*(`THEME`)*

- **What changed**: Added a Light/Dark/System theme switch, available on
  every page, remembered per browser.
- **Why it matters**: Supports the new lighter visual direction while
  keeping the existing dark look available for anyone who prefers it.
- **What users notice**: A theme toggle in the header. Nothing changes
  unless they use it — the site looks exactly the same as before by
  default.
- **Existing functionality**: Fully preserved — no page's layout, content,
  or behaviour changed, only which colors are used.

### v0.5.0 — Search filters
*(`BE-06`)*

- **What changed**: Added filters (meal, day, price, cuisine, allergies) to
  `/search`, reflected in the page's URL.
- **Why it matters**: Makes the new search page actually useful for
  narrowing down real choices, and filtered views can be shared as a link.
- **What users notice**: A "Filters" control on the search page; links now
  carry filter state.
- **Existing functionality**: Fully preserved — plain text search behaves
  identically to before.

### v0.6.0 — Homepage migration
*(`BE-04`)*

- **What changed**: Replaced the homepage with a lightweight, search-first
  version that forwards into `/search`. The previous homepage (day/meal
  browsing, restaurant grid, menu overview) was moved, not deleted, to
  `/restaurants`.
- **Why it matters**: Search is now the primary way to use BredaEats, per
  the product direction — while restaurant browsing is still one click away
  for anyone who prefers it.
- **What users notice**: The homepage looks different (search-first) and
  loads noticeably faster; a "Restaurants" link leads to the familiar
  browsing experience.
- **Existing functionality**: Fully preserved — the entire previous
  homepage still works, unchanged, at `/restaurants`, including saved
  filter preferences.

### v0.7.0 — Reservation accuracy, richer menu info & performance cleanup
*(`BE-07`, `BE-05`, `BE-08` — bundled as one milestone; changelog-only, no
separate GitHub Release, matching the `v0.2.0`–`v0.5.0` precedent below.
This was the "`v0.7.0`, for `BE-07`" version already anticipated in this
document's earlier text — it shipped, but was never versioned until now.)*

- **What changed**: Reservation buttons now reflect each restaurant's real,
  per-restaurant reservation method instead of assuming every restaurant
  accepts WhatsApp (`BE-07`). The restaurant menu page now shows cuisine
  type and today's open/closed status when known (`BE-05`). The restaurant,
  menu, and allergen-overview pages were restructured to look up data
  server-side instead of shipping the full dataset to every visitor, making
  each roughly 30 KB lighter (`BE-08`).
- **Why it matters**: Reservation links no longer point somewhere that
  doesn't actually work; the menu page is more useful at a glance; these
  pages load faster with no visible change in what they do.
- **What users notice**: More accurate reservation buttons, extra info on
  the menu page, faster loading — nothing removed or broken.
- **Existing functionality**: Fully preserved on all three pages.

### v0.9.0 — Trusted contributions and data governance
*(`PLATFORM-06`, `PLATFORM-07`, `MARKET-01` through `MARKET-03` — bundled as
one milestone, published as a GitHub Release)*

- **What changed**: Restaurant owners can now claim their own restaurant and
  verify their identity through a moderated review flow; a trusted internal
  editor reviews and decides every claim before it takes effect — nothing is
  granted automatically (`PLATFORM-07`). Built the internal review queue
  editors use to approve or reject proposed data changes, so no single
  change reaches real data without a recorded decision (`PLATFORM-06`).
  Alongside this, defined (as documentation/schema contracts, not yet built)
  the technical foundation MenuCard needs to responsibly grow beyond Breda:
  a neutral "market" concept for a future city or region (`MARKET-01`), a
  canonical restaurant/menu data model that records who asserted each price,
  opening hour, reservation method, or allergen and how confident that
  assertion is (`MARKET-02`), and a source registry that requires every
  future data source to be reviewed and approved before use — publicly
  visible data is never treated as automatically reusable, scraping of
  third-party search-results pages is excluded by design, and personal data
  (owner names, personal contact details, likely home addresses) is
  explicitly kept out of automated collection (`MARKET-03`).
- **Why it matters**: Restaurant owners get a real, verified way to take
  ownership of their listing, and every data change — from an owner or from
  internal review — now goes through a moderated decision, not a silent
  write. The market and source-governance contracts mean that when MenuCard
  does start pulling in data from external sources, it will do so with
  recorded permission, traceability, and clear limits on what's collected,
  rather than after the fact.
- **What users/stakeholders will notice**: Restaurant owners can start a
  claim on their listing. Internal editors have a review queue for claims
  and proposed changes. Nothing changes for regular visitors browsing or
  searching — the consumer experience on `/`, `/search`, `/restaurant/[id]`,
  and `/menu/[id]` is untouched.
- **Existing functionality**: Fully preserved — no existing page, route, or
  consumer-facing behaviour changed.
- **Explicitly not included in this release** (documented as contracts or
  roadmap only, not built or live): automated import of Breda restaurant
  data from any external source; a daily-menu or daily-special feature; any
  new data-driven search ranking or sorting; a public snapshot/publication
  layer or a market-aware consumer read path; public-facing source or
  freshness badges. These remain future work, not shipped capability.

### v0.8.0 — Data platform foundation: coverage tracking & trust model (Phase 1)
*(`PLATFORM-01` through `PLATFORM-05` — bundled as one milestone, published
as a GitHub Release)*

- **What changed**: Began MenuCard's evolution into a multi-city data
  platform (see `CLAUDE.md`, `planning/architecture/platform-plan.md`).
  Added an internal dashboard showing exactly how complete Breda's
  restaurant data really is — only 16% of restaurants have a digitized
  menu, 0% have a confirmed reservation method (`PLATFORM-01`). When a dish
  search comes up empty, `/search` now honestly explains when that's
  because relevant restaurants exist but simply don't have menu data yet,
  instead of just saying "nothing found" (`PLATFORM-02`). Defined how
  MenuCard will track who confirmed a piece of data and how much to trust
  it (`PLATFORM-03`), decided the technical foundation (Supabase) for
  storing that trust information (`PLATFORM-04`), and built — then
  live-verified against a real database — the first authenticated internal
  system for recording it (`PLATFORM-05`).
- **Why it matters**: This is the groundwork for restaurant owners and
  trusted editors eventually being able to confirm and correct their own
  data. Nothing about that is public yet, but the foundation now exists and
  has been proven to work against a real database, not just in theory.
- **What users notice**: One honest new message on `/search` when results
  are empty because of a data gap, not a search problem. Everything else in
  this release is internal tooling and foundational work, invisible to
  visitors.
- **Existing functionality**: Fully preserved — no existing page, route, or
  behaviour changed except the new `/search` empty-state addition.

## Known discrepancies (flagged, not silently fixed)

- **`package.json` read `"version": "1.0.0"`**, left over from the initial
  scaffold, contradicting the `0.x.y` policy above. This was corrected to
  `0.6.0` (matching the release log) as part of the retroactive `BE-04`
  commit, since that's the commit that brings the codebase to the state
  this policy calls v0.6.0.
- **`v0.2.0`–`v0.6.0` above were not committed or tagged as separate
  releases at the time the work happened** — `BE-02a` through `BE-04` were
  implemented across a single working session without following a
  commit-per-ticket discipline, because that discipline didn't exist yet.
  They were later reconstructed into separate retroactive commits (one per
  ticket, in this order) once this workflow was adopted, so git history now
  matches this log. No git tags were created for these retroactive commits.
  Going forward, new tickets should be committed — and, where meaningful,
  tagged — as they're approved, per the workflow above.
- **`v0.6.0` is the first version actually published as a GitHub Release**
  (created after the fact, once the GitHub Releases workflow above was
  adopted — not at the moment `BE-04` itself was approved). `v0.2.0`–`v0.5.0`
  remain changelog-only entries, not published releases; nothing requires
  going back to publish releases for them.
- **`BE-07`, `BE-05`, and `BE-08` shipped without ever being versioned or
  released**, despite this document explicitly anticipating "`v0.7.0`, for
  `BE-07`" at the time. They were committed individually, correctly, but
  the version-bump/release step was missed for each. Reconstructed here as
  `v0.7.0`, changelog-only (same treatment as `v0.2.0`–`v0.5.0`), rather
  than silently absorbed into `v0.8.0` or renumbered away. `v0.8.0`
  (`PLATFORM-01`–`05`) is the next actual GitHub Release. Going forward,
  every meaningful milestone should get its version bump and, where
  warranted, its GitHub Release at the time it ships — not discovered
  missing during the next release's preparation.
