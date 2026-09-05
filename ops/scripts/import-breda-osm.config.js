'use strict';

// MARKET-04A — first internal, blobless Breda OSM/Geofabrik candidate
// import. Describes the procedure only — this file performs no network
// access, Docker invocation, or Supabase call by itself.
//
// Reuses the exact GDAL image already pinned and tested by
// capture-market-boundary.config.js — the OSM vector driver ships in
// GDAL core, so no separate image is needed.
const GDAL = {
  image: 'ghcr.io/osgeo/gdal',
  tag: 'ubuntu-small-3.13.3',
  digest: 'sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40',
  get ref() {
    return `${this.image}@${this.digest}`;
  },
  // Node-only scope for v1 (see docs/api/import-run-schema.md's
  // "Update (2026-09-05)" note) — never lines/multipolygons/
  // multilinestrings/other_relations.
  layer: 'points',
};

const HASH_ALGORITHM = 'sha256';

// Fixed identities — copied verbatim from the committed documentation and
// the live-seeded records (docs/api/market-entity-schema.md,
// docs/api/source-registry-schema.md,
// supabase/migrations/0005_market04a_import_foundation_seed.sql). Never
// regenerated here; cross-checked live by runPreflightChecks before any
// network traffic.
const BREDA = {
  marketId: '01a06e1e-aa9a-7e88-aa15-e81b1a4cc5fb',
  marketSlug: 'breda',
  boundaryVersionId: '01a06ddc-a892-7170-8440-18b932764195',
  boundaryVersionNumber: 1,
  expectedArtifactGitRef: 'c5d71febe0ab4ef69d18842778c55ed9d8c96983',
  expectedSourceArtifactHash: '1efa5bbed78bb5aa9d918d48bcabcd9a3c0e816671545e42cd68be057b8423e6',
  expectedGeometryHash: '3b0cf4ee30911f67af5502a16b54ccb46849c14ed7a2d8ae6671eaa9ce8cbf84',
  // Repo-relative — resolved against repoRoot at run time, never against
  // process.cwd() directly.
  geojsonRepoPath: 'market-data/boundaries/breda/v1/breda.geojson',
};

// OpenStreetMap — the licence-bearing data origin (docs/api/source-registry-schema.md
// "Registered sources — actual instances").
//
// expectedStatus/expectedAllowedAccessMethod are exact-match expectations,
// not the looser "allowed OR restricted" check this tool used before the
// 2026-09-05 preflight tightening — both registered entries are, as
// documented, exactly `restricted`, with `open_dataset_download` as their
// one primary access method. A future re-review that changes either is a
// real, deliberate change this tool must re-confirm against, not silently
// accept.
const OSM_SOURCE = {
  sourceId: '01a06e1e-aa9f-7194-8fb7-e959b765d6f8',
  authorizationVersionId: '01a06e1e-aaa0-7035-98e8-e8b636cae82a',
  expectedStatus: 'restricted',
};

// Geofabrik — the separate technical access provider for the Netherlands
// extract (same document, same section). Dual source model: OSM is
// data-origin, Geofabrik is access-provider — never conflated.
const GEOFABRIK_SOURCE = {
  sourceId: '01a06e1e-aaa0-7595-9173-d75b3ab52b0a',
  authorizationVersionId: '01a06e1e-aaa0-7a42-8606-fed08df83970',
  expectedStatus: 'restricted',
};

// Both OSM_SOURCE and GEOFABRIK_SOURCE's SourceAuthorizationVersion must
// have this as their one primary allowed_access_method — the Netherlands
// bulk extract, never a live API query or anything requiring
// authentication.
const REQUIRED_PRIMARY_ACCESS_METHOD = 'open_dataset_download';

// Both SAVs must include this in allowed_data_categories — the only data
// category this tool is ever authorized to extract.
const REQUIRED_DATA_CATEGORY = 'basic_info';

// This run's own pipeline stage — must be present in both source
// authorization versions' allowed_processing_stages (or that field must
// be unset, meaning status alone governs). Checked live by
// runPreflightChecks. Never canonical_merge/public_publication/
// api_exposure/redistribution — those stay blocked by gate 3B regardless.
const REQUIRED_PROCESSING_STAGE = 'raw_import';

// Matches osmconf.ini's own scope. A node must carry one of these values
// to be extracted — checked twice: once server-side via GDAL's -where
// (efficient pre-filter), once again in JS (defense in depth against any
// GDAL/-where quoting edge case).
const ALLOWED_AMENITY_VALUES = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub'];

const path = require('node:path');
const OSMCONF_PATH = path.join(__dirname, 'osmconf.ini');

// Cheap pre-filter margin (degrees) applied to Breda's real bounding box
// before the exact point-in-polygon test — generous on purpose; a wider
// -spat box only costs a little extra GDAL work, never correctness, since
// every candidate is re-tested exactly against the real geometry
// afterward.
const BBOX_PADDING_DEGREES = 0.01;

// Live-download safety envelope for the one, fixed, already-registered
// Geofabrik extract (docs/api/source-registry-schema.md's "Geofabrik —
// Netherlands extract" entry). Not a general-purpose fetch config — every
// field is a hard constraint checked before a byte of the response is
// trusted, and the URL/host/path are never accepted as caller input,
// exactly like capture-market-boundary.config.js's own LIVE_SOURCE.
const LIVE_SOURCE = {
  url: 'https://download.geofabrik.de/europe/netherlands-latest.osm.pbf',
  expectedProtocol: 'https:',
  expectedHost: 'download.geofabrik.de',
  expectedPath: '/europe/netherlands-latest.osm.pbf',
  // Not yet confirmed against a real response in this round (no live
  // request has been made) — a conservative allow-list, matching
  // capture-market-boundary.config.js's own documented open follow-up:
  // confirm the real Content-Type with a single manual HEAD request
  // before the first real live run.
  allowedContentTypes: ['application/octet-stream', 'binary/octet-stream'],
  // The real file was confirmed ~1.3GB, current as of 2026-09-03, during
  // source-registry review (docs/api/source-registry-schema.md). Generous
  // safety margin, not a tight expected-size bound.
  maxDownloadBytes: 3 * 1024 * 1024 * 1024,
  // The only market this procedure currently supports — --confirm-market
  // must match this exact value.
  expectedMarketSlug: 'breda',
};

module.exports = {
  GDAL,
  HASH_ALGORITHM,
  BREDA,
  OSM_SOURCE,
  GEOFABRIK_SOURCE,
  REQUIRED_PROCESSING_STAGE,
  REQUIRED_PRIMARY_ACCESS_METHOD,
  REQUIRED_DATA_CATEGORY,
  ALLOWED_AMENITY_VALUES,
  OSMCONF_PATH,
  BBOX_PADDING_DEGREES,
  LIVE_SOURCE,
};
