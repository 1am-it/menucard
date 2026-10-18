'use strict';

// Guards the controlled, partial De Botanist reference for #59. It is a
// capture of the pinned PDF layout, not the production parser's output: every
// supported section lists names/prices, and the known unsupported block
// layouts are named instead of guessed.

const test = require('node:test');
const assert = require('node:assert/strict');

const reference = require('./botanist-reference.json');
const comparison = require('./botanist-comparison.json');
const holdoutReferences = require('./holdout-references.json');

const SHA256 = /^[0-9a-f]{64}$/;

test('the Botanist reference pins the actual entry and linked PDF versions', () => {
  assert.equal(reference.issue, 59);
  assert.equal(reference.referenceMode, 'controlled_layout_capture');
  assert.equal(reference.referenceCompleteness, 'partial_structured_sections');
  assert.equal(reference.groundTruth, 'controlled_partial');
  assert.equal(reference.source.pageCount, 16);
  assert.match(reference.source.entryBytesSha256, SHA256);
  assert.match(reference.source.menuBytesSha256, SHA256);
  assert.match(reference.source.menuContentHash, SHA256);
  const pinned = holdoutReferences.sources.debotanist;
  assert.equal(pinned.bytesSha256, reference.source.entryBytesSha256);
  const pinnedMenu = pinned.menuSources.find((source) => source.kind === 'pdf');
  assert.ok(pinnedMenu, 'the actual linked PDF is pinned separately');
  assert.equal(pinnedMenu.bytesSha256, reference.source.menuBytesSha256);
  assert.equal(pinnedMenu.contentHash, reference.source.menuContentHash);
});

test('supported sections contain concrete names and prices, never parser-only fields', () => {
  assert.ok(reference.sections.length >= 15);
  let count = 0;
  for (const section of reference.sections) {
    assert.ok(Array.isArray(section.path) && section.path.length > 0, 'section path');
    assert.ok(section.items.length > 0, `${section.path.join(' > ')} has items`);
    for (const item of section.items) {
      assert.ok(typeof item.name === 'string' && item.name.trim().length > 0, `${section.path.join(' > ')} item name`);
      assert.match(String(item.price), /^\d{1,3}(?:[.,]\d{1,2})?$/, `${item.name} price`);
      assert.equal(Object.prototype.hasOwnProperty.call(item, 'contentHash'), false, 'no parser evidence hash in the reference');
      count += 1;
    }
  }
  assert.equal(count, reference.referenceItemCount);
});

test('unsupported block layouts are named with a reason, not silently omitted', () => {
  assert.ok(reference.unsupportedSections.length >= 6);
  for (const section of reference.unsupportedSections) {
    assert.ok(section.path.length > 0);
    assert.ok(typeof section.reason === 'string' && section.reason.length > 20, `${section.path.join(' > ')} reason`);
    assert.ok(Array.isArray(section.pages) && section.pages.length > 0);
  }
  const names = reference.unsupportedSections.flatMap((section) => section.path);
  for (const expected of ['ONZE COCKTAILS', 'GIN & TONIC', 'WITTE WIJNEN', 'RODE WIJNEN']) {
    assert.ok(names.includes(expected), `${expected} is explicitly unsupported`);
  }
});


test('the committed comparison is the measured one, not a forecast', () => {
  assert.equal(comparison.referenceItems, reference.referenceItemCount);
  // Review 6249915021 P1: "Monkey 47 10.0" is structurally identical to a
  // glass/bottle row without a separator, so the parser now reports that line
  // as ambiguous instead of guessing the name number. The controlled
  // reference sections and their matched/missing/extra totals are unchanged;
  // only the unlinked bucket lost that one item (196/96 -> 195/95).
  assert.equal(comparison.parserItems, 195);
  assert.deepEqual(comparison.totals, { matched: 95, missing: 46, extra: 5, priceMismatch: 0 });
  assert.equal(comparison.unmapped.length, 95);
  assert.equal(comparison.unmapped.some((entry) => entry.name === 'Monkey 47'), false);
  const sections = Object.keys(comparison.sections);
  assert.equal(sections.length, reference.sections.length);
});
