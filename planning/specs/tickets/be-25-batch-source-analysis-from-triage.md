# BE-25 — Batch-bronanalyse vanuit Brontriage (v1)

## Status

Fase 0 (decisions and documentation) is recorded in this ticket. Nothing
is built: no migration, route, page, worker or test exists for BE-25. The
next step is migration `0016` (fase 1), which may only be built after
this documentation is reviewed and on `main` (see "Release sequence").

## Voortgang

BE-25 VOORTGANG

- [x] 1. Ticket en kernbeslissingen vastgelegd
- [ ] 2a. Documentatiecommit lokaal gemaakt — made together with this
  text; checked in the next status update
- [ ] 2b. Documentatiecommit gepusht
- [ ] 3. Implementatie-readinessreview groen
- [ ] 4. Lokale productcode gebouwd en getest
- [ ] 5. Onafhankelijke pre-commitreview groen
- [ ] 6. Lokale codecommit gemaakt
- [ ] 7. Gecombineerde pre-pushreview groen
- [ ] 8. Code gepusht
- [ ] 9. Productiecontrole

See `015-be-ticket-structure-and-time-boxing.md` for what this checklist
means and how it must be kept up to date.

## Goal

An internal staff member pastes up to 10 restaurant URLs, chooses
"Analyse starten" once, and sees each URL's progress update by itself.
Every result stays a reviewable result: nothing is published, and every
step towards a concept, a menu proposal or a source proposal stays an
explicit human action.

## Depends on

- BE-20 (`be-20-general-restaurant-source-extraction.md`): the analysis
  pipeline, the job contract, "Batch-readiness" and "Cost limits and
  stop behavior".
- BE-19 and `docs/api/url-intake-schema.md`: receipts, `url_intakes`,
  the governance exception and its amendments, including "Amendment
  (2026-10-09, BE-25)".
- Migrations `0013` (receipts, `url_intakes`), `0014` (analysis jobs,
  `url_intake_batches`) and `0015` (the privilege pattern to follow).
- BE-23 (Bronwerkvoorraad: host attribution and the Bron/Menukaart
  vocabulary) and BE-24 (Brontriage).
- Decision 014 and `docs/guides/design-reference.md` ("Kleurtaal v2",
  accessibility, status vocabulary).

## What exists today (facts)

- `restaurant_source_analysis_jobs` (0014): `pending` / `running` /
  `succeeded` / `failed`, a closed `error_reason` list, `attempt_count`
  (1–5), `batch_id` → `url_intake_batches`, `field_evidence`. The batch
  table exists but nothing uses it yet.
- `POST /api/internal/v1/restaurant-analysis-jobs` analyses one URL
  synchronously inside the request. There is no queue, worker, cron,
  `after()` or idempotency. `GET …/[id]` shows a job only to the staff
  member who started it.
- A successful job issues a BE-19 receipt: it expires after ten minutes
  (`RECEIPT_TTL_MS`), is bound to its actor and is single-use. The row
  itself, with `candidate_summary` and `analysis_result_hash`, stays in
  the database after it expires.
- All fetching goes through `restaurantSourceFetch`/`safeOutboundFetch`
  (SSRF defences, 8 s timeout, byte limits, `robots.txt` fail-closed per
  redirect hop) and BE-20's same-host discovery (at most five
  candidates). AI structuring is disabled.
- No retry/backoff timing is defined anywhere in the repository.

## Vaststaande productkeuzes (decided 2026-10-09 by the product owner)

**B1 — Governance: one explicit batch action, at most 10 URLs.** One
explicit action by one `internal` staff member may put at most 10
validated URLs into one batch. The processor only processes that batch
and never discovers or adds targets of its own. Recorded as
`docs/api/url-intake-schema.md`, "Amendment (2026-10-09, BE-25)", which
lifts the "no bulk list" exclusion for exactly this action and nothing
else.

**B2 — Durable batch binding; the BE-19 flow is unchanged.** Every
batch result has a durable, internally reviewable binding to its batch,
its source URL, its evidence and its original job. This is a second,
bounded durable write path beside BE-19: it consumes the receipt its job
issued, as payload and single-use lock only. The BE-19 flow
(`create_url_intake_from_receipt`, ten minutes, actor-bound) is not
changed. See "B2 — batch binding contract" below and
`docs/api/url-intake-schema.md`, "Amendment (2026-10-09, BE-25)".

**B3 — V1 processes only while the batch page is open.** Processing is
driven by the open batch page of the staff member who started the batch
(the governance amendment ties it to their own action); other `internal`
staff can view the batch but do not drive it. No copy anywhere in v1
says the screen may be closed. A background processor is fase 3 and
needs its own infrastructure decision.

**B4 — Limits for v1.**

| Limit | Value |
|---|---|
| URLs per batch | at most 10 |
| URLs queued per `internal` staff member per day | at most 25 (calendar day, Europe/Amsterdam) |
| Active jobs overall | at most 1 |
| Active jobs per host | at most 1 |
| Time between two analyses of the same host | at least 60 seconds |
| Reuse of a successful result for the same canonical URL | at most 7 days |
| Attempts per job | the existing maximum: `attempt_count` ≤ 5 (0014, `MAX_ATTEMPT_COUNT`) |
| Automatic retry backoff | 2 minutes before the 2nd attempt, 10 before the 3rd, 30 before the 4th and 5th (no existing pattern in the repository) |

**B5 — Visibility.** Every batch result stays visible in the batch
history. Only results that need human editorial action are shown in
Brontriage (see "Where results go"). "Geen bruikbare menukaart gevonden"
stays visible with a retryable next step and is never presented as
evidence that no menu exists (BE-22, BE-23).

### Rules that follow from B1–B5 (recorded here so fase 1 and 2 need no new decision)

- A URL whose successful result is less than 7 days old is not fetched
  again: it is shown as "Recent geanalyseerd" with that result. It does
  not count towards the daily limit of 25, but it does count towards the
  10 URLs of the batch. Only an explicit "Opnieuw analyseren" on that one
  URL queues a new job (in a new one-URL batch, see "Manual
  re-analysis" below), which does count.
- Automatic retries apply only to transient failures (`fetch_failed`,
  `internal_error`, and a timeout or HTTP 429/5xx reported as
  `fetch_failed`). `robots_disallowed`, `unsafe_url` and
  `unsupported_content_type` are terminal and never retried
  automatically. An automatic retry inside a batch continues the same
  job (`attempt_count` + 1, `next_attempt_at` per the backoff); it is
  never a new job. After the last attempt, a failed job offers a manual
  "Opnieuw proberen".
- **Manual re-analysis** ("Opnieuw analyseren" and "Opnieuw proberen")
  always creates a new, explicit batch with exactly that one URL. It
  never adds a job to an existing `batch_id`, and the URL counts towards
  the daily limit. It is offered only once the earlier job for that URL
  is terminal (`succeeded` or `failed`), expired (a lease that ran out on
  its last attempt, which recovery records as `failed`), or explicitly
  released by its starter (see "Open points").
- The 7-day window also bounds B2: a batch result can be turned into a
  URL intake while it is at most 7 days old; after that it stays visible
  in the history and can only be analysed again.

## B2 — batch binding contract (input for migration 0016)

This is a second, bounded durable write path to `url_intakes`, recorded
as such in `docs/api/url-intake-schema.md`, "Amendment (2026-10-09,
BE-25)". Any further relaxation needs a new amendment.

- **The trusted binding is the batch job**: its `batch_id`, its original
  actor (`actor_user_id`, the staff member who started the batch),
  `canonical_source_url`, `field_evidence`, and through
  `result_receipt_id` the stored `analysis_result_hash` and result.
- **The receipt is only payload and lock**: it supplies the stored
  `candidate_summary` and, through `consumed_at`, makes one result
  become at most one URL intake, whichever path redeems it first.
- **Retention**: job rows are never deleted. A receipt that a batch job
  references is kept at least 7 days after it was issued; after that the
  existing receipt cleanup approach applies.
- **Visibility:** every `internal` staff member can see every batch and
  its results (not only the staff member who started it).
- **Turning a result into a URL intake** uses a new, separate RPC
  (working name `create_url_intake_from_batch_job`), never
  `create_url_intake_from_receipt`. Only on this path, the checks below
  take the place of BE-19's actor check and ten-minute expiry:
  - the job belongs to a batch and has status `succeeded`;
  - its receipt exists and is not consumed; the receipt's
    `canonical_source_url` equals the job's;
  - `analysis_result_hash` is recomputed with exactly the original
    receipt's inputs — the receipt's own `actor_user_id` (the starter),
    `canonical_source_url`, `restaurant_match_type`,
    `matched_restaurant_id` and `candidate_summary` — using the existing
    canonicalisation of `src/lib/urlIntakeReceiptHash.js`, and must
    match. The account that redeems the result is never part of the
    hash;
  - the result is at most 7 days old, measured from the receipt's
    `created_at` (which is never updated);
  - the acting account is an `internal` staff member, recorded as the
    actor of the new `url_intakes` row; it may differ from the staff
    member who started the batch;
  - the receipt is consumed in the same transaction;
  - the new `url_intakes` row records the originating job (an additive
    column in 0016, e.g. `issued_via_job_id`).
- The BE-19 flow (single URL, ten-minute, actor-bound receipt) and
  `create_url_intake_from_receipt` stay unchanged, for every caller.

## Processing, duplicates and idempotency (input for 0016 and fase 2)

- **Claim scope.** `claim_next_source_analysis_job` takes a `batch_id`
  and the session's actor, and only claims jobs of that batch whose
  starter is that actor. Only the starter, from the open batch page, can
  process a batch; other `internal` staff can view it but never process
  it (the process route refuses them).
- **Active.** A job is active only while it is `running` with a valid
  lease. "One active job overall" and "one active job per host" count
  only these. A `pending` job is not globally active: it stays visible
  in its own batch and is resumed when its starter reopens the page.
- **Expired lease.** A `running` job whose lease has expired is
  recovered by the claim under the existing attempt and backoff rules:
  if attempts remain, it returns to `pending` with `attempt_count` + 1
  and `next_attempt_at` per the backoff; on the last attempt it becomes
  `failed` (`internal_error`).
- **Duplicates in 0016.** 0016 adds only the batch-scoped unique index
  on (`batch_id`, `canonical_source_url`), which prevents duplicates
  inside one batch. It adds no wider index on the URL, so the existing
  single-URL route (which inserts a `pending` job) can never fail on a
  database conflict caused by a batch.
- **Duplicates across batches.** Enqueue checks for an open job
  (`pending` or `running`) for the same URL in another batch and does
  not queue it; it is reported per URL as "Deze URL staat al in een
  actieve analysebatch." A wider, database-enforced block on active URLs
  may only be added once the single-URL route (fase 2) uses the same
  shared enqueue and duplicate handling, so existing behaviour never
  fails silently on a constraint.
- **Idempotency.** The page generates one batch UUID per click of
  "Analyse starten", kept only in memory for that submission, and sends
  it as the batch `id`. Enqueue with an `id` that already exists for the
  same actor returns that batch unchanged; for another actor it is
  refused. A repeated submission therefore creates the batch, its jobs
  and its daily-limit usage exactly once.

## Where results go (B5)

| Result | Batch history | Brontriage | Next step offered |
|---|---|---|---|
| Known restaurant (host matches `data/restaurants.json`), menu found | yes | yes, as "Uit batchanalyse" with the result | "Naar Brontriage" (a human makes any proposal) |
| Known restaurant, menu candidate found but structure not recognised | yes | yes | "Naar Brontriage" |
| Known restaurant, found source differs from the known website | yes | yes | "Naar Brontriage" |
| Unknown restaurant, any successful result | yes | no | "Naar Onboarding Restaurant" (new intake) |
| Geen bruikbare menukaart gevonden | yes | no | "Opnieuw analyseren" |
| Toegang beperkt, Ongeldige URL, Fout (after the last attempt) | yes | no | "Opnieuw proberen" where allowed |

- Brontriage only *shows* batch results for known restaurants. It never
  creates, accepts or rejects a proposal by itself.
- An existing restaurant without a source check is never a new intake
  (design-reference, "Existing restaurants without a source check are
  not a new intake"): its batch result goes to Brontriage, never to
  "Nieuwe aanleveringen".
- BE-23's Bronwerkvoorraad keeps reading all attributable jobs,
  including batch jobs, unchanged.

## Status vocabulary and copy (v1)

Fixed copy:

- Button: "Analyse starten".
- Statuses: "In wachtrij", "Bezig".
- Page notice, always visible while a batch has open jobs: "Houd dit
  scherm open. Sluit je het, dan pauzeert de analyse en gaat hij verder
  zodra je terugkomt."
- "Niets wordt automatisch gepubliceerd."
- Reason for a URL that already has an open job in another batch: "Deze
  URL staat al in een actieve analysebatch."

Statuses per URL, derived from the job (no new status values in the
database), always icon plus text with a Kleurtaal v2 status role:

| Shown | Derived from |
|---|---|
| In wachtrij | `pending` (with a future `next_attempt_at`: "Nieuwe poging om {tijd}") |
| Bezig | `running` with a valid lease |
| Menukaart gevonden · controle nodig | `succeeded`, menu items recognised (BE-23 "Klaar voor review") |
| Controle nodig | `succeeded`, a menu candidate without a recognised structure |
| Geen bruikbare menukaart gevonden | `succeeded` without a menu candidate, or `no_reliable_content_found` |
| Recent geanalyseerd | an existing result of at most 7 days, not fetched again |
| Toegang beperkt | `robots_disallowed` |
| Ongeldige URL | rejected by validation, or `unsafe_url` |
| Fout | any other terminal failure after the last attempt |

"Menukaart gevonden" is never shown without "controle nodig": a found
menu is a reviewable result, not an accepted one.

**Copy that v1 must not use:** "Je kunt dit scherm gerust verlaten" (or
any wording that says the analysis continues after the page is closed).
It may only be used once background processing (fase 3) has been
decided in a separate infrastructure decision and built. "Bronnen die we
met zekerheid kunnen verwerken, worden niet getoond" is never used: B5
keeps every result visible.

## Visual references

Two concept boards from the product owner (a desktop and a mobile
version of "Bron toevoegen", "Analyse bezig" and "Controle nodig") are
directional only. They are **not stored or indexed under
`docs/mockups/`**: the files live outside the repository, they show
realistic business names, addresses and phone numbers that should not be
published in this public repository, and they contain copy that v1
forbids. Where they differ from this ticket, this ticket and
`docs/guides/design-reference.md` win.

Taken over as direction: the paste field with one URL per line, the
pre-check of duplicates, the overall progress bar, one card per URL and
the result cards with "Naar Brontriage". Not taken over: "Je kunt dit
scherm gerust verlaten" (fase 3 only), "Alleen resultaten met twijfel
komen in de werkvoorraad" and "Bronnen die we met zekerheid kunnen
verwerken, worden niet getoond" (B5), serif type, the green-grey "Gereed"
chip, and the four sub-steps per URL (a fase 3 option; v1 shows one
status per URL).

## Release sequence

Each phase is its own release; a phase starts only after the previous
one is merged (and, for fase 1, verified live).

- **Fase 0 — decisions and documentation** (this ticket and the
  `url-intake-schema.md` amendment). No code.
- **Fase 1 — migration `0016` and its database release.** Additive to
  `restaurant_source_analysis_jobs` and `url_intakes`:
  - `lease_expires_at`, `next_attempt_at` and a normalised `source_host`
    on jobs;
  - a unique index on (`batch_id`, `canonical_source_url`) only — no
    wider index on the URL (see "Processing, duplicates and
    idempotency");
  - `issued_via_job_id` on `url_intakes`;
  - RPCs, `security invoker`, fixed `search_path`, `service_role` only:
    enqueue a batch (atomic, idempotent on the client-generated batch
    `id` per actor, enforcing the B4 limits and the cross-batch
    duplicate check), `claim_next_source_analysis_job` (scoped to one
    `batch_id` and its starter, `FOR UPDATE SKIP LOCKED`, one active job
    overall, one per host, 60 s per host, `next_attempt_at`, recovery of
    expired leases), complete and fail a job (backoff 2/10/30 min within
    the attempt limit), and `create_url_intake_from_batch_job` (B2);
  - privileges per the 0015 pattern: explicit revokes from `public`,
    `anon` and `authenticated`, minimal `service_role` grants, column-
    scoped update grants that include the new columns.
  Released through the existing pipeline: preflight, approved migrate,
  second preflight, live privilege check, recorded in
  `planning/CONTEXT.md`.
- **Fase 2 — server routes, page and tests.** The single-URL pipeline is
  moved into one shared server library used by the existing route
  (unchanged behaviour) and the processor. Internal-only routes: create
  a batch, read a batch, process the next job (exactly one per call,
  within the function time limit), retry one URL, and turn a batch
  result into a URL intake. One internal page under Werkvoorraad; the
  starter's open batch page drives processing (B3). Brontriage shows batch
  results for known restaurants (B5). A wider, database-enforced block on
  active URLs is only allowed once the single-URL route uses the shared
  enqueue and duplicate handling, in its own migration.
- **Fase 3 — optional background worker.** Only after a separate
  infrastructure decision (for example Vercel Cron or `pg_cron`, after
  verifying plan and extension limits). Only then may copy say that the
  screen can be closed.

## Non-goals

AI/OCR or any vendor call; browser rendering; CSV upload; more than 10
URLs per action; any crawl or target discovery beyond BE-20; automatic
publication; automatic Brontriage proposals or decisions; owner or
editor access to batches; counts in the navigation; changes to the BE-19
receipt flow.

## Acceptance criteria

Fase 0:

- [ ] B1–B5 and the derived rules are recorded with date and sources.
- [ ] `url-intake-schema.md` carries the BE-25 amendment; nothing else in
      the governance exception changes.

Fase 1:

- [ ] `0016` adds only the columns, indexes and RPCs listed above, with
      the 0015 privilege pattern; its structural tests pin the exact
      grants and revokes.
- [ ] The claim RPC only claims jobs of the given batch for its
      starter, and never hands out a second active job, a second job
      for the same host, or a host within 60 seconds of its last
      analysis; an expired lease is recovered under the attempt and
      backoff rules (tested in the validate-migrations replay).
- [ ] Enqueue rejects more than 10 URLs per batch and more than 25 per
      staff member per day; a repeated batch `id` from the same actor
      returns the same batch without new jobs or limit usage, and from
      another actor is refused.
- [ ] 0016 adds no constraint that can make the existing single-URL
      route fail.
- [ ] `create_url_intake_from_batch_job` enforces every B2 check,
      including the hash over the original receipt inputs only;
      `create_url_intake_from_receipt` is unchanged.

Fase 2:

- [ ] Every route refuses a missing session, `editor` or `owner` with
      401/403 and no database call.
- [ ] Invalid, duplicate and recently analysed URLs are handled before
      enqueue, with a reason per URL.
- [ ] One click creates one batch with one job per accepted URL; a
      double click creates nothing extra.
- [ ] Statuses are derived as in "Status vocabulary and copy", icon plus
      text; the fixed copy is used verbatim; no copy says the screen may
      be closed.
- [ ] All fetching goes through the existing safe fetch layer; no AI/OCR
      call and no write to published data (structurally tested).
- [ ] Results go where "Where results go" says; Brontriage never acts on
      its own; "Geen bruikbare menukaart gevonden" offers "Opnieuw
      analyseren" and never claims absence.
- [ ] Kleurtaal v2 tokens, light and dark, visible focus, keyboard, AA
      contrast and no overflow at 320, 390 and 1280 px are verified.
- [ ] No new dependency; `0016` is live before the fase 2 PR is merged.

## Open points (not blocking fase 1)

- The exact page location and navigation label (inside Brontriage or a
  separate Werkvoorraad entry).
- Whether the existing single-URL status endpoint should also become
  visible to all `internal` staff (B2 requires this only for batches).
- How a starter explicitly releases a `pending` job (and whether a
  long-paused batch job ever expires by itself) without a new job status
  value; to settle in the 0016 design review. Until then a URL with an
  open job elsewhere shows "Deze URL staat al in een actieve
  analysebatch."
- Passing `Retry-After` from `safeOutboundFetch` into the backoff
  (optional refinement; the fixed 2/10/30 min applies without it).

## Time estimate (decision 015)

Fase 0: one documentation session. Fase 1: medium (migration, RPCs,
structural tests, pipeline release). Fase 2: large (library extraction,
five routes, page, Brontriage integration, browser check). Estimate and
report each work block before starting it.
