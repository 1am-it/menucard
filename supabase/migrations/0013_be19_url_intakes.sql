-- BE-19 — URL Intake (concept intake bridge).
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0012, as a separate, later,
-- explicitly-approved step. Implements the design/schema contract
-- committed at docs/api/url-intake-schema.md and
-- docs/api/restaurant-profile-drafts-schema.md's own "Amendment
-- (2026-09-22, BE-19)" section — see those documents for the full
-- reasoning; this file is deliberately kept close to their wording so
-- the three stay easy to compare line by line.
--
-- `0010_market05c_restaurant_profile_drafts.sql`, `0011_be17_menu_snapshot_foundation.sql`,
-- and `0012_be17_menu_snapshot_grant_correction.sql` are never edited by
-- this migration — not their tables, not their constraints, not their
-- grants, not even their comments. `0010` is treated as an
-- already-applied, live migration (per
-- docs/api/restaurant-profile-drafts-schema.md's own dated status
-- corrections), regardless of what that file's own header comment still
-- says — this migration only ever ADDS to what it already established.

-- ── url_intake_analysis_receipts ─────────────────────────────────────────
--
-- A short-lived, server-side, single-use technical record of one
-- completed URL analysis — NEVER the durable audit record itself (see
-- url_intakes below, and docs/api/url-intake-schema.md's own
-- "Terminology, made explicit"). Reading a URL and issuing a receipt
-- never writes to url_intakes; only a subsequent, deliberate human action
-- does, via create_url_intake_from_receipt() below. A receipt nobody ever
-- redeems leaves no durable trace at all — intentional, not a gap.
--
-- Decided mechanism (docs/api/url-intake-schema.md's own "Analysis-result
-- integrity" section, 2026-09-22): a server-side table, not a stateless
-- signed token — no new signing secret, and single-use replay protection
-- is required regardless of mechanism, which a signed token cannot give
-- without its own server-side "already used" table anyway.

create table if not exists url_intake_analysis_receipts (
  id                    uuid primary key,
  -- Every market-bound record in this project already carries this —
  -- resolved server-side (this project's own single Breda market row
  -- today, looked up by its own stable `slug`, never hardcoded), never
  -- supplied by the client.
  market_id             uuid not null references markets(id),
  -- Who requested the analysis. Re-checked against the caller's own
  -- session at redemption time — see create_url_intake_from_receipt()
  -- below.
  actor_user_id         uuid not null references auth.users(id),
  -- Server-normalized: scheme, host, path only — no query string, no
  -- fragment, ever. See docs/api/url-intake-schema.md's own "URL data
  -- minimisation" section for why. Re-checked against the caller's own
  -- stated URL at redemption time.
  canonical_source_url  text not null check (
                          canonical_source_url ~* '^https?://'
                          and canonical_source_url !~ '[?#]'
                        ),
  source_hostname       text not null,
  fetched_at            timestamptz not null,
  -- Mirrors src/lib/restaurantHostMatch.js's own matchType vocabulary —
  -- descriptive only, re-derived server-side, never itself an
  -- authorization to act.
  restaurant_match_type text not null check (restaurant_match_type in ('exact', 'none', 'multiple')),
  -- The existing data/restaurants.json string key the server's own
  -- hostname match found — a *candidate*, not yet a confirmed durable
  -- fact, until this receipt is actually redeemed.
  matched_restaurant_id text,
  -- The server's own analysis result: normalized restaurant-candidate
  -- fields (name/address/phone/website — the same fixed allowlist
  -- restaurant_profile_draft_field_facts.field_name already enforces,
  -- never a wider set) and the bounded, normalized menu-candidate
  -- summary BE-18's own read-url analysis already produces (context
  -- label, category names, item names, menu-context slug — never
  -- prices/allergens/full descriptions, never raw HTML or a full
  -- JSON-LD document). This is what create_url_intake_from_receipt()
  -- below copies into a new url_intakes row — never anything the client
  -- resubmits directly.
  candidate_summary     jsonb not null,
  -- Hex-encoded SHA-256 over the canonical form of `candidate_summary`
  -- plus this row's own actor/URL/match-type binding — computed once at
  -- issuance, recomputed and compared at redemption as an internal
  -- integrity self-check (protects against this row's own analysis
  -- payload ever drifting from what it claims to describe, the same
  -- reasoning BE-17's own menu-snapshot content hash already applies one
  -- layer up). Never accepted from the client.
  analysis_result_hash  text not null check (analysis_result_hash ~ '^[0-9a-f]{64}$'),
  -- Short-lived by design — see docs/api/url-intake-schema.md's own
  -- "Open questions" for the exact TTL policy, not fixed here at the
  -- schema level.
  expires_at            timestamptz not null,
  -- Null until first (and only) successful redemption. Set atomically,
  -- inside create_url_intake_from_receipt()'s own transaction, guarded
  -- by the `where consumed_at is null` predicate on that function's own
  -- update — never settable by any other path.
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- Supports "find this receipt by id, only if still unconsumed" — the
-- exact access pattern create_url_intake_from_receipt() needs.
create index if not exists idx_url_intake_analysis_receipts_unconsumed
  on url_intake_analysis_receipts (id)
  where consumed_at is null;

-- ── url_intakes ───────────────────────────────────────────────────────────
--
-- The durable audit/traceability record — one row per confirmed human
-- action on an analyzed URL, never one row per page load and never one
-- row per issued receipt. See docs/api/url-intake-schema.md's own
-- "url_intakes — audit/traceability record, not a review queue" section.
-- No status column, no decision/review vocabulary — there is nothing
-- here for a second workflow to move through.

create table if not exists url_intakes (
  id                       uuid primary key,
  market_id                uuid not null references markets(id),
  canonical_source_url     text not null check (
                             canonical_source_url ~* '^https?://'
                             and canonical_source_url !~ '[?#]'
                           ),
  source_hostname          text not null,
  fetched_at               timestamptz not null,
  actor_user_id            uuid not null references auth.users(id),
  restaurant_match_type    text not null check (restaurant_match_type in ('exact', 'none', 'multiple')),
  -- Never a restaurant_profile_drafts id, never any identifier outside
  -- data/restaurants.json's own string-key space. This is the ONLY field
  -- anywhere in this contract a future BE-17 menu-snapshot call may ever
  -- read `restaurant_id` from — see "Hard boundary" in
  -- docs/api/url-intake-schema.md.
  matched_restaurant_id    text,
  -- Set exactly once, at the moment promote_url_intake_to_profile_draft()
  -- creates a new restaurant concept from this intake — never overwritten,
  -- never set by any other path.
  created_profile_draft_id uuid references restaurant_profile_drafts(id),
  -- Which receipt authorized this row's creation — a plain audit
  -- reference, never re-validated after the fact.
  issued_via_receipt_id    uuid references url_intake_analysis_receipts(id),
  -- The same bounded, normalized menu-candidate summary the originating
  -- receipt carried — copied here, once, at redemption time, so a staff
  -- member can later create BE-17 menu proposals without re-fetching.
  -- Never the full captured-content shape BE-17's own menu-snapshot
  -- table itself stores.
  menu_candidate_summary   jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists idx_url_intakes_matched_restaurant
  on url_intakes (matched_restaurant_id)
  where matched_restaurant_id is not null;

-- ── restaurant_profile_drafts: second origin ─────────────────────────────
--
-- `source_candidate_id` becomes nullable, paired with a new, equally
-- real, nullable `source_url_intake_id` — never a polymorphic
-- association. See docs/api/restaurant-profile-drafts-schema.md's own
-- "Amendment (2026-09-22, BE-19)" section for the full reasoning.

alter table restaurant_profile_drafts
  alter column source_candidate_id drop not null;

alter table restaurant_profile_drafts
  add column source_url_intake_id uuid references url_intakes(id);

alter table restaurant_profile_drafts
  add constraint restaurant_profile_drafts_exactly_one_origin
  check ((source_candidate_id is null) <> (source_url_intake_id is null));

-- Replaces the single, candidate-only partial unique index with two
-- separate ones — never one combined coalesce()-based expression index,
-- which would be harder to reason about and to plan queries against.
drop index if exists idx_restaurant_profile_drafts_one_active_per_candidate;

create unique index if not exists idx_restaurant_profile_drafts_one_active_per_candidate
  on restaurant_profile_drafts (source_candidate_id)
  where source_candidate_id is not null and status = 'draft';

create unique index if not exists idx_restaurant_profile_drafts_one_active_per_url_intake
  on restaurant_profile_drafts (source_url_intake_id)
  where source_url_intake_id is not null and status = 'draft';

-- ── restaurant_profile_draft_field_facts: third origin ───────────────────
--
-- `origin` gains `'url_intake'`, alongside a new, equally nullable
-- `source_url_intake_id`. The existing two-way symmetric check is
-- replaced by THREE INDEPENDENT BICONDITIONALS, never one combined
-- `and`/`or` expression — this table has already taught this project
-- this exact lesson once, on its own discard columns (see
-- 0010_market05c_restaurant_profile_drafts.sql's own comment on that
-- fix): a single combined check only requires ONE sub-condition to be
-- false to stay satisfied in the "off" state, not all of them, which
-- previously allowed a partial, invalid state to slip through
-- undetected. Splitting into independent per-value checks closes that
-- exact class of bug for the third origin value too.

alter table restaurant_profile_draft_field_facts
  drop constraint restaurant_profile_draft_field_facts_origin_check;

-- The OLD two-way symmetric check itself must also be dropped, not only
-- the enum check above — 0010 defined it inline
-- (`check ((origin = 'import') = (source_enrichment_id is null))`,
-- without an explicit constraint name), so Postgres auto-named it
-- `restaurant_profile_draft_field_facts_check`. Left in place, it would
-- make every future `origin = 'url_intake'` row impossible to insert:
-- for such a row `source_enrichment_id` is always null, so the OLD
-- check's right-hand side is true while its left-hand side
-- (`origin = 'import'`) is false — a permanent, silent violation. Found
-- and fixed during this migration's own local disposable-Postgres
-- validation, before ever being applied anywhere real.
alter table restaurant_profile_draft_field_facts
  drop constraint restaurant_profile_draft_field_facts_check;

-- References url_intakes(id), never url_intake_analysis_receipts(id) — a
-- field fact traces to the durable intake record, never to the ephemeral
-- receipt that authorized it.
alter table restaurant_profile_draft_field_facts
  add column source_url_intake_id uuid references url_intakes(id);

alter table restaurant_profile_draft_field_facts
  add constraint restaurant_profile_draft_field_facts_origin_check
  check (origin in ('import', 'enrichment', 'url_intake'));

alter table restaurant_profile_draft_field_facts
  add constraint restaurant_profile_draft_field_facts_import_origin_check
  check ((origin = 'import') = (source_enrichment_id is null and source_url_intake_id is null));

alter table restaurant_profile_draft_field_facts
  add constraint restaurant_profile_draft_field_facts_enrichment_origin_check
  check ((origin = 'enrichment') = (source_enrichment_id is not null));

alter table restaurant_profile_draft_field_facts
  add constraint restaurant_profile_draft_field_facts_url_intake_origin_check
  check ((origin = 'url_intake') = (source_url_intake_id is not null));

-- ── Row Level Security — new tables ───────────────────────────────────────
--
-- Same posture as every other table in this pipeline: RLS enabled, zero
-- policies for anon/authenticated/editor/owner — internal-only,
-- enforced at the application layer, never by these tables' own RLS.
-- The internal API always calls as service_role, which bypasses RLS by
-- design; these policies (or their absence) are defense-in-depth only.

alter table url_intake_analysis_receipts enable row level security;
alter table url_intakes                  enable row level security;

revoke all on public.url_intake_analysis_receipts from public, anon, authenticated;
revoke all on public.url_intakes                  from public, anon, authenticated;

-- ── Grants — new tables, revoke-all-then-grant-exact, never additive ─────
--
-- Explicit `revoke all` first on every object this migration grants to,
-- even though these are brand-new tables with no prior grant — matching
-- 0012_be17_menu_snapshot_grant_correction.sql's own "the end state never
-- depends on what was there before this migration ran" discipline, so a
-- re-run of this migration (or a future correction modeled on it) always
-- produces the identical, deterministic grant set.

grant usage on schema public to service_role;

revoke all on public.url_intake_analysis_receipts from service_role;
grant select, insert on public.url_intake_analysis_receipts to service_role;
-- Column-scoped: only `consumed_at` is ever updated after insert, by
-- create_url_intake_from_receipt() itself — id, actor/URL/hash/expiry
-- fields are never updatable, by any role, once written. No delete grant
-- (cleanup of expired rows is an operational, not a schema, concern —
-- see docs/api/url-intake-schema.md's own "Open questions").
grant update (consumed_at) on public.url_intake_analysis_receipts to service_role;

revoke all on public.url_intakes from service_role;
-- select + insert only. `created_profile_draft_id` is set once, at
-- INSERT time, by promote_url_intake_to_profile_draft() (which
-- pre-generates the draft's own id application-side, the same
-- established pattern restaurant_profile_drafts.id itself already
-- uses) — never by a later UPDATE. No update grant at all on this
-- table, and no delete grant.
grant select, insert on public.url_intakes to service_role;

-- ── Grant correction — restaurant_profile_drafts / _field_facts ─────────
--
-- Same discipline as 0012: `revoke all` first (removing whatever
-- privileges currently exist, without needing to enumerate them), then
-- grant back exactly what these two tables' own contracts require — no
-- `truncate`, `trigger`, or `references` for `service_role` on either
-- table. `update`/`delete` posture is otherwise unchanged from what
-- 0010 already established (a narrow, column-scoped update on
-- restaurant_profile_drafts; none at all on the field-facts ledger).

revoke all on public.restaurant_profile_drafts from service_role;
grant select, insert on public.restaurant_profile_drafts to service_role;
grant update (status, discarded_by, discarded_at, discard_note, possible_duplicate_of_draft_id)
  on public.restaurant_profile_drafts to service_role;

revoke all on public.restaurant_profile_draft_field_facts from service_role;
grant select, insert on public.restaurant_profile_draft_field_facts to service_role;
grant usage, select on sequence public.restaurant_profile_draft_field_facts_id_seq to service_role;

-- ── create_url_intake_from_receipt: the only way a url_intakes row is ever created ──
--
-- Single-purpose RPC. Validates and atomically consumes a receipt, then
-- inserts exactly one url_intakes row from the receipt's own,
-- already-server-derived analysis result — never from anything the
-- caller resubmits directly. Re-validates, inside this one transaction:
-- the receipt exists and is not already consumed, has not expired, was
-- issued to this exact actor, and was issued for this exact
-- canonical_source_url. The analysis_result_hash is recomputed
-- (server-side, from this row's own stored candidate_summary plus its
-- own actor/URL/match-type) and compared to the stored value as an
-- internal integrity self-check.

create or replace function create_url_intake_from_receipt(
  p_url_intake_id uuid,
  p_receipt_id uuid,
  p_actor_user_id uuid,
  p_canonical_source_url text,
  p_expected_analysis_result_hash text
)
returns url_intakes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_receipt url_intake_analysis_receipts%rowtype;
  v_result url_intakes%rowtype;
begin
  -- 1. The receipt must exist and not already be consumed. Row-locked
  -- (`for update`) so two concurrent redemption attempts of the same
  -- receipt can never both succeed.
  select * into v_receipt
  from url_intake_analysis_receipts
  where id = p_receipt_id and consumed_at is null
  for update;

  if not found then
    raise exception using
      message = 'Receipt not found or already used',
      errcode = 'P0020';
  end if;

  -- 2. Expiry.
  if v_receipt.expires_at <= now() then
    raise exception using
      message = 'Receipt has expired',
      errcode = 'P0021';
  end if;

  -- 3. Actor binding — never trusts a caller-claimed actor id; the
  -- caller (the API route) passes the *authenticated* session's own
  -- user id here, never a client-supplied value.
  if v_receipt.actor_user_id is distinct from p_actor_user_id then
    raise exception using
      message = 'Receipt was not issued to this account',
      errcode = 'P0022';
  end if;

  -- 4. URL binding — the caller's own stated canonical URL must match
  -- exactly what the receipt was issued for.
  if v_receipt.canonical_source_url is distinct from p_canonical_source_url then
    raise exception using
      message = 'Receipt does not match the given URL',
      errcode = 'P0023';
  end if;

  -- 5. Analysis-hash integrity self-check.
  if v_receipt.analysis_result_hash is distinct from p_expected_analysis_result_hash then
    raise exception using
      message = 'Receipt analysis integrity check failed',
      errcode = 'P0024';
  end if;

  -- 6. Consume — single-use, guarded by the same `where consumed_at is
  -- null` predicate the initial select already required, belt-and-
  -- suspenders against a race the row lock above already prevents.
  update url_intake_analysis_receipts
     set consumed_at = now()
   where id = p_receipt_id
     and consumed_at is null;

  if not found then
    raise exception using
      message = 'Receipt not found or already used',
      errcode = 'P0020';
  end if;

  -- 7. Insert the durable url_intakes row, entirely from the receipt's
  -- own, already-server-derived fields — never from any other input.
  insert into url_intakes (
    id, market_id, canonical_source_url, source_hostname, fetched_at,
    actor_user_id, restaurant_match_type, matched_restaurant_id,
    issued_via_receipt_id, menu_candidate_summary
  ) values (
    p_url_intake_id, v_receipt.market_id, v_receipt.canonical_source_url,
    v_receipt.source_hostname, v_receipt.fetched_at, v_receipt.actor_user_id,
    v_receipt.restaurant_match_type, v_receipt.matched_restaurant_id,
    p_receipt_id, v_receipt.candidate_summary -> 'menus'
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function create_url_intake_from_receipt(uuid, uuid, uuid, text, text) from public;
grant execute on function create_url_intake_from_receipt(uuid, uuid, uuid, text, text) to service_role;

-- ── promote_url_intake_to_profile_draft: a NEW, SEPARATE RPC ─────────────
--
-- `promote_candidate_to_profile_draft(...)` (0010) is NEVER modified by
-- this migration — not its body, not its signature, not its behavior,
-- not even its comments. This is a second, single-purpose RPC for the
-- `source_url_intake_id` origin, mirroring that function's transactional
-- shape (one transaction, security invoker, fixed search_path, typed
-- exceptions) with two deliberate differences: it reads `market_id`
-- directly from `url_intakes.market_id` rather than joining through
-- `import_runs`, and it performs NO `import_candidate_reviews`
-- effective-status check at all, since a `url_intakes` row carries no
-- review-status concept to check. See
-- docs/api/restaurant-profile-drafts-schema.md's own "Amendment
-- (2026-09-22, BE-19)" section for why this is a separate function
-- rather than a branch inside the existing one.

create or replace function promote_url_intake_to_profile_draft(
  p_draft_id uuid,
  p_url_intake_id uuid,
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
  v_intake url_intakes%rowtype;
  v_result restaurant_profile_drafts%rowtype;
  v_candidate jsonb;
begin
  -- 1. The url_intakes row must exist.
  select * into v_intake
  from url_intakes
  where id = p_url_intake_id;

  if not found then
    raise exception using
      message = 'URL intake not found',
      errcode = 'P0025';
  end if;

  -- 2. No *active* draft may already exist for this intake —
  -- belt-and-suspenders alongside the partial unique index, for a
  -- clean, typed error instead of a raw constraint violation.
  if exists (
    select 1 from restaurant_profile_drafts
    where source_url_intake_id = p_url_intake_id and status = 'draft'
  ) then
    raise exception using
      message = 'An active draft already exists for this URL intake',
      errcode = 'P0011';
  end if;

  -- 3. If a restart link was provided, it must actually name a
  -- discarded draft for this same intake.
  if p_restarted_from_draft_id is not null then
    if not exists (
      select 1 from restaurant_profile_drafts
      where id = p_restarted_from_draft_id
        and source_url_intake_id = p_url_intake_id
        and status = 'discarded'
    ) then
      raise exception using
        message = 'restarted_from_draft_id must reference a discarded draft for the same URL intake',
        errcode = 'P0012';
    end if;
  end if;

  -- 4. Insert the draft header row.
  begin
    insert into restaurant_profile_drafts (
      id, market_id, source_url_intake_id, status, promoted_by, promoted_at,
      restarted_from_draft_id, possible_duplicate_of_draft_id
    ) values (
      p_draft_id, v_intake.market_id, p_url_intake_id, 'draft', p_actor_user_id, now(),
      p_restarted_from_draft_id, p_possible_duplicate_of_draft_id
    )
    returning * into v_result;
  exception
    when unique_violation then
      raise exception using
        message = 'An active draft already exists for this URL intake',
        errcode = 'P0011';
  end;

  -- 5. Snapshot the intake's candidate restaurant fields into the
  -- draft's initial field facts, tagged origin = 'url_intake'. These
  -- fields are deliberately never duplicated onto url_intakes itself
  -- (see docs/api/url-intake-schema.md's own "Data minimisation" —
  -- "there is exactly one place a restaurant concept's field values
  -- ever live"), so they are read here from the ORIGINATING RECEIPT's
  -- own candidate_summary (`{restaurant: {...}, menus: [...]}`) via
  -- issued_via_receipt_id — the receipt row itself is only ever marked
  -- consumed, never deleted, so it remains readable at promotion time.
  -- A field absent there is simply not recorded as a fact at all, never
  -- an empty-string placeholder. If the receipt row is ever pruned by a
  -- future cleanup job before promotion happens (not built; see
  -- docs/api/url-intake-schema.md's own "Open questions"), this
  -- degrades to recording no restaurant fields at all rather than
  -- erroring — a stale/missing receipt must never block an otherwise
  -- valid promotion of an already-durable url_intakes row.
  select r.candidate_summary -> 'restaurant' into v_candidate
  from url_intake_analysis_receipts r
  where r.id = v_intake.issued_via_receipt_id;

  insert into restaurant_profile_draft_field_facts (draft_id, field_name, value, origin, source_url_intake_id, recorded_by)
  select v_result.id, t.field_name, t.value, 'url_intake', p_url_intake_id, p_actor_user_id
  from (
    values
      ('name', v_candidate ->> 'name'),
      ('category', v_candidate ->> 'category'),
      ('address', v_candidate ->> 'address'),
      ('phone', v_candidate ->> 'phone'),
      ('website', v_candidate ->> 'website')
  ) as t(field_name, value)
  where t.value is not null and btrim(t.value) <> '';

  return v_result;
end;
$$;

revoke all on function promote_url_intake_to_profile_draft(uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function promote_url_intake_to_profile_draft(uuid, uuid, uuid, uuid, uuid) to service_role;
