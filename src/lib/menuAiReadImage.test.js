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
const { buildImportBundle, sourceHashForText } = require('./manualMenuImportBundle');
const { createManualImportStateCipher } = require('./manualMenuImportState');
const { createAnthropicStructuredCall } = require('./menuExtractionAnthropicCall');
const { MAX_MENU_IMAGES, MAX_SCAN_PAGES } = require('./menuImageRead');
const { readManualImportSource, readManualImportSources } = require('./manualMenuImportSource');
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

function answerFor(locators, { sourcesRead = 1, sourceId = 'source-1' } = {}) {
  return {
    menus: [
      {
        title: 'Menukaart',
        sourceId,
        categories: [
          {
            name: 'Klassiekers',
            items: locators.map((locator, index) => ({
              name: `Fictief gerecht ${index + 1}`,
              priceStatus: 'known',
              amountMinorUnits: 1500 + index * 100,
              currency: 'EUR',
              priceText: `${15 + index},00`,
              evidence: { sourceId, locator, quote: `Fictief gerecht ${index + 1}` },
            })),
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead, pagesRead: 1, itemsExtracted: locators.length, unreadSources: [], limitations: [] },
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

function harness({ client, sources, rows = [], env, saveConcept = null, readSources = null, resolveJob = null, cipher: cipherOverride = null }) {
  const saved = [];
  const sealed = cipherOverride || createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  let reads = 0;
  const handlers = createMenuAiReadHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => env || { ANTHROPIC_API_KEY: FIXTURE_KEY, MENU_AI_FALLBACK_ENABLED: 'true' },
    now: () => new Date('2026-10-24T12:05:00.000Z'),
    readUsageRows: async () => ({ ok: true, rows }),
    readSources: async (input) => {
      reads += 1;
      return typeof readSources === 'function' ? readSources(input) : sources;
    },
    resolveJob: resolveJob || (async ({ jobId }) => (jobId === 'job-1' ? { ok: true, urls: ['https://bistro-voorbeeld.example/menukaart'], restaurantId: '23' } : { ok: false })),
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

test('BE-33: too many pages, and a missing origin, are refused before or by the validator; too many images are read to ten', async () => {
  // BE-35 ronde 3 (#84): eleven menu images are no refusal. The first ten are
  // read, the model receives ten image blocks and the answer names the real
  // number. Never zero.
  const tooManyClient = fakeClient(() => responseOf(answerFor(['afbeelding 1', 'afbeelding 10'])));
  const tooManyImages = harness({ client: tooManyClient, sources: [imageSource(MAX_MENU_IMAGES + 1)] });
  const tooMany = await tooManyImages.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(tooMany.status, 200, JSON.stringify(tooMany.body));
  assert.equal(tooManyClient.calls.length, 1);
  const imageBlocks = tooManyClient.calls[0].body.messages[0].content.filter((block) => block.type === 'image');
  assert.equal(imageBlocks.length, MAX_MENU_IMAGES);
  assert.equal(tooMany.body.plan.imageCount, MAX_MENU_IMAGES);
  assert.equal(tooMany.body.plan.availableImageCount, MAX_MENU_IMAGES + 1);
  assert.match(tooMany.body.plan.limitation, /Deze lezing heeft 11 menu-afbeeldingen; de eerste 10 zijn gelezen\./);
  assert.match(tooMany.body.notice, /Deze lezing heeft 11 menu-afbeeldingen; de eerste 10 zijn gelezen\./);
  assert.match(tooMany.body.estimate.label, /10 afbeeldingen/);
  assert.equal(tooManyImages.saved.length, 1);

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



/**
 * BE-35 ronde 3 (#84): the reading of the two real Al Dente pages, through the
 * real source reader, the real bundle and the real sealed state. Nine menu
 * images (7 + 2), the site header excluded, and the same nine image blocks for
 * the row in Dekking (`job_id`) and for "Menu importeren" (`state`).
 */
async function sealedAlDenteState() {
  const pages = [alDenteMenuPage(), classicoPage()];
  const fetchImpl = async (url) => {
    const page = pages.find((entry) => entry.pageUrl === url);
    if (page) return { finalUrl: url, contentType: 'text/html', bytes: Buffer.from(page.html, 'utf8') };
    return { finalUrl: url, contentType: 'image/jpeg', bytes: Buffer.from(TINY_PNG, 'base64') };
  };
  const read = (urls) => readManualImportSources({ urls, fetchImpl, now: new Date('2026-10-24T12:00:00.000Z') });
  const sources = await read(pages.map((page) => page.pageUrl));
  const bundle = buildImportBundle({
    bundleId: 'AI-2026-10-24-STATE',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Restaurant Voorbeeld',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources,
  });
  const cipher = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  const sealed = cipher.seal({
    userId: 'user-1',
    restaurantId: '23',
    bundle,
    report: null,
    decisions: [],
    followUps: {},
    followUpTotal: 0,
  });
  return { pages, read, bundle, cipher, token: sealed.token };
}

test('BE-35 ronde 3: negen menu-afbeeldingen bereiken de AI via job_id én via de verzegelde staat', async () => {
  const fixture = await sealedAlDenteState();
  assert.equal(fixture.bundle.sources.length, 2);
  assert.equal(fixture.bundle.sources[0].images.length, 6, 'the sealed bundle keeps metadata only, at most six per source');
  assert.equal(fixture.bundle.sources[0].mode, 'image');
  assert.equal(fixture.bundle.sources[0].hasText, false);
  const locators = Array.from({ length: 9 }, (_, index) => `afbeelding ${index + 1}`);

  // 1) The row in Dekking: the job supplies the URLs.
  const jobClient = fakeClient(() => responseOf(answerFor(locators, { sourcesRead: 2 })));
  const jobRun = harness({
    client: jobClient,
    readSources: async ({ urls }) => fixture.read(urls),
    resolveJob: async ({ jobId }) => (jobId === 'job-1'
      ? { ok: true, urls: fixture.pages.map((page) => page.pageUrl), restaurantId: '23' }
      : { ok: false }),
  });
  const job = await jobRun.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(job.status, 200, JSON.stringify(job.body));
  assert.equal(job.body.plan.imageCount, 9);
  assert.equal(job.body.plan.mode, 'image');
  const jobImages = jobClient.calls[0].body.messages[0].content.filter((block) => block.type === 'image');
  assert.equal(jobImages.length, 9);
  assert.deepEqual(jobImages[0].source, { type: 'base64', media_type: 'image/jpeg', data: TINY_PNG });
  assert.deepEqual(job.body.review.rows.map((row) => row.provenance), [
    ...Array.from({ length: 9 }, (_, index) => `gelezen van afbeelding ${index + 1}`),
  ]);

  // 2) "Menu importeren": the sealed state carries the source URLs, never the
  // request. A URL in the body is ignored (W2).
  const stateClient = fakeClient(() => responseOf(answerFor(locators, { sourcesRead: 2 })));
  const readUrls = [];
  const stateRun = harness({
    client: stateClient,
    cipher: fixture.cipher,
    readSources: async ({ urls }) => {
      readUrls.push(...urls);
      return fixture.read(urls);
    },
  });
  const state = await stateRun.handlers.read(requestOf({
    state: fixture.token,
    urls: ['https://kwaad-voorbeeld.example/menu.jpg'],
    job_id: 'job-1',
  }));
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.deepEqual(readUrls, fixture.pages.map((page) => page.pageUrl), 'only the URLs of the sealed state');
  assert.equal(state.body.plan.imageCount, 9);
  assert.equal(state.body.plan.mode, 'image');
  assert.equal(state.body.imageRead, true);
  const stateImages = stateClient.calls[0].body.messages[0].content.filter((block) => block.type === 'image');
  assert.equal(stateImages.length, 9, 'the menu-import page sends the same nine image blocks');
  assert.deepEqual(stateImages[0].source, { type: 'base64', media_type: 'image/jpeg', data: TINY_PNG });
  const stateLabels = stateClient.calls[0].body.messages[0].content.filter((block) => block.type === 'text' && /^afbeelding \d+/.test(block.text));
  assert.equal(stateLabels.length, 9, 'every image carries its own origin line');
  assert.ok(stateLabels.some((block) => block.text.startsWith('afbeelding 7')));
  assert.equal(stateRun.saved.length, 1);
  assert.deepEqual(state.body.review.rows.map((row) => row.label), Array.from({ length: 9 }, () => 'Controle nodig'));
});

test('BE-35 ronde 3: een scan in de verzegelde staat gaat als document naar de AI', async () => {
  // A sealed bundle of a scan PDF keeps only metadata; the state branch reads
  // the URL again and sends the document, exactly like the job_id branch.
  const url = 'https://bistro-voorbeeld.example/menukaart.pdf';
  const bundle = buildImportBundle({
    bundleId: 'AI-2026-10-24-SCAN',
    actorUserId: 'user-1',
    restaurantId: '23',
    restaurantName: 'Restaurant Voorbeeld',
    fetchedAt: '2026-10-24T12:00:00.000Z',
    protocol: PROTOCOL,
    now: new Date('2026-10-24T12:00:00.000Z'),
    sources: [{
      id: 'source-1',
      url,
      kind: 'pdf',
      status: 'read',
      text: '',
      hasText: false,
      imageRead: true,
      hasDocument: true,
      pageCount: 2,
      sha256: sourceHashForText('pdf-fixture'),
      limitation: 'De PDF gaat als document naar de AI; de pagina’s worden niet als tekst gelezen.',
    }],
  });
  assert.equal(bundle.sources[0].mode, 'document');
  const cipher = createManualImportStateCipher({ secret: SECRET, now: () => new Date('2026-10-24T12:00:00.000Z') });
  const token = cipher.seal({ userId: 'user-1', restaurantId: '23', bundle, report: null, decisions: [], followUps: {}, followUpTotal: 0 }).token;

  const client = fakeClient(() => responseOf(answerFor(['pagina 1', 'pagina 2'])));
  const urls = [];
  const h = harness({
    client,
    cipher,
    readSources: async ({ urls: requested }) => {
      urls.push(...requested);
      return [{ ...scanSource(2), url }];
    },
  });
  const result = await h.handlers.read(requestOf({ state: token }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(urls, [url], 'the URL comes from the sealed state');
  assert.equal(result.body.plan.mode, 'document');
  assert.equal(result.body.plan.pageCount, 2);
  const document = client.calls[0].body.messages[0].content.find((block) => block.type === 'document');
  assert.ok(document, 'the scan is sent as a document');
  assert.deepEqual(document.source, { type: 'base64', media_type: 'application/pdf', data: TINY_PNG });
  assert.deepEqual(result.body.review.rows.map((row) => row.provenance), ['gelezen van pagina 1', 'gelezen van pagina 2']);
});


test('BE-35 ronde 3: een tekstbron en een beeldbron gaan samen naar de AI', async () => {
  // The job found a menu page (text) and a page that only shows images. Both
  // are sent: text by its text, the images as image blocks.
  const textSource = {
    id: 'source-1',
    url: 'https://bistro-voorbeeld.example/menukaart',
    kind: 'html',
    status: 'read',
    text: 'Huiswijn 5,00\nKraanwater\nKoffie 2,50',
    hasText: true,
    sha256: sourceHashForText('Huiswijn 5,00\nKraanwater\nKoffie 2,50'),
  };
  const imagePart = imageSource(2);
  const client = fakeClient(() => responseOf(answerFor(['afbeelding 1'], { sourcesRead: 2, sourceId: 'source-2' })));
  const h = harness({ client, sources: [textSource, { ...imagePart, id: 'source-2', url: 'https://bistro-voorbeeld.example/beeldkaart' }] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.plan.mode, 'mixed');
  assert.equal(result.body.plan.imageCount, 2);
  assert.match(result.body.notice, /tekstbronnen en 2 menu-afbeeldingen/);
  const content = client.calls[0].body.messages[0].content;
  assert.equal(content.filter((block) => block.type === 'image').length, 2);
  assert.ok(content.some((block) => block.type === 'text' && block.text.includes('Huiswijn 5,00')));
});


test('BE-35 ronde 3: een pagina zonder leesbare afbeeldingen valt uit de lezing en breekt de dekking niet', async () => {
  // A reader can hand over an image page whose images were all cut or failed.
  // It is not a source of this reading: the bundle and the model name the same
  // one source, so complete coverage still means what it says.
  const emptyPage = { ...imageSource(0), id: 'source-2', url: 'https://bistro-voorbeeld.example/leeg', imageCandidates: 2 };
  const client = fakeClient(() => responseOf(answerFor(['afbeelding 1'])));
  const h = harness({ client, sources: [imageSource(2), emptyPage] });
  const result = await h.handlers.read(requestOf({ job_id: 'job-1', restaurant_id: '23' }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.plan.imageCount, 2);
  assert.equal(result.body.plan.sources.length, 1);
  const content = client.calls[0].body.messages[0].content;
  assert.equal(content.filter((block) => block.type === 'image').length, 2);
  assert.equal(h.saved.length, 1);
});
