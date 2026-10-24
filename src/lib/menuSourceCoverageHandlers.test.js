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
  const sourceText = typeof overrides.text === 'string' ? overrides.text : HTML_TEXT;
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
          text: sourceText,
          sha256: sourceHashForText(sourceText),
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

async function chain(h, handlers = {}, answerOutput = null) {
  const step1 = await h.next().createBundle(request({ restaurant_id: '23', urls: ['https://voorbeeld.example/menukaart'] }));
  assert.equal(step1.status, 201, JSON.stringify(step1.body));
  const answer = `Korte samenvatting.\n\`\`\`json\n${JSON.stringify(answerOutput || output())}\n\`\`\``;
  const step2 = await (handlers.importAnswer || h.next()).importAnswer(
    request({ state: step1.body.state, ai_name: 'Claude', answer }),
  );
  assert.equal(step2.status, 201, JSON.stringify(step2.body));
  return { step1: step1.body, step2: step2.body };
}

function lineByText(review, text) {
  return (review.uncovered.lines || []).find((line) => line.text === text) || null;
}

// Z5/Z1 (Lead order 6382953597): a diner card that prints the name and the
// price on their own lines. The first dish is in orde, the second prints € 24,50
// while the concept says € 22,00, so that line is the red mark.
const PAIR_TEXT = ['DINER', 'Voorgerechten', 'Broodplank 8,50', 'Steak', '24,50'].join('\n');

function pairOutput() {
  return {
    menus: [
      {
        title: 'Diner',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Voorgerechten',
            items: [
              {
                name: 'Broodplank',
                priceStatus: 'known',
                amountMinorUnits: 850,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Broodplank 8,50' },
              },
              {
                name: 'Steak',
                priceStatus: 'known',
                amountMinorUnits: 2200,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'regels 4–5', quote: 'Steak 24,50' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 2, unreadSources: [], limitations: [] },
  };
}

test('Z2: de review bevat de compacte kaartindex met de vier markeringen, zonder brontekst', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const map = step2.review.sourceMap;
  assert.equal(map.available, true);
  assert.deepEqual(map.legend.map((entry) => entry.label), ['Overgenomen', 'Niet overgenomen', 'Prijs wijkt af', 'Geen gerecht']);
  assert.equal(map.sources.length, 1);
  assert.equal(map.sources[0].view.mode, 'website_text');
  assert.deepEqual(
    map.marks.map((mark) => [mark.sourceId, mark.lineNumber, mark.tone]),
    [
      ['source-1', 3, 'covered'],
      ['source-1', 4, 'uncovered'],
      ['source-1', 5, 'not_dish'],
      ['source-1', 6, 'covered'],
      ['source-1', 7, 'uncovered'],
    ],
  );
  // The review keeps carrying no captured text: the card page is a later,
  // separate request. Only the section label of a mark travels along.
  const body = JSON.stringify(map);
  for (const line of ['Broodplank 8,50', 'Fictief glas wijn 4,50', 'Soep van de dag 6,50', 'Koffie 2,80', 'Steak 22,00']) {
    assert.equal(body.includes(line), false, line);
  }
  assert.equal(body.includes('LUNCH'), false);
});

test('Z3: één kaartpagina komt lui uit de capture in het verzegelde token', async () => {
  const h = harness();
  const { step2 } = await chain(h);
  const page = await h.next().sourceCard(request({ state: step2.state, source_id: 'source-1', page: 1 }));
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.card.available, true);
  assert.equal(page.body.card.page.number, 1);
  assert.equal(page.body.card.page.total, 1);
  assert.deepEqual(
    page.body.card.page.lines.map((line) => [line.number, line.text, line.tone, line.marker]),
    [
      [1, 'LUNCH', null, false],
      [2, 'Bites', null, false],
      [3, 'Broodplank 8,50', 'covered', true],
      [4, 'Fictief glas wijn 4,50', 'uncovered', true],
      [5, 'Soep van de dag 6,50', 'not_dish', true],
      [6, 'Koffie 2,80', 'covered', true],
      [7, 'Steak 22,00', 'uncovered', true],
    ],
  );
  // The page reads nothing it was not given: an unknown source, another page
  // and a request without a state are all refused with a concrete reason.
  const unknown = await h.next().sourceCard(request({ state: step2.state, source_id: 'source-9' }));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.reason, 'unknown_source');
  const otherPage = await h.next().sourceCard(request({ state: step2.state, source_id: 'source-1', page: 2 }));
  assert.equal(otherPage.status, 422);
  assert.equal(otherPage.body.reason, 'page_out_of_range');
  const noState = await h.next().sourceCard(request({ source_id: 'source-1' }));
  assert.equal(noState.status, 400);
  assert.equal(noState.body.reason, 'state_required');
  const badPage = await h.next().sourceCard(request({ state: step2.state, source_id: 'source-1', page: 'veel' }));
  assert.equal(badPage.status, 422);
  assert.equal(badPage.body.reason, 'page_invalid');
});

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

test('Z4: "Neem € x over" neemt de prijs van de server, blijft duurzaam en staat in de conceptmetadata', async () => {
  const h = harness({ text: PAIR_TEXT });
  const { step2 } = await chain(h, {}, pairOutput());
  const map = step2.review.sourceMap;
  const red = map.marks.find((mark) => mark.tone === 'price_mismatch');
  assert.ok(red, JSON.stringify(map.marks));
  assert.equal(red.rowId, '0.0.1');
  assert.equal(red.priceText, '24,50');
  assert.equal(red.conceptPriceText, '€ 22,00');
  assert.equal(red.locator, 'regels 4–5');
  // A client can neither pick another line nor send its own price.
  const wrongLine = await h.next().decide(
    request({ state: step2.state, decision: { action: 'take_source_price', lineId: 'source-1:3', rowId: '0.0.1', amountMinorUnits: 1 } }),
    step2.import.importId,
  );
  assert.equal(wrongLine.status, 422);
  assert.equal(wrongLine.body.reason, 'no_price_mismatch');
  const wrongRow = await h.next().decide(
    request({ state: step2.state, decision: { action: 'take_source_price', lineId: red.id, rowId: '0.0.0' } }),
    step2.import.importId,
  );
  assert.equal(wrongRow.status, 422);
  assert.equal(wrongRow.body.reason, 'unknown_row');
  const taken = await h.next().decide(
    request({ state: step2.state, decision: { action: 'take_source_price', lineId: red.id, rowId: red.rowId } }),
    step2.import.importId,
  );
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  const afterMark = taken.body.review.sourceMap.marks.find((mark) => mark.id === red.id);
  assert.equal(afterMark.priceTaken, true);
  assert.equal(afterMark.takenPriceText, '€ 24,50');
  assert.match(afterMark.ariaLabel, /prijs overgenomen: € 24,50/);
  assert.equal(taken.body.review.rows.find((row) => row.id === red.rowId).outcome, 'keep_corrected');
  // The same choice is still there in a new handler instance (sealed state).
  const fresh = await h.next().sourceCard(request({ state: taken.body.state, source_id: 'source-1', page: 1 }));
  assert.equal(fresh.body.card.marks.find((mark) => mark.id === red.id).priceTaken, true);
  const saved = await h.next().save(request({ state: taken.body.state }), step2.import.importId);
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const item = h.saved[0].content.categories[0].items.find((entry) => entry.name === 'Steak');
  assert.equal(item.price, '24.50');
  // The evidence quote is never rewritten; the source line of the price is kept
  // next to the concept instead.
  assert.equal(item.evidence.sourceId, 'source-1');
  assert.equal(item.evidence.locator, 'regels 4–5');
  assert.equal(item.evidence.quote, 'Steak 24,50');
  const provenance = h.saved[0].content.importProvenance;
  assert.deepEqual(provenance.priceFromSource, [
    {
      rowId: '0.0.1',
      sourceId: 'source-1',
      lineNumber: 5,
      nameLineNumber: 4,
      text: 'Steak 24,50',
      amountMinorUnits: 2450,
      previousAmountMinorUnits: 2200,
      action: 'correct',
    },
  ]);
});

test('Z4: een afwijkende prijs bij twee geprinte prijzen vraagt een eigen keuze', async () => {
  // The card prints 4,50 and 24,00; the concept holds 5,50 and 26,00. The mark is
  // red, but no printed variant equals the printed line, so the app never picks
  // one for the human: the existing "Wijzig" step does that.
  const text = ['DINER', 'Wijn', 'Fictieve wijn 4,50 24,00'].join('\n');
  const out = {
    menus: [
      {
        title: 'Diner',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Wijn',
            items: [
              {
                name: 'Fictieve wijn',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [
                  { label: null, amountMinorUnits: 550, currency: 'EUR' },
                  { label: null, amountMinorUnits: 2600, currency: 'EUR' },
                ],
                evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Fictieve wijn 4,50 24,00' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const h = harness({ text });
  const { step2 } = await chain(h, {}, out);
  const red = step2.review.sourceMap.marks.find((mark) => mark.tone === 'price_mismatch');
  assert.ok(red, JSON.stringify(step2.review.sourceMap.marks));
  const taken = await h.next().decide(
    request({ state: step2.state, decision: { action: 'take_source_price', lineId: red.id, rowId: red.rowId } }),
    step2.import.importId,
  );
  assert.equal(taken.status, 422);
  assert.equal(taken.body.reason, 'price_choice_required');
});

test('X5: de motor en de review doen geen netwerk-, provider- of sleutelaanroep', () => {
  for (const file of ['menuSourceCoverage.js', 'menuSourceMap.js', 'manualMenuImportReview.js']) {
    const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const forbidden of ['fetch(', 'node:http', 'node:https', '@anthropic-ai/sdk', 'ANTHROPIC_API_KEY', 'process.env']) {
      assert.equal(code.includes(forbidden), false, `${file} contains ${forbidden}`);
    }
  }
});

