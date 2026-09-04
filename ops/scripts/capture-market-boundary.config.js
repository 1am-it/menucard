'use strict';

// BE aware: this config file only *describes* the procedure — it does not
// perform any network access, Docker invocation, or file writes by itself.
//
// Pinned GDAL container reference (resolved 2026-09-02 via a direct,
// read-only query against the GHCR registry API — no Docker daemon
// required to resolve this; see the accompanying report for the exact
// query used). Pinned by digest, not just by tag, per
// `docs/api/market-entity-schema.md`'s `derivation.tool_reference`
// requirement: a tag can be force-moved by the upstream publisher, a
// digest cannot.
const GDAL = {
  image: 'ghcr.io/osgeo/gdal',
  tag: 'ubuntu-small-3.13.3',
  digest: 'sha256:64250faf833c06d4b21afce4c27190039ba7ab58d70f0eebc87cf77d929c0b40',
  get ref() {
    return `${this.image}@${this.digest}`;
  },
  layer: 'gemeentegebied',
};

// Official source — NOT fetched in this round. Recorded here only so the
// live-mode code path (never executed today) has a single, documented
// place to read it from, matching the already-registered
// SourceAuthorizationVersion in docs/api/source-registry-schema.md.
const PDOK_SOURCE = {
  definitionRef:
    'https://service.pdok.nl/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
  sourceVersion: 'Bestuurlijke Gebieden 2026 (definitieve editie)',
};

// The agreed, deterministic selection/validation rule — matches the
// registered source authorization exactly. `identificatie` is the
// primary selector; `code`/`naam` are required, independent validations
// per docs/api/market-entity-schema.md's feature_selection_rule contract.
const SELECTION_RULE = {
  primarySelector: { field: 'identificatie', value: 'GM0758' },
  requiredValidations: [
    { field: 'code', value: '0758' },
    { field: 'naam', value: 'Breda' },
  ],
};

const CRS = { input: 'EPSG:28992', output: 'EPSG:4326' };

const SERIALIZATION_RULE = {
  format: 'GeoJSON Feature (RFC 7946)',
  coordinatePrecisionDecimals: 7,
  keyOrder: 'sorted',
};

const HASH_ALGORITHM = 'sha256';

// Live-download safety envelope for the one, fixed, already-registered
// source (see docs/api/source-registry-schema.md's "Registered sources"
// section). This is NOT a general-purpose fetch config — every field here
// is a hard constraint checked before any byte of the response body is
// trusted, and the URL/host/path are never accepted as caller input.
//
// allowedContentTypes is a conservative allow-list, not yet confirmed
// against a real PDOK response (this round never performs a real request
// against PDOK). Before the separate, explicitly-approved real Breda
// capture runs, the actual Content-Type header PDOK returns for this exact
// download should be confirmed (e.g. a single manual HEAD request) and
// this list corrected if needed — an open follow-up, not a settled fact.
const LIVE_SOURCE = {
  url: PDOK_SOURCE.definitionRef,
  expectedProtocol: 'https:',
  expectedHost: 'service.pdok.nl',
  expectedPath: '/kadaster/brk-bestuurlijke-gebieden/atom/downloads/BestuurlijkeGebieden_2026.gpkg',
  allowedContentTypes: [
    'application/geopackage+sqlite3',
    'application/x-sqlite3',
    'application/octet-stream',
    'binary/octet-stream',
  ],
  // The real file was confirmed ~14.5MB during read-only research; this is
  // a generous safety margin, not a tight expected-size bound.
  maxDownloadBytes: 50 * 1024 * 1024,
  // The only market this procedure currently supports. --confirm-market
  // must match this exact value — it is a fixed confirmation, not a
  // free market selector.
  expectedMarketSlug: 'breda',
};

module.exports = {
  GDAL,
  PDOK_SOURCE,
  SELECTION_RULE,
  CRS,
  SERIALIZATION_RULE,
  HASH_ALGORITHM,
  LIVE_SOURCE,
};
