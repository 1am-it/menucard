# Decision — Navigation & Orientation Standard

## Status

Accepted

## Context

MenuCard now spans three structurally different kinds of surface —
consumer discovery pages (`BE-*`), internal role-gated tooling
(`PLATFORM-*`), and narrow, single-purpose public flows (`PLATFORM-07`'s
owner claim, the community-evidence submissions planned in
`platform-08b-community-evidence-submissions.md`) — and this project has,
until now, decided navigation and orientation conventions **per ticket**,
ad hoc, rather than once. Two concrete, already-observed problems make
that no longer sufficient:

- `PLATFORM-11` had to independently invent an entire discoverability
  layer (a role-filtered `/internal` home, a shared nav shell, an
  explicit "no internal access" state, a union-of-roles visibility rule)
  because no general standard existed to reuse — its own ticket
  documents this as a real usability gap, not a hypothetical one (see
  that ticket's "Problem" section).
- A real, shipped defect this project's own review process found and
  fixed (`/nvwa/[id]`'s header overflowing at ~390px because its
  right-hand control group lacked the `flex-wrap` treatment every other
  page's shared header already had) was exactly the kind of
  inconsistency a written, reusable standard exists to prevent —
  discovered late, by inspection, rather than caught by a checklist every
  UI ticket already had to satisfy.

Left undecided, every future ticket that touches navigation — the
community-evidence flows, a future menu-consumption UI, `PLATFORM-11`'s
own later phases, and any surface not yet designed — would keep
re-deriving the same rules from scratch, with no guarantee of consistency
and no shared acceptance bar to review against.

## Decision

The following is a **system-wide, hard standard** for every current and
future MenuCard route — consumer, internal, and focused-process alike.
It generalizes principles this project has already applied inconsistently
(role-filtered navigation in `PLATFORM-11`; `aria-current` on the active
link; the responsive header-wrap pattern first established for
`/restaurants`, BE-10, and later needed again for `/nvwa/[id]`) into one
reusable reference, so no future ticket has to re-derive them.

### 1. Every page provides orientation

Every route states, unambiguously: what page this is (a real page title,
not only a generic site name), the primary navigation where one applies
to that surface, and — for any route reachable only via a deeper link,
never directly from a top-level entry point — a logical back or parent
destination. A route is never left to communicate "where am I" through
implication alone.

### 2. Repeated primary navigation is stable

Wherever a primary navigation is shown more than once (the shared
consumer header, `PLATFORM-11`'s internal nav shell), it uses the
**same order, the same labels, and the same relative position** every
time it appears. The active destination is marked **both visually and
programmatically** (`aria-current="page"`, never color alone) — exactly
`src/components/InternalNav.js`'s existing
`aria-current={pathname === m.href ? 'page' : undefined}` pattern,
generalized as the required approach everywhere a repeated nav exists,
not a `PLATFORM-11`-specific choice.

### 3. Three explicit navigation patterns — never conflated

- **Public/consumer navigation** (`/`, `/search`, `/restaurants`,
  `/restaurant/[id]`, `/menu/[id]`, `/nvwa/[id]`): the existing
  lightweight header (logo, theme toggle, a page-appropriate back link) —
  text-first, no full menu bar required, per this project's own
  discovery-first product principles.
- **Internal navigation** (`/internal/*`): the role-filtered shell
  `PLATFORM-11` already established — a shared nav surfacing only the
  modules the signed-in session's roles unlock, plus a way back to
  `/internal` itself from any module.
- **Focused-process pages** (a claim flow, a community-evidence
  submission form, any future single-purpose "do exactly one thing" page):
  may deliberately show a **reduced** chrome — it does not need to
  reproduce the full primary navigation from either of the two patterns
  above. What it may never do is leave the visitor with **no way forward
  and no way back that isn't the browser's own history** — see item 10.

### 4. Role-driven navigation shows access; it never grants it

A navigation's role-based filtering (which modules/links appear) is
**exclusively a discoverability layer**. It must never be treated as, or
substitute for, the actual authorization decision. Every route and API
keeps enforcing its own unchanged, independent server-side check — this
restates, as a permanent, general rule, exactly what `PLATFORM-11`'s own
"Technical constraints" already established for its one surface: *"Hiding
a link never substitutes for a route's own
`authenticateInternalRequest`/`isInternalOnly`/`isEditor` check... a
direct-URL visit by an unauthorized role must still `403` exactly as it
does now."* A future ticket introducing role-aware navigation anywhere
else in the product inherits this same, non-negotiable separation.

### 5. Mobile keeps the same information architecture as desktop

Mobile never drops a route or an essential action that exists on
desktop. A navigation menu may **collapse** (an accordion, a stacked
list, a disclosure control) — it may never **remove** a destination or
action, and it may never cause page-level horizontal overflow. This is
the exact, now-proven pattern this project already uses twice
independently (`.header-right`'s `flex-wrap` treatment for `/restaurants`,
BE-10; `.nvwa-header-actions`'s identical fix for `/nvwa/[id]`, applied
after a real, measured ~46px overflow was found and corrected) —
generalized here so a third page never needs to rediscover it from
scratch. `document.documentElement.scrollWidth <= document.documentElement.clientWidth`
at approximately `390px` is the concrete, checkable bar (see the
acceptance checklist below).

### 6. Accessible by construction, not by later remediation

- Semantic `<nav>`/`<a>`/landmark elements, never a `<div>` with a click
  handler standing in for a link.
- A skip-link to main content, reachable as the first focusable element
  on every page that carries a navigation region.
- Visible keyboard focus on every interactive element — an explicit
  `:focus-visible` treatment, not reliance on a browser default that a
  global reset may have suppressed.
- A logical focus order matching visual/reading order.
- `aria-current="page"` on the active destination in any repeated
  navigation (see item 2).
- A mobile menu control (if one exists) is itself keyboard-operable and
  exposes its expanded/collapsed state (`aria-expanded`).

### 7. Focus lands somewhere deliberate after navigating

After a client-side navigation, or after closing a mobile menu/overlay,
keyboard focus moves to a logical, deliberate location (typically the
newly-loaded page's main heading, or back to the control that opened an
overlay when it closes) — never left stranded on a now-hidden or
removed element, and never silently reset to the very top of the
document by default without regard for where the user's attention should
land.

### 8. Every dead-end state offers a next step

Being signed out, a `403`, a `404`, an empty result, and a successful
submission each present **at least one clear, working action** — a link
home, a link to sign in, a link back to the relevant listing, or (for a
successful submission) confirmation plus a way to continue. None of
these states is ever a bare error message with nothing clickable. Several
existing pages already do this correctly and are the reference pattern —
see "Known compliant patterns" below.

### 9. A JSON response is never the human page experience

`/api/*` routes return JSON, as they already do throughout this project.
A UI route (anything a human is meant to land on and read) never
responds with a raw JSON body as its rendered experience — it always
renders an actual page, even for an error or empty state.

### 10. No fake buttons, no hidden primary actions, no history-only escape

A control that looks actionable is actionable — no visually-real button
wired to nothing, and no disabled-but-real-looking control implying a
capability that doesn't exist (the same principle
`market-04b-controlled-csv-jsonl-intake.md` and
`platform-08b-community-evidence-submissions.md` already apply to their
own future UIs, generalized here to every surface). The page's single
most important action is never hidden behind an unlabeled icon or buried
below unrelated content. And — restated plainly because it is the most
concrete, checkable form of item 3's "never a dead end" — **the
browser's own Back button is never the only way to leave a focused
-process page**; an explicit link or action must exist.

### 11. Text-first and light, including in navigation itself

Navigation chrome requires no image asset to function, introduces no new
external dependency without an explicit, stated justification (matching
this project's existing `CLAUDE.md`/`PLATFORM-11` precedent — plain
`<Link>`/`usePathname()`, no routing or menu component package), and
never issues a duplicate roles/session fetch when a caller has already
resolved one — exactly `src/components/InternalNav.js`'s own
`accessToken`/`roles` prop pattern (*"the page's roles and the nav's
roles are never two independent fetches racing each other"*), restated
here as the general rule for any future shared navigation component, not
a one-off optimization specific to `PLATFORM-11`.

## Acceptance checklist — include in every future UI ticket

- [ ] Verified at desktop width and at approximately `390px`, in both
      light and dark themes.
- [ ] The current destination is visible, both to sighted users and
      programmatically (`aria-current` or equivalent).
- [ ] Keyboard operability and visible focus verified, including focus
      placement after navigation or closing any menu/overlay.
- [ ] No page-level horizontal overflow at `390px`
      (`document.documentElement.scrollWidth <= clientWidth`).
- [ ] Logged-out, `403`, `404`, empty, and (where applicable) success
      states each offer at least one working next step.
- [ ] Every link/action points at a destination that actually exists and
      that the current viewer is actually authorized to reach — no link
      to a route that 403s by design for the role that sees it.
- [ ] Server-side route/API authorization is verified unchanged — a
      navigation change never substitutes for or weakens it.

## Relationship to `PLATFORM-11`

`PLATFORM-11` is this standard's **first concrete implementation**, not a
separate or competing set of rules — its already-shipped `/internal`
home and shared nav shell (`app/internal/page.js`,
`src/components/InternalNav.js`, `src/lib/internalNav.js`; commit
`af389ca`) already satisfy items 2, 4, 6 (partially — see "Known
deviations"), and 11 above. `PLATFORM-11`'s own ticket document is not
rewritten by this decision — its route/role matrix, phased delivery, and
acceptance criteria stand exactly as written. Its **remaining** phases
(3 and 4: wiring the shared shell onto every existing internal page, and
extending the module list for future tickets) must continue to satisfy
this standard's checklist, not only `PLATFORM-11`'s own, narrower
acceptance criteria.

## Relationship to community and menu flows

`platform-08b-community-evidence-submissions.md`'s public flows
(missing-restaurant, correction, menu-link, and the later, gated photo
-evidence phase) are **focused-process pages** under item 3 above — they
do not need the full consumer header, but every one of them must satisfy
item 8 (a clear next step at every status) and item 10 (never a
history-only escape) once built. Any future consumer-facing surface that
eventually renders a published `MenuProposal` (`market-02b-menu-proposal-publication-contract.md`)
is public/consumer navigation under item 3 and must satisfy this
standard in full, including item 2's stable primary-navigation
requirement. This decision does not alter either ticket's own scope,
priorities, or data-model choices — it only states, once, the navigation
obligation both will need to meet when their own UI is actually built.

## Known compliant patterns today (verified against current code)

- `src/components/InternalNav.js`'s `aria-current` usage on the active
  internal-nav link (item 2, item 6).
- `app/internal/page.js`'s explicit "No internal access for this
  account" status with a working sign-out action — never a blank page
  for a role-less account (item 8).
- `app/claim/[restaurantId]/ClaimView.js`'s "Restaurant niet gevonden" →
  `← Terug naar overzicht` link (item 8), and equivalent not-found states
  in `NvwaView.js`, `RestaurantDetailView.js`, and `MenuView.js`.
- `.header-right`'s (BE-10, `/restaurants`) and `.nvwa-header-actions`'s
  (`/nvwa/[id]`) narrow-viewport `flex-wrap` treatment — the proven
  reference pattern for item 5.
- The existing, project-wide `/api/*` (JSON) vs. page-route (HTML)
  separation — item 9 is already satisfied everywhere; nothing to change.
- `InternalNav`'s `accessToken`/`roles` prop, avoiding a duplicate roles
  fetch when a parent page already resolved one (item 11).
- Server-side authorization (`authenticateInternalRequest`/
  `isInternalOnly`/`isEditor`, `authenticateAnyUser`) already exists,
  independently of any navigation UI, on every gated route — item 4's
  hard separation is already true in practice; this decision makes it an
  explicit, permanent rule rather than an implicit property of the
  current code.

## Known deviations (existing gaps, future work — not fixed by this decision)

- **No skip-link to main content exists anywhere in the codebase today**
  (item 6) — a real, verified gap, not a hypothetical one.
- **No site-wide `:focus-visible` convention.** Exactly one rule
  (`.di-accordion-trigger:focus-visible` in `app/globals.css`) exists
  project-wide — keyboard focus visibility elsewhere depends on browser
  defaults, unverified against this project's own reset styles (item 6).
- **No custom `app/not-found.js`.** A visit to a genuinely unknown route
  falls through to Next.js's default 404, not a branded page with a
  working next step (item 8).
- **`ClaimView.js`'s normal (non-"not-found") states have no way back**
  except the browser's own history — the magic-link form, the "link
  sent," and the "claim submitted" states show no header, logo, or
  explicit link elsewhere in the flow (items 1, 3, 10). This is the
  clearest existing instance of the exact gap item 10 exists to close.
- **`PLATFORM-11` is built and pushed (commit `af389ca`), with live
  acceptance validation partial — not "not started."** Its ticket's own
  Status line reads *"Built and pushed (commit `af389ca`). Live
  acceptance validation partial"*, per that ticket's own "Implementation
  and verification (2026-09-13)" section, which is the current source of
  truth for exactly what is shipped and what remains open. What remains
  outstanding there is (a) live, role-gated verification — the multi-role
  union, the editor-only view, the role-less status, and in-nav
  keyboard/`aria-current` behavior, for the existing account shapes this
  project already has — currently blocked by this environment's own
  tooling restriction on session-minting, not by a design or account gap;
  and (b) the separate navigation deviations this document's own list
  records below (skip-link, the project-wide `:focus-visible` convention,
  a custom `404`, and `ClaimView.js`'s recovery path) — each still future
  work, unchanged by `PLATFORM-11`'s own status update.
- **Consumer deep routes have no explicit "back to results" affordance**
  beyond the shared header's logo-as-home-link — `/menu/[id]` and
  `/restaurant/[id]` rely on browser back or the logo to return to a
  prior search, which is not itself a violation (the logo is a real,
  working link) but is weaker than a page-specific parent destination
  under item 1 and worth revisiting.

## Consequences

- Every future UI ticket must include and satisfy the acceptance
  checklist above — a reviewer can check a ticket against it directly,
  rather than re-deriving navigation expectations each time.
- Existing pages are not retroactively required to change because of
  this decision alone — the "Known deviations" above are recorded as
  future work, not an implicit mandate to fix them now. A ticket that
  touches one of those surfaces for another reason should close the
  relevant gap as part of that work, not as a separate, unscoped
  navigation-only ticket.
- `PLATFORM-11`, `platform-08b-community-evidence-submissions.md`, and
  any future menu-consumption UI built on `MARKET-02B` inherit this
  standard directly, per the "Relationship to" sections above, without
  needing their own tickets to restate it.

## Rejected alternative

Continue deciding navigation/accessibility/mobile conventions per ticket,
as this project has done until now.

Reason: this has already produced a real, shipped defect
(`/nvwa/[id]`'s mobile header overflow) that a shared checklist would
have caught before implementation, and required `PLATFORM-11` to
independently invent an entire discoverability layer from first
principles rather than applying an existing, reusable standard. Deciding
this once, generally, is cheaper than re-deriving it per surface and
catching the gaps only by inspection after the fact.
