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

## Running it

```
node ops/benchmark/run.js
node --test ops/benchmark/*.test.js
```

Both are fully offline and safe to run repeatedly — no network call, no
secret, no external state.
