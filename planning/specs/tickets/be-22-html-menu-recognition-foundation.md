# BE-22 — HTML Menu Recognition Foundation (offline benchmark)

## Status

Proposed; local, offline foundation only. An isolated benchmark track under
`ops/benchmark/` — no product code, route, UI, database, migration,
provider, or live analysis-pipeline change. Not yet independently reviewed,
not pushed. A first pre-push review (adversarial self-review, NOT GREEN)
found time/date and volume misreads, unbounded parser work, a shallow trust
guard and merged two-dish elements; those are fixed locally (see "Review
fixes") and await a new independent pre-push review.

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
- [x] Volumes and weights are never read as prices; dual prices stay
      `multiple_undecomposed`; an element with two name+price pairs is
      rejected, never merged; duplicate markup is de-duplicated; nested
      sections keep their full heading path.
- [x] No adapter output carries `confidence` or `reviewReady` at any depth;
      the shared, recursive, cycle-safe guard rejects it in both runners
      before scoring.
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

## Suggested next step

A separately authorized, read-only experiment that runs the
`html_structure` adapter on the 24 reachable Breda sources under BE-20's
existing safe fetch chain, with a manually verified reference per source —
before any product adapter or AI trial is considered.
