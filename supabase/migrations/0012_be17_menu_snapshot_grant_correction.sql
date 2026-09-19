-- BE-17 — Grant correction for menu_snapshot_proposals / menu_snapshot_reviews.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0001-0011, as a separate, later,
-- explicitly-approved step.
--
-- Corrects an over-broad `service_role` grant discovered on production for
-- the two tables 0011_be17_menu_snapshot_foundation.sql created. That
-- migration's own intent, stated in its own comments, was `select, insert`
-- only on both tables — never `update`, `delete`, `truncate`, `trigger`,
-- or `references`. A live, independent read-only schema inspection found
-- `service_role` also holding `references`, `trigger`, and `truncate` on
-- both tables (0011 itself is left byte-for-byte unchanged; this is a
-- purely additive follow-up, exactly like
-- 0009_market05a_candidate_reviews_deferred_reason.sql was for an earlier
-- table). `update` and `delete` were confirmed absent already — this
-- migration does not need to, and does not, touch those.
--
-- Scope, deliberately narrow: table-level privileges on exactly these two
-- tables and their two identity sequences. No RLS setting or policy is
-- touched here — RLS's own enablement is a separate, still-open
-- verification question this migration does not address. No other
-- role (`postgres`, `anon`, `authenticated`, `public`), no other table,
-- and no schema/column/index/trigger/function/route/RPC/data change is
-- part of this migration.
--
-- Atomic per object: `revoke all` first (removing every existing
-- `service_role` privilege on that table or sequence, whatever it
-- currently is, without needing to enumerate each one), then `grant`
-- back exactly what 0011 always intended, no more — applied the same
-- deterministic way to both tables and both identity sequences, so the
-- end state never depends on what was there before this migration ran.

revoke all on public.menu_snapshot_proposals from service_role;
grant select, insert on public.menu_snapshot_proposals to service_role;
revoke all on sequence public.menu_snapshot_proposals_id_seq from service_role;
grant usage, select on sequence public.menu_snapshot_proposals_id_seq to service_role;

revoke all on public.menu_snapshot_reviews from service_role;
grant select, insert on public.menu_snapshot_reviews to service_role;
revoke all on sequence public.menu_snapshot_reviews_id_seq from service_role;
grant usage, select on sequence public.menu_snapshot_reviews_id_seq to service_role;
