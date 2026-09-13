# MARKET-03 — Source Registry, Usage Rights, and Data Minimisation

## Depends on

`[[011-market-foundation-and-international-growth]]` (source-governance
principle), `MARKET-02` (`SourceReference.source_id`, which this registry
now constrains — see that document's amendment).

## Objective

Define a concrete, review-ready registry so every future import source
can be demonstrably assessed, used, traced, refreshed, and blocked if
needed — before any automated Breda import happens. A source is never
`allowed` merely because its data is publicly visible.

## User story

As whoever eventually builds `MARKET-04` (import runs), I want every
source I pull from to already carry a reviewed status, documented terms,
an approved access method, and explicit data-category limits, so an
import can never accidentally exceed what was actually permitted.

## Scope

- The `Source` registry schema — see `docs/api/source-registry-schema.md`
  for full field detail: identity, operator, type, official location,
  terms evidence (+ version + retrieval date + next review date),
  allowed/excluded data categories, reuse rights, an approved access
  method (drawn from a fixed vocabulary that structurally excludes
  scraping third-party search-results pages), refresh policy, freshness
  expectation, geographic applicability, and status/review metadata.
- Four-value status vocabulary: `pending_review` (mandatory initial
  status) → `allowed` / `restricted` / `blocked`.
- A narrowly-scoped `basic_info` data category, with an explicit
  permitted list (name, visiting address, general phone, general contact
  address, website, reservation link) and an explicit exclusion list
  (any natural-person names, personal contact details, likely home
  addresses, anything identifying a person alone or in combination).
- A constraint on `MARKET-02`'s `SourceReference.source_id`: it must
  reference a registered `Source`, never a bare/unreviewed URL.
- Research (not a final decision) on candidate pilot sources for Breda:
  OpenStreetMap, the KVK Open Dataset, individual restaurant websites,
  and Gemeente Breda open data.

## Out of scope

- Actually importing any restaurant data.
- Any change to the consumer UI.
- Any unauthorized scraping of any kind.
- Marking any source `allowed` without verifiable primary terms evidence
  — including Breda's own already-used restaurant websites, which stay
  `pending_review` here, not retroactively upgraded.
- Building `MARKET-04`'s import-run mechanism, or any code, migration, or
  Supabase change of any kind.
- A final pilot-source decision — explicitly deferred pending clearer
  primary terms where they aren't yet clear enough.

## Dependencies

Hard dependency on `MARKET-02` (`SourceReference` is amended, not
redesigned, by this ticket).

## Data model needs

This ticket **is** the data model definition for `Source`. Output:
`docs/api/source-registry-schema.md`. No implementation.

## Moderation/verification needs

Source review itself is a moderation-shaped act (a human decision, with a
reason, a reviewer, and a date) but does not reuse `PLATFORM-06`'s
`pending_changes` queue directly — a source review is a different kind of
decision (approving a *channel*, not a *data value*). Whether it should
eventually share tooling with `PLATFORM-06` is not decided here.

## Risks

- Treating "the data is on a public webpage" as equivalent to "reuse is
  permitted" — guarded against structurally via the `status` invariants.
- Silently carrying an `allowed` status over to a new market/country
  without a fresh review — guarded against via `geographic_applicability`
  and its stated non-transfer rule.
- Data-minimisation drift: importing more than `basic_info`'s narrow
  permitted list because a source happens to expose more — guarded
  against by making `allowed_data_categories`/`excluded_data_categories`
  a first-class, per-source field, not an afterthought.
- Conflating a dataset's *licence* with its *access channel* (e.g.
  assuming ODbL-licensed data means any technical means of fetching it is
  fine) — guarded against via the separate `allowed_access_method` and
  `access_provider_note` fields.

## Candidate pilot sources for Breda (researched, not decided)

| Candidate | Completeness | Legal usability | Technical access | Attribution | Freshness | Data minimisation | Intl. scalability | Risk for small/independent restaurants |
|---|---|---|---|---|---|---|---|---|
| **OpenStreetMap** | Strong for a *complete*, non-popularity-driven candidate list (POI presence isn't popularity-gated); weak for menu/price content, which OSM tags rarely carry. | Clear, well-documented ODbL — free incl. commercial use. Licence and access **provider** are separate: a static data extract differs from the public Overpass API instance, which has its own separate usage policy — both need review, not just the licence. | Extract download or Overpass API — access method still needs its own `Source` entry distinct from the licence question. | Well-defined: "© OpenStreetMap contributors" + a licence link. | Community-maintained, variable per POI — no guaranteed freshness. | Naturally minimal — POI data rarely includes personal data. | High — same global licence and data model everywhere. | Low direct risk — inclusion isn't popularity-weighted, which favours small/independent restaurants over relying on e.g. review-platform prominence. |
| **KVK Open Dataset Basis Bedrijfsgegevens** | **Real gap**: covers only BV/NV legal entities — many small/independent restaurants (eenmanszaak, VOF) are plausibly excluded, undermining completeness. Proposed status: `restricted` research/enrichment candidate, **not** the primary candidate-list source. | Clear CC BY 4.0, free. | API is rate-limited (1 req/min per IP; 200/5min combined) — must be designed for, not assumed unlimited. | Standard CC BY attribution. | Official register — high trust for what it does cover. | Business-registration data only; still needs its own check against the `basic_info` exclusion list (registered address could coincide with a sole proprietor's home address). | High — CC BY is a well-understood, portable licence, though the specific dataset is Dutch-only. | **Risk noted explicitly**: excluding non-BV/NV entities could systematically under-represent exactly the small/independent restaurants `[[011-market-foundation-and-international-growth]]` says deserve deliberate extra attention — a reason not to make this the primary list. |
| **Individual restaurant websites** | N/A per-site — this is the enrichment layer once a candidate list exists elsewhere, not a discovery source. | Unverified per site — no blanket licence exists for "restaurant websites" as a category. | Varies per site; `automated_fetch_source_approved_domain` only once a specific site's terms are actually reviewed. | Typically none formally required, but not confirmed either way per site. | Depends entirely on how often each restaurant updates its own site. | Requires per-site care — some sites may expose staff names/personal contact info. | Doesn't scale as a *policy* — each new market still means per-site review, market by market. | Low risk of *exclusion* bias (any restaurant with a website can be enriched), but review effort scales linearly with restaurant count. |
| **Gemeente Breda open data** | **Not confirmed** — I could not verify a specific horeca/vestigingen dataset exists on `data.breda.nl`, despite the portal itself existing. | Unconfirmed — no specific licence reviewed because no specific dataset was found. | Unconfirmed. | Unconfirmed. | Unconfirmed. | Unconfirmed. | Unconfirmed. | **Not a candidate yet** — needs direct portal investigation or contact with the municipality before any assessment is possible. |

**No pilot source is selected.** OpenStreetMap looks the strongest fit for
the *candidate-list* step specifically; KVK is flagged as enrichment-only
with an explicit completeness risk; restaurant websites remain the
per-site enrichment layer already informally in use; Gemeente Breda's
portal needs direct follow-up before it can be assessed at all.

**Correction (2026-09-13): KVK Open Dataset Basis Bedrijfsgegevens is not
usable for individual Breda restaurant records, at any coverage level —
this supersedes the row and paragraph above, which understated the
problem as a completeness risk alone.**

Direct verification against KVK's own current, official documentation
found that the table row above correctly named a *completeness* risk
(BV/NV-only legal-form coverage, excluding eenmanszaak/VOF) but did not
check whether the open dataset can identify a specific business at all.
It cannot, for any legal form it does cover:

- **No company name.** KVK's own documentation states plainly: *"De naam
  van de onderneming, het KVK-nummer en het vestigingsadres kunnen niet
  in alle gevallen worden aangemerkt als persoonsgegeven. KVK kan dit
  niet per geval beoordelen en stelt deze gegevens daarom niet
  beschikbaar"* — the name, the KVK number, and the establishment address
  are each withheld from this specific open dataset, as a matter of
  policy under EU Implementing Regulation 2023/138's High Value Dataset
  personal-data safeguards, not an oversight or a paid-tier restriction.
- **No KVK number** — the one stable identifier that could otherwise tie
  a row to a specific, already-known business.
- **No full establishment address** — only the *first two digits* of the
  postcode are included (a broad area shared by many businesses), never
  the street, house number, or remaining postcode digits.
- What the dataset *does* contain: legal form (BV/NV only — the existing
  completeness gap above stands, unrelated to this correction),
  commencement date, active/insolvency status, SBI activity code(s), and
  the two-digit postcode-region prefix.

**A bulk file or an authenticated API does not fix this.** Both are
merely *access methods* to the same underlying, deliberately
de-identified field set — per this document's own existing
licence-vs-access-method separation, no access route can produce a field
the dataset itself never contains. This is a **data-shape** disqualifier,
not an access-method or rate-limit problem — the row's existing API
rate-limit caveat remains true but is no longer the operative reason to
reject this candidate.

**Consequence**: KVK Open Dataset Basis Bedrijfsgegevens is **no longer a
candidate for a first `basic_info` batch, a source-specific harvester
target, or any individual Breda restaurant record, at any coverage
level** — not "enrichment-only" as the row above still says, but **not
usable at all** for this project's purpose of identifying and describing
specific restaurants. No row in this dataset can be matched to "this one
specific restaurant" — even a human reviewer cannot recover a name or
address from it.

**Open long-term option — not decided, not authorized here.** KVK
separately sells contractually-licensed products (e.g. commercial
Handelsregister-inzage/API products that *do* carry name, KVK-number, and
full address, under KVK's own commercial terms —
[kvk.nl/producten-bestellen](https://www.kvk.nl/producten-bestellen/kvk-handelsregister-open-data-set/)).
**This correction says nothing about those** — they are a structurally
different product from the open HVDS corrected here, not reviewed, not
registered, and not authorized by anything in this document. Whether such
a product is ever worth pursuing is an explicit, separate, human legal/
commercial decision, gated by the same `MARKET-03` review-and-registration
process as any other source (`reviewed_by` a real, authorized human —
never AI research alone) — not decided or pre-approved here.

**OSM/Geofabrik are unaffected by this correction and remain exactly as
gated as before**: `restricted` to internal `raw_import`/
`internal_quality_review`/`moderation_preparation` only, per `MARKET-04`'s
own hard gate 3A/3B. Closing off KVK as a candidate does not loosen that
separate, still-open legal gate, and this correction does not suggest OSM
as a substitute route around it.

**Practical preferred route, today**: explicitly authorized partner- or
restaurant-supplied data, entered via `MARKET-04B`'s own (not-yet-built)
CSV/JSONL intake — a source a human has actually reviewed and registered
through this document's own process, under the exact same discipline
already required for every other source. This is a process statement,
not a new registered `Source` — no source is registered by this
correction.

Official sources verified 2026-09-13:
[KVK Developer Portal — Open Dataset Basis Bedrijfsgegevens](https://developers.kvk.nl/nl/documentation/open-dataset-basis-bedrijfsgegevens-api),
[KVK — KVK Handelsregister Open Dataset Basis Bedrijfsgegevens](https://www.kvk.nl/producten-bestellen/kvk-handelsregister-open-data-set/).

## Acceptance criteria

- [x] A documented `Source` registry schema exists with the four-value
      status vocabulary, `pending_review` as the mandatory initial state,
      and invariants preventing `allowed`/`restricted` without terms
      evidence, a reviewer, a date, and a reason.
- [x] `allowed_access_method`'s vocabulary structurally excludes scraping
      third-party search-results pages — not a per-row flag.
- [x] Licence and technical access channel are documented as separate
      questions, not conflated.
- [x] `basic_info` has an explicit, narrow permitted list and an explicit
      exclusion list for personal/natural-person data.
- [x] `MARKET-02`'s `SourceReference.source_id` is amended to require a
      registered `Source`, not a bare URL.
- [x] Breda's existing restaurant websites are registered as
      `pending_review`, not retroactively `allowed`.
- [x] At least the four named candidates are assessed on completeness,
      legal usability, technical access, attribution, freshness, data
      minimisation, international scalability, and risk to small/
      independent restaurants — with no final pilot selection made.
- [x] No restaurant data imported, no consumer UI changed, no code,
      migration, or Supabase change.

## Suggested order

Third ticket of the `MARKET-*` track's Wave 2 (import & sourcing
infrastructure) — see `planning/architecture/market-data-foundation-plan.md`.
