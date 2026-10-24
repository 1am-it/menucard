'use strict';

// Guards the controlled source references and the read-only probe of #59. It
// never asserts an item count as quality: a source version may legitimately
// change, and only the probe (against the live source) may decide that. This
// test guards the things that would silently weaken the evidence:
//   - a reference without a pinned source version/hash;
//   - a row without a name, price or section (an uncomparable reference);
//   - a duplicated row inside one reference (a reference can never prove
//     duplicate detection when it already contains the duplicate);
//   - a probe that gained a write path, a provider/secret or another source.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const references = require('./source-references.json');
const { normalizeName, normalizePrice, categoryPath } = require('../../src/lib/menuSourceComparison');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROBE_PATH = path.join(REPO_ROOT, 'ops', 'scripts', 'probe-menu-extraction-sources.js');
const EXPECTED_SOURCES = ['smelt', 'blossem'];
const SHA256 = /^[0-9a-f]{64}$/;

test('every controlled reference pins the exact source version it was captured from', () => {
  assert.match(references.capturedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(references.note, /read-only/i);
  assert.deepEqual(Object.keys(references.sources).sort(), [...EXPECTED_SOURCES].sort());
  for (const [key, source] of Object.entries(references.sources)) {
    const where = `reference ${key}`;
    assert.ok(typeof source.label === 'string' && source.label.trim().length > 0, where);
    assert.match(source.url, /^https:\/\/[^\s]+$/, where);
    assert.ok(['pdf', 'html'].includes(source.kind), where);
    // A byte hash and a text/content hash are both required: the first detects
    // any re-upload, the second a changed text layer at the same bytes.
    assert.match(source.bytesSha256, SHA256, where);
    assert.match(source.contentHash, SHA256, where);
    assert.ok(source.kind === 'html' || (Number.isInteger(source.pageCount) && source.pageCount > 0), where);
  }
});

test('every reference row is a named, priced dish in a real section — and no row is pre-duplicated', () => {
  for (const [key, source] of Object.entries(references.sources)) {
    const where = `reference ${key}`;
    assert.ok(Array.isArray(source.categories) && source.categories.length > 0, where);
    const seen = new Map();
    for (const category of source.categories) {
      const sectionPath = categoryPath(category);
      assert.ok(sectionPath.length > 0, `${where}: category without path`);
      assert.ok(Array.isArray(category.items) && category.items.length > 0, `${where}: empty section ${sectionPath.join(' › ')}`);
      for (const item of category.items) {
        const name = normalizeName(item && item.name);
        assert.ok(name.length > 0, `${where}: item without name in ${sectionPath.join(' › ')}`);
        // A price is mandatory: an unpriced line is an arrangement/choice and
        // belongs in a limitation, never in a dish reference.
        assert.match(normalizePrice(item.price), /^\d+\.\d{2}$/, `${where}: ${item.name} has no comparable price`);
        const rowKey = `${name}\u0000${normalizePrice(item.price)}\u0000${sectionPath.join('\u0000')}`;
        seen.set(rowKey, (seen.get(rowKey) || 0) + 1);
      }
    }
    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([rowKey]) => rowKey);
    assert.deepEqual(duplicated, [], `${where}: the reference itself already contains duplicates`);
  }
});

test('the probe stays read-only, bounded and limited to the two named public sources', () => {
  const source = fs.readFileSync(PROBE_PATH, 'utf8');
  // No write path: no database client, no file write, no shell, no secret.
  for (const forbidden of ['supabase', 'createClient', 'writeFile', 'appendFile', 'child_process', 'process.env']) {
    assert.equal(source.includes(forbidden), false, `probe must not use ${forbidden}`);
  }
  // No product runtime import: the probe reuses the analysis pipeline only.
  assert.match(source, /require\('\.\.\/\.\.\/src\/lib\/sourceAnalysisPipeline'\)/);
  assert.match(source, /require\('\.\.\/\.\.\/src\/lib\/safeOutboundFetch'\)/);
  assert.match(source, /require\('\.\.\/\.\.\/src\/lib\/menuSourceComparison'\)/);
  // The pass/fail rule is the unit-tested verdict module; the probe must not
  // grow its own looser check that could ignore a surplus row again.
  assert.match(source, /probeVerdict/);
  assert.equal(/function hasDifference/.test(source), false);
  assert.match(source, /sourceHasDifference/);

  // The source list is closed; a new URL needs an explicit decision.
  assert.match(source, /\['all', 'smelt', 'blossem'\]/);
  assert.equal(PROBE_PATH.includes('scripts'), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.equal(String(command).includes('probe-menu-extraction-sources'), false, `probe must not run from npm script ${name}`);
  }
});
