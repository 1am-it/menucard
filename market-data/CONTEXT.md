# Market Data Context

This directory is the repository realization of `MarketBoundaryVersion`
and `market.boundary` from `docs/api/market-entity-schema.md` (`MARKET-01`,
amended by `MARKET-04` gate 1). It holds MenuCard's market **geographic
boundary** data only — nothing else. It is not a restaurant, menu, or
reservation import of any kind, has no relationship to
`data/restaurants.json`/`data/menus.json`, and does not touch any
database, Supabase, or the consumer read path.

## Structure

```
market-data/
  boundaries/
    <market_slug>/
      current.json       ← the ONLY mutable file; points at the current version
      v1/
        manifest.json     ← the MarketBoundaryVersion record (immutable once committed)
        breda.geojson      ← the operational geometry manifest.json's geometry_hash covers
      v2/                 ← a future correction/update, if one is ever needed
        ...
```

`current.json` is the repo-realization of `market.boundary` — see
`docs/api/market-entity-schema.md`'s invariant 1. It is the *only* file in
this directory that is ever overwritten in place, and only to point at a
newer version's `manifest.json` after that new version has already been
fully captured and validated.

## Immutability rule

A `vN/manifest.json` and its accompanying geometry file are **never
edited** once committed. A correction of any kind — even a minor one —
means capturing a new version (`vN+1/`) and then updating `current.json`
to point at it. `supersedes_version` inside the new manifest records which
version it replaces; the old version's own files are never touched again.
See `docs/api/market-entity-schema.md`'s "Amendment: immutable succession"
section for the full reasoning.

## Provenance and licence

Breda's boundary data originates from Kadaster's "Bestuurlijke Gebieden"
dataset via PDOK, reviewed and registered as an `allowed` source — see
`docs/api/source-registry-schema.md`'s "Registered sources" section.

**Required attribution wherever this geometry is used or displayed**:

> Kadaster, Bestuurlijke Gebieden

Licensed under **CC BY 4.0**. Each version's own `manifest.json` records
the exact dataset edition (`source_version`) used for that version.

## The national GeoPackage is never kept in this repository

The official Kadaster/PDOK GeoPackage download used to produce a version
is a whole-of-Netherlands file, and is retrieved only into a temporary
location by `ops/scripts/capture-market-boundary.js`, then discarded once
the relevant feature has been selected, validated, and extracted. It is
never committed here. Each version's `manifest.json` instead records
`source_artifact_hash` (a SHA-256 of that exact original file) and
`definition_ref` (its official, reproducible download location) — this is
enough to prove which exact upstream file was used without retaining the
file itself.

## How a version gets here

Versions are produced by the controlled, guarded capture procedure in
`ops/scripts/capture-market-boundary.js` (see that file and its test
suite) — never by hand-editing a manifest or GeoJSON file directly. See
`docs/api/market-entity-schema.md`'s "Completeness required for a real,
registered version" section for exactly which fields a real version must
have filled in.
