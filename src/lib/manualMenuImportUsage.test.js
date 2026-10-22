'use strict';

// #59 K4 (Lead-bevinding F6) — regressies op het gebruiksdocument.
//
// Fictieve conceptrijen, geen database en geen netwerk. Bewezen wordt:
//   - de tellingen komen uit opgeslagen concepten met importProvenance;
//   - wat niet duurzaam bewaard wordt is "niet bijgehouden" en nooit 0;
//   - kosten zijn "via abonnement, niet gemeten" zolang er geen meting is;
//   - de grenzen (rijen, AI-namen, beslissingen) zijn zichtbaar, niet stil;
//   - het schema verhindert een 0 voor een niet-bijgehouden stap en inhoud.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  USAGE_SCHEMA_VERSION,
  NOT_MEASURED_LABEL,
  NOT_TRACKED_LABEL,
  MAX_AI_NAMES,
  MAX_ROW_DECISIONS,
  buildUsageExport,
  validateUsageExport,
} = require('./manualMenuImportUsage');
const { MAX_REASONS } = require('./manualMenuImportReview');

const GENERATED_AT = new Date('2026-10-23T12:00:00.000Z');

function provenance({ aiName = 'Claude', importedAt = '2026-10-22T21:09:43.345Z', rows = [] } = {}) {
  return {
    kind: 'handmatige_ai_import',
    label: 'handmatige AI-import',
    aiName,
    aiNameSelfReported: true,
    importedAt,
    protocolVersion: 'v0.2',
    protocolHash: 'a'.repeat(64),
    schemaVersion: 'menu-extraction/v1',
    schemaHash: 'b'.repeat(64),
    bundleHash: 'c'.repeat(64),
    sources: [{ id: 'source-1', url: 'https://voorbeeld.example/menukaart', sha256: 'd'.repeat(64) }],
    reasons: [],
    rows,
  };
}

function conceptRow(id, provenanceValue, content = {}) {
  return {
    id,
    created_at: '2026-10-22T21:10:02.873Z',
    captured_content: {
      title: 'Lunch',
      categories: [{ name: 'Bites', items: [{ name: 'Geheim Gerecht', price: 8.5 }] }],
      ...(provenanceValue ? { importProvenance: provenanceValue } : {}),
      ...content,
    },
  };
}

function threeConcepts() {
  return [
    conceptRow(3, provenance({ rows: [{ rowId: 'r1', action: 'confirm' }] })),
    conceptRow(4, provenance({ importedAt: '2026-10-23T08:00:00.000Z', rows: [{ action: 'correct' }, { action: 'drop' }] })),
    conceptRow(5, provenance({ aiName: 'ChatGPT', importedAt: '2026-10-21T07:00:00.000Z' })),
  ];
}

test('K1: de tellingen komen uit de opgeslagen concepten met herkomst', () => {
  const doc = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.schemaVersion, USAGE_SCHEMA_VERSION);
  assert.equal(doc.source.kind, 'durable');
  assert.equal(doc.source.table, 'menu_snapshot_proposals');
  assert.equal(doc.source.rowsRead, 3);
  assert.equal(doc.source.rowsUsed, 3);
  assert.equal(doc.source.rowsIgnored, 0);
  assert.equal(doc.source.bounded, false);
  assert.deepEqual(doc.routes, [{ route: 'manual-menu-import/save', counts: { concept_saved: 3 } }]);
  assert.deepEqual(doc.ai, [
    { aiName: 'Claude', selfReported: true, counts: { concept_saved: 2 } },
    { aiName: 'ChatGPT', selfReported: true, counts: { concept_saved: 1 } },
  ]);
  assert.equal(doc.totals.conceptSaved, 3);
  assert.deepEqual(doc.period, {
    from: '2026-10-21T07:00:00.000Z',
    to: '2026-10-23T08:00:00.000Z',
    basis: 'importProvenance.importedAt',
    timestampsMissing: 0,
  });
  assert.deepEqual(doc.reviewOutcomes, {
    concepts: 3,
    correctedRows: 1,
    omittedRows: 1,
    confirmedRows: 1,
    bounded: false,
  });
  // Alleen metagegevens: geen gerechtnaam uit het concept.
  assert.equal(JSON.stringify(doc).includes('Geheim Gerecht'), false);
});

test('K2: niet-duurzame stappen zijn "niet bijgehouden" en nooit 0', () => {
  const doc = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT });
  assert.equal(doc.totals.promptCreated, NOT_TRACKED_LABEL);
  assert.equal(doc.totals.importChecked, NOT_TRACKED_LABEL);
  assert.equal(doc.totals.followUp, NOT_TRACKED_LABEL);
  assert.equal(doc.totals.rejected, NOT_TRACKED_LABEL);
  assert.equal(doc.totals.conceptSaved, 3);
  // Geen enkel niet-bijgehouden veld is een getal, en nergens staat een 0.
  for (const key of ['promptCreated', 'importChecked', 'followUp', 'rejected']) {
    assert.equal(typeof doc.totals[key], 'string');
    assert.notEqual(doc.totals[key], 0);
  }
  assert.equal(JSON.stringify(doc.totals).includes(':0'), false);
  assert.deepEqual(
    doc.notTracked.map((entry) => `${entry.route}|${entry.action}`).sort(),
    [
      'manual-menu-import/bundles|prompt_created',
      'manual-menu-import/follow-up|follow_up',
      'manual-menu-import/imports|import_checked',
      'manual-menu-import/imports|rejected',
      'manual-menu-import/save|rejected',
    ],
  );
  for (const entry of doc.notTracked) assert.ok(entry.reason.length > 10);
  assert.equal(doc.notTrackedNote.includes('nooit als 0'), true);
});

test('K2: kosten blijven "via abonnement, niet gemeten" zonder meting', () => {
  const doc = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT });
  assert.deepEqual(doc.costs, { status: 'not_measured', label: NOT_MEASURED_LABEL });
  assert.equal(doc.costs.amount, undefined);
  const zero = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT, cost: { amount: 0, currency: 'EUR' } });
  assert.deepEqual(zero.costs, { status: 'not_measured', label: NOT_MEASURED_LABEL });
  const measured = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT, cost: { amount: 1.5, currency: 'eur' } });
  assert.deepEqual(measured.costs, { status: 'measured', amount: 1.5, currency: 'EUR' });
  assert.deepEqual(validateUsageExport(measured), []);
});

test('K1: alleen concepten met de juiste herkomst tellen; dubbelen nooit', () => {
  const rows = [
    ...threeConcepts(),
    // Geen herkomst: een gewoon concept.
    conceptRow(6, null),
    // Andere herkomst: telt niet mee.
    conceptRow(7, { ...provenance(), kind: 'handmatige_invoer' }),
    // Zelfde rij tweemaal in het antwoord: één concept.
    conceptRow(3, provenance()),
    // Structuur kapot: telt als gelezen maar niet gebruikt.
    { id: 8, created_at: '2026-10-22T21:10:02.873Z', captured_content: { importProvenance: 'geen object' } },
  ];
  const doc = buildUsageExport({ rows, generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.source.rowsRead, 7);
  assert.equal(doc.source.rowsUsed, 3);
  assert.equal(doc.source.rowsIgnored, 4);
  assert.equal(doc.totals.conceptSaved, 3);
});

test('K3: een ontbrekend of onleesbaar importtijdstip wordt geteld, niet verzonnen', () => {
  const rows = [
    conceptRow(1, provenance({ aiName: 'Claude', importedAt: 'geen datum' })),
    conceptRow(2, provenance({ aiName: 'Claude', importedAt: null })),
  ];
  const doc = buildUsageExport({ rows, generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.deepEqual(doc.period, { from: null, to: null, basis: 'importProvenance.importedAt', timestampsMissing: 2 });
});

test('K1: een concept zonder AI-naam is "niet toegewezen" en blijft in het totaal', () => {
  const rows = [conceptRow(1, provenance({ aiName: 'Claude' })), conceptRow(2, provenance({ aiName: '   ' }))];
  const doc = buildUsageExport({ rows, generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.totals.conceptSaved, 2);
  assert.deepEqual(doc.ai, [{ aiName: 'Claude', selfReported: true, counts: { concept_saved: 1 } }]);
  assert.equal(doc.unattributed.concepts, 1);
});

test('K4: de AI-namenlijst is begrensd en wat niet past wordt benoemd', () => {
  const rows = Array.from({ length: MAX_AI_NAMES + 5 }, (_, index) =>
    conceptRow(index + 1, provenance({ aiName: `AI-${String(index + 1).padStart(2, '0')}` })),
  );
  const doc = buildUsageExport({ rows, generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.ai.length, MAX_AI_NAMES);
  assert.equal(doc.aiOmitted.names, 5);
  assert.equal(doc.aiOmitted.concepts, 5);
  assert.equal(doc.totals.conceptSaved, MAX_AI_NAMES + 5);
  assert.equal(
    doc.ai.reduce((sum, entry) => sum + entry.counts.concept_saved, 0) + doc.aiOmitted.concepts,
    doc.totals.conceptSaved,
  );
});

test('K4: een afgekapte leesactie is zichtbaar in het document', () => {
  const doc = buildUsageExport({ rows: threeConcepts(), limit: 3, generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.source.limit, 3);
  assert.equal(doc.source.rowsRead, 3);
  assert.equal(doc.source.bounded, true);
});

test('K4: de grens op bewaarde beslissingen volgt MAX_REASONS en is zichtbaar', () => {
  assert.equal(MAX_ROW_DECISIONS, MAX_REASONS);
  const full = Array.from({ length: MAX_ROW_DECISIONS }, () => ({ action: 'correct' }));
  const capped = buildUsageExport({ rows: [conceptRow(1, provenance({ rows: full }))], generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(capped), []);
  assert.equal(capped.reviewOutcomes.bounded, true);
  assert.equal(capped.reviewOutcomes.correctedRows, MAX_ROW_DECISIONS);
  const short = buildUsageExport({
    rows: [conceptRow(1, provenance({ rows: full.slice(0, MAX_ROW_DECISIONS - 1) }))],
    generatedAt: GENERATED_AT,
  });
  assert.equal(short.reviewOutcomes.bounded, false);
});

test('K4: een gemeten nul blijft nul, zonder verzonnen inhoud', () => {
  const doc = buildUsageExport({ rows: [], generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.totals.conceptSaved, 0);
  assert.deepEqual(doc.ai, []);
  assert.equal(doc.period.from, null);
  assert.equal(doc.totals.promptCreated, NOT_TRACKED_LABEL);
});

test('K4: het schema weigert een 0, een oude versie en vreemde velden', () => {
  const base = () => buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT });
  assert.deepEqual(validateUsageExport(base()), []);

  const withContent = { ...base(), menuItems: [{ name: 'Broodplank' }] };
  assert.ok(validateUsageExport(withContent).some((problem) => problem.includes('unknown field: menuItems')));

  const oldVersion = { ...base(), schemaVersion: 'manual-ai-import-usage/v1' };
  assert.ok(validateUsageExport(oldVersion).includes('schemaVersion is not supported'));

  // Een 0 voor een stap die niet duurzaam wordt bijgehouden is verboden.
  const zero = { ...base(), totals: { ...base().totals, promptCreated: 0 } };
  assert.ok(validateUsageExport(zero).includes('totals.promptCreated is a count but no route tracks it'));

  // De som moet kloppen; een opgehoogd totaal is zichtbaar onwaar.
  const inflated = { ...base(), totals: { ...base().totals, conceptSaved: 99 } };
  assert.ok(validateUsageExport(inflated).includes('totals.conceptSaved must equal the route sum'));

  // Een AI-naam zonder de zelfgerapporteerd-markering is niet toegestaan.
  const notSelfReported = base();
  notSelfReported.ai[0].selfReported = false;
  assert.ok(validateUsageExport(notSelfReported).includes('ai name must be marked self-reported'));

  // Kosten van 0 zijn geen meting.
  const zeroCost = { ...base(), costs: { status: 'measured', amount: 0, currency: 'EUR' } };
  assert.ok(validateUsageExport(zeroCost).includes('measured costs need a positive amount'));

  // Een niet-bijgehouden regel mag geen teller meesmokkelen.
  const notTrackedWithCount = base();
  notTrackedWithCount.notTracked[0].counts = 0;
  assert.ok(validateUsageExport(notTrackedWithCount).includes('notTracked entries must not carry counts'));

  // Een duurzame route mag niet als "niet bijgehouden" staan.
  const duplicated = base();
  duplicated.notTracked = [...duplicated.notTracked, { route: 'manual-menu-import/save', action: 'concept_saved', reason: 'x' }];
  assert.ok(validateUsageExport(duplicated).includes('a durably tracked action must not be listed as not tracked'));
});

test('K4: het document draagt geen prompts, sleutels of persoonsgegevens', () => {
  const doc = buildUsageExport({ rows: threeConcepts(), generatedAt: GENERATED_AT });
  const text = JSON.stringify(doc);
  for (const needle of ['Geheim Gerecht', 'sk-', 'service_role', 'Bearer ']) {
    assert.equal(text.includes(needle), false, needle);
  }
  assert.equal(doc.contents, 'alleen metagegevens');
  assert.equal(doc.selfReportedNote.includes('zelfgerapporteerd'), true);
});
