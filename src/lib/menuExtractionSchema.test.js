'use strict';

// Regressions for the independent validator of the extraction contract (#59).
//
// S2 and S3 of the Delivery Lead order for #59 / BE-21 (review 6376108648):
//   - S2: the evidence normalization equates typographic character classes and
//     nothing else, so a curly quote in the source and a straight quote in the
//     answer are the same passage, while a merged, added or invented passage
//     stays rejected;
//   - S3: multiple printed prices are accepted in exactly one shape, and the
//     validator stays the authority (no adapter repair, no silent flattening).
//
// Everything here is pure: no network, no key, no provider.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TYPOGRAPHIC_EQUIVALENTS,
  equateTypographicCharacters,
  normalizeEvidenceText,
  quoteIsPresentInSource,
  validateStructuredOutput,
} = require('./menuExtractionSchema');

const SOURCE_ID = 'smelt-01';
const SOURCE_TEXT = [
  'Soep van de dag',
  '6,50',
  'Gegrilde zeebaars ‘Catch of the day’ 21,50',
  'Huiswijn “droog” – glas 4,50',
  'Witbier 3,00',
  'Côte de boeuf 5\u00A0000 gram 62,00',
].join('\n');

function outputWith(entry, options = {}) {
  return {
    menus: [
      {
        title: 'Dinerkaart',
        sourceId: options.menuSourceId || SOURCE_ID,
        categories: [{ name: 'Hoofdgerechten', items: [entry] }],
      },
    ],
    rejected: [],
    coverage: {
      status: 'complete',
      sourcesRead: 1,
      pagesRead: 1,
      itemsExtracted: 1,
      unreadSources: [],
      limitations: [],
    },
  };
}

function item(quote, extra = {}) {
  return {
    name: 'Gegrilde zeebaars',
    priceStatus: 'known',
    amountMinorUnits: 2150,
    currency: 'EUR',
    evidence: { sourceId: SOURCE_ID, locator: 'regel 3', quote },
    ...extra,
  };
}

function sources(text = SOURCE_TEXT) {
  return [{ id: SOURCE_ID, url: 'https://fictief.example/menu', text }];
}

function quoteProblems(output, text = SOURCE_TEXT) {
  return validateStructuredOutput(output, sources(text)).filter((problem) => /evidence\.quote is not present/.test(problem));
}

test('S2: typographic quotes, dashes and the hard space are the same character, in both directions', () => {
  // The live Zuyd case: the source prints ‘…’ and the model answers '…'.
  assert.deepEqual(quoteProblems(outputWith(item("Gegrilde zeebaars 'Catch of the day' 21,50"))), []);
  // The other direction (a curly quote where the source is straight), plus the
  // double quote, the en/em dash and the hard space.
  assert.equal(quoteIsPresentInSource('Huiswijn "droog" - glas 4,50', SOURCE_TEXT), true);
  assert.equal(quoteIsPresentInSource('Huiswijn “droog” – glas 4,50', SOURCE_TEXT), true);
  assert.equal(quoteIsPresentInSource('Huiswijn “droog” — glas 4,50', SOURCE_TEXT), true);
  assert.equal(quoteIsPresentInSource('Côte de boeuf 5 000 gram 62,00', SOURCE_TEXT), true);
  // The prime and the double prime belong to the same class as ’ and ”.
  assert.equal(quoteIsPresentInSource("Gegrilde zeebaars 'Catch of the day' 21,50", 'Gegrilde zeebaars ′Catch of the day′ 21,50'), true);
  assert.equal(quoteIsPresentInSource('Huiswijn "droog" - glas 4,50', 'Huiswijn ″droog″ – glas 4,50'), true);
});

test('S2: the equivalence table holds only the documented characters, never letters or digits', () => {
  // A guard against a quiet widening: only these glyph variants may be equated.
  const documented = new Map([
    ['\u2018\u2019\u201A\u2032', "'"],
    ['\u201C\u201D\u201E\u2033', '"'],
    ['\u2013\u2014', '-'],
    ['\u00A0', ' '],
  ]);
  assert.equal(TYPOGRAPHIC_EQUIVALENTS.length, documented.size);
  for (const entry of TYPOGRAPHIC_EQUIVALENTS) {
    assert.equal(documented.get(entry.characters), entry.replacement);
    for (const character of entry.characters) {
      assert.match(character, /^[\u2018\u2019\u201A\u2032\u201C\u201D\u201E\u2033\u2013\u2014\u00A0]$/);
    }
  }
  // Letters, digits, punctuation and a zero-width space are not equated.
  assert.equal(equateTypographicCharacters('Côte boeuf 5 000'), 'Côte boeuf 5 000');
  assert.equal(equateTypographicCharacters('a\u200Bb'), 'a\u200Bb');
  assert.equal(equateTypographicCharacters('soep-6,50'), 'soep-6,50');
  assert.equal(normalizeEvidenceText('\u2018Catch\u2019  –  21,50'), "'catch' - 21,50");
});



test('S2: a joined, invented or altered passage stays rejected, with or without typographic quotes', () => {
  // Two source lines joined with a separator the source does not contain.
  assert.equal(quoteProblems(outputWith(item('Soep van de dag - 6,50'))).length, 1);
  assert.equal(quoteProblems(outputWith(item("Gegrilde zeebaars - 'Catch of the day' - 21,50"))).length, 1);
  // A digit that the source does not print is not a typographic variant.
  assert.equal(quoteProblems(outputWith(item("Gegrilde zeebaars 'Catch of the day' 21,60"))).length, 1);
  // Text that appears nowhere in the source.
  assert.equal(quoteProblems(outputWith(item('Verse oesters 3 stuks 12,00'))).length, 1);
  // An id outside the supplied inventory stays a rejection, not an empty pass.
  const unknown = outputWith(item("Gegrilde zeebaars 'Catch of the day' 21,50", {
    evidence: { sourceId: 'smelt-01.BRON', locator: 'regel 3', quote: "Gegrilde zeebaars 'Catch of the day' 21,50" },
  }));
  const problems = validateStructuredOutput(unknown, sources());
  assert.ok(problems.some((problem) => /evidence\.sourceId must reference the source inventory/.test(problem)));
});

test('S3: multiple printed prices are accepted in exactly one shape and nothing else', () => {
  const variants = [
    { label: 'Glas', amountMinorUnits: 450, currency: 'EUR' },
    { label: 'Fles', amountMinorUnits: 2400, currency: 'EUR' },
  ];
  const good = item("Gegrilde zeebaars 'Catch of the day' 21,50", {
    priceStatus: 'multiple_undecomposed',
    amountMinorUnits: null,
    currency: null,
    priceText: 'Glas 4,50 / Fles 24,00',
    priceVariants: variants,
  });
  assert.deepEqual(validateStructuredOutput(outputWith(good), sources()), []);

  // A known main price beside variants (the live Pellens shape) is refused.
  const splitStatus = item("Gegrilde zeebaars 'Catch of the day' 21,50", { priceVariants: variants });
  assert.ok(
    validateStructuredOutput(outputWith(splitStatus), sources()).some((problem) =>
      /priceVariants require priceStatus multiple_undecomposed/.test(problem),
    ),
  );

  // A main amount beside variants (the second live Pellens shape) is refused.
  const mainAmount = item("Gegrilde zeebaars 'Catch of the day' 21,50", {
    priceStatus: 'multiple_undecomposed',
    amountMinorUnits: 450,
    currency: 'EUR',
    priceVariants: variants,
  });
  assert.ok(
    validateStructuredOutput(outputWith(mainAmount), sources()).some((problem) =>
      /amountMinorUnits must be null when price variants exist/.test(problem),
    ),
  );

  // An amount for an item that is not "known" stays refused as before.
  const onRequest = item("Gegrilde zeebaars 'Catch of the day' 21,50", { priceStatus: 'on_request' });
  assert.ok(
    validateStructuredOutput(outputWith(onRequest), sources()).some((problem) =>
      /amountMinorUnits must be absent\/null unless known/.test(problem),
    ),
  );
  // A single printed price keeps its unchanged shape.
  assert.deepEqual(validateStructuredOutput(outputWith(item("Gegrilde zeebaars 'Catch of the day' 21,50")), sources()), []);
});
