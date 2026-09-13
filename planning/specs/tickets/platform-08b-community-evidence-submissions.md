# PLATFORM-08B — Community Evidence Submissions: Missing Restaurants, Corrections, and Menu Links

## Status

Proposed, **not started**. Documentation/planning only — no code, route,
API, database, storage, or test exists yet for anything described here.

**Renamed (this update) from "Community Photo Evidence Submission."** The
prior version of this ticket scoped only a private-evidence photo intake.
Read-only research into actual visitor needs and this project's existing
contracts found that a visitor's most common, lowest-friction, and
lowest-risk contribution is not a photo — it is reporting a missing
restaurant, flagging one wrong detail, or pointing at the restaurant's own
official menu page. All three are text-only, need no file storage, and are
structurally simpler to govern than photo evidence. This update
**broadens** the ticket to cover all of these as one coherent plan, with
photo evidence carried forward, unchanged in substance, as a later, gated
phase (Fase 4) rather than the ticket's sole subject. Nothing previously
decided about photo evidence is weakened or reopened by this rename — see
"Fase 4" below for exactly what carries forward.

## Depends on

`PLATFORM-03` (trust/provenance model, `docs/api/data-trust-model.md`),
`PLATFORM-05` (internal API foundation, `src/lib/internalAuth.js`),
`PLATFORM-06` (moderation queue — any resulting proposal for the five
already-supported scalar fields lands here, unchanged), `PLATFORM-07`
(owner claim flow — reused, not reinvented, for owner confirmation of a
community-submitted link or correction; see "Restaurant owners" below).
Reads, but does not modify: `planning/decisions/011-market-foundation-and-international-growth.md`
(§5 governance, §9 risk-sensitive data, §10 data separation),
`planning/decisions/002-text-first-no-images.md`,
`planning/decisions/009-consumer-vs-internal-performance-budget.md`,
`docs/api/data-trust-model.md`, `docs/api/owner-claims-api.md`,
`docs/api/internal-moderation-api.md`, `supabase/migrations/0002_pending_changes.sql`,
`supabase/migrations/0003_restaurant_claims.sql`, `src/lib/claimAuth.js`,
`app/api/claims/route.js`, `src/lib/importInbox.js` (the
`computePossibleDuplicateIds`/enrichment patterns this ticket's duplicate
-hint and correction concepts deliberately mirror), and
`docs/api/canonical-restaurant-menu-schema.md`'s `FieldAssertion`/
`SourceReference` design.

**Relationship to `MARKET-02B` and `MARKET-04B` (explicit, not left
implicit):**

- **`MARKET-04B`** (controlled CSV/JSONL intake) remains the **only**
  bulk/partner import route — a source-registered, human-triggered CLI
  process for a pre-authorized data provider. This ticket's submissions
  are the structural opposite: single-restaurant, single-fact, web-based,
  submitted by an anonymous visitor, evaluated one at a time. Neither
  route is a shortcut for the other, and this ticket introduces no upload
  UI, connector, or bulk path of any kind.
- **`MARKET-02B`** (menu proposal & publication contract) remains the
  **only** eventual path by which structured menu content (sections,
  items, prices, allergens) becomes canonical, moderated, publishable
  data. This ticket does not build, duplicate, or bypass that contract.
  A community-submitted **menu link** is evidence of *where* a menu lives
  — never a structured menu-content proposal itself (see "Menu-link
  submission" below for the exact boundary). Once `MARKET-02B` exists, a
  moderator may use an approved menu link as one input toward building a
  real `MenuProposal` — that consumption path is `MARKET-02B`'s own,
  future decision, not authorized or pre-empted here.

## Problem

MenuCard has, today:

- A working claim flow (`PLATFORM-07`) for restaurants **already in the
  dataset** — its own "Out of scope" section states explicitly: *"Claims
  on restaurants not yet in the dataset (new-restaurant onboarding is
  future scope, not covered here)."* There is no path today for a visitor
  to report a restaurant that isn't listed at all.
- A scalar `pending_changes`/`field_provenance` flow covering exactly five
  fields on an **existing** restaurant (`price`, `openingHours`,
  `reservationMethod`, `itemAvailability`, `allergens`) — no field exists
  for name, address, phone, website, or a menu link, and no concept exists
  for "this restaurant should be added."
- No genuinely accountless, public write path anywhere in the codebase —
  even `POST /api/claims`'s deliberately lighter `authenticateAnyUser`
  (`src/lib/claimAuth.js`) still requires a real, verified Supabase Auth
  session (`restaurant_claims.user_id not null references auth.users(id)`).
- No file/image storage mechanism anywhere (confirmed by a prior,
  codebase-wide search) — relevant background for Fase 4, not required
  for the text-only flows this update prioritizes.

## Objective

Define, contract-first, one coherent plan for community evidence
submissions, in MVP priority order:

1. **Reporting a missing restaurant** ("Restaurant ontbreekt?").
2. **A single, targeted correction** to an existing restaurant ("Klopt
   iets niet?").
3. **Submitting an official menu link** ("Menukaart gevonden? Voeg link
   toe") — the **preferred** community contribution: light, mobile-first,
   no upload, no OCR, no automatic processing.
4. **Later, gated phase**: private photo evidence, only when no usable
   official link exists — unchanged in substance from the prior version
   of this ticket, repositioned as Fase 4 (see below).

The hard governance principle, unchanged, applies to all four: *"Users,
owners, and community members never mutate canonical or published data
directly. They submit proposals"* (`[[011-market-foundation-and-international-growth]]`
§5). **Everyone may submit evidence; nobody publishes automatically.**

## User story

As a visitor who notices a restaurant isn't on MenuCard, or that one
detail is wrong, or who knows exactly where that restaurant's real menu
lives online, I want a short, mobile-friendly way to say so — without
creating an account — and to know a human will review it, so I can help
without friction and without my report silently vanishing or silently
becoming "live" without anyone checking it.

## Non-goals (explicitly out of scope for this ticket)

- **No file/photo upload, storage, EXIF handling, or OCR in Fase 1–3.**
  That entire concern moves to Fase 4, unchanged in substance from the
  prior version of this ticket — see "Fase 4" below.
- **No automatic scraping, preview generation, metadata fetch, PDF
  copying/re-hosting, or download of a submitted link in the MVP (Fase
  1–3).** MenuCard only ever links out to the original source. Permanently
  — not only in the MVP — MenuCard never automatically copies, extracts,
  or publishes menu content on the basis of a submitted link; see
  "Menu-link submission" below for the exact boundary and the narrow,
  separately-decided future exception it names.
- **No new owner role, permission tier, or write path.** Restaurant owners
  use the existing (`PLATFORM-07`) or future claim flow to confirm a
  community-submitted link or correction — this ticket invents no new
  role and grants no new direct-publication right to anyone, owners
  included.
- **No public feed, chat, leaderboard, points, badges, streaks, or any
  gamification** in the MVP or in any phase this ticket authorizes.
- **No account requirement for a first, simple submission** — see
  "Optional status route" below for what an account-free submitter still
  gets.
- **No change to `MARKET-04B`'s CSV/JSONL route or `MARKET-02B`'s
  contract** — both remain exactly as their own tickets define them; see
  "Depends on" above.
- **No new `pending_changes.field_name` enum value invented ad hoc in this
  document.** Where a submission type doesn't fit the existing five-value
  enum (name/address/phone/website corrections; a menu link; a whole new
  restaurant), this ticket names the gap explicitly as an open data-model
  question (see "Data model needs") rather than silently assuming a
  migration or forcing an awkward fit.
- **No mockup, code, migration, or storage-vendor decision for Fase 4**
  (photo evidence) in this update — that phase's own mockup boundary,
  carried forward unchanged, still requires its own, separate,
  photo-evidence-specific mockup before any implementation.

## 1. Missing-restaurant submission ("Restaurant ontbreekt?")

**Flow**: a public, mobile-first page. The visitor first searches by name
and address (reusing the existing dish/restaurant search infrastructure's
matching logic where practical, not reimplementing it) **before** being
shown the add-a-restaurant form. If the search plausibly matches an
existing restaurant, a **duplicate hint** is shown — e.g. *"Bedoel je
misschien: {name}, {address}?"* — with a direct way to go to that
restaurant's existing page instead. **The hint is never a hard block**:
the visitor can proceed to submit a new-restaurant report regardless,
exactly mirroring `src/lib/importInbox.js`'s own `computePossibleDuplicateIds`
philosophy ("a hint, never a stored verdict, until a human judges it").

**Minimal required fields**: restaurant **name** and **full address**.
**Optional fields**: official website, reservation link, menu link (the
last of these reuses the exact same single-URL contract as flow 3 below,
never a second, differently-shaped field).

**What this produces**: a `NewRestaurantSubmission` — structurally
distinct from `pending_changes`, which requires an existing `restaurant_id`
and cannot represent "this restaurant doesn't exist here yet" at all. See
"Data model needs" for what this needs and what remains open.

## 2. Correction submission ("Klopt iets niet?")

**Flow**: from an existing restaurant's own page, one clearly-scoped
"Klopt iets niet?" entry point leads to a **single-field-at-a-time**
correction form — never a free-form "edit everything" surface. The
visitor names the field being corrected and its proposed value, plus an
optional short note.

**A real, honest gap this ticket surfaces rather than papers over**: the
existing, live `pending_changes` flow only ever accepts five field names
(`price`, `openingHours`, `reservationMethod`, `itemAvailability`,
`allergens`) — it has **no** field for name, address, phone, or website.
Those four are only correctable today via the **internal**, import-side
`restaurant_profile_draft_field_facts` enrichment mechanism
(`MARKET-05C`), which has no public-facing counterpart at all. A visitor
who wants to say "the phone number is wrong" has no existing field to
target. This ticket does **not** resolve that gap by inventing a migration
here (see "Data model needs" — it is recorded as an open decision), but
names it precisely so it cannot be quietly assumed away during
implementation.

For the five fields `pending_changes` already supports, a correction
submission reuses that exact mechanism unchanged: `proposed_source:
'community'`, into the existing `PLATFORM-06` moderation queue, with the
existing readable diff presentation (`src/lib/moderationFormatting.js`).

## 3. Menu-link submission ("Menukaart gevonden? Voeg link toe") — the preferred contribution

**This is the community contribution this ticket most wants to
encourage**: light, mobile-first, no file, no OCR, no automatic
processing of any kind.

**Flow**: from an existing restaurant's page, a visitor submits **exactly
one required, official `https://` URL** plus an **optional** short note
(e.g. "dit is hun lunchkaart, niet de dinerkaart"). Client- and
server-side validation both reject non-`https` schemes outright (no
`http://`, no `javascript:`, no other scheme) — this is a hard boundary,
not a UX nicety.

**What MenuCard does with an approved link, in the MVP — and what it
never does, permanently**:

- On approval, MenuCard shows visitors a plain, clearly-labelled outbound
  link — e.g. *"Bekijk het officiële menu →"* — pointing at the exact
  submitted URL.
- **In the MVP (Fase 1–3): no automatic fetch, preview, metadata
  retrieval (title/favicon/Open Graph), download, scraping, content
  extraction, PDF re-hosting, or automatic publication of a submitted
  URL.** A moderator reviews the link itself before it is ever shown to a
  consumer — the URL is never rendered, embedded, or processed
  automatically at submission time.
- **Permanent boundary, not an MVP-only limitation**: MenuCard never
  automatically copies, extracts, or publishes menu content on the basis
  of a submitted link — this holds at every phase, including any future
  one, and is not something a later engineering convenience can quietly
  relax. This is the same boundary `[[011-market-foundation-and-international-growth]]`
  §7's source-governance principle already requires for any imported
  content.
- **A possible future exception is named, not authorized, here**: a
  future, limited server-side URL validation step (e.g. confirming the
  URL resolves and returns a plausible content type) or a narrowly-scoped
  metadata retrieval (e.g. confirming a page title exists, purely as a
  moderator convenience) is conceivable — but only after a **separate**,
  explicit design, security, privacy, and source-rights decision. Any such
  step is never client-side, never unbounded, and never triggered
  implicitly by the mere act of submitting a link. No such mechanism
  exists or is approved by this ticket.
- **A menu link is always, in every case, first a moderation proposal —
  never a direct publication**, and is evidence of *where* a menu lives,
  never structured menu content itself. It does not, by itself, ever
  become a `MenuProposal` (`MARKET-02B`) or feed `data/menus.json`.
  Whether and how a moderator might one day use an approved link as one
  input toward building a real, structured menu proposal is entirely
  `MARKET-02B`'s own future decision — this ticket authorizes nothing
  beyond the link-out itself.

**What this produces**: a lightweight, moderated **menu-link record**
tied to a specific restaurant — see "Data model needs" for its shape and
the same open, not-resolved-here schema question as the correction flow
above.

## Duplicate-hint search — shared mechanism, not three implementations

The missing-restaurant flow's duplicate hint and the existing internal
`computePossibleDuplicateIds` heuristic share the same philosophy
(name+location proximity, non-authoritative, hint only) but are **not**
required to share literal code — the internal function operates over
`ImportExtractionRecord`s with OSM-shaped coordinates; the public search
operates over `data/restaurants.json`'s existing name/address fields.
Whether a future implementation extracts a shared, source-agnostic
"possible duplicate" primitive both could call is an open implementation
question, not decided here — but the **hint-never-blocks** principle
applies identically to both, non-negotiably.

## Status flow (shared across all submission types)

A vocabulary of its own, with **six distinct lifecycle statuses** —
deliberately distinct from `pending_changes`' existing three-value
`status` (`pending`/`approved`/`rejected`), which stays exactly as-is,
unchanged, for the five scalar fields it already governs. The two
vocabularies are never merged and never share a value's meaning by
coincidence: a `pending_changes` row's `approved` means "this exact field
value is now live"; this ticket's own `approved` (below) is deliberately
a weaker, distinct claim — see that status's own row.

| Status | Meaning |
|---|---|
| `received` | Submitted; not yet reviewed. Shown to the submitter immediately as an honest, non-committal confirmation — never phrased as "added" or "published." |
| `in_review` | A moderator has picked it up. |
| `approved` | Accepted by a moderator as correct/legitimate — **not necessarily yet visible to consumers**. Distinct from `published` below; a submission can sit here (e.g. a new restaurant awaiting the separate promotion step of open decision 6) without yet being live anywhere. |
| `published` | Actually visible to consumers where this ticket's own scope says it may be (a listed restaurant, a corrected field, an outbound menu link) — **never** implying this happened without both the moderation step and the `approved` state actually occurring first; `published` is never reached by skipping `approved`. |
| `rejected` | Declined, with one of a fixed set of reasons (mirroring `import_candidate_reviews`' own fixed-reason discipline — exact reason list not fixed here). |
| `stale` | Overtaken by events — e.g. someone else's submission for the same restaurant was already approved, or a previously-approved menu link has gone dead — surfaced for re-review, never silently deleted. |

**No submission goes live on its own.** Validation, rate-limiting,
abuse/spam mitigation, and moderation are all mandatory for every
submission type in every phase — see "Hard boundaries" below.

## Optional status route — no account required, minimal data

**An account is never required to submit.** A first, simple submission
(missing restaurant, correction, or menu link) requires no email, no
sign-up, and no session. The honest `received` confirmation shown at
submit time is the only feedback an anonymous submitter is guaranteed.

**Optional**: a submitter may voluntarily provide an email address purely
to check status later. This reuses the **existing, already-built and
already-verified** Supabase magic-link mechanism (`supabase.auth.signInWithOtp`,
exactly as `app/claim/[restaurantId]/ClaimView.js` already implements it)
— no new authentication mechanism is invented. This is deliberately the
lightest possible option, matching data-minimisation: the email is used
for exactly one purpose (a status-check magic link), is never displayed
publicly, and is never required to complete a submission. Retention and
deletion policy for a voluntarily-provided email is an **open policy
decision** (see below), not resolved here.

## Restaurant owners — existing claim flow only, no new rights

Restaurant owners confirm or correct their own listing, and confirm or
upgrade the trust tier of a community-submitted link or correction,
**exclusively through the existing (`PLATFORM-07`) or future claim
flow** — this ticket invents **no** new owner role, permission tier, or
direct-publication right. An owner's confirmation of a community-submitted
menu link raises its `trust_source` to `owner` (the existing, highest
tier per `docs/api/data-trust-model.md`'s established mapping) — it does
not change the underlying mechanism, only who vouches for it. `PLATFORM-07`'s
own explicit "Out of scope" ("claims on restaurants not yet in the
dataset... future scope") means a **new** restaurant added via flow 1
above has, initially, no owner-claim path until it exists as a real
restaurant record — sequencing this correctly (a new restaurant must be
approved/published before it can ever be claimed) is named here as an
implementation dependency, not resolved with new mechanism.

## Data model needs

**No migration, table, or schema decision is made in this document** —
matching this project's own established discipline (`MARKET-02B`,
`MARKET-04B`) of separating contract from implementation. What follows
names what's reusable, what's genuinely new, and what's explicitly left
open.

| Submission type | Reusable? | New / open |
|---|---|---|
| **Correction** (5 existing scalar fields) | **Fully reusable** — `pending_changes` unchanged, `proposed_source: 'community'`. | Nothing new for these five fields. |
| **Correction** (name/address/phone/website) | Partially — `restaurant_profile_draft_field_facts`'s shape (`MARKET-05C`) is structurally similar but is internal-only, import-side, and not public-facing. | **Open**: whether `pending_changes`' enum is extended, a new parallel contract is created, or a different mechanism is designed — not decided here. |
| **Missing restaurant** | Nothing existing fits — `pending_changes` requires an existing `restaurant_id`. | **New, entirely**: a `NewRestaurantSubmission` shape (name, address, optional website/reservation/menu-link, status per the shared vocabulary above, moderation decision, eventual promotion path to a real restaurant record) — not designed here. |
| **Menu link** | Conceptually closest to `docs/api/canonical-restaurant-menu-schema.md`'s `SourceReference` (a factual origin reference, never a copy) — but that shape assumes `MARKET-02`'s canonical restaurant/menu tables, which don't exist yet. | **Open**: whether a menu-link record is (a) a lightweight, standalone record referencing today's static restaurant ids, (b) folded into the missing-restaurant shape's own optional field when submitted alongside a new restaurant, or (c) deferred until `MARKET-02`/`MARKET-02B` exist and can host it properly — not decided here. |
| **Optional status email** | Reuses Supabase Auth exactly as `PLATFORM-07`'s claim flow already does — no new auth mechanism. | Retention/deletion policy only (see Open policy decisions). |
| **Duplicate-hint search** | Reuses `data/restaurants.json`'s existing name/address fields; philosophy shared with `computePossibleDuplicateIds`. | Whether a shared, source-agnostic primitive is extracted — not decided here. |

## Hard boundaries

- **No automatic publication of any submission type, in any phase.** 100%
  human moderation, no threshold-based auto-approval, ever.
- **No file/photo upload, storage, OCR, or automatic processing** until
  Fase 4, and even then only exactly as Fase 4's own carried-forward
  boundaries (below) specify.
- **No automatic scraping, preview, metadata fetch, PDF re-hosting, or
  download of a submitted menu link in the MVP (Fase 1–3).** Permanently:
  no automatic copying, extraction, or publication of menu content on the
  basis of a submitted link, ever — see "Menu-link submission" for the
  exact boundary and its one, separately-gated future exception.
- **No new owner role, permission tier, or direct-publication right.**
- **No public feed, chat, leaderboard, points, or gamification**, in the
  MVP or any later phase this ticket authorizes.
- **Validation, rate-limiting, spam/abuse mitigation, source-appropriate
  review, moderation, and append-only audit are mandatory for every
  submission type, every phase** — none is optional or deferrable "for a
  simple MVP."
- **No restaurant/consumer photography on primary discovery surfaces**
  (`[[002-text-first-no-images]]`, unchanged).
- **No new external dependency, upload endpoint, or storage bucket** in
  Fase 1–3 of this ticket.

## Open policy decisions (explicitly not decided here)

1. Exact schema/migration approach for name/address/phone/website
   corrections (extend `pending_changes`, new contract, or another
   mechanism).
2. Exact schema/migration approach for `NewRestaurantSubmission` and the
   menu-link record (see "Data model needs").
3. Fixed rejection-reason vocabulary for each submission type.
4. Exact rate-limiting/abuse-mitigation design for a fully accountless
   write path (session-cookie-hash, IP-hash, or another mechanism) —
   mirrors the same open question the prior version of this ticket
   already carried for photo evidence, now generalized to every
   submission type.
5. Retention and deletion policy for a voluntarily-provided status-check
   email.
6. Sequencing/promotion mechanism: how an `approved` `NewRestaurantSubmission`
   actually becomes a real, listable restaurant record (and from there,
   claimable via `PLATFORM-07`).
7. Whether a future implementation extracts a shared "possible duplicate"
   primitive reusable by both the public search hint and
   `computePossibleDuplicateIds`, or keeps them independent.
8. **Everything the prior version of this ticket already left open for
   photo evidence** (bullets 1–9 of that version's own "Open policy
   decisions": exact retention for an evidence asset, deletion-request
   path, treatment of recognizable persons, anonymity mechanism, storage
   vendor/region, file formats beyond JPEG/PNG, whether malware scanning
   needs an external service, pseudonymous attribution, and whether/how
   menu content ever gets its own destination beyond manual editorial
   action) — none resolved by this update, all still open, carried
   forward unchanged into Fase 4 below.

## Phased delivery — with explicit go/no-go per phase

Each phase makes the same technical-capacity-vs-human-review-capacity
distinction this project's other import/intake tickets already establish
— they are never the same number.

### Fase 0 — Contract and policy

This document. Consent text, the exact schema approach for each
submission type (open policy decisions above), rate-limiting design, and
the promotion mechanism for a new restaurant are all explicitly decided
before Fase 1 begins.

**Go/no-go**: no implementation without these decisions — hard, no
exception.

### Fase 1 — Missing-restaurant, correction, and menu-link flows (accountless, no photo)

All three flows from this document, fully accountless, 100%-moderated,
no file upload of any kind. The three mockups referenced below govern
this phase's presentation.

**Go/no-go**: Fase 0's decisions are recorded; rate-limiting and abuse
mitigation work end-to-end before any public opening beyond a closed,
trusted test group.

### Fase 2 — Optional status route

The voluntary email/magic-link status check, reusing `PLATFORM-07`'s
existing mechanism exactly.

**Go/no-go**: Fase 1 is live and stable; the retention/deletion policy
for a status email (open policy decision 5) is settled first.

### Fase 3 — Owner confirmation integration

A claiming owner (via `PLATFORM-07`, unchanged) can see and confirm/
upgrade a community-submitted link or correction for their own
restaurant.

**Go/no-go**: Fase 1 has produced real, approved submissions to confirm
against.

### Fase 4 — Private photo evidence (carried forward, unchanged in substance)

**Only when no usable official link exists.** Everything the prior
version of this ticket already decided about photo evidence carries
forward here, unchanged: a visitor submits at most one photo plus an
optional note for one restaurant; private, non-public storage only; no
account/email required for this specific step either; EXIF/GPS stripped
before persistent storage; server-side file-type/size validation, never
trusting the client-supplied type; a quarantine status and a malware-scan
requirement as design constraints; rate limiting from day one; content
hash as a moderator hint only, never an automatic gate; 100% human
moderation; only the five existing scalar fields can generate a
`pending_changes` proposal from evidence directly — menu content itself
still gets no new or automatic destination via this path (that remains
`MARKET-02B`'s own, separate question); no OCR in this phase.

**Go/no-go**: Fase 1's own volume and moderation-capacity experience
directly inform whether Fase 4's heavier review burden (interpreting a
photo takes longer than reviewing a link or a single field) is realistic
— never assumed solved by analogy to Fase 1's lighter flows.

### Fase 5 — Optional moderator-assist OCR (unchanged, still far later)

Only after a separate cost/privacy/quality decision; never before a human
already verifies every suggestion by default (in practice, not before
Fase 4 is mature).

### Fase 6 — Optional public photo/PDF display (unchanged, still far later)

Only after a separate product/copyright/privacy/performance decision,
with its own, specifically-written public-display consent text (not the
same consent as internal-use-only), and re-evaluated against
`[[002-text-first-no-images]]`'s principles.

## Mockup boundary

**For Fase 1 (missing restaurant, correction, menu link)**: three
photo-free, directional mockups now exist (this update) — see below.
They govern layout/information-hierarchy/presentation only, per
`docs/mockups/README.md`'s own standing rule — never a pixel-perfect
implementation requirement, and never proof that any backend mechanism
described here has actually been built.

**For Fase 4 (photo evidence)**: **still no mockup exists, and none is
authorized by this update.** Before any Fase 4 UI implementation, a
separate, photo-free mockup is still required for: restaurant selection,
upload with active consent and visible contributor rules, immediate
receipt confirmation, and internal moderator review alongside existing
restaurant data — using a neutral, rotating evidence placeholder, never a
real restaurant/menu photo, exactly as the prior version of this ticket
already required. This update changes nothing about that requirement.

## Risks

- **A duplicate-hint that reads as a hard block**, discouraging a
  legitimate "yes, still add this one" report — mitigated by the explicit
  "hint, never a block" requirement stated in both flow 1 and the shared
  duplicate-hint section above.
- **A menu-link submission quietly growing into a preview/scrape
  feature** under future convenience pressure — mitigated by stating the
  no-automatic-copy/extraction/publication boundary as permanent and
  structural, and by requiring any future, narrower fetch/validation step
  (see "Menu-link submission") to pass its own separate design/security/
  privacy/source-rights decision rather than being added as a quiet MVP
  follow-up.
- **The name/address/phone/website correction gap being silently
  "solved" during implementation by ad hoc reuse of `pending_changes`'
  enum**, without the schema question actually being decided — mitigated
  by naming it explicitly as an open decision in this document, not
  glossing over it.
- **Moderation capacity overwhelmed** once three accountless flows exist
  simultaneously — same class of risk `PLATFORM-08`/the prior version of
  this ticket already named; not solved here, only carried forward
  honestly.
- **A new-restaurant submission never actually reaching a claimable,
  real restaurant record** because the promotion mechanism (open decision
  6) is left undesigned indefinitely — named explicitly so it isn't
  quietly dropped.
- Every risk the prior version of this ticket already named for photo
  evidence (trust undermined by implying publication, privacy leakage via
  photo content, copyright, spam/abuse of an accountless upload path,
  data-quality ambiguity of an unverified photo, scope creep toward
  `MARKET-04B`/`PLATFORM-08`) — unchanged, carried forward into Fase 4.

## Acceptance criteria

- [ ] A visitor can search by name/address and see a non-blocking
      duplicate hint before submitting a missing-restaurant report.
- [ ] A missing-restaurant submission requires only name and full address;
      website/reservation link/menu link are optional.
- [ ] A correction submission targets exactly one field at a time; the
      five existing scalar fields route through the unchanged
      `pending_changes` mechanism with `proposed_source: 'community'`.
- [ ] A menu-link submission requires exactly one `https://` URL and
      accepts an optional note; no other scheme is ever accepted.
- [ ] A **published** menu link (not merely `approved` — see the status
      table) is shown to consumers only as a plain outbound link — no
      preview, no fetched metadata, no copied content, anywhere in the
      product.
- [ ] Every submission shows an immediate, honest "received" confirmation
      that never implies automatic publication.
- [ ] The six-status lifecycle vocabulary (`received`/`in_review`/
      `approved`/`published`/`rejected`/`stale`) is used consistently
      across all submission types, with `approved` (accepted, not
      necessarily yet visible) and `published` (actually visible) kept
      distinct — never collapsed into one status or one label.
- [ ] No submission of any type requires an account; the optional
      status-check route reuses `PLATFORM-07`'s existing magic-link
      mechanism exactly, with no new authentication method introduced.
- [ ] No new owner role or permission tier is introduced; owner
      confirmation flows exclusively through the existing/future claim
      flow.
- [ ] No public feed, chat, leaderboard, points, or gamification exists
      anywhere in this ticket's scope.
- [ ] `MARKET-04B`'s CSV/JSONL route and `MARKET-02B`'s contract are both
      referenced only, never modified or duplicated.
- [ ] The name/address/phone/website correction gap and the menu-link
      record's exact shape are recorded as explicit open decisions, not
      silently resolved.
- [ ] Fase 4 (photo evidence) carries forward the prior version's full
      set of hard boundaries and open policy decisions, unweakened.
- [ ] The three new mockups exist, are photo-free, and are referenced
      from `docs/mockups/README.md` as directional references only.

## Suggested order

Follows `PLATFORM-07`/`08` in Wave 4 ("External-facing write surfaces")
of `planning/architecture/platform-plan.md` — same wave, same ticket
number as before (only the title/filename and internal scope changed).
Independent of `MARKET-04B` (neither blocks the other). Not planned; only
pickupable once Fase 0's open policy decisions above are explicitly
answered.
