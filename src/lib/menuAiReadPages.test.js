'use strict';

// BE-36 (#87, criterion 8) — the page-by-page reading, proven with a fake AI.
// No key, no provider, no network, no database: the transport is a fixture, the
// answers are fixture answers, and the real adapter, validator, report and
// concept rules do the work.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMenuAiReadHandlers } = require('./menuAiReadHandlers');
const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { sourceHashForText } = require('./manualMenuImportBundle');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createAnthropicStructuredCall } = require('./menuExtractionAnthropicCall');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });
const SECRET = 'fixture-secret-value-for-tests-only';
const FIXTURE_KEY = 'fixture-anthropic-key-not-a-secret';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg==';
const IMAGE_URL = 'https://bistro-voorbeeld.example/menukaart';

function requestOf(body) {
  return { text: async () => JSON.stringify(body), headers: { get: () => 'Bearer fixture' } };
}

function responseOf(output, { stop = 'end_turn', usage = { input_tokens: 2000, output_tokens: 800 } } = {}) {
  return {
    id: 'msg_fixture',
    model: 'claude-haiku-5-5',
    stop_reason: stop,
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
        const final = Promise.resolve().then(() => handler(body, options, calls.length));
        const stream = { request_id: 'req_fixture', on: () => stream, abort: () => {}, finalMessage: () => final };
        return stream;
      },
    },
  };
}

/** The page number of a call, read from the origin line the request carries. */
function pageOf(body) {
  const content = body.messages[0].content;
  const line = content.find((block) => block.type === 'text' && /^afbeelding \d+/.test(block.text));
  return line ? Number(/^afbeelding (\d+)/.exec(line.text)[1]) : null;
}

function answerForPage(page, { sourceId = 'source-1', count = 2, locator = null, priceStatus = 'known' } = {}) {
  const items = Array.from({ length: count }, (_, index) => {
    const name = `Gerecht ${page}-${index + 1}`;
    const amount = 1200 + page * 10 + index;
    return {
      name,
      priceStatus,
      ...(priceStatus === 'known' ? { amountMinorUnits: amount, currency: 'EUR', priceText: (amount / 100).toFixed(2).replace('.', ',') } : {}),
      evidence: { sourceId, locator: locator || `afbeelding ${page}`, quote: name },
    };
  });
  return {
    menus: [{ title: 'Menukaart', sourceId, categories: [{ name: `Pagina ${page}`, items }] }],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: count, unreadSources: [], limitations: [] },
  };
}

function imageSource(count, { id = 'source-1' } = {}) {
  return {
    id,
    url: IMAGE_URL,
    kind: 'image',
    status: 'read',
    text: '',
    hasText: false,
    imageRead: true,
    sha256: sourceHashForText(`${IMAGE_URL}-${id}`),
    images: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      url: `${IMAGE_URL}/kaart-${index + 1}.jpg`,
      mediaType: 'image/jpeg',
      data: TINY_PNG,
      alt: `Menukaart ${index + 1}`,
    })),
  };
}

function harness({ client, sources, rows = [], saveConcept = null }) {
  const saved = [];
  const sealed = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-27T12:00:00.000Z') });
  const handlers = createMenuAiReadHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => ({ ANTHROPIC_API_KEY: FIXTURE_KEY, MENU_AI_FALLBACK_ENABLED: 'true' }),
    now: () => new Date('2026-10-27T12:05:00.000Z'),
    readUsageRows: async () => ({ ok: true, rows }),
    readSources: async () => sources,
    resolveJob: async ({ jobId }) => (jobId === 'job-1' ? { ok: true, urls: [IMAGE_URL], restaurantId: '23' } : { ok: false }),
    restaurantExists: (id) => id === '23',
    loadProtocol: () => PROTOCOL,
    openState: (token) => sealed.open(token),
    sealState: (state) => sealed.seal(state),
    saveConcept:
      saveConcept ||
      (async (input) => {
        saved.push(input);
        return { status: 201, body: { concept: { id: 'concept-pages', version: 1, unchanged: false } } };
      }),
    createCall: ({ budget }) => createAnthropicStructuredCall({ env: { ANTHROPIC_API_KEY: FIXTURE_KEY }, client, budget }),
    generateId: () => 'import-pages-1',
    sleep: async () => {},
  });
  return { handlers, saved };
}


test('BE-36: negen pagina\'s worden één lezing; één mislukte pagina lukt bij de tweede poging', async () => {
  const perPage = new Map();
  const client = fakeClient((body) => {
    const page = pageOf(body);
    perPage.set(page, (perPage.get(page) || 0) + 1);
    if (page === 3 && perPage.get(page) === 1) {
      // Criterion 2: an answer that was cut off on the first attempt.
      return responseOf('{"menus": [', { stop: 'max_tokens' });
    }
    return responseOf(answerForPage(page));
  });
  const h = harness({ client, sources: [imageSource(9)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.pages.total, 9);
  assert.equal(result.body.pages.read, 9);
  assert.deepEqual(result.body.pages.failed, []);
  assert.equal(result.body.partial, false);
  assert.equal(perPage.get(3), 2, 'page 3 is retried exactly once');
  // Nine pages plus one retry: ten calls, never one call with nine images.
  assert.equal(client.calls.length, 10);
  for (const call of client.calls) {
    assert.equal(call.body.messages[0].content.filter((block) => block.type === 'image').length, 1);
  }
  assert.equal(result.body.summary.items, 18);
  // Every dish keeps the page it was read from.
  const pages = new Set(result.body.review.rows.map((row) => row.provenance));
  assert.equal(pages.size, 9);
  assert.ok(pages.has('gelezen van afbeelding 3'));
  // Criterion 5: the reading's maximum follows its pages.
  assert.equal(result.body.costPlan.maxEurCents, 27);
  assert.equal(result.body.cost.maxEurCents, 27);
  assert.equal(result.body.cost.known, true);
});

test('BE-36: een pagina die blijft mislukken geeft een gedeeltelijke lezing met "Opnieuw proberen"', async () => {
  const client = fakeClient((body) => {
    const page = pageOf(body);
    if (page === 4) return responseOf('{"menus": [', { stop: 'max_tokens' });
    return responseOf(answerForPage(page));
  });
  const h = harness({ client, sources: [imageSource(9)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.partial, true);
  assert.equal(result.body.pages.read, 8);
  assert.equal(result.body.pages.total, 9);
  assert.equal(result.body.pages.failed.length, 1);
  const failed = result.body.pages.failed[0];
  assert.equal(failed.page, 4);
  assert.equal(failed.message, 'Pagina 4 kon niet gelezen worden. Het antwoord was afgekapt.');
  assert.equal(failed.nextStep, 'Opnieuw proberen');
  assert.equal(failed.retryable, true);
  assert.deepEqual(result.body.pages.retryable, [4]);
  // The rest of the reading continues: eight pages of dishes.
  assert.equal(result.body.summary.items, 16);
  assert.equal(h.saved.length, 1);
  assert.equal(typeof result.body.state, 'string');
});



test('BE-36: "Opnieuw proberen" leest alleen die pagina en maakt de lezing af', async () => {
  let pageFourFails = true;
  const client = fakeClient((body) => {
    const page = pageOf(body);
    if (page === 4 && pageFourFails) return responseOf('{"menus": [', { stop: 'max_tokens' });
    return responseOf(answerForPage(page));
  });
  const h = harness({ client, sources: [imageSource(9)] });
  const first = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.partial, true);
  assert.equal(first.body.summary.items, 16);
  const callsBefore = client.calls.length;

  // The retry names page 4 only; the source URL comes from the sealed state.
  pageFourFails = false;
  const retry = await h.handlers.read(requestOf({ state: first.body.state, retry_pages: [4] }));
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(client.calls.length, callsBefore + 1, 'exactly one page is read again');
  assert.equal(pageOf(client.calls[client.calls.length - 1].body), 4);
  assert.equal(retry.body.pages.total, 9);
  assert.equal(retry.body.pages.read, 9);
  assert.deepEqual(retry.body.pages.failed, []);
  assert.equal(retry.body.partial, false);
  // The eight dishes of the first reading are still there, plus page 4.
  assert.equal(retry.body.summary.items, 18);
  assert.equal(h.saved.length, 2, 'the retry writes one new version of the same reading');
});

test('BE-36: een model dat losse afbeeldingen als pagina\'s telt, wordt niet meer afgekeurd', async () => {
  // The live Al Dente failure: 9 images, the model answered pagesRead: 9 and the
  // whole reading was refused with page_limit. A page limit is a PDF limit.
  const client = fakeClient((body) => {
    const page = pageOf(body);
    const answer = answerForPage(page, { count: 1 });
    answer.coverage.pagesRead = 9;
    answer.coverage.sourcesRead = 1;
    return responseOf(answer);
  });
  const h = harness({ client, sources: [imageSource(9)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.pages.read, 9);
  assert.equal(result.body.summary.items, 9);
});

test('BE-36: elke foutreden heeft zijn eigen zin met een volgende stap', async () => {
  const { messageFor } = require('./menuAiImport');
  const { FAILURE_SENTENCES, pageFailure } = require('./menuReadingPages');
  const reasons = [
    'provider_unavailable',
    'model_unavailable',
    'rate_limited',
    'timeout',
    'output_truncated',
    'schema_violation',
    'budget_exhausted',
    'no_items',
    'source_empty',
  ];
  for (const reason of reasons) {
    const message = messageFor(reason);
    assert.ok(message.length > 10, reason);
    assert.doesNotMatch(message, /alleen .*handmatige import/i, reason);
    assert.doesNotMatch(message, /^Ga verder met de handmatige import\.$/, reason);
  }
  assert.equal(messageFor('provider_unavailable'), 'De AI is even niet bereikbaar. Probeer het over een minuut opnieuw.');
  assert.equal(messageFor('budget_exhausted'), 'Het budget van deze maand is op.');
  assert.equal(messageFor('output_truncated'), 'Het antwoord van de AI was afgekapt. Probeer het opnieuw.');
  // Every page failure has its own reason sentence and its own next step.
  for (const [reason, sentence] of Object.entries(FAILURE_SENTENCES)) {
    const failure = pageFailure({ number: 4, label: 'Pagina 4', kind: 'image', locator: 'afbeelding 4', sourceId: 'source-1' }, { reason, attempts: 2 });
    assert.equal(failure.message, `Pagina 4 kon niet gelezen worden. ${sentence}`, reason);
    assert.equal(failure.nextStep, 'Opnieuw proberen', reason);
  }
});

test('BE-36: het budget van een lezing volgt het aantal pagina\'s en wordt vooraf gecontroleerd', async () => {
  // 9 pages reserve 27 cent; a month with 974 cent spent cannot carry it.
  const rows = [{ created_at: '2026-10-02T10:00:00.000Z', captured_content: { importProvenance: { cost: { known: true, eurCents: 974 } } } }];
  const client = fakeClient((body) => responseOf(answerForPage(pageOf(body))));
  const h = harness({ client, sources: [imageSource(9)], rows });
  const refused = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(refused.status, 429, JSON.stringify(refused.body));
  assert.equal(refused.body.reason, 'budget_exhausted');
  assert.equal(client.calls.length, 0, 'nothing is spent when the reading does not fit');

  // With 970 cent spent the same reading fits and stops above its own maximum.
  const room = harness({ client: fakeClient((body) => responseOf(answerForPage(pageOf(body)))), sources: [imageSource(9)], rows: [{ ...rows[0], captured_content: { importProvenance: { cost: { known: true, eurCents: 970 } } } }] });
  const allowed = await room.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(allowed.body.costPlan.maxEurCents, 27);
  assert.equal(allowed.body.cost.maxEurCents, 27);
});
