-- MARKET-05A — Internal candidate enrichment audit log.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0007, as a separate, later,
-- explicitly-approved step.
--
-- Adds a *separate*, append-only audit log of manually-sourced
-- corrections/additions to a raw `import_extraction_records` row's
-- `address`/`phone`/`website` fields — the raw record itself is never
-- modified by this migration or by anything that reads/writes this new
-- table, exactly like 0007_market05a_candidate_reviews.sql's own
-- `import_candidate_reviews` table. A mistake is corrected by recording
-- a *new* enrichment row for the same (candidate, field); this table
-- never has an update or delete grant, for any role, ever. The
-- "currently displayed" value for a field is derived (in application
-- code, src/lib/importInbox.js's computeEnrichedFields) from whichever
-- row has the latest `recorded_at` for that (candidate_id, field_name)
-- pair — never a mutable "current value" column here or anywhere else.
--
-- Access model: `internal`-only, identical to
-- import_candidate_reviews and the rest of MARKET-05A's Data-inbox
-- (docs/api/import-inbox-api.md) — not `editor`, not `owner`.
--
-- Manual only: this table has no relationship whatsoever to
-- `import_candidate_reviews.note` (free text) — nothing here, nor
-- anything in src/lib/importInbox.js or the API routes that use it,
-- ever reads, parses, or derives a row here from a review's note. A
-- reviewer who previously typed a phone number, address, or URL into a
-- review note must deliberately re-enter it through this feature's own
-- form — see market-05-normalization-deduplication.md's own
-- "Enrichment vs. review notes" section for the full reasoning and a
-- concrete named example.
--
-- Recording an enrichment never sets `import_candidate_reviews.status`
-- to `approved_internal` or anything else — the two tables, and the two
-- actions a reviewer takes, are entirely independent; see the same
-- ticket section.

-- ── import_candidate_enrichments ─────────────────────────────────────────
--
-- One row per enrichment **fact** (one field, one value, one source),
-- never one row per candidate and never one row covering multiple
-- fields — `record_candidate_enrichments()` below may insert several
-- rows in a single call (one per field a reviewer filled in on one
-- form submission), but each row remains independently meaningful and
-- independently correctable.

create table if not exists import_candidate_enrichments (
  id           bigint generated always as identity primary key,
  candidate_id uuid not null references import_extraction_records(id),
  reviewer_id  uuid not null references auth.users(id),
  -- Fixed set — the only fields this feature is scoped to enrich. Never
  -- `name`/`category`/`location`/anything else; extending this list is a
  -- separate, later, deliberate decision, not a silent default.
  field_name   text not null check (field_name in ('address', 'phone', 'website')),
  value        text not null check (length(btrim(value)) > 0),
  -- Required on every row — an enrichment with no verifiable source is
  -- never permitted to exist at all, unlike review notes (which stay
  -- optional). A simple http(s) scheme check, defense-in-depth alongside
  -- the same check in src/lib/importInbox.js's isValidHttpUrl.
  source_url   text not null check (source_url ~* '^https?://'),
  recorded_at  timestamptz not null default now()
);

-- Supports "every enrichment for this candidate's field, newest first" —
-- the exact access pattern computeEnrichedFields needs, and matches
-- 0007's own idx_import_candidate_reviews_candidate index shape.
create index if not exists idx_import_candidate_enrichments_candidate_field
  on import_candidate_enrichments (candidate_id, field_name, recorded_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Identical posture to 0007_market05a_candidate_reviews.sql: the
-- internal API always calls Supabase as service_role (bypasses RLS) —
-- these policies are defense-in-depth. Zero policies for
-- owner/editor/anon/public.

alter table import_candidate_enrichments enable row level security;

revoke all on public.import_candidate_enrichments from public, anon, authenticated;

-- Append-only: select + insert only, to service_role — no update, no
-- delete grant at all, ever, for any role, physically enforced
-- regardless of any future application-code bug.
grant select, insert on public.import_candidate_enrichments to service_role;
grant usage, select on sequence public.import_candidate_enrichments_id_seq to service_role;

-- ── record_candidate_enrichments: the only way to write an enrichment ───
--
-- Accepts a JSON array of `{field_name, value, source_url}` objects — one
-- reviewer form submission may cover one or more fields, all recorded
-- together, atomically (one transaction: either every row is inserted,
-- or none is, per Postgres's own function-body transaction semantics —
-- never a partial submission silently leaving some fields recorded and
-- others not). Mirrors 0002_pending_changes.sql's/0007's own RPC
-- pattern: validates the candidate exists first, for a clear, typed
-- error instead of a raw foreign-key violation. SECURITY INVOKER (the
-- default, kept explicit) for the same reason as the other two RPCs in
-- this project: only ever called by service_role, which already holds
-- direct grants and BYPASSRLS. search_path is fixed to prevent
-- search_path-hijacking.
--
-- Deliberately does not validate `p_fields`' internal shape beyond
-- "a non-empty JSON array" — the table's own check constraints
-- (field_name/value/source_url) are the real, final authority and fire
-- per inserted row regardless of what this function does or does not
-- pre-check; the application layer (src/lib/importInbox.js's
-- validateEnrichmentRequestInput) is what gives a caller a clear `400`
-- before ever reaching this function.

create or replace function record_candidate_enrichments(
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_fields jsonb
)
returns setof import_candidate_enrichments
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from import_extraction_records where id = p_candidate_id) then
    raise exception using
      message = 'Candidate not found',
      errcode = 'P0002';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) = 0 then
    raise exception using
      message = 'At least one field is required',
      errcode = 'P0003';
  end if;

  return query
    insert into import_candidate_enrichments (candidate_id, reviewer_id, field_name, value, source_url)
    select
      p_candidate_id,
      p_actor_user_id,
      elem ->> 'field_name',
      elem ->> 'value',
      elem ->> 'source_url'
    from jsonb_array_elements(p_fields) as elem
    returning *;
end;
$$;

revoke all on function record_candidate_enrichments(uuid, uuid, jsonb) from public;
grant execute on function record_candidate_enrichments(uuid, uuid, jsonb) to service_role;
