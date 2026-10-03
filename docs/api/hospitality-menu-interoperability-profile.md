# Hospitality Menu Interoperability Profile (MARKET-12)

A vendor-neutral profile for how menu data crosses the boundary between
BredaEats' canonical model and external menu shapes — the Schema.org web
vocabulary and future point-of-sale (POS) or menu-management catalogs.
Documentation contract only: nothing in the current app constructs, stores,
exports, or imports any shape described here, and this document authorizes
no connector, data exchange, partnership, export, or production change. The
product-level rationale lives in
[`planning/specs/tickets/market-12-hospitality-data-interoperability.md`](../../planning/specs/tickets/market-12-hospitality-data-interoperability.md).

This profile **reuses and never redefines**:

- [`canonical-restaurant-menu-schema.md`](./canonical-restaurant-menu-schema.md)
  (`MARKET-02`) — the canonical objects, `Money`, availability, allergens,
  `SourceReference`, and `FieldAssertion`.
- [`data-trust-model.md`](./data-trust-model.md) (`PLATFORM-03`) — the
  provenance shape and the derived status labels.
- [`market-02b-menu-proposal-publication-contract.md`](../../planning/specs/tickets/market-02b-menu-proposal-publication-contract.md)
  (`MARKET-02B`) — the active, published canonical menu version and what
  trust information that published layer may show.
- `MARKET-06` publication snapshots, as described in
  [`market-data-foundation-plan.md`](../../planning/architecture/market-data-foundation-plan.md).
- [`011-market-foundation-and-international-growth.md`](../../planning/decisions/011-market-foundation-and-international-growth.md)
  — §5 (proposals and review before publication), §8 (AI never publishes on
  its own), §9 (risk-sensitive data), §10 (data separation), §11 (a future
  public API is built from snapshots).

None of those documents is changed by this profile. Where they leave a
question open, this profile leaves it open too (see §11).

## 1. Terminology

| Term | Meaning in this profile |
|---|---|
| **Canonical model** | The `MARKET-02` objects (`CanonicalRestaurant`, `CanonicalMenu`, `CanonicalMenuSection`, `CanonicalMenuItem`, `Money`, …). The only source of truth. |
| **External shape** | Any representation outside the canonical model: Schema.org markup, a POS or menu-management catalog, a delivery platform's menu format. |
| **Adapter** | A future, separately ticketed translation between one external shape and the canonical model. No adapter exists or is chosen by this profile. |
| **Projection** | A one-way, outbound rendering of published canonical data into an external shape. Always allowed to be partial and lossy; never read back as a source of truth. |
| **Interoperability envelope** | An internal companion record that travels with a mapping: the original source label, provenance references, optional adapter normalization, and recorded canonical gaps (§4). Never public. |
| **Source label** | A section, item, or option name exactly as the source wrote it, for example `SPRITZERS` or `SIDE DISHES`. |
| **Adapter normalization** | An optional, nullable, reviewable, adapter-specific classification next to a source label. Not canonical; no controlled vocabulary. |
| **Canonical gap** | A concept an external shape can express but `MARKET-02` has no field for today: modifiers, tax/VAT treatment, service mode, nested sections. |
| **Missing evidence** | A concept `MARKET-02` does represent, but the source did not supply. Represented with that concept's own existing "unknown" state, never with an invented default. |
| **Derived public trust label** | A `PLATFORM-03` status label (Owner verified, Community confirmed, Editor verified, Imported, Stale) shown for a published risk-sensitive field as `MARKET-02B` allows. |

## 2. Source-of-truth rules

1. The canonical model is authoritative. External shapes are adapters or
   projections, never a storage model and never a second source of truth.
2. Schema.org is an explicitly lossy, outbound projection — never a database,
   never a backup, never a round-trip format, and never a POS source of truth.
   Nothing is ever re-imported from a BredaEats-produced projection.
3. Inbound data from any external shape is a **proposal**, never a direct
   canonical write (Decision 011 §5, §8): it enters the review flow
   (`MARKET-02B`'s proposed `MenuProposal` contract) like any other source.
4. No provider's model, field set, or limitation becomes part of the canonical
   model by being mapped. A concept the canonical model lacks stays a
   canonical gap (§6) until `MARKET-02` itself is explicitly amended.
5. Missing source data never yields an invented default, value, or claim
   (§7).

## 3. Publication boundary

This boundary is exact and has no exceptions:

| Output | May be derived only from | Governing contracts |
|---|---|---|
| **BredaEats on-page projection** (Schema.org markup on BredaEats' own consumer pages) | The **active, published canonical version** | `MARKET-02B` (consumer reads use only the active, published version) |
| **Any external feed, API, or export** | A **versioned `MARKET-06` snapshot** | `MARKET-06`; Decision 011 §11 |

A projection is **never** derived from:

- menu proposals (`MARKET-02B` `MenuProposal`, in any state);
- restaurant profile drafts (`MARKET-05C`);
- import candidates or raw imports (`MARKET-04`/`04A`/`05A`);
- BE-20 analysis jobs, receipts, URL intakes, or their field evidence;
- any review context (review notes, excluded lines, PDF review descriptions,
  moderation decisions);
- the interoperability envelope (§4).

**Which further fields may be public is not decided here.** The field-level
public/private classification stays the open publication decision of
Decision 011 §10, governed by the existing publication contracts. This
profile only ever narrows what a projection may carry (§5, §8); it never
widens it.

Until the published layer (`MARKET-02B`) or the snapshot mechanism
(`MARKET-06`) exists, no projection of the corresponding kind can be
produced at all.

### Risk-sensitive values stay out of Schema.org markup

Price and availability are risk-sensitive (Decision 011 §9: their display
must always show provenance and freshness). Schema.org offers no existing,
accepted way to carry BredaEats' provenance and freshness alongside those
claims. Therefore, **no Schema.org markup** — neither the on-page projection
nor any external feed, API, or export — carries price, price variants,
`minPrice`, availability status, or validity dates, until the publication
contracts explicitly decide how provenance and freshness are shown for
machine-readable markup. The mapping table (§5) describes those concepts
only as blocked, conditional future projections, never as current output.
Allergens are not projected either (§5), and an empty allergen list never
means "allergen-free".

This applies to machine-readable markup only. The human-readable on-page
display of published prices and availability stays governed by the existing
active-published-version, `PLATFORM-03`, and `MARKET-02B` contracts, and is
not changed by this profile.

## 4. Interoperability envelope (internal only)

A logical, illustrative shape — not a physical schema, table, or API:

```
InteropEnvelope {
  canonical_ref:     { entity_type, entity_id }       // the MARKET-02 object
  source_label:      { text, locale } | null          // exactly as the source wrote it
  adapter_normalization: {
    adapter_id:      text                             // which future adapter proposed it
    review_state:    'pending' | 'accepted' | 'rejected'  // internal review outcome only
    value:           text | null                      // adapter-specific; no controlled vocabulary; null when rejected
  } | null
  source_reference_ids: [SourceReference.id]          // MARKET-02 §5/§6, references only
  canonical_gaps:    [{ concept, offered_by_source: true }]
}
```

Rules:

1. **Never public.** The envelope is internal provenance and mapping context.
   It is never projected, exported, or shown to consumers or partners, in
   whole or in part.
2. **Source labels are always preserved.** A section such as `SPRITZERS` or
   `SIDE DISHES` keeps its source label; the canonical
   `CanonicalMenuSection.name` (+ `locale`) holds the published name, and a
   projection uses that canonical name, never an adapter normalization.
3. **Adapter normalization is optional and never canonical.** It is nullable,
   reviewable, adapter-bound, and not a `MARKET-02` field. It defines no
   controlled vocabulary or canonical section taxonomy, never replaces the
   source label, and is never invented when the source gives no evidence (an
   unknown category stays `null`). Adding any normalized classification to
   canonical data requires a separate, explicit `MARKET-02` amendment.
   `review_state` is an internal, adapter-bound review outcome: `pending`
   until a human decides, `accepted`, or `rejected` — and on `rejected` the
   `value` is `null`. The original source section name is always kept,
   whatever the review outcome. These three states are envelope bookkeeping
   only: not a canonical taxonomy, not a vocabulary for categories, and not a
   `MARKET-02` field.
4. **Canonical gaps are recorded, not stored.** The envelope may note *that*
   a source offers a canonical-gap concept (§6). It never holds those values
   as a substitute canonical store. In particular, it keeps no parent source
   label for a nested section: section nesting is a canonical gap (§6), and
   representing it later requires a separate `MARKET-02` amendment or a
   separate, explicit envelope decision.
5. **Provenance stays referenced, not copied.** Only `SourceReference`
   identities, per `MARKET-02` §6.

## 5. Mapping table

Visibility codes:

- **P** — may appear only as a published value, and only as far as the
  publication contracts make that field public (Decision 011 §10 is still
  open; this profile decides nothing about it).
- **L** — only as a derived public trust label (§8).
- **I** — internal; never projected or exported automatically.
- **B** — **blocked in Schema.org markup** (§3, "Risk-sensitive values stay
  out of Schema.org markup"). The "Schema.org projection" column then names
  only a possible future, conditional projection — never current output.
  Human-readable on-page display is unaffected (it stays **P**).

| Canonical field (`MARKET-02`) | External concept | Schema.org projection | Lossy / unsupported | Visibility |
|---|---|---|---|---|
| `CanonicalRestaurant.name` | Venue / store name | `Restaurant.name` | `Restaurant` is not a `CreativeWork`: the field's `locale` has no carrier. Other restaurant fields are outside this menu profile. | P |
| `CanonicalMenu` | Menu / catalog | `Restaurant.hasMenu` → `Menu` | — | P |
| `CanonicalMenu.meal_type` | Daypart, menu type | none | No typed equivalent; never encoded as a guessed `Menu.name`. Omitted. | P (not projected) |
| `CanonicalMenu.subtitle`, `notes` (+ `locale`) | Menu description | `Menu.description`, `Menu.inLanguage` | Free text only; one language per `Menu` node. | P |
| `CanonicalMenuSection.name` (+ `locale`) | Category / group | `MenuSection.name`, `MenuSection.inLanguage` | Projects the canonical section name as published (for example `SPRITZERS`); adapter normalization is never projected. | P |
| `CanonicalMenuSection.position` | Display order | order of `hasMenuSection` | Order is not a guaranteed semantic of JSON-LD arrays; consumers may reorder. | P |
| `CanonicalMenuItem.name`, `description` (+ `locale`) | Product / item | `MenuItem.name`, `MenuItem.description` | `MenuItem` (an `Intangible`) has no `inLanguage`; per-item locale is lost unless it equals the containing section's. | P |
| `CanonicalMenuItem.price` — `known`, single amount | Base price | **Blocked today.** Possible future: `MenuItem.offers` → `Offer.price` + `Offer.priceCurrency` | Minor units would render as a decimal with `.`; display formatting is not carried. | B; on-page display P (+ L) |
| `price.is_from = true` | "From" price | **Blocked today.** Possible future: `Offer.priceSpecification` → `PriceSpecification.minPrice` (a **Number**, e.g. `4.5`, never a string such as `"4.50"`) + `priceCurrency`; never `Offer.price` | "From" semantics would be approximated, never shown as an exact price. | B; on-page display P (+ L) |
| `price.variants[]` (`known`, ≥2) | Size / portion variants | **Blocked today.** Possible future: one `Offer` per variant (`Offer.name` = variant `label`, `price`, `priceCurrency`) | The variant `label` is free text; its meaning (glass/bottle, size) is not typed. | B; on-page display P (+ L) |
| `price` — `multiple_undecomposed` | Several prices, breakdown unknown | no `Offer` amount | Unsupported: no Schema.org way to say "several prices, unknown". Never collapsed into one amount. | P (not projected) |
| `price` — `on_request` | Price on request | no `Offer` amount | Unsupported. Never rendered as `0`, "free", or a placeholder number. | P (not projected) |
| `price` — `unknown` | Missing price | omitted | Missing evidence — never `0`, never "free". | — |
| `availability.status` — `available` | In stock / sellable | **Blocked today.** Possible future: `Offer.availability` = `InStock` | Retail-oriented vocabulary; a restaurant nuance would be lost. | B; on-page display P (+ L) |
| `availability.status` — `temporarily_unavailable` | Sold out / paused | **Blocked today.** Possible future: `Offer.availability` = `OutOfStock` | As above. | B; on-page display P (+ L) |
| `availability.status` — `seasonal` | Seasonal item | **Blocked today.** No faithful enumeration value even later. | Seasonality itself is not expressible; never forced onto another value. | B; on-page display P (+ L) |
| `availability.status` — `unknown` | — | omitted | Missing evidence. | — |
| `availability.valid_from`, `valid_to` (with **any** status) | Availability window | **Blocked today.** Possible future: `Offer.validFrom` / `Offer.validThrough` | In `MARKET-02` these can accompany every availability status. `Offer.validFrom`/`validThrough` describe the validity of an offer, not item availability, so any future mapping is lossy and must be assessed independently of the status. | B; on-page display P (+ L) |
| `allergens[]` (`{scheme, code}`) | Allergen declarations | none | **Unsupported**: Schema.org has no allergen property. Never mapped onto `suitableForDiet` — a diet is not an allergen declaration, and an empty list never means "allergen-free". | P (not projected) (+ L) |
| `tags[]` (free text) | Labels, badges | none | Free text; never translated into `suitableForDiet` or any `RestrictedDiet` value — that would be a new, unreviewed diet claim. | P (not projected) |
| `id`, `market_id`, `legacy_ids[]`, `external_ids[]` | Provider/catalog ids | none | A stable public identifier or URL strategy is a separate, open publication decision. | I |
| `source_references[]`, `SourceReference.*` (incl. `source_locator`) | Source, import metadata | none | Never automatic (§8). | I |
| `FieldAssertion.*` (`trust_source`, `confidence`, `verified_at`, `verified_by`, `field_path`, ids) | Verification metadata | none as raw data | Only a derived public trust label may appear, outside standard Schema.org properties (§8). | L / I |

"(not projected)" means the field may well be public on a BredaEats page under
the publication contracts, but this profile defines no Schema.org rendering for
it. **B** rows are blocked in all Schema.org markup until the publication
contracts decide how provenance and freshness are carried there (§3); their
"possible future" entries are not a decision to project them. The trust labels
(**L**) have no standard Schema.org property; where they appear, they appear in
BredaEats' own UI, not as invented Schema.org extensions.

## 6. POS capability matrix

Provider-neutral. "Provider-specific" lists behaviour that differs between
catalogs and must not leak into the canonical model. No provider is named,
chosen, or assumed to support any concept.

| Concept | External representation (varies per provider) | `MARKET-02` today | Profile rule | Provider-specific behaviour |
|---|---|---|---|---|
| **Menu** | Menu, catalog, or channel-specific menu | `CanonicalMenu` | Map to `CanonicalMenu`. | One catalog may serve several channels; channel scoping is not canonical. |
| **Section** | Category, group, tab | `CanonicalMenuSection` (`name` + `locale`, `position`) | Keep the source label (§4). | Hidden or internal categories. |
| **Nested sections** | Sub-categories, section hierarchy | **`canonical gap`** — `MARKET-02` has no section hierarchy, and the envelope keeps no parent source label | Never silently flattened as if nothing were lost: the hierarchy is a recorded gap, not mapped onto names, positions, or descriptions. Representing it requires a separate `MARKET-02` amendment or a separate, explicit envelope decision. | Nesting depth, sections nested in sections. |
| **Item** | Product, article, item | `CanonicalMenuItem` | Map name/description; keep the source label. | SKUs, PLU codes, kitchen routing — never canonical. |
| **Price** | Base price, often with tax flags | `Money` (`pricing_status`, `amount_minor_units`, `currency`, `is_from`) | Only the four existing states; never invent an amount, currency, or state. | Price per channel, time-based pricing, rounding. |
| **Price variants** | Sizes, portions | `Money.variants` (`label?`, `amount_minor_units`) | Map only fully decomposed variants as `known`; otherwise `multiple_undecomposed`. | Variant-as-separate-product vs. variant-on-product. |
| **Modifiers** | Modifier groups and options, add-ons, min/max selections | **`canonical gap`** — no field | Not mapped onto items, variants, tags, or descriptions; not recorded as missing evidence. Storing them canonically first requires a separate, explicit `MARKET-02` amendment. | Required/optional groups, selection limits, priced options, nested modifiers. |
| **Availability** | Sold out, hidden, schedules | `availability` (`status`, `valid_from?`, `valid_to?`) | Map only to the existing vocabulary; absence is `unknown`. | Real-time stock, schedule rules, per-channel hiding. |
| **Allergens** | Allergen flags or codes | `allergens[]` (`{scheme, code}`, `EU-14` first) | Map only to a documented `scheme`; absence is missing evidence, never "allergen-free". | Proprietary allergen lists, "may contain" flags. |
| **Locale** | Translations, language fields | text + `locale` on canonical text fields | Map per field; never guess a language. | Fallback languages, partial translations. |
| **Service mode** | Dine-in, takeaway, delivery | **`canonical gap`** — no field | Not mapped onto any field or claim; not recorded as missing evidence. Requires a separate `MARKET-02` amendment first. | Prices or availability that differ per service mode. |
| **Tax / VAT** | Tax rate, tax-inclusive flag | **`canonical gap`** — no field | Not mapped; no VAT state is inferred from a price. Requires a separate `MARKET-02` amendment first. `PriceSpecification.valueAddedTaxIncluded` is therefore never set by a projection. | Rate per item or service mode, inclusive vs. exclusive pricing. |

An external source may offer every canonical-gap concept. The envelope may
record that it did (§4, rule 4); the values themselves stay outside BredaEats
until `MARKET-02` is amended.

## 7. Lossiness, unknown values, locale, money, modifiers, and provenance

1. **Lossiness is declared, never hidden.** Every projection documents what it
   dropped (§5). A projection is never described as complete.
2. **Unknown stays unknown.** A missing price is `pricing_status: 'unknown'`;
   missing availability is `unknown`; missing allergens are missing evidence.
   No adapter or projection substitutes `0`, "free", "available",
   "allergen-free", a default currency, or a default language.
3. **Money stays intact.** The four `pricing_status` states and all four
   `MARKET-02` §4a invariants hold at every boundary. An unknown or multiple
   price is never turned into a single invented amount; `on_request` never
   gets a number.
4. **Locale is never guessed.** Text keeps its own `locale`; a projection that
   cannot carry it says so (§5).
5. **Modifiers, tax, service mode, and nested sections are canonical gaps**
   (§6) — never squeezed into another field.
6. **Risk-sensitive values stay out of Schema.org markup** (§3): price, price
   variants, `minPrice`, availability status, and validity dates are not
   emitted until the publication contracts decide how provenance and
   freshness are carried there.
7. **Provenance is never automatic output** (§8).
8. **Source labels survive normalization** (§4).

## 8. Visibility

| Information | Class | Rule |
|---|---|---|
| Published canonical values (names, prices per `Money`, availability, allergens, …) | Public **only via the published layer** | Only from the sources in §3, and only as far as the publication contracts make each field public (Decision 011 §10 open). Price, availability, and validity dates are additionally blocked in all Schema.org markup (§3); allergens are never projected (§5). |
| Derived trust labels for published risk-sensitive fields (Owner verified, Community confirmed, Editor verified, Imported, Stale) | **Derived public label** | Only where `PLATFORM-03`, `MARKET-02B`, and Decision 011 §9 already allow it; computed from the published layer, never from raw assertions at export time. |
| Raw `FieldAssertion` data (`trust_source`, `confidence`, `verified_at`, `verified_by`, `field_path`, ids) | **Never automatically public** | Only the derived label above may appear. |
| Reviewer identity (`verified_by`, moderator, reviewer) | **Never automatically public** | — |
| `SourceReference.source_locator`, internal source URLs, PDF links | **Never automatically public** | Whether a publicly accessible source document may be linked is governed by `MARKET-02B`, not by this profile. |
| Review status, moderation decisions, proposal/draft state | **Never automatically public** | — |
| Audit identifiers (`import_run_id`, job ids, receipt ids, intake ids) | **Never automatically public** | — |
| Interoperability envelope, adapter normalization | **Internal** | Never projected or exported (§4). |
| Canonical ids, `market_id`, `legacy_ids[]`, `external_ids[]` | **Internal** | A public identifier strategy is a separate, open decision. |

## 9. Synthetic example

Entirely fictional: no real restaurant, provider, person, or source.

Published canonical data (abridged, `MARKET-02` shape):

```
CanonicalMenu      { id: "m-1", meal_type: "borrel", subtitle: null }
CanonicalMenuSection { id: "s-1", menu_id: "m-1", name: "SPRITZERS", locale: "nl", position: 1 }
CanonicalMenuSection { id: "s-2", menu_id: "m-1", name: "SIDE DISHES", locale: "en", position: 2 }
CanonicalMenuItem  { id: "i-1", section_id: "s-1", name: "Fictieve spritz", locale: "nl",
                     price: { pricing_status: "known", amount_minor_units: 850,
                              currency: "EUR", is_from: false, variants: null },
                     availability: { status: "available" }, allergens: [] }
CanonicalMenuItem  { id: "i-2", section_id: "s-1", name: "Fictieve huisspritz", locale: "nl",
                     price: { pricing_status: "multiple_undecomposed", amount_minor_units: null,
                              currency: null, is_from: false, variants: null },
                     availability: { status: "unknown" }, allergens: [] }
CanonicalMenuItem  { id: "i-3", section_id: "s-2", name: "Fictional fries", locale: "en",
                     price: { pricing_status: "known", amount_minor_units: 450,
                              currency: "EUR", is_from: true, variants: null },
                     availability: { status: "seasonal" }, allergens: [] }
```

Internal envelope for section `s-1` (never public):

```
InteropEnvelope {
  canonical_ref: { entity_type: "MenuSection", entity_id: "s-1" },
  source_label: { text: "SPRITZERS", locale: "nl" },
  adapter_normalization: { adapter_id: "example-adapter", review_state: "pending", value: "drinks" },
  source_reference_ids: ["sr-1"],
  canonical_gaps: [{ concept: "modifiers", offered_by_source: true }]
}
```

On-page Schema.org projection, derived only from the active, published
version (§3). It carries no price, price variant, `minPrice`, availability,
or validity date — those stay blocked in markup (§3):

```json
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "Voorbeeldzaak",
  "hasMenu": {
    "@type": "Menu",
    "inLanguage": "nl",
    "hasMenuSection": [
      {
        "@type": "MenuSection",
        "name": "SPRITZERS",
        "inLanguage": "nl",
        "hasMenuItem": [
          { "@type": "MenuItem", "name": "Fictieve spritz" },
          { "@type": "MenuItem", "name": "Fictieve huisspritz" }
        ]
      },
      {
        "@type": "MenuSection",
        "name": "SIDE DISHES",
        "inLanguage": "en",
        "hasMenuItem": [
          { "@type": "MenuItem", "name": "Fictional fries" }
        ]
      }
    ]
  }
}
```

Deliberately not projected:

- the adapter normalization `drinks` (`pending`) and the whole envelope;
- every price: the `known` 8.50 for `Fictieve spritz`, the `is_from` 4.50 for
  `Fictional fries` (a later, permitted projection would write `minPrice` as
  the Number `4.5`, never the string `"4.50"`), and the
  `multiple_undecomposed` state of `Fictieve huisspritz` — all blocked in
  markup (§3);
- every availability status (`available`, `unknown`, `seasonal`) and any
  validity date — blocked in markup (§3);
- `meal_type: "borrel"`;
- the empty `allergens[]` (never "allergen-free");
- the modifiers the source offered (canonical gap);
- all ids, `sr-1`, and any trust or review data.

## 10. Validation checklist for a later Dutch hospitality stakeholder review

For a possible future review with Dutch hospitality practitioners or a sector
stakeholder such as KHN. Any such conversation is a validation or research
conversation only (MARKET-12, required decision 7). No collaboration,
endorsement, standard, dataset, API, or data access is assumed or implied.

- [ ] Do menus commonly use source section labels (for example `SPRITZERS`,
      `SIDE DISHES`) that guests recognize better than any normalized
      category would?
- [ ] How common are "price on request", "from" prices, and several prices
      per item (glass/bottle, sizes)? Do the four `Money` states cover them?
- [ ] Which modifier patterns matter for guests (add-ons, choices), and is the
      canonical gap acceptable until a deliberate `MARKET-02` amendment?
- [ ] How is service mode (dine-in, takeaway, delivery) expressed, and does it
      change prices or availability?
- [ ] How do menus communicate tax/VAT, and what would a guest-facing
      platform need to state about it, if anything?
- [ ] How do restaurants communicate allergens today, and how should
      "no allergen information" be shown so it is never read as
      "allergen-free"?
- [ ] Which availability states (sold out, seasonal, daypart) matter most?
- [ ] Which trust signals (verified by owner, recently checked) are meaningful
      to restaurants and guests?
- [ ] Which terms in this profile would practitioners name differently?

## 11. Open questions (not decided here)

- The concrete `MARKET-06` snapshot format and versioning.
- A stable public identifier or URL strategy for menus, sections, and items.
- The field-level public/private classification (Decision 011 §10).
- Whether derived trust labels ever get a machine-readable form in an
  external export — no standard Schema.org property exists for them.
- How Decision 011 §9 (provenance and freshness for risk-sensitive data)
  applies to machine-readable markup, which decides whether price and
  availability may ever leave the "blocked" state (§3). Possible freshness
  carriers such as `dateModified`, `Offer.priceValidUntil`, `Offer.validFrom`,
  and `Offer.validThrough` are a research question only; none is chosen
  here, and none carries provenance.
- Whether section nesting gets a representation — a `MARKET-02` amendment or
  a separate, explicit envelope decision.
- Whether `MARKET-02` should be amended for modifiers, tax/VAT, service
  mode, or nested sections — each a separate, explicit decision.
- Whether any adapter normalization should ever become canonical — a separate
  `MARKET-02` amendment, never implied by this profile.
- How an AI-assisted inbound proposal is tagged (Decision 011 §8, open there).
- Which Schema.org release a future projection pins to.
