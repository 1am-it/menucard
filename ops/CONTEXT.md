# Ops Context

This directory contains operational notes related to deployment, monitoring and
supporting scripts for BredaEats.

Operational changes should support the product goals of speed, reliability and
low data usage.

## Production database migrations (added 2026-09-06)

Applying a Supabase migration to production is no longer a manual
copy-paste into the Dashboard SQL Editor — see
`docs/guides/production-migration-pipeline.md` for the operational
how-to and `planning/decisions/013-production-migration-pipeline.md` for
why. The actual workflow files live under `.github/workflows/`
(`validate-migrations.yml`, automatic and secret-free;
`production-db-preflight.yml`, manual, read-only, approval-gated —
**run this first**; `production-db-migrate.yml`, manual, approval-gated,
applies changes), not in this directory — noted here since this is the
first place anyone looking for "how do we deploy this" would check.

## App-AI usage export for DevDashboardTower (added 2026-10-23)

`node --env-file=.env.local ops/scripts/export-app-ai-usage.js` — read-only,
local loopback database only. Derives the metadata-only usage document from
stored concepts with `importProvenance` (schema and bounds:
`docs/api/manual-ai-import-usage.md`) and writes it atomically to
`ops/benchmark/output/app-ai-usage.json` (gitignored, BE-21). It refuses a
non-loopback `SUPABASE_URL`, never writes to the database, and prints no key and
no menu content. The same document is served by
`GET /api/internal/v1/manual-menu-import/usage`. A green export is metadata
evidence only, not proof that a model was used.

## Route B AI probe (added 2026-10-23, #59 / BE-21)

`node ops/scripts/run-menu-extraction-ai-probe.js` — dry-run by default: it
hash-verifies the eight pinned capture sets, reads their text locally and writes
an estimated token/cost report to `ops/benchmark/output/ai-probe-report.json`
(gitignored). It needs no key and makes no network call. `--live` requires
`ANTHROPIC_API_KEY` and an explicit `--budget-file` inside the gitignored output
folder; the durable ledger enforces 900 eurocent cumulative, 30 per call, 40
calls and one at a time before every request. Since review 6373183699 the live
run streams the provider answer (`messages.stream` + `finalMessage()`, 180 s call
timeout), appends one line per call to
`ops/benchmark/output/ai-probe-live-calls.jsonl` (gitignored; no key, no headers,
no prompt), rewrites the report after every call, and stops at once when a call's
cost is unknown or after two consecutive provider failures. Since review
6375125413 the run also saves the literal JSON answer of every call (the `text`
block only: no reasoning, no key, no prompt) to the gitignored
`ops/benchmark/output/ai-probe-raw/` and references it from the report and the
JSONL line. `node ops/scripts/diagnose-ai-probe-quotes.js` then explains a
rejected answer offline per citation - the quote, the item, the nearest source
fragments and a classification - and writes a gitignored
`ai-probe-quote-diagnosis.json`; it needs no key and makes no call. A rejected
answer stays diagnosis: it counts as zero extraction. Since review 6375740447
(R1/R2) the adapter derives `coverage.itemsExtracted` from the items it actually
received and downgrades a claimed `complete` status with limitations to
`partial`/`no_items` before validation; both the provider schema and the adapter
no longer trust a model-supplied count, and every correction is recorded per call
in `report.calls[].normalizations` and in the JSONL. Since review 6376108648 (S1-S4)
the source header names the exact `sourceId:` on its own line, the evidence check
equates only the documented typographic character classes, the price-variant rule
is stated in the protocol and the provider schema, and every source row carries a
`mismatchDiagnosis` that explains (diagnosis only) why accepted items did not
match. The backend validator keeps the same rules; since review 6377050602 the
manual import applies this same derivation before validation and shows the
result as a plain-language notice, kept in `importProvenance.normalizations`.
No app route is wired to any of it — `disabledMenuExtractionRuntime` stays in
place.
See `docs/guides/menu-extraction-ai-probe.md`.

## Variant 1 coverage diagnosis (added 2026-10-24, #59 / BE-21)

`node ops/scripts/diagnose-menu-source-coverage.js` — offline diagnosis of the
comparison engine behind the review block "N regels met een prijs staan niet in
het concept". It reads the hash-verified pinned captures plus the literal AI
answers of a live run under `ops/benchmark/output/ai-probe-raw/` (gitignored),
counts per source how many priced source lines no accepted dish covers, and
writes `ops/benchmark/output/ai-probe-coverage-diagnosis.json` (gitignored). No
key, no network, no provider call, and it changes no reference, counting rule or
measurement code. The engine itself is `src/lib/menuSourceCoverage.js` and reuses
the extraction's own price parser and the validator's normalization.

## Variant 5 card with markings (added 2026-10-24, #59 / BE-21, order 6382953597)

`node ops/scripts/diagnose-menu-source-coverage.js` now also reports, per source,
how many priced lines are a **name + price pair** (a price alone on its line,
paired with the nearest preceding text line) and how many are a **loose price
line** (no partner, never coupled to an invented name). The counts and the
before/after numbers of the pinned captures are recorded in
`docs/guides/menu-extraction-acceptance.md`; the diagnosis still reads only local
files and changes no reference, counting rule or measurement code.

### Whole euros as a printed price (added 2026-10-24, #59 AA1)

`src/lib/htmlMenuStructure.js` keeps `findPrices` unchanged for the references
and the measurement, and adds `findWholeEuroPrices` / `findPrintedPrices` /
`wholeEuroAmountTokens` in the same price section: a bare 1-3 digit amount
(optionally `,-`) counts only on a printed cell boundary (2+ spaces, tab, a
column separator or the end of the printed segment), with 2+ letters before it,
not before a unit or counting word, not a year/time/date/phone/numbering/ordinal,
and not glued to a word. `src/lib/menuSourceCoverage.js` reads the prices from the
printed line (`line.raw`, never the whitespace-collapsed copy) and confirms a
whole euro only when the same section prints it on at least two printed rows
(`confirmWholeEuros`), counting a flattened capture row per cell (`segment`).

The diagnosis now prints, per source, `whole euro: N accepted, M refused by the
section rule, refusals {...}` plus the accepted records, and every refusal keeps
its own reason (`unit`, `counting_word`, `ordinal`, `leading_zero`, `glued`,
`time`, `date`, `phone`, `no_boundary`, `no_name`) so a false hit can be reported
instead of hidden. `pricedLinesOfSource(source, { requireSectionConfirmation:
false })` exists for that reporting only; the review always uses the confirmed
list.

### Stored-answer fixture for the review (added 2026-10-24, #59 BB1/BB4)

`ops/benchmark/aiAnswerRealShape.js` is the committed counterpart of the raw
answers under `ops/benchmark/output/ai-probe-raw/` (gitignored). It copies that
shape with fictional values — including the mandatory
`allergens: { status: "unknown", values: [] }` and `isFrom: false` on every item
— so a regression or a route test can replay a real answer instead of a
hand-made minimal object. `aiAnswerRealShape.test.js` validates the fixture
against the unchanged schema; `menuAiReadEndToEnd.test.js` runs it through the
real route chain with a mocked transport (no key, no SDK, no network, no
database) and asserts that rows end up "in orde".

### One-decimal prices with a decimal point (added 2026-10-24, #59 BB2)

`src/lib/htmlMenuStructure.js` adds `findDecimalPointPrices` /
`decimalPointAmountTokens` in the same price section, next to the whole euro:
Blossem prints `4.5`, `3.0` and `4.0`, and `findPrices` only reads two decimals,
so 52 read dishes stood next to "4 regels met een prijs". The family uses the
same printed line rule as the whole euro — 1–3 digits, a printed cell boundary,
a name before it, not before a unit/counting word, not a date/phone — plus three
refusals of its own: a version (`versie 4.5`), a time (`om 12.5`) and a
per-person unit (`42.0 p.p.`). A two-decimal point amount stays with the money
parser and is never counted twice; the amount must sit at the END of the printed
row or cell. `findPrices`, the references, the counting rules and the measurement
stay unchanged.

`src/lib/menuSourceCoverage.js` reads the prices from `findPrintedPrices` only,
so the card and the diagnosis share exactly this reading, and a line that prints
a price is never mistaken for a section heading. The diagnosis prints
`decimal point: N accepted, refusals {...}` per source, with the accepted records
and every refusal reason (`version`, `time`, `price_range`, `unit`,
`leading_zero`, `glued`, `ordinal`, `counting_word`, `date`, `phone`,
`no_boundary`, `no_name`). On the pinned run-2 captures only Blossem changes:
8 → 45 priced lines (37 decimal-point prices, 0 suspicious); the other seven
sources keep their numbers and their refusals.



The review gained a Lijst | Kaart switch. The printed page of one source is read
lazily through
`POST /api/internal/v1/manual-menu-import/imports/{id}/source-map` with
`{ state, source_id, page }`: the capture comes out of the existing sealed state
token, one page per request, bounded per page. No new table, column, migration,
provider call or dependency; a PDF page image is not rendered because the import
keeps no PDF bytes (the card says so and shows the text with the same line
numbers). The red mark's "Neem € x over" action takes the amount from the
server's own reading and stores the source line in
`importProvenance.priceFromSource`.

## PDF.js server packaging check (added 2026-09-30)

`node ops/scripts/verify-pdfjs-server-trace.js` — read-only, run after
`npm run build`. Confirms the BE-20 restaurant-analysis route loads
`pdfjs-dist` natively, that its serverless file trace ships both
`pdf.mjs` and `pdf.worker.mjs`, and that no PDF.js runtime was bundled
into server output. A green build and green unit tests do not prove
this: a function shipped without the worker fails every PDF while every
local run still passes. Not wired into `npm run build`.
