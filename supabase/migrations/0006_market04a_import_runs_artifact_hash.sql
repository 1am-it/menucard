-- MARKET-04A follow-up — import_runs audit-hash completeness fix.
--
-- NOT YET APPLIED. Written and locally reviewed only. Run this in the
-- Supabase SQL Editor after 0004 and 0005, as a separate, later,
-- explicitly-approved step.
--
-- Gap found while preparing the first real OSM/Geofabrik import script:
-- import_runs (0004_market04a_import_foundation.sql) never recorded a
-- hash of the whole temporary source artifact a run actually downloads
-- (e.g. the Geofabrik Netherlands .osm.pbf extract) — only
-- market_boundary_versions had this pair. Without it, an ImportRun
-- cannot prove which exact upstream file it processed, unlike
-- MarketBoundaryVersion, which already can. import_runs holds zero rows
-- live today (no real import has run) — confirmed before writing this
-- fix — so adding these as NOT NULL needs no backfill and no default
-- value; the ALTER below is safe on an empty table.
--
-- Distinct from import_extraction_records.content_hash (per-candidate,
-- computed from the already-minimized, allowed extraction — see
-- docs/api/import-run-schema.md's "Amendment (2026-09-05): content_hash
-- computed after minimisation, not before" for why that is deliberately
-- NOT a hash of the raw, unfiltered source feature). source_artifact_hash
-- here is per-run, over the entire temporary downloaded file, before any
-- selection or extraction — mirroring market_boundary_versions'
-- source_artifact_hash exactly. The downloaded source file itself is
-- never stored durably either way — this column only ever holds its
-- hash, computed while the file exists in a temporary working directory
-- that is unconditionally removed afterward (same guarantee
-- ops/scripts/capture-market-boundary.js already provides for
-- MarketBoundaryVersion capture).

alter table import_runs
  add column source_artifact_hash_algorithm text not null,
  add column source_artifact_hash           text not null;
