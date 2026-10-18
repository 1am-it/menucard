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
  // longer local name/price pairs. Review 6252891629: the six readable
  // supplement rows are an explicit product gap, not ordinary dishes.
  assert.equal(comparison.referenceVersion, reference.version);
  assert.equal(comparison.source.menuBytesSha256, reference.source.menuBytesSha256);
  assert.equal(comparison.parserItems, 208);
  assert.deepEqual(comparison.totals, { matched: 124, missing: 11, extra: 4, priceMismatch: 0 });
  assert.equal(comparison.unmapped.length, 80);
  assert.deepEqual(comparison.layout, {
    duplicateLayerItems: 0,
    duplicateLayerOffsets: [],
    ambiguousPriceLines: 18,
    unlinkedPriceLines: 9,
    supplementLines: 18,
    arrangementLines: 0,
    unrecognizedHeadingLines: 0,
    inheritedSectionColumns: 4,
    inheritedSubheadingColumns: 1,
    nameContinuationLines: 13,
    portionLines: 2,
    supplementSections: [{ heading: 'SUPPLEMENTEN', pages: [2], lines: 6 }],
  });
  assert.deepEqual(comparison.coverage, {
    referenceItems: 141,
    matched: 124,
    missing: 11,
    productGap: 6,
    extra: 4,
    priceMismatch: 0,
    matchedRatio: 0.8794,
    limitedRows: 0,
  });
  assert.deepEqual(
    {
      referenceItems: comparison.supportedSubset.referenceItems,
      matched: comparison.supportedSubset.matched,
      missing: comparison.supportedSubset.missing,
      extra: comparison.supportedSubset.extra,
      priceMismatch: comparison.supportedSubset.priceMismatch,
    },
    { referenceItems: 135, matched: 124, missing: 11, extra: 4, priceMismatch: 0 },
  );
  assert.equal(comparison.accounting.balanced, true);
  const sections = Object.keys(comparison.sections);
  assert.equal(sections.length, reference.sections.length);
});

test('review 6252891629 P1: the explicit supplement section is an accounted product gap, never six ordinary dishes', () => {
  const section = comparison.sections.SUPPLEMENTEN;
  assert.deepEqual(
    {
      expected: section.expected,
      actual: section.actual,
      matched: section.matched,
      missing: section.missing.length,
      extra: section.extra.length,
      productGap: section.productGap,
    },
    { expected: 6, actual: 0, matched: 0, missing: 0, extra: 0, productGap: 6 },
  );
  assert.equal(comparison.coverage.productGap, 6);
  // The rows are still visible with their source names/prices and reason...
  assert.deepEqual(
    comparison.supportedSubset.excludedRows
      .filter((row) => row.section === 'SUPPLEMENTEN')
      .map((row) => [row.name, row.price, row.support]),
    [
      ['Havermelk', '0.5', 'unsupported_product_field'],
      ['Hazelnootsiroop', '0.6', 'unsupported_product_field'],
      ['Karamelsiroop', '0.6', 'unsupported_product_field'],
      ['Witte chocoladesiroop', '0.6', 'unsupported_product_field'],
      ['Honing', '0.6', 'unsupported_product_field'],
      ['Slagroom', '0.6', 'unsupported_product_field'],
    ],
  );
  // ...but none of them is a parser item any more.
  assert.equal(section.actual, 0);
  assert.equal(comparison.unmapped.some((item) => item.path[0] === 'SUPPLEMENTEN'), false);
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

test('the proposed v2 corrections are labelled and historical: v2 predates the supplement repair and never replaces v1', () => {
  const proposal = require('./botanist-reference.proposed-v2.json');
  const proposedComparison = require('./botanist-comparison.proposed-v2.json');
  assert.equal(proposal.status, 'proposed_not_accepted');
  assert.equal(proposal.basedOn, reference.version);
  assert.equal(proposal.groundTruth, 'controlled_partial_proposed');
  assert.equal(proposal.corrections.length, 3);
  for (const correction of proposal.corrections) {
    assert.ok(correction.evidence.length > 40, `${correction.change} has source evidence`);
  }
  // This file is kept as history: its 133 matches still counted six
  // supplement rows as ordinary dishes, before review 6252891629 P1.
  assert.deepEqual(proposedComparison.totals, { matched: 133, missing: 1, extra: 1, priceMismatch: 0 });
  assert.equal(proposedComparison.unmapped.length, 80);
  // The accepted baseline is untouched by the proposal.
  assert.equal(reference.version, '1.0.0');
  assert.equal(reference.referenceItemCount, 141);
  assert.equal(comparison.totals.matched, 124);
});

test('proposed v3 restores the five readable Soof rows to the denominator and reports both coverage views', () => {
  const proposal = require('./botanist-reference.proposed-v3.json');
  const proposedComparison = require('./botanist-comparison.proposed-v3.json');
  assert.equal(proposal.version, '3.0.0-proposed');
  assert.equal(proposal.status, 'proposed_not_accepted');
  assert.equal(proposal.basedOn, reference.version);
  assert.equal(proposal.supersedes, '2.0.0-proposed');
  assert.equal(proposal.groundTruth, 'controlled_partial_proposed');
  assert.equal(proposal.referenceItemCount, 139);
  assert.equal(proposal.corrections.length, 4);
  assert.match(proposal.readabilityPolicy, /stays in the reference and in the total denominator/);

  const soof = proposal.sections.find((section) => section.path[0] === 'SOOF LEMONADES');
  assert.ok(soof, 'the five readable lemonades stay in the measured sections');
  assert.equal(soof.support, 'unsupported_readability');
  assert.equal(soof.headingEvidence, 'none_printed');
  assert.deepEqual(soof.items.map((item) => [item.name, item.price, item.support]), [
    ['Blueberry & Lavender Lemonade', '4.8', 'unsupported_readability'],
    ['Rose & Cardamom Lemonade', '4.8', 'unsupported_readability'],
    ['Carrot & Ginger Lemonade', '4.8', 'unsupported_readability'],
    ['Lemongrass & Pear Lemonade', '4.8', 'unsupported_readability'],
    ['Ice Tea Lemonade', '4.8', 'unsupported_readability'],
  ]);
  // No itemless "unsupported section" replaces the five readable rows.
  assert.equal(proposal.unsupportedSections.some((section) => section.path.includes('SOOF LEMONADES')), false);
  const limited = proposal.limitedSections.find((section) => section.path[0] === 'SOOF LEMONADES');
  assert.equal(limited.rows, 5);
  assert.match(limited.reason, /No printed text heading/);

  // Denominator change is explained: 141 - 2 Sourcy rows = 139. The five Soof
  // rows are restored, not removed as in v2.
  assert.equal(proposal.denominatorChange.previous.referenceItems, 134);
  assert.equal(proposal.denominatorChange.proposed.referenceItems, 139);
  assert.match(proposal.denominatorChange.explanation, /exactly -2/);

  // Measured on the repaired chain: the five Soof rows are missing, and the
  // six readable supplement rows are an explicit product gap (not matched).
  assert.deepEqual(proposedComparison.totals, { matched: 127, missing: 6, extra: 1, priceMismatch: 0 });
  assert.deepEqual(proposedComparison.sections['SOOF LEMONADES'].missing.map((item) => item.name), [
    'Blueberry & Lavender Lemonade',
    'Rose & Cardamom Lemonade',
    'Carrot & Ginger Lemonade',
    'Lemongrass & Pear Lemonade',
    'Ice Tea Lemonade',
  ]);
  assert.deepEqual(proposedComparison.coverage, {
    referenceItems: 139,
    matched: 127,
    missing: 6,
    productGap: 6,
    extra: 1,
    priceMismatch: 0,
    matchedRatio: 0.9137,
    limitedRows: 5,
  });
  // The explicitly limited subset never hides the denominator change: it
  // lists all 11 excluded rows with their reason.
  assert.deepEqual(
    {
      referenceItems: proposedComparison.supportedSubset.referenceItems,
      matched: proposedComparison.supportedSubset.matched,
      missing: proposedComparison.supportedSubset.missing,
      extra: proposedComparison.supportedSubset.extra,
      priceMismatch: proposedComparison.supportedSubset.priceMismatch,
      matchedRatio: proposedComparison.supportedSubset.matchedRatio,
    },
    { referenceItems: 128, matched: 127, missing: 1, extra: 1, priceMismatch: 0, matchedRatio: 0.9922 },
  );
  assert.equal(proposedComparison.supportedSubset.excludedRows.length, 11);
  assert.equal(proposedComparison.supportedSubset.excludedRows.filter((row) => row.support === 'unsupported_readability').length, 5);
  assert.equal(proposedComparison.accounting.balanced, true);
  assert.equal(proposedComparison.accounting.referenceItems, 139);

  // v1 and v2 history remains intact and is never replaced by the proposal.
  assert.equal(reference.referenceItemCount, 141);
  assert.equal(require('./botanist-reference.proposed-v2.json').referenceItemCount, 134);
});
