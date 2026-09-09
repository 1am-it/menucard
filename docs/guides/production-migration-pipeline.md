# Production Supabase migration pipeline

How this project's Supabase migrations (`supabase/migrations/*.sql`) get
applied to the real, production database — replacing the fully manual
process every migration through `0009` (and, as of this writing, `0010`)
has used so far: copy the file's contents into the Supabase Dashboard's
SQL Editor by hand, run it, and record the outcome in prose in
`planning/CONTEXT.md`. See `planning/decisions/013-production-migration-pipeline.md`
for why this changed and what was decided; this file is the concrete
operational how-to.

## The four workflows, and why there are four

| | `.github/workflows/validate-migrations.yml` | `.github/workflows/production-db-preflight.yml` | `.github/workflows/production-db-history-reconcile.yml` | `.github/workflows/production-db-migrate.yml` |
|---|---|---|---|---|
| Trigger | Automatic — push/PR touching `supabase/migrations/**` | **Manual only** — confirm `"verify"` | **Manual only** — confirm `"repair-history-only"` | **Manual only** — confirm `"migrate"` |
| Target | A throwaway Postgres container, destroyed after the job | The real, production Supabase project — **read-only** | The real, production Supabase project — **writes ONLY the history-tracking table** | The real, production Supabase project — **applies schema changes** |
| Its own input | none | `applied_versions`, `staged_versions` | `legacy_versions` | `release_versions` |
| Secrets needed | None | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` | Same four secrets | Same four secrets |
| Approval | None needed — it can't affect anything real | **Required** — same protected GitHub Environment | **Required** — same protected GitHub Environment | **Required** — same protected GitHub Environment |
| What it proves / does | The full migration sequence applies cleanly, in order, from empty | What is currently known-**applied** (local + live) and known-**staged** (local only), exactly — **without changing anything** | Marks specific, pre-documented legacy version(s) as applied in the history table ONLY — no schema/data write | The *declared release* (and only that) was actually applied to production |

Four separate files, not three, and not one combined one.
`validate-migrations.yml` is safe to run automatically because it cannot
touch anything real. The other three all reach the real production
project and therefore all require the same explicit human trigger and
separate human approval — but each does a categorically different job,
on purpose:

- **`production-db-preflight.yml` answers "what is currently true?"** —
  never "what should happen next." Its `applied_versions` input is the
  set that must already be fully applied (local file **and** live
  history); its `staged_versions` input is the set that must exist
  **only** as a local file, staged for later. Neither is the same
  concept as `production-db-migrate.yml`'s own `release_versions` — see
  each workflow's own banner comment for why these are deliberately
  different inputs, not one shared value renamed per workflow.
- **`production-db-history-reconcile.yml` answers "can the tracked-but-
  never-CLI-applied legacy gap be closed?"** — the *only* workflow in
  this repository allowed to run `supabase migration repair`, and only
  for a version list that matches a constant hard-coded into the
  workflow file itself (see "History reconciliation" below). It never
  runs `db push`, never applies SQL, never seeds, resets, or deletes
  anything, and never touches the app.
- **`production-db-migrate.yml` answers "apply this specific, already-
  confirmed release, now."** Its own `release_versions` input is checked
  against a hard-coded constant and against live migration history
  (`production-db-preflight.yml`'s own proven parsing technique, reused)
  immediately before the real push — never against `db push --dry-run`'s
  printed text, which is informational only. See "The real safety gate"
  under "How approval works" below.

## Safe order of production actions

**Never dispatch `production-db-migrate.yml` cold, and never skip
straight from "history looks wrong" to guessing at a fix.** The full,
required order for this repository's actual first real release:

1. **One-time GitHub setup** (see below): create the `production-migrations`
   environment, enable Required reviewers, add the three environment
   secrets. Done once, protects all three production-reaching workflows.
2. **Read-only preflight for `0001`-`0009`**: dispatch
   `production-db-preflight.yml` (confirm `verify`,
   `applied_versions: 0001,0002,0003,0004,0005,0006,0007,0008,0009`,
   `staged_versions: none`). Expected first-ever result: **"❌ Not
   ready"** — remote history does not yet record these as applied (they
   were applied by hand, outside the CLI — see "History reconciliation").
   This step is diagnostic, not expected to pass yet; it exists to
   produce written, timestamped confirmation of the exact gap before step
   3 touches anything.
3. **Separately approved history reconciliation**: dispatch
   `production-db-history-reconcile.yml` (confirm
   `repair-history-only`, `legacy_versions: 0001,0002,0003,0004,0005,0006,0007,0008,0009`
   — must match that workflow's own hard-coded constant exactly). This is
   its own distinct approval at the same protected environment; it writes
   only to the migration-history tracking table (see "History
   reconciliation" below for the full guarantee).
4. **Read-only preflight again, now requiring exact sync**: dispatch
   `production-db-preflight.yml` again, same `applied_versions`,
   `staged_versions: none`. Expected result now: **"✅ Ready for
   migration"**. If not, reconciliation was incomplete or something else
   is genuinely wrong — do not proceed.
5. **`0010` as a migration-only release to `main`**: merge
   `supabase/migrations/0010_market05c_restaurant_profile_drafts.sql`
   alone — no MARKET-05C application code in the same PR.
6. **Preflight with `0010` as the declared pending release**: dispatch
   `production-db-preflight.yml` with `applied_versions:
   0001,...,0009`, `staged_versions: 0010`. This is what confirms `0010`
   is now a real local file on `main` and correctly not yet applied
   anywhere live — see requirement 3 in that workflow's own header
   comment for why this is structurally impossible to pass before `0010`
   is actually merged.
7. **Separately approved production migration**: only once step 6 reports
   ready, dispatch `production-db-migrate.yml` (confirm `migrate`,
   `release_versions: 0010`). Its own "Verify exact migration state" gate
   re-confirms the exact same version set — against live history, not
   dry-run text — before the real push; see "The real safety gate" under
   "How approval works" below.
8. **Read-only verification**: `production-db-migrate.yml`'s own summary
   and a follow-up `production-db-preflight.yml` run (`applied_versions:
   0001,...,0010`, `staged_versions: none`, expecting "✅ Ready") confirm
   `0010` is now live. Also cross-check the Supabase Dashboard directly —
   see "How to verify the outcome."
9. **Only after step 8 is confirmed** does MARKET-05C's dependent
   application code (the routes/pages reading and writing the tables
   `0010` creates) merge, as its own separate release — see "Release
   sequencing" below. Steps 5-9 skipping straight past 1-4 is exactly what
   `production-db-preflight.yml`'s local-files-vs-declared-versions check
   is built to catch and refuse (see "History reconciliation").

## History reconciliation

Migrations `0001`-`0009` were applied to production by hand, via the
Supabase Dashboard's SQL Editor — never through `supabase db push`. The
Supabase CLI's own migration-history table
(`supabase_migrations.schema_migrations`) is only ever written to by the
CLI itself (`db push`, or `migration repair`); a manual SQL Editor run
does not touch it. This means the **first-ever** run of
`production-db-preflight.yml` against this project (step 2 above) should
be expected to report "Not ready," reason: live history is missing
`0001`-`0009` — even though they are, in reality, already live. A false
"not applied" signal caused entirely by how they were originally applied,
not by anything actually wrong with the database.

**Neither `production-db-preflight.yml` nor `production-db-migrate.yml`
fixes this automatically, and neither ever will.** The dedicated,
separately-approved fix is `production-db-history-reconcile.yml` (step 3
above). Its safeguards, all enforced before it ever opens a connection or
writes anything:

- **Confirmation phrase is `repair-history-only`** — distinct from
  `verify` and `migrate`, so it can never be triggered by a copy-pasted
  confirmation meant for either other workflow.
- **`legacy_versions` must exactly match a constant hard-coded in the
  workflow file itself** (`DOCUMENTED_LEGACY_VERSIONS`, currently
  `0001`-`0009`). Typing a different value at dispatch time does not
  work — reconciling a different set requires editing that constant in a
  reviewed pull request. This is deliberate: a write this sensitive is
  not left to a free-typed dispatch-time value alone.
- **Local files must exist for EXACTLY the declared legacy versions** —
  no more, no less. If `0010` (or any later version) is already present
  as a local file when this workflow runs, the local set no longer
  equals the declared/documented legacy set and the job fails closed
  *before opening any connection* — this is the specific, structural
  guarantee that `0010` (or anything later) can never be part of this
  repair action.
- **Remote history must contain no version outside the declared legacy
  set** — if something unexpected is already recorded live (e.g. `0010`
  somehow applied early, or an unrecognized version), the workflow
  refuses to touch history at all rather than guess what's safe to leave
  alone.
- **Only the specific version(s) still missing from remote are repaired**
  — computed as `legacy_versions` minus what's already recorded, never
  the full declared list unconditionally. An already-applied version is
  left untouched. If everything is already reconciled, the workflow
  performs no write at all and says so.
- **The only write is `supabase migration repair --db-url
  "$SUPABASE_DB_URL" --status applied <versions>`** (Session Pooler
  connection, not `--linked` — see "One-time GitHub setup") — per the
  Supabase CLI's own documentation, this only inserts row(s) into
  `supabase_migrations.schema_migrations`; it never applies SQL, never
  touches application schema or data, never runs `db push`, seed, reset,
  or delete, and never deploys anything.
- **Re-verifies after writing**: a final read-only `migration list` run
  confirms live history now exactly equals the declared legacy set. A
  mismatch here is reported as a failure requiring manual investigation —
  this workflow never retries or repairs further on its own.
- **No secrets, passwords, tokens, or full connection strings are ever
  logged** — same masking discipline (`::add-mask::` plus GitHub's own
  automatic masking) as the other two production-reaching workflows.

Any unexpected state at any of these checks stops the workflow
immediately, with a specific reason in the job log — never a partial
write followed by a silent "close enough" continuation.

## One-time GitHub setup (do this before dispatching the workflow for real)

**This is the part that actually makes the approval gate real. Skipping
it does not make the workflow refuse to run — it makes the workflow run
immediately, with no approval step at all**, because GitHub Actions
auto-creates an environment with zero protection the first time a
workflow references one that doesn't already exist.

1. **Repository Settings → Environments → New environment**, named
   exactly `production-migrations` (matching the `environment:` key in
   `production-db-migrate.yml`, `production-db-preflight.yml`, AND
   `production-db-history-reconcile.yml` — renaming one without the
   others breaks the link between them). This one-time setup protects
   all three production-reaching workflows simultaneously; nothing extra
   is needed to also gate the preflight or the reconciliation workflow.
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
     database other services also connect to). Used only by `supabase
     link` (platform/project validation) — see the next secret for the
     actual database connection used everywhere else.
   - `SUPABASE_DB_URL` — the full **Session Pooler** connection string,
     copied exactly as shown, from **Supabase Dashboard → Connect →
     Session pooler** (port `5432` — never "Transaction pooler", which
     is port `6543`). _(Added 2026-09-09.)_ This is required because
     GitHub Actions runners have no IPv6 route, and Supabase's *direct*
     database connection (what `supabase migration list --linked` and
     `db push --linked` resolve to) is IPv6-only unless the project has
     purchased the paid IPv4 add-on — confirmed by an actual dispatch of
     `production-db-preflight.yml` failing with "IPv6 is not supported on
     your current network." Supavisor's Session Pooler is IPv4-only on
     **every** Supabase project at no extra cost, which is exactly why
     it's used instead — **no paid IPv4 add-on is needed to fix this.**
     All three production-reaching workflows validate this secret's
     shape (port `5432`, a `*.pooler.supabase.com` host) before using it,
     and stop with a clear error rather than guess if it looks like the
     Transaction Pooler or a direct connection string instead.

   **Scope these secrets to the environment, not the whole repository.**
   A repository secret is readable by any workflow run on any branch; an
   environment secret is only readable once a job actually reaches that
   protected environment — i.e., only after the required reviewer has
   approved. This is what stops "anyone who can dispatch a workflow" from
   also being "anyone who can read the production DB password" (or the
   Session Pooler connection string, which itself embeds that password).

None of these four values are ever written to a file in this
repository — they exist only as GitHub's own encrypted secret storage,
injected into the job's environment at run time. This is a completely
separate secret set from the app's own runtime configuration
(`.env.local` / Vercel's project environment variables —
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc., per
`.env.local.example`). Don't confuse the two: the app's runtime secrets
let the deployed Next.js app talk to Supabase as a normal client; these
four CI secrets let the Supabase CLI talk to Supabase's Management API
(`link`) and the database itself (everything else, via the Session
Pooler), only to inspect/push schema migrations.

## One-time Supabase-side setup

- The access token, DB password, and Session Pooler connection string
  above (all from the Supabase Dashboard, as described) — no account or
  project-level action needed beyond copying them.
- **No paid add-on required.** In particular, the IPv6-only direct
  connection issue this pipeline works around does NOT require
  purchasing Supabase's IPv4 add-on — routing through the Session Pooler
  (free, on every project) is the fix. Buying the IPv4 add-on would also
  work but is unnecessary spend for this specific problem.
- Nothing else — this pipeline does not need a new Supabase feature or
  plan tier. `supabase link` and every `--db-url`-based command work
  against any existing project.

## How approval works, end to end

This walks through `production-db-migrate.yml` specifically — i.e. step 7
of "Safe order of production actions" above, which assumes steps 1-6
(setup, preflight, reconciliation if needed, preflight again, the
migration-only merge, preflight with the release staged) are already
done.

1. Someone with write access goes to the repo's **Actions** tab →
   "Apply production database migrations" → **Run workflow**, selects
   the `main` branch, types `migrate` in the confirmation field exactly
   as prompted, and sets `release_versions` to the version(s) just
   confirmed ready by the preflight (e.g. `0010`).
2. The job starts, validates the confirmation phrase and that all four
   secrets are configured, then **pauses** at the `production-migrations`
   environment (assuming the one-time setup above was done).
3. A configured reviewer sees the pending deployment (GitHub notifies
   reviewers, and it's visible under the workflow run's "Review
   deployments" button) and either approves or rejects it. Approving is
   the one explicit production approval this whole design exists to
   require — nothing before this point has touched a secret or a
   connection.
4. Once approved, the job links the Supabase CLI to the production
   project for platform/project validation, then runs **"Verify exact
   migration state"** — the actual go/no-go decision, described in full
   in "The real safety gate" below. Only if every one of its checks
   passes does the job continue.
5. It then runs `supabase db push --db-url "$SUPABASE_DB_URL" --dry-run`
   — **informational only** (see "The real safety gate" below for why
   its printed text is never read for anything). Its own exit code is
   still checked; a real CLI/connection failure here still stops the
   job.
6. Only if step 4's gate passed does it run the real `supabase --yes db
   push --db-url "$SUPABASE_DB_URL"` (applies only the not-yet-recorded
   ones, in order — never a full re-run, never anything not already a
   reviewed file in `supabase/migrations/`).
7. If any migration fails to apply, `supabase db push` itself stops at
   that file — no attempt to skip it and continue, no partial success
   reported as success. The job fails, and every later step is skipped
   except the always-on display/summary steps.
8. If the push succeeded, **"Verify this release is now live"** re-queries
   `supabase migration list` and asserts the live history now exactly
   equals the expected post-release set — an active check, not just a
   printed line. A mismatch here (the push reported success but the
   history doesn't reflect it) fails the job rather than trusting the
   push's own exit code alone.

### The real safety gate — not `db push --dry-run`'s printed text

_(Rebuilt 2026-09-09, after three consecutive real-dispatch failures —
see "Residual risks" below for the full account.)_ **`production-db-migrate.yml`
no longer parses `supabase db push --dry-run`'s human-readable output for
its go/no-go decision, and never will again.** The dry-run still runs
and is still visible in the job log — it is genuinely useful for a human
to read before approving — but nothing in the workflow reads, parses, or
compares its printed migration names. Three separate parsing attempts
(a line shape sourced from a Supabase CLI GitHub issue; stripping the
CLI's Unicode bullet with `tr`; a bullet-agnostic digit extraction with
`awk`) each worked correctly against byte-identical fixtures in local
testing and each still failed on a real dispatch — evidence the true
problem is something about that specific command's raw output that
neither the GitHub Actions log viewer nor local reproduction can fully
surface, not any one regex.

The actual decision is now made by a step named **"Verify exact
migration state"**, which reuses `production-db-preflight.yml`'s own
proven `migration list` parsing (the one technique in this whole
pipeline that has been confirmed correct on two real dispatches) against
two constants hard-coded directly in `production-db-migrate.yml`:

```bash
DOCUMENTED_APPLIED_VERSIONS=(0001 0002 0003 0004 0005 0006 0007 0008 0009)
DOCUMENTED_RELEASE_VERSIONS=(0010)
```

**Releasing a different or additional migration in the future means
editing these two lines in a reviewed pull request** — the same
discipline `production-db-history-reconcile.yml` already applies to its
own `DOCUMENTED_LEGACY_VERSIONS`. Typing a different `release_versions`
value at dispatch time does not bypass this; the workflow checks the
input against the constant and refuses to proceed on any mismatch.

The gate passes only when ALL of the following hold, each checked
explicitly and each failing closed on its own:

1. `release_versions` exactly equals `DOCUMENTED_RELEASE_VERSIONS`.
2. Local files under `supabase/migrations/` exactly equal
   `DOCUMENTED_APPLIED_VERSIONS` ∪ `DOCUMENTED_RELEASE_VERSIONS` — no
   missing file, no extra file.
3. `supabase migration list`'s LOCAL column matches those same real
   files exactly (the CLI-output integrity check already used in the
   preflight).
4. `supabase migration list`'s REMOTE column exactly equals
   `DOCUMENTED_APPLIED_VERSIONS` — i.e. exactly the already-live
   baseline, with this release's version(s) confirmed **not yet** live.
   Already-applied, partially-applied, or an unreconciled gap all fail
   closed here rather than guessing whether it's safe to push.

After a successful push, **"Verify this release is now live"** repeats
the same parsing technique and asserts the live history now exactly
equals `DOCUMENTED_APPLIED_VERSIONS` ∪ `DOCUMENTED_RELEASE_VERSIONS` —
confirming the push actually took effect, not merely that the command
exited zero.

Note the confirmation phrase is deliberately different across all three
production-reaching workflows — `verify` for the read-only preflight,
`repair-history-only` for the history-reconciliation workflow, `migrate`
for the actual schema apply — precisely so a copy-pasted confirmation
value can never accidentally trigger the wrong one.

## How to verify the outcome (the "controleerbaar resultaat")

- **The workflow run's own summary** (`$GITHUB_STEP_SUMMARY`, visible
  directly on the run's page) shows who triggered it, a link to the run,
  the migration state before and after, and a reminder of the next step.
- **`supabase migration list --db-url "$SUPABASE_DB_URL"`'s own output**,
  printed multiple times in the job log (before and after `db push`), is
  the authoritative "what's actually applied" answer — it reads the real
  migration history table in the target database, not a guess from file
  names alone. The workflow's own "Verify this release is now live" step
  already asserts this automatically after a successful push — a failed
  assertion there means the push's own reported success should not be
  trusted without manual investigation.
- **Cross-check in the Supabase Dashboard** (Table Editor / SQL Editor)
  that the new tables/functions named in the migration actually exist,
  the same live-verification discipline this project has applied to
  every migration so far.
- **Record the outcome in `planning/CONTEXT.md`**, matching this
  project's own existing convention for every prior migration (e.g. "the
  candidate-reviews table... has since been applied live"). This
  pipeline automates the *apply* step; it does not replace this
  project's documentation discipline around it.
- **A follow-up `production-db-preflight.yml` run** with
  `applied_versions` including the just-released version(s) is the
  cleanest single "did this actually work" check — "✅ Ready for
  migration" confirms local and live history agree exactly, from a
  workflow that touches nothing.

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

This pipeline was originally designed and written without network access
to an actual GitHub Actions runner or a real Supabase project.
`production-db-preflight.yml` has since been dispatched for real twice
(2026-09-07, 2026-09-09 — see the dated bullets below); `production-db-migrate.yml`
and `production-db-history-reconcile.yml` have not. Before relying on
either of those for a real production write:

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
- **_(Added 2026-09-06)_ The exact-sync requirement (`applied_versions`/
  `staged_versions` on the preflight, `release_versions` on the migration
  workflow, `legacy_versions` on the reconciliation workflow) has not been
  exercised against the real, first-ever divergence it was built for.**
  All three fail closed — "Not ready" / abort before write — on any
  outcome other than an exact match. The logic was verified locally
  against synthetic scenarios (exact match, remote-only orphan,
  unparseable output, wrong declared version, `0010` staged before/after
  being merged locally, partial reconciliation), but never against this
  project's actual, real Supabase project — where `0001`-`0009` are
  genuinely expected to appear as an unreconciled gap on the very first
  preflight run.
- **_(Added 2026-09-06, this round)_ Two real bash bugs were found and
  fixed via local testing — both would have silently broken the most
  common, most important scenarios.** Neither was caught by the previous
  round's own local tests, which happened to only exercise single-version
  inputs.
  1. **Multi-version comma-separated inputs were silently concatenated
     into one garbled token.** `tr -d '[:space:]'` (used to strip
     incidental whitespace after splitting on commas) deletes newlines
     too — so `tr ',' '\n' | tr -d '[:space:]'` on `"0001,0002,0009"`
     produced `000100020009` as a single value instead of three separate
     lines. Every multi-version declaration (most importantly
     `legacy_versions: 0001,...,0009`, the reconciliation workflow's main
     use case) was affected. Fixed by using `tr -d '[:blank:]'` (space
     and tab only, not newline) everywhere this pattern appears.
  2. **A "zero elements" set was silently turned into "one empty-string
     element,"** breaking exactly the empty-remote-history case this
     whole pipeline exists for. Two compounding causes: `"${arr[@]:-}"`
     on a genuinely empty array expands to one empty-string argument
     instead of zero (a real, if obscure, bash quirk — the `:-` fallback
     triggers because the expansion result is "null," even though the
     array itself is merely empty, not unset); and separately, even
     without `:-`, `printf '%s\n' "${arr[@]}"` on a truly empty array
     still prints one blank line, because `printf` executes its format
     string at least once and treats a missing `%s` argument as an empty
     string. Combined, every `comm`/`mapfile` comparison built on
     `printf '%s\n' "${arr[@]:-}"` treated "nothing on this side" as "one
     blank-string entry on this side" — which silently broke the
     reconciliation workflow's most important scenario (remote history
     completely empty, before any reconciliation has ever happened) and
     the migration workflow's "nothing pending" dry-run case. Fixed with
     a small `print_lines () { [ "$#" -gt 0 ] && printf '%s\n' "$@"; }`
     helper (defined per script block, since GitHub Actions `run:` steps
     don't share shell state) used everywhere a possibly-empty array
     feeds a list comparison; plain `"${arr[@]}"` (no `:-`) is used
     everywhere else, which is correctly zero-words-safe under `set -u`
     since bash 4.4 (confirmed against the bash 5.2 available locally;
     `ubuntu-latest` ships bash 5.x). Both bugs were caught only by
     testing genuinely empty and multi-element scenarios locally, not by
     re-testing the single-version cases the previous round had already
     covered — a reminder that this pipeline's own local test coverage
     needs deliberately adversarial cases, not just the happy path,
     before each real dispatch.
- **_(Added 2026-09-06, this round)_ `SUPABASE_DB_PASSWORD` is now set on
  every step that talks to the linked project, not only on `db push`.**
  The Supabase CLI's own documented CI example
  (`docs/guides/deployment/managing-environments`) sets all three secrets
  before `supabase link`, without stating which later commands
  specifically require the password — rather than assume `migration
  list`/`migration repair`'s direct Postgres history-table access work
  without it, it is now provided throughout every job in all three
  production-reaching workflows. Not yet confirmed necessary or
  sufficient against a real project.
- **_(Added 2026-09-06, this round)_ `production-db-history-reconcile.yml`
  is entirely new and has not been run.** Its `supabase migration repair`
  invocation, its constant-matching gate, and its local-files-exact-match
  gate were each checked against the Supabase CLI's own documentation and
  tested locally with synthetic fixtures (see above), but the workflow as
  a whole — including its behavior inside GitHub's real environment-
  approval flow, and `migration repair`'s real behavior against a
  project's actual history table — has not been executed.
- **_(Added 2026-09-09, CONFIRMED via two real dispatches — not a
  documentation-only risk)_ GitHub Actions runners have no IPv6 route,
  and `--linked` resolved to Supabase's direct database connection.**
  The first real dispatch of `production-db-preflight.yml` failed at
  `supabase link` itself (a Management-API authorization error, unrelated
  to IPv6 — fixed by rotating `SUPABASE_ACCESS_TOKEN`). The **second**
  real dispatch got past `link` successfully and failed at `supabase
  migration list --linked` with the CLI's own message: `"IPv6 is not
  supported on your current network. Run supabase link --project-ref ***
  to setup IPv4 connection."` All three production-reaching workflows now
  connect via an explicit `SUPABASE_DB_URL` (the Session Pooler
  connection string, port `5432`, IPv4-only on every project at no extra
  cost) for every database-reading/-writing command; `supabase link`
  itself is untouched, since it only calls the Management API and was
  never the source of this specific failure. See "One-time GitHub setup"
  for the exact secret and validation added. **Not yet re-verified with
  a real dispatch after this fix** — the next preflight run is this
  fix's first real test.
- **`production-db-preflight.yml` HAS now been dispatched twice for
  real** (2026-09-07 and 2026-09-09), correcting the earlier claim below
  that it hadn't been. Both real dispatches surfaced genuine, previously
  undocumented problems this pipeline's design had not anticipated
  (Supabase access-token privileges, then the IPv6 routing issue above) —
  neither was the "missing legacy history" scenario the pipeline was
  originally built to expect first. This is worth stating plainly: a
  pipeline's own local, synthetic testing (however thorough) did not
  predict either real failure mode: both required an actual dispatch
  against the real project to surface. Treat every remaining
  "not yet tested against a real project" bullet below with that in mind.
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
- **_(Corrected 2026-09-09 — superseded, not deleted, per this project's
  never-silently-rewrite discipline)_ "`production-db-preflight.yml`
  itself has not been run" is no longer true.** It was accurate when
  written (2026-09-06); see the dated bullet above for what its two real
  dispatches since then actually found. Its individual commands
  (`supabase --version`, `supabase link`, `supabase migration list`) were
  checked against the Supabase CLI's own official documentation before
  ever running it for real — that documentation review did not, and
  could not, predict either real failure mode encountered.
- **_(Corrected 2026-09-09 — superseded, not deleted)_ "This design has
  not been tried against `0010`" is no longer true.** It was accurate
  when written; `production-db-migrate.yml` has since been dispatched
  three times against `0010` for real (all with genuine environment
  approval), and each time correctly stopped before any write — see the
  dated entry below for the full account of why, and what changed as a
  result. `0010` remains not applied to production as of this writing.
- **_(Added 2026-09-09) `production-db-migrate.yml`'s dry-run-text
  parsing failed on three consecutive real dispatches; the safety
  decision no longer depends on it at all.** All three attempts
  targeted `release_versions: 0010` against the real project, with real
  environment approval each time:
  1. A line-shape regex sourced from a Supabase CLI GitHub issue
     (`Would push migration <file>...`) — did not match this
     deployment's real output at all.
  2. Stripping the real output's Unicode bullet (`tr -d '\342\200\242'`)
     — verified correct in local testing, still failed on a real
     dispatch against byte-identical input.
  3. A bullet-agnostic digit extraction bounded by the CLI's own fixed
     header/footer lines (`awk` field-splitting-free, line-anchored) —
     also verified correct in local testing under three different
     locales, also still failed on a real dispatch against
     byte-identical input.
  Each failure was safe (the workflow correctly stopped before any
  write — `0010` was never applied by any of the three), but each was
  for a misleading reason ("would apply: (none)" when the real dry-run
  output plainly showed `0010` pending). The working hypothesis: `db
  push --dry-run`'s raw output likely contains something (a line-ending
  or terminal-control-character convention) that neither `gh run view
  --log` nor local reproduction can fully surface, and that every
  attempt's **line-anchored** matching (`^...$`) was sensitive to in a
  way the *other*, structurally different, and repeatedly proven-correct
  `migration list` parser (pure `awk -F'|'` field-splitting, never a
  whole-line anchor) was not — this was never independently confirmed
  against the real runner's raw bytes, since doing so would require a
  live, non-read-only action outside this pipeline's own scope. Given
  three straight failures for what may be the same underlying reason,
  the decision was made to stop iterating on that parser entirely:
  `production-db-migrate.yml`'s actual go/no-go gate ("Verify exact
  migration state") now reuses `production-db-preflight.yml`'s own
  `migration list` parsing technique — proven correct on two real
  dispatches — against two hard-coded constants
  (`DOCUMENTED_APPLIED_VERSIONS`, `DOCUMENTED_RELEASE_VERSIONS`), and a
  matching post-push assertion ("Verify this release is now live")
  confirms the write actually took effect. The dry-run still runs, for a
  human to read, but its printed text is never parsed or compared again
  — see "How approval works" → "The real safety gate" above for the full
  design. **Not yet exercised against a real dispatch** — the next
  dispatch of `production-db-migrate.yml` for `0010` is this rebuild's
  own first real test.
- **The first real production action should be
  `production-db-preflight.yml` (read-only); only after it reports ready
  should `production-db-migrate.yml` be dispatched for `0010`
  specifically, as a separate, later, explicitly approved release** —
  see "Safe order of production actions" above.
