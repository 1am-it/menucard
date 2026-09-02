# MARKET-10 — Shareable Menu, Dish, and Personal-Selection Links

## Status

Proposed, **not started**. Documentation/roadmap definition only — this
ticket cannot begin implementation until every item in "Dependencies"
below is satisfied. No UI, API, database, tracking, or code exists yet.

## Depends on

`MARKET-02` (canonical schema — restaurant/menu/item identities),
`MARKET-06` (publication snapshots — version/freshness context),
`MARKET-08` (a market-aware consumer read path — the actual page a shared
link opens), and `docs/api/data-trust-model.md`/`MARKET-02`'s
`FieldAssertion` (trust-gated display of risk-sensitive fields). See
"Dependencies" below for why each is a hard blocker, not a nice-to-have.

## Objective

Let a visitor create a durable, direct, no-account-required public link to
a full menu (with meal-moment context), a single dish, or a personal
multi-dish selection — so they can share "what to eat" with someone else.
This is explicitly **not** a shopping cart, reservation system, review
feature, or paid-promotion mechanism.

## User story

As a visitor deciding where to eat with others, I want to share the exact
menu, dish, or shortlist I'm looking at, so my table companions see
precisely what I mean instead of a vague description or a screenshot.

## Scope

- **Three link types**: whole menu (with its meal-moment — lunch/diner/
  borrel — context preserved), a single dish, and a personal selection of
  multiple dishes assembled as a proposal to table companions.
- **Durable and direct**: a shared link opens exactly the shared
  restaurant, meal-moment, menu, or dish — never a generic homepage or
  search result the recipient has to re-navigate from.
- **Factual, publishable-at-that-moment content only**: restaurant name,
  city (not a full street address unless already public elsewhere),
  relevant price information, and meal-moment context. Nothing not already
  safe to publish under the existing trust/data-minimisation principles.
- **Freshness/version disclosure**: because menus, prices, and
  availability change, a shared page must show when the shown version was
  published/last checked — sourced from `MARKET-06`'s snapshot version/
  publication-date metadata, not invented at share-time.
- **Trust-gated allergen/diet labels**: allergen and dietary-claim labels
  are included only when the underlying `FieldAssertion` meets the
  existing trust-model bar for a risk-sensitive field (`docs/api/data-trust-model.md`)
  — not shown unconditionally just because a value exists in the record.
- **No-account sharing**: Web Share API on supporting devices, with a
  copy-link fallback everywhere else. No login, no account creation.
- **Strict data minimisation**: a shared payload never includes personal
  data, private business data, or internal provenance/moderation
  information (claim evidence, reviewer identity, internal notes) — the
  same discipline `MARKET-03`'s `basic_info` category already established
  for the source registry, applied here to what a *public* page may show.
- **Future, optional rich link-preview card** (WhatsApp/iMessage/social):
  restaurant name, menu/dish title, a price indication where trustworthy,
  MenuCard's own identity, and a short neutral description. Explicitly
  forbidden in the preview: unexplained ranking language, paid-visibility
  signals, or marketing claims of any kind.
- **Personal selections are ephemeral and client-side by default** — no
  server-side persistence, no account, in this ticket's scope.
- **Analytics stay aggregate and neutral** — see its own section below.

## Out of scope

- Ordering, checkout, or payment of any kind.
- Reservation integration — stays exactly `BE-07`'s existing reservation
  routing; a shared page may link to it, but does not reimplement it.
- Reviews, ratings, or any user-generated commentary.
- Any paid or sponsored placement — forbidden outright by
  `[[011-market-foundation-and-international-growth]]` §6 ("paid
  visibility must never buy placement in neutral/organic search results"),
  which this ticket extends to shared-link and preview-card contexts too.
- A save-able, cross-device, or collaborative personal selection. That is
  a later, separate privacy and product decision — not decided or
  designed here (see Open questions).
- Any UI, API endpoint, database schema/migration, tracking pixel, or
  analytics implementation. This ticket is documentation/roadmap only.
- Any change to today's static consumer read path (`data/restaurants.json`
  / `data/menus.json`). This feature structurally cannot exist on that
  path (see Dependencies) and is not being retrofitted onto it.

## Dependencies (hard blockers, mapped to this ticket's own prerequisites)

1. **Stable public identities.** `MARKET-02` gives restaurants, menus, and
   menu items a stable *canonical* `id` — but "stable" (safe to reference
   internally forever) is not automatically "public-safe" (safe to expose
   in a URL forever, safe to not leak internal sequencing/table-origin
   information). **This is an explicit gap `MARKET-02` does not close** —
   flagged here, resolved by this ticket's own URL/metadata decision
   (Open questions), not assumed away.
2. **Version/freshness context.** A shared link's freshness-disclosure
   requirement needs `MARKET-06`'s snapshot version/publication-date
   metadata to exist and be queryable. Without it, "as seen on [date]"
   cannot be shown honestly.
3. **Trust-filtered risk data.** Price, availability, and allergen/diet
   fields must be filterable by `trust_source`/`confidence`
   (`docs/api/data-trust-model.md`, `MARKET-02`'s `FieldAssertion`) before
   they may appear on a durable, public, indefinitely-cacheable surface —
   a `low`-confidence or stale value needs the same graceful-degradation
   `BE-07` already established for unverified reservation methods, not a
   new, weaker standard because "it's just a share page."
4. **A consumer-facing page to open.** `MARKET-08` (at minimum) must exist
   so a shared link has an actual market-aware route to resolve to —
   sharing cannot precede having something shareable to load.
5. **URL and metadata strategy — not decided by any existing ticket.**
   Canonical vs. share-specific URL shape, whether shared pages are
   search-engine indexable, and what a link-preview card needs
   server-side (see Open questions) must be decided explicitly before
   implementation starts. This is named here as its own precondition,
   not solved by this ticket.

## Data model needs

None new modeled here. Reuses `MARKET-02`'s canonical objects and
`FieldAssertion`/trust model as-is — a shared page is a *read* of already
-published data, not a new data shape. A personal selection's default
(ephemeral, client-side) form needs no persistence at all; a later,
separate decision to make selections saveable would be new data-model
work, explicitly not implied or pre-designed by this ticket.

## Moderation/verification needs

None directly. A shared link only ever displays already-reviewed,
already-published canonical/snapshot data — it introduces no new
content-authoring or proposal path, and does not touch `PLATFORM-06`'s
moderation queue.

## Analytics and neutrality principles

- Share activity, if measured at all, is aggregated and privacy-aware —
  never a per-visitor tracking profile, never tied to a personal
  identity (there is none, by design — no account exists).
- Share volume must **never** feed back into search ranking, a "popular"
  framing, or any prominence rule. This extends
  `[[011-market-foundation-and-international-growth]]` §6's existing
  principle — "popularity may only affect the order of enrichment and
  review, never whether a restaurant is included, and never neutral
  search placement" — explicitly to this new signal.
- Unknown, independent, and new restaurants remain exactly as shareable
  and exactly as fully-featured in their shared pages as prominent ones —
  no share-count-based gating, badge, or feature flag of any kind.

## Risks

- **Showing a stale price, menu, or availability as if current** —
  mitigated by the mandatory freshness/version disclosure and
  trust-model filtering named above; without both, this risk is not
  adequately addressed.
- **A shared page leaking data never meant to be public** (claim
  evidence, internal provenance/moderation notes, personal contact
  details, an owner's private information) — mitigated by scoping the
  shared payload strictly to already-published, public-category fields,
  reusing `MARKET-03`'s `basic_info` data-minimisation discipline rather
  than inventing a separate one.
- **A rich link-preview card drifting into an implicit editorial pick or
  ranking signal** — mitigated by the explicit "no unexplained ranking,
  no paid visibility, no marketing claim" constraint on preview content.
- **A durable link breaking silently during a future schema migration**
  because it embedded a raw internal id with no stability contract —
  mitigated by deciding the URL/metadata strategy explicitly (Dependencies
  item 5) rather than defaulting to "whatever the canonical id happens to
  be today."
- **Performance regression on shared pages** — a shared page is still a
  consumer-facing surface and must be re-evaluated against
  `[[003-performance-budget]]`, the same way `PLATFORM-10` already
  requires internal-tooling surfaces to be re-checked before any public
  exposure — not grandfathered in as "just a simple share page."

## Open questions (explicitly not decided here)

- Exact URL shape/scheme for shared pages (slug-based, opaque id, or a
  short-code scheme distinct from the internal canonical id) and whether
  shared pages should be search-engine indexable at all.
- Exact mechanism for an ephemeral personal selection (URL-encoded state
  vs. a short-lived, unsaved server-side token) — an implementation
  choice for whoever builds this, not fixed here.
- Whether and how a link-preview card is generated (server-rendered
  Open Graph/Twitter-card tags vs. a dedicated image-generation step) —
  named as a future option, not specified.
- **Whether `CLAUDE.md`'s "no restaurant or dish photography in
  discovery" principle extends to a future link-preview card's own
  surface.** The scope above deliberately lists only text fields (name,
  title, price, MenuCard identity, description) — no image — which is
  already consistent either way. If a later revision of the preview card
  wants to add an image, that is a fresh design decision against
  `CLAUDE.md`'s existing UI principles, not something this ticket
  pre-approves or forecloses.
- Exact freshness-disclosure copy and threshold — e.g. whether "last
  checked" reuses `docs/api/data-trust-model.md`'s 90-day staleness
  window verbatim, or defines its own — not decided here.
- Whether `operational_status` (already an open, unresolved question in
  `docs/api/canonical-restaurant-menu-schema.md`) must be mandatorily
  shown on a shared link, given the real-harm potential of a durable link
  advertising a permanently-closed restaurant as current — flagged, not
  resolved by this ticket either.

## Acceptance criteria

- [ ] Three link types are documented as the scope: full menu (with
      meal-moment context), single dish, and personal multi-dish
      selection.
- [ ] The durable/direct-open, factual-content-only, and
      freshness-disclosure principles are recorded as binding
      requirements for whoever eventually implements this.
- [ ] Allergen/diet-label inclusion is explicitly gated on trust-model
      confidence, never shown unconditionally.
- [ ] No-account sharing via the Web Share API plus a copy-link fallback
      is recorded as the baseline mechanism.
- [ ] A hard constraint against exposing personal data, private business
      data, or internal provenance/moderation data in any shared payload
      is recorded, explicitly mirroring `MARKET-03`'s data-minimisation
      discipline.
- [ ] A future rich link-preview card is described as an explicit option,
      carrying its own anti-ranking/anti-paid-placement/anti-marketing
      -claim constraints.
- [ ] All four hard dependencies (`MARKET-02`, `MARKET-06`, `MARKET-08`,
      the trust model) plus the still-undecided URL/metadata strategy are
      recorded as explicit preconditions this ticket cannot bypass.
- [ ] The personal-selection default (ephemeral, client-side) is recorded,
      with a save-able/collaborative selection explicitly named as a
      later, separate privacy and product decision — not designed here.
- [ ] Analytics/neutrality principles (aggregate-only, never a ranking
      input, equal shareability regardless of popularity) are recorded.
- [ ] No UI, API, database, tracking, or code of any kind is implemented
      by this ticket — documentation only.

## Suggested order

New ticket, proposed as the sole entry in a new Wave 5 ("Shareable public
surfaces") of `planning/architecture/market-data-foundation-plan.md`,
sequenced after Wave 4 (`MARKET-08`/`MARKET-09`) since it depends on the
market foundation, the import/publication pipeline, and a market-aware
consumer read path all existing first. Not scheduled.
