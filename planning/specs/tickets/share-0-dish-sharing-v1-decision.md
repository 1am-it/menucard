# SHARE-0 — Product decision: dish sharing v1 on the BE-12 deep-link path

## Status

Open decision ticket — **awaiting an explicit product owner decision.**
Documentation only: no code, route, API, database, analytics, mockup or
deployment belongs to this ticket. `SHARE-1` (the implementation ticket)
may only be created after the three decisions below are explicitly taken
and recorded in "Decision record".

## Question

May Onze Menukaarten build a minimal "Deel gerecht" v1 on the existing
BE-12 dish deep-link path — and if so, under which product and privacy
limits — without conflicting with `MARKET-10` and decision 011?

## Context (facts)

- **`MARKET-10`** (`market-10-shareable-links.md`, proposed, not started)
  already defines shareable menu, dish and personal-selection links. Its
  full scope is blocked on `MARKET-02` (canonical identities),
  `MARKET-06` (publication snapshots and freshness), `MARKET-08` (a
  market-aware consumer read path), the trust model and an undecided
  URL/metadata strategy. It already fixes binding principles this
  decision keeps:
  - no-account sharing via the Web Share API with a copy-link fallback;
  - no personal data, private business data or internal
    provenance/moderation data in any shared payload;
  - a link preview, if any, is text-first, with no ranking language,
    paid-visibility signal or marketing claim;
  - "Share volume must **never** feed back into search ranking, a
    'popular' framing, or any prominence rule."
- **Decision 011, §6**: popularity may only affect the order of
  enrichment and review — never inclusion or neutral placement. Unknown,
  independent and new restaurants get deliberate extra attention.
- **BE-12** already ships a public dish deep link on the current static
  read path: `/menu/[id]?dish=…&name=…&cat=…`, validated by
  `src/lib/dishDeepLink.js`. The `dish` value is positional
  (`{route}-{category}-{item}`) and is accepted only when the exact name
  and category also match. Any mismatch falls back to the normal,
  unhighlighted menu — it never guesses.
- **No analytics or tracking exists** in the product today (no share API
  use, no analytics library, no tracking cookie).
- **`docs/api/data-trust-model.md`** defines a staleness window; a stale
  value is displayed as such, never as current. The consumer UI shows no
  per-menu "last checked" date today; `data/menus.json` has a per-menu
  `scraped` field whose reliability as a visible date is not verified.
- The product is **not** an ordering, delivery, booking or review
  platform (`docs/guides/design-reference.md`, "Product positioning and
  branding"; BE-07 for reservation routing).
- Visual input: two non-binding concept boards ("dish-sharing v1", not
  stored in the repository). They are directional only and not a mockup
  under `docs/mockups/` conventions (see "Mockup boundary").

## Decisions required

### D1 — May "Deel gerecht" v1 exist on the BE-12 path before `MARKET-02`, `MARKET-06` and `MARKET-08`?

- **Option A (recommended default):** yes, as a narrowly scoped v1 that
  only adds a share action to a dish that is already public and already
  deep-linkable today (BE-12). It adds no new data, identifier, surface
  or snapshot. `MARKET-10` stays the target for everything else: menu
  links, personal selections, canonical public identities, freshness
  disclosure from snapshots, and trust-gated risk fields.
- **Option B:** no; dish sharing waits for the full `MARKET-10` scope and
  its dependencies.

Why A does not conflict with `MARKET-10`: `MARKET-10`'s dependencies
protect a *new, durable, indefinitely cacheable* public surface carrying
its own data. V1 creates no such surface. The shared link opens the
existing menu page, which already shows the same data to anyone. V1
copies no price, availability or allergen value into the link, the share
text or the preview, so no extra stale copy of risk-sensitive data
exists. Instead of a freshness date (which needs `MARKET-06`), the
receiving page states "Prijs en beschikbaarheid kunnen wijzigen." Taking
option A is a recorded, narrow carve-out from `MARKET-10`'s blockers for
this one action — not a change to `MARKET-10`'s own scope.

### D2 — Does v1 stay completely free of measurement?

- **Option A (recommended default):** yes. V1 records nothing: no share
  event, no open count, no copy count, no identifier. Any later
  aggregated measurement (for example anonymous daily totals) is a
  separate decision with its own privacy assessment, data model,
  retention period and bot/preview handling — not part of `SHARE-0` or
  `SHARE-1`.
- **Option B:** v1 includes aggregated measurement. Not recommended: it
  adds a write path, an abuse surface and privacy obligations to a
  feature whose value does not depend on it.

### D3 — Does public popularity stay forbidden?

- **Option A (recommended default, and required by `MARKET-10` and
  decision 011 §6 as they stand):** yes. No "Vaak gedeeld", "Recent
  gedeeld", "Populair om te delen", ranking, filter, sort, counter, badge
  or prominent placement based on sharing — anywhere public.
- **Option B:** allow a public popularity signal. This is **not decidable
  in this ticket**: it would require its own decision record that
  explicitly amends `MARKET-10`'s neutrality principle and the rationale
  of decision 011 §6, including thresholds, anti-manipulation measures
  and fairness towards small restaurants.

## V1 boundary (applies when D1 = A, D2 = A and D3 = A)

In scope:

- A "Deel gerecht" action per dish on the menu page.
- The native share sheet (Web Share API), with "Kopieer link" as the
  fallback wherever the share sheet is unavailable.
- A safe deep link that reuses the BE-12 contract (`dish`, `name`, `cat`
  on `/menu/[id]`). It may carry one constant, non-unique marker that the
  link came from sharing, only to show the neutral receiving-page notice.
  That marker is never stored or counted by the product.
- A text-first link preview: dish name, restaurant name, city and the
  Onze Menukaarten name. No image, no price, no ranking.
- The receiving dish page: the existing menu page with the dish
  highlighted (BE-12 behaviour), plus:
  - the neutral notice "Je bekijkt een gedeelde gerechtlink.";
  - "Prijs en beschikbaarheid kunnen wijzigen.";
  - the call to action "Bekijk menukaart" — not "Bekijk actuele
    menukaart" until freshness can be shown with evidence.

Out of scope for v1:

- Price in the link, share text or preview; a "Laatst gezien" or other
  freshness date.
- Ranking, counters, "Vaak gedeeld"/"Recent gedeeld", filters, sorting,
  a share dashboard or statistics.
- A Story/image share card ("Deel als kaart").
- Social login, accounts, contacts, recipient profiles, message content,
  tracking pixels, cookies, `localStorage`, unique share IDs or any other
  identifier.
- Any claim that something was ordered, sent, received or forwarded
  (no "Iemand deelde dit gerecht met je", no "verstuurd", no "via
  WhatsApp gedeeld"). After copying, the UI says only "Link gekopieerd".
- Menu links and personal multi-dish selections (they stay in
  `MARKET-10`).
- Any change to search, ranking, reservation routing (BE-07) or public
  navigation.

## Changed or disappeared dishes

- A shared link resolves only through the BE-12 checks: position, exact
  name and exact category. There is never a "closest" or "probable"
  match, and never a link to a different dish.
- If the dish no longer resolves (moved, renamed, re-categorised or
  removed), the page shows the current menu without a highlight. For a
  shared link, `SHARE-1` must add a visible, neutral notice that the dish
  could not be found on the current menu, instead of BE-12's silent
  fallback.
- If the restaurant or menu no longer exists, the page offers a working
  next step (decision 014: no dead ends) — never a bare error.
- Stable public dish identities are `MARKET-02`/`MARKET-10` work and are
  not introduced by v1.

## Mockup boundary

The concept boards are input only:

- Board 1 keeps only "Deel gerecht", "Delen met je apps" and "Kopieer
  link". "Deel als kaart", "Vaak gedeeld", "Recent gedeeld" and the
  "Vaak gedeeld" filter are dropped from v1. The decorative restaurant
  illustration is optional, not part of the existing visual standard,
  and needs its own decision against decision 002.
- Board 2 is limited, if used at all, to the receiving dish page, with
  the copy rules above. The share dashboard, "Populair om te delen",
  ranking and share statistics are later work under D2/D3 and are not
  part of v1.
- Typography and colour follow `docs/guides/design-reference.md`
  ("Kleurtaal v2"), not the boards. Serif display type, the account icon
  and the navigation items shown on the boards are not adopted.
- Any v1 mockup committed later follows `docs/mockups/` conventions
  (`<surface>-v<N>.png`, indexed in `docs/mockups/README.md`).

## Privacy, accessibility and design guardrails

- No personal data is collected or stored; the share sheet itself never
  tells the product where or with whom anything was shared, and v1 does
  not try to find out.
- Light and dark per the existing theme contract; Kleurtaal v2 tokens
  only; text at least 4.5:1 and focus at least 3:1 in both themes; a
  visible `:focus-visible` treatment; keyboard operable; no horizontal
  overflow at 320, 390 and 1280 px (decision 014 acceptance checklist).
- Status and notices are icon plus text, never colour alone. The share
  action is a secondary, outlined control — never styled as an ordering
  or primary action.
- Text-first: no restaurant or dish photography in the action, the
  preview or the receiving page. Performance stays within decision 003's
  budget; no new dependency.

## Acceptance criteria (for this decision ticket)

- [ ] D1, D2 and D3 are each explicitly decided by the product owner and
      recorded below, with date.
- [ ] The decisions do not conflict with `MARKET-10` or decision 011: D3
      stays forbidden unless a separate decision record amends them, and
      D1 = A is recorded as a narrow carve-out that leaves `MARKET-10`'s
      own scope and dependencies unchanged.
- [ ] The v1 boundary keeps the product clearly not an ordering,
      delivery, booking or review platform.
- [ ] Privacy, accessibility, light/dark and text-first guardrails are
      recorded as binding for `SHARE-1`.
- [ ] A changed or disappeared dish can never lead to a guess or a wrong
      dish (BE-12 checks, visible neutral notice, no dead end).
- [ ] `SHARE-1` is created only after this decision is taken; it
      references this ticket and adds a cross-reference to `MARKET-10`.

## Decision record

To be filled in by the product owner. Until then, nothing is decided.

| Decision | Choice | Date | By |
|---|---|---|---|
| D1 — v1 on the BE-12 path before `MARKET-02/06/08` | _open_ (recommended: A) | | |
| D2 — v1 without any measurement | _open_ (recommended: A) | | |
| D3 — public popularity stays forbidden | _open_ (recommended: A) | | |

## Follow-up (not created by this ticket)

- `SHARE-1` — "Deel gerecht" v1 implementation, only after the decision
  record above is complete.
- A separate measurement decision, only if D2 is later revisited.
- A separate decision record amending `MARKET-10`/decision 011, only if
  public popularity is ever reconsidered.
