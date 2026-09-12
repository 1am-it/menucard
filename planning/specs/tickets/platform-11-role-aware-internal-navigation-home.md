# PLATFORM-11 — Role-Aware Internal Navigation & Home

## Status

Proposed, **not started**. Documentation/planning only — no route, page,
component, migration, or test exists yet for anything described here.

## Depends on

`PLATFORM-05` (the `internal`/`editor`/`owner` `staff_roles` model and the
`authenticateInternalRequest`/`isInternalOnly`/`isEditor`/
`getAccessForRestaurant` guards this ticket reuses unchanged — see
`src/lib/internalAuth.js`/`src/lib/importInbox.js`). Links to, but does not
modify the behavior of: `PLATFORM-01` (`/internal/coverage`), `PLATFORM-06`
(`/internal/moderation`, including its embedded "Owner claims" section —
see Problem below), `PLATFORM-07` (the identity-verification model behind
that section), and `MARKET-05A`/`05C` (`/internal/import-inbox`,
`/internal/profile-drafts`). This ticket adds no new surface's *content* —
it adds the missing front door and wayfinding around five surfaces that
already exist.

## Problem

`/internal` does not exist today — visiting it returns a plain 404. Every
internal surface (`/internal/import-inbox`, `/internal/profile-drafts`,
`/internal/moderation`, `/internal/coverage`) is a standalone page with its
own header and no shared chrome; `app/internal/layout.js` currently
contributes nothing but a shared `noindex` (`robots: {index:false,
follow:false}`), which every 'use client' page under it inherits because a
Client Component cannot export `metadata` itself. There is no landing page,
no cross-linking between these pages, and no way for a signed-in staff
member to discover a surface they have access to except by knowing (or
being told) its exact URL.

This is already a real usability gap, not a hypothetical one:

- A newly-added `internal`-role account (per `docs/guides/internal-api-live-testing.md`'s
  own activation flow) has no in-product way to find `/internal/coverage`,
  `/internal/import-inbox`, or `/internal/profile-drafts` after logging in
  — only `/internal/moderation`, because `/internal/login`'s own
  `handleSubmit` hardcodes `router.push('/internal/moderation')` after a
  successful sign-in, regardless of the signed-in user's actual role(s).
  An `internal`-only account (no `editor` role) is then immediately
  greeted by a page whose own API 403s for it.
- "Owner claims" is not its own route. It is a section rendered inside
  `/internal/moderation`'s existing page (`<h2>Owner claims</h2>` about
  two-thirds down `app/internal/moderation/page.js`, backed by
  `/api/internal/v1/claims/pending`), gated by the exact same `isEditor`
  check as the moderation queue above it — not a separate authorization
  boundary, and not a separate page to link to. Any navigation design must
  represent this honestly rather than inventing a route that does not
  exist.
- No page under `/internal/*` is gated on the `owner` role today (`grep`
  confirms `getAccessForRestaurant`'s `owner` branch is only consumed by
  `/api/internal/v1/provenance`, which itself has no page consuming it
  yet). A restaurant owner who has claimed and verified their listing
  (`PLATFORM-07`) currently has **no internal-navigation destination at
  all** — this ticket's route/role matrix must say so plainly rather than
  implying an owner-facing page already exists.
- Every existing page independently re-implements the same
  session-check-then-redirect boilerplate (`getSupabaseBrowser().auth.getSession()`
  → `router.replace('/internal/login')` if none) with no shared "you're
  signed in, here's what you can reach" surface layered on top.

None of this is a security gap by itself — every route already enforces
its own authorization server-side (see Technical constraints) — it is a
discoverability and orientation gap that will only get worse as more
`PLATFORM-*`/`MARKET-*` internal surfaces ship.

## Objective

Give every signed-in internal user (`internal`, `editor`, and
restaurant-scoped `owner`, in any combination) a single, predictable
`/internal` home and a shared, role-aware navigation shell that surfaces
exactly the existing pages their combined roles already permit — improving
*findability* of access that server-side authorization already grants,
never changing what that authorization is.

## User story

As a staff member with one or more `staff_roles` rows, I want to land on a
single internal home page after signing in and see a navigation that lists
only the tools I actually have access to, so I don't have to know or guess
URLs, get bounced through a page whose API immediately 403s me, or wonder
whether a tool I can't see even exists.

## Design decision — login destination and role-based access (decided)

The following is a decided design choice for this ticket, not an open
question — Phase 2 is where it gets implemented (see Phased delivery); no
code changes in this ticket itself.

1. **Every successful internal sign-in redirects to `/internal`.**
   `/internal/login`'s current `handleSubmit` hardcodes
   `router.push('/internal/moderation')` after `signInWithPassword`
   succeeds, regardless of the signed-in account's role(s) — see Problem.
   This ticket decides the fix: the destination after any successful
   sign-in is always `/internal`, never a specific module.
2. **`/internal` resolves the signed-in session's existing `staff_roles`
   rows and shows only the sections those roles already unlock**, using
   the exact server-side-equivalent checks in the route/role matrix
   (`isInternalOnly`, `isEditor`) — never a new, separate notion of "role"
   invented for the nav.
3. **A multi-role account sees the union of every role's sections**, not
   just one role's subset — restated from the route/role matrix's own
   "strongest applicable role" precedent (`getAccessForRestaurant`).
4. **An account with no usable role — zero `staff_roles` rows at all, or
   (defensively) only unrecognized values — lands on `/internal` and sees
   an explicit, plainly-worded "no internal access" status.** The only
   interactive control on that status is sign out. No section is
   rendered, no link is offered, and no other internal route is opened
   automatically on the account's behalf — `/internal` never guesses a
   "best" destination for an account it cannot place.
5. **`owner` gets no invented destination.** Until an `owner`-gated page
   actually exists (see Non-goals/Open questions), the `owner` section
   states plainly that there is nothing to open yet — it is never wired
   to a placeholder, an unrelated page, or another role's section.
6. **None of this moves the real security boundary.** Every decision
   above governs what `/internal`'s navigation *offers* to click; it
   grants no access itself. A direct visit to any existing module route
   still goes through that route's own unchanged
   `authenticateInternalRequest`/`isInternalOnly`/`isEditor` server-side
   check, exactly as today, regardless of what `/internal` did or didn't
   show.

## Non-goals (explicitly out of scope)

- **No new `staff_roles` value and no change to its `check` constraint.**
  This ticket consumes exactly `internal`/`editor`/`owner` as they exist
  today — see `PLATFORM-05`'s ticket and `src/lib/internalAuth.js`.
- **No RLS policy change, and no change to any existing route's
  authorization logic.** `authenticateInternalRequest`,
  `isInternalOnly`, `isEditor` (currently duplicated per-route — see
  Risks), and `getAccessForRestaurant` are reused exactly as they behave
  today. Navigation *reflects* access; it never grants, widens, or
  shortcuts it.
- **No automatic or implicit privilege escalation of any kind.** A
  navigation item's visibility is derived strictly from the roles already
  resolved by `authenticateInternalRequest` for the current session —
  never inferred, cached across sessions, or granted provisionally while
  a role check is pending.
- **No public link, index entry, or sitemap reference to `/internal` or
  anything under it.** `public/robots.txt`'s existing
  `Disallow: /internal/` and `app/internal/layout.js`'s
  `robots: {index:false, follow:false}` are unchanged and must keep
  applying to the new `/internal` route and every shared nav component.
- **No new external dependency** (no routing library, no nav/menu
  component package) — plain React/Next.js `<Link>`/`usePathname`, the
  same as the rest of this codebase.
- **No restaurant photography or heavy asset of any kind** in the nav or
  home page, per `CLAUDE.md` and this project's existing internal-page
  convention (lightweight inline stroke-only SVG icons only, as already
  established in `app/internal/import-inbox/page.js`/
  `app/internal/coverage/page.js`).
- **No broad rebuild of any existing internal page.** Every current page's
  content, data, actions, and own API calls are unchanged. This ticket
  adds a shell around them and a front door to them — it does not
  redesign what any of them show or do.
- **No new owner-facing page built from scratch.** Per the Problem
  section, no `owner`-gated page exists yet inside `/internal/*`. This
  ticket documents that gap in the route/role matrix and leaves an empty
  (or explicitly "nothing yet" messaged) owner section in the nav — it
  does not invent owner-facing functionality to fill it.
- **No code change in this ticket.** The login-redirect and role-based
  access decisions above are settled at the design level; the actual edit
  to `/internal/login`'s `router.push('/internal/moderation')` line, and
  every other line of implementation, happens in Phase 2 — this document
  remains documentation/planning only, per Status.

## Route / role matrix

Current state, verified directly against the routes and their server-side
guards (not assumed from documentation):

| Route | Section shown at | Required role(s) (server-side gate) | Gate mechanism |
|---|---|---|---|
| `/internal` (does not exist yet) | — | A signed-in session — no `staff_roles` row required to reach the page itself | New: same session check as every existing page. Roles determine only which module sections render inside the page, never whether the page itself loads; an account with no usable role still reaches `/internal` and sees the "no internal access" status from Design decision #4 |
| `/internal/coverage` | Full page | `internal` | `authenticateInternalRequest` + `isInternalOnly(auth.roles)` (`app/api/internal/v1/coverage/route.js`) |
| `/internal/import-inbox` | Full page | `internal` | `authenticateInternalRequest` + `isInternalOnly(auth.roles)` (`src/lib/importInbox.js`) |
| `/internal/profile-drafts` | Full page | `internal` | Same `isInternalOnly` gate (`app/api/internal/v1/profile-drafts/route.js`) |
| `/internal/moderation` | Moderation queue section | `editor` | `authenticateInternalRequest` + a locally-defined `isEditor(roles)` (`app/api/internal/v1/moderation/pending/route.js`) |
| `/internal/moderation` | "Owner claims" section (same page, not a separate route) | `editor` | Same page, separate `isEditor` check on `app/api/internal/v1/claims/pending/route.js` — **not** a distinct authorization boundary from the moderation queue above it |
| *(no route yet)* | Owner-scoped editing/provenance view | `owner`, scoped to `restaurant_id` | `getAccessForRestaurant`'s `owner` branch exists in `src/lib/internalAuth.js` and is consumed only by `/api/internal/v1/provenance`, which has no page today |
| `/internal/login` | Sign-in form | None (public, unauthenticated entry point) | N/A — this is how a session is obtained, not a gated destination |
| `/internal/activate`, `/internal/set-password` | Pre-login account activation | None (public, token/code-gated, not `staff_roles`-gated) | Out of scope for this ticket — reached before a session exists, so no navigation shell applies |

A user can hold multiple `staff_roles` rows (e.g. the existing
`developer@1am-it.com` test account holds both `internal` and `editor` —
see `docs/guides/internal-api-live-testing.md`). The nav must show the
**union** of every section each of the user's roles individually unlocks,
exactly mirroring `getAccessForRestaurant`'s own "strongest applicable
role wins" reasoning, generalized from "one restaurant's write access" to
"which nav items render."

## User flow

1. An unauthenticated visitor hits `/internal` (or any page under it) →
   existing per-page session check fires → redirected to
   `/internal/login`, unchanged.
2. After a successful sign-in, the user lands on `/internal` — the
   decided destination for every account per Design decision above;
   `/internal/login` no longer hardcodes `/internal/moderation`.
3. `/internal` resolves the session's roles once (the same
   `getSupabaseBrowser().auth.getSession()` + a lightweight authenticated
   call every other page already makes) and renders only the sections the
   combined roles unlock:
   - Always: a short "signed in as `<email>`, roles: `<list>`" line —
     useful for a multi-role account to understand *why* it sees what it
     sees, and for support/debugging when a role looks missing.
   - `internal` present → links to Coverage, Import Inbox, Profile Drafts.
   - `editor` present → link to Moderation (which itself still contains
     the Owner claims section — the home page does not need a second,
     separate link for it).
   - `owner` present → an owner section, honestly labeled as not yet
     having a destination page (see Non-goals), rather than a broken or
     silently-omitted link.
   - **No usable role at all** — zero `staff_roles` rows for this account
     (the same condition `authenticateInternalRequest` itself reports as
     its own 403, `'No staff role assigned for this account'`), or,
     defensively, only unrecognized values (which the column's `check`
     constraint should already prevent) → the explicit "no internal
     access" status from Design decision #4 above: a plain, non-alarming
     statement that the account has no internal access, with sign out as
     the only action. No section, no link, and no automatic redirect into
     any module — `/internal` never opens a route on the account's behalf.
4. From any page reached through the nav, the shared shell shows the
   current section as visually active and offers a way back to `/internal`
   — a breadcrumb or an equivalent "back to internal home" affordance, not
   necessarily literal breadcrumb markup — without removing any existing
   in-page navigation (e.g. Profile Drafts' own "Open in Import Inbox"
   links stay exactly as they are).
5. If a signed-in user manually navigates to a route their roles don't
   cover (e.g. an `internal`-only account opening `/internal/moderation`
   directly), the page's own existing API 403 handling is what actually
   protects the data — the nav merely made this less likely by not
   offering the link in the first place. See Technical constraints.

## Information architecture

- **One shared navigation component**, consumed by `/internal` and by
  every existing internal page, rendering the role-filtered link set from
  the route/role matrix above. Grouped by the existing product areas, not
  by role name (a user should see "Coverage Dashboard," not a raw
  "internal" badge) — role is the filter, not the label.
- **`/internal` is the only page whose entire content is the navigation
  home** — a short explanatory line, the grouped link list, and (for any
  role that resolves to zero destinations) an explicit empty state. It
  does not duplicate any metric, queue count, or data from the pages it
  links to; a "9 pending claims" badge or similar live count is
  explicitly deferred (see Open questions) rather than assumed.
- **The natural technical seam is `app/internal/layout.js`.** It is
  already a Server Component wrapping every `'use client'` page under it
  (exactly so those pages can inherit `metadata`, since a Client Component
  cannot export it itself) — the same structural reason makes it the
  right place to mount a shared client-side nav shell around `children`
  without turning the layout itself into a Client Component. This is
  research context for whoever implements Phase 2, not a decision made by
  this ticket.
- **Active-route indication** reuses `usePathname()` (already available in
  this Next.js App Router codebase, no new dependency) to highlight the
  current section.
- **Owner claims stays a section, not a nav destination**, per the Problem
  section's own finding — the nav links to `/internal/moderation` once;
  it does not pretend Owner claims is independently reachable.

## Mobile approach

- Reuses this project's existing, already-verified pattern (per
  `MARKET-11`'s own "Mobile usability around `390px`" constraint and this
  session's own established CDP-based visual-check method) rather than
  inventing a new one: a horizontally-compact, text-first nav — a
  collapsible/disclosure list or a simple stacked link list, not a
  hamburger-triggered overlay with new animation/dependency weight.
- No horizontal overflow or clipped control at approximately `390px`,
  verified the same way every other internal page in this codebase
  already has been (screenshot-based, no new tooling).
- The nav must not push any existing page's own content below the fold in
  a way it currently isn't — a thin, shared top bar/section, not a full
  secondary page injected above existing content.

## Technical constraints (hard boundaries)

- **Navigation is a discoverability layer only. Server-side authorization
  on every route/API remains the actual security boundary, unchanged.**
  Hiding a link never substitutes for a route's own
  `authenticateInternalRequest`/`isInternalOnly`/`isEditor` check — every
  existing check stays exactly as strict as it is today, and a
  direct-URL visit by an unauthorized role must still 403 exactly as it
  does now.
- **Reuse the existing role-check functions; do not fork new ones for the
  nav.** `isInternalOnly` (`src/lib/importInbox.js`) is already exported
  and reusable; `isEditor` is currently defined **locally and identically**
  in both `app/api/internal/v1/moderation/pending/route.js` and
  `app/api/internal/v1/claims/pending/route.js` — the nav's own
  client-side role-filtering logic should mirror that exact definition
  (`roles.some((r) => r.role === 'editor')`) rather than introducing a
  third, subtly different copy. Whether the two server-side copies are
  ever consolidated into one shared export is a separate, smaller
  cleanup this ticket does not require but does not block either.
- **No new role-resolution endpoint that duplicates
  `authenticateInternalRequest`'s query.** The nav should resolve roles
  from the same session the page already establishes (client-side
  `getSupabaseBrowser().auth.getSession()`, then either a lightweight
  existing authenticated call or, if genuinely needed, one new read-only
  endpoint that calls `authenticateInternalRequest` exactly as every
  other route does — never a second, parallel way to determine a user's
  `staff_roles`).
- **`noindex`/`robots.txt` exclusion is unaffected.** `/internal` inherits
  `app/internal/layout.js`'s existing `robots: {index:false, follow:false}`
  automatically; no change needed there, and this ticket must not
  introduce any sitemap entry, canonical link, or other public reference
  to `/internal` or its sub-routes.
- **Text-first, no new dependency, no photography** — restated from
  `CLAUDE.md` and Non-goals; internal tooling is exempt from the strict
  consumer performance budget (`[[009-consumer-vs-internal-performance-budget]]`)
  but not from these underlying principles.
- **Existing page content, props, and API calls are unchanged.** The nav
  wraps pages; it does not rewrite them.

## Data model needs

None. This ticket reads only the already-resolved `staff_roles` rows a
session's existing `authenticateInternalRequest` call (or an equivalent
lightweight read-only call following the same pattern) returns. No new
table, no new column, no migration.

## Risks

- **Navigation visibility silently drifting from actual authorization** if
  a future route changes its required role but the nav's link-filtering
  logic isn't updated in the same change — mitigated by deriving nav
  visibility from the same named role-check functions each route already
  uses (see Technical constraints), not a separately-maintained
  role-to-route table that can go stale.
- **Treating "Owner claims" as if it were its own route** during
  implementation, producing a broken or misleading link — mitigated by
  the Problem section and route/role matrix stating explicitly that it is
  a section of `/internal/moderation`, not a distinct destination.
- **A multi-role user's nav silently under-representing their access**
  (showing only one role's sections instead of the union) — mitigated by
  the explicit "union of every role's sections" requirement in User flow,
  matching `getAccessForRestaurant`'s own established "strongest
  applicable role" precedent.
- **Scope creep into redesigning an existing page** while "just adding a
  nav" — mitigated by the explicit Non-goals entry and by Phase 3 being
  scoped to *linking into* existing pages, never modifying their content.
- **The empty owner-section state reading as a bug** ("why is this blank
  for me?") rather than an honest "nothing here yet" — mitigated by
  requiring an explicit, worded empty state rather than silently omitting
  the section for an `owner`-only account.
- **Changing `/internal/login`'s redirect target having a wider blast
  radius than expected** (any other code or documentation assuming
  post-login always lands on `/internal/moderation`) — mitigated by
  making the new destination one explicit, singular decision recorded
  here (Design decision above) that Phase 2 implements as one deliberate,
  reviewable change, not a side effect of something else.
- **A role-less account being silently forwarded into a default module**
  instead of the decided "no internal access" status — mitigated by
  treating "no usable role" as its own explicit state in User flow, never
  a fallthrough to whichever section happens to be checked first in code.

## Open questions (explicitly not decided here)

- Exact mechanism for resolving the current user's roles on `/internal`
  itself: a new minimal read-only endpoint versus reusing/extending an
  existing authenticated call — an implementation decision for Phase 2,
  not fixed here.
- Whether a future dedicated owner-facing page (built under a later,
  separate ticket) eventually gives the `owner` section a real
  destination — explicitly not designed here; this ticket only commits to
  an honest empty state until that exists.
- Whether live counts/badges (e.g. pending claims or candidates needing
  review) ever appear on `/internal`'s link list — deferred; Phase 3 links
  to existing pages without duplicating their data.
- Whether the two independently-defined `isEditor(roles)` copies
  (`moderation/pending/route.js`, `claims/pending/route.js`) are ever
  consolidated into one shared export — orthogonal cleanup, not required
  by this ticket.

## Phased delivery

### Phase 1 — Route and role matrix

- Confirm and record the exact route/role matrix above as the accepted
  reference (this document) — no code.
- The login-redirect target and the role-based access behavior (including
  the no-usable-role state) are already decided (see Design decision
  above) and do not need to be revisited here. The one remaining open
  structural question before Phase 2 starts cleanly is where
  role-resolution for `/internal` itself lives (see Open questions).

### Phase 2 — `/internal` home page and shared role-aware navigation

- Build `/internal` as the role-filtered home page described in User
  flow/Information architecture, including the explicit "no internal
  access" status for an account with no usable role (Design decision #4).
- Build the shared navigation shell (mounted via `app/internal/layout.js`
  per Information architecture's technical-seam note) that every existing
  page will adopt in Phase 3.
- Update `/internal/login`'s post-sign-in redirect from the hardcoded
  `/internal/moderation` to `/internal`, per Design decision #1 — the one
  deliberate exception to "no existing route's behavior changes in this
  phase" below, since the decision explicitly requires it.
- Aside from that one redirect-target change, both are additive: no
  existing route's URL, content, or behavior changes in this phase.

### Phase 3 — Wire up existing pages and verify live accessibility

- Adopt the shared navigation shell on `/internal/coverage`,
  `/internal/import-inbox`, `/internal/profile-drafts`, and
  `/internal/moderation`, each keeping its existing content, data, and
  actions completely unchanged.
- Verify, live, for each of the three role shapes that actually exist
  today (`internal`-only, `editor`-only, and the combined
  `internal`+`editor` account already used for this project's own
  live-testing): the nav shows exactly the expected section union, a
  direct visit to an out-of-role route still 403s exactly as before, and
  keyboard/screen-reader access to the nav itself (matching this
  project's existing `role="region"`/`aria-label`/`scope="col"`-style
  accessibility conventions) works at both mobile (`~390px`) and desktop
  widths, light and dark.

### Phase 4 — Extend only through the same matrix

- Any future internal page (a new `PLATFORM-*`/`MARKET-*` ticket, or the
  eventual `owner`-facing page this ticket deliberately does not build)
  is added to the nav only by adding a row to the route/role matrix and
  reusing the same shared shell and role-check pattern — never a
  one-off, page-specific navigation mechanism.

## Acceptance criteria

- [ ] `/internal` exists, requires a signed-in session (redirects to
      `/internal/login` otherwise, matching every existing page's
      pattern), and shows a role-filtered set of links reflecting the
      union of the current session's `staff_roles`.
- [ ] `/internal/login` redirects every successful sign-in to `/internal`
      — never hardcoded to `/internal/moderation` or any other specific
      module.
- [ ] An account with zero usable roles lands on `/internal` and sees an
      explicit "no internal access" status with sign out as its only
      action — no section, no link, and no automatic redirect into any
      module.
- [ ] An `internal`-only account sees Coverage, Import Inbox, and Profile
      Drafts, and does not see a Moderation link.
- [ ] An `editor`-only account sees a single Moderation link (which itself
      still contains the existing Owner claims section unchanged) and does
      not see Coverage, Import Inbox, or Profile Drafts links.
- [ ] An account holding both `internal` and `editor` (e.g. the existing
      `developer@1am-it.com` test account) sees the full union of both
      sets in one navigation, not just one role's subset.
- [ ] An `owner`-only account sees an honest, worded empty/placeholder
      state for its section — never a blank gap, a broken link, or an
      error.
- [ ] Visiting any existing internal route directly, without going through
      the nav, still enforces exactly the same server-side authorization
      it does today — verified for at least one authorized and one
      unauthorized role per route, live.
- [ ] The navigation itself is keyboard-reachable and carries an
      accessible name for its scrollable/collapsible region if one exists,
      matching this project's existing accessibility conventions.
- [ ] Every existing internal page's own content, data, and actions are
      byte-for-byte unchanged apart from the addition of the shared nav
      shell around them.
- [ ] `/internal` and every route under it remain excluded from indexing
      (`noindex`, `robots.txt`) with no new public link anywhere.
- [ ] No restaurant photograph, image asset, or new external dependency is
      introduced.
- [ ] The nav and `/internal` home remain fully usable, with no horizontal
      overflow or clipped control, at approximately `390px`, in both light
      and dark themes.
- [ ] Structural tests (matching this project's existing
      `fs.readFileSync` + regex convention, `src/lib/*.test.js`) cover the
      new role-filtering logic and the presence of the accessibility
      attributes above.

## Suggested order

Next `PLATFORM-*` ticket after `PLATFORM-10`. Purely additive and
internal-facing — it does not block or get blocked by any `MARKET-*`
ticket, and it does not require `PLATFORM-08`/`09`/`10` to be revisited.
Reasonable to schedule as soon as there is appetite for internal-tooling
polish, since the underlying discoverability gap (Problem section) only
grows as more internal pages ship.
