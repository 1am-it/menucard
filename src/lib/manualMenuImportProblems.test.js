'use strict';

// #59 — U1/U2 (Delivery Lead review 6376543234).
//
// Deze regressies bewijzen dat een afgekeurd antwoord begrijpelijk wordt:
//   - elke regel van de bestaande validator krijgt een gewone Nederlandse zin;
//   - problemen worden per soort gegroepeerd en geteld, met het gerecht of de
//     rubriek erbij als het pad bekend is;
//   - nooit meer dan vijf groepen, en niets verdwijnt stil;
//   - de hoofdtekst bevat geen JSON-pad en geen technische code;
//   - de herstelvraag is deterministisch en komt uit precies dezelfde groepen.
//
// De validator zelf wordt niet aangeraakt: deze module vertaalt alleen.

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateStructuredOutput } = require('./menuExtractionSchema');
const {
  MAX_PROBLEM_GROUPS,
  describeImportProblems,
  buildRecoveryQuestion,
  classifyProblem,
} = require('./manualMenuImportProblems');

const ITEM = 'menus[0].categories[0].items[0]';

function output() {
  return {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              {
                name: 'Vis van de dag',
                priceStatus: 'known',
                amountMinorUnits: 1450,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'Bites · 1', quote: 'Catch of the day' },
              },
              {
                name: 'Glas huiswijn',
                priceStatus: 'known',
                amountMinorUnits: 450,
                currency: 'EUR',
                priceVariants: [{ label: 'Glas', amountMinorUnits: 450, currency: 'EUR' }],
                evidence: { sourceId: 'source-1', locator: 'Bites · 2', quote: 'Glas huiswijn 4,50' },
              },
            ],
          },
        ],
      },
    ],
  };
}

// Elke regel die menuExtractionSchema.validateStructuredOutput kan opleveren.
const CASES = [
  ['output must be an object', 'answer_not_object'],
  ['forbidden trust key: confidence', 'forbidden_trust_key'],
  ['unknown top-level field: confidenceScore', 'unknown_field'],
  ['menus must be an array', 'menus_missing'],
  ['coverage must be an object', 'coverage_missing'],
  ['more than 100 menus', 'too_many_menus'],
  ['more than 1000 items', 'too_many_items'],
  ['menus[0] must be an object', 'shape_invalid'],
  ['menus[0] has unknown fields', 'unknown_field'],
  ['menus[0].title must be a short non-empty string', 'menu_title_missing'],
  ['menus[0].sourceId must reference the source inventory', 'menu_source_unknown'],
  ['menus[0].variant must be null or a short string', 'menu_variant_invalid'],
  ['menus[0].order must be a non-negative integer or null', 'menu_order_invalid'],
  ['menus[0].categories must be an array', 'categories_missing'],
  ['menus[0] has more than 100 categories', 'too_many_categories'],
  ['menus[0].categories[0] must be an object', 'shape_invalid'],
  ['menus[0].categories[0] has unknown fields', 'unknown_field'],
  ['menus[0].categories[0].name must be a short non-empty string', 'name_missing'],
  ['menus[0].categories[0].path must be a bounded string array', 'category_path_invalid'],
  ['menus[0].categories[0].uncertain must be boolean when present', 'category_uncertain_invalid'],
  ['menus[0].categories[0].items must be an array', 'items_missing'],
  ['menus[0].categories[0] has more than 500 items', 'too_many_items'],
  [`${ITEM} must be an object`, 'shape_invalid'],
  [`${ITEM} has unknown fields`, 'unknown_field'],
  [`${ITEM}.name must be a short non-empty string`, 'name_missing'],
  [`${ITEM}.description is too long or not a string`, 'description_invalid'],
  [`${ITEM}.priceStatus is invalid`, 'price_status_invalid'],
  [`${ITEM}.amountMinorUnits is required for a known price`, 'price_known_incomplete'],
  [`${ITEM}.amountMinorUnits must be absent/null unless known`, 'price_unexpected'],
  [`${ITEM}.currency must be EUR for a known price`, 'price_known_incomplete'],
  [`${ITEM}.currency must be absent/null unless known`, 'price_unexpected'],
  [`${ITEM}.priceText is too long or not a string`, 'price_text_invalid'],
  [`${ITEM}.isFrom must be boolean when present`, 'is_from_invalid'],
  [`${ITEM}.supplementOf must be a short non-empty item reference`, 'supplement_invalid'],
  [`${ITEM}.priceVariants must be an array of at most 10`, 'price_variants_invalid'],
  [`${ITEM}.priceVariants require priceStatus multiple_undecomposed`, 'price_variants_conflict'],
  [`${ITEM}.amountMinorUnits must be null when price variants exist`, 'price_variants_conflict'],
  [`${ITEM}.priceVariants[0] has unknown fields`, 'price_variants_invalid'],
  [`${ITEM}.priceVariants[0].currency must be EUR`, 'price_variants_invalid'],
  [`${ITEM}.allergens must be an object with status and values`, 'allergens_invalid'],
  [`${ITEM}.allergens explicit status needs at least one value`, 'allergens_invalid'],
  [`${ITEM}.availability must be a short non-empty string`, 'availability_invalid'],
  [`${ITEM}.evidence must be an object`, 'evidence_missing'],
  [`${ITEM}.evidence has unknown fields`, 'unknown_field'],
  [`${ITEM}.evidence.sourceId must reference the source inventory`, 'source_not_in_inventory'],
  [`${ITEM}.evidence.locator must be a short non-empty string`, 'locator_missing'],
  [`${ITEM}.evidence.quote must contain a short supporting passage`, 'quote_missing'],
  [`${ITEM}.evidence.quote is not present in the cited source`, 'quote_not_in_source'],
  ['rejected must be a bounded array', 'rejected_invalid'],
  ['rejected[0] has unknown fields', 'rejected_invalid'],
  ['coverage has unknown fields', 'unknown_field'],
  ['coverage.status is invalid', 'coverage_status_conflict'],
  ['coverage.sourcesRead must be a non-negative integer', 'coverage_counts_invalid'],
  ['coverage.itemsExtracted must equal the number of extracted items', 'coverage_count_mismatch'],
  ['coverage.sourcesRead exceeds the source inventory', 'coverage_count_mismatch'],
  ['coverage.unreadSources must be a bounded array', 'coverage_unread_invalid'],
  ['coverage.unreadSources[0] is invalid', 'coverage_unread_invalid'],
  ['coverage.limitations must be a bounded string array', 'coverage_limitations_invalid'],
  ['complete coverage cannot contain unread sources', 'coverage_status_conflict'],
  ['partial coverage needs an unread source or limitation', 'coverage_status_conflict'],
  ['no_items coverage cannot contain extracted items', 'coverage_status_conflict'],
  ['coverage status requires at least one extracted item', 'coverage_status_conflict'],
];

test('U1: elke validatorregel krijgt een gewone Nederlandse zin', () => {
  for (const [problem, expected] of CASES) {
    assert.equal(classifyProblem(problem), expected, problem);
  }
  // Niets blijft onvertaald: dezelfde regels, alleen in gewone taal.
  const described = describeImportProblems(CASES.map(([problem]) => problem), output());
  assert.equal(described.groups.some((group) => group.code === 'unclassified'), false);
  for (const group of described.groups) {
    assert.match(
      group.text,
      /^(Bij \d+ (gerecht|gerechten|rubriek|rubrieken|menukaart|menukaarten|afgewezen regel|afgewezen regels|ongelezen bron|ongelezen bronnen)|Op \d+ plek)/,
      group.text,
    );
  }
});

test('U1: dezelfde fout bij meerdere gerechten is één groep met een voorbeeld', () => {
  const problems = [
    'menus[0].categories[0].items[0].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[1].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[1].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[1].evidence.quote is not present in the cited source',
  ];
  const described = describeImportProblems(problems, output());
  assert.equal(described.groups.length, 1);
  assert.equal(described.groups[0].count, 4);
  assert.equal(
    described.groups[0].text,
    'Bij 4 gerechten staat het citaat niet letterlijk in de bron (bijvoorbeeld \u2018Catch of the day\u2019 bij \u201CVis van de dag\u201D).',
  );
  assert.equal(described.groups[0].technical.length, 4);
});

test('U1: één geval heet één gerecht en de prijsvariantregel blijft leesbaar', () => {
  const problems = [
    'menus[0].categories[0].items[1].priceVariants require priceStatus multiple_undecomposed',
    'menus[0].categories[0].items[1].amountMinorUnits must be null when price variants exist',
  ];
  const described = describeImportProblems(problems, output());
  assert.equal(described.groups.length, 1);
  assert.equal(described.groups[0].count, 2);
  assert.match(described.groups[0].text, /^Bij 2 gerechten met meerdere prijzen staat ook één losse hoofdprijs/);
  assert.match(described.groups[0].text, /Glas huiswijn/);

  const single = describeImportProblems(['menus[0].title must be a short non-empty string'], output());
  assert.equal(single.groups.length, 1);
  assert.match(single.groups[0].text, /^Bij 1 menukaart ontbreekt de titel van de menukaart/);
});

test('U1: hooguit vijf groepen en niets verdwijnt stil', () => {
  const problems = [
    'menus[0].categories[0].items[0].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[0].priceStatus is invalid',
    'menus[0].categories[0].items[0].description is too long or not a string',
    'menus[0].categories[0].items[0].isFrom must be boolean when present',
    'menus[0].categories[0].items[0].allergens must be an object with status and values',
    'coverage.status is invalid',
    'coverage.sourcesRead exceeds the source inventory',
    'menus[0].title must be a short non-empty string',
  ];
  const described = describeImportProblems(problems, output());
  assert.equal(described.groups.length, MAX_PROBLEM_GROUPS);
  assert.equal(described.omitted, 3);
  const kept = described.groups.reduce((sum, group) => sum + group.count, 0);
  assert.equal(kept + described.omitted, 8);
});

test('U1: een onbekende regel wordt vertaald en niet stil weggelaten', () => {
  const described = describeImportProblems(['something entirely new'], output());
  assert.equal(described.groups.length, 1);
  assert.equal(described.groups[0].code, 'unclassified');
  assert.match(described.groups[0].text, /past een onderdeel niet bij de afspraken/);
});

test('U1: de hoofdtekst bevat geen JSON-pad en geen technische code', () => {
  const problems = [
    'menus[0].categories[0].items[0].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[1].priceVariants require priceStatus multiple_undecomposed',
    'coverage.itemsExtracted must equal the number of extracted items',
    'forbidden trust key: reviewReady',
  ];
  const described = describeImportProblems(problems, output());
  for (const group of described.groups) {
    assert.equal(/menus\[|coverage\.|items\[|sourceId|priceVariants/.test(group.text), false, group.text);
    assert.equal(/[a-z]+_[a-z]+/.test(group.text), false, group.text);
  }
  assert.equal(described.groups.some((group) => group.technical.length > 0), true);
});

test('U2: de herstelvraag is deterministisch en bevat alle punten', () => {
  const problems = [
    'menus[0].categories[0].items[0].evidence.quote is not present in the cited source',
    'menus[0].categories[0].items[1].priceVariants require priceStatus multiple_undecomposed',
  ];
  const first = describeImportProblems(problems, output());
  const second = describeImportProblems(problems.slice(), output());
  assert.equal(first.recoveryQuestion, second.recoveryQuestion);
  assert.match(
    first.recoveryQuestion,
    /^Corrigeer alleen deze punten en geef daarna het volledige antwoord opnieuw in precies één codeblok:/,
  );
  assert.match(first.recoveryQuestion, /\n1\. Bij 1 gerecht staat het citaat niet letterlijk in de bron/);
  assert.match(first.recoveryQuestion, /\n2\. Bij 1 gerecht met meerdere prijzen staat ook één losse hoofdprijs/);
  assert.match(first.recoveryQuestion, /Verander niets anders/);
  assert.equal(first.recoveryQuestion.includes('menus['), false);
  assert.equal(first.recoveryQuestion.includes('coverage.'), false);

  const empty = describeImportProblems([], output());
  assert.equal(empty.groups.length, 0);
  assert.equal(empty.recoveryQuestion, null);
  assert.equal(buildRecoveryQuestion(null), null);
});

test('U1: echte validatoruitvoer levert alleen vertaalde groepen', () => {
  const broken = {
    menus: [
      {
        title: '',
        sourceId: 'onbekend',
        categories: [
          {
            name: '',
            items: [
              {
                name: '',
                priceStatus: 'ongeveer',
                amountMinorUnits: null,
                currency: 'USD',
                evidence: { sourceId: 'onbekend', locator: '', quote: 'staat er niet' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'compleet', sourcesRead: 9, pagesRead: -1, itemsExtracted: 9, unreadSources: [], limitations: [] },
  };
  const problems = validateStructuredOutput(broken, [{ id: 'source-1', text: 'LUNCH\nBites\nBroodplank 8,50' }]);
  assert.equal(problems.length > 0, true);
  const described = describeImportProblems(problems, broken);
  assert.equal(described.groups.some((group) => group.code === 'unclassified'), false, JSON.stringify(described.groups));
  assert.equal(described.groups.length <= MAX_PROBLEM_GROUPS, true);
  assert.match(described.recoveryQuestion, /^Corrigeer alleen deze punten/);
});

