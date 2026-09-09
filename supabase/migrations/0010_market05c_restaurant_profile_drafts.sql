-- MARKET-05C — Restaurant Profile Drafts.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0009, as a separate, later,
-- explicitly-approved step. Implements the design/schema contract
-- committed at docs/api/restaurant-profile-drafts-schema.md exactly — see
-- that document for the full reasoning; this file is deliberately kept
-- close to its wording so the two stay easy to compare line by line.
--
-- A small, internal-only staging layer that lets staff explicitly promote
-- one already-`approved_internal` import candidate (MARKET-05A) into a
-- durable draft record. Never merges two candidates, never touches a
-- canonical/public table, never touches `staff_roles`/`restaurant_claims`,
-- and does not depend on or wait for `MARKET-05B`'s eventual cross-source
-- matching/deduplication (see the schema contract's "Pipeline position"
-- for why gate 3B does not apply here).
--
-- Updated in place (2026-09-06, later still — discard/duplicate follow-up
-- round), not a new migration file: this migration had not yet been
-- applied live, so its own correction (`discard_note` made mandatory when
-- discarding — see that column and `discard_profile_draft` below) is
-- folded directly into it, per this project's own convention of only
-- ever creating a new numbered migration for something already live.

-- ── restaurant_profile_drafts ────────────────────────────────────────────
--
-- One row per promotion event, not one row per candidate over time — a
-- discarded draft is never deleted or resurrected; a later change of mind
-- is a brand-new row (see "Discard is permanent; restart is a new row"
-- below and the schema contract's own section of the same name).
--
-- `id` is supplied by the caller (UUIDv7, generated application-side —
-- mirrors MARKET-04A's existing convention for identity-bearing entities,
-- e.g. `markets`/`import_runs`), never `gen_random_uuid()` (UUIDv4) and
-- never `generated always as identity` (that pattern is reserved in this
-- project for pure audit-log rows like `import_candidate_reviews`, which
-- this is not — a draft is itself a persistent, referenceable identity).

create table if not exists restaurant_profile_drafts (
  id                              uuid primary key,
  market_id                       uuid not null references markets(id),
  source_candidate_id             uuid not null references import_extraction_records(id),
  status                          text not null default 'draft' check (status in ('draft', 'discarded')),
  promoted_by                     uuid not null references auth.users(id),
  promoted_at                     timestamptz not null default now(),
  -- Set only when this draft is a deliberate re-promotion of a candidate
  -- whose earlier draft was discarded. Validated by the promotion RPC
  -- below (must name an existing `discarded` draft with the same
  -- `source_candidate_id`) — not a table constraint, since that check
  -- spans two rows.
  restarted_from_draft_id         uuid references restaurant_profile_drafts(id),
  -- Set only when promotion proceeded despite a flagged possible
  -- duplicate (see "Duplicate handling" below). Never auto-resolved.
  possible_duplicate_of_draft_id  uuid references restaurant_profile_drafts(id),
  discarded_by                    uuid references auth.users(id),
  discarded_at                    timestamptz,
  -- Correction (2026-09-06, later still — discard/duplicate follow-up
  -- round): a short internal discard reason is mandatory, not optional —
  -- this contract's own "Open decisions" originally left the choice
  -- between free text and a fixed enum open, but never said the field
  -- itself could be skipped. Non-null AND non-blank whenever
  -- status = 'discarded' (folded into the symmetric check below, the
  -- same idiom this project already uses for
  -- import_candidate_reviews' rejected/rejection_reason pair) — and,
  -- symmetrically, never set while status = 'draft'.
  discard_note                    text check (discard_note is null or char_length(discard_note) <= 2000),
  created_at                      timestamptz not null default now(),
  -- Three independent biconditionals, not one combined `and` — found and
  -- fixed during this round's own local validation (2026-09-06, later
  -- still): `(status = 'discarded') = (A and B and C)` only requires ALL
  -- three when discarded, but while `status = 'draft'` it only requires
  -- *at least one* of them to be false, not all three — meaning
  -- `discard_note` alone could be set on an active draft (verified: a
  -- direct `update ... set discard_note = 'x'` on a `status = 'draft'`
  -- row satisfied that single combined check). Tying each column to
  -- `status = 'discarded'` on its own closes this — none of the three
  -- may be set while `status = 'draft'`, and all three are required the
  -- moment it is `'discarded'`.
  check ((status = 'discarded') = (discarded_by is not null)),
  check ((status = 'discarded') = (discarded_at is not null)),
  check ((status = 'discarded') = (discard_note is not null and btrim(discard_note) <> ''))
);

-- Discard is permanent; restart is a new row.
--
-- `source_candidate_id`'s uniqueness is a PARTIAL index — "at most one
-- *active* draft per candidate" — never a plain column-level `unique`.
-- A plain `unique` would make a legitimate, deliberate restart
-- structurally impossible after the first discard, not merely "not
-- automatic": the discarded row would permanently occupy the slot. This
-- is the exact same pattern `0003_restaurant_claims.sql`'s
-- `idx_restaurant_claims_one_pending_per_user` already established for an
-- identical shape of problem.
create unique index if not exists idx_restaurant_profile_drafts_one_active_per_candidate
  on restaurant_profile_drafts (source_candidate_id)
  where status = 'draft';

-- Supports "every draft (active or discarded) for this candidate" — the
-- exact access pattern the promotion RPC's restart/duplicate checks and a
-- future draft-history view both need.
create index if not exists idx_restaurant_profile_drafts_candidate
  on restaurant_profile_drafts (source_candidate_id);

-- ── restaurant_profile_draft_field_facts ─────────────────────────────────
--
-- Append-only value ledger — one row per fact (one field, one value, one
-- origin), never one row per draft. Exactly mirrors
-- `import_candidate_enrichments`' own shape discipline one layer up.
--
-- `origin` is never a third value beyond `import`/`enrichment` — there is
-- deliberately no free-form "manual correction on the draft" path. A
-- correction always happens on the *source candidate* first (a new
-- `import_candidate_enrichments` row, through the existing, unchanged
-- `/internal/import-inbox` enrichment form), so every draft value, past
-- and present, remains traceable to something that already existed in
-- `import_extraction_records` or `import_candidate_enrichments` before
-- this fact was written. See the schema contract's "Field-level
-- provenance" section for the full reasoning.

create table if not exists restaurant_profile_draft_field_facts (
  id                    bigint generated always as identity primary key,
  draft_id              uuid not null references restaurant_profile_drafts(id),
  -- Fixed set — deliberately identical scope to what MARKET-05A already
  -- collects. No menu, price, photo, marketing, or owner-contact field
  -- exists in this list, physically, not just by convention.
  field_name            text not null check (field_name in ('name', 'category', 'address', 'phone', 'website')),
  value                 text not null,
  origin                text not null check (origin in ('import', 'enrichment')),
  -- Required exactly when origin = 'enrichment', forbidden otherwise —
  -- the same symmetric-check idiom used throughout this project (e.g.
  -- import_candidate_reviews' rejected/rejection_reason pair).
  source_enrichment_id  bigint references import_candidate_enrichments(id),
  recorded_by           uuid not null references auth.users(id),
  recorded_at           timestamptz not null default now(),
  check ((origin = 'import') = (source_enrichment_id is null))
);

-- Supports "every fact for this field, newest first" — the exact access
-- pattern the "current effective value" derivation needs (application
-- code, mirroring pickLatestEnrichmentRow's own tie-break: recorded_at,
-- then higher id).
create index if not exists idx_restaurant_profile_draft_field_facts_draft_field
  on restaurant_profile_draft_field_facts (draft_id, field_name, recorded_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Same posture as import_extraction_records/import_candidate_reviews/
-- import_candidate_enrichments: RLS enabled, zero policies for
-- anon/authenticated/editor/owner — `internal`-only, enforced at the
-- application layer (authenticateInternalRequest + isInternalOnly), never
-- by these tables' own RLS. The internal API always calls as
-- service_role, which bypasses RLS by design; these policies (or their
-- absence) are defense-in-depth only.

alter table restaurant_profile_drafts            enable row level security;
alter table restaurant_profile_draft_field_facts enable row level security;

revoke all on public.restaurant_profile_drafts            from public, anon, authenticated;
revoke all on public.restaurant_profile_draft_field_facts from public, anon, authenticated;

grant usage on schema public to service_role;

-- restaurant_profile_drafts: select + insert, plus a narrow, column-scoped
-- update grant limited to exactly the discard-related columns — never a
-- blanket table update. id/market_id/source_candidate_id/promoted_by/
-- promoted_at/restarted_from_draft_id are never updatable, by any role,
-- once written. Mirrors import_runs' own
-- `grant update (status, completed_at, record_counts, error_log, checkpoint)`
-- precedent exactly.
grant select, insert on public.restaurant_profile_drafts to service_role;
grant update (status, discarded_by, discarded_at, discard_note, possible_duplicate_of_draft_id)
  on public.restaurant_profile_drafts to service_role;

-- restaurant_profile_draft_field_facts: append-only — select + insert
-- only, no update/delete grant at all, for any role, ever, physically
-- enforced regardless of any future application-code bug.
grant select, insert on public.restaurant_profile_draft_field_facts to service_role;
grant usage, select on sequence public.restaurant_profile_draft_field_facts_id_seq to service_role;

-- No delete grant anywhere in this migration.

-- ── promote_candidate_to_profile_draft: the only way to create a draft ──
--
-- Single-purpose RPC, mirroring record_import_candidate_review's/
-- approve_pending_change's existing pattern (SECURITY INVOKER — the
-- default, kept explicit, since this is only ever called by service_role,
-- which already holds direct grants and BYPASSRLS; fixed search_path to
-- prevent search_path-hijacking; one transaction).
--
-- `p_draft_id` is supplied by the caller (see the table comment above —
-- UUIDv7, application-generated). `p_possible_duplicate_of_draft_id` and
-- `p_restarted_from_draft_id` are computed by the caller (the API route)
-- using already-tested application logic (the possible-duplicate name+
-- distance heuristic, and "does a discarded draft already exist for this
-- candidate") — this function's own job is purely the atomic, validated
-- write, never the heuristics themselves.

create or replace function promote_candidate_to_profile_draft(
  p_draft_id uuid,
  p_candidate_id uuid,
  p_actor_user_id uuid,
  p_possible_duplicate_of_draft_id uuid default null,
  p_restarted_from_draft_id uuid default null
)
returns restaurant_profile_drafts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_market_id uuid;
  v_extracted jsonb;
  v_effective_status text;
  v_addr_enrichment import_candidate_enrichments%rowtype;
  v_phone_enrichment import_candidate_enrichments%rowtype;
  v_website_enrichment import_candidate_enrichments%rowtype;
  v_result restaurant_profile_drafts%rowtype;
begin
  -- 1. Candidate must exist. Resolves market_id (via its import_run) and
  -- extracted_fields in the same lookup — never a second query for the
  -- same row.
  select ir.market_id, ier.extracted_fields
    into v_market_id, v_extracted
  from import_extraction_records ier
  join import_runs ir on ir.id = ier.import_run_id
  where ier.id = p_candidate_id;

  if v_market_id is null then
    raise exception using
      message = 'Candidate not found',
      errcode = 'P0002';
  end if;

  -- 2. Re-derive the candidate's *effective* review status server-side —
  -- the latest import_candidate_reviews row for this candidate, newest
  -- decided_at then higher id (the exact same tie-break
  -- computeEffectiveReviewStatus/pickLatestReviewRow already use in
  -- application code). Never trusts a client-sent status. Must be
  -- 'approved_internal', or this promotion is refused outright.
  select status
    into v_effective_status
  from import_candidate_reviews
  where candidate_id = p_candidate_id
  order by decided_at desc, id desc
  limit 1;

  if v_effective_status is distinct from 'approved_internal' then
    raise exception using
      message = 'Candidate is not approved_internal',
      errcode = 'P0010';
  end if;

  -- 3. No *active* draft may already exist for this candidate —
  -- belt-and-suspenders alongside the partial unique index above, for a
  -- clean, typed error instead of a raw constraint violation. A
  -- `discarded` draft for the same candidate is expected and never blocks
  -- this (that is exactly what a restart is).
  if exists (
    select 1 from restaurant_profile_drafts
    where source_candidate_id = p_candidate_id and status = 'draft'
  ) then
    raise exception using
      message = 'An active draft already exists for this candidate',
      errcode = 'P0011';
  end if;

  -- 4. If a restart link was provided, it must actually name a discarded
  -- draft for this same candidate — a caller-provided value is never
  -- trusted without this check, the same discipline every other RPC in
  -- this project applies to its own inputs.
  if p_restarted_from_draft_id is not null then
    if not exists (
      select 1 from restaurant_profile_drafts
      where id = p_restarted_from_draft_id
        and source_candidate_id = p_candidate_id
        and status = 'discarded'
    ) then
      raise exception using
        message = 'restarted_from_draft_id must reference a discarded draft for the same candidate',
        errcode = 'P0012';
    end if;
  end if;

  -- 5. Insert the draft header row.
  begin
    insert into restaurant_profile_drafts (
      id, market_id, source_candidate_id, status, promoted_by, promoted_at,
      restarted_from_draft_id, possible_duplicate_of_draft_id
    ) values (
      p_draft_id, v_market_id, p_candidate_id, 'draft', p_actor_user_id, now(),
      p_restarted_from_draft_id, p_possible_duplicate_of_draft_id
    )
    returning * into v_result;
  exception
    when unique_violation then
      -- A genuine race with another concurrent promotion of the same
      -- candidate — the partial unique index is the real enforcement;
      -- this only turns it into the same friendly, typed error the
      -- pre-check above already gives the common case.
      raise exception using
        message = 'An active draft already exists for this candidate',
        errcode = 'P0011';
  end;

  -- 6. Snapshot the candidate's current effective values into the
  -- draft's initial field facts — the exact same "latest enrichment, or
  -- raw if none" derivation computeEnrichedFields already performs in
  -- application code, for each of address/phone/website independently;
  -- name/category always come straight from extracted_fields (no
  -- enrichment concept exists for those two fields).
  select * into v_addr_enrichment from import_candidate_enrichments
    where candidate_id = p_candidate_id and field_name = 'address'
    order by recorded_at desc, id desc limit 1;
  select * into v_phone_enrichment from import_candidate_enrichments
    where candidate_id = p_candidate_id and field_name = 'phone'
    order by recorded_at desc, id desc limit 1;
  select * into v_website_enrichment from import_candidate_enrichments
    where candidate_id = p_candidate_id and field_name = 'website'
    order by recorded_at desc, id desc limit 1;

  insert into restaurant_profile_draft_field_facts (draft_id, field_name, value, origin, source_enrichment_id, recorded_by)
  select v_result.id, t.field_name, t.value, t.origin, t.source_enrichment_id, p_actor_user_id
  from (
    values
      ('name', v_extracted ->> 'name', 'import', null::bigint),
      ('category', v_extracted ->> 'category', 'import', null::bigint),
      (
        'address',
        coalesce(v_addr_enrichment.value, v_extracted ->> 'address'),
        case when v_addr_enrichment.id is not null then 'enrichment' else 'import' end,
        v_addr_enrichment.id
      ),
      (
        'phone',
        coalesce(v_phone_enrichment.value, v_extracted ->> 'phone'),
        case when v_phone_enrichment.id is not null then 'enrichment' else 'import' end,
        v_phone_enrichment.id
      ),
      (
        'website',
        coalesce(v_website_enrichment.value, v_extracted ->> 'website'),
        case when v_website_enrichment.id is not null then 'enrichment' else 'import' end,
        v_website_enrichment.id
      )
  ) as t(field_name, value, origin, source_enrichment_id)
  -- A field absent from both the raw import and any enrichment is simply
  -- not recorded as a fact at all — "missing" means "absent," never an
  -- empty-string placeholder (mirrors computeQualityStatus's own
  -- convention one layer up).
  where t.value is not null and btrim(t.value) <> '';

  return v_result;
end;
$$;

revoke all on function promote_candidate_to_profile_draft(uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function promote_candidate_to_profile_draft(uuid, uuid, uuid, uuid, uuid) to service_role;

-- ── discard_profile_draft: the only way to discard a draft ──────────────
--
-- Single-purpose RPC, same pattern as above. Valid only from
-- status = 'draft' — discarding an already-discarded draft, or one that
-- does not exist, is refused with a typed error rather than silently
-- succeeding. Never deletes the row or any of its field facts.
--
-- Correction (2026-09-06, later still — discard/duplicate follow-up
-- round): `p_note` is validated here explicitly — required, non-blank —
-- before ever attempting the update, so a caller gets the same clear,
-- typed error this project's other RPCs already give for missing
-- required input (mirrors record_candidate_enrichments' own "at least
-- one field is required" guard, P0003), rather than a raw check-
-- constraint violation. The table's own constraint (above) remains the
-- final, authoritative enforcement regardless — this is defense in
-- depth, matching the application layer's own validateDiscardRequestInput
-- (src/lib/restaurantProfileDrafts.js), which is what actually gives an
-- API caller a `400` before ever reaching this function.

create or replace function discard_profile_draft(
  p_draft_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns restaurant_profile_drafts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result restaurant_profile_drafts%rowtype;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception using
      message = 'A discard reason is required',
      errcode = 'P0014';
  end if;

  update restaurant_profile_drafts
  set status = 'discarded',
      discarded_by = p_actor_user_id,
      discarded_at = now(),
      discard_note = btrim(p_note)
  where id = p_draft_id
    and status = 'draft'
  returning * into v_result;

  if not found then
    raise exception using
      message = 'Draft not found or already discarded',
      errcode = 'P0013';
  end if;

  return v_result;
end;
$$;

revoke all on function discard_profile_draft(uuid, uuid, text) from public;
grant execute on function discard_profile_draft(uuid, uuid, text) to service_role;
