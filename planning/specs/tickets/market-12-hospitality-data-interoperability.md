# MARKET-12 - Hospitality Menu Data Interoperability Profile

## Status

Proposed, not started. Documentation and decision work only. No code, UI,
API route, database table, migration, provider account, POS connection, or
restaurant-data import is authorized by this ticket.

## Depends on

`MARKET-02` (the canonical Restaurant/Menu Schema) and `MARKET-03` (Source
Registry, usage rights, and data minimisation). Both define the source of
truth and provenance boundaries that any import or export mapping must reuse,
not replace.

Related contracts a public projection depends on, reused and never redefined
here:

- `PLATFORM-03` (`docs/api/data-trust-model.md`) — the provenance shape and
  the derived public status labels (Owner verified, Community confirmed,
  Editor verified, Imported, Stale).
- `MARKET-02B` (`market-02b-menu-proposal-publication-contract.md`) — the
  active, published canonical menu version that consumer reads are limited
  to, and which per-field trust information that layer may show.
- `MARKET-06` (publication snapshots, see
  `planning/architecture/market-data-foundation-plan.md`) — the versioned,
  per-market export mechanism.
- Decision `011-market-foundation-and-international-growth.md` — §5
  (publication only after review), §9 (risk-sensitive data shows provenance
  and freshness), §10 (data separation; the field-level public/private
  classification is explicitly still open), §11 (any external surface is
  built from snapshots).

A public Schema.org projection cannot be produced before the published layer
those contracts describe exists.

## Problem

Restaurant menus have no single, globally required database format. The
closest open web vocabulary is Schema.org's `Restaurant` -> `Menu` ->
`MenuSection` -> `MenuItem` -> `Offer` structure, but it is a flexible web
publication vocabulary, not a complete POS or menu-management database
contract. POS and ordering systems use related but provider-specific catalog
models.

Koninklijke Horeca Nederland's [KHN Kompas FAQ](https://khn.nl/nieuws/khn-kompas-in-tien-veelgestelde-vragen)
describes a useful Dutch sector-data reference point, but it reads anonymised
POS sales data for benchmarking; it does not publish a universal
restaurant-menu interchange schema. It must not be represented as an approved
BredaEats technical standard or partnership without an explicit agreement.

Without an explicit interoperability profile, future integrations risk either
forcing provider-specific fields into the canonical model or discarding source
headings, price states, modifiers, availability, allergen evidence, and
provenance during import/export.

## Objective

Define a vendor-neutral interoperability profile around `MARKET-02` that
preserves BredaEats' canonical schema as the source of truth, maps safely to
the useful subset of Schema.org, and establishes a disciplined evaluation
method for future Dutch hospitality/POS integrations.

This ticket decides how data is represented at the boundary. It does not
authorize an actual connector, data exchange, partnership, import, export,
or production change.

## User story

As a future integrator, I want a documented mapping between BredaEats'
canonical menu model and common external menu shapes, so a restaurant or POS
integration can be assessed without redefining the core model, inventing
certainty, or silently losing review and provenance data.

## Scope

- A new documentation contract:
  `docs/api/hospitality-menu-interoperability-profile.md`.
- A canonical-preserving internal mapping from `MARKET-02` objects to an
  interoperability envelope that keeps raw source names and provenance
  alongside optional normalized values.
- A documented, explicitly lossy Schema.org projection for public/web
  interchange only. It must identify fields Schema.org cannot faithfully
  carry rather than flattening or inventing them. A public projection is
  derived only from an active, published canonical version or snapshot
  (`MARKET-02B`/`MARKET-06`) — never from menu proposals, restaurant profile
  drafts, import candidates, raw imports, BE-20 analysis jobs, or review
  context.
- A provider-neutral POS capability matrix covering, at minimum, menu,
  section, item, price/price variants, modifier groups/options, availability,
  allergens, locale, service mode, and tax information where supplied. The
  matrix states per concept whether `MARKET-02` can represent it today.
  Modifier groups/options, tax/VAT treatment, and service mode have no field
  in `MARKET-02` today and are marked `canonical gap`: an external source may
  offer them, but they are neither silently mapped onto another field nor
  recorded as missing evidence, and storing them canonically first requires a
  separate, explicit `MARKET-02` amendment. Price variants (`Money.variants`),
  availability, allergens, and locale are existing `MARKET-02` concepts.
- A Dutch hospitality validation plan: KHN may be consulted as a sector
  stakeholder, but no KHN endorsement, API, dataset, standard, or partnership
  is assumed.
- Rules for preserving the original section title such as `SPRITZERS` or
  `SIDE DISHES`, while an optional normalized classification remains nullable
  and reviewable. That classification exists only in the interoperability
  envelope or an adapter: it is not a current `MARKET-02` field, defines no
  controlled vocabulary or canonical section taxonomy, and never replaces the
  original source section name. Adding it to canonical data requires a
  separate, explicit `MARKET-02` amendment.
- Rules that separate two kinds of trust information: (a) the derived public
  status labels that `PLATFORM-03` and `MARKET-02B` already allow for
  published risk-sensitive fields, which a public projection may carry as
  those contracts define; and (b) raw `FieldAssertion` data, internal review
  status, `SourceReference.source_locator`, internal source URLs, reviewer
  identity, and audit identifiers, which are never exported automatically.

## Non-goals

- Replacing or redefining `MARKET-02`'s canonical schema.
- Choosing a physical database layout, storage engine, migration, or API.
- Building a POS, delivery-platform, Schema.org, KHN, or other connector.
- Importing, exporting, scraping, storing, or sharing a restaurant's menu
  data.
- Treating a POS vendor, KHN, or Schema.org as the canonical source of truth.
- Automatic category normalization, automatic publication, automatic price
  decomposition, or removal of human review.
- Restaurant photography or image ingestion.
- Creating commercial claims, partnerships, endorsements, or compliance
  assertions.

## Required decisions

1. The canonical model remains authoritative. External formats are adapters,
   never the storage model.
2. Every external mapping must preserve an original source label separately
   from an optional normalized category. An unknown category stays unknown.
   The normalized category lives only in the interoperability envelope or an
   adapter; it is not a `MARKET-02` field and defines no canonical section
   taxonomy (see Scope).
3. `Money` values, including `known`, `multiple_undecomposed`, `on_request`,
   and `unknown`, retain the mutually exclusive semantics established by
   `MARKET-02`; an adapter must not turn an unknown or multiple price into a
   single invented amount.
4. Price variants, availability, allergens, and locale may be absent in a
   source. Absence of these existing `MARKET-02` concepts must be represented
   as missing evidence, not as a false default. Modifiers, tax/VAT, and
   service mode are a `canonical gap` instead (see Scope): not representable
   in `MARKET-02` today, and no current schema or field is stretched to hold
   them.
5. Derived public status labels for published risk-sensitive fields follow
   the existing `PLATFORM-03`/`MARKET-02B` contracts and Decision 011 §9.
   Raw `FieldAssertion` data, internal review status, `source_locator`,
   internal source URLs, reviewer identity, and audit identifiers are never
   exported automatically. Which further fields may be public stays an open
   publication decision under Decision 011 §10 and the existing publication
   contracts; this ticket does not decide it.
6. A Schema.org export is optional and may be partial. It must be labelled as
   a projection, not as a round-trippable backup or a POS interchange format,
   and is derived only from an active, published canonical version or
   snapshot (`MARKET-02B`/`MARKET-06`).
7. Any future KHN engagement is a validation/research conversation only until
   legal, technical, commercial, privacy, and governance decisions are
   separately documented and approved.

## Deliverables

- `docs/api/hospitality-menu-interoperability-profile.md`, containing:
  - terminology and the source-of-truth rule;
  - the canonical-to-external envelope mapping;
  - a Schema.org mapping table with required, optional, unsupported, and
    intentionally non-exported fields;
  - a POS capability matrix that distinguishes common concepts from
    provider-specific behaviour;
  - lossiness, unknown-value, locale, money, modifier, and provenance rules;
  - a small synthetic example that contains no real restaurant data;
  - validation questions for a future Dutch hospitality stakeholder review.
- A concise amendment to this ticket index and, only if the result changes a
  current cross-ticket decision, a corresponding decision record. No existing
  schema document is changed merely to duplicate the profile.

## Risks

- Treating flexible Schema.org markup as a complete transactional menu model
  can lose modifiers, variants, availability, tax, and internal provenance.
- Building a generic adapter around one POS provider can silently make its
  limitations part of the canonical model.
- Normalizing source headings too aggressively can erase restaurant-specific
  meaning or create false category claims.
- Assuming a KHN standard or partnership that does not exist can create a
  misleading product or commercial claim.
- Exporting source URLs, internal confidence, reviewer identity, or audit data
  can expose information not intended for consumers or partners.

## Acceptance criteria

- [ ] The documentation distinguishes clearly between a canonical model, a
      web-publication vocabulary, and provider-specific POS catalog models.
- [ ] `MARKET-02` remains the source of truth; no storage, migration, code,
      or connector is introduced.
- [ ] The Schema.org projection states every lossy or unsupported mapping
      explicitly.
- [ ] The capability matrix covers section/item structure, price states and
      variants, modifiers, availability, allergens, locale, service mode, and
      tax treatment when a provider supplies it, and marks modifiers, tax/VAT,
      and service mode as `canonical gap` rather than mapping them.
- [ ] Original source labels are preserved; normalized categories are optional,
      envelope/adapter-only, and never invented from missing evidence.
- [ ] The profile preserves `MARKET-02` money invariants and `PLATFORM-03`
      provenance/trust boundaries: derived public status labels only as
      `PLATFORM-03`/`MARKET-02B` allow, raw provenance and audit data never.
- [ ] A public projection is sourced only from an active, published canonical
      version or snapshot, never from proposals, drafts, import candidates,
      raw imports, BE-20 analysis jobs, or review context.
- [ ] No real restaurant content, provider credentials, personal data, or
      partner claim is added to the repository.
- [ ] KHN is named only as a possible future validation stakeholder, never as
      an adopted standard or confirmed integration partner.
- [ ] Any later provider connector requires its own source-rights, privacy,
      commercial, security, and implementation ticket before work begins.

## Suggested order

Documentation-only work that can be scheduled after `MARKET-02` and
`MARKET-03`, before any proposed external POS or menu-data connector. It does
not block the current BE-20 onboarding work and does not authorize a second
market, a public export, or an external integration.
