'use strict';

// W2/W3/W4/W5/W8 of the Delivery Lead order for #59 / BE-21
// (review 6380804419): the "Lees met AI" server call, proven with a faked
// transport layer. No key, no provider, no network, no database:
//   - a valid answer writes one durable concept and hands over the state token;
//   - a schema error, a timeout, an exhausted budget, a missing key/flag and an
//     invalid source are each their own readable refusal;
//   - the route never accepts a URL from the client;
//   - named price variants and "Prijs onbekend" survive into the concept.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMenuAiReadHandlers } = require('./menuAiReadHandlers');
const { AI_MAX_COST_EUR_CENTS, AI_MONTH_LIMIT_EUR_CENTS, AI_READ_PROVENANCE_KIND, monthlySpendFromRows } = require('./menuAiImport');
const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { buildImportBundle, sourceHashForText } = require('./manualMenuImportBundle');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createAnthropicStructuredCall } = require('./menuExtractionAnthropicCall');
const { createStructuredExtractionAdapter } = require('./menuExtractionAdapter');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });
const SECRET = 'fixture-secret-value-for-tests-only';
const FIXTURE_KEY = 'fixture-anthropic-key-not-a-secret';

const SOURCE_TEXT = [
  'Wijnkaart',
  'Huiswijn glas 5,00 / karaf 18,50',
  'Kraanwater',
].join('\n');

function requestOf(body, { text } = {}) {
  const payload = text === undefined ? (body === undefined ? '' : JSON.stringify(body)) : text;
  return { text: async () => payload, headers: { get: () => 'Bearer fixture' } };
}

function validAnswer() {
  return {
    menus: [
      {
        title: 'Wijnkaart',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Dranken',
            items: [
              {
                name: 'Huiswijn',
                priceStatus: 'multiple_undecomposed',
                priceVariants: [
                  { label: 'glas', amountMinorUnits: 500, currency: 'EUR' },
                  { label: 'karaf', amountMinorUnits: 1850, currency: 'EUR' },
                ],
                evidence: { sourceId: 'source-1', locator: 'regel 2', quote: 'Huiswijn glas 5,00 / karaf 18,50' },
              },
              {
                name: 'Kraanwater',
                priceStatus: 'unknown',
                evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Kraanwater' },
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 2, unreadSources: [], limitations: [] },
  };
}

function responseOf(output, options = {}) {
  const usage = Object.prototype.hasOwnProperty.call(options, 'usage') ? options.usage : { input_tokens: 2000, output_tokens: 800 };
  return {
    id: 'msg_fixture',
    model: 'claude-haiku-5-5',
    stop_reason: options.stop || 'end_turn',
    usage,
    content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) }],
  };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    messages: {
      create: () => {
        throw new Error('the call must stream');
      },
      stream: (body, options) => {
        calls.push({ body, options });
        const final = Promise.resolve().then(() => handler(body, options));
        const stream = {
          request_id: 'req_fixture',
          on: () => stream,
          abort: () => {},
          finalMessage: () => final,
        };
        return stream;
      },
    },
  };
}

function bundle() {
  return buildImportBundle({
    bundleId: 'AI-2026-10-24-ROUTE',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Restaurant Voorbeeld',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources: [
      {
        id: 'source-1',
        url: 'https://voorbeeld.example/wijnkaart',
        kind: 'html',
        status: 'read',
        text: SOURCE_TEXT,
        sha256: sourceHashForText(SOURCE_TEXT),
      },
    ],
  });
}

/** A sealed state token exactly as the manual-import step 1 seals it. */
function sealedStateCipher() {
  const cipher = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  const sealed = cipher.seal({
    userId: 'user-1',
    restaurantId: '23',
    bundle: bundle(),
    report: null,
    decisions: [],
    followUps: {},
    followUpTotal: 0,
  });
  return { cipher, token: sealed.token };
}


function harness({ client = fakeClient(() => responseOf(validAnswer())), env, rows = [], sources, save = null, authenticate, restaurantExists } = {}) {
  const saved = [];
  const sealed = sealedStateCipher();
  const handlers = createMenuAiReadHandlers({
    authenticate: authenticate || (async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] })),
    env: () => env || { ANTHROPIC_API_KEY: FIXTURE_KEY, MENU_AI_FALLBACK_ENABLED: 'true' },
    now: () => new Date('2026-10-24T12:05:00.000Z'),
    readUsageRows: async () => ({ ok: true, rows }),
    readSources:
      sources ||
      (async () => [
        {
          id: 'source-1',
          url: 'https://voorbeeld.example/wijnkaart',
          kind: 'html',
          status: 'read',
          text: SOURCE_TEXT,
          hasText: true,
          sha256: sourceHashForText(SOURCE_TEXT),
        },
      ]),
    resolveJob: async ({ jobId }) => (jobId === 'job-1' ? { ok: true, urls: ['https://voorbeeld.example/wijnkaart'], restaurantId: '23' } : { ok: false }),
    restaurantExists: restaurantExists || ((id) => id === '23'),
    loadProtocol: () => PROTOCOL,
    openState: (token) => sealed.cipher.open(token),
    sealState: (state) => sealed.cipher.seal(state),
    saveConcept:
      save ||
      (async (input) => {
        saved.push(input);
        return { status: 201, body: { concept: { id: 'concept-1', version: 1, unchanged: false } } };
      }),
    createCall: ({ budget }) => createAnthropicStructuredCall({ env: { ANTHROPIC_API_KEY: FIXTURE_KEY }, client, budget }),
    generateId: () => 'import-ai-1',
  });
  return { handlers, saved, sealed, client };
}

function tokenOf() {
  return sealedStateCipher().token;
}

test('W3: zonder sleutel of vlag is er geen knop en geen aanroep', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client, env: {} });
  const status = await h.handlers.status(requestOf(undefined));
  assert.equal(status.status, 200);
  assert.equal(status.body.enabled, false);
  assert.equal(status.body.reason, 'ai_not_configured');
  assert.equal(status.body.message, 'AI is niet ingesteld.');
  assert.equal(JSON.stringify(status.body).includes(FIXTURE_KEY), false);

  const read = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(read.status, 503);
  assert.equal(read.body.reason, 'ai_not_configured');
  assert.equal(client.calls.length, 0);
  assert.equal(h.saved.length, 0);
});

test('W3: alleen de vlag zonder sleutel is ook niet genoeg', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client, env: { MENU_AI_FALLBACK_ENABLED: 'true' } });
  const read = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(read.status, 503);
  assert.equal(read.body.enabled, false);
  assert.equal(client.calls.length, 0);
});

test('W2: een willekeurige URL uit de client is geen bron', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client });
  const read = await h.handlers.read(requestOf({ url: 'https://kwaad.example/menu' }));
  assert.equal(read.status, 422);
  assert.equal(read.body.reason, 'source_required');
  assert.equal(client.calls.length, 0);
  const unknownJob = await h.handlers.read(requestOf({ job_id: 'job-onbekend' }));
  assert.equal(unknownJob.status, 404);
  assert.equal(unknownJob.body.reason, 'source_unknown');
  assert.equal(client.calls.length, 0);
});

test('W2/W5: een geldig antwoord levert een concept, een review en de kosten', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(client.calls.length, 1);
  assert.equal(JSON.stringify(result.body).includes(FIXTURE_KEY), false);

  assert.equal(result.body.origin.label, 'Gelezen door AI');
  assert.equal(result.body.origin.kind, AI_READ_PROVENANCE_KIND);
  assert.equal(result.body.ai.provider, 'anthropic');
  assert.equal(result.body.ai.model, 'claude-haiku-5-5');
  assert.equal(result.body.ai.protocolHash, PROTOCOL.hash);
  assert.equal(result.body.cost.known, true);
  assert.equal(typeof result.body.cost.eurCents, 'number');
  assert.equal(result.body.summary.items, 2);
  assert.equal(result.body.summary.valid, 1);
  assert.equal(result.body.summary.needsReview, 1);
  assert.equal(result.body.review.rows.length, 2);
  assert.equal(typeof result.body.state, 'string');
  assert.equal(result.body.concept.version, 1);

  assert.equal(h.saved.length, 1);
  const content = h.saved[0].content;
  assert.equal(content.importProvenance.kind, AI_READ_PROVENANCE_KIND);
  assert.equal(content.importProvenance.label, 'Gelezen door AI');
  assert.equal(content.importProvenance.reviewed, false);
  assert.equal(content.importProvenance.provider, 'anthropic');
  assert.equal(content.importProvenance.model, 'claude-haiku-5-5');
  assert.equal(content.importProvenance.cost.known, true);
  assert.equal(JSON.stringify(content).includes(FIXTURE_KEY), false);
  const items = content.categories.flatMap((category) => category.items);
  const wine = items.find((item) => item.name === 'Huiswijn');
  assert.deepEqual(wine.priceVariants, [
    { label: 'glas', price: '5.00' },
    { label: 'karaf', price: '18.50' },
  ]);
  const water = items.find((item) => item.name === 'Kraanwater');
  assert.equal(water.price, null);
  assert.equal(water.priceStatus, 'unknown');
  assert.equal(h.saved[0].sourceType, 'own_website');
  assert.match(h.saved[0].menuContext, /^23-/);
});

test('W8: een schemafout is een leesbare weigering, geen concept', async () => {
  const bad = validAnswer();
  bad.menus[0].categories[0].items[0].evidence.quote = 'Deze zin staat niet in de bron';
  const client = fakeClient(() => responseOf(bad));
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'schema_violation');
  // BE-36 (#87, criterion 4): its own sentence with a next step, never only
  // "ga verder met de handmatige import".
  assert.match(result.body.error, /past niet bij de afspraken/);
  assert.match(result.body.error, /probeer het opnieuw/i);
  assert.doesNotMatch(result.body.error, /handmatige import/);
  assert.equal(h.saved.length, 0);
});

test('W8: nul gerechten is geen geslaagde lezing', async () => {
  const empty = {
    menus: [],
    rejected: [{ sourceId: 'source-1', locator: 'regel 1', reason: 'not_menu', text: 'Wijnkaart' }],
    coverage: { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: ['geen gerechten'] },
  };
  const client = fakeClient(() => responseOf(empty));
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'no_items');
  assert.equal(h.saved.length, 0);
  assert.equal(result.body.cost.known, true);
});

test('W8: een time-out is een gewone melding, geen concept', async () => {
  const client = fakeClient(() => {
    const error = new Error('Request timed out');
    error.name = 'APIConnectionTimeoutError';
    error.code = 'ETIMEDOUT';
    throw error;
  });
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'provider_unavailable');
  assert.match(result.body.error, /niet bereikbaar/);
  assert.match(result.body.error, /opnieuw/);
  assert.doesNotMatch(result.body.error, /handmatige import/);
  assert.equal(h.saved.length, 0);
  // A failed paid call is reported as unknown, never as a free call.
  assert.equal(result.body.cost.known, false);
});

test('W4: het maandbudget weigert vóór de aanroep', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const rows = [
    { created_at: '2026-10-02T10:00:00.000Z', captured_content: { importProvenance: { kind: AI_READ_PROVENANCE_KIND, cost: { eurCents: 12, known: true } } } },
    { created_at: '2026-10-03T10:00:00.000Z', captured_content: { importProvenance: { kind: AI_READ_PROVENANCE_KIND, cost: { eurCents: 989, known: true } } } },
  ];
  const h = harness({ client, rows });
  const status = await h.handlers.status(requestOf(undefined));
  assert.equal(status.body.monthly.spentEurCents, 1001);
  assert.equal(status.body.monthly.limitEurCents, AI_MONTH_LIMIT_EUR_CENTS);
  assert.equal(status.body.budget.allowed, false);
  assert.equal(status.body.budget.reason, 'budget_exhausted');

  const read = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(read.status, 429);
  assert.equal(read.body.reason, 'budget_exhausted');
  assert.equal(read.body.error, 'Het budget van deze maand is op.');
  assert.equal(client.calls.length, 0);
  assert.equal(h.saved.length, 0);
});

test('W4: onbekende kosten tellen als het maximum per aanroep', async () => {
  // 33 concepts without a measured cost: 33 x 30 = 990, so the next call of at
  // most 30 would pass 1000 and is refused. Never booked as zero.
  const rows = Array.from({ length: 33 }, () => ({
    created_at: '2026-10-04T10:00:00.000Z',
    captured_content: { importProvenance: { kind: AI_READ_PROVENANCE_KIND, cost: { eurCents: null, known: false } } },
  }));
  const h = harness({ rows });
  const status = await h.handlers.status(requestOf(undefined));
  assert.equal(status.body.monthly.spentEurCents, 33 * AI_MAX_COST_EUR_CENTS);
  assert.equal(status.body.monthly.unknownConcepts, 33);
  assert.equal(status.body.budget.allowed, false);
});

test('W4: een concept van vorige maand telt niet mee', async () => {
  const rows = [
    { created_at: '2026-09-30T23:00:00.000Z', captured_content: { importProvenance: { kind: AI_READ_PROVENANCE_KIND, cost: { eurCents: 990, known: true } } } },
    { created_at: '2026-10-01T00:30:00.000Z', captured_content: { importProvenance: { kind: AI_READ_PROVENANCE_KIND, cost: { eurCents: 5, known: true } } } },
  ];
  const h = harness({ rows });
  const status = await h.handlers.status(requestOf(undefined));
  assert.equal(status.body.monthly.spentEurCents, 5);
  assert.equal(status.body.budget.allowed, true);
});

test('W2: het id van een bestaande analyse-opdracht is een toegestane bron', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(client.calls.length, 1);
  assert.equal(h.saved[0].sourceUrl, 'https://voorbeeld.example/wijnkaart');
});

test('W2: een onbekend restaurant wordt geweigerd vóór de aanroep', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client, restaurantExists: () => false });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '999' }));
  assert.equal(result.status, 422);
  assert.equal(result.body.reason, 'restaurant_required');
  assert.equal(client.calls.length, 0);
});

test('W3: een collega zonder interne rol krijgt 403 en niets wordt aangeroepen', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client, authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'owner', restaurant_id: '23' }] }) });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'forbidden');
  assert.equal(client.calls.length, 0);
  assert.equal(h.saved.length, 0);
});

test('W2: een concept dat niet kan worden opgeslagen is een eerlijke fout', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client, save: async () => ({ status: 500, body: { error: 'Het concept kon niet worden opgeslagen.' } }) });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 502);
  assert.equal(result.body.reason, 'concept_failed');
  assert.match(result.body.error, /niet verloren/);
});

test('W2: een gewijzigd toestandstoken is geen bron', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client });
  const tampered = `${tokenOf().slice(0, -4)}aaaa`;
  const result = await h.handlers.read(requestOf({ state: tampered }));
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'state_invalid');
  assert.equal(client.calls.length, 0);
});


test('W6/W7: het toestandstoken van een AI-lezing draagt het vaste AI-label', async () => {
  const client = fakeClient(() => responseOf(validAnswer()));
  const h = harness({ client });
  const result = await h.handlers.read(requestOf({ state: tokenOf() }));
  assert.equal(result.status, 200);
  const opened = h.sealed.cipher.open(result.body.state);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.origin.kind, AI_READ_PROVENANCE_KIND);
  assert.equal(opened.state.origin.label, 'Gelezen door AI');
  assert.equal(opened.state.origin.provider, 'anthropic');
  assert.equal(opened.state.origin.model, 'claude-haiku-5-5');
  assert.equal(opened.state.origin.readId, 'import-ai-1');
  assert.equal(opened.state.origin.cost.known, true);
  assert.match(opened.state.origin.readId, /import-ai-1/);
  // The report in the sealed step is the validated result the review uses.
  assert.ok(Array.isArray(opened.state.report.rows));
  assert.equal(opened.state.report.rows.length, 2);
});

test('W4: een gecorrigeerde versie van dezelfde lezing telt niet dubbel', () => {
  const provenanceBase = { importProvenance: { kind: 'ai_gelezen', readId: 'read-1', cost: { eurCents: 7, known: true } } };
  const rows = [
    { id: 'a', created_at: '2026-10-05T10:00:00.000Z', captured_content: provenanceBase },
    { id: 'b', created_at: '2026-10-05T10:05:00.000Z', captured_content: provenanceBase },
    { id: 'c', created_at: '2026-10-05T11:00:00.000Z', captured_content: { importProvenance: { kind: 'ai_gelezen', readId: 'read-2', cost: { eurCents: 5, known: true } } } },
  ];
  const spend = monthlySpendFromRows(rows, { now: new Date('2026-10-24T12:00:00.000Z') });
  assert.equal(spend.concepts, 3);
  assert.equal(spend.reads, 2);
  assert.equal(spend.spentEurCents, 12);
});
