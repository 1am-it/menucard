# Production Supabase migration pipeline

How this project's Supabase migrations (`supabase/migrations/*.sql`) get
applied to the real, production database — replacing the fully manual
process every migration through `0009` (and, as of this writing, `0010`)
has used so far: copy the file's contents into the Supabase Dashboard's
SQL Editor by hand, run it, and record the outcome in prose in
`planning/CONTEXT.md`. See `planning/decisions/013-production-migration-pipeline.md`
for why this changed and what was decided; this file is the concrete
operational how-to.

## The three workflows, and why there are three

| | `.github/workflows/validate-migrations.yml` | `.github/workflows/production-db-preflight.yml` | `.github/workflows/production-db-migrate.yml` |
|---|---|---|---|
| Trigger | Automatic — push/PR touching `supabase/migrations/**` | **Manual only** — `workflow_dispatch`, confirm `"verify"` | **Manual only** — `workflow_dispatch`, confirm `"migrate"` |
| Target | A throwaway Postgres container, destroyed after the job | The real, production Supabase project — **read-only** | The real, production Supabase project — **applies changes** |
| Secrets needed | None | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` | Same three secrets |
| Approval | None needed — it can't affect anything real | **Required** — same protected GitHub Environment | **Required** — same protected GitHub Environment |
| What it proves | The full migration sequence applies cleanly, in order, from empty | Secrets work, the CLI accepts the config, auth + project linking succeed, and local vs. live migration history can be compared — **without changing anything** | The *pending* migrations were actually applied to production |

They are deliberately three separate files, not two, and not one combined
one. `validate-migrations.yml` is safe to run automatically on every
change because it is incapable of touching anything real.
`production-db-preflight.yml` and `production-db-migrate.yml` both reach
the real production project and therefore both require the same explicit
human trigger and separate human approval — but only the second one is
capable of changing anything; the first exists specifically so that fact
("are we actually ready?") can be checked and re-checked, as often as
needed, without ever risking a write.

## Safe order of production actions

**Always run the preflight before the migration workflow — never dispatch
`production-db-migrate.yml` cold.**

1. Dispatch `production-db-preflight.yml` (confirm: `verify`). Read its
   job summary.
2. Only if that summary says **"✅ Ready for migration"**: dispatch
   `production-db-migrate.yml` (confirm: `migrate`) for the specific
   pending migration(s) the preflight's LOCAL/REMOTE comparison named.
3. If the preflight instead says **"❌ Not ready"**, resolve whatever it
   named (missing secret, failed link, failed history comparison) and
   re-run the preflight — it is read-only and safe to run as many times
   as needed — before ever attempting step 2.

As of this writing, the next real migration release under this rule is
`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql` —
already written and locally validated (see `validate-migrations.yml`),
but not yet live. This document and the preflight workflow do not apply
it; that remains a separate, later, explicitly-approved dispatch of
`production-db-migrate.yml`, only after a preflight run reports ready.

## One-time GitHub setup (do this before dispatching the workflow for real)

**This is the part that actually makes the approval gate real. Skipping
it does not make the workflow refuse to run — it makes the workflow run
immediately, with no approval step at all**, because GitHub Actions
auto-creates an environment with zero protection the first time a
workflow references one that doesn't already exist.

1. **Repository Settings → Environments → New environment**, named
   exactly `production-migrations` (matching the `environment:` key in
   both `production-db-migrate.yml` and `production-db-preflight.yml` —
   renaming one without the others breaks the link between them). This
   one-time setup protects both workflows simultaneously; nothing extra
   is needed to also gate the preflight.
2. On that environment, enable **Required reviewers** and add at least
   one person authorized to approve a production migration. (Optionally
   also set a wait timer, and restrict which branches/tags may deploy to
   this environment to `main` only — Settings on the same environment
   page, "Deployment branches and tags.")
3. On that same environment's **Environment secrets**, add:
   - `SUPABASE_ACCESS_TOKEN` — a Supabase personal/service access token
     (Supabase Dashboard → Account → Access Tokens → Generate new token).
     Scope this to a dedicated CI-purpose account if your Supabase
     organization supports it, rather than a founder's personal account,
     per the least-privilege principle this project already applies
     elsewhere (`planning/decisions/010-platform-persistence-and-api.md`'s
     own explicit-scopes-not-a-single-admin-flag posture).
   - `SUPABASE_PROJECT_ID` — the project's reference id (Supabase
     Dashboard → Project Settings → General → "Reference ID").
   - `SUPABASE_DB_PASSWORD` — the project's Postgres database password
     (Supabase Dashboard → Project Settings → Database → "Database
     password" — reset it there if it is not already known; resetting
     invalidates the old one, so coordinate before doing this against a
     database other services also connect to).

   **Scope these secrets to the environment, not the whole repository.**
   A repository secret is readable by any workflow run on any branch; an
   environment secret is only readable once a job actually reaches that
   protected environment — i.e., only after the required reviewer has
   approved. This is what stops "anyone who can dispatch a workflow" from
   also being "anyone who can read the production DB password."

None of these three values are ever written to a file in this
repository — they exist only as GitHub's own encrypted secret storage,
injected into the job's environment at run time. This is a completely
separate secret set from the app's own runtime configuration
(`.env.local` / Vercel's project environment variables —
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc., per
`.env.local.example`). Don't confuse the two: the app's runtime secrets
let the deployed Next.js app talk to Supabase as a normal client; these
three CI secrets let the Supabase CLI talk to Supabase's Management API
and the database directly, only to push schema migrations.

## One-time Supabase-side setup

- The access token and DB password above (Supabase Dashboard, as
  described).
- Nothing else — this pipeline does not need a new Supabase feature or
  plan tier. `supabase link`/`db push` work against any existing project.

## How approval works, end to end

0. **Preflight first, always** (see "Safe order of production actions"
   above): dispatch `production-db-preflight.yml` (confirm: `verify`),
   have it approved at the `production-migrations` environment like any
   other run of that environment, and confirm its summary says "✅ Ready
   for migration" before continuing to step 1 below. This step performs
   no write of any kind — it exists so readiness can be checked (and
   re-checked) independently of ever running `db push`.
1. A migration file (or files) lands on `main` — after `validate-migrations.yml`
   has already run automatically and passed on that PR (recommended:
   make that check a **required status check** on `main`'s branch
   protection rule, so nothing merges without it — a one-time repository
   setting alongside the environment setup above).
2. Someone with write access goes to the repo's **Actions** tab →
   "Apply production database migrations" → **Run workflow**, selects
   the `main` branch, and types `migrate` in the confirmation field
   exactly as prompted.
3. The job starts, validates the confirmation phrase and that all three
   secrets are configured, then **pauses** at the `production-migrations`
   environment (assuming the one-time setup above was done).
4. A configured reviewer sees the pending deployment (GitHub notifies
   reviewers, and it's visible under the workflow run's "Review
   deployments" button) and either approves or rejects it. Approving is
   the one explicit production approval this whole design exists to
   require — nothing before this point has touched a secret or a
   connection.
5. Once approved, the job links the Supabase CLI to the production
   project, prints which migrations are currently pending
   (`supabase migration list --linked`), runs `supabase db push --linked`
   (applies only the not-yet-recorded ones, in order — never a full
   re-run, never anything not already a reviewed file in
   `supabase/migrations/`), then prints the resulting migration state
   again.
6. If any migration fails to apply, `supabase db push` itself stops at
   that file — no attempt to skip it and continue, no partial success
   reported as success. The job fails, and every later step is skipped
   (the "Show the resulting migration state"/summary steps still run,
   via `if: always()`, so the failure is visible, but nothing pretends
   the run succeeded).

Note the confirmation phrase is deliberately different between the two
workflows — `verify` for the read-only preflight, `migrate` for the
actual apply — precisely so a copy-pasted confirmation value can never
accidentally trigger the wrong one.

## How to verify the outcome (the "controleerbaar resultaat")

- **The workflow run's own summary** (`$GITHUB_STEP_SUMMARY`, visible
  directly on the run's page) shows who triggered it, a link to the run,
  the migration state before and after, and a reminder of the next step.
- **`supabase migration list --linked`'s own output**, printed twice in
  the job log (before and after `db push`), is the authoritative "what's
  actually applied" answer — it reads the real migration history table in
  the target database, not a guess from file names alone.
- **Cross-check in the Supabase Dashboard** (Table Editor / SQL Editor)
  that the new tables/functions named in the migration actually exist,
  the same live-verification discipline this project has applied to
  every migration so far.
- **Record the outcome in `planning/CONTEXT.md`**, matching this
  project's own existing convention for every prior migration (e.g. "the
  candidate-reviews table... has since been applied live"). This
  pipeline automates the *apply* step; it does not replace this
  project's documentation discipline around it.

## Release sequencing

**A migration and the application code that depends on its new
tables/RPCs must never ship as one release, even though they are
routinely developed together on one feature branch.** Release them as
two separate steps:

1. **Migration release**: the PR containing only (or primarily)
   `supabase/migrations/**` merges to `main`, `validate-migrations.yml`
   has already passed on it, and `production-db-migrate.yml` is
   dispatched and approved — the migration is now live, verified per
   "How to verify the outcome" above.
2. **App release**: only *after* step 1 is confirmed live does the PR
   containing the application code that reads/writes the new
   tables/calls the new RPCs get merged — which Vercel then deploys
   automatically, per this project's existing Git-integration deploy
   flow (`planning/decisions/010-platform-persistence-and-api.md`:
   "Vercel continues to host the app exactly as it does today").

Reversing this order — deploying app code that calls an RPC or reads a
table before the migration that creates it is live — fails at runtime
for every visitor of that code path, not just internally. `validate-migrations.yml`
prints a non-blocking `::notice::` reminder whenever a single push/PR
touches both `supabase/migrations/**` and other files, precisely so this
sequencing rule is never missed by accident — it never fails the build,
since mixing both in one *branch* is normal; only mixing both in one
*release* is the mistake this guide asks you to avoid.

## Residual risks / what has not been verified

This pipeline was designed and written without network access to an
actual GitHub Actions runner or a real Supabase project — nothing in it
has been executed against a real Supabase project. Before relying on it
for a real production migration:

- **_(Added 2026-09-06)_ `supabase/setup-cli@v1` was corrected to `@v3`**
  in both `production-db-migrate.yml` and `production-db-preflight.yml`,
  after checking the action's own README — `v1` was outdated at the time
  this pipeline was first written. If a newer major version exists by the
  time this is actually run, re-check before dispatching.
- **_(Added 2026-09-06)_ `supabase db push` has a documented CI-specific
  failure mode** (Supabase GitHub Discussion #26366): it can wait on an
  interactive confirmation prompt that a non-interactive CI shell never
  answers, and in that case can report a *successful* exit having applied
  nothing. `production-db-migrate.yml`'s "Apply pending migrations" step
  now runs `set -o pipefail; yes | supabase db push --linked` to answer
  any such prompt automatically and to make sure a real failure still
  fails the step (plain `yes | cmd` without `pipefail` would mask a
  non-zero exit from `cmd` behind `yes`'s own always-zero one). This
  workaround is documented, not yet exercised against a real prompt — the
  first real dispatch is this fix's first real test too.
- **_(Added 2026-09-06)_ Migration filename convention mismatch — NOT
  resolved, only newly documented.** The Supabase CLI's own reference
  documentation and CLI issue #6036 confirm the officially expected
  migration filename shape is `<timestamp>_<name>.sql` with a 14-digit
  `YYYYMMDDHHMMSS` prefix. This repository's actual files
  (`supabase/migrations/0001_field_provenance.sql` through
  `0010_market05c_restaurant_profile_drafts.sql`) use a 4-digit
  sequential numeric prefix instead. Whether the CLI merely needs any
  consistently sortable string (which zero-padded sequential numbers
  satisfy) or hard-validates the timestamp shape could not be
  conclusively resolved from documentation alone. **This is exactly what
  `production-db-preflight.yml`'s "Compare local migration files against
  the live migration history" step tests, safely, before any real
  migration is ever applied** — if that step or `supabase migration list`
  errors instead of producing a clean LOCAL/REMOTE table, this mismatch is
  the first thing to suspect. Renaming the migration files themselves was
  deliberately left out of scope for this round (touches migration-adjacent
  files this round's task explicitly excluded); if the risk materializes,
  the fix is a separate, explicit ticket to rename
  `supabase/migrations/*.sql` to the 14-digit convention, migrating the
  live history table's recorded names to match.
- **`supabase/config.toml` is hand-authored, not generated by a locally
  run `supabase init`.** It is deliberately minimal (just `project_id`,
  a local label, never the real project reference). Confirmed against the
  Supabase CLI's own official config reference (2026-09-06) to be a
  correct and sufficient minimal file — `project_id` is documented as the
  only required top-level field. If the CLI still errors on `link`/`db
  push` complaining about the config shape, extend this file per the
  CLI's own current `supabase init` output, not by guessing further.
- **The environment-protection setup is entirely manual and
  unverifiable from within the workflow itself** — see the warning
  banner at the top of `production-db-migrate.yml`. There is no
  automated check in this repository that confirms `production-migrations`
  is actually configured with required reviewers before the first real
  dispatch; this must be confirmed by hand (Settings → Environments →
  production-migrations should show "Required reviewers" listed) before
  trusting either protected workflow for anything production-real.
- **`production-db-preflight.yml` itself has not been run.** Its
  individual commands (`supabase --version`, `supabase link`, `supabase
  migration list --linked`) were each checked against the Supabase CLI's
  own official documentation this round — including the specific claim
  that `supabase link` performs no schema/data write — but the workflow
  as a whole, including how it behaves inside GitHub's actual environment-
  approval flow, has not been executed. Its first real dispatch is what
  this whole round of hardening exists to make safe to attempt.
- **This design has not been tried against `supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
  or any other real, pending migration** — per this round's own explicit
  instruction, no migration was run, no GitHub Action was dispatched, and
  MARKET-05C's own files were deliberately left untouched. The first real
  production action should be `production-db-preflight.yml` (read-only);
  only after it reports ready should `production-db-migrate.yml` be
  dispatched for `0010` specifically, as a separate, later, explicitly
  approved release — see "Safe order of production actions" above.
