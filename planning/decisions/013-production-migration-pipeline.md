# Decision — Production Supabase Migration Pipeline: Manual, Approval-Gated CI, via the Supabase CLI

## Status

Accepted (design and infrastructure). Not yet exercised against a real
migration — see "What this decision does not do" below.

## Context

Every Supabase migration this project has written so far
(`supabase/migrations/0001`–`0010`) has been applied to production, when
applied at all, by copying the file's contents into the Supabase
Dashboard's SQL Editor by hand and running it once, with the outcome
recorded only as prose in `planning/CONTEXT.md` ("migration `0007` has
since been applied live"). This has no automated record of *which*
migrations a given database has actually received, no repeatable
process, and no access control beyond whoever happens to hold Dashboard
credentials at the time. `planning/decisions/010-platform-persistence-and-api.md`
chose Supabase as the persistence layer but explicitly left "the exact
schema (table DDL, RLS policy definitions)" and everything about how
they get *applied* for later tickets to work out — this decision is that
follow-up, for the apply step specifically.

The immediate trigger: `MARKET-05C`'s migration
(`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`) is
written, locally validated, and reviewed, but still not live — exactly
the situation this pipeline needs to exist for, without this decision
itself touching that migration or its application code at all (see "What
this decision does not do").

## Decision

**Mechanism: the official Supabase CLI (`supabase link` + `supabase db
push`), run from a manually-triggered, approval-gated GitHub Actions
workflow.** Rejected in favor of this over inventing a bespoke
"which migrations have run" tracking table: the CLI already solves
exactly that problem, in a way used and hardened across the entire
Supabase ecosystem, via a migration-history table it manages in the
target database itself. Building a custom equivalent would be the
"geïmproviseerde oplossing" this project's own engineering discipline
asks to avoid rather than a genuine improvement.

**Two separate GitHub Actions workflows, not one:**

- `validate-migrations.yml` — automatic (push/PR touching
  `supabase/migrations/**`), against a throwaway `postgres:16` service
  container, no secrets, cannot affect anything real. Automates this
  project's own pre-existing manual practice of validating a migration
  sequence in a disposable, containerized Postgres instance before
  considering it ready.
- `production-db-migrate.yml` — `workflow_dispatch` only, no other
  trigger of any kind, targeting a protected GitHub Environment
  (`production-migrations`) with required reviewers. This is the only
  path that can ever touch the real production database's schema.

**A migration must never run because of an ordinary push to `main`.**
Enforced structurally: `production-db-migrate.yml` has no `push` trigger
at all, and the environment's required-reviewer setting (a repository
setting, not expressible in the workflow file itself — see below) is
what turns `workflow_dispatch` into "one explicit trigger *and* one
separate explicit approval," rather than either alone.

**Secrets**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD` — GitHub Actions secrets scoped to the
`production-migrations` environment specifically (not repository-wide),
so reading them requires having already passed the approval gate, not
merely having permission to dispatch a workflow. None are ever written
to a file in this repository; `supabase/config.toml` (added by this
decision, required for the CLI to recognize the project at all) contains
only a local, non-sensitive label, never the real project reference.

**Release sequencing**: a migration and the application code that
depends on it release as two separate steps — migration merged, applied
via this pipeline, and verified live first; the dependent app code
merged (and Vercel-deployed) only afterward. Documented as an explicit
rule, with a non-blocking CI reminder (`validate-migrations.yml`'s own
advisory step) rather than a hard block, since developing both together
on one feature branch is normal and only *releasing* them together is
the mistake.

**Verifiable result**: `supabase migration list`'s own output (read from
the target database's real migration-history table, not inferred from
file names), printed both before and after the push, plus a GitHub
Actions run summary naming who triggered the run, a link to it, and the
before/after state — all without any new dashboard, database table, or
notification channel.

## What this decision does not do

**Does not touch, migrate, or run `supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
or any of MARKET-05C's application code.** That migration remains
exactly as not-yet-applied-live as it already was; this decision only
builds the pipeline capable of applying it (and every migration after
it) once it, and this pipeline's own one-time setup, are both explicitly
ready. No workflow was executed as part of this decision — see
`docs/guides/production-migration-pipeline.md`'s own "Residual risks"
section for exactly what remains unverified because of that.

**Does not change anything about how the Next.js app itself is deployed.**
Vercel continues to auto-deploy on push to `main`, unchanged — this
decision only governs the separate, schema-only migration step that
must happen before app code depending on new schema is allowed to reach
that deploy path.

## Trade-offs (stated plainly, not resolved here)

- **A second, Supabase-specific access token and DB password now need to
  exist as GitHub secrets**, in addition to the app's own runtime
  Supabase credentials already required for Vercel. Two secret sets to
  rotate instead of one — accepted because environment-scoping the new
  ones is what makes the approval gate actually restrict *who can apply
  a migration*, not just *who can see a workflow run*.
- **The approval gate lives entirely in a GitHub repository setting**
  (Environments → required reviewers), not in any file this repository
  version-controls. This means the safety property this whole decision
  exists for is not itself auditable via `git log` — a repository export
  or a deliberate look at Settings is required to confirm it's actually
  configured. Documented with maximum visibility (a warning banner at
  the top of the workflow file itself, plus this decision's and the
  guide's own repeated callouts) as the best available mitigation; GitHub
  Actions does not currently offer a way to express "this environment
  must have required reviewers configured, and refuse to run at all
  otherwise" from within the workflow file.
- **`supabase/config.toml` was hand-authored without running the
  Supabase CLI locally** (no network access in this session). Minimal by
  design specifically to reduce the surface for that risk, with an
  explicit, named verification step left for whoever runs this pipeline
  for the first time.

## Addendum (2026-09-06) — a third workflow, and verified CLI findings

This is a dated addition, not a rewrite of the decision above, which
still stands as originally written.

**A third workflow was added: `production-db-preflight.yml`.**
`workflow_dispatch` only, confirmed with the literal phrase `verify`
(deliberately different from `production-db-migrate.yml`'s `migrate`),
gated by the same `production-migrations` environment — no new
environment or secret was needed. It performs only read-only checks
(secrets present, `supabase link` succeeds, `supabase migration list
--linked` succeeds) and never runs `db push` or any SQL. It exists so
"are we ready to migrate?" can be answered, and re-answered, without ever
risking a write — see `docs/guides/production-migration-pipeline.md`'s
"Safe order of production actions" for the required sequencing (preflight
first, always).

**Three findings were verified against the Supabase CLI's own official
documentation and confirmed to matter for this pipeline**, none of which
were known when the original decision above was written:

1. `supabase/setup-cli@v1` (used by the original `production-db-migrate.yml`)
   is outdated; the action's current documented tag is `@v3`. Fixed in
   both `production-db-migrate.yml` and the new preflight workflow.
2. `supabase db push` has a documented CI failure mode (Supabase GitHub
   Discussion #26366): an unanswered interactive prompt can make it
   report success while applying nothing. Fixed by piping `yes` into the
   command with `set -o pipefail` so a real failure still fails the step.
3. This repository's migration filenames use a 4-digit sequential prefix
   (`0001_...`–`0010_...`), while the CLI's documented convention is a
   14-digit timestamp prefix. Whether this actually breaks
   `link`/`db push`/`migration list` could not be resolved from
   documentation alone. **Not fixed** — deliberately left as an open risk
   for the preflight workflow to surface on its first real run, since
   renaming migration files was out of scope for the round that added
   this addendum (see `docs/guides/production-migration-pipeline.md`'s
   "Residual risks" for the full detail and the fix path if it
   materializes).

None of this addendum's changes touch `supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
or any MARKET-05C application code, consistent with the original
decision's own "What this decision does not do."

## Addendum 2 (2026-09-06) — non-interactive flag correction, exact history-sync gate, dry-run gate

This is a second dated addition, the same day as Addendum 1 above, from a
follow-up hardening pass before this pipeline's first real dispatch. It
does not rewrite Addendum 1 — see the corrections inline in
`docs/guides/production-migration-pipeline.md`'s "Residual risks" for the
full detail. Three changes:

1. **Correction, not a new finding**: Addendum 1's `yes | supabase db
   push` fix for the CI prompt bug (Discussion #26366) is replaced by the
   Supabase CLI's own documented `--yes` global flag (`supabase --yes db
   push --linked`) — "answer yes to all prompts," placed before the
   subcommand. Addendum 1's search had only checked `db push`'s own flag
   table, which doesn't list `--yes` because it's documented separately
   as a *global* flag; this was found by checking the CLI's global-flags
   reference directly. No pipe, no `set -o pipefail` needed.
2. **`production-db-preflight.yml` now requires EXACT history sync, not
   just a successful command.** Both this workflow and
   `production-db-migrate.yml` take a new `expected_versions` input (the
   version(s), e.g. `0010`, this run should find/apply as pending, or
   `none`). The preflight reports "Ready for migration" only when local
   vs. live history matches that declaration exactly; any other outcome —
   including the specific, expected case of `0001`-`0009` appearing
   pending because they were applied by hand outside the CLI — reports
   "Not ready" and points at a required, separate, explicitly-approved
   history reconciliation (`supabase migration repair`, run manually,
   never by either workflow). See
   `docs/guides/production-migration-pipeline.md`'s new "History
   reconciliation" section. **This directly gates MARKET-05C**: `0010`
   cannot be released as a migration-only step until that reconciliation
   is done and a preflight run reports ready for it specifically.
3. **`production-db-migrate.yml` now runs a read-only `db push --dry-run`
   before the real push**, parses which version(s) it says it would
   apply, and aborts before any write if that set doesn't exactly match
   `expected_versions` — an independent, second confirmation of the same
   "expliciet bedoelde release" check the preflight already performed,
   now immediately before the point of no return.

Local testing this round (synthetic fixtures matching the CLI's
documented `migration list`/`db push --dry-run` output shapes, run
through the exact parsing logic used in both workflows) found and fixed
one real bug: matching the table's column separator via an `awk` bracket
character class (to accept either `|` or the CLI's documented Unicode
`│`) silently mis-parsed under this environment's locale even with the
same `gawk` version `ubuntu-latest` ships. Fixed by normalizing with
`sed` before a plain single-character `awk -F'|'` split, reverified
against the same fixtures. This was never tested against the real
Supabase CLI's actual output — see the guide's "Residual risks" for what
remains unverified.

None of this addendum's changes touch
`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`,
migration `0010`, or any MARKET-05C application code — same as Addendum 1
and the original decision's "What this decision does not do."

## Addendum 3 (2026-09-06) — unambiguous preflight semantics, a fourth reconciliation-only workflow, two real bash bugs fixed

This is a third dated addition, the same day as Addenda 1 and 2 above,
from a follow-up hardening pass specifically requested to disambiguate
preflight semantics and add a dedicated history-reconciliation workflow
before the first real preflight run. It does not rewrite Addenda 1/2 —
see `docs/guides/production-migration-pipeline.md`'s "Safe order of
production actions" and "History reconciliation" sections for the full,
current detail. Four changes:

1. **Addendum 2's single shared `expected_versions` input was replaced
   with three distinctly-named, distinctly-scoped inputs**, because a
   single shared concept ("what's expected") had been quietly doing two
   different jobs: `production-db-preflight.yml` now takes
   `applied_versions` (what must already be applied, both locally and
   live) and `staged_versions` (what must exist only as a local file, not
   yet applied anywhere); `production-db-migrate.yml` now takes
   `release_versions` (what this specific dispatch is authorized to
   push). A preflight run can never accept `staged_versions` naming a
   version with no matching local file — this is the structural
   guarantee that a preflight on `main` can never expect `0010` before
   `0010` has actually been merged there.
2. **A fourth workflow, `production-db-history-reconcile.yml`, was
   added** — the only workflow in this repository allowed to run
   `supabase migration repair`. Gated by the same `production-migrations`
   environment, its own distinct confirmation phrase
   (`repair-history-only`), and a `legacy_versions` input that must match
   a constant hard-coded in the workflow file itself
   (`DOCUMENTED_LEGACY_VERSIONS`) — not just any operator-typed value.
   Before its one write (`migration repair --status applied`, which per
   the Supabase CLI's own documentation only touches the history-tracking
   table, never schema or data), it verifies: local files exist for
   exactly the declared legacy set (never `0010` or later); remote
   history contains no version outside that set; and it repairs only
   the specific versions still missing from remote, never the full set
   unconditionally. It re-verifies exact sync after writing and never
   runs `db push`, SQL, seed, reset, delete, or an app deploy.
3. **The full nine-step safe order for this repository's actual first
   release was written out explicitly** in the guide's "Safe order of
   production actions": GitHub setup → preflight for `0001`-`0009`
   (expected to fail) → history reconciliation → preflight again
   (expected to pass) → `0010` merged as a migration-only release →
   preflight with `0010` staged → the production migration → read-only
   verification → only then MARKET-05C's application code.
4. **Two real bash bugs were found via local testing and fixed in all
   three affected workflows** (`production-db-preflight.yml`,
   `production-db-migrate.yml`, and the new
   `production-db-history-reconcile.yml`) — both present since Addendum
   2, neither caught by that round's own tests because those only
   exercised single-version inputs:
   - `tr -d '[:space:]'` (meant to strip incidental whitespace) also
     deletes the newlines that `tr ',' '\n'` had just introduced,
     silently concatenating every multi-version comma-separated input
     (e.g. `legacy_versions: 0001,...,0009`) into one garbled token.
     Fixed with `tr -d '[:blank:]'` (space/tab only).
   - `printf '%s\n' "${arr[@]}"` on a genuinely empty array still prints
     one blank line (printf runs its format at least once), and
     `"${arr[@]:-}"` compounds this by turning "zero elements" into "one
     empty-string element" even before that. Together these silently
     broke the single most important scenario this pipeline exists for:
     comparing against a completely empty remote history, before any
     reconciliation has happened. Fixed with a small `print_lines`
     helper that prints nothing for zero arguments, used everywhere a
     possibly-empty array feeds a `comm`/`mapfile` comparison.

   See the guide's "Residual risks" for the full write-up. Both fixes
   were verified against synthetic fixtures covering the exact scenarios
   this pipeline is for (empty remote history, partial reconciliation,
   `0010` staged before/after merge, unexpected remote versions) — never
   against the real Supabase CLI or the real project.

None of this addendum's changes touch
`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`,
migration `0010`, or any MARKET-05C application code — same as Addenda 1
and 2 and the original decision's "What this decision does not do." No
workflow was dispatched, no live database action was taken, and nothing
was committed as part of this addendum.

## Rejected alternatives

- **A custom migration-runner script with its own tracking table**
  (e.g. a `schema_migrations` table this project defines and maintains
  itself, applied via a plain `psql`/`pg` connection). Rejected: this is
  exactly the "reinvent what already exists" risk this decision's own
  engineering discipline warns against — the Supabase CLI already
  provides this, tested across a much larger surface than one project
  could validate alone.
- **Applying migrations automatically on every merge to `main`.**
  Rejected outright by the task this decision responds to: a schema
  change reaching production without a distinct, explicit human approval
  is exactly the failure mode this pipeline exists to prevent, regardless
  of how well-tested `validate-migrations.yml`'s sandboxed check is —
  that check proves the SQL is *internally consistent*, never that
  applying it to the real, live, already-populated production database
  at this exact moment is the right call.
- **A single combined workflow** (validate-then-apply in one file, gated
  by one manual trigger). Rejected in favor of two separate files: a
  combined workflow would either need secrets present even for the
  sandbox validation step (unnecessary exposure) or would complicate
  keeping the "any push can trigger the harmless half" property separate
  from "only an approved dispatch can trigger the dangerous half."
