'use strict';

// Guards the review-only v2 product-schema design. The design is allowed to
// exist without being implemented; this test fails if the branch silently
// starts implementing it, adds a migration, or drops a required compatibility
// section before the Product Owner has decided.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EXTRACTION_OUTPUT_SCHEMA_VERSION } = require('../../src/lib/menuExtractionSchema');
const { MENU_EXTRACTION_RESULT_VERSION } = require('../../src/lib/menuExtractionResult');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DESIGN = path.join(REPO_ROOT, 'planning', 'architecture', 'menu-extraction-product-schema-v2.md');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase', 'migrations');

test('the v2 product-schema design is present, versioned and explicitly not implemented', () => {
  const text = fs.readFileSync(DESIGN, 'utf8');
  assert.match(text, /menu-extraction-product\/v2/);
  assert.match(text, /ontwerp, niet geïmplementeerd, geen migratie/i);
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

test('the design does not silently replace the shipped v1 contracts', () => {
  assert.equal(EXTRACTION_OUTPUT_SCHEMA_VERSION, 'menu-extraction-output/v1');
  assert.equal(MENU_EXTRACTION_RESULT_VERSION, 1);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'src', 'lib', 'menuExtractionProductV2.js')), false);
});

test('the design adds no database migration in this branch', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(files.length > 0);
  const highest = files[files.length - 1];
  assert.match(highest, /^0019_/);
  assert.equal(files.some((name) => /^00(2[0-9]|[3-9][0-9])_/.test(name)), false);
});
