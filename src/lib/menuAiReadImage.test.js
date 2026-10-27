'use strict';

// BE-33 (#79, criteria 2 and 3) — "Lees met AI" reading an image or a scan,
// proven with a faked transport layer: the same client, model, enable flag,
// schema and validator as a text reading. No key, no provider, no network, no
// database. The fixtures are a real 1x1 PNG and a minimal PDF; the model is a
// fixture answer.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMenuAiReadHandlers } = require('./menuAiReadHandlers');
const { loadMenuExtractionProtocol } = require('./menuExtractionProtocol');
const { sourceHashForText } = require('./manualMenuImportBundle');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createAnthropicStructuredCall } = require('./menuExtractionAnthropicCall');
const { MAX_MENU_IMAGES, MAX_SCAN_PAGES } = require('./menuImageRead');
const { readManualImportSource } = require('./manualMenuImportSource');
const { alDenteMenuPage, classicoPage } = require('./__fixtures__/menuImagePages');

const ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL = loadMenuExtractionProtocol({ root: ROOT });
const SECRET = 'fixture-secret-value-for-tests-only';
const FIXTURE_KEY = 'fixture-anthropic-key-not-a-secret';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg==';

function requestOf(body) {
  return { text: async () => JSON.stringify(body), headers: { get: () => 'Bearer fixture' } };
}

function responseOf(output) {
  return {
    id: 'msg_fixture',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 800 },
    content: [{ type: 'text', text: JSON.stringify(output) }],
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
        const stream = { request_id: 'req_fixture', on: () => stream, abort: () => {}, finalMessage: () => final };
        return stream;
      },
    },
  };
}

function answerFor(locators) {
  return {
    menus: [
      {
        title: 'Menukaart',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Klassiekers',
            items: locators.map((locator, index) => ({
              name: `Fictief gerecht ${index + 1}`,
              priceStatus: 'known',
              amountMinorUnits: 1500 + index * 100,
              currency: 'EUR',
              priceText: `${15 + index},00`,
              evidence: { sourceId: 'source-1', locator, quote: `Fictief gerecht ${index + 1}` },
            })),
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: locators.length, unreadSources: [], limitations: [] },
  };
}

function imageSource(count) {
  return {
    id: 'source-1',
    url: 'https://bistro-voorbeeld.example/menukaart',
    kind: 'image',
    status: 'read',
    text: '',
    hasText: false,
    imageRead: true,
    sha256: sourceHashForText('https://bistro-voorbeeld.example/img/kaart-1.jpg'),
    images: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      url: `https://bistro-voorbeeld.example/img/kaart-${index + 1}.jpg`,
      mediaType: 'image/jpeg',
      data: TINY_PNG,
      alt: `Menukaart ${index + 1}`,
    })),
    limitation: 'Deze pagina toont de menukaart als afbeelding; de AI leest de afbeeldingen.',
  };
}

function scanSource(pageCount) {
  return {
    id: 'source-1',
    url: 'https://bistro-voorbeeld.example/menukaart.pdf',
    kind: 'pdf',
    status: 'read',
    text: '',
    hasText: false,
    imageRead: true,
    sha256: sourceHashForText('pdf-fixture'),
    documentBase64: TINY_PNG,
    pageCount,
    limitation: 'De PDF gaat als document naar de AI; de pagina’s worden niet als tekst gelezen.',
  };
}

function harness({ client, sources, rows = [], env, saveConcept = null }) {
  const saved = [];
  const sealed = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  let reads = 0;
  const handlers = createMenuAiReadHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => env || { ANTHROPIC_API_KEY: FIXTURE_KEY, MENU_AI_FALLBACK_ENABLED: 'true' },
    now: () => new Date('2026-10-24T12:05:00.000Z'),
    readUsageRows: async () => ({ ok: true, rows }),
    readSources: async () => {
      reads += 1;
      return sources;
    },
    resolveJob: async ({ jobId }) => (jobId === 'job-1' ? { ok: true, urls: ['https://bistro-voorbeeld.example/menukaart'], restaurantId: '23' } : { ok: false }),
    restaurantExists: (id) => id === '23',
    loadProtocol: () => PROTOCOL,
    openState: (token) => sealed.open(token),
    sealState: (state) => sealed.seal(state),
    saveConcept:
      saveConcept ||
      (async (input) => {
        saved.push(input);
        return { status: 201, body: { concept: { id: 'concept-img', version: 1, unchanged: false } } };
      }),
    createCall: ({ budget }) => createAnthropicStructuredCall({ env: { ANTHROPIC_API_KEY: FIXTURE_KEY }, client, budget }),
    generateId: () => 'import-img-1',
  });
  return { handlers, saved, reads: () => reads };
}

test('BE-33: menu images of this website are read as images by the same model', async () => {
  const client = fakeClient(() => responseOf(answerFor(['afbeelding 1', 'afbeelding 2'])));
  const h = harness({ client, sources: [imageSource(2)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(client.calls.length, 1);

  // Criterion 2: the provider request carries two real image blocks, each with
  // its own origin line, and no text source.
  const content = client.calls[0].body.messages[0].content;
  const images = content.filter((block) => block.type === 'image');
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].source, { type: 'base64', media_type: 'image/jpeg', data: TINY_PNG });
  assert.ok(content.some((block) => block.type === 'text' && block.text.startsWith('afbeelding 1')));
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes('"afbeelding N" of "pagina N"')));

  // The plan and the estimate are visible, and the notice is honest.
  assert.equal(result.body.plan.mode, 'image');
  assert.equal(result.body.plan.imageCount, 2);
  assert.match(result.body.estimate.label, /2 afbeeldingen/);
  assert.match(result.body.notice, /niet letterlijk te controleren/);

  // Criterion 3: every dish names its image and says "Controle nodig".
  const rows = result.body.review.rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.provenance), ['gelezen van afbeelding 1', 'gelezen van afbeelding 2']);
  assert.deepEqual(rows.map((row) => row.label), ['Controle nodig', 'Controle nodig']);
  assert.deepEqual(rows.map((row) => row.state), ['unverifiable', 'unverifiable']);
  assert.deepEqual(rows.map((row) => row.code), ['image_unverified', 'image_unverified']);
  // Nothing is approved by itself: the review still needs a human decision.
  assert.equal(result.body.review.summary.valid, 0);
  assert.equal(result.body.review.canSave, false);
  assert.equal(h.saved.length, 1, 'one draft concept is written, nothing published');
  // The durable draft keeps the dishes with their origin, and stays unreviewed.
  const items = h.saved[0].content.categories.flatMap((category) => category.items);
  assert.deepEqual(items.map((item) => item.name), ['Fictief gerecht 1', 'Fictief gerecht 2']);
  assert.deepEqual(items.map((item) => item.evidence.locator), ['afbeelding 1', 'afbeelding 2']);
  assert.equal(h.saved[0].content.importProvenance.reviewed, false);
});

test('BE-33: a scan PDF goes as a document and keeps "pagina N" per dish', async () => {
  const client = fakeClient(() => responseOf(answerFor(['pagina 1', 'pagina 2'])));
  const h = harness({ client, sources: [scanSource(2)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const content = client.calls[0].body.messages[0].content;
  const document = content.find((block) => block.type === 'document');
  assert.ok(document, 'the PDF is sent as a document');
  assert.deepEqual(document.source, { type: 'base64', media_type: 'application/pdf', data: TINY_PNG });
  assert.equal(result.body.plan.mode, 'document');
  assert.equal(result.body.plan.pageCount, 2);
  assert.deepEqual(result.body.review.rows.map((row) => row.provenance), ['gelezen van pagina 1', 'gelezen van pagina 2']);
  assert.deepEqual(result.body.review.rows.map((row) => row.label), ['Controle nodig', 'Controle nodig']);
});

test('BE-33: too many images or pages, and a missing origin, are refused before or by the validator', async () => {
  // Eleven images: refused before any model call and without a concept.
  const tooManyImages = harness({ client: fakeClient(() => responseOf(answerFor(['afbeelding 1']))), sources: [imageSource(MAX_MENU_IMAGES + 1)] });
  const tooMany = await tooManyImages.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(tooMany.status, 422);
  assert.equal(tooMany.body.reason, 'too_many_images');
  assert.match(tooMany.body.error, /maximaal 10/);
  assert.equal(tooManyImages.saved.length, 0);

  // Eleven pages: refused, no call.
  const elevenClient = fakeClient(() => responseOf(answerFor(['pagina 1'])));
  const eleven = harness({ client: elevenClient, sources: [scanSource(MAX_SCAN_PAGES + 1)] });
  const tooManyPages = await eleven.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(tooManyPages.status, 422);
  assert.equal(tooManyPages.body.reason, 'too_many_pages');
  assert.equal(elevenClient.calls.length, 0);

  // A dish without the origin of its image is rejected by the same validator,
  // before anything is stored: no concept, no approval.
  const missing = harness({ client: fakeClient(() => responseOf(answerFor(['regel 4']))), sources: [imageSource(1)] });
  const refused = await missing.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(refused.status, 422, JSON.stringify(refused.body));
  assert.equal(refused.body.reason, 'schema_violation');
  assert.deepEqual(refused.body.problems, ['menus[0].categories[0].items[0].evidence.locator must name "afbeelding N" or "pagina N" for an image or scan source']);
  assert.equal(missing.saved.length, 0);
});

test('BE-33: budget out and AI off stop an image reading before the model is called', async () => {
  const spent = [{ id: 'concept-old', created_at: '2026-10-02T10:00:00.000Z', captured_content: { importProvenance: { cost: { known: true, eurCents: 1000 } } } }];
  const budgetClient = fakeClient(() => responseOf(answerFor(['afbeelding 1'])));
  const budget = harness({ client: budgetClient, sources: [imageSource(1)], rows: spent });
  const refused = await budget.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(refused.status, 429);
  assert.equal(refused.body.reason, 'budget_exhausted');
  assert.equal(budgetClient.calls.length, 0);
  assert.equal(budget.saved.length, 0);

  const offClient = fakeClient(() => responseOf(answerFor(['afbeelding 1'])));
  const off = harness({ client: offClient, sources: [imageSource(1)], env: {} });
  const disabled = await off.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.reason, 'ai_not_configured');
  assert.equal(offClient.calls.length, 0);
  assert.equal(off.reads(), 0, 'no source is even read when AI is off');
});

test('BE-33: a dry run gives the estimate of an image reading without spending anything', async () => {
  const client = fakeClient(() => responseOf(answerFor(['afbeelding 1'])));
  const h = harness({ client, sources: [imageSource(3)] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23', dry_run: true }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.dry_run, true);
  assert.equal(result.body.plan.imageCount, 3);
  assert.match(result.body.estimate.label, /3 afbeeldingen/);
  assert.equal(client.calls.length, 0, 'a dry run never calls the model');
  assert.equal(h.saved.length, 0);
});

/** Reads one fixture page through the real source reader, with a fake fetch. */
async function sourceFromPage(page) {
  return readManualImportSource({
    id: 'source-1',
    url: page.pageUrl,
    fetchImpl: async (url) => {
      if (url === page.pageUrl) return { finalUrl: url, contentType: 'text/html', bytes: Buffer.from(page.html, 'utf8') };
      return { finalUrl: url, contentType: 'image/jpeg', bytes: Buffer.from(TINY_PNG, 'base64') };
    },
    now: new Date('2026-10-27T12:00:00.000Z'),
  });
}

test('BE-35: the real menu-image pages reach the model as image blocks, ten at most', async () => {
  // The live Al Dente shape, doubled to 12 images: navigation and footer text,
  // no menu text. The page is an image source and the model gets ten images in
  // page order, never zero.
  const big = alDenteMenuPage({ count: 12 });
  const bigSource = await sourceFromPage(big);
  assert.equal(bigSource.kind, 'image');
  assert.equal(bigSource.images.length, MAX_MENU_IMAGES);
  assert.equal(bigSource.imageCandidates, 12);
  assert.match(bigSource.limitation, /Deze pagina heeft 12 menu-afbeeldingen; de eerste 10 zijn gelezen\./);

  const bigClient = fakeClient(() => responseOf(answerFor(['afbeelding 1', 'afbeelding 10'])));
  const bigRun = harness({ client: bigClient, sources: [bigSource] });
  const bigResult = await bigRun.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(bigResult.status, 200, JSON.stringify(bigResult.body));
  const bigContent = bigClient.calls[0].body.messages[0].content;
  const bigImages = bigContent.filter((block) => block.type === 'image');
  assert.equal(bigImages.length, 10);
  assert.deepEqual(bigImages[0].source, { type: 'base64', media_type: 'image/jpeg', data: TINY_PNG });
  assert.ok(bigContent.some((block) => block.type === 'text' && block.text.startsWith('afbeelding 10')));
  assert.equal(bigResult.body.plan.mode, 'image');
  assert.equal(bigResult.body.plan.imageCount, 10);
  assert.match(bigResult.body.estimate.label, /10 afbeeldingen/);

  // The menu-classico page: two images whose file name does not say "menu".
  const classicoSource = await sourceFromPage(classicoPage());
  assert.equal(classicoSource.kind, 'image');
  assert.equal(classicoSource.images.length, 2);
  const classicoClient = fakeClient(() => responseOf(answerFor(['afbeelding 1', 'afbeelding 2'])));
  const classicoRun = harness({ client: classicoClient, sources: [classicoSource] });
  const classicoResult = await classicoRun.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(classicoResult.status, 200, JSON.stringify(classicoResult.body));
  const classicoContent = classicoClient.calls[0].body.messages[0].content;
  assert.equal(classicoContent.filter((block) => block.type === 'image').length, 2);
  assert.deepEqual(classicoResult.body.review.rows.map((row) => row.provenance), ['gelezen van afbeelding 1', 'gelezen van afbeelding 2']);
  assert.deepEqual(classicoResult.body.review.rows.map((row) => row.label), ['Controle nodig', 'Controle nodig']);
});

