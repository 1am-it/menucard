'use strict';

// X5 of the Delivery Lead order 6382189724: offline tests for the diagnosis
// helpers. No file, network or provider access.

const test = require('node:test');
const assert = require('node:assert/strict');

const { rawAnswerFiles, parseAnswers, answerConcept, diagnoseSource } = require('./menuSourceCoverageDiagnosis');

const FILES = [
  'pellens-r2-c0-call10-de4aa4382223.json.txt',
  'pellens-r1-c0-call8-515b6af5a226.json.txt',
  'pellens-r2-c1-call11-aaaaaaaaaaaa.json.txt',
  'wolfslaar-r2-c0-call22-eeaddd76dd86.json.txt',
  'notes.txt',
];

test('X5: de diagnose leest alleen de antwoorden van de gevraagde run', () => {
  const grouped = rawAnswerFiles(FILES, { run: 2 });
  assert.deepEqual([...grouped.keys()].sort(), ['pellens', 'wolfslaar']);
  assert.deepEqual(
    grouped.get('pellens').map((entry) => [entry.file, entry.call, entry.chunk]),
    [
      ['pellens-r2-c0-call10-de4aa4382223.json.txt', 10, 0],
      ['pellens-r2-c1-call11-aaaaaaaaaaaa.json.txt', 11, 1],
    ],
  );
  assert.equal(rawAnswerFiles(FILES, { run: 1 }).get('pellens').length, 1);
});

test('X5: een onleesbaar antwoord wordt gemeld en nooit stil overgeslagen', () => {
  const parsed = parseAnswers([
    { file: 'goed.json.txt', text: '{"menus":[],"rejected":[]}' },
    { file: 'kapot.json.txt', text: '{"menus":[' },
    { file: 'leeg.json.txt', text: '{"coverage":{}}' },
  ]);
  assert.equal(parsed.answers.length, 1);
  assert.deepEqual(parsed.problems.map((entry) => [entry.file, entry.reason]), [
    ['kapot.json.txt', 'invalid_json'],
    ['leeg.json.txt', 'no_menus'],
  ]);
});

test('X5: per bron telt de diagnose gedekte en niet-overgenomen regels', () => {
  const capture = {
    id: 'bron-01',
    kind: 'html',
    text: ['LUNCH', 'Bites', 'Soep 6,50', 'Steak 24,50', 'Koffie 2,80'].join('\n'),
  };
  const answers = [
    {
      file: 'bron-r2-c0-call1-aaaaaaaaaaaa.json.txt',
      value: {
        menus: [
          {
            title: 'Lunch',
            sourceId: 'bron-01',
            categories: [
              {
                name: 'Bites',
                items: [
                  { name: 'Soep', evidence: { sourceId: 'bron-01', locator: 'regel 3', quote: 'Soep 6,50' } },
                  { name: 'Koffie', evidence: { sourceId: 'bron-01', locator: 'regel 5', quote: 'Koffie 2,80' } },
                ],
              },
            ],
          },
        ],
        rejected: [],
      },
    },
  ];
  const row = diagnoseSource({ sourceId: 'bron', label: 'Bron', captures: [capture], answers });
  assert.equal(row.pricedLines, 3);
  assert.equal(row.acceptedItems, 2);
  assert.equal(row.comparison.coveredLines, 2);
  assert.equal(row.comparison.uncoveredLines, 1);
  assert.deepEqual(row.comparison.examples.map((line) => line.text), ['Steak 24,50']);
  assert.equal(row.comparison.examples[0].section, 'Bites');
});

test('X5: zonder brontekst blijft de diagnose eerlijk leeg', () => {
  const row = diagnoseSource({ sourceId: 'bron', captures: [], answers: [], captureStatus: 'blocked', blockedReason: 'missing local capture x' });
  assert.equal(row.comparison.available, false);
  assert.equal(row.comparison.uncoveredLines, null);
  assert.equal(row.blockedReason, 'missing local capture x');
  assert.deepEqual(answerConcept([]), { menus: [], rejected: [] });
});
