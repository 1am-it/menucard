-- MARKET-05A — Internal candidate review audit log.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0006, as a separate, later,
-- explicitly-approved step.
--
-- Adds a *separate*, append-only decision log for
-- import_extraction_records (MARKET-04A) — the raw records themselves
-- are never modified by this migration or by anything that reads/writes
-- this new table. Mirrors 0002_pending_changes.sql's "keep decision
-- state in its own table" reasoning, but stricter: pending_changes is
-- mutated in place on approval (status/decided_by/decided_at updated on
-- the same row); this table is never updated or deleted at all — every
-- review decision is a brand-new row. The "current effective status" for
-- a candidate is derived (in application code, src/lib/importInbox.js's
-- computeEffectiveReviewStatus) from whichever row has the latest
-- decided_at for that candidate_id — never a mutable "current status"
-- column on the candidate or on this table.
--
-- Access model: `internal`-only, same as the rest of MARKET-05A's
-- Data-inbox (docs/api/import-inbox-api.md) — not `editor` (editors are
-- restaurant-scoped in this app's existing model; import candidates are
-- platform-wide and entirely unreviewed), not `owner`.
--
-- `approved_internal` means exactly what its name says: ready for
-- internal enrichment only. It is never a public-publication or
-- MenuCard-creation signal — nothing in this migration, the RPC below,
-- or the API routes that call it ever writes to a canonical or public
-- table. There is no such table for this data to write to yet in this
-- project (see planning/specs/tickets/market-04-raw-imports-import-runs.md
-- and docs/api/import-inbox-api.md for the current, static-file-based
-- consumer data path, entirely untouched by this migration).

-- ── import_candidate_reviews ─────────────────────────────────────────────
--
-- One row per review decision — never one row per candidate. `status`
-- deliberately does NOT include 'new': 'new' is a pure application-level
-- default (src/lib/importInbox.js's DEFAULT_REVIEW_STATUS), meaning "no
-- review row exists yet for this candidate" — it is never itself stored,
-- since storing it would be indistinguishable in meaning from storing
-- nothing at all, and would need special-casing everywhere "latest row
-- wins" logic runs.

create table if not exists import_candidate_reviews (
  id                bigint generated always as identity primary key,
  candidate_id      uuid not null references import_extraction_records(id),
  reviewer_id       uuid not null references auth.users(id),
  decided_at        timestamptz not null default now(),
  status            text not null check (status in (
                      'needs_enrichment', 'approved_internal', 'rejected', 'deferred'
                    )),
  -- Fixed set only — never free text. Required exactly when status is
  -- 'rejected', and forbidden otherwise (both directions enforced by the
  -- symmetric check below), so a reviewer can never leave a rejection
  -- unexplained or attach a reason to a non-rejection by mistake.
  rejection_reason  text check (rejection_reason is null or rejection_reason in (
                      'not_a_restaurant', 'duplicate', 'permanently_closed', 'insufficient_data', 'other'
                    )),
  -- Optional, free-text, human-readable context — bounded, defense in
  -- depth alongside the same limit enforced in
  -- src/lib/importInbox.js's MAX_REVIEW_NOTE_LENGTH.
  note              text check (note is null or char_length(note) <= 2000),
  check ((status = 'rejected') = (rejection_reason is not null))
);

-- Supports "every review row for this candidate, newest first" — the
-- exact access pattern both the effective-status computation and the
-- per-candidate review-history API route need.
create index if not exists idx_import_candidate_reviews_candidate
  on import_candidate_reviews (candidate_id, decided_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Same posture as 0004_market04a_import_foundation.sql's six tables: the
-- internal API always calls Supabase as service_role (which bypasses
-- RLS) — these policies are defense-in-depth, not the primary gate. Zero
-- policies for owner/editor/anon/public, matching this table's
-- internal-only access model exactly (see docs/api/import-inbox-api.md's
-- "Access control" section) — an editor or owner session must get
-- exactly the same "denied" result here as on import_extraction_records
-- itself.

alter table import_candidate_reviews enable row level security;

revoke all on public.import_candidate_reviews from public, anon, authenticated;

-- Append-only: select + insert only, granted to service_role — no
-- update, no delete grant at all, ever, physically enforced regardless
-- of any future application-code bug. This is the real enforcement of
-- "review decisions are never edited or removed"; the application layer
-- (this table's RPC below, and the API routes that call it) never even
-- attempts an update/delete, but this grant means it could not succeed
-- even if it tried.
grant select, insert on public.import_candidate_reviews to service_role;
grant usage, select on sequence public.import_candidate_reviews_id_seq to service_role;

-- ── record_import_candidate_review: the only way to write a review ──────
--
-- Single-purpose RPC, mirroring 0002_pending_changes.sql's
-- approve_pending_change() pattern: validates the candidate exists (a
-- clear, typed error instead of a raw foreign-key-violation message),
-- then performs exactly one insert — no update, no delete, nothing else.
-- SECURITY INVOKER (the default, kept explicit) for the same reason as
-- approve_pending_change: only ever called by service_role, which
-- already holds direct grants and BYPASSRLS — no privilege escalation is
-- needed or wanted here. search_path is fixed to prevent
-- search_path-hijacking.
--
-- Deliberately does not accept 'new' as p_status — the table's own check
-- constraint above already excludes it, so passing it here would fail
-- with a constraint violation rather than a friendlier error; documented
-- here so that failure mode is not a surprise.

create or replace function record_import_candidate_review(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_rejection_reason text default null,
  p_note text default null
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
    candidate_id, reviewer_id, status, rejection_reason, note
  )
  values (
    p_candidate_id, p_actor_user_id, p_status, p_rejection_reason, p_note
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function record_import_candidate_review(uuid, uuid, text, text, text) from public;
grant execute on function record_import_candidate_review(uuid, uuid, text, text, text) to service_role;
