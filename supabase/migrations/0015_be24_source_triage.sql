-- BE-24 — Internal source triage (Brontriage) v1.
--
-- NOT YET APPLIED. Written and structurally tested only. Release it on its
-- own, through the approved migration pipeline, before the routes and page
-- that depend on it (docs/guides/production-migration-pipeline.md,
-- "Release sequencing"). Contract:
-- planning/specs/tickets/be-24-internal-source-triage.md.
--
-- Proposal-only. These tables record a staff member's proposal about a
-- restaurant's source URL and a staff member's explicit accept/reject
-- decision. Nothing here changes published data, starts an analysis, or
-- touches restaurant_source_analysis_jobs, url_intakes,
-- restaurant_profile_drafts or any other existing table. Accepting a
-- proposal is a recorded decision, not a publication.

-- ── source_triage_proposals ─────────────────────────────────────────────
--
-- One row per proposal. `id` is supplied by the application (UUIDv7, the
-- 0010/0013 convention for identity-bearing rows). `restaurant_id` is the
-- data/restaurants.json key: restaurants are not a database table, so it
-- is not a foreign key — the API checks it exists before writing.
--
-- URL columns repeat 0013's canonical_source_url shape: scheme, host and
-- path only — never a query string or fragment (data minimisation).

create table if not exists source_triage_proposals (
  id               uuid primary key,
  market_id        uuid not null references markets(id),
  restaurant_id    text not null check (restaurant_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind             text not null check (kind in ('add_candidate', 'replace_source', 'mark_unusable')),
  proposed_url     text check (
    proposed_url is null
    or (char_length(proposed_url) <= 2048 and proposed_url ~* '^https?://' and proposed_url !~ '[?#[:space:]]')
  ),
  -- The restaurant's known source URL when the proposal was made
  -- (canonical form) — so a later reader sees what was being replaced or
  -- marked, even after the published data changes.
  current_url      text check (
    current_url is null
    or (char_length(current_url) <= 2048 and current_url ~* '^https?://' and current_url !~ '[?#[:space:]]')
  ),
  unusable_reason  text check (
    unusable_reason is null
    or unusable_reason in ('site_offline', 'other_business', 'no_menu_on_source', 'access_blocked', 'other')
  ),
  note             text check (note is null or (char_length(note) <= 280 and btrim(note) <> '')),
  status           text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  proposed_by      uuid not null references auth.users(id),
  proposed_at      timestamptz not null default now(),
  decided_by       uuid references auth.users(id),
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or (char_length(decision_note) <= 280 and btrim(decision_note) <> '')),
  -- A URL exactly for the two URL kinds; a reason exactly for marking.
  check ((kind in ('add_candidate', 'replace_source')) = (proposed_url is not null)),
  check ((kind = 'mark_unusable') = (unusable_reason is not null)),
  -- Replacing or marking needs a known source to refer to.
  check (kind = 'add_candidate' or current_url is not null),
  -- Replacing with the same URL is not a proposal.
  check (kind <> 'replace_source' or proposed_url is distinct from current_url),
  -- "Andere reden" always needs a short explanation.
  check (unusable_reason is distinct from 'other' or note is not null),
  -- Decision columns: all set exactly when decided, never while open —
  -- three independent biconditionals (the 0010 lesson: one combined `and`
  -- lets a single column slip through while open).
  check ((status = 'open') = (decided_by is null)),
  check ((status = 'open') = (decided_at is null)),
  check (status <> 'open' or decision_note is null),
  -- A rejection always carries its reason.
  check (status <> 'rejected' or decision_note is not null)
);

-- At most one open proposal per restaurant: a second one waits until the
-- first is decided. Partial, so decided proposals never block a new one.
create unique index if not exists idx_source_triage_proposals_one_open_per_restaurant
  on source_triage_proposals (market_id, restaurant_id)
  where status = 'open';

create index if not exists idx_source_triage_proposals_restaurant
  on source_triage_proposals (market_id, restaurant_id, proposed_at desc);

-- ── source_triage_proposal_events ───────────────────────────────────────
--
-- Append-only audit trail: one `proposed` event per proposal and one
-- `accepted`/`rejected` event per decision, always written in the same
-- transaction as the change itself (by the two RPCs below).

create table if not exists source_triage_proposal_events (
  id             bigint generated always as identity primary key,
  proposal_id    uuid not null references source_triage_proposals(id),
  event          text not null check (event in ('proposed', 'accepted', 'rejected')),
  actor_user_id  uuid not null references auth.users(id),
  note           text check (note is null or (char_length(note) <= 280 and btrim(note) <> '')),
  created_at     timestamptz not null default now()
);

create index if not exists idx_source_triage_proposal_events_proposal
  on source_triage_proposal_events (proposal_id, created_at);

-- ── Row Level Security and grants ───────────────────────────────────────
--
-- Same posture as 0010/0013/0014: RLS on, nothing for public/anon/
-- authenticated. Internal-only is enforced by the application
-- (authenticateInternalRequest + isInternalOnly); this is defence in
-- depth. service_role gets only what the RPCs and the read route need.
--
-- Supabase's default privileges in schema public grant rights on every new
-- table, sequence and function DIRECTLY to anon, authenticated and
-- service_role — not through PUBLIC. A revoke from PUBLIC alone therefore
-- leaves them in place. Every object below is revoked explicitly from
-- public, anon, authenticated and service_role first, and only then gets
-- the minimal service_role grant it needs.

alter table source_triage_proposals       enable row level security;
alter table source_triage_proposal_events enable row level security;

revoke all on public.source_triage_proposals       from public, anon, authenticated;
revoke all on public.source_triage_proposal_events from public, anon, authenticated;
revoke all on public.source_triage_proposals       from service_role;
revoke all on public.source_triage_proposal_events from service_role;

grant usage on schema public to service_role;

-- Proposals: select + insert, plus a column-scoped update limited to the
-- decision columns. id/market_id/restaurant_id/kind/URLs/reason/note/
-- proposed_by/proposed_at are never updatable once written. No delete.
grant select, insert on public.source_triage_proposals to service_role;
grant update (status, decided_by, decided_at, decision_note)
  on public.source_triage_proposals to service_role;

-- Events: append-only — select + insert, never update or delete.
grant select, insert on public.source_triage_proposal_events to service_role;

-- The identity sequence behind source_triage_proposal_events.id: nothing
-- for anyone except USAGE for service_role (nextval on insert). No SELECT
-- (currval/last_value) and no UPDATE (setval).
revoke all on sequence public.source_triage_proposal_events_id_seq from public, anon, authenticated, service_role;
grant usage on sequence public.source_triage_proposal_events_id_seq to service_role;

-- ── create_source_triage_proposal: the only way to create a proposal ─────

create or replace function create_source_triage_proposal(
  p_proposal_id uuid,
  p_market_id uuid,
  p_restaurant_id text,
  p_kind text,
  p_proposed_url text,
  p_current_url text,
  p_unusable_reason text,
  p_note text,
  p_actor_user_id uuid
)
returns source_triage_proposals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result source_triage_proposals%rowtype;
  -- A blank note is no note (the API already normalizes this; repeated here).
  v_note text := nullif(btrim(p_note), '');
begin
  if exists (
    select 1 from source_triage_proposals
    where market_id = p_market_id and restaurant_id = p_restaurant_id and status = 'open'
  ) then
    raise exception using
      message = 'An open proposal already exists for this restaurant',
      errcode = 'P0030';
  end if;

  begin
    insert into source_triage_proposals (
      id, market_id, restaurant_id, kind, proposed_url, current_url,
      unusable_reason, note, status, proposed_by, proposed_at
    ) values (
      p_proposal_id, p_market_id, p_restaurant_id, p_kind, p_proposed_url, p_current_url,
      p_unusable_reason, v_note, 'open', p_actor_user_id, now()
    )
    returning * into v_result;
  exception
    when unique_violation then
      -- A race with a concurrent proposal for the same restaurant: the
      -- partial unique index is the real enforcement.
      raise exception using
        message = 'An open proposal already exists for this restaurant',
        errcode = 'P0030';
  end;

  insert into source_triage_proposal_events (proposal_id, event, actor_user_id, note)
  values (v_result.id, 'proposed', p_actor_user_id, v_note);

  return v_result;
end;
$$;

-- Revoked explicitly from anon and authenticated too: Supabase's default
-- privileges grant EXECUTE on new functions to them directly.
revoke all on function create_source_triage_proposal(uuid, uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function create_source_triage_proposal(uuid, uuid, text, text, text, text, text, text, uuid) to service_role;

-- ── decide_source_triage_proposal: the only way to accept or reject ─────
--
-- Valid only from status = 'open'. Accepting records the decision only: it
-- changes no other table — no published data, no analysis job.

create or replace function decide_source_triage_proposal(
  p_proposal_id uuid,
  p_decision text,
  p_actor_user_id uuid,
  p_note text default null
)
returns source_triage_proposals
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result source_triage_proposals%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_decision is null or p_decision not in ('accepted', 'rejected') then
    raise exception using
      message = 'Decision must be accepted or rejected',
      errcode = 'P0033';
  end if;

  if p_decision = 'rejected' and v_note is null then
    raise exception using
      message = 'A rejection needs a reason',
      errcode = 'P0032';
  end if;

  update source_triage_proposals
  set status = p_decision,
      decided_by = p_actor_user_id,
      decided_at = now(),
      decision_note = v_note
  where id = p_proposal_id and status = 'open'
  returning * into v_result;

  if v_result.id is null then
    raise exception using
      message = 'Proposal not found or already decided',
      errcode = 'P0031';
  end if;

  insert into source_triage_proposal_events (proposal_id, event, actor_user_id, note)
  values (v_result.id, p_decision, p_actor_user_id, v_note);

  return v_result;
end;
$$;

-- Revoked explicitly from anon and authenticated too: Supabase's default
-- privileges grant EXECUTE on new functions to them directly.
revoke all on function decide_source_triage_proposal(uuid, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function decide_source_triage_proposal(uuid, text, uuid, text) to service_role;
