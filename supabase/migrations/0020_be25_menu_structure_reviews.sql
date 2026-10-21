-- 0020 — BE-25 menselijke controle van een onzekere rubriekindeling (#59,
-- Delivery Lead review 6307703713).
--
-- NOT YET APPLIED. Additive only; 0001-0019 are never edited. One new table,
-- its indexes and grants — no function, no changed constraint.
--
-- Why this is needed: an uncertain section structure is never confirmed with
-- one click (0016, src/lib/batchAnalysis.js certaintyOf). The separate human
-- route records, per uncertain section of ONE stored receipt, whether a
-- reviewer kept the section or corrected its path. The server re-validates the
-- submitted set against that receipt (every uncertain path, no unknown or
-- extra path, the receipt's own hash) before a source can be confirmed, and
-- rebuilds the same decisions as concept edits on save. A client claim alone
-- is never enough.
--
-- The trail is append-only: service_role may select and insert, never update
-- or delete. One decision per (receipt, section path), so a retry is a no-op
-- and a contradicting retry is refused. Nothing here publishes, activates a
-- source, approves, exports or calls a provider.

create table if not exists menu_structure_reviews (
  id              bigint generated always as identity primary key,
  market_id       uuid not null references markets(id),
  batch_id        uuid not null references url_intake_batches(id),
  job_id          uuid not null references restaurant_source_analysis_jobs(id),
  -- The analysis result whose uncertain sections were reviewed. A new
  -- analysis (new receipt) needs its own review; an old one is never reused.
  receipt_id      uuid not null references url_intake_analysis_receipts(id),
  actor_user_id   uuid not null references auth.users(id),
  -- Canonical JSON of the section path as the review showed it. The unique
  -- index makes one receipt's section decision immutable.
  path_key        text not null check (char_length(path_key) between 2 and 1024),
  original_path   text not null check (char_length(original_path) between 2 and 1024),
  source_path     text check (source_path is null or char_length(source_path) between 2 and 1024),
  locator         text check (locator is null or char_length(locator) between 1 and 160),
  decision        text not null check (decision in ('keep', 'correct')),
  corrected_path  text check (corrected_path is null or char_length(corrected_path) between 2 and 1024),
  created_at      timestamptz not null default now(),
  -- "Handhaven" has no new path; "corrigeren" always has one.
  check ((decision = 'correct') = (corrected_path is not null)),
  unique (receipt_id, path_key)
);

create index if not exists idx_menu_structure_reviews_batch
  on menu_structure_reviews (batch_id, receipt_id);

create index if not exists idx_menu_structure_reviews_job
  on menu_structure_reviews (job_id);

alter table menu_structure_reviews enable row level security;

revoke all on public.menu_structure_reviews from public, anon, authenticated;
revoke all on public.menu_structure_reviews from service_role;

grant select, insert on public.menu_structure_reviews to service_role;

-- The identity sequence behind menu_structure_reviews.id: nothing may use it
-- except service_role, which needs it for an insert (same posture as 0015 and
-- 0019). Supabase's default privileges grant sequence rights directly to the
-- API roles, so a revoke from PUBLIC alone would leave them in place.
revoke all on sequence public.menu_structure_reviews_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.menu_structure_reviews_id_seq to service_role;
