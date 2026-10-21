'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const index = require('./reference-references/index.json');
const metadata = require('./reference-captures.json');
const { extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const { htmlVisibleText, validateReferenceShape, verifyReferenceQuotes } = require('./referenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function reference(id) {
  const entry = index.sources.find((source) => source.id === id);
  assert.ok(entry, `reference for ${id}`);
  return require(path.join(REPO_ROOT, entry.file));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('the index pins exactly the five approved sources and the counting rules', () => {
  assert.deepEqual(index.sources.map((source) => source.id), ['zuyd', 'andalous', 'pellens', 'chocolat', 'senang-makan']);
  assert.match(index.countingRules.sha256, /^[0-9a-f]{64}$/);
  const actual = sha256(path.join(REPO_ROOT, index.countingRules.path));
  assert.equal(actual, index.countingRules.sha256, 'the counting rules may not change after the references were authored');
});

test('every captured reference is structurally comparable and carries a locator and quote per item', () => {
  for (const entry of index.sources) {
    const ref = reference(entry.id);
    assert.equal(ref.sourceId, entry.id);
    assert.equal(ref.captureStatus, metadata.sources[entry.id].captureStatus);
    const shape = validateReferenceShape(ref);
    assert.deepEqual(shape.errors, [], `${entry.id}: ${shape.errors.join('; ')}`);
    if (ref.captureStatus !== 'captured') {
      assert.equal(ref.menus.length, 0, `${entry.id}: a blocked source has no dish reference`);
      assert.ok(ref.limitations.length > 0, `${entry.id}: a blocked source names its reason`);
      continue;
    }
    const items = ref.menus.flatMap((menu) => menu.categories.flatMap((category) => category.items));
    assert.ok(items.length > 0, `${entry.id}: at least one dish`);
    for (const item of items) {
      assert.ok(item.quote && item.quote.trim(), `${entry.id}: ${item.name} quote`);
      assert.ok(item.locator && item.locator.trim(), `${entry.id}: ${item.name} locator`);
      assert.ok(item.price || (Array.isArray(item.priceVariants) && item.priceVariants.length > 0), `${entry.id}: ${item.name} price`);
    }
  }
});

test('Senang Makan is recorded as blocked, not as an empty successful menu', () => {
  const ref = reference('senang-makan');
  assert.equal(ref.captureStatus, 'blocked');
  assert.match(ref.blockedReason, /503/);
  assert.equal(ref.menus.length, 0);
  const source = metadata.sources['senang-makan'];
  assert.equal(source.captureStatus, 'blocked');
  assert.equal(source.captures[0].httpStatus, 503);
});

test('every committed capture hash and size matches the local pinned bytes', (t) => {
  let checked = 0;
  for (const [id, source] of Object.entries(metadata.sources)) {
    for (const capture of source.captures) {
      if (capture.captureStatus !== 'captured') continue;
      const file = path.join(REPO_ROOT, capture.localPath);
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.length, capture.bytes, `${id}: byte size`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.bytesSha256, `${id}: SHA-256`);
      checked += 1;
    }
  }
  if (checked === 0) t.skip('local gitignored capture bytes are not present in this checkout');
});

test('every reference quote is present in the pinned bytes', async (t) => {
  const anyCaptured = Object.values(metadata.sources).some((source) =>
    source.captures.some((capture) => capture.captureStatus === 'captured' && fs.existsSync(path.join(REPO_ROOT, capture.localPath))));
  if (!anyCaptured) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  for (const entry of index.sources) {
    const ref = reference(entry.id);
    if (ref.captureStatus !== 'captured') continue;
    const texts = new Map();
    for (const menu of ref.menus) {
      const capture = metadata.sources[entry.id].captures.find((candidate) => candidate.localPath === menu.captureKey);
      assert.ok(capture, `${entry.id}: ${menu.captureKey} is pinned`);
      const file = path.join(REPO_ROOT, menu.captureKey);
      const bytes = fs.readFileSync(file);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.bytesSha256, `${entry.id}: capture hash`);
      texts.set(menu.captureKey, capture.kind === 'pdf'
        ? (await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 })).text
        : htmlVisibleText(bytes.toString('utf8')));
    }
    for (const row of [...ref.arrangements, ...ref.supplements]) {
      if (!row.captureKey || texts.has(row.captureKey)) continue;
      const capture = metadata.sources[entry.id].captures.find((candidate) => candidate.localPath === row.captureKey);
      assert.ok(capture, `${entry.id}: ${row.captureKey} is pinned`);
      const bytes = fs.readFileSync(path.join(REPO_ROOT, row.captureKey));
      texts.set(row.captureKey, capture.kind === 'pdf'
        ? (await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 })).text
        : htmlVisibleText(bytes.toString('utf8')));
    }
    const result = verifyReferenceQuotes(ref, texts);
    assert.deepEqual(result.errors, [], `${entry.id}: ${result.errors.join('; ')}`);
  }
});
