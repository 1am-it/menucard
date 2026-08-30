# Changelog & Release Workflow

This is the source of truth for how BredaEats work gets committed,
communicated, and versioned during the dish-first migration. It complements
`planning/` (which tracks *what* is being built and *why*) by documenting
*how* finished work gets shipped and explained.

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

## Release log

Retroactive entries below reconstruct the versioning this project should
have had for work already completed and approved (`BE-02a` through `BE-04`).
**These were not actually tagged as releases when the work happened** — see
the note at the end of this section. Numbers here are the recommended
version ladder going forward; new work should continue it (next version
after `v0.6.0` is `v0.7.0`, for `BE-07` or whichever ticket ships next).

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
