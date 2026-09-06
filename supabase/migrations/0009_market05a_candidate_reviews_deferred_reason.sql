-- MARKET-05A — Structured `deferred_reason` on import_candidate_reviews.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0008, as a separate, later,
-- explicitly-approved step. `import_candidate_reviews` itself was
-- applied live on 2026-09-05 and already holds real rows (10, as of
-- this writing — see planning/CONTEXT.md's own "Correction (2026-09-05,
-- later still the same day)" note) — this migration is additive only
-- and never touches those rows.
--
-- Problem: a `deferred` decision previously carried no structured
-- reason at all — only the free-text `note` — making deferred
-- candidates impossible to triage or filter in bulk ("why was this one
-- deferred?" required reading every note by hand). Fix: a nullable
-- `deferred_reason` column, fixed-set just like `rejection_reason`, with
-- the same symmetric "required exactly when this status" rule — but see
-- the `NOT VALID` note below for why that rule cannot be validated
-- against rows that already exist.
--
-- Append-only, unchanged: this migration ADDs a column and a check
-- constraint; it never updates or deletes a single existing row, and it
-- grants no new privilege to any role (the table's existing
-- `select, insert`-only grant to `service_role`, with no update/delete
-- grant at all, already covers this new column automatically — a wider
-- table grant needs no separate per-column grant in Postgres).

-- ── import_candidate_reviews.deferred_reason ─────────────────────────────

alter table import_candidate_reviews
  add column if not exists deferred_reason text;

-- Fixed set only — never free text. This check is safe to validate
-- immediately against every existing row: a newly added column always
-- starts out NULL on every pre-existing row, and NULL always satisfies
-- "deferred_reason is null or ...".
alter table import_candidate_reviews
  add constraint import_candidate_reviews_deferred_reason_values
  check (deferred_reason is null or deferred_reason in (
    'service_model_unclear',
    'chain_or_franchise_review',
    'ownership_or_permission_needed',
    'source_conflict',
    'verify_later'
  ));

-- Required exactly when status = 'deferred', forbidden otherwise — the
-- same symmetric shape as this table's own existing
-- `(status = 'rejected') = (rejection_reason is not null)` check.
--
-- Added as NOT VALID deliberately: this table already holds real,
-- live `deferred` rows recorded before this column existed, which have
-- deferred_reason = NULL. A normally-validated constraint would fail
-- immediately at migration time against exactly those rows. NOT VALID
-- skips that one-time backfill scan — existing rows are never touched,
-- inspected for compliance, or backfilled with a guessed reason, and
-- remain fully readable exactly as recorded — while still being fully
-- enforced against every future insert (Postgres validates NOT VALID
-- CHECK constraints against all new/updated rows regardless of the
-- NOT VALID flag; only the initial scan of pre-existing rows is
-- skipped). Since this table is append-only (no update grant exists,
-- see 0007's own grants below), no update trigger will ever run against
-- an old row that could re-surface this — old deferred rows without a
-- reason stay exactly as they are, indefinitely, by design, not as a
-- temporary gap to later backfill.
alter table import_candidate_reviews
  add constraint import_candidate_reviews_deferred_reason_required
  check ((status = 'deferred') = (deferred_reason is not null)) not valid;

-- ── record_import_candidate_review: extended, not replaced-in-place ─────
--
-- CREATE OR REPLACE FUNCTION cannot change an existing function's
-- argument list in place — a different parameter list is, to Postgres,
-- a different function (a new overload), which would leave the old
-- 5-argument version callable side by side with the new one. The old
-- version must be dropped explicitly first so exactly one overload of
-- this name ever exists — never two, which could otherwise make a
-- named-parameter RPC call ambiguous.

drop function if exists record_import_candidate_review(uuid, uuid, text, text, text);

create or replace function record_import_candidate_review(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_rejection_reason text default null,
  p_note text default null,
  p_deferred_reason text default null
)
returns import_candidate_reviews
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result import_candidate_reviews%rowtype;
begin
  if not exists (select 1 from import_extraction_records where id = p_candidate_id) then
    raise exception using
      message = 'Candidate not found',
      errcode = 'P0002';
  end if;

  insert into import_candidate_reviews (
    candidate_id, reviewer_id, status, rejection_reason, note, deferred_reason
  )
  values (
    p_candidate_id, p_actor_user_id, p_status, p_rejection_reason, p_note, p_deferred_reason
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function record_import_candidate_review(uuid, uuid, text, text, text, text) from public;
grant execute on function record_import_candidate_review(uuid, uuid, text, text, text, text) to service_role;
