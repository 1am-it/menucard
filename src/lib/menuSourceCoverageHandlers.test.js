'use strict';

// X1-X5 of the Delivery Lead order 6382189724 (variant 1), at the route level:
// the free comparison travels in the existing sealed state, "Toevoegen" builds
// a dish through the existing validator and "Geen gerecht" stays accounted in
// a new handler instance and in the durable concept metadata. Fakes only: no
// network, no provider, no database, no key.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { buildImportBundle, sourceHashForText } = require('./manualMenuImportBundle');
const { buildImportReport } = require('./manualMenuImportImport');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createManualMenuImportHandlers } = require('./manualMenuImportHandlers');

const PROTOCOL = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..') });
const NOW = new Date('2026-10-24T12:00:00.000Z');
const TEST_SECRET = 'test-service-role-key-0123456789abcdef';
const RESTAURANTS = { '23': { name: 'Restaurant Voorbeeld', buurt: 'Centrum' } };

// Line 4 and line 7 print a price no dish covers; line 5 is rejected by the
// reading itself, so it counts as accounted and never appears.
const HTML_TEXT = [
  'LUNCH',
  'Bites',
  'Broodplank 8,50',
  'Fictief glas wijn 4,50',
  'Soep van de dag 6,50',
  'Koffie 2,80',
  'Steak 22,00',
].join('\n');

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
                evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Broodplank 8,50' },
              },
              {
                // No price in the reading: an open "Prijs onbekend" row.
                name: 'Koffie',
                priceStatus: 'unknown',
                evidence: { sourceId: 'source-1', locator: 'regel 6', quote: 'Koffie 2,80' },
              },
            ],
          },
        ],
      },
    ],
    rejected: [{ sourceId: 'source-1', locator: 'regel 5', reason: 'not_menu', text: 'Soep van de dag 6,50' }],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 2, unreadSources: [], limitations: [] },
  };
}

function request(body) {
  return { json: async () => body };
}

function harness(overrides = {}) {
  let counter = 0;
  const saved = [];
  const stateCipher = overrides.stateCipher || createManualImportStateCipher({ secret: TEST_SECRET, now: () => NOW });
  const create = () =>
    createManualMenuImportHandlers({
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
      stateCipher,
      restaurants: RESTAURANTS,
      readUsageRows: async () => ({ ok: true, rows: [], limit: 5000, bounded: false }),
      now: () => NOW,
    });
  return { next: create, saved, stateCipher };
}

async function chain(h, handlers = {}) {
  const step1 = await h.next().createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(step1.status, 201, JSON.stringify(step1.body));
  const answer = `Korte samenvatting.\n\`\`\`json\n${JSON.stringify(output())}\n\`\`\``;
  const step2 = await (handlers.importAnswer || h.next()).importAnswer(
    request({ state: step1.body.state, ai_name: 'Claude', answer }),
  );
  assert.equal(step2.status, 201, JSON.stringify(step2.body));
  return { step1: step1.body, step2: step2.body };
}

function lineByText(review, text) {
  return (review.uncovered.lines || []).find((line) => line.text === text) || null;
}

test('X1/X2: de vergelijking komt uit de capture in het verzegelde token, niet uit de browser', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const uncovered = step2.review.uncovered;
  assert.equal(uncovered.available, true);
  assert.equal(uncovered.version, 'menu-source-coverage/v1');
  assert.equal(uncovered.total, 2);
  assert.deepEqual(
    uncovered.lines.map((line) => [line.id, line.text, line.section]),
    [
      ['source-1:4', 'Fictief glas wijn 4,50', 'Bites'],
      ['source-1:7', 'Steak 22,00', 'Bites'],
    ],
  );
  // The rejected line stays accounted and never appears again.
  assert.equal(lineByText(step2.review, 'Soep van de dag 6,50'), null);
  // The screen never receives the whole capture, only the lines it shows.
  assert.equal(JSON.stringify(step2.review).includes('LUNCH'), false);
  assert.equal(JSON.stringify(step2.review).includes('Soep van de dag 6,50'), false);
});

test('X2: zonder brontekst zegt de route eerlijk dat er niets te vergelijken is', async () => {
  const h = harness();
  const bundle = buildImportBundle({
    bundleId: 'bundle-zonder-tekst',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: RESTAURANTS['23'].name,
    fetchedAt: NOW.toISOString(),
    sources: [{ id: 'source-1', url: 'https://voorbeeld.example/menukaart', kind: 'html', status: 'read', text: HTML_TEXT }],
    protocol: PROTOCOL,
    now: NOW,
  });
  const report = buildImportReport({ importId: 'import-zonder-tekst', bundle, output: output(), aiName: 'Claude', now: NOW });
  assert.equal(report.ok, true, JSON.stringify(report));
  // The same sealed step, but the stored capture carries no text: a concept
  // whose source text is gone. Nothing is invented and nothing is shown.
  const withoutText = {
    ...bundle,
    sources: bundle.sources.map((source) => ({ ...source, text: '', hasText: false })),
  };
  const sealed = h.stateCipher.seal({
    userId: 'user-1',
    restaurantId: '23',
    bundle: withoutText,
    report,
    decisions: [],
    followUps: {},
    followUpTotal: 0,
  });
  const coffee = report.rows.find((row) => row.code === 'price_unknown');
  assert.ok(coffee);
  const result = await h.next().decide(
    request({ state: sealed.token, decision: { rowId: coffee.id, action: 'price_unknown' } }),
    report.importId,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.review.uncovered.available, false);
  assert.equal(result.body.review.uncovered.reason, 'capture_unavailable');
  assert.equal(result.body.review.uncovered.message, 'Vergelijking niet beschikbaar voor dit concept');
  assert.deepEqual(result.body.review.uncovered.lines, []);
});


test('X3: "Geen gerecht" blijft weg in een nieuwe instantie en staat in de conceptmetadata', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const line = lineByText(step2.review, 'Fictief glas wijn 4,50');
  assert.ok(line);
  const dismissed = await h.next().decide(
    request({ state: step2.state, decision: { action: 'uncovered_not_dish', lineId: line.id } }),
    step2.import.importId,
  );
  assert.equal(dismissed.status, 200, JSON.stringify(dismissed.body));
  assert.equal(dismissed.body.review.uncovered.total, 1);
  assert.equal(lineByText(dismissed.body.review, 'Fictief glas wijn 4,50'), null);

  // A new handler instance knows nothing except the sealed token: the line
  // must stay away, so the decision is durable in the step itself.
  const coffee = dismissed.body.review.rows.find((row) => row.code === 'price_unknown');
  const afterCoffee = await h.next().decide(
    request({ state: dismissed.body.state, decision: { rowId: coffee.id, action: 'price_unknown' } }),
    step2.import.importId,
  );
  assert.equal(afterCoffee.status, 200, JSON.stringify(afterCoffee.body));
  assert.equal(afterCoffee.body.review.uncovered.total, 1);
  assert.equal(lineByText(afterCoffee.body.review, 'Fictief glas wijn 4,50'), null);
  assert.equal(afterCoffee.body.review.canSave, true);

  const saved = await h.next().save(request({ state: afterCoffee.body.state }), step2.import.importId);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const provenance = h.saved[0].content.importProvenance;
  assert.deepEqual(
    provenance.uncovered.map((entry) => [entry.action, entry.sourceId, entry.lineNumber, entry.text]),
    [['uncovered_not_dish', 'source-1', 4, 'Fictief glas wijn 4,50']],
  );
  // The existing explanations stay unchanged next to the new list.
  assert.ok(Array.isArray(provenance.rows));
  assert.equal(h.saved[0].content.categories[0].items.some((item) => item.name === 'Fictief glas wijn'), false);
});


test('X3: "Toevoegen" maakt een gerecht door dezelfde validator en blijft bij het concept', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const line = lineByText(step2.review, 'Steak 22,00');
  assert.ok(line);
  const added = await h.next().decide(
    request({ state: step2.state, decision: { action: 'add_uncovered', lineId: line.id } }),
    step2.import.importId,
  );
  assert.equal(added.status, 200, JSON.stringify(added.body));
  // The screen gets the changed concept itself, not only the review.
  assert.ok(added.body.import);
  assert.equal(added.body.import.summary.items, 3);
  const row = added.body.review.rows.find((entry) => entry.name === 'Steak');
  assert.ok(row, JSON.stringify(added.body.review.rows.map((entry) => entry.name)));
  assert.equal(row.priceText, '€ 22,00');
  assert.equal(row.quote, 'Steak 22,00');
  // The guessed section is visibly uncertain, so it shows up in nalopen and
  // the human can correct name and section there.
  assert.equal(row.state, 'unverifiable');
  assert.equal(row.code, 'category_uncertain');
  assert.equal(row.outcome, null);
  assert.equal(lineByText(added.body.review, 'Steak 22,00'), null);

  // Correct the section through the existing "Wijzig" decision.
  const corrected = await h.next().decide(
    request({
      state: added.body.state,
      decision: { rowId: row.id, action: 'correct', corrected: { name: 'Steak', path: ['Bites'] } },
    }),
    step2.import.importId,
  );
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  const coffee = corrected.body.review.rows.find((entry) => entry.code === 'price_unknown');
  const afterCoffee = await h.next().decide(
    request({ state: corrected.body.state, decision: { rowId: coffee.id, action: 'price_unknown' } }),
    step2.import.importId,
  );
  assert.equal(afterCoffee.status, 200, JSON.stringify(afterCoffee.body));
  assert.equal(afterCoffee.body.review.canSave, true);

  const saved = await h.next().save(request({ state: afterCoffee.body.state }), step2.import.importId);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const content = h.saved[0].content;
  const steak = content.categories[0].items.find((item) => item.name === 'Steak');
  assert.ok(steak, JSON.stringify(content.categories[0].items.map((item) => item.name)));
  assert.equal(steak.price, '22.00');
  assert.deepEqual(steak.evidence, {
    sourceId: 'source-1',
    locator: 'regel 7',
    quote: 'Steak 22,00',
    sourceUrl: 'https://voorbeeld.example/menukaart',
  });
  assert.deepEqual(
    content.importProvenance.uncovered.map((entry) => [entry.action, entry.lineNumber, entry.addedRowId]),
    [['add_uncovered', 7, row.id]],
  );
});


test('X3/X5: een regel die niet meer openstaat wordt geweigerd en tekst van de client telt nooit', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const unknown = await h.next().decide(
    request({ state: step2.state, decision: { action: 'add_uncovered', lineId: 'source-1:999' } }),
    step2.import.importId,
  );
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.reason, 'unknown_line');
  // A client cannot inject its own line text or price: only the id is read.
  const injected = await h.next().decide(
    request({
      state: step2.state,
      decision: { action: 'add_uncovered', lineId: 'source-1:4', text: 'Verzonnen gerecht 99,00' },
    }),
    step2.import.importId,
  );
  assert.equal(injected.status, 200, JSON.stringify(injected.body));
  assert.equal(injected.body.review.rows.some((entry) => entry.name.includes('Verzonnen')), false);
  assert.ok(injected.body.review.rows.some((entry) => entry.name === 'Fictief glas wijn'));
  // No bulk payload, and an unknown action stays a blocked decision.
  const bulk = await h.next().decide(
    request({ state: step2.state, decision: { action: 'add_uncovered', lineId: 'source-1:7', acceptAll: true } }),
    step2.import.importId,
  );
  assert.equal(bulk.status, 422);
  assert.equal(bulk.body.reason, 'accept_all_forbidden');
});

test('X5: de motor en de review doen geen netwerk-, provider- of sleutelaanroep', () => {
  for (const file of ['menuSourceCoverage.js', 'manualMenuImportReview.js']) {
    const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const forbidden of ['fetch(', 'node:http', 'node:https', '@anthropic-ai/sdk', 'ANTHROPIC_API_KEY', 'process.env']) {
      assert.equal(code.includes(forbidden), false, `${file} contains ${forbidden}`);
    }
  }
});

