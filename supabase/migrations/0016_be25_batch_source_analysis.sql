-- BE-25 (fase 1) — batch source analysis schema.
--
-- NOT YET APPLIED. Written and structurally tested only. Release it on its
-- own, through the approved migration pipeline, before any route or page
-- that depends on it (docs/guides/production-migration-pipeline.md,
-- "Release sequencing"). Contract:
-- planning/specs/tickets/be-25-batch-source-analysis-from-triage.md and
-- docs/api/url-intake-schema.md, "Amendment (2026-10-09, BE-25)".
--
-- Additive only. 0001-0015 are never edited: this migration adds nullable
-- columns, one new table, indexes, column-scoped grants and functions. It
-- changes no existing constraint, grant or function. The single-URL route
-- (POST /api/internal/v1/restaurant-analysis-jobs) keeps inserting jobs with
-- batch_id null; every new rule below applies to batch jobs only.
--
-- Processing only happens while the starter's batch page calls the claim
-- function: there is no worker, cron or scheduler. Nothing here fetches,
-- activates a source, creates a concept or publishes anything.

-- ── url_intake_batches (0014): lifecycle columns ────────────────────────
--
-- One open batch per starter. A batch closes as 'completed' when it has no
-- open job left, or as 'expired' after 24 hours without activity (lazy:
-- checked inside enqueue and claim, never by a scheduler).

alter table url_intake_batches
  add column if not exists last_activity_at timestamptz not null default now();
alter table url_intake_batches
  add column if not exists closed_at timestamptz;
alter table url_intake_batches
  add column if not exists close_reason text check (close_reason is null or close_reason in ('completed', 'expired'));
alter table url_intake_batches
  add column if not exists item_count integer check (item_count is null or (item_count >= 1 and item_count <= 10));

alter table url_intake_batches
  add constraint url_intake_batches_closed_has_reason
  check ((closed_at is null) = (close_reason is null));

-- item_count is set only by enqueue, so a batch row from before BE-25 (0014
-- created the table; nothing wrote to it) can never collide with this index.
create unique index if not exists idx_url_intake_batches_one_open_per_actor
  on url_intake_batches (actor_user_id)
  where closed_at is null and item_count is not null;

-- ── restaurant_source_analysis_jobs (0014): batch columns ───────────────
--
-- All nullable, so single-URL rows stay valid. source_host is the
-- lowercased host without a leading `www.`, set only for batch jobs (host
-- cooldown). A lease exists only on a running batch job. finished_at is
-- the end of the latest attempt (also for a retried failure), so the
-- 60-second host cooldown counts every contact with that host.
-- expired_at marks an open job of an expired batch: the status stays as
-- it was (no new status value), and the job no longer counts as open.

alter table restaurant_source_analysis_jobs
  add column if not exists source_host text check (source_host is null or source_host ~ '^[a-z0-9.-]{1,253}$');
alter table restaurant_source_analysis_jobs
  add column if not exists lease_expires_at timestamptz;
alter table restaurant_source_analysis_jobs
  add column if not exists next_attempt_at timestamptz;
alter table restaurant_source_analysis_jobs
  add column if not exists claimed_at timestamptz;
alter table restaurant_source_analysis_jobs
  add column if not exists finished_at timestamptz;
alter table restaurant_source_analysis_jobs
  add column if not exists expired_at timestamptz;

alter table restaurant_source_analysis_jobs
  add constraint restaurant_source_analysis_jobs_batch_has_host
  check ((batch_id is null) = (source_host is null));
alter table restaurant_source_analysis_jobs
  add constraint restaurant_source_analysis_jobs_lease_only_for_batch
  check (batch_id is not null or lease_expires_at is null);

-- Duplicates inside one batch only. Deliberately no wider unique index on
-- the URL: the single-URL route must never fail on a batch conflict.
create unique index if not exists idx_restaurant_source_analysis_jobs_batch_url
  on restaurant_source_analysis_jobs (batch_id, canonical_source_url)
  where batch_id is not null;

create index if not exists idx_restaurant_source_analysis_jobs_batch_queue
  on restaurant_source_analysis_jobs (batch_id, status, next_attempt_at)
  where batch_id is not null;

create index if not exists idx_restaurant_source_analysis_jobs_running_lease
  on restaurant_source_analysis_jobs (lease_expires_at)
  where status = 'running';

create index if not exists idx_restaurant_source_analysis_jobs_host_finished
  on restaurant_source_analysis_jobs (source_host, finished_at desc)
  where batch_id is not null;

create index if not exists idx_restaurant_source_analysis_jobs_market_url
  on restaurant_source_analysis_jobs (market_id, canonical_source_url, status);

-- ── url_intake_batch_items: one row per submitted line ──────────────────
--
-- The batch history, including lines that did not create a job. An
-- invalid line is stored without its text (data minimisation): the page
-- shows the text from its own memory for "URL aanpassen".

create table if not exists url_intake_batch_items (
  batch_id              uuid not null references url_intake_batches(id),
  item_position         integer not null check (item_position >= 1 and item_position <= 10),
  canonical_source_url  text check (
                          canonical_source_url is null
                          or (char_length(canonical_source_url) <= 2048
                              and canonical_source_url ~* '^https?://'
                              and canonical_source_url !~ '[?#[:space:]]')
                        ),
  outcome               text not null check (outcome in ('queued', 'recent', 'duplicate', 'already_active', 'invalid')),
  job_id                uuid references restaurant_source_analysis_jobs(id),
  reused_job_id         uuid references restaurant_source_analysis_jobs(id),
  created_at            timestamptz not null default now(),
  primary key (batch_id, item_position),
  check ((outcome = 'queued') = (job_id is not null)),
  check ((outcome = 'recent') = (reused_job_id is not null)),
  check ((outcome = 'invalid') = (canonical_source_url is null))
);

create index if not exists idx_url_intake_batch_items_job
  on url_intake_batch_items (job_id)
  where job_id is not null;

-- ── url_intakes (0013): which batch job a URL intake came from ──────────

alter table url_intakes
  add column if not exists issued_via_job_id uuid references restaurant_source_analysis_jobs(id);

create unique index if not exists idx_url_intakes_issued_via_job
  on url_intakes (issued_via_job_id)
  where issued_via_job_id is not null;

-- ── Row Level Security and grants ───────────────────────────────────────
--
-- Same posture as 0013-0015. The new table is revoked from public, anon,
-- authenticated and service_role first (Supabase's default privileges
-- grant directly to those roles), then gets select + insert only. Existing
-- tables keep their grants; service_role only gains column-scoped update
-- on the new lifecycle columns. Table-level select/insert grants on
-- existing tables already cover their new columns. No delete anywhere.

alter table url_intake_batch_items enable row level security;

revoke all on public.url_intake_batch_items from public, anon, authenticated;
revoke all on public.url_intake_batch_items from service_role;

grant usage on schema public to service_role;

grant select, insert on public.url_intake_batch_items to service_role;
grant update (last_activity_at, closed_at, close_reason)
  on public.url_intake_batches to service_role;
grant update (lease_expires_at, next_attempt_at, claimed_at, finished_at, expired_at)
  on public.restaurant_source_analysis_jobs to service_role;

-- ── expire_idle_source_analysis_batches ──────────────────────────────────
--
-- Closes every open batch without activity for 24 hours as 'expired' and
-- marks its open jobs expired_at. Called inside enqueue and claim (lazy);
-- never scheduled.

create or replace function expire_idle_source_analysis_batches()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update url_intake_batches b
    set closed_at = now(), close_reason = 'expired'
    where b.closed_at is null
      and b.last_activity_at < now() - interval '24 hours'
    returning b.id
  )
  update restaurant_source_analysis_jobs j
  set expired_at = now(), lease_expires_at = null, updated_at = now()
  from expired e
  where j.batch_id = e.id
    and j.status in ('pending', 'running')
    and j.expired_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function expire_idle_source_analysis_batches() from public, anon, authenticated, service_role;
grant execute on function expire_idle_source_analysis_batches() to service_role;

-- ── enqueue_source_analysis_batch ────────────────────────────────────────
--
-- One click, one batch. p_batch_id is the client-generated UUID of that
-- click: a repeated submission by the same account returns the existing
-- batch unchanged (no new jobs, no extra daily usage); another account
-- gets P0040. p_urls is a JSON array of 1-10 canonical URLs (null for a
-- line the server already rejected). The actor is always the session user
-- id, passed by the route — never a value from the request body.

create or replace function enqueue_source_analysis_batch(
  p_batch_id uuid,
  p_market_id uuid,
  p_actor_user_id uuid,
  p_urls jsonb
)
returns url_intake_batches
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz constant text := 'Europe/Amsterdam';
  v_batch url_intake_batches%rowtype;
  v_count integer;
  v_used integer;
  v_queued integer := 0;
  v_seen text[] := '{}';
  v_item record;
  v_url text;
  v_host text;
  v_job_id uuid;
  v_reused_job_id uuid;
begin
  -- Serializes every enqueue: idempotency, the one-open-batch rule, the
  -- cross-batch duplicate check and the daily limit see one consistent
  -- state.
  perform pg_advisory_xact_lock(4025, 1);

  select * into v_batch from url_intake_batches b where b.id = p_batch_id;
  if found then
    if v_batch.actor_user_id is distinct from p_actor_user_id then
      raise exception using
        message = 'This batch id belongs to another account',
        errcode = 'P0040';
    end if;
    return v_batch;
  end if;

  if p_urls is null or jsonb_typeof(p_urls) <> 'array' then
    v_count := 0;
  else
    v_count := jsonb_array_length(p_urls);
  end if;

  if v_count < 1 or v_count > 10 then
    raise exception using
      message = 'A batch needs 1 to 10 URLs',
      errcode = 'P0041';
  end if;

  perform expire_idle_source_analysis_batches();

  if exists (
    select 1 from url_intake_batches b
    where b.actor_user_id = p_actor_user_id and b.closed_at is null and b.item_count is not null
  ) then
    raise exception using
      message = 'This account already has an open batch',
      errcode = 'P0043';
  end if;

  insert into url_intake_batches (id, market_id, actor_user_id, created_at, last_activity_at, item_count)
  values (p_batch_id, p_market_id, p_actor_user_id, now(), now(), v_count)
  returning * into v_batch;

  for v_item in
    select e.value as url_value, e.ordinality::integer as item_position
    from jsonb_array_elements(p_urls) with ordinality as e(value, ordinality)
  loop
    v_url := case when jsonb_typeof(v_item.url_value) = 'string' then btrim(v_item.url_value #>> '{}') end;
    v_host := regexp_replace(lower(substring(v_url from '^[A-Za-z]+://([^/:]+)')), '^www\.', '');

    if v_url is null
       or char_length(v_url) > 2048
       or v_url !~* '^https?://'
       or v_url ~ '[?#[:space:]]'
       or v_host is null
       or v_host !~ '^[a-z0-9.-]{1,253}$' then
      insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome)
      values (p_batch_id, v_item.item_position, null, 'invalid');
      continue;
    end if;

    if v_url = any(v_seen) then
      insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome)
      values (p_batch_id, v_item.item_position, v_url, 'duplicate');
      continue;
    end if;
    v_seen := array_append(v_seen, v_url);

    -- An open job for this URL in another batch: not queued again.
    if exists (
      select 1 from restaurant_source_analysis_jobs o
      where o.market_id = p_market_id
        and o.canonical_source_url = v_url
        and o.batch_id is not null
        and o.status in ('pending', 'running')
        and o.expired_at is null
    ) then
      insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome)
      values (p_batch_id, v_item.item_position, v_url, 'already_active');
      continue;
    end if;

    -- A successful result of at most 7 days: reused, not fetched again,
    -- and not counted towards the daily limit.
    select r.id into v_reused_job_id
    from restaurant_source_analysis_jobs r
    where r.market_id = p_market_id
      and r.canonical_source_url = v_url
      and r.status = 'succeeded'
      and coalesce(r.finished_at, r.updated_at) >= now() - interval '7 days'
    order by coalesce(r.finished_at, r.updated_at) desc
    limit 1;

    if v_reused_job_id is not null then
      insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome, reused_job_id)
      values (p_batch_id, v_item.item_position, v_url, 'recent', v_reused_job_id);
      continue;
    end if;

    v_job_id := gen_random_uuid();
    insert into restaurant_source_analysis_jobs (
      id, market_id, actor_user_id, canonical_source_url, status, batch_id, source_host
    ) values (
      v_job_id, p_market_id, p_actor_user_id, v_url, 'pending', p_batch_id, v_host
    );
    insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome, job_id)
    values (p_batch_id, v_item.item_position, v_url, 'queued', v_job_id);
    v_queued := v_queued + 1;
  end loop;

  -- Daily limit: batch jobs created by this account today (calendar day,
  -- Europe/Amsterdam), including the ones just queued. Exceeding it rolls
  -- the whole batch back.
  select count(*) into v_used
  from restaurant_source_analysis_jobs u
  where u.actor_user_id = p_actor_user_id
    and u.batch_id is not null
    and (u.created_at at time zone v_tz)::date = (now() at time zone v_tz)::date;

  if v_used > 25 then
    raise exception using
      message = 'Daily limit of 25 queued URLs reached',
      errcode = 'P0042';
  end if;

  -- Nothing to process (all lines recent, duplicate, invalid or already
  -- active): the batch is complete at once and does not block a new one.
  if v_queued = 0 then
    update url_intake_batches b
    set closed_at = now(), close_reason = 'completed'
    where b.id = p_batch_id
    returning * into v_batch;
  end if;

  return v_batch;
end;
$$;

revoke all on function enqueue_source_analysis_batch(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function enqueue_source_analysis_batch(uuid, uuid, uuid, jsonb) to service_role;

-- ── claim_next_source_analysis_job ──────────────────────────────────────
--
-- Called by the starter's open batch page, one job per call. Only the
-- starter can claim, only jobs of that batch. Active = running with a
-- valid lease: at most one active job overall (which also means one per
-- host), never a host within 60 seconds of its previous attempt, never a
-- job before its next_attempt_at. Expired leases of this batch are
-- recovered under the attempt and backoff rules first.

create or replace function claim_next_source_analysis_job(
  p_batch_id uuid,
  p_actor_user_id uuid
)
returns table (claimed_job_id uuid, claim_outcome text, retry_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch url_intake_batches%rowtype;
  v_job restaurant_source_analysis_jobs%rowtype;
  v_busy_until timestamptz;
  v_wait_until timestamptz;
begin
  -- Serializes every claim, so "one active job overall" cannot race.
  perform pg_advisory_xact_lock(4025, 2);
  perform expire_idle_source_analysis_batches();

  select * into v_batch from url_intake_batches b where b.id = p_batch_id;
  if not found or v_batch.actor_user_id is distinct from p_actor_user_id then
    raise exception using
      message = 'Batch not found or not started by this account',
      errcode = 'P0044';
  end if;

  if v_batch.closed_at is not null then
    claimed_job_id := null;
    claim_outcome := 'done';
    retry_at := null;
    return next;
    return;
  end if;

  -- Expired leases in this batch count as a failed internal_error attempt.
  update restaurant_source_analysis_jobs j
  set status = 'pending',
      attempt_count = j.attempt_count + 1,
      next_attempt_at = now() + case j.attempt_count + 1
                                  when 2 then interval '2 minutes'
                                  when 3 then interval '10 minutes'
                                  else interval '30 minutes'
                                end,
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  where j.batch_id = p_batch_id
    and j.status = 'running'
    and j.expired_at is null
    and (j.lease_expires_at is null or j.lease_expires_at <= now())
    and j.attempt_count < 5;

  update restaurant_source_analysis_jobs j
  set status = 'failed',
      error_reason = 'internal_error',
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  where j.batch_id = p_batch_id
    and j.status = 'running'
    and j.expired_at is null
    and (j.lease_expires_at is null or j.lease_expires_at <= now());

  select min(r.lease_expires_at) into v_busy_until
  from restaurant_source_analysis_jobs r
  where r.status = 'running' and r.lease_expires_at > now();

  if v_busy_until is not null then
    claimed_job_id := null;
    claim_outcome := 'busy';
    retry_at := v_busy_until;
    return next;
    return;
  end if;

  select j.* into v_job
  from restaurant_source_analysis_jobs j
  where j.batch_id = p_batch_id
    and j.status = 'pending'
    and j.expired_at is null
    and (j.next_attempt_at is null or j.next_attempt_at <= now())
    and not exists (
      select 1 from restaurant_source_analysis_jobs h
      where h.batch_id is not null
        and h.source_host = j.source_host
        and h.finished_at > now() - interval '60 seconds'
    )
  order by (select i.item_position from url_intake_batch_items i where i.job_id = j.id), j.created_at
  limit 1
  for update skip locked;

  if v_job.id is null then
    if not exists (
      select 1 from restaurant_source_analysis_jobs o
      where o.batch_id = p_batch_id
        and o.status in ('pending', 'running')
        and o.expired_at is null
    ) then
      update url_intake_batches b
      set closed_at = now(), close_reason = 'completed', last_activity_at = now()
      where b.id = p_batch_id and b.closed_at is null;
      claimed_job_id := null;
      claim_outcome := 'done';
      retry_at := null;
      return next;
      return;
    end if;

    select min(greatest(
             coalesce(o.next_attempt_at, now()),
             coalesce((
               select max(h.finished_at) from restaurant_source_analysis_jobs h
               where h.batch_id is not null and h.source_host = o.source_host
             ) + interval '60 seconds', now())
           ))
    into v_wait_until
    from restaurant_source_analysis_jobs o
    where o.batch_id = p_batch_id
      and o.status = 'pending'
      and o.expired_at is null;

    claimed_job_id := null;
    claim_outcome := 'waiting';
    retry_at := v_wait_until;
    return next;
    return;
  end if;

  update restaurant_source_analysis_jobs j
  set status = 'running',
      claimed_at = now(),
      lease_expires_at = now() + interval '3 minutes',
      updated_at = now()
  where j.id = v_job.id;

  update url_intake_batches b
  set last_activity_at = now()
  where b.id = p_batch_id;

  claimed_job_id := v_job.id;
  claim_outcome := 'claimed';
  retry_at := null;
  return next;
  return;
end;
$$;

revoke all on function claim_next_source_analysis_job(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function claim_next_source_analysis_job(uuid, uuid) to service_role;

-- ── complete_source_analysis_job ─────────────────────────────────────────
--
-- Records a successful attempt: the route has already inserted the BE-19
-- receipt for this job (same actor, same canonical URL), exactly as the
-- single-URL route does.

create or replace function complete_source_analysis_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_receipt_id uuid,
  p_field_evidence jsonb
)
returns restaurant_source_analysis_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job restaurant_source_analysis_jobs%rowtype;
  v_batch url_intake_batches%rowtype;
  v_receipt url_intake_analysis_receipts%rowtype;
begin
  select * into v_job from restaurant_source_analysis_jobs j where j.id = p_job_id for update;
  if not found or v_job.batch_id is null then
    raise exception using
      message = 'Batch job not found or not started by this account',
      errcode = 'P0044';
  end if;

  select * into v_batch from url_intake_batches b where b.id = v_job.batch_id;
  if v_batch.actor_user_id is distinct from p_actor_user_id then
    raise exception using
      message = 'Batch job not found or not started by this account',
      errcode = 'P0044';
  end if;

  if v_job.status <> 'running'
     or v_job.expired_at is not null
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= now() then
    raise exception using
      message = 'Job is not running under a valid lease',
      errcode = 'P0045';
  end if;

  select * into v_receipt from url_intake_analysis_receipts r where r.id = p_receipt_id;
  if not found
     or v_receipt.actor_user_id is distinct from v_job.actor_user_id
     or v_receipt.canonical_source_url is distinct from v_job.canonical_source_url
     or p_field_evidence is null then
    raise exception using
      message = 'Result does not belong to this job',
      errcode = 'P0047';
  end if;

  update restaurant_source_analysis_jobs j
  set status = 'succeeded',
      result_receipt_id = p_receipt_id,
      field_evidence = p_field_evidence,
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  where j.id = p_job_id
  returning * into v_job;

  update url_intake_batches b
  set last_activity_at = now(),
      closed_at = case when exists (
        select 1 from restaurant_source_analysis_jobs o
        where o.batch_id = b.id and o.status in ('pending', 'running') and o.expired_at is null
      ) then null else now() end,
      close_reason = case when exists (
        select 1 from restaurant_source_analysis_jobs o
        where o.batch_id = b.id and o.status in ('pending', 'running') and o.expired_at is null
      ) then null else 'completed' end
  where b.id = v_job.batch_id and b.closed_at is null;

  return v_job;
end;
$$;

revoke all on function complete_source_analysis_job(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function complete_source_analysis_job(uuid, uuid, uuid, jsonb) to service_role;

-- ── fail_source_analysis_job ─────────────────────────────────────────────
--
-- Records a failed attempt. Only fetch_failed and internal_error are
-- retried automatically, as the same job, within the existing maximum of
-- five attempts: 2 minutes before the 2nd attempt, 10 before the 3rd, 30
-- before the 4th and 5th. Every other reason is terminal at once.

create or replace function fail_source_analysis_job(
  p_job_id uuid,
  p_actor_user_id uuid,
  p_error_reason text
)
returns restaurant_source_analysis_jobs
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job restaurant_source_analysis_jobs%rowtype;
  v_batch url_intake_batches%rowtype;
begin
  if p_error_reason is null or p_error_reason not in (
    'unsafe_url', 'robots_disallowed', 'unsupported_content_type',
    'fetch_failed', 'pdf_extraction_failed', 'ai_structuring_failed',
    'budget_exceeded', 'no_reliable_content_found', 'internal_error'
  ) then
    raise exception using
      message = 'Unknown error reason',
      errcode = 'P0046';
  end if;

  select * into v_job from restaurant_source_analysis_jobs j where j.id = p_job_id for update;
  if not found or v_job.batch_id is null then
    raise exception using
      message = 'Batch job not found or not started by this account',
      errcode = 'P0044';
  end if;

  select * into v_batch from url_intake_batches b where b.id = v_job.batch_id;
  if v_batch.actor_user_id is distinct from p_actor_user_id then
    raise exception using
      message = 'Batch job not found or not started by this account',
      errcode = 'P0044';
  end if;

  if v_job.status <> 'running'
     or v_job.expired_at is not null
     or v_job.lease_expires_at is null
     or v_job.lease_expires_at <= now() then
    raise exception using
      message = 'Job is not running under a valid lease',
      errcode = 'P0045';
  end if;

  if p_error_reason in ('fetch_failed', 'internal_error') and v_job.attempt_count < 5 then
    update restaurant_source_analysis_jobs j
    set status = 'pending',
        attempt_count = j.attempt_count + 1,
        next_attempt_at = now() + case j.attempt_count + 1
                                    when 2 then interval '2 minutes'
                                    when 3 then interval '10 minutes'
                                    else interval '30 minutes'
                                  end,
        lease_expires_at = null,
        finished_at = now(),
        updated_at = now()
    where j.id = p_job_id
    returning * into v_job;
  else
    update restaurant_source_analysis_jobs j
    set status = 'failed',
        error_reason = p_error_reason,
        lease_expires_at = null,
        finished_at = now(),
        updated_at = now()
    where j.id = p_job_id
    returning * into v_job;
  end if;

  update url_intake_batches b
  set last_activity_at = now(),
      closed_at = case when exists (
        select 1 from restaurant_source_analysis_jobs o
        where o.batch_id = b.id and o.status in ('pending', 'running') and o.expired_at is null
      ) then null else now() end,
      close_reason = case when exists (
        select 1 from restaurant_source_analysis_jobs o
        where o.batch_id = b.id and o.status in ('pending', 'running') and o.expired_at is null
      ) then null else 'completed' end
  where b.id = v_job.batch_id and b.closed_at is null;

  return v_job;
end;
$$;

revoke all on function fail_source_analysis_job(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function fail_source_analysis_job(uuid, uuid, text) to service_role;

-- ── create_url_intake_from_batch_job (BE-25 B2) ──────────────────────────
--
-- The second, bounded durable write path of docs/api/url-intake-schema.md,
-- "Amendment (2026-10-09, BE-25)". The batch job is the trusted binding;
-- its receipt is only payload and single-use lock. Only on this path do
-- the batch binding, the acting account and a result of at most 7 days
-- (from the receipt's created_at, never updated) replace BE-19's actor
-- check and ten-minute expiry. The route recomputes the hash from the
-- receipt's own inputs (its actor, URL, match type, matched restaurant and
-- candidate summary — never the redeeming account) and passes it as
-- p_expected_analysis_result_hash. In v1 only the batch starter may use
-- this path. create_url_intake_from_receipt (0013) is unchanged.

create or replace function create_url_intake_from_batch_job(
  p_url_intake_id uuid,
  p_job_id uuid,
  p_actor_user_id uuid,
  p_expected_analysis_result_hash text
)
returns url_intakes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_job restaurant_source_analysis_jobs%rowtype;
  v_batch url_intake_batches%rowtype;
  v_receipt url_intake_analysis_receipts%rowtype;
  v_result url_intakes%rowtype;
begin
  select * into v_job from restaurant_source_analysis_jobs j where j.id = p_job_id for update;
  if not found or v_job.batch_id is null or v_job.status <> 'succeeded' then
    raise exception using
      message = 'Batch job not found or has no successful result',
      errcode = 'P0047';
  end if;

  select * into v_batch from url_intake_batches b where b.id = v_job.batch_id;
  if v_batch.actor_user_id is distinct from p_actor_user_id then
    raise exception using
      message = 'Only the batch starter can use this result in v1',
      errcode = 'P0044';
  end if;

  select * into v_receipt
  from url_intake_analysis_receipts r
  where r.id = v_job.result_receipt_id and r.consumed_at is null
  for update;

  if not found or v_receipt.canonical_source_url is distinct from v_job.canonical_source_url then
    raise exception using
      message = 'Result already used or not available',
      errcode = 'P0048';
  end if;

  if v_receipt.created_at < now() - interval '7 days' then
    raise exception using
      message = 'Result is older than seven days',
      errcode = 'P0048';
  end if;

  if v_receipt.analysis_result_hash is distinct from p_expected_analysis_result_hash then
    raise exception using
      message = 'Result integrity check failed',
      errcode = 'P0049';
  end if;

  update url_intake_analysis_receipts
     set consumed_at = now()
   where id = v_receipt.id
     and consumed_at is null;

  if not found then
    raise exception using
      message = 'Result already used or not available',
      errcode = 'P0048';
  end if;

  insert into url_intakes (
    id, market_id, canonical_source_url, source_hostname, fetched_at,
    actor_user_id, restaurant_match_type, matched_restaurant_id,
    issued_via_receipt_id, menu_candidate_summary, issued_via_job_id
  ) values (
    p_url_intake_id, v_receipt.market_id, v_receipt.canonical_source_url,
    v_receipt.source_hostname, v_receipt.fetched_at, p_actor_user_id,
    v_receipt.restaurant_match_type, v_receipt.matched_restaurant_id,
    v_receipt.id, v_receipt.candidate_summary -> 'menus', p_job_id
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function create_url_intake_from_batch_job(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function create_url_intake_from_batch_job(uuid, uuid, uuid, text) to service_role;
