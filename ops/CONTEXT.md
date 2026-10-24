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

## PDF.js server packaging check (added 2026-09-30)

`node ops/scripts/verify-pdfjs-server-trace.js` — read-only, run after
`npm run build`. Confirms the BE-20 restaurant-analysis route loads
`pdfjs-dist` natively, that its serverless file trace ships both
`pdf.mjs` and `pdf.worker.mjs`, and that no PDF.js runtime was bundled
into server output. A green build and green unit tests do not prove
this: a function shipped without the worker fails every PDF while every
local run still passes. Not wired into `npm run build`.
