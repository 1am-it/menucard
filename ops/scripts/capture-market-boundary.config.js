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

module.exports = {
  GDAL,
  PDOK_SOURCE,
  SELECTION_RULE,
  CRS,
  SERIALIZATION_RULE,
  HASH_ALGORITHM,
};
