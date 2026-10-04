# BE-21 — local benchmark foundation

**This is not the real BE-21 vendor benchmark.** It is a local, offline,
provider-neutral foundation that makes BE-20's existing fase-1 analysis
pipeline measurable, so the eventual real benchmark
(`planning/specs/tickets/be-21-restaurant-source-extraction-vendor-benchmark.md`)
— 50-100 real, authorized-to-test restaurant sources, a real OCR/browser-
rendering vendor comparison, a data processing agreement, cost ceilings —
has a manifest, adapter contract, scorer, and report shape to plug into,
rather than starting from nothing. Nothing here fetches a real restaurant
URL, contacts a vendor, or spends any money.

## What actually exists here

- `manifest.js` / `manifest.json` — a case manifest with three honestly
  separated provenance tiers: the six be-20/be-21 **mandatory real
  sources** (metadata only, `fetched: false`, never scored),
  **local BE-20 fixtures** (byte-for-byte reused from existing,
  already-committed `src/lib/pdfTextExtraction.test.js` fixtures), and
  **synthetic fixtures** (fictional pages on the `.invalid` TLD — see
  `fixtures.js`). Covers all six of be-21's own stratification
  categories (`html_only`, `digital_pdf`, `scanned_pdf`,
  `chain_location`, `multilingual`, `javascript_dependent`) through
  fixture-backed entries.
- `adapters.js` — one provider-neutral contract for `deterministic`
  (BE-20's own unmodified pipeline), `ai_structured`, and `ocr` (both
  deliberately unavailable stubs — no vendor, no secret, no network
  call, mirroring `src/lib/claudeStructuringAdapter.js`'s own disabled
  pattern). No adapter result ever carries a precomputed confidence
  value — only raw evidence, so confidence can only ever be derived by
  BE-20's own `deriveFieldConfidence`, never claimed by an adapter.
- `scoring.js` — per-field accuracy (match/mismatch/missing/
  correctly_absent/unexpected_extra), menu-context matching, closed-
  vocabulary error classification, and aggregation strictly by
  `(sourceType, adapterKind)` — never one blended average.
- `runner.js` — a fully offline, deterministic, reproducible runner. A
  mandatory real source's adapter is never invoked at all; a
  deliberately unavailable adapter is invoked (so its own honest
  "unavailable" result exists) but is scored as `not_evaluated`, never
  blended into ordinary accuracy statistics.
- `report.js` / `run.js` — a machine-readable JSON report and a short
  Dutch human-readable summary, both carrying the same explicit
  foundation disclaimer in the report body itself. `node
  ops/benchmark/run.js` runs everything and writes
  `ops/benchmark/output/latest-run.json` (gitignored — a run's own
  output, never a committed artifact).
- Tests for every module above (`node --test ops/benchmark/*.test.js`),
  including two empirically-verified core invariants: a field the
  pipeline actually cross-checked against another same-host sighting can
  reach confidence `hoog`; a field sighted only once, or one that
  genuinely conflicts with another sighting, never can.

## What this is explicitly NOT

- Not the real 50-100-source benchmark set — the six real URLs are
  recorded as metadata only and have never been fetched by anything
  here.
- Not a vendor evaluation of any kind — no OCR provider, no
  browser-rendering service, no API key, no account, no cost incurred.
- Not proof that BE-20 works against real restaurant websites — every
  fixture-backed score here only proves the benchmark *machinery*
  (manifest, adapter contract, scoring, runner, reporting) behaves
  correctly against known, hand-authored, fictional inputs.
- Not a DPA, EU-processing confirmation, retention commitment, or cost
  ceiling — all of those remain be-21's own explicit, separate,
  owner-confirmed deliverables once a real vendor is actually chosen.

## BE-22 — menu-structure track (HTML)

A separate, additive track for recognizing ordinary HTML menus — see
`planning/specs/tickets/be-22-html-menu-recognition-foundation.md`. It
leaves the field track above (manifest, `ADAPTER_KINDS`, `scoreCase`)
untouched.

- `menuExtractionContract.js` — the one output contract shared by the
  deterministic `html_structure` adapter and a later `ai_structured`
  adapter: MARKET-02 money states, a closed rejection vocabulary, a short
  locator on every item's evidence and every rejected line, bounded text,
  flat counter-only `stats`, and cost fields that are always `null` here.
  One bounded, cycle-safe recursive scan (`findForbiddenTrustKey`) accepts
  only plain, JSON-safe data and rejects `confidence`/`reviewReady` at any
  depth: every Proxy — transparent or one hiding keys — is rejected first
  via `util.types.isProxy` (from `node:util`, the only Node built-in this
  track imports), before any trap runs; every own key is inspected (`Reflect.ownKeys`), non-enumerable
  properties, symbol keys and accessors are violations (a getter is never
  invoked), only plain objects (prototype `Object.prototype`/`null`) and
  arrays are allowed — so an inherited trust key fails closed — and a
  cyclic, over-deep, over-large or otherwise uninspectable structure is
  itself a violation. The shared guard runs this scan before any other
  property read and before scoring, in both runners.
- `htmlMenuStructure.js` — a dependency-free HTML tree builder and the
  `html_structure` adapter, bounded in input (2 MB, 50 000 nodes, 1 000
  open elements) AND in work: one linear forward pass (unclosed
  `script`/`style`/comment blocks consumed in one scan; closing tags for
  elements that are not open ignored in O(1); implicit closing looks at most
  64 levels up), with every token, forward scan, stack step, tree visit,
  queued child, table-cell classification and block of inspected item text
  charged to a deterministic budget (`MAX_WORK`; `options.maxWork` can only
  lower it). Exceeding any bound returns `unparsed`, never a partial menu.
  Supported: heading sections (`h1`–`h6`, `role="heading"`), list items
  (`li`, `role="listitem"`, nested lists as sub-sections), table rows,
  definition lists, and repeated item cards, each with name and price in the
  same element; a description only inside that same element.
  Rejected with a reason: clock times (ranges, weekdays, and a single time
  in clear time context — "vanaf 12.00", "om 21.45", "08.30 uur"); dates in
  clear date/event context ("Fictief feest 24.12", "op 01.06", "15 mei");
  service units (per person/table, arrangements, packages, courses — a small
  local list until BE-20's is merged); modifiers; prices without a name; an
  element with several independent name/price pairs (`ambiguous_structure`,
  never merged and never read as its first pair) — in a list item or
  definition (a name between two prices), a table row (two runs of name
  cells and two runs of price cells), or a card (two outermost name
  elements, two outermost price elements, or a price outside its one price
  element); and anything under an opening-hours, contact, reservation,
  reviews, arrangement, voucher, ticket, admission, parking, cloakroom or
  webshop heading. A volume or weight BEFORE the first price ("0,75 l",
  "33cl", "250 g", a sub-euro "0,75 L") is never a price; a size letter or
  unit-like token after a price ("9,50 M 12,50 L") is kept as a price, so
  two prices stay `multiple_undecomposed`. One name with glas/fles price
  cells or variants stays one `multiple_undecomposed` item. Unpriced lines
  and prose prices never count; fewer than three items is `unparsed`.

  Known limitations (not solved, and not claimed to be):
  - Non-dish price lists WITHOUT a clear section label (unlabelled voucher
    cards, admission or parking prices) are still read as a menu — this is
    structure recognition, not semantic understanding. A test documents it.
  - Time and date recognition depends on context words; a bare day.month
    without context ("12.05") stays a price, and comma clock times
    ("12,00 uur") are read as prices.
  - Deliberate fail-closed recall limits (real items are lost, never
    misread):
    - a dot price right after "van"/"tot" ("van 4.50 voor 3.50") is
      rejected as a time;
    - a price RANGE with clock-like minutes ("Fictieve pizza 10.00 - 12.00")
      is rejected as a time range;
    - a dot price followed by "u" as an ordinary word ("5.50 u kiest zelf")
      is rejected as a time ("5.50 u" reads as "5.50 uur");
    - a valid day.month dot value in an item that names an event word
      ("Fictieve feest-taart 4.05") is rejected as a date;
    - a unit-like token after a price ("4,50 (0,25 l)") makes the item
      `multiple_undecomposed` instead of known;
    - a lower-case "l"/"g" directly after a lone price ("12,50 l") is read
      as a volume, leaving the item without a price; an upper-case "1,00 L"
      (one litre, ≥ €1) is read as a price;
    - a card with separate price elements for variants (glas/fles) is
      rejected as ambiguous, unlike a table row with variant price cells;
    - "Entree" as a starters heading is treated as admission.
  - Known structure limits (not solved; no amount is claimed, but a second
    dish can be hidden):
    - the ambiguous table order "name | price | price | name" ("Fictieve
      soep | 6,50 | 7,50 | Fictieve salade") is read as one
      `multiple_undecomposed` item with only the first name visible (the
      second name becomes its description) — it cannot be told apart from
      glas/fles prices followed by a description cell;
    - a second dish name shorter than three letters inside one combined
      element ("Fictieve soep 6,50 Ei 2,50") is not reliably distinguished
      from a variant label, so the element can become one
      `multiple_undecomposed` item named after the first dish.
  - Amounts of €1.000 or more with a thousands separator are not recognized
    (fail closed).
  - Only a trailing alcohol percentage is dropped from a displayed name.
- `htmlMenuFixtures.js` — synthetic, self-written cases ("Fictie…" names
  only; never copied restaurant content) with explicit expected results.
- `menuScoring.js` / `menuBenchmark.js` — precision, recall, wrong prices,
  wrong sections, false/missed menus, review load, local timing and `null`
  cost, per `(sourceType, adapterKind)`; the `ai_structured` stub is always
  `not_evaluated`. `assertNeverCarriesPrecomputedConfidence` applies the same
  recursive scan to every adapter result of both tracks, before scoring.
- `menuIsolation.test.js` — proves no product code imports this directory
  and the menu modules import no network client, provider, browser tool,
  child process or environment variable; the only non-relative import is
  `node:util` (for `types.isProxy`), in the contract module only.

A perfect score on these fixtures only proves the machinery against inputs
written alongside the adapter — never that any real website's HTML menu is
supported. That needs a separately authorized benchmark on real sources.

**No bare-price fallback (decision).** A bare number ("18", "13,5" — whole
euros or one decimal, no euro sign) is never a price for this adapter, also
not inside an element classed as a price: without semantic understanding it
cannot be told apart reliably from a rating, old price, from-price,
capacity, workshop or ticket price, gift voucher or step number. Two local
recall experiments in that direction were rejected by independent reviews
and never pushed or integrated. A source whose menu needs such
interpretation stays `unparsed` (or `ambiguous_structure`); that is the
documented hand-over point to a separate, not yet authorized AI structuring
track — see "Decision: no bare-price fallback" and "Hand-over boundary" in
`planning/specs/tickets/be-22-html-menu-recognition-foundation.md`. Nothing
here authorizes AI, OCR, providers or any external call.

## Running it

```
node ops/benchmark/run.js
node --test ops/benchmark/*.test.js
```

Both are fully offline and safe to run repeatedly — no network call, no
secret, no external state.
