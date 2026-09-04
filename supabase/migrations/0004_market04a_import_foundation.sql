-- MARKET-04A — Blobless import persistence foundation.
--
-- NOT YET APPLIED. Written and locally reviewed only, per the committed
-- documentation decision in docs/api/market-entity-schema.md,
-- docs/api/source-registry-schema.md, and docs/api/import-run-schema.md
-- (all three "Amendment (2026-09-04): physical operational base"
-- sections) and planning/specs/tickets/market-04-raw-imports-import-runs.md's
-- hard gate 4A/4B split. Running this migration is a separate, later,
-- explicitly-approved step — see this project's own live-verification
-- discipline in docs/guides/internal-api-live-testing.md before that
-- happens.
--
-- Scope, exactly as decided — nothing more:
--   - Six tables: markets, sources, source_authorization_versions,
--     market_boundary_versions, import_runs, import_extraction_records.
--   - No raw blobs, no PostGIS, no canonical restaurant/menu tables, no
--     consumer read path, no public API. Gate 4B (the encrypted,
--     unredacted raw-blob exception) is untouched and out of scope.
--   - Every id is a uuid, supplied by the caller (UUIDv7, generated
--     application-side via the already-tested generateUuidV7() in
--     ops/scripts/capture-market-boundary.js) — never
--     `generated always as identity` and never Postgres's own
--     gen_random_uuid() (that produces UUIDv4).
--
-- Run this in the Supabase SQL Editor after 0001-0003, in a fresh or
-- existing project that already has those applied. This migration does
-- not depend on 0001-0003's tables and does not modify them.

-- ── markets ──────────────────────────────────────────────────────────────
--
-- docs/api/market-entity-schema.md's `market` entity. `current_boundary_version_id`
-- is the physical realization of that document's `market.boundary` field
-- (invariant 1) — the *only* mutable "which version is current" pointer in
-- this whole schema. Its foreign key is added further down, once
-- market_boundary_versions exists (the two tables reference each other).

create table if not exists markets (
  id                          uuid primary key,
  slug                        text not null unique,
  name                        text not null,
  country_code                text not null,
  timezone                    text not null,
  default_currency            text not null,
  supported_languages         text[] not null default '{}',
  launch_status               text not null check (launch_status in ('draft', 'seeding', 'live', 'paused')),
  readiness_status            text not null check (readiness_status in ('go', 'conditional_go', 'no_go')),
  current_boundary_version_id uuid, -- FK added below, after market_boundary_versions exists
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ── sources ──────────────────────────────────────────────────────────────
--
-- docs/api/source-registry-schema.md's `Source` — identity/description
-- only. Deliberately has NO "current authorization version" pointer: see
-- that document's "No global 'current authorization' pointer — corrected
-- 2026-09-04" section. A SourceAuthorizationVersion is scope- and
-- time-bound (per market/country/access-route/processing-stage); a single
-- global "current" pointer here would be semantically wrong, not merely
-- unbuilt. Every record that needs one (market_boundary_versions,
-- import_runs) names its own exact, applicable version directly.

create table if not exists sources (
  id                    uuid primary key,
  -- Doc names this field "legacy_ids[] / external_ids[]" (an aka, not two
  -- separate fields) — {scheme, value}[], same convention as MARKET-02.
  -- Not populated by any of the three seeded sources.
  external_ids          jsonb not null default '[]'::jsonb,
  name                  text not null unique,
  operator              text,
  source_type           text not null check (source_type in (
                          'restaurant_own_website', 'restaurant_pdf_menu', 'owner_direct_submission',
                          'government_open_data', 'poi_directory', 'community_contribution', 'other'
                        )),
  official_location     text,
  refresh_policy        text not null check (refresh_policy in (
                          'manual_on_demand', 'periodic_30d', 'event_driven', 'periodic_annual'
                        )),
  freshness_expectation interval,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── source_authorization_versions ───────────────────────────────────────
--
-- docs/api/source-registry-schema.md's `SourceAuthorizationVersion`.
-- Append-only (see grants below): a version, once created, is never
-- edited (invariant 2). `supersedes_version` replaces the old,
-- self-contradictory `superseded_by`/`superseded_at` pair (corrected
-- 2026-09-04) — set once, at creation, pointing backward only.
--
-- `unique (source_id, id)` looks redundant with the primary key alone,
-- but is required so market_boundary_versions and import_runs can each
-- take a composite foreign key against (source_id, id) — physically
-- guaranteeing "this authorization version actually belongs to this
-- source" instead of trusting two independently-set columns to agree.

create table if not exists source_authorization_versions (
  id                           uuid primary key,
  source_id                    uuid not null references sources(id),
  version_number               integer not null,
  status                       text not null check (status in ('pending_review', 'allowed', 'restricted', 'blocked')),
  status_reason                text,
  terms_reference              text,
  terms_version                text,
  terms_retrieved_at           date,
  allowed_data_categories      text[] not null default '{}'
                                check (allowed_data_categories <@ array['basic_info', 'geospatial_reference_data']::text[]),
  excluded_data_categories     text[] not null default '{}'
                                check (excluded_data_categories <@ array['basic_info', 'geospatial_reference_data']::text[]),
  allowed_access_method        text check (allowed_access_method in (
                                  'manual_entry', 'owner_submission', 'automated_fetch_source_approved_domain',
                                  'authenticated_api', 'licensed_dataset_download', 'open_dataset_download', 'open_api_query'
                                )),
  -- (added 2026-09-05) additional, validation/freshness-only routes — never
  -- sufficient on their own to establish or update the authoritative
  -- version-of-record (see that amendment's own invariant).
  supplementary_access_methods text[] not null default '{}'
                                check (supplementary_access_methods <@ array[
                                  'manual_entry', 'owner_submission', 'automated_fetch_source_approved_domain',
                                  'authenticated_api', 'licensed_dataset_download', 'open_dataset_download', 'open_api_query'
                                ]::text[]),
  access_provider_note         text,
  -- (added 2026-09-04) NULL = unset, status alone governs (every
  -- pre-existing/other version's behaviour, unaffected). A non-null,
  -- non-full array narrows this specific version to exactly those
  -- pipeline stages — see the restricted_pending check below.
  allowed_processing_stages    text[]
                                check (allowed_processing_stages <@ array[
                                  'raw_import', 'internal_quality_review', 'moderation_preparation',
                                  'canonical_merge', 'public_publication', 'api_exposure', 'redistribution'
                                ]::text[]),
  restricted_pending           text,
  reuse_rights                 jsonb,
  geographic_applicability     jsonb,
  -- Bootstrap-reference discipline (docs/api/source-registry-schema.md's
  -- "reviewed_by: product_owner" section): a real Supabase Auth account
  -- does not exist yet for this actor, so this is deliberately `text`,
  -- not `uuid references auth.users(id)` — unlike 0001-0003's tables,
  -- which do reference real accounts.
  reviewed_by                  text,
  reviewed_at                  date,
  -- "Every reviewed source gets a re-review date" — a documented
  -- expectation, not enforced here as a hard NOT NULL (the doc does not
  -- state one; version 1's pending_review state, per invariant 1, may
  -- legitimately have none yet).
  next_review_due              date,
  effective_from               timestamptz not null,
  supersedes_version           uuid references source_authorization_versions(id),
  created_at                   timestamptz not null default now(),
  unique (source_id, version_number),
  unique (source_id, id),
  -- Original invariants 1-3 (pending_review is the only valid default;
  -- allowed/restricted requires terms+reviewer+date+reason; blocked
  -- requires reviewer+date+reason but not necessarily terms).
  check (
    status = 'pending_review'
    or (status in ('allowed', 'restricted') and terms_reference is not null and reviewed_by is not null and reviewed_at is not null and status_reason is not null)
    or (status = 'blocked' and status_reason is not null and reviewed_by is not null and reviewed_at is not null)
  ),
  -- New invariant 6 (2026-09-04): restricted_pending is mandatory whenever
  -- allowed_processing_stages excludes at least one of the 7 defined
  -- stages. The literal "7" is the fixed enum's own size, checked above.
  check (
    allowed_processing_stages is null
    or cardinality(allowed_processing_stages) = 7
    or restricted_pending is not null
  )
);

-- ── market_boundary_versions ─────────────────────────────────────────────
--
-- docs/api/market-entity-schema.md's `MarketBoundaryVersion`. Append-only
-- (see grants below) — invariant 2. `source_id`/`source_authorization_version_id`
-- resolve what used to be a vague `source` text/reference field (corrected
-- 2026-09-04); the composite foreign key against
-- source_authorization_versions(source_id, id) physically guarantees they
-- belong together. The actual geometry bytes are never duplicated in here
-- — `manifest_path`/`geojson_path` point at the repository artifact, and
-- `artifact_git_ref` (new — a path alone is not a stable reference) pins
-- the exact commit those files were committed in.

create table if not exists market_boundary_versions (
  id                             uuid primary key,
  -- (added 2026-09-04) { market_slug, version_number } — human-readable
  -- lookup only, never a stable technical reference (id is). Duplicates
  -- version_number for readability; does not replace it.
  business_key                   jsonb not null,
  market_id                      uuid not null references markets(id),
  version_number                 integer not null,
  representation_type            text not null check (representation_type in ('polygon', 'postal_code_list', 'named_administrative_region')),
  definition_ref                 text not null,
  source_id                      uuid not null references sources(id),
  source_authorization_version_id uuid not null references source_authorization_versions(id),
  source_version                 text,
  valid_from                     date not null,
  retrieved_at                   timestamptz not null,
  inclusion_rule                 text not null,
  effective_from                 timestamptz not null,
  supersedes_version              uuid references market_boundary_versions(id),
  feature_selection_rule         jsonb not null,
  source_artifact_hash_algorithm text not null,
  source_artifact_hash           text not null,
  geometry_hash                  text not null,
  derivation                     jsonb not null,
  manifest_path                  text not null,
  geojson_path                   text not null,
  artifact_git_ref                text not null,
  created_at                     timestamptz not null default now(),
  unique (market_id, version_number),
  -- Required so `markets.current_boundary_version_id` (below) and
  -- `import_runs.market_boundary_version_id` can each composite-FK against
  -- (market_id, id) — a boundary version can only ever be "current" or
  -- "referenced" for the market it actually belongs to.
  unique (market_id, id),
  -- Physically guarantees source_authorization_version_id belongs to
  -- source_id — no independently-drifting pair.
  foreign key (source_id, source_authorization_version_id) references source_authorization_versions(source_id, id)
);

-- `markets.current_boundary_version_id`'s foreign key, added now that
-- market_boundary_versions exists (the two tables mutually reference each
-- other — this is the standard way to break that cycle). NULL is valid
-- (a market can exist before its first boundary version is seeded); when
-- set, it must name a version that actually belongs to this same market.
alter table markets
  add constraint fk_markets_current_boundary_version
  foreign key (id, current_boundary_version_id) references market_boundary_versions(market_id, id);

-- ── import_runs ──────────────────────────────────────────────────────────
--
-- docs/api/import-run-schema.md's `ImportRun`, with the dual data-origin/
-- access-provider source model (corrected 2026-09-04 — a single source
-- pair cannot represent "OpenStreetMap licenses this data" and "Geofabrik
-- is the technical channel" without conflating them). The access-provider
-- pair is nullable and, when a source is its own access provider (e.g.
-- Kadaster/PDOK), simply stays null on both columns together — never one
-- without the other (enforced by the check constraint below).

create table if not exists import_runs (
  id                                              uuid primary key,
  data_origin_source_id                           uuid not null references sources(id),
  data_origin_source_authorization_version_id     uuid not null references source_authorization_versions(id),
  access_provider_source_id                       uuid references sources(id),
  access_provider_source_authorization_version_id uuid references source_authorization_versions(id),
  market_id                                       uuid not null references markets(id),
  market_boundary_version_id                      uuid references market_boundary_versions(id),
  access_method_used                              text not null check (access_method_used in (
                                                     'manual_entry', 'owner_submission', 'automated_fetch_source_approved_domain',
                                                     'authenticated_api', 'licensed_dataset_download', 'open_dataset_download', 'open_api_query'
                                                   )),
  access_provider_note                            text,
  source_locator                                  text not null,
  source_version                                  text,
  source_version_note                             text,
  started_at                                      timestamptz not null default now(),
  completed_at                                    timestamptz,
  status                                          text not null default 'pending' check (status in (
                                                     'pending', 'running', 'succeeded', 'partial', 'failed', 'aborted'
                                                   )),
  record_counts                                   jsonb not null default '{"fetched": 0, "stored": 0, "skipped": 0, "errored": 0}'::jsonb,
  error_log                                       jsonb not null default '[]'::jsonb,
  checkpoint                                       jsonb,
  idempotency_key                                 text not null unique,
  triggered_by                                    text not null check (triggered_by in ('manual', 'scheduled', 'retry')),
  retried_from_run_id                             uuid references import_runs(id),
  created_at                                       timestamptz not null default now(),
  -- Access-provider pair: set together or not at all.
  check ((access_provider_source_id is null) = (access_provider_source_authorization_version_id is null)),
  -- Required so import_extraction_records can composite-FK against
  -- (id, market_boundary_version_id) further down.
  unique (id, market_boundary_version_id),
  -- Both source-reference pairs are physically guaranteed to belong
  -- together (source_id + its own authorization version, never a
  -- different source's version by accident).
  foreign key (data_origin_source_id, data_origin_source_authorization_version_id) references source_authorization_versions(source_id, id),
  foreign key (access_provider_source_id, access_provider_source_authorization_version_id) references source_authorization_versions(source_id, id),
  -- The referenced boundary version, when set, must belong to this run's
  -- own market_id.
  foreign key (market_id, market_boundary_version_id) references market_boundary_versions(market_id, id)
);

-- ── import_extraction_records ───────────────────────────────────────────
--
-- docs/api/import-run-schema.md's "Data minimisation" default extraction
-- record — the only durable artifact of a fetch: allowlisted fields only,
-- never the full raw response. Append-only (see grants below) — a later
-- re-fetch of the same item is a new row in a new run, never an update of
-- this one (unique per (import_run_id, record_locator) below).

create table if not exists import_extraction_records (
  id                          uuid primary key,
  import_run_id               uuid not null references import_runs(id),
  record_locator              text not null,
  source_locator               text,
  retrieved_at                timestamptz not null,
  content_hash                 text not null,
  extracted_fields             jsonb not null,
  market_boundary_version_id   uuid references market_boundary_versions(id),
  created_at                   timestamptz not null default now(),
  unique (import_run_id, record_locator),
  -- Can only reference the exact boundary version its own run used — no
  -- override/exception mechanism built here (per the documented decision:
  -- a genuinely motivated future exception is a separate schema change,
  -- not a built-in escape hatch).
  foreign key (import_run_id, market_boundary_version_id) references import_runs(id, market_boundary_version_id)
);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Stricter than 0001-0003: zero policies for anon/authenticated on ANY of
-- these six tables, no exceptions for owner/editor/internal either — none
-- of the existing staff_roles values have any documented business with
-- raw import data at this stage (MARKET-05/moderation doesn't exist yet).
-- This mirrors 0001_field_provenance.sql's staff_roles posture exactly:
-- "with RLS enabled and zero grants, only the service role (which
-- bypasses RLS) can read or write this table."
--
-- Explicit revokes are not redundant with RLS: RLS-bypass (service_role's
-- BYPASSRLS) and Postgres's own table-level GRANT system are separate
-- mechanisms — the lesson already learned live in
-- 0001_field_provenance.sql. Revoking here closes the table-privilege
-- layer too, not just the RLS layer.

alter table markets                        enable row level security;
alter table sources                        enable row level security;
alter table source_authorization_versions  enable row level security;
alter table market_boundary_versions       enable row level security;
alter table import_runs                    enable row level security;
alter table import_extraction_records      enable row level security;

revoke all on public.markets                       from public, anon, authenticated;
revoke all on public.sources                       from public, anon, authenticated;
revoke all on public.source_authorization_versions from public, anon, authenticated;
revoke all on public.market_boundary_versions      from public, anon, authenticated;
revoke all on public.import_runs                   from public, anon, authenticated;
revoke all on public.import_extraction_records     from public, anon, authenticated;

grant usage on schema public to service_role;

-- markets, sources: identity/description fields are contractually
-- mutable (renaming, re-describing) — full select/insert/update.
grant select, insert, update on public.markets to service_role;
grant select, insert, update on public.sources to service_role;

-- market_boundary_versions, source_authorization_versions,
-- import_extraction_records: append-only by contract. select/insert
-- only — no update, no delete, physically enforced even against
-- service_role itself, regardless of application-code bugs.
grant select, insert on public.source_authorization_versions to service_role;
grant select, insert on public.market_boundary_versions      to service_role;
grant select, insert on public.import_extraction_records     to service_role;

-- import_runs: only the contractually-required lifecycle transitions are
-- mutable. Identity, both source-reference pairs, the boundary-version
-- reference, and idempotency_key get no update grant at all, ever —
-- column-scoped, not a blanket table update.
grant select, insert on public.import_runs to service_role;
grant update (status, completed_at, record_counts, error_log, checkpoint)
  on public.import_runs to service_role;

-- No delete grant anywhere in this migration.
