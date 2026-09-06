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
