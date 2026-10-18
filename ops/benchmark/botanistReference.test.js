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
  // Review 6250261342: stable marker columns, inherited column sections,
  // nested brand sub-headings, multi-line names with explicit evidence and
  // longer local name/price pairs. The reference v1 is unchanged.
  assert.equal(comparison.referenceVersion, reference.version);
  assert.equal(comparison.source.menuBytesSha256, reference.source.menuBytesSha256);
  assert.equal(comparison.parserItems, 214);
  assert.deepEqual(comparison.totals, { matched: 130, missing: 11, extra: 4, priceMismatch: 0 });
  assert.equal(comparison.unmapped.length, 80);
  assert.deepEqual(comparison.layout, {
    duplicateLayerItems: 0,
    duplicateLayerOffsets: [],
    ambiguousPriceLines: 18,
    unlinkedPriceLines: 9,
    supplementLines: 12,
    arrangementLines: 0,
    unrecognizedHeadingLines: 0,
    inheritedSectionColumns: 4,
    inheritedSubheadingColumns: 1,
    nameContinuationLines: 13,
    portionLines: 2,
  });
  const sections = Object.keys(comparison.sections);
  assert.equal(sections.length, reference.sections.length);
});

test('the section/name leads from review 6250261342 are measured individually', () => {
  const section = (name) => comparison.sections[name];
  // Fixed: right-column continuations and three-word names above a local amount.
  assert.equal(section('STARTERS').matched, 10);
  assert.equal(section('DESSERTS 17:00 - 21:00').matched, 8);
  assert.equal(section('LUNCH').matched, 11);
  assert.equal(section('MEDITERRAANS').matched, 3);
  assert.equal(section('(MIDDEN) - OOSTERS').matched, 3);
  assert.equal(section('SNACKS').matched, 6);
  // Fixed: wrapped names with explicit separators and a portion continuation.
  assert.deepEqual(section('FRISDRANK').missing.map((item) => item.name), [
    'Sourcy Still Water (20cl)',
    'Sourcy Sparkling Water (20cl)',
    'Sourcy Still Water (75cl)',
    'Sourcy Sparkling Water (75cl)',
  ]);
  assert.deepEqual(section('FRISDRANK').extra.map((item) => item.name), [
    'Sourcy Still Water, Sourcy Sparkling Water (20cl)',
    'Sourcy Still Water, Sourcy Sparkling Water (75cl)',
  ]);
  // Remaining: one unproven multi-line name and one inconsistent reference row.
  assert.deepEqual(section('PREMIUM FRISDRANKEN').missing.map((item) => item.name), [
    'Del Sol Pineapple Hibiscus Soda',
    'Double Dutch Ginger Beer',
  ]);
  // Remaining: the lower Soof block is a different grid and stays unsupported.
  assert.deepEqual(section('fritz').missing.map((item) => item.name), [
    'Blueberry & Lavender Lemonade',
    'Rose & Cardamom Lemonade',
    'Carrot & Ginger Lemonade',
    'Lemongrass & Pear Lemonade',
    'Ice Tea Lemonade',
  ]);
  assert.equal(section('fritz').matched, 5);
});

test('the proposed v2 corrections are labelled, source-backed and never replace the v1 baseline', () => {
  const proposal = require('./botanist-reference.proposed-v2.json');
  const proposedComparison = require('./botanist-comparison.proposed-v2.json');
  assert.equal(proposal.status, 'proposed_not_accepted');
  assert.equal(proposal.basedOn, reference.version);
  assert.equal(proposal.groundTruth, 'controlled_partial_proposed');
  assert.equal(proposal.corrections.length, 3);
  for (const correction of proposal.corrections) {
    assert.ok(correction.evidence.length > 40, `${correction.change} has source evidence`);
  }
  assert.deepEqual(proposedComparison.totals, { matched: 133, missing: 1, extra: 1, priceMismatch: 0 });
  assert.equal(proposedComparison.unmapped.length, 80);
  // The accepted baseline is untouched by the proposal.
  assert.equal(reference.version, '1.0.0');
  assert.equal(reference.referenceItemCount, 141);
  assert.equal(comparison.totals.matched, 130);
});
