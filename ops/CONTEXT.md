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

## PDF.js server packaging check (added 2026-09-30)

`node ops/scripts/verify-pdfjs-server-trace.js` — read-only, run after
`npm run build`. Confirms the BE-20 restaurant-analysis route loads
`pdfjs-dist` natively, that its serverless file trace ships both
`pdf.mjs` and `pdf.worker.mjs`, and that no PDF.js runtime was bundled
into server output. A green build and green unit tests do not prove
this: a function shipped without the worker fails every PDF while every
local run still passes. Not wired into `npm run build`.
