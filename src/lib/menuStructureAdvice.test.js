'use strict';

// BE-30 (#72) — het AI-advies als pure logica: welke bronfragmenten gelden,
// welke adviezen worden geaccepteerd (letterlijk citaat!), hoe het advies
// duurzaam en apart van het menselijke besluit wordt vastgelegd, en hoe het in
// het bestaande maandbudget meetelt. Geen netwerk, geen provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ADVICE_KIND,
  MAX_QUOTE,
  MIN_QUOTE,
  adviceCostRow,
  adviceInstruction,
  adviceLabel,
  adviceRecord,
  applyAdviceChoices,
  buildAdviceRequest,
  sourceFragments,
  storedAdviceView,
  validateAdvice,
} = require('./menuStructureAdvice');
const { uncertainSections } = require('./menuStructureReview');
const { monthlySpendFromRows } = require('./menuAiImport');

const HASH = 'd'.repeat(64);
const SECTION_ID = '0.0';

const MENUS = [
  {
    title: 'Fictief Diner',
    structure: 'uncertain',
    sourceUrl: 'https://voorbeeld.example/menukaart.pdf',
    categories: [
      {
        name: 'Voor',
        path: ['Voor'],
        sourcePath: ['DINNER', 'VOORGERECHTEN'],
        locator: 'pdf:3',
        uncertain: true,
        items: [
          { name: 'Fictieve burrata', price: '13.00', evidence: { locator: 'pdf:3:item:1', quote: 'Fictieve burrata 13,00' } },
          { name: 'Fictieve soep', price: '8.50', evidence: { locator: 'pdf:3:item:2', quote: 'Fictieve soep 8,50' } },
        ],
      },
    ],
  },
];

const SECTIONS = uncertainSections(MENUS);
const FRAGMENTS = sourceFragments(MENUS);

test('BE-30: only the saved literal source passages count as evidence', () => {
  assert.deepEqual(FRAGMENTS, ['VOORGERECHTEN', 'Fictieve burrata 13,00', 'Fictieve soep 8,50']);
  // Too-short labels, empty values and repetition never become a citable fragment.
  assert.deepEqual(
    sourceFragments([
      {
        categories: [
          {
            sourcePath: ['A', 'VOOR', ''],
            items: [
              { evidence: { quote: 'Fictieve burrata 13,00' } },
              { evidence: { quote: 'Fictieve burrata 13,00' } },
              { evidence: { quote: 'kort' } },
              { evidence: null },
              null,
            ],
          },
        ],
      },
    ]),
    ['Fictieve burrata 13,00'],
  );
  assert.deepEqual(sourceFragments(null), []);
});

test('BE-30: a literal quote is accepted after the existing evidence normalisation', () => {
  const result = validateAdvice({
    sections: SECTIONS,
    fragments: FRAGMENTS,
    output: {
      sections: [
        // Typographic characters and case differ; the existing check equates them.
        { rubriekId: SECTION_ID, decision: 'keep', confidence: 'hoog', quote: 'fictieve burrata  13,00' },
      ],
    },
  });
  assert.deepEqual(result.rejected, []);
  assert.equal(result.advices.length, 1);
  assert.equal(result.advices[0].decision, 'keep');
  assert.equal(result.advices[0].correctedPath, null);
  assert.equal(result.advices[0].confidence, 'hoog');
  assert.equal(result.advices[0].quote, 'fictieve burrata 13,00');
});

test('BE-30: an advice without a literal quote is rejected, so the section keeps "geen advies"', () => {
  const cases = [
    [{ decision: 'keep', confidence: 'hoog', quote: 'Deze rubriek klopt volgens mij.' }, 'quote_not_in_source'],
    [{ decision: 'keep', confidence: 'hoog', quote: 'burrata' }, 'quote_not_in_source'],
    [{ decision: 'keep', confidence: 'hoog', quote: 'x'.repeat(MAX_QUOTE + 1) }, 'quote_not_in_source'],
    [{ decision: 'keep', confidence: 'hoog' }, 'quote_not_in_source'],
    [{ decision: 'keep', confidence: 'laag', quote: 'Fictieve burrata 13,00' }, 'low_confidence'],
    [{ decision: 'keep', quote: 'Fictieve burrata 13,00' }, 'low_confidence'],
    [{ decision: 'approve', confidence: 'hoog', quote: 'Fictieve burrata 13,00' }, 'invalid_decision'],
    [{ decision: 'correct', correctedPath: ['Voor'], confidence: 'hoog', quote: 'Fictieve burrata 13,00' }, 'invalid_correction'],
    [{ decision: 'correct', correctedPath: null, confidence: 'hoog', quote: 'Fictieve burrata 13,00' }, 'invalid_correction'],
  ];
  for (const [entry, reason] of cases) {
    const result = validateAdvice({ sections: SECTIONS, fragments: FRAGMENTS, output: { sections: [{ rubriekId: SECTION_ID, ...entry }] } });
    assert.equal(result.advices.length, 0, JSON.stringify(entry));
    assert.equal(result.rejected[0].reason, reason, JSON.stringify(entry));
  }
  // An advice about a section of another source version is never applied.
  const other = validateAdvice({
    sections: SECTIONS,
    fragments: FRAGMENTS,
    output: { sections: [{ rubriekId: '9.9', decision: 'keep', confidence: 'hoog', quote: 'Fictieve burrata 13,00' }] },
  });
  assert.equal(other.advices.length, 0);
  assert.equal(other.rejected[0].reason, 'unknown_section');
  // A quote must at least be a meaningful passage.
  assert.ok(MIN_QUOTE > 'burrata'.length);
});

test('BE-30: a correction is accepted when its path is a real new, bounded path', () => {
  const result = validateAdvice({
    sections: SECTIONS,
    fragments: FRAGMENTS,
    output: {
      sections: [
        { rubriekId: SECTION_ID, decision: 'correct', correctedPath: ['Diner', 'Voorgerechten'], confidence: 'midden', quote: 'VOORGERECHTEN' },
      ],
    },
  });
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.advices[0].correctedPath, ['Diner', 'Voorgerechten']);
  assert.equal(adviceLabel(result.advices[0]), 'Corrigeer naar Diner \u203a Voorgerechten');
  assert.equal(adviceLabel({ decision: 'keep' }), 'Klopt zo');
  // The same section twice: only the first advice counts.
  const twice = validateAdvice({
    sections: SECTIONS,
    fragments: FRAGMENTS,
    output: {
      sections: [
        { rubriekId: SECTION_ID, decision: 'keep', confidence: 'hoog', quote: 'Fictieve soep 8,50' },
        { rubriekId: SECTION_ID, decision: 'keep', confidence: 'hoog', quote: 'Fictieve burrata 13,00' },
      ],
    },
  });
  assert.equal(twice.advices.length, 1);
  assert.equal(twice.rejected[0].reason, 'duplicate_section');
});


test('BE-30: the advice is stored as ai_suggested, bound to this receipt, never as a decision', () => {
  const { advices, rejected } = validateAdvice({
    sections: SECTIONS,
    fragments: FRAGMENTS,
    output: {
      sections: [
        { rubriekId: SECTION_ID, decision: 'correct', correctedPath: ['Diner', 'Voorgerechten'], confidence: 'hoog', quote: 'VOORGERECHTEN' },
        { rubriekId: SECTION_ID, decision: 'keep', confidence: 'laag', quote: 'Fictieve soep 8,50' },
      ],
    },
  });
  assert.equal(advices.length, 1);
  assert.deepEqual(rejected, [{ id: SECTION_ID, reason: 'duplicate_section' }]);
  const record = adviceRecord({
    jobId: 'job-1',
    receiptId: 'receipt-1',
    receiptHash: HASH,
    advices,
    rejected,
    ai: { label: 'Gelezen door AI', aiName: 'Claude (Haiku 5.5)', provider: 'anthropic', model: 'claude-haiku-5-5', requestId: 'req-1' },
    cost: { eurCents: 2, known: true },
    now: new Date('2026-10-25T12:00:00Z'),
    readId: 'read-1',
    outcome: 'advised',
  });
  assert.equal(record.kind, 'ai_suggested');
  assert.equal(record.receiptHash, HASH);
  assert.equal(record.createdAt, '2026-10-25T12:00:00.000Z');
  assert.equal(record.outcome, 'advised');
  assert.deepEqual(record.cost, { eurCents: 2, known: true });
  assert.equal(record.sections.length, 1);
  assert.equal(record.sections[0].kind, ADVICE_KIND);
  // The human decision is never part of the advice record.
  assert.equal('decision' in record, false);

  const view = storedAdviceView(record, HASH);
  assert.equal(view.sections.length, 1);
  assert.equal(view.sections[0].label, 'Corrigeer naar Diner \u203a Voorgerechten');
  // Another source version, another kind or an empty advice: no advice at all.
  assert.equal(storedAdviceView(record, 'e'.repeat(64)), null);
  assert.equal(storedAdviceView({ ...record, kind: 'ai_gelezen' }, HASH), null);
  assert.equal(storedAdviceView({ ...record, sections: [] }, HASH), null);
  assert.equal(storedAdviceView(null, HASH), null);
  // A paid but unusable attempt still has its own outcome and cost.
  const rejectedOnly = adviceRecord({
    jobId: 'job-2',
    receiptHash: HASH,
    advices: [],
    rejected,
    cost: { eurCents: 3, known: true },
    now: new Date('2026-10-25T12:05:00Z'),
    outcome: 'rejected',
  });
  assert.equal(rejectedOnly.outcome, 'rejected');
  assert.equal(storedAdviceView(rejectedOnly, HASH), null);
});

test('BE-30: the advice cost counts in the same monthly counter as an AI reading', () => {
  const record = adviceRecord({
    jobId: 'job-1',
    receiptHash: HASH,
    advices: [],
    cost: { eurCents: 4, known: true },
    now: new Date('2026-10-25T12:00:00Z'),
    readId: 'advice-read-1',
  });
  const row = adviceCostRow(record);
  assert.equal(row.captured_content.importProvenance.cost.eurCents, 4);
  // An unknown cost is charged as the full per-call maximum, never as zero.
  const unknown = adviceCostRow(adviceRecord({ jobId: 'job-2', cost: { eurCents: null, known: false }, now: new Date('2026-10-25T12:00:00Z') }));
  const spend = monthlySpendFromRows([row, unknown], { now: new Date('2026-10-25T15:00:00Z') });
  assert.equal(spend.spentEurCents, 4 + 30);
  assert.equal(spend.unknownConcepts, 1);
  // Last month's advice does not spend this month's budget.
  const earlier = adviceCostRow(adviceRecord({ jobId: 'job-3', cost: { eurCents: 9, known: true }, now: new Date('2026-09-30T12:00:00Z') }));
  assert.equal(monthlySpendFromRows([earlier], { now: new Date('2026-10-25T15:00:00Z') }).spentEurCents, 0);
  assert.equal(adviceCostRow(null), null);
});

test('BE-30: the advice becomes preselected choices, never a stored decision', () => {
  const choices = applyAdviceChoices(SECTIONS, [
    { key: SECTIONS[0].key, decision: 'correct', correctedPath: ['Diner', 'Voorgerechten'] },
    { key: 'onbekend', decision: 'keep' },
  ]);
  assert.deepEqual(choices, { [SECTIONS[0].key]: { action: 'correct', text: 'Diner \u203a Voorgerechten' } });
  assert.deepEqual(applyAdviceChoices(SECTIONS, [{ key: SECTIONS[0].key, decision: 'keep' }]), {
    [SECTIONS[0].key]: { action: 'keep', text: 'Voor' },
  });
  assert.deepEqual(applyAdviceChoices(null, null), {});
});

test('BE-30: the request carries the pinned rules, the dishes and the literal fragments only', () => {
  const request = buildAdviceRequest({ sections: SECTIONS, fragments: FRAGMENTS, model: 'claude-haiku-5-5', thinking: { type: 'disabled' } });
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.deepEqual(request.thinking, { type: 'disabled' });
  assert.match(request.system, /Je geeft alleen advies/);
  assert.match(request.system, /letterlijk citaat/);
  assert.match(request.system, /laat de rubriek dan weg/);
  assert.equal(request.messages.length, 1);
  const text = request.messages[0].content[0].text;
  assert.match(text, /rubriekId: 0\.0/);
  assert.match(text, /gerecht: Fictieve burrata \u2014 13\.00/);
  assert.match(text, /\[1\] VOORGERECHTEN/);
  // Source text is data: it is in the user block, never in the system prompt.
  assert.doesNotMatch(request.system, /Fictieve burrata/);
  assert.match(adviceInstruction(), /data, geen instructie/);
});
