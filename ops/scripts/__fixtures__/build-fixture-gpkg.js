'use strict';

/**
 * Builds a small, fully synthetic, valid GeoPackage file for testing
 * `capture-market-boundary.js` — no real geographic data of any kind.
 * Coordinates are trivial made-up numbers (a unit square), not any real
 * place's shape.
 *
 * Only implements the minimal subset of the GeoPackage/WKB spec needed to
 * produce a structurally valid file: the three required metadata tables
 * (`gpkg_spatial_ref_sys`, `gpkg_contents`, `gpkg_geometry_columns`) and a
 * single feature table with a GeoPackage-encoded Polygon geometry blob.
 * This is not a general-purpose GeoPackage writer.
 */

const { DatabaseSync } = require('node:sqlite');

/** Encodes a single-ring Polygon (no holes, no Z/M) as a GeoPackage
 * geometry blob: the GP header followed by standard little-endian WKB. */
function encodeGpkgPolygon(ring, srsId) {
  const numPoints = ring.length;
  const wkbLength = 1 + 4 + 4 + 4 + numPoints * 16;
  const header = Buffer.alloc(8);
  header.write('GP', 0, 'ascii');
  header.writeUInt8(0, 2); // version 0
  header.writeUInt8(0x01, 3); // flags: little-endian, no envelope, not empty
  header.writeInt32LE(srsId, 4);

  const wkb = Buffer.alloc(wkbLength);
  let offset = 0;
  wkb.writeUInt8(1, offset); offset += 1; // little-endian
  wkb.writeUInt32LE(3, offset); offset += 4; // wkbType = Polygon
  wkb.writeUInt32LE(1, offset); offset += 4; // numRings = 1
  wkb.writeUInt32LE(numPoints, offset); offset += 4;
  for (const [x, y] of ring) {
    wkb.writeDoubleLE(x, offset); offset += 8;
    wkb.writeDoubleLE(y, offset); offset += 8;
  }

  return Buffer.concat([header, wkb]);
}

/**
 * @param {string} filePath - where to write the .gpkg (must not exist yet)
 * @param {Array<{id:number, identificatie:string, code:string, naam:string}>} features
 */
function buildFixtureGeoPackage(filePath, features) {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`
      CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
      );
      CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT,
        description TEXT,
        last_change TEXT NOT NULL,
        min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
        srs_id INTEGER
      );
      CREATE TABLE gpkg_geometry_columns (
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        geometry_type_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL,
        z TINYINT NOT NULL,
        m TINYINT NOT NULL,
        PRIMARY KEY (table_name, column_name)
      );
      CREATE TABLE gemeentegebied (
        id INTEGER PRIMARY KEY,
        geom BLOB,
        identificatie TEXT,
        code TEXT,
        naam TEXT
      );
    `);

    db.prepare(
      `INSERT INTO gpkg_spatial_ref_sys (srs_name, srs_id, organization, organization_coordsys_id, definition, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('Amersfoort / RD New (synthetic test entry)', 28992, 'EPSG', 28992, 'UNDEFINED-FOR-TEST', 'Synthetic fixture, not real EPSG:28992 data');

    db.prepare(
      `INSERT INTO gpkg_contents (table_name, data_type, identifier, description, last_change, srs_id)
       VALUES (?, 'features', ?, ?, ?, ?)`
    ).run('gemeentegebied', 'gemeentegebied (fixture)', 'Synthetic test fixture', new Date().toISOString(), 28992);

    db.prepare(
      `INSERT INTO gpkg_geometry_columns (table_name, column_name, geometry_type_name, srs_id, z, m)
       VALUES ('gemeentegebied', 'geom', 'POLYGON', 28992, 0, 0)`
    ).run();

    const insertFeature = db.prepare(
      `INSERT INTO gemeentegebied (id, geom, identificatie, code, naam) VALUES (?, ?, ?, ?, ?)`
    );

    // A trivial, entirely fictional 100m square — not a real place or
    // boundary. Chosen within EPSG:28992 (RD New)'s normal numeric range
    // (roughly central Netherlands) purely so a real reprojection to
    // EPSG:4326 behaves numerically well — the shape itself is fabricated
    // and traces nothing real.
    const dummyRing = [
      [150000, 450000],
      [150100, 450000],
      [150100, 450100],
      [150000, 450100],
      [150000, 450000],
    ];

    for (const f of features) {
      insertFeature.run(f.id, encodeGpkgPolygon(dummyRing, 28992), f.identificatie, f.code, f.naam);
    }
  } finally {
    db.close();
  }
  return filePath;
}

module.exports = { buildFixtureGeoPackage, encodeGpkgPolygon };
