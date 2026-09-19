-- BE-17 — Menu Proposal Snapshot Foundation.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0010, as a separate, later,
-- explicitly-approved step.
--
-- Adds two new, purely additive tables. No existing publicly served
-- consumer data and no existing table (field_provenance, pending_changes,
-- restaurant_claims, the import/candidate tables, restaurant_profile_drafts)
-- is read, written, or altered by this migration. No route, RPC, or
-- application code in this repository writes to either new table yet —
-- that is deliberately deferred to a later, separately approved pilot
-- procedure (see
-- planning/specs/tickets/be-17-menu-proposal-snapshot-foundation.md).
--
-- Neither field_provenance (a single-current-row-per-field overwrite
-- model, no review status, a fixed five-field allow list that does not
-- include menu content) nor pending_changes (a mutable moderation queue,
-- rows updated in place on approval) is reused here — both have real
-- mutation paths that this ticket's own append-only audit trail must not
-- have. This migration's own grants and RLS are decided fresh for these
-- two tables' own access pattern, not copied from either.

-- ── menu_snapshot_proposals ───────────────────────────────────────────────
--
-- One row per captured attempt to review a restaurant's menu (or one of
-- its dayparts) as a coherent unit. Fully immutable once inserted: no
-- UPDATE grant exists for any role (see grants below) — a re-capture, a
-- correction, or a re-confirmation all produce a new row with a new
-- `version`, never an edit of an old one. Deliberately carries no
-- `review_status`/`publication_status` column — the effective status is
-- always derived from menu_snapshot_reviews below (see
-- src/lib/menuSnapshotProposals.js's deriveEffectiveSnapshotStatus`),
-- never read from or written to a column on this table.

create table if not exists menu_snapshot_proposals (
  id                    bigint generated always as identity primary key,
  -- Matches field_provenance.restaurant_id's own type exactly (a plain
  -- text key, not a foreign key into any table — this project's
  -- restaurant identity today lives in data/restaurants.json, not in a
  -- database table).
  restaurant_id         text not null,
  -- The existing `{restaurantId}-{mealType}` shape data/menus.json
  -- already uses (e.g. "23-borrel") — no new addressing scheme invented
  -- for this ticket.
  menu_context          text not null check (menu_context ~ '^[^-]+-[a-z]+$'),
  source_url            text not null check (source_url ~* '^https?://'),
  source_type           text not null check (source_type in (
                          'own_website', 'pdf', 'manual'
                        )),
  originally_fetched_at timestamptz not null,
  -- Null on a brand-new snapshot that has not been reconfirmed yet.
  last_reconfirmed_at   timestamptz,
  -- Hex-encoded SHA-256 (64 lowercase hex characters) of the canonical
  -- form of `captured_content`, always recomputed server-side at write
  -- time from `captured_content` itself (src/lib/menuSnapshotProposals.js's
  -- computeCanonicalContentHash) — never accepted as caller-supplied
  -- input, so it cannot silently drift from what it claims to describe.
  content_hash          text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  -- Increments per (restaurant_id, menu_context) lineage — enforced by
  -- the unique constraint below, not merely a convention.
  version               integer not null check (version > 0),
  quality_score         text not null check (quality_score in (
                          'low', 'medium', 'high'
                        )),
  -- The proposed menu content itself, as one structured snapshot — no
  -- separate category/dish/option tables in this first version (see the
  -- ticket's own "Non-goals" section).
  captured_content      jsonb not null,
  created_at            timestamptz not null default now(),
  -- Prevents two snapshots from silently colliding on the same version
  -- number for the same restaurant/menu — a real, database-enforced
  -- guarantee, not just an application-level convention.
  unique (restaurant_id, menu_context, version)
);

-- Supports "every snapshot for this restaurant/menu, most recent
-- version first" — the access pattern a future review surface needs,
-- without requiring one yet.
create index if not exists idx_menu_snapshot_proposals_restaurant_menu
  on menu_snapshot_proposals (restaurant_id, menu_context, version desc);

-- ── menu_snapshot_reviews ─────────────────────────────────────────────────
--
-- One row per review decision against a menu_snapshot_proposals row —
-- never one row per snapshot. Mirrors
-- 0007_market05a_candidate_reviews.sql's own append-only shape exactly:
-- multiple rows per snapshot are the normal, expected case, and the
-- "current effective status" is derived (in application code,
-- src/lib/menuSnapshotProposals.js's deriveEffectiveSnapshotStatus) from
-- whichever row has the latest decided_at for that snapshot_id — never a
-- mutable "current status" column anywhere.

create table if not exists menu_snapshot_reviews (
  id            bigint generated always as identity primary key,
  snapshot_id   bigint not null references menu_snapshot_proposals(id),
  reviewer_id   uuid not null references auth.users(id),
  decided_at    timestamptz not null default now(),
  decision      text not null check (decision in (
                  'needs_review', 'approved_internal', 'rejected', 'deferred'
                )),
  -- Fixed set only — never free text. Required exactly when decision is
  -- 'rejected', and forbidden otherwise (both directions enforced by the
  -- symmetric check below), mirroring
  -- import_candidate_reviews.rejection_reason exactly. Extending this to
  -- also require a reason for 'deferred' (as
  -- 0009_market05a_candidate_reviews_deferred_reason.sql later did for
  -- the import pattern) is explicitly left for a future, separate
  -- migration if this pilot shows it is needed — not decided here.
  reason        text check (reason is null or reason in (
                  'source_unreliable', 'content_mismatch', 'duplicate_snapshot', 'insufficient_content', 'other'
                )),
  check ((decision = 'rejected') = (reason is not null)),
  -- Optional, free-text, human-readable context for a correction or
  -- clarification — bounded, the same shape as
  -- import_candidate_enrichments's own correction pattern.
  note          text check (note is null or char_length(note) <= 2000)
);

-- Supports "every review row for this snapshot, newest first" — the
-- exact access pattern deriveEffectiveSnapshotStatus needs, same shape
-- as idx_import_candidate_reviews_candidate.
create index if not exists idx_menu_snapshot_reviews_snapshot
  on menu_snapshot_reviews (snapshot_id, decided_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────
--
-- Decided fresh for these two tables, not copied from field_provenance,
-- pending_changes, or the import-review tables. Zero policies for
-- owner/editor/anon/public: nothing in this ticket is ever
-- restaurant-owner- or consumer-reachable. Any future internal route
-- built against these tables calls Supabase as service_role (which
-- bypasses RLS) — these policies are defense-in-depth, not the primary
-- gate, matching this project's existing posture for the import-review
-- tables.

alter table menu_snapshot_proposals enable row level security;
alter table menu_snapshot_reviews enable row level security;

revoke all on public.menu_snapshot_proposals from public, anon, authenticated;
revoke all on public.menu_snapshot_reviews from public, anon, authenticated;

-- menu_snapshot_proposals: select + insert only — deliberately no UPDATE
-- grant, not even for last_reconfirmed_at. A re-confirmation is recorded
-- as a new row (a new version) instead, keeping this table fully
-- immutable rather than partially mutable — the simplest, safest
-- resolution of the ticket's own open question on this point.
grant select, insert on public.menu_snapshot_proposals to service_role;
grant usage, select on sequence public.menu_snapshot_proposals_id_seq to service_role;

-- menu_snapshot_reviews: select + insert only — no update, no delete
-- grant at all, ever, for any role, physically enforced regardless of
-- any future application-code bug. This is the real enforcement of
-- "review decisions are never edited or removed."
grant select, insert on public.menu_snapshot_reviews to service_role;
grant usage, select on sequence public.menu_snapshot_reviews_id_seq to service_role;
