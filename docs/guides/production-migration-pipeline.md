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

Both workflows take the same `expected_versions` input: the exact
migration version(s) (the filename prefix before the first underscore,
e.g. `0010`) this run is expected to find/apply as pending — comma
separated, or the literal word `none` if nothing should be pending. This
is not a formality: **"Ready for migration" is only ever reported when
local and live migration history match `expected_versions` exactly** —
not "whatever happens to be pending." Any other divergence (something
pending that wasn't named, something named that isn't pending, or a live
history entry with no matching local file at all) is reported as **"Not
ready"**, with the specific reason, and points at a required, separate
history reconciliation (see "History reconciliation" below) — it is never
silently treated as "close enough."

1. Dispatch `production-db-preflight.yml` (confirm: `verify`,
   `expected_versions`: the version(s) you intend to release). Read its
   job summary.
2. Only if that summary says **"✅ Ready for migration"**: dispatch
   `production-db-migrate.yml` (confirm: `migrate`, the same
   `expected_versions` value). That workflow runs its own read-only
   `db push --dry-run` first and independently re-confirms the same exact
   match before ever running a real push — see "How approval works" below.
3. If the preflight instead says **"❌ Not ready"**, resolve whatever it
   named — a missing secret, a failed link, or (see "History
   reconciliation" below) a history mismatch — and re-run the preflight
   (it is read-only and safe to run as many times as needed) before ever
   attempting step 2.

As of this writing, the next real migration release under this rule is
`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql` —
already written and locally validated (see `validate-migrations.yml`),
but not yet live. This document and the preflight workflow do not apply
it; that remains a separate, later, explicitly-approved dispatch of
`production-db-migrate.yml`, only after a preflight run reports ready
with `expected_versions: 0010`.

**MARKET-05C may only reach `main` as a migration-only release
(`supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
alone) after the `0001`-`0009` history reconciliation below is resolved
— never before, and never bundled with MARKET-05C's application code.**
Concretely, in order: (1) reconcile `0001`-`0009` (separate,
explicitly-approved action — see "History reconciliation"); (2) merge
`0010` to `main` on its own, get a preflight run reporting ready with
`expected_versions: 0010`, then dispatch `production-db-migrate.yml` for
it — this is the "migration-only release"; (3) only once `0010` is
confirmed live (per "How to verify the outcome") does MARKET-05C's
application code (the routes/pages reading and writing the tables `0010`
creates) merge, as a separate, later release — per "Release sequencing"
below. Skipping straight to (2) without (1) is exactly what
`production-db-preflight.yml` is built to catch and refuse.

## History reconciliation

Migrations `0001`-`0009` were applied to production by hand, via the
Supabase Dashboard's SQL Editor — never through `supabase db push`. The
Supabase CLI's own migration-history table
(`supabase_migrations.schema_migrations`) is only ever written to by the
CLI itself (`db push`, or `migration repair`); a manual SQL Editor run
does not touch it. This means the **first-ever** run of
`production-db-preflight.yml` against this project should be expected to
show `0001`-`0009` as pending (LOCAL-only, no matching REMOTE row) even
though they are, in reality, already live — a false "not applied" signal
caused entirely by how they were originally applied, not by anything
actually wrong with the database.

**This is not something either workflow fixes automatically, and neither
ever will.** `production-db-preflight.yml` requires an exact match
against the version(s) declared in `expected_versions`; it does not
special-case "these particular versions are probably fine." A likely
first-ever preflight result:

- Declare `expected_versions: 0010` (the actual next release).
- Get back **"❌ Not ready"**, reason: pending set `(0001 0002 ... 0009
  0010)` does not equal expected set `(0010)`.

The fix is a **separate, explicitly-approved reconciliation**, done by
hand, before `0010` is ever pushed:

1. Confirm via the Supabase Dashboard (Table Editor / SQL Editor) that
   `0001`-`0009`'s tables/functions genuinely already exist in
   production — i.e. that this is the expected "applied by hand, not
   CLI-tracked" gap, not a real missing migration.
2. Once confirmed, a person with the `SUPABASE_ACCESS_TOKEN` runs
   `supabase migration repair --linked --status applied <version> ...`
   **by hand, locally or in a one-off authorized session — never
   automatically, and never as part of either workflow in this
   repository.** Per the Supabase CLI's own documentation, `repair` only
   inserts/deletes rows in the history tracking table; it never applies
   SQL or alters schema — but it is still a real, unreviewed-by-CI change
   to production state, so it gets its own explicit approval moment, the
   same way a migration does.
3. Re-run `production-db-preflight.yml` with `expected_versions: 0010`.
   It should now report "✅ Ready for migration" — if it does not,
   reconciliation was incomplete or something else is genuinely wrong;
   do not proceed to `production-db-migrate.yml` until it does.

Neither workflow in this repository runs `migration repair`, prompts for
it, or automates any part of step 2 — by design, per this pipeline's own
"never run migration repair automatically, never apply SQL from a
preflight" rule. Reconciliation is intentionally a manual, separate,
reviewed action, distinct from both "check readiness" and "apply a
migration."

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
   project and prints which migrations are currently pending
   (`supabase migration list --linked`).
6. It then runs `supabase db push --linked --dry-run` (read-only) and
   parses its "Would push migration ...sql..." lines. If the version(s)
   it names don't exactly match this run's own `expected_versions` input,
   the job stops here — **before the real push** — with no schema change
   made. This catches a stale/incorrect `expected_versions` value or a
   migration that became pending unexpectedly since the preflight ran.
7. Only if the dry-run matches exactly does it run the real
   `supabase --yes db push --linked` (applies only the not-yet-recorded
   ones, in order — never a full re-run, never anything not already a
   reviewed file in `supabase/migrations/`), then prints the resulting
   migration state again.
8. If any migration fails to apply, `supabase db push` itself stops at
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
- **_(Added 2026-09-06, corrected 2026-09-06)_ `supabase db push`'s
  documented CI-specific failure mode** (Supabase GitHub Discussion
  #26366: it can wait on an interactive confirmation prompt a
  non-interactive CI shell never answers, and report a *successful* exit
  having applied nothing) **is now handled with the CLI's own documented
  mechanism, not a workaround.** The original fix for this
  (`yes | supabase db push`, piped through `yes` with `set -o pipefail`
  to keep a real failure from being masked) has been replaced: the
  Supabase CLI's official global-flags reference documents `--yes`
  ("answer yes to all prompts"), used before the subcommand —
  `supabase --yes db push --linked`. This is the CLI's own supported
  non-interactive mechanism, needs no stdin pipe, and needs no
  `pipefail` trick to keep a failure visible. The previous round's search
  had only checked `db push`'s own flag table (which indeed does not list
  `--yes`) and missed that it is a *global* flag documented separately —
  corrected this round by checking the CLI's global-flags reference
  directly.
- **_(Added 2026-09-06)_ Migration filename convention mismatch — NOT
  resolved, only newly documented, now with a live test built for it.**
  The Supabase CLI's own reference documentation and CLI issue #6036
  confirm the officially expected migration filename shape is
  `<timestamp>_<name>.sql` with a 14-digit `YYYYMMDDHHMMSS` prefix. This
  repository's actual files (`supabase/migrations/0001_field_provenance.sql`
  through `0010_market05c_restaurant_profile_drafts.sql`) use a 4-digit
  sequential numeric prefix instead. Whether the CLI merely needs any
  consistently sortable string (which zero-padded sequential numbers
  satisfy) or hard-validates the timestamp shape could not be
  conclusively resolved from documentation alone. **This is exactly what
  `production-db-preflight.yml`'s history-comparison step tests, safely,
  before any real migration is ever applied** — its own "the LOCAL column
  parsed from the CLI must match the real files on disk" integrity check
  (not just "did the command exit 0") is specifically there to catch a
  format mismatch that silently changes what the CLI reports, not only
  one that makes it error outright. Renaming the migration files
  themselves remains out of scope (migration-adjacent, explicitly
  excluded from every round of this pipeline work so far); if the risk
  materializes, the fix is a separate, explicit ticket to rename
  `supabase/migrations/*.sql` to the 14-digit convention, migrating the
  live history table's recorded names to match.
- **_(Added 2026-09-06)_ The preflight's history-comparison and the
  migration workflow's dry-run both parse Supabase CLI text output —
  tested locally against synthetic fixtures, not against the real CLI.**
  Local testing this round (synthetic `migration list`-shaped tables and
  `db push --dry-run`-shaped text, fed through the exact `sed`/`awk`/
  `comm` logic used in both workflows) did catch and fix one real bug:
  matching the table's column separator with an `awk` bracket character
  class (`-F'[|│]'`, to accept either a plain `|` or the CLI's documented
  Unicode box-drawing `│`) silently mis-split every row under this
  environment's locale, even using the same `gawk` version GitHub's
  `ubuntu-latest` ships. The fix — normalize with `sed 's/│/|/g'` before a
  plain single-character `awk -F'|'` — was verified to handle both
  separator styles correctly in the same local test. This is a real,
  fixed bug, not merely a documented risk, but it was only exercised
  against fixtures written to match the CLI's *documented* table shape —
  the real CLI's actual current output (column order, extra whitespace,
  additional columns, a completely different format) has not been
  confirmed. If `production-db-preflight.yml` ever reports "Not ready"
  with reason "migration list output did not parse as expected" on an
  otherwise-healthy project, this is the first thing to suspect, and the
  fix is updating the parsing logic to match the CLI's real current
  output — never loosening the check to assume history is fine when it
  can't be confirmed.
- **_(Added 2026-09-06)_ The `expected_versions` exact-sync requirement
  has not been exercised against the real, first-ever divergence it was
  built for.** Both workflows now require local/live history (or a
  dry-run's own announced version set) to match `expected_versions`
  exactly, and both fail closed — "Not ready" / abort before push — on
  any other outcome, including the migration-repair-required case
  described in "History reconciliation" above. The logic was verified
  locally against synthetic scenarios (exact match, remote-only orphan,
  unparseable output, wrong declared version), but never against this
  project's actual, real Supabase project — where `0001`-`0009` are
  genuinely expected to appear as an unreconciled gap on the very first
  run.
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
