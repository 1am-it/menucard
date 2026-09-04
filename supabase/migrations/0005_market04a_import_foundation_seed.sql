-- MARKET-04A — seed for the eight already-decided records.
--
-- NOT YET APPLIED. Run this only after 0004_market04a_import_foundation.sql,
-- and only as part of the same later, explicitly-approved live-verification
-- step that migration's own header describes.
--
-- Every id below is copied verbatim from the committed documentation
-- decision (docs/api/market-entity-schema.md's "Registered version —
-- actual instance" and docs/api/source-registry-schema.md's "Registered
-- sources — actual instances" / "Concrete id values" sections) — none are
-- generated here. Idempotent throughout: `on conflict (id) do nothing` on
-- every insert, and the one UPDATE is safe to re-run unchanged.
--
-- Exactly eight rows: the Breda market, its one boundary version, and
-- three sources with one SourceAuthorizationVersion each (Kadaster/PDOK,
-- OpenStreetMap, Geofabrik). No import_runs or import_extraction_records
-- rows — those stay empty until a real import actually executes.

-- ── 1. markets — Breda ───────────────────────────────────────────────────
--
-- current_boundary_version_id is intentionally left NULL here and set by
-- the UPDATE at the very end of this file, once the boundary version row
-- below actually exists — breaking the circular market <-> boundary
-- -version reference the same way the schema migration's deferred ALTER
-- does.

insert into markets (
  id, slug, name, country_code, timezone, default_currency,
  supported_languages, launch_status, readiness_status, current_boundary_version_id
) values (
  '01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb', 'breda', 'Breda', 'NL', 'Europe/Amsterdam', 'EUR',
  array['nl'], 'live', 'conditional_go', null
)
on conflict (id) do nothing;

-- ── 2. sources — Kadaster/PDOK, OpenStreetMap, Geofabrik ────────────────

insert into sources (id, name, operator, source_type, official_location, refresh_policy, freshness_expectation)
values
  (
    '01a06e1e-aa9f-7acc-a5cb-61d8c501befb',
    'Kadaster — Bestuurlijke Gebieden',
    'Kadaster (Dienst voor het kadaster en de openbare registers)',
    'government_open_data',
    'https://www.pdok.nl/introductie/-/article/bestuurlijke-gebieden',
    'periodic_annual',
    interval '365 days'
  ),
  (
    '01a06e1e-aa9f-7194-8fb7-e959b765d6f8',
    'OpenStreetMap',
    'OpenStreetMap Foundation (OSMF) and the OpenStreetMap contributor community',
    'poi_directory',
    'https://www.openstreetmap.org/copyright',
    'periodic_30d',
    interval '90 days'
  ),
  (
    '01a06e1e-aaa0-7595-9173-d75b3ab52b0a',
    'Geofabrik — Netherlands OSM extract',
    'Geofabrik GmbH',
    'poi_directory',
    'https://download.geofabrik.de/europe/netherlands.html',
    'periodic_30d',
    interval '90 days'
  )
on conflict (id) do nothing;

-- ── 3. source_authorization_versions — one v1 per source above ─────────

insert into source_authorization_versions (
  id, source_id, version_number, status, status_reason,
  terms_reference, terms_version, terms_retrieved_at,
  allowed_data_categories, excluded_data_categories,
  allowed_access_method, supplementary_access_methods, access_provider_note,
  allowed_processing_stages, restricted_pending,
  reuse_rights, geographic_applicability,
  reviewed_by, reviewed_at, next_review_due, effective_from, supersedes_version
) values
  (
    -- Kadaster/PDOK v1 — allowed, geospatial_reference_data only.
    '01a06e1e-aa9f-7cc6-a59c-d3280676b896',
    '01a06e1e-aa9f-7acc-a5cb-61d8c501befb',
    1,
    'allowed',
    'CC BY 4.0, explicitly "no further usage restrictions" beyond mandatory attribution, per the official National Georegister (NGR) metadata record and the PDOK Atom feed''s own licence statement; an official, primary Kadaster/PDOK source for geospatial reference data.',
    'National Georegister metadata record (nationaalgeoregister.nl/geonetwork/opensearch/api/records/208bc283-7c66-4ce7-8ad3-1cf3e8933fb5) and pdok.nl/copyright',
    'CC BY 4.0',
    date '2026-09-02',
    array['geospatial_reference_data'],
    array[]::text[],
    'open_dataset_download',
    array['open_api_query'],
    'Primary: PDOK''s Atom download service (GeoPackage, 2026 edition). Supplementary: PDOK OGC API Features (gemeentegebied collection) — for feature validation and freshness-checking only, never as the primary version-of-record route.',
    null, -- allowed_processing_stages: unset, status alone governs (unaffected by the 2026-09-04 OSM amendment)
    null, -- restricted_pending: not applicable, not restricted
    '{"redistribution_allowed": true, "attribution_required": true, "commercial_use_allowed": true, "geographic_restrictions": null}'::jsonb,
    '{"country_codes": ["NL"], "market_id": "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}'::jsonb,
    'product_owner',
    date '2026-09-02',
    date '2027-09-02',
    timestamptz '2026-09-02T00:00:00Z',
    null
  ),
  (
    -- OpenStreetMap v1 — restricted to internal candidate-register stages only.
    '01a06e1e-aaa0-7035-98e8-e8b636cae82a',
    '01a06e1e-aa9f-7194-8fb7-e959b765d6f8',
    1,
    'restricted',
    'OpenStreetMap''s data is ODbL-licensed and free to reuse, including commercially, but MARKET-05''s matching/merging design plausibly makes an OSM-derived candidate combined with a non-OSM source for the same feature type (a restaurant) a Derivative Database under ODbL — a question this project has not had legally reviewed. Restricted to internal, pre-merge, pre-publication processing stages only until that review happens (gate 3B).',
    'https://www.openstreetmap.org/copyright',
    'ODbL 1.0',
    date '2026-09-04',
    array['basic_info'],
    array[]::text[],
    'open_dataset_download',
    array['open_api_query'],
    'Licence (ODbL, this entry) and technical access channel are reviewed separately. The primary, reproducible route is Geofabrik''s periodic Netherlands extract (its own, separate Source) — never the public Overpass instance, which appears here only as a supplementary, non-primary validation method.',
    array['raw_import', 'internal_quality_review', 'moderation_preparation'],
    'canonical_merge, public_publication, api_exposure, and redistribution require a qualified legal review (external, or demonstrably authorized internal counsel — never AI research alone) of the ODbL Collective-vs-Derivative-Database question for MARKET-05''s merge of OSM-derived candidates with non-OSM sources for the same feature type. See MARKET-04''s hard gate 3B.',
    '{"redistribution_allowed": true, "redistribution_note": "ODbL terms apply — share-alike for any Derivative Database; see allowed_processing_stages/restricted_pending for the procedural gate on when redistribution/merge is actually permitted.", "attribution_required": true, "commercial_use_allowed": true, "geographic_restrictions": null}'::jsonb,
    '{"country_codes": ["NL"], "market_id": "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}'::jsonb,
    'product_owner',
    date '2026-09-04',
    date '2027-03-04',
    timestamptz '2026-09-04T00:00:00Z',
    null
  ),
  (
    -- Geofabrik v1 — restricted, identical scope/reason as OpenStreetMap
    -- above (same underlying OSM data, same gate 3B question).
    '01a06e1e-aaa0-7a42-8606-fed08df83970',
    '01a06e1e-aaa0-7595-9173-d75b3ab52b0a',
    1,
    'restricted',
    'Geofabrik is a well-established, widely-used technical redistributor of OpenStreetMap data under the same ODbL terms OSM itself publishes under — it holds no separate rights of its own and is not itself the licensor. Restricted to the identical internal-only processing stages as the OpenStreetMap entry, for the identical reason: MARKET-05''s merge question (gate 3B) is unresolved, and it applies equally to data obtained via this channel.',
    'https://download.geofabrik.de/europe/netherlands.html (page footer licence/attribution statement)',
    'ODbL 1.0 (via OpenStreetMap — Geofabrik asserts no additional licence terms of its own on this extract)',
    date '2026-09-04',
    array['basic_info'],
    array[]::text[],
    'open_dataset_download',
    array[]::text[], -- no supplementary methods of its own — Overpass's supplementary status lives on the OpenStreetMap entry, not duplicated here
    'Geofabrik is the technical access channel only. This entry does not authorize Geofabrik as an ODbL rights-holder or licensor — the licence itself is authorized by the separate OpenStreetMap entry; this entry only reviews Geofabrik''s specific extract/download service as a technical route to the same, already-licensed data.',
    array['raw_import', 'internal_quality_review', 'moderation_preparation'],
    'Identical condition to the OpenStreetMap entry: canonical_merge, public_publication, api_exposure, and redistribution require the same qualified legal review of MARKET-05''s merge question (gate 3B) before any version of this entry could add them — the data obtained via Geofabrik is the same OSM data, subject to the same open question.',
    '{"redistribution_allowed": true, "redistribution_note": "ODbL terms apply, same as the OpenStreetMap entry.", "attribution_required": true, "commercial_use_allowed": true, "geographic_restrictions": null}'::jsonb,
    '{"country_codes": ["NL"], "market_id": "01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb"}'::jsonb,
    'product_owner',
    date '2026-09-04',
    date '2027-03-04',
    timestamptz '2026-09-04T00:00:00Z',
    null
  )
on conflict (id) do nothing;

-- ── 4. market_boundary_versions — Breda v1 ──────────────────────────────
--
-- Every value below is copied verbatim from the real, committed
-- market-data/boundaries/breda/v1/manifest.json — no geometry or hash is
-- invented here. feature_selection_rule/derivation reproduce that file's
-- own JSON exactly, including its Windows-path artifact
-- ("ops\\scripts\\capture-market-boundary.js") in derivation.procedure_ref.path.

insert into market_boundary_versions (
  id, business_key, market_id, version_number, representation_type, definition_ref,
  source_id, source_authorization_version_id, source_version,
  valid_from, retrieved_at, inclusion_rule, effective_from, supersedes_version,
  feature_selection_rule, source_artifact_hash_algorithm, source_artifact_hash, geometry_hash,
  derivation, manifest_path, geojson_path, artifact_git_ref
) values (
  '01a06ddc-a892-7170-8440-18b932764195',
  '{"market_slug": "breda", "version_number": 1}'::jsonb,
  '01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb',
  1,
  'polygon',
  'https://service.pdok.nl/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
  '01a06e1e-aa9f-7acc-a5cb-61d8c501befb',
  '01a06e1e-aa9f-7cc6-a59c-d3280676b896',
  'Bestuurlijke Gebieden 2026 (definitieve editie)',
  date '2026-01-01',
  timestamptz '2026-09-04T19:19:32.752Z',
  'A coordinate is in-market if it falls within or on the polygon boundary of the selected feature.',
  timestamptz '2026-09-04T19:19:32.752Z',
  null,
  '{"primarySelector": {"field": "identificatie", "value": "GM0758"}, "requiredValidations": [{"field": "code", "value": "0758"}, {"field": "naam", "value": "Breda"}]}'::jsonb,
  'SHA256',
  '1efa5bbed78bb5aa9d918d48bcabcd9a3c0e816671545e42cd68be057b8423e6',
  '3b0cf4ee30911f67af5502a16b54ccb46849c14ed7a2d8ae6671eaa9ce8cbf84',
  '{"input_crs": "EPSG:28992", "output_crs": "EPSG:4326", "tool": "GDAL 3.13.3 \"Iowa City\", released 2026/08/13", "tool_reference": "ghcr.io/osgeo/gdal@sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40", "procedure_ref": {"path": "ops\\scripts\\capture-market-boundary.js", "git_revision": "8f996c2bc5140c9e22f42c5edaecd14e0fbc0050", "working_tree_dirty_for_this_file": false}, "serialization_rule": {"format": "GeoJSON Feature (RFC 7946)", "coordinatePrecisionDecimals": 7, "keyOrder": "sorted"}}'::jsonb,
  'market-data/boundaries/breda/v1/manifest.json',
  'market-data/boundaries/breda/v1/breda.geojson',
  'c5d71febe0ab4ef69d18842778c55ed9d8c96983'
)
on conflict (id) do nothing;

-- ── 5. link Breda's market to its boundary version ──────────────────────
--
-- The physical realization of market.boundary (docs/api/market-entity-schema.md
-- invariant 1) — set only now that the boundary version row above actually
-- exists. Safe to re-run: sets the same value every time.

update markets
set current_boundary_version_id = '01a06ddc-a892-7170-8440-18b932764195',
    updated_at = now()
where id = '01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb'
  and current_boundary_version_id is distinct from '01a06ddc-a892-7170-8440-18b932764195';

-- No import_runs or import_extraction_records rows are created by this
-- seed — those stay empty until a real, separately-approved import
-- actually executes.
