-- 0018 — BE-17 Menuconcepten beoordelen v1.
--
-- Additive only. Two parts:
--
-- 1. Audit fields on menu_snapshot_proposals, filled by the server for
--    every new concept version (historical rows may stay empty):
--      created_by           — the staff member who created the version;
--      origin_receipt_id    — the analysis result (BE-19/BE-25 receipt) the
--                             recognised dishes come from;
--      based_on_snapshot_id — the version a reviewer's correction builds on.
--    Versions stay immutable: service_role keeps select/insert only (0012).
--
-- 2. record_menu_snapshot_decision: one internal review decision
--    (approved_internal or rejected) on the latest version of a concept,
--    serialised per concept lineage with an advisory lock:
--      - a version that is not the latest, or not the version the client
--        expected, is refused (P0061) and never silently decided;
--      - the same decision twice yields one review row (idempotent);
--      - the reason rule stays the table's own check (0011): a reason
--        exactly when the decision is rejected.
--    The completeness and source checks happen in the server before the
--    call (src/lib/menuConceptReviewHandlers.js). Nothing here publishes.

alter table menu_snapshot_proposals
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists origin_receipt_id uuid references url_intake_analysis_receipts(id),
  add column if not exists based_on_snapshot_id bigint references menu_snapshot_proposals(id);

alter table menu_snapshot_proposals
  add constraint menu_snapshot_proposals_based_on_other
  check (based_on_snapshot_id is null or based_on_snapshot_id <> id);

create index if not exists idx_menu_snapshot_proposals_origin_receipt
  on menu_snapshot_proposals (origin_receipt_id)
  where origin_receipt_id is not null;

create index if not exists idx_menu_snapshot_proposals_based_on
  on menu_snapshot_proposals (based_on_snapshot_id)
  where based_on_snapshot_id is not null;

create or replace function record_menu_snapshot_decision(
  p_snapshot_id bigint,
  p_expected_version integer,
  p_decision text,
  p_reason text,
  p_note text,
  p_actor_user_id uuid
)
returns table (review_id bigint, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_snapshot menu_snapshot_proposals%rowtype;
  v_latest integer;
  v_last menu_snapshot_reviews%rowtype;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_decision is null or p_decision not in ('approved_internal', 'rejected') then
    raise exception using
      message = 'Only approved_internal or rejected can be recorded here',
      errcode = 'P0062';
  end if;

  select * into v_snapshot from menu_snapshot_proposals s where s.id = p_snapshot_id;
  if not found then
    raise exception using
      message = 'Menu concept version not found',
      errcode = 'P0060';
  end if;

  perform pg_advisory_xact_lock(4026, hashtext(v_snapshot.restaurant_id || '/' || v_snapshot.menu_context));

  select max(s.version) into v_latest
  from menu_snapshot_proposals s
  where s.restaurant_id = v_snapshot.restaurant_id
    and s.menu_context = v_snapshot.menu_context;

  if v_snapshot.version is distinct from p_expected_version or v_snapshot.version <> v_latest then
    raise exception using
      message = 'This concept version is no longer the latest',
      errcode = 'P0061';
  end if;

  select * into v_last
  from menu_snapshot_reviews r
  where r.snapshot_id = p_snapshot_id
  order by r.decided_at desc, r.id desc
  limit 1;

  if found
     and v_last.decision = p_decision
     and v_last.reason is not distinct from p_reason then
    review_id := v_last.id;
    created := false;
    return next;
    return;
  end if;

  insert into menu_snapshot_reviews (snapshot_id, reviewer_id, decision, reason, note)
  values (p_snapshot_id, p_actor_user_id, p_decision, p_reason, v_note)
  returning id into review_id;
  created := true;
  return next;
end;
$$;

revoke all on function record_menu_snapshot_decision(bigint, integer, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function record_menu_snapshot_decision(bigint, integer, text, text, text, uuid) to service_role;
