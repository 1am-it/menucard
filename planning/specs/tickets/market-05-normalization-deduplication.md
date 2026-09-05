# MARKET-05 — Normalization & Deduplication

## Status

**First created 2026-09-05.** Until now `MARKET-05` existed only as a
placeholder line in `planning/specs/tickets/README.md`
("normalization & deduplication (not started)") and a short prose
description in `planning/architecture/market-data-foundation-plan.md`
("Turns raw imports into canonical candidate records: matching and
deduplicating across sources"). This document is the first concrete
ticket content for `MARKET-05` — split into two independently-scoped
parts, the same discipline already used for `MARKET-04`'s hard gates
(3A/3B, 4A/4B):

- **`MARKET-05A` — Data-inbox: interne kandidaat-review.** Prepared by
  this document, triggered by the two successful, write-free Breda
  dry-runs (see `market-04-raw-imports-import-runs.md`'s "Status"
  correction, 2026-09-05) that proved the raw-candidate pipeline produces
  real, inspectable numbers (665 → 500 inside Breda boundary v1).
  **Update (2026-09-05, later the same day): built.** The page, both
  API routes, and their pure decision logic now exist and are tested —
  see the "Implementation (2026-09-05)" subsection below for the exact
  files and what is, and is not, yet live-verifiable. **Correction**: the
  line above originally said this round was "documentation/ticket
  preparation only... no dashboard, route, or schema change has been
  built yet" — that was true for the round that wrote it, no longer true
  now; corrected here visibly rather than left stale.
  **Further update (2026-09-05, still the same day): one real, limited
  `ImportRun` now exists** (10 candidates, all inside Breda, no
  canonical/public write) **and the candidate review workflow — statuses,
  an append-only decision log, and a detail view — is built on top of
  it.** See "Implementation (2026-09-05, later the same day) — candidate
  review workflow" below. **Migration `0007` has since been applied
  live**, read-only re-verified. **Yet further update, still the same
  day: a second, independent append-only audit log for manual
  `address`/`phone`/`website` enrichment is now built too** (migration
  `0008`) — see "Implementation (2026-09-05, later still the same day) —
  candidate enrichment layer" below, including the deliberate
  "Enrichment vs. review notes" boundary. **Migration `0008` has since
  been applied live**, read-only re-verified.
- **`MARKET-05B` — Normalization & deduplication (the original scope).**
  Matching/merging multiple sources into canonical candidate records, per
  `market-data-foundation-plan.md`'s original description. **Untouched,
  not designed, not started by this document** — kept here only as a
  clearly-separated placeholder so `05A` does not silently absorb or
  redefine it.

**Why split, not silently reassigned**: `MARKET-04`'s own "Out of scope"
section explicitly lists *"`MARKET-05`'s normalization/deduplication
logic itself"* as excluded from that ticket — confirming
matching/deduplication is `MARKET-05`'s established meaning. A
raw-candidate review inbox is a **different, earlier pipeline stage**
(reads `ImportRun`/`ImportExtractionRecord`s directly, before any
matching/deduplication, and writes nothing to canonical tables — see
"Pipeline position" below). Filing it as `05A` rather than inventing a
new, unrelated ticket number keeps it visibly attached to the
normalization work it feeds and precedes, without overwriting `05B`'s
existing definition.

## MARKET-05A — Data-inbox: interne kandidaat-review

### Depends on

`MARKET-04` (the `ImportRun`/`ImportExtractionRecord` tables this reads —
see `docs/api/import-run-schema.md`); `PLATFORM-05` (the internal API
foundation and its `staff_roles`/service-role access pattern, reused
here rather than reinvented — see "Access control" below).
**Does not depend on `MARKET-05B`, `PLATFORM-06`, or `MARKET-06`** — see
"Pipeline position."

### Objective

Give internal staff a small, access-gated way to actually *see* what a
real `ImportRun` found — counts, candidates, and their raw extracted
fields — **before** any normalization, matching, or canonical merge
exists to act on them. Triggered directly by the two 2026-09-05 Breda
dry-runs: real, inspectable numbers now exist (665 candidates after the
amenity/bounding-box pre-filter, 500 of them exactly inside Breda
boundary v1), but today the only way to see them is a JSON blob printed
to a terminal during a manually-run, write-free dry-run — there is no
way for anyone else at the project to look at this data without running
the tool themselves.

### User story

As internal staff preparing for the first real Breda `ImportRun`, I want
to browse what a run actually found — restaurant name, address,
category, location, which source and run it came from, and when — filtered
by run/category/name/possible-duplicate/quality, so I can judge whether
the raw candidate data is good enough to eventually normalize and
moderate, without needing to query the database directly or re-run the
tool myself.

### Pipeline position (authoritative — reuses `docs/api/import-run-schema.md`'s existing layer table)

| Layer | Reads from | Writes | Never |
|---|---|---|---|
| `ImportRun` (`MARKET-04`) | Registered `Source`/`SourceAuthorizationVersion` | `ImportExtractionRecord`s | Canonical tables, public snapshots |
| **`MARKET-05A` (this ticket)** | **`ImportRun`/`ImportExtractionRecord`s only** | **Nothing — read-only** | **Canonical tables, `pending_changes`, any public route** |
| `MARKET-05B` (normalization & dedup) | `ImportRun` extraction records | Canonical candidate records | Mutates raw extraction records; bypasses moderation |
| Moderation (`PLATFORM-06`, generalized per `[[011-market-foundation-and-international-growth]]` §5) | Canonical candidate records | Reviewed/approved canonical data | Publishes directly |
| Publication snapshots (`MARKET-06`) | Reviewed canonical data only | Versioned snapshots | Raw imports or unreviewed candidates |

`MARKET-05A` is a **read-only window onto the `MARKET-04` layer**, sitting
before `MARKET-05B` and entirely outside `PLATFORM-06`'s existing scope —
`PLATFORM-06` reviews `pending_changes` (field-level diffs against *live*
data); it has no concept of a raw, pre-normalization import candidate
today, and this ticket does not add one to it. No canonical candidate
record is created, matched, or touched by `MARKET-05A`.

### Scope

- A new, gated page under the existing `/internal/*` route family (the
  same shared `noindex` layout already covering `/internal/coverage`
  `PLATFORM-01` and `/internal/moderation` `PLATFORM-06` —
  `app/internal/layout.js`), e.g. `/internal/import-inbox`.
- A new `/api/internal/v1/import-inbox/...` route family, following the
  exact existing convention (`getSupabaseAdmin()` service-role client +
  an application-level `staff_roles` check — never new RLS policies or
  grants on `import_runs`/`import_extraction_records`; see "Access
  control" below), mirroring how `/api/internal/v1/moderation/pending`
  already reads `pending_changes` via the service role.
- **Import overview**: per `ImportRun`, at minimum: `status`,
  `started_at`/`completed_at` (→ duration), `record_counts`
  (`fetched`/`stored`/`skipped`/`errored`), `source_locator`,
  `source_version`, `data_origin_source_id`/`access_provider_source_id`
  (resolved to source names for display, e.g. "OpenStreetMap via
  Geofabrik"). Directly matches the fields already produced by both real
  2026-09-05 dry-runs (see `market-04-raw-imports-import-runs.md`'s
  "Status" correction for the exact shape).
- **Candidate list**: per `ImportExtractionRecord`, reading its
  `extracted_fields` jsonb — name, composed address, category (`amenity`
  value), location (lat/lon), plus `record_locator` (source-native id),
  `import_run_id` (→ which run, and via it which source), `retrieved_at`
  (import date). Exactly the field set `ops/scripts/import-breda-osm.js`'s
  `minimizeOsmNodeProperties` already produces — no new field invented
  here.
- **Filters**: by `import_run_id`, by `category` (the `amenity` value),
  by `name` (substring), by **possible-duplicate**, and by
  **quality-status** — see "Duplicate/quality status — computed, not
  stored" below for why neither is a new database column in this first
  version.
- **Explicit empty/error/not-yet-imported states**:
  - **No `ImportRun`s exist yet** — a clear "Nog geen importrun
    uitgevoerd" state, not an empty table with no explanation. **Correction
    (2026-09-05, later the same day): one real `ImportRun` now exists**
    (see "Status" below) — this empty state is still correctly built and
    still the state a *fresh* market/source combination would show, but
    it is no longer literally "true today" for Breda specifically.
  - **A run exists but produced zero stored candidates** (e.g. every
    candidate fell outside the boundary) — distinct from "no run at all."
  - **A run `failed`/is `partial`** — surface `error_log` entries
    plainly, not silently hidden behind the candidate list.
  - **Normal empty-filter-result** (a filter combination matches nothing)
    — distinct from all of the above, per this project's existing
    text-first empty-state discipline (`[[002-text-first-no-images]]`).

### Duplicate/quality status — computed, not stored

Neither `possible-duplicate` nor `quality-status` exists as a column on
`import_extraction_records` today (confirmed against
`supabase/migrations/0004_market04a_import_foundation.sql`'s exact
schema), and that table is append-only by design — **no update grant
exists, even for `service_role`, and this ticket does not propose adding
one.** Both filters are therefore **computed read-only, at query/render
time, from `extracted_fields` already present** — not stored:

- **Quality status** (candidate-shaped, e.g. `compleet` /
  `onvolledig — geen telefoon/website` / `onvolledig — geen adres`): a
  pure function of which optional fields (`address`, `phone`, `website`)
  are present on that one record's `extracted_fields` — exactly
  mirroring how `ops/scripts/import-breda-osm.js`'s own
  `minimizeOsmNodeProperties` already omits absent fields rather than
  storing nulls.
- **Possible-duplicate**: a heuristic comparison (e.g. matching/near-matching
  `name` plus a small location radius) across candidates **within the
  same or across runs** — flagged for a human to judge, never
  auto-merged or auto-rejected. This is explicitly **not** `MARKET-05B`'s
  eventual real deduplication logic (which will canonicalize and merge)
  — this is a lightweight, non-authoritative hint to help a reviewer scan
  a candidate list, nothing more.

### Access control — decided 2026-09-05

Per `0004_market04a_import_foundation.sql`'s own stated reasoning ("none
of the existing `staff_roles` values have any documented business with
raw import data at this stage") and confirmed by the completed
`MARKET-04A` RLS design (zero policies for `anon`/`authenticated`
including `owner`/`editor`/`internal` — every read must go through the
service role), the new API route must, itself, decide who may see raw
import data. **This was an open question in the previous round; it is
now decided, not merely recommended:**

- **Data-inbox is accessible only to the existing `internal` `staff_roles`
  value.** No other role, and no unauthenticated or plain-authenticated
  session, may reach it.
- **`editor` gets no access.** `editor` in this app's existing model is
  meaningfully restaurant-scoped (see `src/lib/internalAuth.js`'s
  `getAccessForRestaurant` — an `editor` role grants `allowed: true`
  unconditionally across every restaurant today, which is exactly why
  this decision does not lean on it further): raw import candidates
  belong to no restaurant yet, are platform-wide (any of them may
  eventually resolve to any Breda restaurant), and are entirely
  unreviewed. Granting `editor` access would be a broader disclosure than
  today's `editor` role is documented to need, not a natural extension of
  it.
- **`owner`, community contributors, anonymous visitors, and ordinary
  logged-in users with no `staff_roles` row get no access at all** — the
  same zero-access default `0004_market04a_import_foundation.sql` already
  established for these six tables; Data-inbox introduces no new
  exception to it, only a new, gated, `internal`-only reading of data
  that already structurally cannot be reached any other way.
- **The raw tables (`import_runs`, `import_extraction_records`) stay
  directly closed off, unchanged** — no new RLS policy, no new grant, no
  direct client/browser access ever. Data-inbox reaches them **only**
  through a later, new, gated `/api/internal/v1/...` server route using
  `getSupabaseAdmin()`'s service-role client plus an `internal`-only
  `staff_roles` check in application code — the same pattern
  `/api/internal/v1/moderation/pending` already uses for `pending_changes`,
  reused here, not reinvented.
- **The existing `internal` `staff_roles` value already supports a row
  with no `restaurant_id`** — confirmed directly against
  `0001_field_provenance.sql`'s live schema: `restaurant_id text`
  (nullable) with `check (role <> 'owner' or restaurant_id is not
  null)` — only `owner` rows are required to carry one. No schema change
  is needed to grant `internal` access without tying it to any
  restaurant; this decision requires zero migration.
- **No account or role is created live by this decision.** Deciding the
  access model is documentation only — it does not itself grant anyone
  access, create a Supabase Auth user, or insert a `staff_roles` row.
- **Precondition for implementation, not yet satisfied**: at least one
  real, separate internal-administrator account with an actual `internal`
  `staff_roles` row must exist before Data-inbox can be built and
  live-verified against a genuine `internal` session — none exists today
  (confirmed earlier by a read-only `staff_roles` query finding no
  `internal`-role row at all). Creating that account is a separate,
  explicit, later step — not performed by this document, and not
  something documentation alone can satisfy.
- **Update (2026-09-05) — the account-activation gap this precondition
  surfaced is now closed**: while preparing this account, a real gap was
  found — `/internal/login` only ever supports `signInWithPassword`, and
  the app had no page at all where a newly-invited or password-reset
  account could actually set a usable password. `app/internal/set-password/page.js`
  (+ its pure decision logic, `src/lib/setPasswordFlow.js`, and its test
  suite) now fills that gap: it detects a valid Supabase recovery/invite
  session (never anything else), lets that session set a password, shows
  a safe, generic invalid/expired state for any other case, and redirects
  to `/internal/login` on success. **This still does not create any
  account, invitation, or `staff_roles` row itself, and grants no access
  to Data-inbox or anything else** — it only completes account setup so
  the still-unsatisfied precondition above can eventually be resolved
  safely.

  **Correction (2026-09-05, later the same day): two distinct things are
  required, not one — the earlier wording above conflated them.**
  1. **The future `inviteUserByEmail` (or `generateLink({type: 'invite' | 'recovery', ...})`)
     call itself must explicitly pass `redirectTo`**, pointing at this
     app's absolute `/internal/set-password` URL — e.g.
     `supabase.auth.admin.inviteUserByEmail(email, { redirectTo:
     '<this app's real origin>/internal/set-password' })`. Supabase does
     **not** infer or default to this page just because it exists in the
     app; omitting `redirectTo` sends the person to the project's
     configured default Site URL instead, not to this page.
  2. **The Supabase dashboard's Redirect URLs allowlist (Authentication →
     URL Configuration) is a separate, second gate**: it does not *send*
     anyone anywhere by itself — it only *permits* a `redirectTo` value
     that matches an allow-listed entry (or wildcard pattern) to be
     honored at all. Without a matching allowlist entry, Supabase rejects
     the `redirectTo` above outright, regardless of how correctly it was
     passed.

  **Both are required together**, and neither substitutes for the other.
  **Per-environment, not fabricated here**: the exact allowlist entry
  needed is `<that environment's real, actual origin>/internal/set-password`
  — local development, any staging deployment, and production each need
  their own real origin added if invites will ever be sent from that
  environment; no such origin is recorded anywhere in this repository
  today (checked `.env.local.example`, `next.config.js`, and the
  codebase for any documented production domain — none exists), so none
  is guessed or invented here. Whoever configures this must supply the
  real value themselves, per environment. Not changed by this
  document — a human with dashboard access must do this once per
  environment, separately, and the future invite-sending code/script
  must itself pass the matching `redirectTo` explicitly.

  **Correction (2026-09-05, later the same day still): a real invite link
  against this exact route was observed being consumed before the real
  recipient could click it — a new, scanner-resistant step,
  `/internal/activate`, was added ahead of `/internal/set-password` to
  fix this; both `/internal/login` and `/internal/set-password` remain
  functionally unchanged.** Supabase's default email-link format performs
  real, one-time token verification on a plain GET request at Supabase's
  own `/auth/v1/verify` endpoint — an automated email-link security
  scanner that merely fetches the link (a documented, known Supabase risk:
  "Certain email providers may have spam detection or other security
  features that prefetch URL links from incoming emails",
  `supabase.com/docs/guides/auth/auth-email-templates`) consumes the
  single-use token before the person ever clicks it, which is exactly
  what happened live against this project's own invite links.
  `app/internal/activate/page.js` (+ `src/lib/activationFlow.js`, tests)
  fixes this: it performs **no verification at all on page load** — only
  an explicit, real button click calls `supabase.auth.verifyOtp()` (a
  POST, never triggerable by a passive GET-only scanner), and only then
  navigates to the hardcoded `/internal/set-password` (never a
  URL-supplied `redirect_to` — that parameter is deliberately not
  accepted at all, closing an avoidable open-redirect surface). The token
  is carried **only in the URL fragment**
  (`https://<origin>/internal/activate#token_hash=...&type=recovery`, or
  `type=invite`) — a fragment is never sent to any server, Supabase's or
  this app's, so unlike the query-string form Supabase's own
  documentation shows as an example, the token here never appears in any
  server or proxy log at all.

  **Remaining manual step, not yet done, not performed by this
  document**: the Supabase dashboard's **Reset Password** and **Invite
  user** email templates (Authentication → Email Templates) must each be
  changed from the default `{{ .ConfirmationURL }}` link to a custom link
  pointing at `/internal/activate` with the token and type in the
  fragment, e.g. (Reset Password template):
  ```html
  <a href="{{ .SiteURL }}/internal/activate#token_hash={{ .TokenHash }}&type=recovery">Activate your account</a>
  ```
  and the equivalent for Invite user with `type=invite`. **This document
  does not make that change** — it is a separate, later, manual dashboard
  edit. Per this same round's own confirmation: the existing Redirect
  URLs allowlist entry is a **wildcard** covering this app's production
  origin, so it already permits `/internal/activate` as a `redirectTo`
  target without a new allowlist entry — but that is unrelated to, and
  does not substitute for, the still-required email-template edit above:
  the allowlist only permits a `redirectTo` value used elsewhere; it does
  not change what URL any email template's own link points to.

  **Correction (2026-09-05, a third time this day): the click-gated link
  above was itself found live to still be insufficient, and has been
  replaced — not supplemented — with an email+code flow.** After the
  above was deployed and the manual email-template edit made, a real
  password-reset link reached `/internal/activate` already invalid
  *before* the human could ever click "Activate account" — meaning
  whatever consumed the token did so by more than a passive server-side
  GET (the token lived only in the URL fragment, which no server, not
  even this app's own, ever receives), so a click-gated link is *not*
  sufficient against every real-world email-scanning behavior actually
  observed against this project's own mailbox. `app/internal/activate/page.js`
  and `src/lib/activationFlow.js` were rewritten (not extended) to remove
  the link/token from the email entirely, per Supabase's own documented
  alternative ("Option 1: Use `{{ .Token }}` instead and create a page
  where users enter their email and token",
  `supabase.com/docs/guides/auth/auth-email-templates`): the email now
  contains only a plain, static, **tokenless** link to `/internal/activate`
  (safe to open any number of times, by anyone or anything, with zero
  effect — nothing on it is single-use) plus a separate, human-readable
  one-time code (`{{ .Token }}`) the person types into a form on that
  page, alongside their own email address. `type` (`recovery`/`invite`)
  is read from a non-secret `?type=` query parameter on the fixed link —
  **never** from free-form user input; there is no type selector in the
  form. `supabase.auth.verifyOtp({ email, token, type })` is what
  actually consumes the code, called only from the form's submit
  handler, after a real, explicit click — structurally identical
  reasoning to the link-based design's own click-gating, applied to a
  channel (a manually-typed code) that has no URL for anything automated
  to visit or interact with at all.

  **Remaining manual step, not yet done, not performed by this
  document, and only to happen *after* this code change is deployed to
  production** — the Supabase dashboard's **Reset Password** and
  **Invite user** email templates (Authentication → Email Templates)
  must each be changed again, this time to show the code and a plain,
  tokenless link.

  **Correction (2026-09-05, a fourth time this day): the template link
  basis below is corrected from `{{ .SiteURL }}` to `{{ .RedirectTo }}`**
  — the earlier version of this paragraph used `{{ .SiteURL }}`, which is
  only the project's bare configured Site URL and carries no path or
  query of its own; it does not, by itself, resolve to
  `/internal/activate?type=...`. `{{ .RedirectTo }}` is the template
  variable that reflects back whatever `redirectTo` the *triggering call*
  itself supplied (`resetPasswordForEmail`/`inviteUserByEmail`) — the
  same variable, and the same "the call decides the destination, the
  allowlist only permits it" split, already established earlier in this
  document's own "two distinct things are required, not one" correction
  for the prior link-based design. Corrected template content
  (Reset Password):
  ```html
  <p>Your code: {{ .Token }}</p>
  <p><a href="{{ .RedirectTo }}">Activate your account</a></p>
  ```
  and the identical form for Invite user — only the `redirectTo` value
  the triggering call passes differs between the two, never the template
  itself. **Consequently, the future triggering call must itself pass the
  complete, exact, allowed destination as `redirectTo`, per type — not
  merely the bare origin:**
  - `recovery`: `redirectTo: 'https://menucard-kappa.vercel.app/internal/activate?type=recovery'`
  - `invite`: `redirectTo: 'https://menucard-kappa.vercel.app/internal/activate?type=invite'`

  Unchanged from the correction this replaces: the link carries no token
  of any kind — only `type`, which is not a secret — so it remains safe
  for any automated visitor to load any number of times; the code itself
  is shown only as plain text in the email body, never inside the link,
  and the person types it into the form by hand. The
  `#token_hash={{ .TokenHash }}&type=...` fragment-based template content
  documented earlier in this same section remains superseded and must
  not be used going forward, regardless of this further correction.
- **The future live test matrix must include a real `internal`-session
  test**, not only `owner`/`editor`/anonymous denial tests — mirroring
  the `docs/guides/internal-api-live-testing.md` session-minting pattern
  already used for `PLATFORM-06`/`07` verification (mint a session for an
  *existing* Supabase Auth account via `admin.auth.admin.generateLink` +
  `anon.auth.verifyOtp`, no password needed) — but that pattern requires
  the account above to already exist; it cannot substitute for creating
  it.

### Implementation (2026-09-05)

Built without waiting for the still-broken `internal`-account email
activation (tracked separately — see "Risks" below):

- **`src/lib/importInbox.js`** (+ `.test.js`, 30 tests) — all decision
  logic, pure and dependency-free: `isInternalOnly(roles)` (the exact
  `internal`-only rule below), `buildRunSummary` (the overview shape),
  `computeQualityStatus`/`computePossibleDuplicateIds`/
  `enrichAndFilterCandidates` (computed, read-only — see "Duplicate/
  quality status" above; unchanged design, now implemented exactly as
  specified), and `classifyInboxState` (the no-runs/zero-candidates/
  failed-partial/no-filter-matches distinction required below).
- **`app/api/internal/v1/import-inbox/runs/route.js`** — `GET`,
  `internal`-only, reads `import_runs` + resolves source names from
  `sources`, returns `buildRunSummary`'s shape per row.
- **`app/api/internal/v1/import-inbox/candidates/route.js`** — `GET`,
  `internal`-only, reads `import_extraction_records`, supports
  `run_id`/`category`/`name`/`possible_duplicate`/`quality` query
  filters via `enrichAndFilterCandidates`.
- **`app/internal/import-inbox/page.js`** — the page itself, following
  `/internal/moderation`'s exact existing visual/technical pattern
  (session check + redirect, bearer-token fetch, card-list rendering, no
  direct Supabase data access from the browser).
- **`docs/api/import-inbox-api.md`** — new contract doc, matching the
  existing `docs/api/internal-moderation-api.md`/`owner-claims-api.md`
  convention.

**Live-verified this same round, using the existing, already-established
read-only session-minting technique
(`docs/guides/internal-api-live-testing.md`) against the real Supabase
project — no new account, session, or role created**: an unauthenticated
request gets `401`; a real, existing `owner` account and a real, existing
`editor` account each get `403` from both routes. **Not yet
live-verifiable**: the `internal`-role success path — no working
`internal` account exists yet (its email activation link is the still-
broken flow `app/internal/activate/page.js` was built to fix, but no
account has completed that flow end-to-end).

**Correction (2026-09-05, later the same day): one real `ImportRun` now
exists** — see "Status" and "Acceptance criteria" below for the full,
corrected picture. The claim above ("zero `ImportRun`s exist, so there is
nothing for a real `internal` session to browse") is no longer accurate;
left visible rather than silently rewritten.

### Implementation (2026-09-05, later the same day) — candidate review workflow

Built as the next feature after the first real, limited Breda
`ImportRun` (see "Status" below) — the previously-deferred "review notes
and accept/reject-style decisions" item from this ticket's own "Out of
scope" section is **no longer deferred**; it is built:

- **`supabase/migrations/0007_market05a_candidate_reviews.sql`** — the
  separate, append-only `import_candidate_reviews` audit table this
  ticket's original "Out of scope"/"Data model needs" sections named but
  explicitly did not build. One row per review **decision**, never one
  row per candidate — recording a second decision for the same candidate
  is always a new row; `import_extraction_records` itself is never
  touched. `internal`-only, matching "Access control" above exactly (not
  `editor`, not `owner`). Written and locally validated in a disposable,
  containerized PostgreSQL instance with the real 0001–0006 migrations
  and seed data applied first (happy path, the not-found case, both
  check-constraint directions on `rejection_reason`, and — critically —
  that even `service_role` gets `permission denied` on `UPDATE`/`DELETE`
  against this table, since only `select, insert` is ever granted).
  **Applied live (2026-09-05, later the same day)**, manually, in the
  Supabase SQL Editor — read-only re-verified afterward against the real
  project (same grant behavior confirmed live, one real `ImportRun`/10
  candidates unchanged, zero rows in this new table). See the "Correction"
  paragraph at the end of this section for the full live verification.
- **Statuses**: `needs_enrichment`, `approved_internal`, `rejected`,
  `deferred` — plus `new`, which is never itself stored (a pure
  application-level default meaning "no review row exists yet for this
  candidate," computed from the latest row's `decided_at`). **`approved_internal`
  means ready for internal enrichment only — never public publication,
  never a MenuCard.** `rejected` requires one of a fixed set of reasons
  (`not_a_restaurant`, `duplicate`, `permanently_closed`,
  `insufficient_data`, `other`); every other status forbids one — enforced
  both by a database check constraint and by the API's own validation.
- **`record_import_candidate_review()`** (Postgres function, `security
  invoker`, fixed `search_path`) — the only way any decision is ever
  written; always exactly one insert, mirroring `0002_pending_changes.sql`'s
  `approve_pending_change()` pattern (typed not-found error, not a raw
  foreign-key violation) but stricter: that function updates a row in
  place on approval, this one never updates anything at all.
- **`src/lib/importInbox.js`** (extended, +21 tests, 51 total) —
  `validateReviewDecisionInput`/`reviewValidationMessage` (the same
  validation the API route and the page's client-side pre-check both
  use), `computeEffectiveReviewStatus`/`buildReviewStatusByCandidateId`
  (latest-decision-wins, tie-broken by row id, never the first or last
  row blindly). Also includes four **structural safety-net** tests that
  read the actual route/migration source files and assert no
  `.update()`/`.delete()` call and no reference to a canonical/public
  identifier appears anywhere in them — a regression guard against a
  future edit accidentally weakening either guarantee, not merely a
  point-in-time claim.
- **`app/api/internal/v1/import-inbox/candidates/[id]/reviews/route.js`**
  — `GET` (full review history for one candidate, newest first) and
  `POST` (record one new decision), both `internal`-only.
- **`app/api/internal/v1/import-inbox/candidates/route.js`** (extended)
  — now also resolves and returns each candidate's effective
  `review_status`, and accepts a `review_status` filter, alongside the
  existing filters. Still `GET`-only; the added query is itself
  read-only.
- **`app/internal/import-inbox/page.js`** (extended) — each candidate
  card shows a `review_status` badge, a "Missing: `field`, `field`" line
  from `missing_fields` (e.g. `Missing: phone`), and an expandable detail
  view with the full review history and a form to record a new decision
  (status, conditional rejection reason, optional note).
- **Deliberately not built this round — a later, evidence-based signal,
  not guessed at now**: automatic chain/franchise classification. A
  candidate that is part of a chain (e.g. multiple OSM nodes sharing an
  operator) is not detected, flagged, or specially treated by anything in
  this round. When this is eventually built, the intended signal is OSM's
  own `brand`/`brand:wikidata` tags (already present in upstream OSM data
  for many chains, though not currently in this pipeline's minimized
  `basic_info` allowlist — extending that allowlist is itself a separate,
  later decision) or an explicit manual reviewer marking — never an
  inferred/fuzzy guess from name similarity alone, which would risk
  false-positives merging genuinely independent, identically-named
  small businesses.

**Not yet live-verified — the write path itself.** The migration has not
been applied to the real Supabase project (see above); `POST
.../candidates/{id}/reviews` has therefore never been exercised against
it either. Local, containerized validation (above) is real and thorough,
but is not a substitute for live verification once the migration is
applied — that remains a separate, later, explicitly-approved step, per
this project's own discipline throughout `MARKET-04`/`05A`.

**Correction (2026-09-05, later the same day): migration `0007` has
since been applied live**, manually, in the Supabase SQL Editor, and
read-only re-verified afterward: `import_candidate_reviews` exists with
the intended columns; a live `UPDATE`/`DELETE` attempt as `service_role`
is refused (`permission denied`, code `42501`) for both; the one real
`ImportRun` and its 10 `import_extraction_records` are unchanged; no
canonical/public table exists. `import_candidate_reviews` holds zero
rows — applying the migration recorded no review decision. **The write
path itself (`POST .../candidates/{id}/reviews`) remains genuinely
unexercised live** — no real decision has been recorded yet; that stays
a separate, later step.

### Implementation (2026-09-05, later still the same day) — candidate enrichment layer

Built as the next feature after the review workflow — a **separate**,
independent audit log for manually-sourced corrections/additions to a
candidate's `address`/`phone`/`website`:

- **`supabase/migrations/0008_market05a_candidate_enrichments.sql`** —
  `import_candidate_enrichments`: one row per enrichment **fact** (one
  field, one value, one source URL), never one row per candidate. A
  correction is a brand-new row for the same (candidate, field); the raw
  `import_extraction_records` row is never touched, and no update/delete
  grant exists on this table either, for any role. `internal`-only,
  identical access model to `import_candidate_reviews`. Written and
  locally validated in a disposable, containerized PostgreSQL instance
  with the real 0001–0007 migrations and seed data applied first (a
  multi-field submission in one call, a correction creating a second row
  without touching the first, the not-found case, every check-constraint
  direction, and — critically — that even `service_role` gets
  `permission denied` on `UPDATE`/`DELETE`). **Applied live (2026-09-05,
  later still the same day)**, manually, in the Supabase SQL Editor —
  read-only re-verified afterward against the real project (same grant
  behavior confirmed live: correct columns, `UPDATE`/`DELETE` refused
  even for `service_role`, the existing `ImportRun`/10 candidates
  unchanged, zero rows in this new table, no canonical/public table
  touched). See the "Correction" paragraph further below for the full
  live verification.
- **Scope: `address`/`phone`/`website` only, manual entry only.** No
  automatic scraping, no automated website verification, no brand/chain
  classification, no publication of any kind — this is exclusively a
  human typing in a value they found, plus the URL where they found it.
- **`record_candidate_enrichments()`** (Postgres function, `security
  invoker`, fixed `search_path`) — accepts a JSON array of one or more
  `{field_name, value, source_url}` entries and inserts them **all in
  one transaction**: either every field from a submission is recorded,
  or none is. Mirrors `0002_pending_changes.sql`'s/`0007`'s own RPC
  pattern (typed not-found error, not a raw foreign-key violation).
- **`src/lib/importInbox.js`** (extended, +28 tests, 79 total) —
  `validateEnrichmentFieldInput`/`validateEnrichmentRequestInput`/
  `enrichmentValidationMessage` (the same validation the API route and
  the page's client-side pre-check both use — including `isValidHttpUrl`,
  a real `URL` parse restricted to `http:`/`https:`),
  `pickLatestEnrichmentRow`/`buildEnrichmentSourceByCandidateId`
  (latest-value-per-field-wins, tie-broken by row id — same deterministic
  pattern as the review workflow's `computeEffectiveReviewStatus`), and
  `computeEnrichedFields` (raw fields + enrichment overrides → the
  *displayed* view, never mutating the raw input). `enrichAndFilterCandidates`
  now recomputes `quality_status`/`missing_fields` from this combined
  view, not the raw fields alone — a manually-sourced value can move a
  candidate from `incomplete` to `complete` without the raw record ever
  changing. Five structural safety-net tests read the actual route/
  library/migration source files and assert: no `.update()`/`.delete()`
  call exists; no canonical/public identifier appears; the migration
  grants only `select, insert`; and — the specific new risk this feature
  introduces — **the enrichment code path never references the review
  table or a review's note field at all**, anywhere.
- **`app/api/internal/v1/import-inbox/candidates/[id]/enrichments/route.js`**
  — `GET` (full enrichment history for one candidate) and `POST` (record
  one or more field enrichments in one atomic call), both `internal`-only.
- **`app/api/internal/v1/import-inbox/candidates/route.js`** (extended)
  — now also resolves and returns each candidate's `enriched_fields`/
  `enrichment_sources`, and recomputes `quality_status`/`missing_fields`
  from the combined view. Still `GET`-only.
- **`app/internal/import-inbox/page.js`** (extended) — the detail view
  now shows, per enriched field, its source URL and recorded date, plus
  a form to submit one or more `address`/`phone`/`website` corrections
  at once (each with its own value and source URL); a field left blank
  is simply not submitted, never an error.

**Enrichment vs. review notes — a deliberate, tested boundary, not an
oversight.** `import_candidate_reviews.note` is optional free text,
written for a different purpose (context on a review decision) via a
different action (`POST .../reviews`). **Nothing in this feature reads,
parses, or derives a structured enrichment from a review's note** — not
automatically, not on a schedule, not as a one-time migration. Concrete,
named example: if a reviewer had previously typed a phone number or
website reference for **Do Spaces** into a review note, that data is
**not** available as an enrichment merely because the note exists — it
must be deliberately re-entered, by a human who reads the note, through
this feature's own form, with its own source URL. This boundary is
enforced structurally (the enrichment code has no reference to the
review table at all — see the safety-net tests above) and is a
permanent design decision, not a temporary limitation to later relax.

**Independent of review decisions in both directions.** Recording an
enrichment never sets a candidate's `review_status` to
`approved_internal` (or anything else) — review decisions remain their
own, separate, human judgment call. The reverse holds too: recording a
review decision never reads, requires, or is blocked by an enrichment.

**Not yet live-verified — the write path itself, same discipline as
`0007`.** The migration has not been applied to the real Supabase
project; `POST .../candidates/{id}/enrichments` has therefore never been
exercised against it either. Local, containerized validation (above) is
real and thorough, but is not a substitute for live verification once
the migration is applied.

**Correction (2026-09-05, later still the same day): migration `0008`
has since been applied live**, manually, in the Supabase SQL Editor, and
read-only re-verified afterward: `import_candidate_enrichments` exists
with the intended columns; a live `UPDATE`/`DELETE` attempt as
`service_role` is refused (`permission denied`, code `42501`) for both;
the one real `ImportRun` and its 10 `import_extraction_records` are
unchanged; no canonical/public table exists. `import_candidate_enrichments`
holds zero rows — applying the migration recorded no enrichment. **The
write path itself (`POST .../candidates/{id}/enrichments`) remains
genuinely unexercised live** — no real enrichment has been recorded yet;
that stays a separate, later step.

Noted during this same verification, unrelated to this migration:
`import_candidate_reviews` was found to hold 10 rows (one review
decision per existing candidate) — evidence a working `internal` session
has completed at least once. This does not change anything about
`0008`'s own verification above; recorded here for visibility only, not
folded into the review-workflow section's own account of that gap.

### Out of scope (explicit non-goals)

- Direct browser/RLS access to `import_runs`/`import_extraction_records`
  — every read goes through a new, gated `/api/internal/v1/...` route
  using the service role, exactly like `PLATFORM-06`'s existing pattern;
  no new grant or RLS policy on either table.
- Any public route, canonical merge, publication, or API exposure of
  import candidates — this ticket's data never leaves the gated internal
  surface.
- `MARKET-05B`'s real matching/deduplication/canonicalization logic.
- `PLATFORM-06`'s moderation workflow (approve/reject) — this ticket is
  read-only; **review notes and accept/reject-style decisions on a
  specific candidate are explicitly deferred to a separate, later,
  append-only table and ticket** (e.g. `import_candidate_reviews` or
  similar — name and shape not decided here), never bolted onto the
  append-only `import_extraction_records` table itself.

  **Correction (2026-09-05, later the same day): built, as the next
  feature.** See "Implementation (2026-09-05, later the same day) —
  candidate review workflow" above for the full design
  (`import_candidate_reviews`, `record_import_candidate_review()`,
  `needs_enrichment`/`approved_internal`/`rejected`/`deferred`). Still
  never `PLATFORM-06`'s own moderation workflow, and never a canonical
  merge or public exposure — `approved_internal` means ready for
  internal enrichment only.
- Automatic scraping, automated website verification, brand/chain
  classification, or publication of any kind for candidate data.
  **Built manual-only, as a later feature (2026-09-05, later still the
  same day)**: `import_candidate_enrichments` records exactly what a
  human reviewer typed in, with a source URL they manually provided —
  see "Implementation (2026-09-05, later still the same day) — candidate
  enrichment layer" above. No automated fetch of any kind was added.
- Running any real `ImportRun` — this ticket assumes at least one real,
  live `ImportRun` will eventually exist to browse; it does not create
  one, and does not change the separate, explicit approval `MARKET-04`'s
  own report still requires before that happens.

  **Correction (2026-09-05, later the same day): one now exists** — a
  single, explicitly-approved, `--max-records-to-store=10`-limited live
  Breda run (see "Status" below). This document still did not trigger or
  perform it — that remained a separate, later, explicit approval, exactly
  as this bullet always required.
- Triggering, scheduling, or re-running an import from the UI. **Still
  true** — the one real run above was triggered from the CLI, not this
  UI, which still has no import-triggering control of any kind.

### Data model needs

Read-only against `MARKET-04`'s existing six tables — no new table,
column, grant, or RLS policy for the inbox itself. The one schema
addition this ticket anticipates but does **not** build is the separate,
append-only review/decision table named above, explicitly deferred.

**Correction (2026-09-05, later the same day): that table is now built
and applied live** — `supabase/migrations/0007_market05a_candidate_reviews.sql`
(`import_candidate_reviews`). Read-only re-verified against the real
Supabase project: correct columns, `UPDATE`/`DELETE` refused even for
`service_role`, the existing `ImportRun`/10 candidates unchanged, no
canonical/public table touched. See "Implementation (2026-09-05, later
the same day)" above.

**Further correction (2026-09-05, later still the same day): a second,
independent append-only table is now also built and applied live** —
`supabase/migrations/0008_market05a_candidate_enrichments.sql`
(`import_candidate_enrichments`), for manual `address`/`phone`/`website`
enrichment. Read-only re-verified against the real Supabase project:
correct columns, `UPDATE`/`DELETE` refused even for `service_role`, the
existing `ImportRun`/10 candidates unchanged, no canonical/public table
touched. See "Implementation (2026-09-05, later still the same day) —
candidate enrichment layer" above.

### Risks

- Designing the quality/duplicate heuristics so well that they get
  silently trusted as authoritative — both must stay visibly "a hint,"
  never a stored verdict, until `MARKET-05B`'s real logic exists.
- Scope creep toward building `MARKET-05B` or `PLATFORM-06`-style
  approve/reject actions inside what should stay a read-only inbox.
- **Built against no real `internal` account (confirmed, not silently
  worked around).** The access decision above (`internal`-only) was
  already fixed; implementation proceeded without fabricating an
  account, a role, or test data — `isInternalOnly`'s correctness is
  unit-tested against synthetic role arrays, and the `403` denial path is
  live-verified against real, existing `owner`/`editor` accounts (see
  "Implementation" above). The one thing genuinely not yet provable is
  the real `internal`-role success path, which requires the still-open
  precondition above to be resolved first — not an implementation gap,
  an honest, named limitation.

### Acceptance criteria (for the eventual implementation ticket — not this document)

- [ ] Only a session carrying the `internal` `staff_roles` value can view
      an import overview (counts, duration, status) for every existing
      `ImportRun` — verified with a real `internal` session, per "Access
      control" above, not merely asserted in code. **Not yet verifiable —
      no working `internal` account exists (see "Implementation" above).**
- [x] A session carrying only `editor` and/or `owner`, and a session with
      no `staff_roles` row at all, are each verified to get no access —
      not merely "not given a link to it." **Live-verified 2026-09-05**
      against real, existing `owner` and `editor` accounts (`403`); a
      roleless/anonymous request gets `401`.
- [ ] The same `internal` session can view, filter
      (run/category/name/possible-duplicate/quality/review-status), and
      read the full minimized field set of every `ImportExtractionRecord`.
      **Filtering itself is unit-tested (`enrichAndFilterCandidates`,
      including the added `review_status` filter); the end-to-end,
      real-session, real-data path is not yet verifiable — no working
      `internal` account exists yet.** **Correction (2026-09-05, later
      the same day): real data to view now exists** (one `ImportRun`, 10
      candidates) — the remaining blocker is specifically the
      `internal`-account activation, not "zero data," which was the
      original blocker named here.
- [x] No-run, zero-candidates, failed/partial-run, and empty-filter-result
      states are each distinguishable from one another in the UI —
      `classifyInboxState` unit-tested for all four. **Correction
      (2026-09-05, later the same day): "no-run" is no longer the only
      live-reachable state** — a real run with real candidates now exists
      (see "Status" below); it remains true that none of these states has
      been live-viewed through an actual `internal` session yet.
- [ ] No direct browser/RLS access to either raw table — verified the
      same way `MARKET-04A`'s own RLS was live-verified. **Not
      independently re-verified this round — no new grant or RLS policy
      was added, so `MARKET-04A`'s original live verification still
      applies unchanged; not re-tested against these two new routes
      specifically.**
- [x] No route, action, or code path in this surface can write to
      `import_runs`, `import_extraction_records`, or any canonical table
      — both original routes are `GET`-only, and neither calls
      `.insert()`, `.update()`, or `.delete()` anywhere in their source.
- [x] **(Added 2026-09-05, later the same day)** Recording a candidate
      review decision is always exactly one new, append-only row —
      never an update of a previous decision, never a mutation of
      `import_extraction_records` itself. Proven at three independent
      layers: the database grants (`select, insert` only on
      `import_candidate_reviews`, for any role — locally confirmed even
      `service_role` gets `permission denied` on `UPDATE`/`DELETE`), the
      route source (structural safety-net tests assert no `.update()`/
      `.delete()` call exists), and the pure logic
      (`computeEffectiveReviewStatus` always derives the *displayed*
      status from the latest row, never mutating history to get there).
      **Live-verified (2026-09-05, later the same day)**: migration `0007`
      applied to the real Supabase project; a live `UPDATE`/`DELETE`
      attempt as `service_role` against `import_candidate_reviews` is
      refused (`permission denied`, code `42501`) for both. **Still not
      live-exercised**: the actual write path (`POST
      .../candidates/{id}/reviews`) — the table holds zero rows; no real
      review decision has been recorded yet, live or otherwise.
- [x] **(Added 2026-09-05, later still the same day)** Recording a
      candidate enrichment is always exactly one new, append-only row per
      field (or several, one per field, atomically in one submission) —
      never an update of a previous value, never a mutation of
      `import_extraction_records` itself, and a correction never removes
      or alters the row it supersedes. Proven the same three ways as the
      review workflow above (database grants, structural safety-net
      tests, pure-logic latest-wins reduction), plus a fourth, specific
      to this feature: dedicated structural tests confirm the enrichment
      code path never references the review table or a review's note
      field at all. `quality_status`/`missing_fields` are unit-tested to
      be recomputed from the combined (raw + enrichment) view.
      **Live-verified (2026-09-05, later still the same day)**: migration
      `0008` applied to the real Supabase project; a live `UPDATE`/`DELETE`
      attempt as `service_role` against `import_candidate_enrichments` is
      refused (`permission denied`, code `42501`) for both. **Still not
      live-exercised**: the actual write path (`POST
      .../candidates/{id}/enrichments`) — the table holds zero rows; no
      real enrichment has been recorded yet, live or otherwise.
- [ ] Internal/admin surface — exempt from the consumer performance
      budget per `[[009-consumer-vs-internal-performance-budget]]`, same
      as `PLATFORM-06`. Not specifically measured this round (matches
      `PLATFORM-06`'s own precedent of asserting this by convention,
      not a performance-budget test suite).

### Suggested order

**Built 2026-09-05; extended with the candidate review workflow later
the same day; migration `0007` applied live later still the same day;
the candidate enrichment layer built later still the same day; migration
`0008` applied live later still the same day.** Remaining, in order:
(1) fix the `internal`-account email activation
(`app/internal/activate/page.js` exists but no account has completed
it — Supabase's Reset Password/Invite user templates still need their
manual dashboard edit, per `docs/api/import-inbox-api.md`'s own note);
(2) create and activate a real `internal` account; (3) only then
live-verify the `internal`-role read success path, the review-decision
write path, and the enrichment write path end to end, against the one
real `ImportRun` and its 10 real candidates that already exist. Three
previously-listed steps are now **done** — see "Status": running a
first real, approved `ImportRun`; applying
`supabase/migrations/0007_market05a_candidate_reviews.sql` to the live
Supabase project (read-only re-verified: correct columns,
`UPDATE`/`DELETE` refused even for `service_role`, the existing run/10
candidates unchanged, zero rows in that table); and applying
`supabase/migrations/0008_market05a_candidate_enrichments.sql` to the
live Supabase project (read-only re-verified the same way: correct
columns, `UPDATE`/`DELETE` refused even for `service_role`, the existing
run/10 candidates unchanged, zero rows in that table).

**Note (2026-09-05, later still the same day), unrelated to either
migration above**: while re-verifying `0008` live, `import_candidate_reviews`
was found to already hold 10 rows (one review decision per existing
candidate) — evidence step (2) above (a working `internal` account) has
in fact already happened at least once, even though it has not been
documented as done anywhere in this ticket yet. Recorded here for
visibility; not otherwise acted on or investigated further this round.

### Implementation (2026-09-06) — centralized normalization + controlled website suggestions

Built as the next feature after the enrichment layer. **No new
migration** — both additions here are purely computational (normalization)
or purely a new, read-only-against-Supabase server action (website
suggestions); neither introduces a new persisted concept
`import_candidate_enrichments`/`import_candidate_reviews` didn't already
cover, so `0008` remains the latest schema.

#### Centralized normalization

- **`src/lib/candidateNormalization.js`** (new, 31 tests) —
  `normalizeWebsite`/`normalizePhoneNL`/`normalizeAddressNL`, each
  returning `{ value, normalized, display, changed, valid }`. Every
  normalizer follows the same conservative contract, enforced by its own
  exhaustive test suite:
  - **Never guesses.** An input that doesn't clearly match a known-safe
    shape is returned completely unchanged, `valid: false` — never
    "corrected" toward a best guess. Applies uniformly: an unrecognized
    phone digit count, a non-`http(s)` URL, anything non-string.
  - **Idempotent**, proven directly: feeding a normalizer's own
    `normalized` (and, for phone, also its `display`) output back in
    reproduces the identical result. This is the literal, tested
    guarantee behind "elke normalisatie idempotent."
  - **Pure — no I/O, no geocoding, no external lookup of any kind.**
    Address normalization is deliberately whitespace/postcode-shape
    only (collapses whitespace; uppercases and single-spaces a
    recognized 4-digit+2-letter Dutch postcode substring) — never an
    automatic address correction, never a real-address lookup, exactly
    as scoped.
  - **Website**: lowercases only the scheme and host (the two
    genuinely case-insensitive parts of a URL per RFC 3986) — the path,
    query string, and fragment are carried through as an exact substring
    of the original input, never re-parsed or re-encoded, so a
    meaningful path/query parameter can never be silently dropped or
    altered. Userinfo (rare, but case-sensitive) is preserved as-is.
  - **Phone (Netherlands-focused)**: recognizes the common, unambiguous
    national 10-digit shape (`0` + 9 digits, covering `06` mobile and
    geographic/service numbers), with or without `+31`/`0031`, with
    common cosmetic punctuation stripped. Canonical storage/comparison
    form is `+31` + 9 digits; the readable Dutch **display** form is
    `"06 12345678"` for mobile (unambiguous — `06` is always exactly 2
    digits) and an intentionally **ungrouped** `"0" + 9 digits` for every
    other valid number. **Named, deliberate limitation**: this project
    has no verified, complete table of which Dutch geographic area
    codes are 2 digits vs. 3 digits, and guessing a split point (e.g.
    always grouping as `0XX XXXXXXX`) would silently mis-group roughly
    half of them — preferred over a confidently wrong-looking display.
    A short-rate number with fewer than 9 digits after the trunk `0`
    (some real `0800` numbers) is correctly left unrecognized rather
    than mis-parsed.
- **`src/lib/importInbox.js`** (extended) — `computeNormalizedFields`
  runs the three normalizers over the already-combined (raw +
  enrichment) field set and returns the **display** form
  (`.display`, not the bare `+31...` storage form, for phone) as the
  value shown; the full per-field detail (including the canonical
  `.normalized` form) stays available for anything that needs it (e.g.
  the suggestion-comparison logic below). `enrichAndFilterCandidates`
  now attaches this as `normalized_fields`/`normalization` on every
  candidate, and — per this ticket's own explicit requirement —
  recomputes `quality_status`/`missing_fields` from `normalized_fields`,
  not the raw combined view: a purely cosmetic normalization (e.g.
  postcode casing) can, in principle, be the difference that completes a
  field comparison downstream. **`extracted_fields` and
  `enriched_fields`/`enrichment_sources` are completely unaffected** —
  normalization is a pure, additional display layer, never a
  replacement for the raw import value or the enrichment audit trail.
- **`app/internal/import-inbox/page.js`** (extended) — the candidate
  card and detail view now render `normalized_fields` (the Dutch-readable
  phone display, the postcode-cased address) instead of the raw/enriched
  values directly, while still showing each enriched field's source URL
  and date exactly as before; an unrecognized phone format is flagged
  inline ("phone format not recognized — shown as entered") rather than
  silently displaying a guess.
- **Enrichment form UX (this same round)**: a "Use one source URL for
  all filled-in fields" checkbox — when checked, one shared URL input
  replaces the three individual per-field source-URL inputs, and that
  one URL is applied to every field the reviewer actually filled in at
  submit time. A candidate's detail card now **automatically collapses
  after a successful** "Save decision" or "Save enrichment" — but
  **never** after a validation or API failure, where the card stays open
  with everything the reviewer typed still in place. The underlying
  decision (`shouldCollapseCandidateCardAfterAction(outcome)`) is a
  pure, directly-tested function in `src/lib/importInbox.js` — `true`
  only for a literal `outcome.ok === true` — precisely because this
  project has no browser/DOM test harness to verify page.js's own wiring
  directly; the wiring itself was verified by reading the compiled
  production bundle, the same discipline used throughout `MARKET-05A`
  for every CommonJS-into-`'use client'` import.

#### Controlled website suggestions ("Suggest data from website")

A **read-only-against-Supabase**, human-confirmation-required feature —
never an automated enrichment pipeline. Per candidate, a button fetches
*only* the candidate's own already-stored website (never a
caller-supplied URL — the server route re-derives it itself from
`import_extraction_records`/`import_candidate_enrichments`, exactly
like every other read in this feature) and returns **temporary**
suggestions for `address`/`phone`/`website` — nothing is ever written to
`import_candidate_enrichments` or any other table by this route itself.
A suggestion only becomes a real enrichment if a reviewer explicitly
confirms it, per field, through the pre-existing `POST
.../candidates/{id}/enrichments` route — this feature only ever
pre-fills that form's draft state.

- **`src/lib/safeOutboundFetch.js`** (new, 26 tests) — the only place in
  this project that fetches an arbitrary third-party URL, hardened
  against SSRF at every documented layer (see the file's own header
  comment for the complete list):
  1. **Protocol allowlist** (`http`/`https` only) and rejection of
     embedded credentials and the literal `localhost`/`*.localhost`
     alias, checked before any DNS lookup.
  2. **A custom Node `lookup` function is passed to every request** —
     Node calls this instead of `dns.lookup()` internally and refuses to
     open a socket at all if it errors. This is the real defense against
     DNS rebinding: even a hostname that *resolves* to a
     private/loopback/link-local address is rejected before any TCP
     connection is attempted, not merely checked against the literal
     hostname string. Comprehensively tested (`isDisallowedIPv4`/
     `isDisallowedIPv6`) against the full loopback/private/link-local/
     "this network"/multicast/reserved ranges, plus IPv4-mapped IPv6
     addresses.

     > **Correction (2026-09-05):** the claim above was accurate for
     > *hostnames* but incomplete: a **literal** IP host in the URL
     > (e.g. `http://127.0.0.1/…`) never triggers a DNS lookup in Node
     > at all, so the guarded `lookup` function was never even called
     > for that case — a genuine bypass. Fixed in `isSafeUrlShape`,
     > which now rejects a disallowed literal IPv4/IPv6 host (including
     > IPv4-mapped IPv6 in both dotted and Node's canonical hex form,
     > e.g. `::ffff:7f00:1`) before any request is issued, using
     > `net.BlockList` against the full IANA special-purpose address
     > registries — checked on every hop, since `isSafeUrlShape`
     > already gates every redirect too. `isDisallowedIPv4`/
     > `isDisallowedIPv6` were also rewritten on top of `net.BlockList`
     > (previously hand-rolled regex/arithmetic, which only matched the
     > dotted-decimal form of IPv4-mapped IPv6 and missed the hex form
     > that `new URL()` actually produces). 15 new tests added; see
     > `src/lib/safeOutboundFetch.test.js`.
     >
     > **Further correction (2026-09-05):** "the full IANA special-
     > purpose address registries" above was itself not yet accurate —
     > the block list at the time only covered the most common ranges
     > and was still missing several IANA-registered ones (IPv4:
     > AS112-v4 `192.31.196.0/24`, AMT `192.52.193.0/24`, direct-
     > delegation AS112 `192.175.48.0/24`; IPv6: most `2001::/23`
     > sub-ranges — Teredo, PCP/TURN anycast, benchmarking, AMT,
     > AS112-v6, ORCHID/ORCHIDv2, Drone Remote ID — plus the second
     > NAT64 range `64:ff9b:1::/48`, 6to4 `2002::/16`, the second AS112
     > direct-delegation range `2620:4f:8000::/48`, and the newer
     > documentation/SRv6 ranges `3fff::/20` and `5f00::/16`). All now
     > added to `buildDisallowedIpBlockList` in
     > `src/lib/safeOutboundFetch.js`, whose own comment states the
     > policy explicitly: every IANA special-purpose range is
     > disallowed as a destination for this feature, even one that is
     > technically globally routable, and the list should be re-diffed
     > against the live registries periodically rather than assumed to
     > stay complete forever. 9 new tests added; see
     > `src/lib/safeOutboundFetch.test.js`.
  3. **Bounded redirects** (default 3) — every redirect target is
     independently re-validated by the exact same protocol/credentials/
     localhost/DNS-guard checks as the initial URL; live-tested with a
     real local HTTP server proving a redirect to a disallowed address
     is rejected mid-chain, not merely on the first hop.
  4. **Bounded response size** (default 2 MB) — the connection is
     destroyed the instant the cap is exceeded, never buffering an
     unbounded response; live-tested.
  5. **A hard timeout** (default 8 s).
  6. **No cookies, no `Authorization` header, no browser-like session
     state** — a single, stateless, anonymous request with a fixed,
     honest `User-Agent` naming this feature (never a browser-spoofing
     UA); live-tested that no such header is ever sent.
  Tests separate the SSRF-guard logic itself (fully mocked, no real
  network — a fake DNS resolver returning a private IP proves the guard
  rejects it) from every other fetch behavior (redirects/size/timeout;
  a real local HTTP test server with an explicitly *unguarded* test-only
  `lookup`, since any real local server is unavoidably loopback-bound,
  which the real guard correctly, always rejects — see the test file's
  own comment for why this split is necessary and correct, not a gap in
  coverage).
- **`src/lib/candidateSuggestions.js`** (new, 27 tests, real local
  HTML/JSON-LD fixture files under `src/lib/__fixtures__/`, never a real
  website) — pure parsing/comparison, no network access of its own:
  - **Scope: `address`/`phone`/`website` only.** Prefers schema.org
    JSON-LD (`Restaurant`/`FoodEstablishment`/`LocalBusiness`/
    `Organization`/etc. — an irrelevant JSON-LD block, e.g. a
    `BlogPosting`, is correctly ignored); falls back to explicit `tel:`
    links / `<address>` tag content only when no relevant JSON-LD node
    exists — **never** a general scan of page text. Test-proven that a
    real JSON-LD node's `menu`/`priceRange`/`image` fields (present on
    the same node as the contact info) are never read, even though
    they're right there in the same object.
  - **robots.txt** (`parseRobotsTxtDisallowRules`/`isPathAllowedByRobots`)
    — a minimal, real parser for the `User-agent: *` group's `Disallow`
    rules. **This is a product policy this feature applies to itself,
    never a claim of legal permission**: robots.txt allowing (or simply
    not mentioning) a path is never treated as authorization to use the
    site's content for anything beyond this narrow, human-confirmed
    contact-field suggestion; its *absence* entirely is likewise never
    treated as license to scrape freely. The feature would still apply
    every other safeguard (SSRF hardening, contact-fields-only scope,
    human confirmation) with or without a robots.txt gate.

    > **Correction (2026-09-05):** the route previously treated a
    > *failed* `robots.txt` fetch (network error, non-2xx status,
    > timeout, or a disallowed SSRF target) the same as "no restriction
    > declared" and fetched the page anyway — fail-open. Fixed with a
    > new pure function, `classifyRobotsGate`, that fails **closed**: a
    > failed fetch and an explicit `Disallow` both result in the page
    > never being fetched, reported as distinct `"unconfirmed"` vs.
    > `"disallowed"` statuses so a reviewer can tell them apart.
    > Redirects are also now disabled entirely (`maxRedirects: 0`) on
    > both the `robots.txt` fetch and the page fetch, closing a related
    > gap where a redirect could land on a destination whose own
    > `robots.txt` was never checked. See `classifyRobotsGate` in
    > `src/lib/candidateSuggestions.js` and its tests.
  - **Comparison against the candidate's current data**
    (`compareFieldValue`, `namesLikelyMatch`, `postcodesLikelyMatch`) —
    every suggested field is independently classified `new` (candidate
    had nothing there), `match` (agrees with the current value after
    normalization), or `needs_review` (conflicts, or the page's own
    name/address doesn't plausibly match the candidate at all — which
    downgrades *every* suggested field to `needs_review`, even ones that
    individually look fine, since a mismatched page can't be trusted for
    any of them). **Never a status that implies anything is written
    automatically** — `needs_review` and `new` are both still just
    proposals for a human to confirm or discard.
- **`app/api/internal/v1/import-inbox/candidates/[id]/suggest-from-website/route.js`**
  (new) — `POST`-only, `internal`-only, triggered exclusively by the
  explicit button click described below (never on candidate load, never
  scheduled). Structurally proven, via dedicated tests reading this
  route's own source: no `.insert()`/`.update()`/`.delete()`/`.rpc()`
  call exists anywhere in it (every Supabase call is a `select`), and
  every `fetchWebsiteSafely` call site is built from the candidate's own
  resolved `website` field or a `robots.txt` path derived from it —
  never from `request.json()`/`request.url`/any caller-supplied value —
  so this can never be turned into an open fetch proxy for arbitrary
  URLs.
- **`app/internal/import-inbox/page.js`** (extended) — a "Suggest data
  from website" button per candidate, disabled when the candidate has no
  website on file. On success, pre-fills the existing enrichment form's
  value + source URL for every suggested field that isn't `no_data`,
  and shows each field's match/needs-review status plus any name/address
  mismatch warning inline — the reviewer still has to review and click
  "Save enrichment" per field for anything to actually be written; the
  button itself never fires on expand, only on an explicit click.

**Not yet live-verified.** Both `safeOutboundFetch.js` and
`candidateSuggestions.js` are exhaustively unit-tested against local
fixtures/a local test server only, per this round's explicit
instruction — no real website has ever been fetched by this feature, in
development or otherwise. That remains true until a reviewer actually
clicks the button against a real candidate with a real website, which
has not happened.

## MARKET-05B — Normalization & deduplication (placeholder, untouched)

Original scope, unchanged by this document: matching and deduplicating
`ImportExtractionRecord`s across sources into canonical candidate
records (`docs/api/canonical-restaurant-menu-schema.md`), each carrying
`SourceReference`s back to their originating `import_run_id`. Requires
`MARKET-01`'s boundary (already available, Breda v1) and, per `MARKET-04`
hard gate 3B, remains blocked from ever merging OSM-derived candidates
with non-OSM sources until the qualified legal review of the
Collective-vs-Derivative-Database question happens. **Not designed,
scoped in detail, or started here** — `market-data-foundation-plan.md`'s
existing prose description remains the only source of intent until a
real `05B` ticket is written.
