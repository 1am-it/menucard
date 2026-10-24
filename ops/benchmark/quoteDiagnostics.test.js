'use strict';

// Q2/Q4 of the Delivery Lead order for #59 / BE-21 (review 6375125413): the
// offline citation diagnosis. Fixtures only: no key, no network, no provider.

const test = require('node:test');
const assert = require('node:assert/strict');

const { diagnoseAnswer, diagnoseRawText, fragmentsOf, segmentsOfText, similarity } = require('./quoteDiagnostics');
const { validateStructuredOutput } = require('../../src/lib/menuExtractionSchema');

// A menu page whose name and price are on separate lines, and where two items
// are separated by an unrelated line: exactly the shapes a model tends to join.
const SOURCE_TEXT = ['LUNCH', 'Soep van de dag', '6,50', 'Bitterballen (8 st.)', '7,25', 'Frikandel', '', 'Losse regel', '', 'Kaas'].join('\n');
const sources = [{ id: 'cap-1', url: 'https://fictief.example/lunch', text: SOURCE_TEXT }];

function item(name, quote, sourceId = 'cap-1') {
  return {
    name,
    priceStatus: 'known',
    amountMinorUnits: 650,
    currency: 'EUR',
    evidence: { sourceId, locator: `regel ${name}`, quote },
  };
}

function answerWith(items, sourceId = 'cap-1') {
  return {
    menus: [{ title: 'Lunch', sourceId, categories: [{ name: 'Voor', items }] }],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: items.length, unreadSources: [], limitations: [] },
  };
}

function fixtureItems() {
  return [
    // Accepted by the validator, so never diagnosed.
    item('Soep', 'Soep van de dag'),
    // The separator the model chose is not in the source.
    item('Soep met prijs', 'Soep van de dag - 6,50'),
    // Both parts exist, but they are not one run in the source.
    item('Frikandel met kaas', 'Frikandel | Kaas'),
    // The source has a comma, the answer a point.
    item('Bitterballen', 'Bitterballen (8 st.) 7.25'),
    // Same text apart from a zero-width space.
    item('Soep zonder breedte', 'Soep\u200bvan de dag'),
    // No source passage supports this at all.
    item('Verzonnen', 'Verzonnen gerecht 12,00'),
  ];
}

test('Q2: every failed citation gets a quote, an item, the nearest fragments and a classification', () => {
  const output = answerWith(fixtureItems());
  const diagnosis = diagnoseAnswer({ output, sources });
  assert.equal(diagnosis.items, 6);
  assert.equal(diagnosis.itemsWithQuote, 6);
  assert.equal(diagnosis.itemsWithoutQuote, 0);
  assert.equal(diagnosis.itemsWithQuoteNotFound, 5);
  assert.equal(diagnosis.itemsWithInvalidQuote, 5);
  assert.deepEqual(diagnosis.classes, {
    added_separator: 1,
    merged_lines: 1,
    changed_characters: 1,
    whitespace_only: 1,
    invented_text: 1,
    unknown_source: 0,
  });
  // The accepted quote is not in the report at all.
  assert.equal(diagnosis.quotes.some((quote) => quote.quote === 'Soep van de dag'), false);
  const byName = Object.fromEntries(diagnosis.quotes.map((quote) => [quote.itemName, quote]));
  assert.equal(byName['Soep met prijs'].classification, 'added_separator');
  assert.equal(byName['Soep met prijs'].label, 'toegevoegd scheidingsteken');
  assert.equal(byName['Frikandel met kaas'].classification, 'merged_lines');
  assert.equal(byName['Bitterballen'].classification, 'changed_characters');
  assert.equal(byName['Soep zonder breedte'].classification, 'whitespace_only');
  assert.equal(byName['Verzonnen'].classification, 'invented_text');
  // The item path and the source reference travel with the quote.
  assert.equal(byName['Verzonnen'].at, 'menus[0].categories[0].items[5]');
  assert.equal(byName['Verzonnen'].categoryName, 'Voor');
  assert.equal(byName['Verzonnen'].menuTitle, 'Lunch');
  assert.equal(byName['Verzonnen'].sourceId, 'cap-1');
  // The nearest source fragments are real lines of the capture.
  const nearest = byName['Soep met prijs'].nearest;
  assert.ok(nearest.length > 0);
  assert.equal(nearest[0].captureId, 'cap-1');
  assert.equal(nearest[0].text, 'Soep van de dag');
  assert.equal(nearest[0].line, 2);
  assert.ok(nearest[0].score > 0 && nearest[0].score <= 1);
});

test('Q4: the diagnosis stays with the validator and never accepts a rejected quote', () => {
  const output = answerWith(fixtureItems());
  const diagnosis = diagnoseAnswer({ output, sources });
  const problems = validateStructuredOutput(output, sources);
  const quoteProblems = problems.filter((problem) => /evidence\.quote is not present in the cited source/.test(problem));
  // The validator rejects exactly the same items; the diagnosis does not loosen,
  // extend or bypass it.
  assert.equal(quoteProblems.length, diagnosis.itemsWithQuoteNotFound);
  for (const at of diagnosis.quotes.map((quote) => quote.at)) {
    assert.ok(quoteProblems.some((problem) => problem.startsWith(at)), `${at} must be rejected by the validator`);
  }
});

test('Q2: a missing quote and an unknown source are counted instead of skipped', () => {
  const output = answerWith([
    { name: 'Zonder citaat', priceStatus: 'unknown', evidence: { sourceId: 'cap-1', locator: 'regel 2', quote: '' } },
    item('Andere bron', 'Soep van de dag', 'cap-9'),
  ]);
  const diagnosis = diagnoseAnswer({ output, sources });
  assert.equal(diagnosis.items, 2);
  assert.equal(diagnosis.itemsWithoutQuote, 1);
  assert.equal(diagnosis.itemsWithUnknownSource, 1);
  assert.equal(diagnosis.itemsWithInvalidQuote, 2);
  assert.equal(diagnosis.itemsWithQuoteNotFound, 0);
  assert.equal(diagnosis.classes.unknown_source, 1);
  // The five text classes are untouched: an unknown source is its own case.
  for (const code of ['added_separator', 'merged_lines', 'changed_characters', 'whitespace_only', 'invented_text']) {
    assert.equal(diagnosis.classes[code], 0);
  }
  assert.equal(diagnosis.quotes.find((quote) => quote.itemName === 'Andere bron').classification, 'unknown_source');
});

test('Q2: an answer that is not JSON has no item count and says why', () => {
  const diagnosis = diagnoseRawText({ text: '{"menus":[', sources });
  assert.equal(diagnosis.outputParsed, false);
  assert.equal(diagnosis.items, null);
  assert.match(diagnosis.parseError, /JSON/);
  assert.equal(diagnoseRawText({ text: '   ', sources }).parseError, 'empty_answer');
});

test('Q2: the source fragments carry exact offsets and line numbers', () => {
  const text = 'Kop\n\nSoep van de dag\t6,50\nBitterballen';
  const segments = segmentsOfText(text);
  assert.deepEqual(
    segments.map((segment) => [segment.line, segment.text]),
    [
      [1, 'Kop'],
      [3, 'Soep van de dag'],
      [3, '6,50'],
      [4, 'Bitterballen'],
    ],
  );
  for (const segment of segments) assert.equal(text.slice(segment.offset, segment.offset + segment.text.length), segment.text);
  // Two identical quotes score 1; two unrelated ones score 0.
  assert.equal(similarity('soep van de dag', 'soep van de dag'), 1);
  assert.equal(similarity('soep', 'xyz'), 0);
});

test('Q2: a quote with line breaks and plain separators is split into its fragments', () => {
  assert.deepEqual(fragmentsOf('Soep van de dag - 6,50'), ['soep van de dag', '6,50']);
  assert.deepEqual(fragmentsOf('Soep\n6,50'), ['soep', '6,50']);
  assert.deepEqual(fragmentsOf('Soep | 6,50'), ['soep', '6,50']);
  assert.deepEqual(fragmentsOf('Frikandel/Kaas'), ['frikandel/kaas']);
});


