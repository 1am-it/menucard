-- PLATFORM-05 — Internal provenance layer.
--
-- This is intentionally narrow: it does NOT migrate data/restaurants.json
-- or data/menus.json (see planning/decisions/010-platform-persistence-and-api.md).
-- It has nothing to do with the older, unrelated ../schema.sql, which
-- predates the PLATFORM-* track and models a full alternative backend for
-- the entire consumer dataset — that file is not the current direction and
-- is not used by this migration. See the "Note on supabase/schema.sql"
-- addendum in decision 010 for why both files exist in this directory.
--
-- Run this in the Supabase SQL Editor (Database → SQL Editor → New query)
-- after creating your project.

-- ── field_provenance ─────────────────────────────────────────────────────
--
-- One row per (restaurant, field, field_ref) — the *current* provenance
-- record for a trust-bearing field, per docs/api/data-trust-model.md.
-- field_ref identifies a specific item for item-level fields (e.g. a menu
-- item key) and is '' (not NULL) for restaurant-level fields, so the
-- uniqueness constraint below behaves predictably — Postgres treats NULL
-- as distinct in UNIQUE constraints, which would silently break the
-- "one current record per field" invariant this table depends on.
--
-- This table holds current provenance, not a full audit history. A
-- separate history/audit log is a possible future extension, not built
-- here — created_at/updated_at are enough to know when the current record
-- was first written and last changed.

create table if not exists field_provenance (
  id            bigint generated always as identity primary key,
  restaurant_id text not null,
  field_name    text not null check (field_name in (
                  'price', 'openingHours', 'reservationMethod',
                  'itemAvailability', 'allergens'
                )),
  field_ref     text not null default '',
  value         jsonb not null,
  source        text not null check (source in (
                  'owner', 'community', 'editor', 'imported', 'unknown'
                )),
  confidence    text not null check (confidence in ('high', 'medium', 'low')),
  verified_at   timestamptz,
  verified_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, field_name, field_ref)
);

create index if not exists idx_field_provenance_restaurant
  on field_provenance (restaurant_id, field_name);

-- ── staff_roles ──────────────────────────────────────────────────────────
--
-- The only place roles are assigned. No UI writes to this table yet — the
-- first row(s) are inserted manually here in the SQL Editor after the
-- corresponding person signs up via Supabase Auth. See
-- docs/api/internal-provenance-api.md for the exact bootstrap steps.

create table if not exists staff_roles (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('editor', 'owner', 'internal')),
  restaurant_id text,
  created_at    timestamptz not null default now(),
  check (role <> 'owner' or restaurant_id is not null),
  unique (user_id, role, restaurant_id)
);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Defense-in-depth only. The internal API (app/api/internal/v1/provenance)
-- always calls Supabase using the service-role key, which bypasses RLS
-- entirely by design — these policies protect against the scenario where a
-- non-service key is ever mistakenly used, not the primary access-control
-- mechanism (that's src/lib/internalAuth.js, checked in application code).

alter table field_provenance enable row level security;
alter table staff_roles      enable row level security;

-- staff_roles: deliberately no policies for anon/authenticated roles at
-- all. With RLS enabled and zero grants, only the service role (which
-- bypasses RLS) can read or write this table — exactly matching "role
-- assignment is manual, server-side bootstrap work, never app-driven."

create policy "staff_can_select_scoped_provenance" on field_provenance
  for select
  using (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid()
        and (
          sr.role in ('editor', 'internal')
          or (sr.role = 'owner' and sr.restaurant_id = field_provenance.restaurant_id)
        )
    )
  );

create policy "staff_can_insert_scoped_provenance" on field_provenance
  for insert
  with check (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid()
        and (
          sr.role in ('editor', 'internal')
          or (sr.role = 'owner' and sr.restaurant_id = field_provenance.restaurant_id)
        )
    )
  );

create policy "staff_can_update_scoped_provenance" on field_provenance
  for update
  using (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid()
        and (
          sr.role in ('editor', 'internal')
          or (sr.role = 'owner' and sr.restaurant_id = field_provenance.restaurant_id)
        )
    )
  )
  with check (
    exists (
      select 1 from staff_roles sr
      where sr.user_id = auth.uid()
        and (
          sr.role in ('editor', 'internal')
          or (sr.role = 'owner' and sr.restaurant_id = field_provenance.restaurant_id)
        )
    )
  );

-- No delete policy for field_provenance: deletes are denied by default
-- under RLS for non-service-role callers. Not part of this ticket's scope.

-- ── Grants for service_role ──────────────────────────────────────────────
--
-- service_role has BYPASSRLS (skips the RLS policies above), but that is a
-- separate mechanism from Postgres's own table-level GRANT system — RLS
-- bypass does not imply table privileges. Without these, the internal API
-- (which always connects as service_role) gets a hard "permission denied"
-- on every query, even though RLS itself would have allowed it. Discovered
-- during PLATFORM-05's live verification against a real Supabase project,
-- applied manually there, and confirmed to fix it — added here so a fresh
-- environment running this migration doesn't hit the same failure.

grant usage on schema public to service_role;

grant select, insert, update on public.field_provenance to service_role;
grant usage, select on sequence public.field_provenance_id_seq to service_role;

grant select on public.staff_roles to service_role;
