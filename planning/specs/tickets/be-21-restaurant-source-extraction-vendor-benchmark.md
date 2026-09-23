# BE-21 — Restaurant Source Extraction: Vendor Benchmark (OCR & Browser-Rendering)

## Status

Proposed; not started. Documentation/planning only — no benchmark run,
vendor account, API key, secret, billing profile, migration, route,
workflow, or Supabase change has been made for this ticket.

## Voortgang

BE-21 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

Step 4 here means the isolated benchmark harness/scripts and their
recorded results, never product code reachable from `/internal/*` —
see "Non-goals" below. See `015-be-ticket-structure-and-time-boxing.md`
for what this checklist means and how it must be kept up to date.

## Depends on

`be-20-general-restaurant-source-extraction.md` — this ticket is the
separate, later step its own "Non-goals for fase 1" and "Suggested
order" sections name: the vendor benchmark, comparison, and choice for
OCR (scanned/complex PDFs) and browser-rendering (JavaScript-dependent
sites), never a fase-1 build step. Depends on fase 1 already having
real, working evidence to benchmark against — this ticket is not
dispatched cold, before BE-20 itself is live and producing real
`json_ld`/`html`/`pdf_text`/`ai_structured` results. Reuses BE-20's own
`extraction_method`, content-hash, and confidence-tier contract as the
common shape every benchmarked vendor's output is measured against —
never a second, competing data shape invented for this ticket alone.

## Problem

BE-20's fase 1 deliberately ships without OCR or browser-rendering —
scanned/image PDFs and JavaScript-dependent sites (e.g. Mr. Moos in the
practice set) are explicitly out of scope there. Choosing a vendor for
either capability — Google Document AI, Azure Document Intelligence, or
AWS Textract for OCR; Browserless, a comparable managed service, or
self-hosted Playwright for browser-rendering — without first measuring
real accuracy, cost, latency, and privacy posture against real
restaurant sources would repeat exactly the mistake this project's own
engineering discipline (`CLAUDE.md`) warns against: adopting an
external dependency on assumption rather than demonstrated fit. This
ticket is that measurement step, isolated from any product build.

## Vaststaande productkeuzes (decided — not open questions)

1. This ticket produces a **benchmark report and a vendor
   recommendation**, never a shipped integration. No OCR, Browserless,
   Playwright, or other vendor code is implemented here.
2. The benchmark set is 50–100 real, authorized-to-test restaurant
   sources, stratified across HTML-only, digital PDF, scanned/image PDF,
   chain/location pages, multilingual sources, and JavaScript-dependent
   sites. The six sources BE-20 already names are a **mandatory
   subset**, never a substitute for the full set:
   - `https://debotanistbreda.nl/`
   - `https://bobbisbar.nl/`
   - `https://www.gauchosgrill.nl/breda`
   - `https://mrmoos.nl/`
   - `https://demarktbreda.nl/`
   - `https://breda.colonie.nl/`
3. Measured per field (name, address, phone, opening hours, menu title,
   dish, price, allergen): accuracy against a manually-verified
   reference set, false-positive rate, source-evidence coverage (share
   of fields with a valid content-hash reference), median human
   correction time per concept, and cost/latency per analysis — each
   broken down by source type, never reported as one blended average
   that hides a weak source type.
4. OCR and browser-rendering are compared **only after** fase-1
   evidence exists to benchmark against — never spun up speculatively
   ahead of BE-20's own build.
5. No CAPTCHA-solving, login-wall bypass, or processing of access-
   controlled content is evaluated, tested, or scored as a capability —
   a vendor's ability to defeat these is explicitly never a selection
   criterion, regardless of benchmark score.
6. Vendor choice, the data processing agreement/privacy review, and the
   per-analysis budget decision are this ticket's own explicit
   deliverables — not deferred again to a later ticket.
7. The benchmark itself runs isolated: never against the production
   database, never through the live `/internal/*` UI, never writing a
   real `url_intakes`/`restaurant_profile_drafts` row.

## Benchmark design

- **Source set**: 50–100 sources, stratified as in "Vaststaande
  productkeuzes" §2/§3. Each source's authorization to test (public,
  no login/CAPTCHA involved) is confirmed before inclusion — never
  assumed.
- **Reference data**: a manually-verified ground truth per field per
  source, built once, independent of any vendor's own output, so every
  vendor is scored against the same standard.
- **Metrics per source type, per vendor**: field accuracy, false-positive
  rate, source-evidence coverage, human correction time (measured, not
  estimated), cost per analysis, latency per analysis.
- **Isolation**: a standalone benchmark harness (scripts and recorded
  results), never code reachable from `/internal/*`, never a change to
  BE-19/BE-20's own routes, migrations, or job contract.
- **Reporting**: one comparison table per capability (OCR; browser-
  rendering) across every vendor actually tested — no vendor is named
  "best" without the measured numbers next to it.

## Vendor selection and privacy review (this ticket's own deliverable)

For whichever vendor the benchmark recommends per capability, this
ticket's own completion requires, explicitly confirmed and recorded —
never assumed, never left implicit:

- A data processing agreement with that vendor.
- Its actual EU-processing configuration (must be explicitly configured
  and verified, never assumed default — Google Document AI, for
  instance, requires directing calls at its own EU regional endpoint;
  this is a per-vendor configuration to confirm, not a given).
- Its retention and no-training commitment for submitted content.
- A concrete, agreed per-analysis and per-batch cost ceiling for
  production use (extending, never duplicating, BE-20's own "Cost
  limits and stop behavior" shape).
- Secret handling on BredaEats' side: environment-scoped, never shared
  with the existing Supabase CI secrets (`SUPABASE_ACCESS_TOKEN`/
  `SUPABASE_PROJECT_ID`/`SUPABASE_DB_PASSWORD`/`SUPABASE_DB_URL`), never
  logged, never committed.

## Acceptance criteria

- [ ] A benchmark report exists covering all 50–100 sources (the six
      mandatory sources included), with per-field, per-source-type
      metrics for every vendor actually tested.
- [ ] No vendor is recommended without its own measured numbers shown
      alongside the recommendation.
- [ ] The report explicitly states cost, latency, and human-correction-
      time findings per source type — not a single blended figure.
- [ ] A DPA, EU-processing configuration, and retention/no-training
      commitment are each explicitly confirmed (or explicitly still
      pending, never silently assumed) for the recommended vendor(s)
      before this ticket is considered complete.
- [ ] A concrete per-analysis and per-batch cost ceiling is proposed and
      owner-confirmed.
- [ ] No product code, route, migration, or UI reachable from
      `/internal/*` was added or changed to run this benchmark.

## Non-goals (explicitly out of scope)

- Implementing OCR, Browserless, self-hosted Playwright, or any other
  vendor integration in product code.
- Any change to BE-19's or BE-20's own migrations, routes, job contract,
  or UI.
- Any CAPTCHA-solving, login-wall bypass, or access-controlled-content
  processing capability — never evaluated, never scored, never built.
- A second, competing extraction data shape — this ticket measures
  against BE-20's own `extraction_method`/content-hash/confidence
  contract, never invents a parallel one.

## Suggested order

1. This ticket's own documentation commit, made and pushed, once BE-20
   itself is live and producing real fase-1 results to benchmark
   against.
2. An independent, read-only implementation-readiness review of the
   benchmark design above.
3. The isolated benchmark harness and run, against the 50–100-source
   set, entirely separate from the production database and the live
   `/internal/*` UI.
4. The benchmark report, vendor recommendation, and the privacy/cost
   deliverables in "Vendor selection and privacy review" above.
5. Only after this ticket is complete and its deliverables are
   owner-confirmed: a separate, later, explicitly-scoped ticket to
   actually build the chosen OCR/browser-rendering integration — not a
   phase of this ticket either.
