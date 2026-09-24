-- BE-20 (fase 1) — the minimal durable analysis-job contract described in
-- planning/specs/tickets/be-20-general-restaurant-source-extraction.md's
-- own "Minimal durable analysis-job contract" section.
--
-- NOT YET APPLIED. Written and reviewed locally only, in an isolated
-- worktree — no disposable local Postgres instance was available in this
-- environment to validate it against, so this migration has been checked
-- statically only (careful, deliberate line-by-line comparison against
-- 0013_be19_url_intakes.sql's own already-applied, proven conventions for
-- every clause below — table/constraint naming, RLS posture, and the
-- revoke-all-then-grant-exact grant discipline). It must be run in the
-- Supabase SQL Editor, after 0001-0013, only as a separate, later,
-- explicitly-approved step — never applied here, never against any
-- external or production database.
--
-- 0001-0013 are never edited by this migration — not their tables, not
-- their constraints, not their grants, not even their comments. This
-- migration only ever ADDS to what they already established, per this
-- project's own "extends never replaces" discipline
-- (be-20-general-restaurant-source-extraction.md's own "Depends on"
-- section, describing BE-19's own tables/RPCs the exact same way).
--
-- A job precedes a receipt: a receipt (url_intake_analysis_receipts,
-- 0013, unchanged by this migration) is only ever issued once a job's
-- analysis has actually succeeded — this table exists so a reviewer's
-- browser can poll a job's status without depending on one long
-- synchronous request/response cycle, per the ticket's own "Analysis runs
-- durably outside the browser request" decision. No worker or queue
-- technology is introduced here — fase 1 processes a job inline, within
-- the same request that creates it; this table is the contract a future
-- background worker could attach to later, additively.

-- ── url_intake_batches ───────────────────────────────────────────────────
--
-- Batch-readiness only (be-20-general-restaurant-source-extraction.md's
-- own "Batch-readiness (not built in fase 1)" section) — no bulk-intake
-- UI is built by this migration or by anything that reads this table yet.
-- A batch is never a second scraper and never a distinct write path; it
-- exists only so `restaurant_source_analysis_jobs.batch_id` below has
-- something real to reference, proving the per-job contract accepts a
-- job created with or without a batch without a later breaking change.

create table if not exists url_intake_batches (
  id             uuid primary key,
  actor_user_id  uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

alter table url_intake_batches enable row level security;
revoke all on public.url_intake_batches from public, anon, authenticated;

grant usage on schema public to service_role;
revoke all on public.url_intake_batches from service_role;
-- select + insert only — a batch header row is never updated or deleted
-- once created, same posture url_intakes (0013) already takes for its own
-- audit-only rows.
grant select, insert on public.url_intake_batches to service_role;

-- ── restaurant_source_analysis_jobs ───────────────────────────────────────

create table if not exists restaurant_source_analysis_jobs (
  id                    uuid primary key,
  actor_user_id         uuid not null references auth.users(id),
  -- Same canonical shape url_intake_analysis_receipts/url_intakes (0013)
  -- already require — scheme, host, path only, no query string, no
  -- fragment.
  canonical_source_url  text not null check (
                          canonical_source_url ~* '^https?://'
                          and canonical_source_url !~ '[?#]'
                        ),
  status                text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  -- Set exactly once, only on a genuine 'succeeded' outcome — never
  -- guessed, never set speculatively. The independent biconditional below
  -- makes a partial, invalid state (e.g. 'succeeded' with no receipt, or
  -- a receipt attached to a non-'succeeded' job) a constraint violation
  -- rather than a silently-accepted row — the same lesson
  -- 0013's own "THREE INDEPENDENT BICONDITIONALS" comment already draws
  -- for restaurant_profile_draft_field_facts.origin, applied here to a
  -- single column's own single governing state instead of three
  -- mutually-exclusive origins.
  result_receipt_id     uuid references url_intake_analysis_receipts(id),
  -- The fixed, closed job-level error vocabulary
  -- be-20-general-restaurant-source-extraction.md's own "Minimal durable
  -- analysis-job contract" section names — never an internal error string
  -- surfaced to the reviewer.
  error_reason          text check (
                          error_reason is null or error_reason in (
                            'unsafe_url', 'robots_disallowed', 'unsupported_content_type',
                            'fetch_failed', 'pdf_extraction_failed', 'ai_structuring_failed',
                            'budget_exceeded', 'no_reliable_content_found', 'internal_error'
                          )
                        ),
  constraint restaurant_source_analysis_jobs_succeeded_has_receipt
    check ((status = 'succeeded') = (result_receipt_id is not null)),
  constraint restaurant_source_analysis_jobs_failed_has_error_reason
    check ((status = 'failed') = (error_reason is not null)),
  -- Bounded retries — a fixed maximum, never silent infinite retry (the
  -- ticket's own "Retries" bullet). 5 is a reasoned, generous-for-a-flaky-
  -- network-response default, not an empirically derived one — same
  -- posture src/lib/pdfTextExtraction.js's own DEFAULT_MAX_PAGES took for
  -- its own technical budget; an owner may tune it later without a schema
  -- change, since the ceiling lives in this one check, not scattered
  -- application logic.
  attempt_count         integer not null default 1 check (attempt_count >= 1 and attempt_count <= 5),
  -- Nullable, batch-ready from day one (see url_intake_batches above) —
  -- fase 1 never sets it, since no UI creates a batch yet.
  batch_id              uuid references url_intake_batches(id),
  -- This implementation's own additive design choice, not part of the
  -- ticket's own fixed "Minimal durable analysis-job contract" column
  -- list above: a per-field confidence/evidence snapshot (the shape
  -- src/lib/fieldConfidence.js/src/lib/restaurantFieldEvidence.js already
  -- produce) for the review UI to render "handmatige beoordeling nodig"
  -- against, once a job succeeds. Deliberately kept OFF
  -- url_intake_analysis_receipts.candidate_summary and off
  -- restaurant_profile_draft_field_facts — src/lib/urlIntakes.js's own
  -- buildCandidateSummary() docstring is explicit that its shape is fixed
  -- and read verbatim by create_url_intake_from_receipt()/
  -- promote_url_intake_to_profile_draft() (0013), so it is never widened
  -- here; this column is read only by this job's own status-poll response,
  -- never by either existing RPC. Null until 'succeeded'; never populated
  -- speculatively on a 'pending'/'running'/'failed' job.
  field_evidence        jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_restaurant_source_analysis_jobs_actor
  on restaurant_source_analysis_jobs (actor_user_id, created_at desc);

alter table restaurant_source_analysis_jobs enable row level security;
revoke all on public.restaurant_source_analysis_jobs from public, anon, authenticated;

revoke all on public.restaurant_source_analysis_jobs from service_role;
grant select, insert on public.restaurant_source_analysis_jobs to service_role;
-- Column-scoped: id/actor_user_id/canonical_source_url/batch_id/created_at
-- are set once at insert and never updated by any role — only the job's
-- own lifecycle columns move after creation.
grant update (status, result_receipt_id, error_reason, attempt_count, field_evidence, updated_at)
  on public.restaurant_source_analysis_jobs to service_role;
