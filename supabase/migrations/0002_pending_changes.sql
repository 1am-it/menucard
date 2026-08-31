-- PLATFORM-06 — Moderation/review queue.
--
-- Adds a *separate* staging table for proposed data changes. field_provenance
-- (0001_field_provenance.sql) remains exactly what it already was: the
-- current, approved value per field, nothing else. Pending/approved/rejected
-- state lives here instead, never mixed into field_provenance itself — see
-- the "Note on supabase/schema.sql"-style reasoning in
-- planning/decisions/010-platform-persistence-and-api.md for why this
-- project keeps concerns like this in separate tables rather than
-- overloading one.
--
-- Approving in this phase only updates the current field_provenance record.
-- It does not decide how an approved value ever reaches a consumer-facing
-- page — data/restaurants.json and data/menus.json are untouched, and that
-- consumption path remains the open question documented in
-- planning/decisions/010-platform-persistence-and-api.md.
--
-- Run this in the Supabase SQL Editor after 0001_field_provenance.sql.

-- ── pending_changes ──────────────────────────────────────────────────────
--
-- field_name/field_ref/proposed_value follow the exact same shape and
-- conventions as field_provenance's field_name/field_ref/value — including
-- field_ref defaulting to '' (never NULL), for the same reason: NULL is
-- distinct from itself in comparisons/constraints, which would complicate
-- matching a pending row to its current field_provenance counterpart.
--
-- Deliberately different from field_provenance: there is NO
-- unique(restaurant_id, field_name, field_ref) constraint here. That
-- uniqueness makes sense for field_provenance, which holds exactly one
-- *current* value per field. It would be wrong here — a field can
-- legitimately have a rejected proposal followed later by a new pending
-- one for the same (restaurant_id, field_name, field_ref), and rows are
-- never deleted (they double as this workflow's own audit trail, per the
-- ticket's explicit requirement not to erase provenance history on
-- approval). An index (not a uniqueness constraint) supports the queue
-- query instead.

create table if not exists pending_changes (
  id              bigint generated always as identity primary key,
  restaurant_id   text not null,
  field_name      text not null check (field_name in (
                    'price', 'openingHours', 'reservationMethod',
                    'itemAvailability', 'allergens'
                  )),
  field_ref       text not null default '',
  proposed_value  jsonb not null,
  proposed_source text not null check (proposed_source in (
                    'owner', 'community', 'editor', 'imported', 'unknown'
                  )),
  proposed_by     uuid references auth.users(id),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by      uuid references auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_pending_changes_queue
  on pending_changes (status, created_at);

create index if not exists idx_pending_changes_restaurant
  on pending_changes (restaurant_id, field_name, field_ref);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Defense-in-depth only, same posture as 0001_field_provenance.sql: the
-- internal API always calls Supabase as service_role, which bypasses RLS
-- (and, via the RPC below, is also the only role allowed to execute it).
-- Both owners AND internal are deliberately excluded from every policy
-- here — PLATFORM-06 gives *editors* a moderation queue. internal
-- represents automated/system writes, not a human trust decision, and has
-- no more business reading or seeding this queue than an owner does; this
-- matches app/api/internal/v1/moderation/*'s own isEditor() checks and
-- docs/api/internal-moderation-api.md exactly — RLS here should not be
-- looser than the API's actual authorization model.

alter table pending_changes enable row level security;

create policy "editors_can_select_pending" on pending_changes
  for select
  using (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'editor'
    )
  );

create policy "editors_can_insert_pending" on pending_changes
  for insert
  with check (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'editor'
    )
  );

create policy "editors_can_update_pending" on pending_changes
  for update
  using (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'editor'
    )
  );

-- No delete policy: rows are permanent, serving as this workflow's own
-- audit trail (see the table comment above).

grant select, insert, update on public.pending_changes to service_role;
grant usage, select on sequence public.pending_changes_id_seq to service_role;

-- ── approve_pending_change: atomic approve via RPC ───────────────────────
--
-- Writing the field_provenance upsert and flipping the pending_changes
-- status must not be two separate, independently-failable steps — a
-- shared JS helper can't participate in one database transaction across
-- two .from() calls, but a single function call can. This function does
-- both writes in one transaction: if either fails, both roll back.
--
-- SECURITY INVOKER (the default, kept explicit): this function is only
-- ever called by service_role (see the revoke/grant below), which already
-- holds direct GRANTs on both tables and BYPASSRLS — there is no need to
-- run this with elevated (SECURITY DEFINER) privileges, which would be an
-- unnecessary escalation footgun for what a same-privilege caller can
-- already do safely in one transaction.
--
-- search_path is fixed to prevent search_path-hijacking on this function
-- (a role that could alter search_path could otherwise redirect an
-- unqualified table reference to a different schema's like-named object).

create or replace function approve_pending_change(
  p_pending_id bigint,
  p_actor_user_id uuid
)
returns field_provenance
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pending pending_changes%rowtype;
  v_result field_provenance%rowtype;
begin
  select * into v_pending
  from pending_changes
  where id = p_pending_id and status = 'pending'
  for update;

  if not found then
    raise exception using
      message = 'Pending change not found or already decided',
      errcode = 'P0002';
  end if;

  insert into field_provenance (
    restaurant_id, field_name, field_ref, value,
    source, confidence, verified_at, verified_by, updated_at
  )
  values (
    v_pending.restaurant_id, v_pending.field_name, v_pending.field_ref, v_pending.proposed_value,
    'editor', 'high', now(), p_actor_user_id, now()
  )
  on conflict (restaurant_id, field_name, field_ref)
  do update set
    value = excluded.value,
    source = excluded.source,
    confidence = excluded.confidence,
    verified_at = excluded.verified_at,
    verified_by = excluded.verified_by,
    updated_at = excluded.updated_at
  returning * into v_result;

  update pending_changes
  set status = 'approved', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
  where id = p_pending_id;

  return v_result;
end;
$$;

-- New functions are EXECUTE-granted to PUBLIC by default in Postgres —
-- revoke that explicitly, then grant only to service_role, matching the
-- "server/service-role only" requirement.
revoke all on function approve_pending_change(bigint, uuid) from public;
grant execute on function approve_pending_change(bigint, uuid) to service_role;
