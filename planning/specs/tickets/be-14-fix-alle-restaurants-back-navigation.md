# BE-14 — Fix "Alle restaurants" Back-Navigation and Give Menu Pages a Real Parent Link

## Status

Proposed; **implemented and locally verified in commit
`0a6a2811781c6c58732eb99514a8f5f6bc7d1762` (2026-09-17); not yet pushed
or deployed — no production or live verification has been done.** The
three planned link changes are built exactly as scoped: `app/page.js`'s
`Bekijk alle restaurants →` now targets `/alle-restaurants`;
`RestaurantDetailView.js`'s `← Alle restaurants` now targets
`/alle-restaurants`; `MenuView.js`'s back-link is now an honest
`← {restaurantnaam}` link to that menu's own `/restaurant/[id]`, replacing
the old `← Alle restaurants` → `/restaurants` link entirely. Targeted
tests (`app/page.test.js`, `RestaurantDetailView.test.js`,
`MenuView.test.js`), the full project test suite (735 tests, 733 pass, 0
fail, 2 pre-existing/unrelated skips), and `npm run build` all pass
locally. Behavior has been verified against a local production server
only (390px/1280px, both themes, direct-link visits with no prior app
history, and a full `/alle-restaurants` → restaurant → back click-through)
— not against any live/deployed environment, regardless of the commit's
current push status.

## Depends on

`planning/decisions/007-homepage-shift.md` (the existing `/` ↔
`/restaurants` split — restated, not reopened: `/restaurants` keeps its
exact current route and behaviour for existing bookmarks).
`planning/decisions/014-navigation-and-orientation-standard.md` (this
ticket closes one concrete instance of that decision's own "Known
deviations" entry: *"Consumer deep routes have no explicit 'back to
results' affordance beyond the shared header's logo-as-home link... weaker
than a page-specific parent destination... worth revisiting"*).
`planning/specs/tickets/be-11-public-menu-discovery-intent-aware-results.md`
(referenced only for its already-decided `PrimaryNav`/`Alle restaurants`
navigation — not reopened; see "Non-goals").
`planning/specs/tickets/be-12-dish-result-deep-link-scroll-highlight.md`
(referenced only to state how the two tickets relate — not reopened; see
"Suggested order").

## Problem

Verified against current code and the live production deployment
(`https://menucard-kappa.vercel.app`, 390px and 1280px, both themes):

- The permanent `PrimaryNav` tab labelled `Alle restaurants`
  (`src/components/PrimaryNav.js`) points at `/alle-restaurants` — BE-11's
  restaurant-level browse index, the canonical "every known restaurant"
  destination.
- The homepage's `Bekijk alle restaurants →` link (`app/page.js:104`)
  still points at `/restaurants` — the older, relocated guided-browse page
  (`planning/decisions/007-homepage-shift.md`).
- The back-link on `/restaurant/[id]`, labelled `← Alle restaurants`
  (`app/restaurant/[id]/RestaurantDetailView.js:50`), also points at
  `/restaurants`, not `/alle-restaurants`.
- The back-link on `/menu/[id]`, also labelled `← Alle restaurants`
  (`app/menu/[id]/MenuView.js:287`), points at the same `/restaurants` —
  and in doing so skips past the menu's own direct structural parent (the
  restaurant itself) entirely, jumping two levels up instead of one.

Concrete, verified consequence: a visitor who reaches a restaurant via the
permanent `Alle restaurants` tab (`/alle-restaurants`), opens it, and
clicks `← Alle restaurants` to go back, does **not** return to the tab
they came from — they land on a different, older page
(`/restaurants`, with its own `🏠 Restaurants`/`📋 Menukaarten` mode-switch
and separate filter state) that happens to share very similar wording.
Verified live example: restaurant id `6` ("Brasserie Bardot",
`/restaurant/6`) and its `6-lunch` menu (`/menu/6-lunch`) both currently
carry this same mislabelled back-link.

## Decision

Adopt the canonical hierarchy `Alle restaurants → Restaurant → Menukaart`
as the structural back-navigation model for these three pages. Every
"back" affordance in this chain points at its own real, immediate parent
in that hierarchy, using the already-available restaurant/menu data these
pages already load — no new data source, no new field, no herkomst-
tracking of any kind.

## Scope (exact, final)

- **`app/page.js`** — `Bekijk alle restaurants →` keeps its exact current
  visible text; only its link target changes, from `/restaurants` to
  `/alle-restaurants`.
- **`app/restaurant/[id]/RestaurantDetailView.js`** — `← Alle restaurants`
  keeps its exact current visible text; only its link target changes,
  from `/restaurants` to `/alle-restaurants`.
- **`app/menu/[id]/MenuView.js`** — the current `← Alle restaurants` link
  is replaced with an honest, structural parent link naming the actual
  restaurant, e.g. `← {restaurantnaam}` (using the same `r.name ||
  restaurant.name` source this file already reads elsewhere in its own
  render), pointing at that restaurant's own `/restaurant/[id]` (using
  this file's own existing `baseId = id.split('-')[0]` — no new
  computation).
- Uses only existing, already-trusted restaurant/menu data already loaded
  by these three pages. No new API field, no data migration, no new
  client-side derivation beyond what each file already computes for its
  own rendering today.

## Direct-link guarantee (no prior app history)

- A visitor who opens `/restaurant/[id]` directly (bookmark, shared link,
  fresh tab — no `document.referrer`, no prior in-app navigation) gets a
  working `← Alle restaurants` link to `/alle-restaurants`.
- A visitor who opens `/menu/[id]` directly, the same way, gets a working
  `← {restaurantnaam}` link to that menu's own `/restaurant/[id]`.
- Both are static, unconditional links — they render identically
  regardless of how the page was reached, so there is no "unknown
  origin" case to fall back from.

## Non-goals (explicitly out of scope)

- **No origin/herkomst-tracking of any kind** — no new query parameter, no
  `returnTo`, no `document.referrer`, no `sessionStorage`. A visitor who
  actually arrived via the legacy `/restaurants` page will, after this
  change, land on `/alle-restaurants` when going back from
  `/restaurant/[id]` — not back on `/restaurants` itself. This is an
  accepted, bounded trade-off in exchange for zero new state and zero new
  security/maintenance surface, not an oversight.
- **No change to `RestaurantBrowseCard.js`, `/search`, `PrimaryNav`,
  `/alle-restaurants`, or `/restaurants`.** `/restaurants` keeps its exact
  current route, content, and behaviour, unchanged and fully reachable,
  for existing bookmarks (`planning/decisions/007-homepage-shift.md`).
- **No breadcrumb component, no new `Home` tab, no skip-link, no
  site-wide `:focus-visible` redesign, no visual restyling** of any kind.
  The existing link text, colors, spacing, and tokens are reused exactly
  as-is.
- **No change to `BE-12`** (`dish`/`name`/`cat`/`fromQuery`, scroll, focus,
  or highlight behaviour on `/menu/[id]`) — not reopened, not
  reimplemented, not anticipated beyond the compatibility note in
  "Suggested order" below.
- **No rebranding, domain change, city-selector, multi-city routing, or
  `MARKET-*` work of any kind.** This ticket operates entirely inside
  today's existing, single-market, unprefixed route structure.
- **No change to `/api/search`, `/api/restaurants`, `dishSearch.js`, or
  `restaurantIndex.js`.**

## Acceptance criteria

All items below are checked off as **verified locally** (targeted tests,
full test suite, `npm run build`, and a local production server) as of
commit `0a6a2811781c6c58732eb99514a8f5f6bc7d1762` — none of this has been
verified against a live or deployed environment. That remains true
regardless of the commit's push status; live verification is a separate,
later step this ticket does not claim has happened.

- [x] The visible label `Alle restaurants`, wherever it appears in the
      three modified files, always points at `/alle-restaurants` — never
      at `/restaurants` — in both places it is used (`app/page.js`,
      `RestaurantDetailView.js`).
- [x] `/menu/[id]`'s back-link names and links to its own direct
      restaurant parent (`/restaurant/{baseId}`), using the restaurant's
      real name, not the generic `Alle restaurants` label.
- [x] All three modified links remain real `<Link>`/`<a>` elements with
      visible keyboard focus (`:focus-visible`) — never a `<div>` with a
      click handler, and never a link with no visible focus state.
- [x] A direct visit to `/restaurant/[id]` or `/menu/[id]` (no prior
      in-app navigation, no `document.referrer`) shows a working,
      correctly-targeted back-link exactly as described in "Direct-link
      guarantee" above.
- [x] No horizontal overflow at approximately 390px or approximately
      1280px, in both light and dark themes, on all three modified pages
      after the change (`document.documentElement.scrollWidth <=
      clientWidth`, per `planning/decisions/014-navigation-and-orientation-standard.md`
      item 5).
- [x] `/search`'s existing results, filters, and BE-13's restaurant-name
      match-tier removal behaviour (`Bardot`/`Wolfslaar`/`friet`/`Bardot
      friet`/`Chablis`) are verified unchanged — this ticket touches none
      of `dishSearch.js`, `restaurantIndex.js`, or `/api/search`.
- [x] `PrimaryNav`'s existing `aria-current` behaviour on `/search` and
      `/alle-restaurants` is verified unchanged.
- [x] `/restaurants` itself is verified unchanged and still reachable at
      its exact current URL, with its existing mode-switch and filter
      behaviour intact.
- [x] Targeted, structural tests (same convention as
      `app/search/page.test.js` — `fs.readFileSync` + regex/structural
      checks, no DOM harness) pin: the exact `href` each of the three
      modified links now resolves to, and that the old `/restaurants`
      target is gone from `app/page.js` and `RestaurantDetailView.js`.
- [x] A local production build, checked manually in a browser at ~390px
      and ~1280px, both themes, proves all three paths: `/alle-restaurants`
      → a restaurant → back lands on `/alle-restaurants`;
      `/restaurant/[id]` opened directly → back lands on
      `/alle-restaurants`; `/menu/[id]` opened directly (e.g. `/menu/6-lunch`)
      → back names and lands on `/restaurant/6` ("Brasserie Bardot").

## Risks

- **The accepted `/restaurants`-origin asymmetry is later mistaken for a
  bug** (a visitor who came from `/restaurants` not returning there) —
  mitigated by naming it explicitly, in both "Non-goals" and this section,
  as a deliberate, bounded trade-off, not an oversight.
- **A future contributor reaches for `document.referrer` or
  `sessionStorage` to "improve" this later without re-reading this
  ticket** — mitigated by this ticket's own explicit "Non-goals" list and
  by the fact that neither mechanism has any existing precedent anywhere
  in this codebase to build on (verified: `sessionStorage` is used exactly
  once in the whole project, in `app/restaurants/page.js`, solely for
  same-page scroll-position restoration — never for cross-page origin;
  `document.referrer` and `returnTo` are used nowhere).
- **Scope creep toward re-wiring `RestaurantBrowseCard.js` or `/search`'s
  restaurant group** while these three files are open — explicitly
  forbidden in "Non-goals."

## Suggested order

An independent, small ticket — not a `BE-11` or `BE-12` amendment. Should
land **before** `BE-12`: `BE-12`'s own ticket already plans to add a
second, conditional link to `/menu/[id]` ("← Terug naar zoekresultaten
voor '{query}'", shown only when its own `fromQuery` parameter is
present) **alongside, not replacing,** this page's existing structural
back-link — see `be-12-dish-result-deep-link-scroll-highlight.md`,
"Desired behavior" §1.4. `BE-12` explicitly does not reopen restaurant-
level navigation (its own "Non-goals": *"No change to `BE-11`'s
restaurant-level navigation, `PrimaryNav`, `RestaurantBrowseCard`, or the
`/alle-restaurants`/`/search` restaurant-group behavior — not reopened"*),
which is exactly the area this ticket touches — the two must stay
separate tickets. Building this one first means `BE-12` adds its own,
conditional link next to an already-correct, honestly-labelled structural
parent link (`← {restaurantnaam}`), instead of next to the currently
mislabelled one.
