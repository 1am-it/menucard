-- BE-25 fase 2 — "Opnieuw analyseren": a fresh analysis of exactly one URL
-- after an explicit human click.
--
-- NOT YET APPLIED. Written and structurally tested only. Release it on its
-- own, through the approved migration pipeline, before the app code that
-- calls it (docs/guides/production-migration-pipeline.md, "Release
-- sequencing"). Contract:
-- planning/specs/tickets/be-25-batch-source-analysis-from-triage.md
-- ("Manual re-analysis": always a new batch with exactly that one URL,
-- counting towards the daily limit).
--
-- Additive only: one new function. 0001-0016 are never edited, and
-- enqueue_source_analysis_batch (0016) is unchanged. The only difference
-- from that function is that a successful result of at most 7 days does
-- NOT turn the URL into a "recent" line: the staff member asked for a
-- fresh analysis. Every other rule is the same: one URL, the starter as
-- actor, idempotent on the client-generated batch id, one open batch per
-- starter, no open job for the URL in another batch, and the daily limit
-- of 25 queued URLs per calendar day (Europe/Amsterdam). Processing stays
-- page-bound through claim_next_source_analysis_job (0016).

create or replace function enqueue_source_reanalysis(
  p_batch_id uuid,
  p_market_id uuid,
  p_actor_user_id uuid,
  p_url text
)
returns url_intake_batches
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz constant text := 'Europe/Amsterdam';
  v_batch url_intake_batches%rowtype;
  v_url text := btrim(p_url);
  v_host text;
  v_used integer;
  v_job_id uuid;
begin
  -- The same lock as enqueue_source_analysis_batch: both enqueue paths see
  -- one consistent state for idempotency, open batches and the daily limit.
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

  v_host := regexp_replace(lower(substring(v_url from '^[A-Za-z]+://([^/:]+)')), '^www\.', '');
  if v_url is null
     or char_length(v_url) > 2048
     or v_url !~* '^https?://'
     or v_url ~ '[?#[:space:]]'
     or v_host is null
     or v_host !~ '^[a-z0-9.-]{1,253}$' then
    raise exception using
      message = 'Not a valid canonical URL',
      errcode = 'P0050';
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
  values (p_batch_id, p_market_id, p_actor_user_id, now(), now(), 1)
  returning * into v_batch;

  -- An open job for this URL in another batch: not queued again (same
  -- outcome as enqueue_source_analysis_batch), the batch closes at once.
  if exists (
    select 1 from restaurant_source_analysis_jobs o
    where o.market_id = p_market_id
      and o.canonical_source_url = v_url
      and o.batch_id is not null
      and o.status in ('pending', 'running')
      and o.expired_at is null
  ) then
    insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome)
    values (p_batch_id, 1, v_url, 'already_active');
    update url_intake_batches b
    set closed_at = now(), close_reason = 'completed'
    where b.id = p_batch_id
    returning * into v_batch;
    return v_batch;
  end if;

  -- Deliberately no 7-day reuse check here: this is the explicit re-analysis.
  v_job_id := gen_random_uuid();
  insert into restaurant_source_analysis_jobs (
    id, market_id, actor_user_id, canonical_source_url, status, batch_id, source_host
  ) values (
    v_job_id, p_market_id, p_actor_user_id, v_url, 'pending', p_batch_id, v_host
  );
  insert into url_intake_batch_items (batch_id, item_position, canonical_source_url, outcome, job_id)
  values (p_batch_id, 1, v_url, 'queued', v_job_id);

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

  return v_batch;
end;
$$;

-- Revoked explicitly from anon and authenticated too: Supabase's default
-- privileges grant EXECUTE on new functions to them directly.
revoke all on function enqueue_source_reanalysis(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function enqueue_source_reanalysis(uuid, uuid, uuid, text) to service_role;
