'use strict';

// #59 fase 2 — regressies op de serverhandlers van de handmatige AI-import
// (K2, K3, K5, K7 en de rolregel). Fakes voor auth, bronlezing en opslag;
// geen netwerk, geen database en geen provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { ManualImportBundleStore, sourceHashForText } = require('./manualMenuImportBundle');
const { ManualImportStore } = require('./manualMenuImportReview');
const {
  ManualImportUsageLedger,
  buildUsageExport,
  validateUsageExport,
  NOT_MEASURED_LABEL,
} = require('./manualMenuImportUsage');
const { createManualMenuImportHandlers } = require('./manualMenuImportHandlers');

const PROTOCOL = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..') });
const NOW = new Date('2026-10-22T12:00:00.000Z');

const HTML_TEXT = ['LUNCH', 'Bites', 'Broodplank 8,50', 'Truffelsupplement 3,00'].join('\n');

function request(body) {
  return { json: async () => body };
}

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
                name: 'Broodplank',
                priceStatus: 'known',
                amountMinorUnits: 850,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 1', quote: 'Broodplank 8,50' },
              },
              {
                name: 'Truffelsupplement',
                priceStatus: 'known',
                amountMinorUnits: 300,
                currency: 'EUR',
                supplementOf: 'Broodplank',
                evidence: { sourceId: 'source-1', locator: 'Bites · toeslag', quote: 'Truffelsupplement 3,00' },
              },
              {
                name: 'Koffie',
                priceStatus: 'known',
                amountMinorUnits: 280,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 9', quote: 'Koffie 2,80' },
              },
            ],
          },
        ],
      },
    ],
    coverage: {
      status: 'complete',
      sourcesRead: 1,
      pagesRead: 1,
      itemsExtracted: 3,
      unreadSources: [],
      limitations: [],
    },
  };
}

function deps(overrides = {}) {
  let counter = 0;
  const saved = [];
  const bundleStore = new ManualImportBundleStore({ now: () => NOW });
  const importStore = new ManualImportStore({ now: () => NOW });
  const usageLedger = new ManualImportUsageLedger({ now: () => NOW });
  const base = {
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal' }] }),
    readSources: async ({ urls }) =>
      urls.map((url, index) => ({
        id: `source-${index + 1}`,
        url,
        kind: 'html',
        status: 'read',
        text: HTML_TEXT,
        sha256: sourceHashForText(HTML_TEXT),
      })),
    loadProtocol: () => PROTOCOL,
    generateId: () => `id-${++counter}`,
    saveConcept: async (input) => {
      saved.push(input);
      return { status: 201, body: { concept: { id: 'concept-1', version: 1, unchanged: false } } };
    },
    bundleStore,
    importStore,
    usageLedger,
    now: () => NOW,
  };
  const merged = { ...base, ...overrides };
  const handlers = createManualMenuImportHandlers(merged);
  return { handlers, saved, bundleStore, importStore, usageLedger };
}

async function createBundle(handlers) {
  const result = await handlers.createBundle(
    request({ restaurant_id: '23', restaurant_name: 'Restaurant Voorbeeld', urls: ['https://voorbeeld.example/menukaart'] }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function importAnswer(handlers, bundle) {
  const result = await handlers.importAnswer(
    request({
      bundle_id: bundle.bundle.bundleId,
      bundle_hash: bundle.bundle.bundleHash,
      ai_name: 'Claude',
      answer: `Korte samenvatting.\n\`\`\`json\n${JSON.stringify(output())}\n\`\`\``,
    }),
  );
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.import;
}

test('K2/K3/K5/K7: prompt, import, menselijke controle en opslag in één keten', async () => {
  const { handlers, saved, usageLedger } = deps();
  const bundle = await createBundle(handlers);
  assert.match(bundle.prompt.text, /korte, leesbare samenvatting/i);
  assert.equal(JSON.stringify(bundle.bundle).includes('Broodplank 8,50'), false);
  const report = await importAnswer(handlers, bundle);
  assert.equal(report.summary.items, 3);
  assert.equal(report.summary.valid, 1);
  assert.equal(report.summary.needsReview, 2);
  // Nooit JSON naar het scherm: de gevalideerde uitvoer zit niet in de respons.
  assert.equal('validated' in report, false);
  assert.equal('output' in report, false);

  const supplement = report.rows.find((row) => row.code === 'supplement_as_main_price');
  const missing = report.rows.find((row) => row.code === 'quote_not_in_source');
  const decide = (decision) => handlers.decide(request({ decision }), report.importId);
  assert.equal((await decide({ rowId: supplement.id, action: 'confirm' })).status, 200);
  assert.equal((await decide({ rowId: missing.id, action: 'confirm' })).status, 422);
  const withReason = await decide({ rowId: missing.id, action: 'confirm', reasonCode: 'scan_onleesbaar', note: 'Op de papieren kaart gezien.' });
  assert.equal(withReason.status, 200, JSON.stringify(withReason.body));
  assert.equal(withReason.body.review.canSave, true);

  const savedResult = await handlers.save(request({}), report.importId);
  assert.equal(savedResult.status, 201, JSON.stringify(savedResult.body));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sourceType, 'manual');
  assert.equal(saved[0].qualityScore, 'medium');
  assert.equal(saved[0].content.importProvenance.aiName, 'Claude');
  assert.equal(saved[0].content.categories[0].items.some((item) => item.name === 'Truffelsupplement'), false);

  const usage = await handlers.usage(request({}));
  assert.equal(usage.status, 200);
  assert.deepEqual(validateUsageExport(usage.body.usage), []);
  assert.equal(usage.body.usage.costs.status, 'not_measured');
  assert.equal(usage.body.usage.costs.label, NOT_MEASURED_LABEL);
  assert.equal(usage.body.usage.totals.promptCreated, 1);
  assert.equal(usage.body.usage.totals.importChecked, 1);
  assert.equal(usage.body.usage.totals.conceptSaved, 1);
  assert.equal(JSON.stringify(usage.body.usage).includes('Broodplank'), false);
  assert.equal(usageLedger.totals().prompt_created, 1);
});

test('K5: opslaan zonder menselijke stappen wordt geweigerd en schrijft niets', async () => {
  const { handlers, saved } = deps();
  const bundle = await createBundle(handlers);
  const report = await importAnswer(handlers, bundle);
  const result = await handlers.save(request({}), report.importId);
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'blocked');
  assert.equal(saved.length, 0);
});

test('K3: een verlopen of gewijzigde bundel is een blokkade', async () => {
  const { handlers, bundleStore } = deps();
  const bundle = await createBundle(handlers);
  const wrongHash = await handlers.importAnswer(
    request({ bundle_id: bundle.bundle.bundleId, bundle_hash: 'e'.repeat(64), ai_name: 'Claude', answer: '```json\n{}\n```' }),
  );
  assert.equal(wrongHash.status, 409);
  assert.equal(wrongHash.body.reason, 'bundle_hash_mismatch');
  bundleStore.bundles.get(bundle.bundle.bundleId).expiresAt = '2026-10-22T11:00:00.000Z';
  const expired = await handlers.importAnswer(
    request({ bundle_id: bundle.bundle.bundleId, bundle_hash: bundle.bundle.bundleHash, ai_name: 'Claude', answer: '```json\n{}\n```' }),
  );
  assert.equal(expired.status, 409);
  assert.equal(expired.body.reason, 'bundle_expired');
});

test('K3: een import van een collega is niet op te slaan', async () => {
  const first = deps();
  const bundle = await createBundle(first.handlers);
  const report = await importAnswer(first.handlers, bundle);
  const second = createManualMenuImportHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-2', roles: [{ role: 'internal' }] }),
    readSources: async () => [],
    loadProtocol: () => PROTOCOL,
    generateId: () => 'other',
    saveConcept: async () => ({ status: 201, body: {} }),
    bundleStore: first.bundleStore,
    importStore: first.importStore,
    usageLedger: first.usageLedger,
    now: () => NOW,
  });
  const result = await second.save(request({}), report.importId);
  assert.equal(result.status, 404);
});

test('rolregel: een niet-interne gebruiker krijgt 403 en er wordt niets opgeslagen', async () => {
  const { handlers, saved } = deps({
    authenticate: async () => ({ ok: true, userId: 'user-3', roles: [{ role: 'owner', restaurant_id: '23' }] }),
  });
  const result = await handlers.createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menu'] }));
  assert.equal(result.status, 403);
  assert.equal(saved.length, 0);
});


test('K6: de vervolgprompt gaat over één regel en het antwoord vervangt alleen die regel', async () => {
  const { handlers } = deps();
  const bundle = await createBundle(handlers);
  const report = await importAnswer(handlers, bundle);
  const row = report.rows.find((entry) => entry.code === 'quote_not_in_source');
  const promptResult = await handlers.followUp(request({ row_id: row.id }), report.importId);
  assert.equal(promptResult.status, 200);
  assert.match(promptResult.body.prompt.text, /Vervolgvraag over één regel/);
  assert.match(promptResult.body.prompt.text, /Broodplank 8,50/);

  const oneRow = {
    menus: [
      {
        title: 'Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              {
                name: 'Koffie',
                priceStatus: 'on_request',
                evidence: { sourceId: 'source-1', locator: 'Bites · regel 1', quote: 'Broodplank 8,50' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const answered = await handlers.followUp(
    request({ row_id: row.id, answer: `Kort.\n\`\`\`json\n${JSON.stringify(oneRow)}\n\`\`\`` }),
    report.importId,
  );
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const after = answered.body.import.rows.find((entry) => entry.id === row.id);
  assert.equal(after.state, 'valid');
  const repeated = await handlers.followUp(request({ row_id: row.id }), report.importId);
  assert.equal(repeated.status, 422);
  assert.equal(repeated.body.reason, 'follow_up_used');
});

test('K6: een vervolgantwoord dat andere regels raakt wordt geweigerd', async () => {
  const { handlers } = deps();
  const bundle = await createBundle(handlers);
  const report = await importAnswer(handlers, bundle);
  const row = report.rows.find((entry) => entry.code === 'quote_not_in_source');
  const result = await handlers.followUp(
    request({ row_id: row.id, answer: `\`\`\`json\n${JSON.stringify(output())}\n\`\`\`` }),
    report.importId,
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'follow_up_out_of_scope');
});

test('K7: de gebruiksexport is begrensd, zonder inhoud en zonder gemeten kosten', async () => {
  const ledger = new ManualImportUsageLedger({ now: () => NOW });
  ledger.record({ route: 'manual-menu-import/bundles', action: 'prompt_created', aiName: 'ChatGPT' });
  ledger.record({ route: 'manual-menu-import/imports', action: 'import_checked', aiName: 'ChatGPT' });
  ledger.record({ route: 'onbekend/pad', action: 'prompt_created', aiName: 'x' });
  ledger.record({ route: 'manual-menu-import/bundles', action: 'onbekend', aiName: 'x' });
  const doc = buildUsageExport({ ledger, generatedAt: NOW });
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.totals.promptCreated, 1);
  assert.deepEqual(doc.ai, [
    { aiName: 'ChatGPT', selfReported: true, counts: { prompt_created: 1, import_checked: 1, follow_up: 0, concept_saved: 0, rejected: 0 } },
  ]);
  const measured = buildUsageExport({ ledger, generatedAt: NOW, cost: { amount: 1.5, currency: 'eur' } });
  assert.equal(measured.costs.status, 'measured');
  assert.equal(measured.costs.amount, 1.5);
  const zero = buildUsageExport({ ledger, generatedAt: NOW, cost: { amount: 0, currency: 'EUR' } });
  assert.equal(zero.costs.status, 'not_measured');
  assert.equal(JSON.stringify(doc).includes('meta van de bron'), false);
});

