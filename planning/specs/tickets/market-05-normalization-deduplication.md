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
  - **No `ImportRun`s exist yet** (true today, live) — a clear "Nog geen
    importrun uitgevoerd" state, not an empty table with no explanation.
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
account has completed that flow end-to-end), and zero `ImportRun`s exist,
so there is nothing for a real `internal` session to browse yet even once
one exists. The "no import runs yet" empty state is, right now, the only
genuinely reachable state in production — confirmed live via the real
`runs`/`candidates` endpoints once a session is available.

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
- Running any real `ImportRun` — this ticket assumes at least one real,
  live `ImportRun` will eventually exist to browse; it does not create
  one, and does not change the separate, explicit approval `MARKET-04`'s
  own report still requires before that happens.
- Triggering, scheduling, or re-running an import from the UI.

### Data model needs

Read-only against `MARKET-04`'s existing six tables — no new table,
column, grant, or RLS policy for the inbox itself. The one schema
addition this ticket anticipates but does **not** build is the separate,
append-only review/decision table named above, explicitly deferred.

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
      (run/category/name/possible-duplicate/quality), and read the full
      minimized field set of every `ImportExtractionRecord`. **Filtering
      itself is unit-tested (`enrichAndFilterCandidates`); the end-to-end,
      real-session, real-data path is not yet verifiable — zero
      `ImportRun`s exist.**
- [x] No-run, zero-candidates, failed/partial-run, and empty-filter-result
      states are each distinguishable from one another in the UI —
      `classifyInboxState` unit-tested for all four; only "no-run" is
      currently live-reachable (zero `ImportRun`s exist today).
- [ ] No direct browser/RLS access to either raw table — verified the
      same way `MARKET-04A`'s own RLS was live-verified. **Not
      independently re-verified this round — no new grant or RLS policy
      was added, so `MARKET-04A`'s original live verification still
      applies unchanged; not re-tested against these two new routes
      specifically.**
- [x] No route, action, or code path in this surface can write to
      `import_runs`, `import_extraction_records`, or any canonical table
      — both new routes are `GET`-only, and neither calls `.insert()`,
      `.update()`, or `.delete()` anywhere in their source.
- [ ] Internal/admin surface — exempt from the consumer performance
      budget per `[[009-consumer-vs-internal-performance-budget]]`, same
      as `PLATFORM-06`. Not specifically measured this round (matches
      `PLATFORM-06`'s own precedent of asserting this by convention,
      not a performance-budget test suite).

### Suggested order

**Built 2026-09-05.** Remaining, in order: (1) fix the `internal`-account
email activation (`app/internal/activate/page.js` exists but no account
has completed it — Supabase's Reset Password/Invite user templates still
need their manual dashboard edit, per `docs/api/import-inbox-api.md`'s
own note); (2) create and activate a real `internal` account; (3) run a
first real, approved `ImportRun`; (4) only then live-verify the
`internal`-role success path end to end.

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
