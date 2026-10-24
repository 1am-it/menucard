'use strict';

// Regression for the Bardot criterion-5 reference (#59 order 6347355753, K1).
// The committed reference must stay comparable and must not carry a dish that
// the pinned bytes do not show. The byte-level checks skip when the gitignored
// capture bytes are not present in this checkout, exactly like the existing
// reference tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reference = require('./reference-references/bardot.json');
const { validateReferenceShape, verifyReferenceQuotes } = require('./referenceIntegrity');
const { verifyCardPriceProofs } = require('./cardReferenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function items() {
  return reference.menus.flatMap((menu) => menu.categories.flatMap((category) => category.items.map((item) => ({ item, path: category.path }))));
}

function pinnedBytes() {
  const file = path.join(REPO_ROOT, reference.captureKey);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

test('the Bardot reference is structurally comparable and names its pinned capture', () => {
  const shape = validateReferenceShape(reference);
  assert.deepEqual(shape.errors, []);
  assert.equal(reference.sourceId, 'bardot');
  assert.equal(reference.captureStatus, 'captured');
  assert.equal(reference.captureKey, 'ops/benchmark/output/card-captures/bardot/03-pdf-487ba29f4bf8.pdf');
  assert.match(reference.pinnedCapture.bytesSha256, /^[0-9a-f]{64}$/);
  assert.equal(reference.pinnedCapture.path, 'ops/benchmark/card-reference-captures.json');
});

test('every item carries a locator, a literal quote and a price proof per amount', () => {
  for (const { item, path: categoryPath } of items()) {
    assert.ok(item.name && item.name.trim(), 'name');
    assert.ok(item.locator && item.locator.trim(), `${item.name}: locator`);
    assert.ok(item.quote && item.quote.trim(), `${item.name}: quote`);
    const amounts = item.price ? [item.price] : (item.priceVariants || []).map((variant) => variant.price);
    assert.ok(amounts.length > 0, `${item.name}: price or priceVariants`);
    assert.equal((item.priceProofs || []).length, amounts.length, `${item.name}: one price proof per amount`);
    for (const proof of item.priceProofs || []) {
      assert.equal(proof.page >= 1 && proof.page <= reference.pinnedCapture.pageCount, true, `${item.name}: page`);
      assert.ok(['left', 'right'].includes(proof.column), `${item.name}: column`);
      assert.equal(Number.isFinite(proof.y), true, `${item.name}: baseline`);
    }
    assert.match(item.locator, new RegExp(categoryPath[categoryPath.length - 1].slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${item.name}: locator names its rubric`);
  }
});

test('drinks are counted as dishes, supplements and doubt cases are kept apart', () => {
  const paths = reference.menus[0].categories.map((category) => category.path.join(' > '));
  assert.ok(paths.includes('Dinerkaart > WIJNKAART > WITTE WIJNEN > Frankrijk'), 'the wine list is a countable section');
  assert.ok(paths.includes('Dinerkaart > MIX / COCKTAILS / GIN & TONIC'), 'cocktails are countable');
  assert.equal(reference.supplements.length > 0, true);
  const supplementNames = reference.supplements.map((row) => row.name.toLowerCase());
  for (const { item } of items()) {
    assert.equal(supplementNames.includes(item.name.toLowerCase()), false, `${item.name} is a supplement, not a dish`);
  }
  assert.ok(reference.ambiguous.length >= 5, 'the doubt cases are listed with a reason');
  for (const row of reference.ambiguous) assert.ok(row.reason && row.reason.trim(), `${row.item}: reason`);
  const reasons = reference.ambiguous.map((row) => row.kind);
  assert.ok(reasons.includes('dish_without_amount'), 'the two Dagprijs dishes stay visible');
  assert.ok(reasons.includes('subsection_boundary'), 'the HOOFDGERECHTEN/SPECIALITEITEN reading is documented');
  assert.equal(reference.arrangements.length, 0, 'this card prints no multi-course arrangement');
});

test('the reference carries no hardcoded total and no parser claim', () => {
  const serialized = JSON.stringify(reference);
  assert.equal(/itemCount|expectedItems|categoryCount/.test(serialized), false);
  assert.equal(serialized.includes('parser'), true, 'the method names that the parser was not used');
  assert.match(reference.method, /not used|never|geen parser/i);
});

test('every reference quote and price proof occurs in the pinned bytes', async (t) => {
  const bytes = pinnedBytes();
  if (!bytes) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  const { extractDigitalPdfText, extractDigitalPdfLines } = require('../../src/lib/pdfTextExtraction');
  const text = await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 });
  const lines = await extractDigitalPdfLines(bytes, { maxBytes: 15 * 1024 * 1024 });
  const quotes = verifyReferenceQuotes(reference, { [reference.captureKey]: text.text });
  assert.deepEqual(quotes.errors, []);
  const proofs = verifyCardPriceProofs(reference, lines.pages);
  assert.deepEqual(proofs.errors, []);
  assert.equal(proofs.proofs.length > 0, true);
});

test('the two Dagprijs dishes are documented, not invented as priced rows', () => {
  const names = items().map(({ item }) => item.name);
  for (const blocked of ['Kreeft (500/600 gr.)', 'Kreeft, pasta aglio e olio']) {
    assert.equal(names.includes(blocked), false, `${blocked} carries no amount on the source and is not a priced row`);
    assert.ok(reference.ambiguous.some((row) => row.item === blocked), `${blocked} stays visible as a doubt case`);
  }
});
