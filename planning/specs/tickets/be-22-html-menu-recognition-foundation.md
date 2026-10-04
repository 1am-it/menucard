# BE-22 — HTML Menu Recognition Foundation (offline benchmark)

## Status

Proposed; local, offline foundation only. An isolated benchmark track under
`ops/benchmark/` — no product code, route, UI, database, migration,
provider, or live analysis-pipeline change. Not yet independently reviewed,
not pushed. Three pre-push reviews (adversarial self-reviews by the same
author, all NOT GREEN) found time/date and volume misreads, unbounded
parser work, a shallow trust guard, two-dish table rows/cards being merged
or partially claimed, and Proxies passing the plain-data guard; those are
fixed locally (see "Review fixes") and await a new independent pre-push
review.

## Voortgang

BE-22 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2. Implementatie-readinessreview groen
- [x] 3. Lokale offline foundation gebouwd en getest (`ops/benchmark/`)
- [ ] 4. Onafhankelijke pre-pushreview groen
- [ ] 5. Code gepusht
- [ ] 6. Apart geautoriseerd experiment op echte bronnen

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means.

## Depends on

`be-20-general-restaurant-source-extraction.md` (the analysis pipeline and
evidence/confidence contract this foundation measures against, never
redefines) and `be-21-restaurant-source-extraction-vendor-benchmark.md`
(the `ops/benchmark/` foundation this extends: adapter contract,
`assertNeverCarriesPrecomputedConfidence`, the unavailable `ai_structured`
stub, `(sourceType, adapterKind)` aggregation, and the "this is not the real
benchmark" report disclaimer).

## Problem

A full re-measurement of 25 Breda restaurant websites on production code
`9040099` (2026-10-03) reached 24 of them, but only 3 yielded a menu — all
three through JSON-LD menu markup. 19 of the 24 reachable sites show their
menu as ordinary HTML (lists, tables, cards, headings) and yield nothing,
because BE-20 only reads JSON-LD menus from a web page.

## Product question

Can ordinary HTML menus be recognized **without treating arbitrary page text
as a menu** — opening hours, reservation and contact blocks, reviews, loose
prices, arrangements and per-person/per-table offers must never become
dishes?

## Three separate things (never conflated)

1. **This ticket — an offline benchmark foundation.** A small, strict,
   deterministic HTML structure adapter, synthetic fixtures with explicit
   expected results, a shared output contract, and scoring — all inside
   `ops/benchmark/`, never imported by product code.
2. **A later product adapter** — wiring any recognizer into BE-20's live
   analysis pipeline. Not part of this ticket; needs its own ticket, review,
   and a real-source benchmark first.
3. **A later AI trial** — a model-assisted adapter measured against the same
   contract. Only after separate privacy, vendor, key/secret, and cost
   authorization (BE-20 "Privacy and vendor review", BE-21 "Vendor selection
   and privacy review"). This ticket prepares the contract and the
   `null` cost fields; it adds no SDK, key, call, or dependency.

## Fixed decisions

- **Synthetic fixtures only.** No HTML, PDF, menu text, or other content
  copied from a real restaurant. The Breda measurement is context for the
  problem statement only; none of its source content enters Git.
- **Out of scope:** external menu hosts, cross-host PDFs, JavaScript
  rendering, OCR, providers, and the live fetch/robots/redirect layer.
- **No authority from output.** Nothing this foundation produces creates a
  concept, proposal, review, publication, or a high-confidence result. An
  adapter never emits `confidence` or `reviewReady`; the existing guard
  rejects any result that does.
- **Fail closed.** Ambiguous or insufficient structure is `unparsed`; a
  doubtful line is a rejected line with a reason, never a guessed dish.
- **Money states from MARKET-02.** Items carry `priceStatus` `known`,
  `multiple_undecomposed`, `on_request` (or `unknown` for a future adapter)
  and `amountMinorUnits` only when `known`; a dual price is never collapsed
  into one amount, and a currency is only recorded when the source shows €.
- **Local service-unit vocabulary, for now.** BE-20's PDF service-unit and
  plausible-name helpers exist only on its unmerged recognition branch, not
  on `main`. This benchmark therefore keeps a small, documented local list
  (per person/table, arrangements, packages, courses, hire, deposit) inside
  `htmlMenuStructure.js`. It must be consolidated with BE-20's before any
  product adapter is built — never two diverging vocabularies in product
  code.
- **No claim of real-world support.** Synthetic scores prove the machinery,
  not that any real site's HTML menu is supported — that needs a separately
  authorized benchmark on the 24 reachable Breda sources.

## Scope

- `ops/benchmark/htmlMenuStructure.js` — a dependency-free HTML tree
  builder, bounded in input size and in work (a linear single pass plus a
  deterministic work budget), and the `html_structure` adapter. Supported patterns: semantic
  heading sections (`h1`–`h6`, `role="heading"`), list items (`li`,
  `role="listitem"`), table rows, definition lists (`dt`/`dd`), and repeated
  item cards (two or more sibling elements with the same tag and an item-like
  class), each with name and price in the same local structure; a
  description only when it sits inside the same item element.
- `ops/benchmark/menuExtractionContract.js` — the shared output contract
  (deterministic and later model-assisted), validation, and empty cost fields.
- `ops/benchmark/menuScoring.js` — precision, recall, wrong prices, wrong
  sections, false menus, review load, local timing, cost (`null`), aggregated
  per `(sourceType, adapterKind)`.
- `ops/benchmark/htmlMenuFixtures.js` — synthetic positive, negative and
  difficult cases with expected results.
- `ops/benchmark/menuBenchmark.js` — the offline runner; `run.js` and
  `report.js` add the menu track to the existing report.

## Non-goals

- Any change to BE-20's routes, analysis pipeline, UI, database, or the
  fetch/robots/redirect layer.
- Fetching, crawling, or re-measuring any real website.
- AI, OCR, document providers, browser rendering, keys, or costs.
- Allergen, diet, or modifier extraction — such markers are excluded from
  item names and counted, never interpreted.

## Acceptance criteria

- [x] Every supported pattern and every rejected structure has a regression
      test against a synthetic fixture.
- [x] In the synthetic fixtures and tests, opening hours (time ranges,
      weekdays, and single clock times in clear time context such as
      "vanaf 12.00" or "21.30 uur"), dates in clear date/event context,
      reservation/contact blocks, reviews, loose prices, prose prices,
      per-person/per-table offers, modifiers, unpriced lists and clearly
      labelled voucher/admission/parking/cloakroom sections never yield a
      menu. Not covered: such lists without any time/date context word or
      section label (see Known limitations in `ops/benchmark/README.md`).
- [x] A volume or weight before the first price is never read as a price,
      and a size letter or unit-like token after a price never hides a
      second price; dual prices stay `multiple_undecomposed`; an element
      with two independent name/price pairs (list item, definition, table
      row or card, as tested) is rejected, never merged and never read as
      its first pair — except the two documented structure limits T1 and
      L1 (see Review fixes), which never claim an amount; duplicate markup
      is de-duplicated; nested sections keep their full heading path.
- [x] No adapter output carries `confidence` or `reviewReady` at any depth
      — including non-enumerable, inherited, symbol or getter-based keys;
      the shared guard accepts only plain JSON-safe data — every Proxy,
      transparent or hiding keys, is rejected via `util.types.isProxy`
      before any trap runs — and rejects anything else in both runners,
      before any other property read and before scoring.
- [x] Parser work is bounded by a deterministic budget as well as by input
      size; broken or hostile HTML ends `unparsed`, never in a hang or a
      partial menu.
- [x] No product code imports `ops/benchmark/`; no new module imports a
      network client, provider SDK, or browser tool.
- [x] Results stay separated per `(sourceType, adapterKind)`; the
      `ai_structured` stub stays `not_evaluated` with `null` cost.

All seven are met on synthetic fixtures and unit tests only (step 3); none
says anything about real websites (step 6).

## Review fixes

The first pre-push review (an adversarial self-review by the same author,
not an independent review) was NOT GREEN. Local fixes, each with regression
tests that were checked by mutation:

- **H1** — single clock times and dates in clear context are rejected
  (`clock_time`, new reason `date`); comma prices, prices with € and
  context-free dot prices stay prices.
- **M1** — volume and weight tokens are never prices.
- **M2** — one linear forward pass plus a deterministic work budget;
  `work_limit_exceeded`, `too_deep` and `too_many_nodes` fail closed.
- **M3** — recursive trust-key ban in the contract and the shared guard;
  `rejected[].locator` and `stats` validated.
- **L1** — several name+price pairs in one element →
  `ambiguous_structure`.
- **L2** — narrow section labels only; unlabelled lists remain a
  documented, tested limitation.
- **L3/L4** — trailing alcohol percentage dropped from display names;
  fixture phone number replaced by an obvious test number.

The second pre-push review (again an adversarial self-review, NOT GREEN)
found that some of those fixes were incomplete. Local fixes, again checked
by mutation:

- **N1** — a table row with two runs of name cells and two runs of price
  cells → `ambiguous_structure`; one name with glas/fles price cells stays
  `multiple_undecomposed`.
- **N2** — a card or list item with two outermost name or price elements,
  or a price outside its one price element → `ambiguous_structure`; one
  name plus one price stays supported.
- **N3** — quantity units only before the first price and without €; an
  upper-case size letter after a price stays a price ("9,50 M 12,50 L" →
  `multiple_undecomposed`), a sub-euro "0,75 L 4,50" keeps 4,50.
- **N4** — table cells classified once (index membership, no
  `includes()`), and cell classification, queued children, child checks and
  long-text price scans charged to the work budget.
- **N5** — the remaining fail-closed recall limits (price ranges, "u",
  event-context dot dates, and others) are listed in
  `ops/benchmark/README.md` as deliberate limits, not as solved behaviour.
- **N6** — the trust-key scan accepts only plain JSON-safe data:
  non-enumerable, symbol, accessor and inherited keys, and non-plain
  objects, fail closed.

The third pre-push review (an adversarial self-review, NOT GREEN) found one
blocking gap and two low structure limits:

- **P1** — a transparent or key-hiding Proxy passed the plain-data guard.
  Fixed: `util.types.isProxy` (from `node:util`, the only Node built-in in
  the menu track, allowed in the contract module only) rejects every Proxy
  before any trap runs; the shared guard now runs this scan before any
  other property read. Checked by tests and mutation, in both runners.
- **T1 / L1** — documented, not solved: the ambiguous table order
  "name | price | price | name" can become one `multiple_undecomposed`
  item with only the first name visible, and a second dish name shorter
  than three letters in one combined element is not reliably
  distinguished. Both are listed under Known limitations in
  `ops/benchmark/README.md`; no parser rule was added for them.

## Decision: no bare-price fallback (2026-10-04)

An authorized, read-only phase A run of this adapter on recorded Breda
candidate pages (local only; no page content is kept in this repository)
produced no false positive but also no menu. Four of those sources show a
real HTML menu that the adapter does not recognize: their prices are bare
numbers (whole euros or one decimal, no euro sign, no two decimals), or
their dishes sit inside
structures that need interpretation (category wrappers, neutral heading
blocks).

Two local experiments tried to close that gap deterministically. Neither
was pushed, merged or integrated, and nothing they produced is product
data, a proposal or a publication — including the 98 items one experiment
recognized on two of those sources:

1. A broad recall attempt (bare amounts in price elements and table cells,
   descent into ambiguous wrappers, neutral repeated cards). Three
   independent reviews each found new false positives — arrangements,
   vouchers and vacancies read through wrappers; team, capacity, rating,
   countdown and step blocks read as dishes; a quantity used as a dish
   name — and every fix opened another edge case.
2. A narrow attempt (a bare amount only as the sole text of an explicit,
   price-classed element in a repeated item card, with structural checks
   on the whole card). Two independent reviews found that it still reads
   non-prices as prices: a rating, nutrition value, capacity or step number
   in a price-classed element, an old price or a from-price whose qualifier
   sits in the class name, and gift-voucher, workshop, room or ticket cards
   whose label is not a heading. No source-independent structural rule
   closes that without losing the sources it was meant for.

**Decision.** A bare number in HTML cannot be told apart reliably from a
rating, old price, from-price, capacity, workshop or ticket price, gift
voucher, step number or other value without semantic understanding.
Therefore no bare-price fallback is added to the deterministic HTML
recognition. The strict price parser and the supported structures stay
exactly as described above; this decision makes no fail-closed claim for
any bare-price rule, because none exists.

**Consequence.** Under the production baseline (`ea21337`) the four phase-A
sources with a real HTML menu remain `unparsed`: they are not recognized
automatically, and this foundation does not claim support for any of them.

## Hand-over boundary to a possible AI structuring track

The deterministic layer only produces a menu when the existing rules find
hard evidence: semantic structure, explicit price notation (two decimals,
",-" or a euro sign), one name and one price in the same local element, and none
of the documented rejections. When a source probably contains a menu but
its structure needs semantic interpretation, it stays `unparsed` (or its
lines are rejected as `ambiguous_structure`). That outcome is the future
hand-over point:

```
safe source extraction → deterministic recognition → unparsed / ambiguous
  → possible AI candidate → schema, evidence and trust checks → human review
```

The later steps are a separate, not yet authorized research track (the
`ai_structured` stub and the shared output contract above exist for it).
This section is explicitly **not** an authorization to build or use AI,
OCR, providers, external APIs or URLs, production integration, database
changes or UI. Any such step needs its own ticket, privacy and vendor
review (BE-20 "Privacy and vendor review before production use", BE-21
"Vendor selection and privacy review"), cost authorization and independent review first.

## Suggested next step

A separately authorized, read-only experiment that runs the
`html_structure` adapter on the 24 reachable Breda sources under BE-20's
existing safe fetch chain, with a manually verified reference per source —
before any product adapter or AI trial is considered. Sources that stay
`unparsed` there are candidates for the hand-over boundary above, not for a
new deterministic fallback.
