-- 0019 — BE-27 "Maak review-PR": export of an internally approved menu
-- concept to an ordinary GitHub review pull request.
--
-- Additive only: one new table recording each export attempt of a menu
-- concept version (menu_snapshot_proposals, 0011/0018). An export never
-- publishes: merging the pull request by hand is the publication
-- (decision 016). This table only records where the reviewed change lives.
--
--   - at most one active export (pending or opened) per concept version
--     and per restaurant, so a double click or a retry never creates a
--     second branch or pull request;
--   - status moves pending → opened | failed, and opened → merged | closed
--     when GitHub reports it; rows are never deleted;
--   - only the outcome columns can change (column-scoped update grant);
--   - RLS on with no policies; service_role only, like 0015.

create table if not exists menu_snapshot_exports (
  id             bigint generated always as identity primary key,
  snapshot_id    bigint not null references menu_snapshot_proposals(id),
  restaurant_id  text not null check (restaurant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  content_hash   text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  export_hash    text check (export_hash is null or export_hash ~ '^[0-9a-f]{64}$'),
  status         text not null default 'pending' check (status in ('pending', 'opened', 'failed', 'merged', 'closed')),
  branch         text check (branch is null or branch ~ '^menu-export/[A-Za-z0-9._/-]{1,200}$'),
  commit_sha     text check (commit_sha is null or commit_sha ~ '^[0-9a-f]{40}$'),
  pr_number      integer check (pr_number is null or pr_number > 0),
  pr_url         text check (pr_url is null or pr_url ~ '^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$'),
  error_reason   text check (error_reason is null or error_reason in ('github_error', 'interrupted')),
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status not in ('opened', 'merged', 'closed') or (branch is not null and commit_sha is not null and pr_number is not null and pr_url is not null)),
  check ((status = 'failed') = (error_reason is not null))
);

create unique index if not exists idx_menu_snapshot_exports_one_active_per_snapshot
  on menu_snapshot_exports (snapshot_id)
  where status in ('pending', 'opened');

create unique index if not exists idx_menu_snapshot_exports_one_active_per_restaurant
  on menu_snapshot_exports (restaurant_id)
  where status in ('pending', 'opened');

create index if not exists idx_menu_snapshot_exports_snapshot
  on menu_snapshot_exports (snapshot_id, created_at desc);

alter table menu_snapshot_exports enable row level security;

revoke all on public.menu_snapshot_exports from public, anon, authenticated, service_role;
grant select, insert on public.menu_snapshot_exports to service_role;
grant update (status, export_hash, branch, commit_sha, pr_number, pr_url, error_reason, updated_at) on public.menu_snapshot_exports to service_role;
revoke all on sequence public.menu_snapshot_exports_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.menu_snapshot_exports_id_seq to service_role;
