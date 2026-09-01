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
