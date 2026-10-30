'use strict';

// Guards the v2 product-schema boundary after the approved 2026-10-19 round.
// The pure schema/mapping layer is allowed to exist and be tested; this test
// fails if the branch silently connects it to a route, adds a v2/product
// migration, changes the shipped v1 contracts or drops a required
// compatibility section. (BE-25's 0020 human-structure-review migration is a
// different, reviewed concern and carries no v2 storage.)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EXTRACTION_OUTPUT_SCHEMA_VERSION } = require('../../src/lib/menuExtractionSchema');
const { MENU_EXTRACTION_RESULT_VERSION } = require('../../src/lib/menuExtractionResult');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DESIGN = path.join(REPO_ROOT, 'planning', 'architecture', 'menu-extraction-product-schema-v2.md');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase', 'migrations');
const PURE_FILES = [
  path.join(REPO_ROOT, 'src', 'lib', 'menuProductSchemaV2.js'),
  path.join(REPO_ROOT, 'src', 'lib', 'menuProductMappingV2.js'),
];

test('the v2 design is present and separates the pure layer from routes, migration and publication', () => {
  const text = fs.readFileSync(DESIGN, 'utf8');
  assert.match(text, /menu-extraction-product\/v2/);
  assert.match(text, /pure schema-\/mappinglaag geïmplementeerd/i);
  assert.match(text, /geen route/i);
  assert.match(text, /geen\s+migratie/i);
  assert.match(text, /geen publicatie/i);
  for (const heading of [
    'Mapping van v1 naar v2',
    'Opslag, migratie en compatibiliteit',
    'Compatibiliteitsmatrix',
    'Invarianten en verplichte regressies',
    'Open beslissingen',
  ]) {
    assert.ok(text.includes(heading), `missing section: ${heading}`);
  }
  for (const term of ['Receipt', 'Review', 'Concept', 'Export', 'Publieke kaart']) {
    assert.ok(text.includes(term), `missing compatibility term: ${term}`);
  }
});

test('the shipped v1 contracts stay unchanged and the pure v2 files exist under their own names', () => {
  assert.equal(EXTRACTION_OUTPUT_SCHEMA_VERSION, 'menu-extraction-output/v1');
  assert.equal(MENU_EXTRACTION_RESULT_VERSION, 1);
  for (const file of PURE_FILES) assert.equal(fs.existsSync(file), true, `missing pure layer: ${file}`);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src', 'lib', 'menuExtractionProductV2.js')), false);
});

test('the review clarifications are documented and implemented in the pure layer, not in a route', () => {
  const text = fs.readFileSync(DESIGN, 'utf8');
  assert.match(text, /price_evidence_missing/);
  assert.match(text, /eigen bewijsquote|per prijsbedrag/i);
  assert.match(text, /unsupported_schema_version/);
  assert.match(text, /niet stil negeren|zichtbaar niet-ondersteund/i);
  const schema = fs.readFileSync(PURE_FILES[0], 'utf8');
  const mapping = fs.readFileSync(PURE_FILES[1], 'utf8');
  assert.match(schema, /price_evidence_missing/);
  assert.match(mapping, /unsupported_v1_projection/);
});

test('the pure layer has no network, database, environment or filesystem access', () => {
  for (const file of PURE_FILES) {
    const source = fs.readFileSync(file, 'utf8');
    for (const forbidden of ['fetch(', 'supabase', 'process.env', 'writeFile', 'createClient', "require('node:"]) {
      assert.equal(source.includes(forbidden), false, `${path.basename(file)} must not contain ${forbidden}`);
    }
  }
});

test('no app route imports the new v2 modules', () => {
  const stack = [path.join(REPO_ROOT, 'app')];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      assert.equal(source.includes('menuProductSchemaV2'), false, `${path.relative(REPO_ROOT, full)} must not import the v2 schema`);
      assert.equal(source.includes('menuProductMappingV2'), false, `${path.relative(REPO_ROOT, full)} must not import the v2 mapping`);
    }
  }
});

test('the v2 design adds no database migration in this branch', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length > 0);
  const later = files.filter((name) => /^00(2[0-9]|[3-9][0-9])_/.test(name));
  // The only migrations after the v2 design round are BE-25's reviewed human
  // structure review (#59 review 6307703713), BE-44's anonymous dish counters
  // (#105, criterium 5), BE-46's samen-kiezen tables (#106, criterium 1) and
  // BE-55's daghap/season tables (#135, step A). None adds v2/product storage.
  assert.deepEqual(later, [
    '0020_be25_menu_structure_reviews.sql',
    '0021_be44_dish_counters.sql',
    '0022_be46_samen_kiezen.sql',
    '0023_be55_daghap.sql',
  ]);
  for (const name of later) {
    const source = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
    assert.doesNotMatch(source, /menu_extraction_product|product_v2|schema_version|candidate_summary/i, name);
    assert.doesNotMatch(source, /alter table\s+(url_intake_analysis_receipts|menu_snapshot_proposals|menu_snapshot_reviews)/i, name);
  }
});
