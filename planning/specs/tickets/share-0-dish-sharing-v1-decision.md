# SHARE-0 — Product decision: dish sharing v1 on the BE-12 deep-link path

## Status

Open decision ticket — **awaiting an explicit product owner decision.**
Documentation only: no code, route, API, database, analytics, mockup or
deployment belongs to this ticket. `SHARE-0` authorizes no implementation
and does not change `MARKET-10`, decision 011 or `BE-12`. `SHARE-1` (the
implementation ticket) may only be created after the three decisions below
are explicitly taken and recorded in "Decision record" — and, if D1 = A,
after the separate `MARKET-10` change described under D1 has been recorded.

## Question

Should Onze Menukaarten pursue a minimal "Deel gerecht" v1 on the existing
BE-12 dish deep-link path — and if so, under which product and privacy
limits, and what would first have to change in `MARKET-10` for it to be
allowed?

## Context (facts)

- **`MARKET-10`** (`market-10-shareable-links.md`, proposed, not started)
  already defines shareable menu, dish and personal-selection links. Its
  full scope is blocked on `MARKET-02` (canonical identities),
  `MARKET-06` (publication snapshots and freshness), `MARKET-08` (a
  market-aware consumer read path), the trust model and an undecided
  URL/metadata strategy (its dependency 5, which includes what a
  link-preview card needs server-side). It already fixes binding
  principles this decision keeps:
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
  (`{route}-{category}-{item}`) and is accepted only when the name and
  category also match: the name comparison is trimmed and
  case-insensitive, the category comparison is exact. Any mismatch falls
  back to the normal, unhighlighted menu without a notice — it never
  guesses, but the fallback is silent today.
- The menu route (`app/menu/[id]/page.js`) has no per-dish metadata, Open
  Graph or link-preview output today.
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

### D1 — Should a "Deel gerecht" v1 on the BE-12 path be pursued before `MARKET-02`, `MARKET-06` and `MARKET-08`?

- **Option A (recommended default):** yes, in principle, as a narrowly
  scoped v1 that only adds a share action to a dish that is already
  public and already deep-linkable today (BE-12). It adds no new data,
  identifier, URL shape, metadata surface or snapshot.
- **Option B:** no; dish sharing waits for the full `MARKET-10` scope and
  its dependencies.

What option A does and does not mean: `MARKET-10` lists its dependencies
as hard blockers for shareable dish links, and `SHARE-0` cannot waive
them. Choosing A records the product owner's intent to pursue v1; it does
**not** authorize implementation. Before `SHARE-1` may be created, an
explicit, separately recorded change is required — either an amendment to
`MARKET-10` itself or a higher decision record — that allows this narrow
exception and states why each `MARKET-10` dependency is not needed for
it. `SHARE-0` does not make that change.

The argument such a change would have to weigh: `MARKET-10`'s
dependencies protect a *new, durable, indefinitely cacheable* public
surface carrying its own data. V1 as bounded below would add no such
surface: the link is the existing canonical BE-12 link, it opens the
existing menu page that already shows the same data to anyone, and there
is no per-dish preview or metadata output. V1 copies no price,
availability or allergen value into the link or the share text, so no
extra stale copy of risk-sensitive data exists. Instead of a freshness
date (which needs `MARKET-06`), the dish page states "Prijs en
beschikbaarheid kunnen wijzigen."

### D2 — Does v1 stay completely free of measurement?

- **Option A (recommended default):** yes. V1 records nothing: no share
  event, no open count, no copy count, no identifier, no marker. Any
  later aggregated measurement (for example anonymous daily totals) is a
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

## V1 boundary (applies only when D1 = A, D2 = A, D3 = A and the `MARKET-10` change under D1 is recorded)

In scope:

- A "Deel gerecht" action per dish on the menu page.
- The native share sheet (Web Share API), with "Kopieer link" as the
  fallback wherever the share sheet is unavailable.
- The link is exactly the canonical BE-12 deep link (`dish`, `name`,
  `cat` on `/menu/[id]`) and nothing else: no share, source, campaign or
  any other extra query parameter, marker or fragment — also not one that
  would never be stored. A shared link is indistinguishable from any
  other BE-12 dish link, by design.
- Share text handed to the share sheet is composed only from validated
  menu data of the resolved dish (dish name, restaurant name, city) plus
  the Onze Menukaarten name — never from raw query-string values, and
  never with price, availability, allergen or ranking language.
- The dish page, for **every** BE-12 dish deep link (not only shared
  ones, since sharing is not detectable): the existing menu page with the
  dish highlighted (BE-12 behaviour), plus copy that is true for any dish
  deep link:
  - "Je bekijkt een gerecht uit de menukaart.";
  - "Prijs en beschikbaarheid kunnen wijzigen.";
  - the call to action "Bekijk menukaart" — not "Bekijk actuele
    menukaart" until freshness can be shown with evidence.

Out of scope for v1:

- Any per-dish link preview, Open Graph tags, dynamic metadata or other
  preview surface. This stays out until `MARKET-10`, its URL/metadata
  strategy (dependency 5) and the trust model explicitly allow it. A
  share sheet or messenger may still show the page's existing, generic
  metadata; v1 adds nothing dish-specific to it.
- Price in the link or share text; a "Laatst gezien" or other freshness
  date.
- Ranking, counters, "Vaak gedeeld"/"Recent gedeeld", filters, sorting,
  a share dashboard or statistics.
- A Story/image share card ("Deel als kaart").
- Social login, accounts, contacts, recipient profiles, message content,
  tracking pixels, cookies, `localStorage`, unique share IDs, share
  markers or any other identifier.
- Any claim that something was shared, ordered, sent, received or
  forwarded (no "Je bekijkt een gedeelde gerechtlink", no "Iemand deelde
  dit gerecht met je", no "verstuurd", no "via WhatsApp gedeeld"). After
  copying, the UI says only "Link gekopieerd".
- Menu links and personal multi-dish selections (they stay in
  `MARKET-10`).
- Any change to search, ranking, reservation routing (BE-07) or public
  navigation.

## Changed or disappeared dishes

- A dish link resolves only through the BE-12 checks: position, name
  (trimmed, case-insensitive) and category (exact). There is never a
  "closest" or "probable" match, and never a link to a different dish.
- **Every** BE-12 dish deep link that does not resolve (moved, renamed,
  re-categorised or removed) shows a visible, neutral status on the
  current menu, for example "Dit gerecht staat niet (meer) op deze
  menukaart.", as icon plus text, never colour alone. No dish is
  highlighted and none is guessed. This replaces BE-12's silent fallback
  for all dish deep links, not only shared ones; `SHARE-1` must treat it
  as an explicit, tested change to BE-12 behaviour.
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
- Board 2 is limited, if used at all, to the dish page reached through a
  dish deep link, with the copy rules above (no "gedeelde" wording, no
  preview card). The share dashboard, "Populair om te delen", ranking and
  share statistics are later work under D2/D3 and are not part of v1.
- Typography and colour follow `docs/guides/design-reference.md`
  ("Kleurtaal v2"), not the boards. Serif display type, the account icon
  and the navigation items shown on the boards are not adopted.
- Any v1 mockup committed later follows `docs/mockups/` conventions
  (`<surface>-v<N>.png`, indexed in `docs/mockups/README.md`).

## Privacy, accessibility and design guardrails

- No personal data is collected or stored; the share sheet itself never
  tells the product where or with whom anything was shared, and v1 does
  not try to find out — not through a query marker, not otherwise.
- Light and dark per the existing theme contract; Kleurtaal v2 tokens
  only; text at least 4.5:1 and focus at least 3:1 in both themes; a
  visible `:focus-visible` treatment; keyboard operable; no horizontal
  overflow at 320, 390 and 1280 px (decision 014 acceptance checklist).
- Status and notices are icon plus text, never colour alone. The share
  action is a secondary, outlined control — never styled as an ordering
  or primary action.
- Text-first: no restaurant or dish photography in the action, the share
  text or the dish page. Performance stays within decision 003's budget;
  no new dependency.

## Acceptance criteria (for this decision ticket)

- [ ] D1, D2 and D3 are each explicitly decided by the product owner and
      recorded below, with date.
- [ ] If D1 = A, a separate, explicit change to `MARKET-10` (or a higher
      decision record) allowing the narrow exception is recorded before
      `SHARE-1` is created; `SHARE-0` itself changes nothing in
      `MARKET-10`.
- [ ] D3 stays forbidden unless a separate decision record amends
      `MARKET-10` and decision 011.
- [ ] The v1 link is exactly the canonical BE-12 deep link, with no
      extra parameter or marker, and v1 adds no per-dish preview or
      metadata surface.
- [ ] Dish-page copy is true for every dish deep link; nothing claims a
      link was shared, sent or received.
- [ ] The v1 boundary keeps the product clearly not an ordering,
      delivery, booking or review platform.
- [ ] Privacy, accessibility, light/dark and text-first guardrails are
      recorded as binding for `SHARE-1`.
- [ ] A changed or disappeared dish can never lead to a guess or a wrong
      dish: BE-12 checks, a visible neutral status for every
      non-resolving dish link, no dead end.
- [ ] `SHARE-1` is created only after this decision is taken; it
      references this ticket and the recorded `MARKET-10` change.

## Decision record

To be filled in by the product owner. Until then, nothing is decided.

| Decision | Choice | Date | By |
|---|---|---|---|
| D1 — pursue v1 on the BE-12 path before `MARKET-02/06/08` | _open_ (recommended: A) | | |
| D2 — v1 without any measurement | _open_ (recommended: A) | | |
| D3 — public popularity stays forbidden | _open_ (recommended: A) | | |

## Follow-up (not created by this ticket)

- If D1 = A: an explicit change to `MARKET-10` or a higher decision
  record that allows the narrow v1 exception.
- `SHARE-1` — "Deel gerecht" v1 implementation, only after the decision
  record above is complete and, for D1 = A, the `MARKET-10` change is
  recorded.
- A separate measurement decision, only if D2 is later revisited.
- A separate decision record amending `MARKET-10`/decision 011, only if
  public popularity is ever reconsidered.
