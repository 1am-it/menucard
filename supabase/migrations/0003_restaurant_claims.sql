-- PLATFORM-07 — Owner claim and identity verification.
--
-- Corrects an assumption made in 0001_field_provenance.sql and
-- docs/api/internal-provenance-api.md's Bootstrap section: role assignment
-- was documented as "always manual, never app-driven." That was true
-- through PLATFORM-06 and remains true for editor/internal roles — there
-- is still no self-service path for those. It is no longer true for
-- `owner`: an approved claim grants a staff_roles row automatically, via
-- the atomic RPC below, reviewed by a human editor first. See the GRANT on
-- staff_roles further down for the specific, narrow privilege this needs.
--
-- Run this in the Supabase SQL Editor after 0001_field_provenance.sql and
-- 0002_pending_changes.sql.

-- ── restaurant_claims ────────────────────────────────────────────────────
--
-- domain_match is advisory evidence only (does the claimant's verified
-- session email domain match the restaurant's website domain, both
-- normalized to lowercase with a leading "www." stripped) — never an
-- automatic gate. Every claim, matched or not, goes through editor review.

create table if not exists restaurant_claims (
  id            bigint generated always as identity primary key,
  restaurant_id text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  claim_email   text not null,
  domain_match  boolean not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Only one *pending* claim per (restaurant, claimant) — blocks accidental
-- duplicate submissions from the same person without blocking a fresh
-- attempt after a prior claim was rejected, and without blocking a
-- *different* claimant from also filing a pending claim on the same
-- restaurant (those are deliberately left visible side by side for an
-- editor to resolve explicitly — see app/api/internal/v1/claims/pending).
create unique index if not exists idx_restaurant_claims_one_pending_per_user
  on restaurant_claims (restaurant_id, user_id)
  where status = 'pending';

create index if not exists idx_restaurant_claims_queue
  on restaurant_claims (status, created_at);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Defense-in-depth only, same posture as 0001/0002: the internal API and
-- /api/claims/* both call Supabase as service_role, which bypasses RLS.
-- `internal` is deliberately excluded from every policy here (matching
-- PLATFORM-06's corrected posture) — only `editor` reviews claims, and
-- only the claimant themselves can see or create their own.

alter table restaurant_claims enable row level security;

create policy "self_or_editor_can_select_claims" on restaurant_claims
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid() and sr.role = 'editor'
    )
  );

create policy "self_can_insert_own_claim" on restaurant_claims
  for insert
  with check (auth.uid() = user_id);

create policy "editors_can_update_claims" on restaurant_claims
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

-- No delete policy: decided claims are kept, same reasoning as
-- pending_changes (0002) — a permanent record of who claimed what and how
-- it was decided.

grant select, insert, update on public.restaurant_claims to service_role;
grant usage, select on sequence public.restaurant_claims_id_seq to service_role;

-- The one deliberate, narrow exception to "staff_roles is manual-only":
-- approve_restaurant_claim needs to INSERT the resulting owner row.
-- Nothing else changes — there is still no endpoint that lets anyone
-- insert into staff_roles directly; only this specific, reviewed,
-- atomic function can, and only for role = 'owner'.
grant insert on public.staff_roles to service_role;

-- ── approve_restaurant_claim: atomic approve via RPC ─────────────────────
--
-- Same reasoning as approve_pending_change (0002_pending_changes.sql):
-- granting the owner role and flipping the claim to approved must succeed
-- or fail together, not as two independently-failable steps. SECURITY
-- INVOKER (the default, kept explicit) and a fixed search_path for the
-- same reasons documented there. EXECUTE is revoked from PUBLIC and
-- granted only to service_role.

create or replace function approve_restaurant_claim(
  p_claim_id bigint,
  p_actor_user_id uuid
)
returns restaurant_claims
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claim restaurant_claims%rowtype;
begin
  select * into v_claim
  from restaurant_claims
  where id = p_claim_id and status = 'pending'
  for update;

  if not found then
    raise exception using
      message = 'Claim not found or already decided',
      errcode = 'P0002';
  end if;

  insert into staff_roles (user_id, role, restaurant_id)
  values (v_claim.user_id, 'owner', v_claim.restaurant_id)
  on conflict (user_id, role, restaurant_id) do nothing;

  update restaurant_claims
  set status = 'approved', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
  where id = p_claim_id
  returning * into v_claim;

  return v_claim;
end;
$$;

revoke all on function approve_restaurant_claim(bigint, uuid) from public;
grant execute on function approve_restaurant_claim(bigint, uuid) to service_role;
