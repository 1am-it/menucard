'use strict';

// BE-71 (#176, R12 en de opdracht van ronde 8) — regressies op `--all`: alle
// overgebleven Bredase kaarten als tekst-, pdf- of afbeeldingsbron. Alles met
// nep-loaders en een nep-client: geen netwerk, nooit een echte sleutel en nooit
// een schrijfactie naar data/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ai = require('./ai-images');

const SECRET = 'sk-ant-test-111111111111111111111111';

const REPORT = {
  restaurants: [
    {
      id: '1',
      name: 'Restaurant Wolfslaar',
      website: 'https://www.restaurantwolfslaar.com',
      status: 'skipped',
      kind: 'html',
      menuUrl: 'https://www.restaurantwolfslaar.com/menu',
    },
    {
      id: '3',
      name: 'Con Fuego',
      website: 'https://www.restaurantconfuego.com',
      status: 'skipped',
      kind: 'html',
      menuUrl: 'https://www.restaurantconfuego.com/',
    },
    {
      id: '4',
      name: 'Restaurant Uijttewaal',
      website: 'https://www.restaurantuijttewaal.nl',
      status: 'skipped',
      kind: 'pdf',
      menuUrl: 'https://www.restaurantuijttewaal.nl/menukaart.pdf',
      pageCount: 2,
    },
    {
      id: '7',
      name: 'Restaurant Ruitersbosch',
      website: 'https://www.restaurantruitersbosch.nl',
      status: 'blocked',
      kind: null,
      menuUrl: null,
      reasons: [
        {
          code: 'robots',
          text: 'robots.txt van deze site was niet bereikbaar — de pagina is niet opgehaald.',
          detail: 'unreachable (request-error)',
        },
      ],
    },
    {
      id: '9',
      name: 'Beers & Barrels',
      website: 'https://www.beersbarrels.nl',
      status: 'skipped',
      kind: 'html',
      menuUrl: 'https://static.rce.eu/breda/menukaart.pdf',
    },
    {
      id: '11',
      name: 'De Beyerd',
      website: 'https://www.beyerd.nl',
      status: 'skipped',
      kind: 'html',
      menuUrl: 'https://www.beyerd.nl/cafe-lunchkaart/',
    },
  ],
};

const MENUS = { '1-lunch': { source: 'https://www.restaurantwolfslaar.com/menu' } };

// Een pagina met een echte kaart als tekst: de scripts en de stijl mogen nooit
// in de tekstbron belanden.
const TEXT_PAGE = `<html><head><title>Menukaart</title>
  <script>var geheim = 'script-tekst';</script>
  <style>.kaart { color: red; }</style></head>
  <body><nav>Home Contact</nav>
  <h1>Menukaart</h1>
  <p>Soep van de dag € 6,50</p>
  <p>Bruschetta € 7,50</p>
  <p>Carpaccio € 11,50</p>
  <p>Lasagne € 13,50</p>
  </body></html>`;

// Een pagina die zijn kaart pas met JavaScript toont: alleen navigatie.
const JS_ONLY_PAGE = `<html><head><script>var app = 1;</script></head>
  <body><nav>Home Menukaart Contact Reserveren</nav><div id="app"></div></body></html>`;

const loadedDocument = (bytes = Buffer.from('%PDF-1.4 nep-document')) => async (url) => ({
  ok: true,
  url,
  finalUrl: url,
  contentType: 'application/pdf',
  bytes,
});

const okPageWith = (html) => async (url) => ({ ok: true, url, finalUrl: url, text: html });

function answerWith(count) {
  const items = [];
  for (let index = 1; index <= count; index += 1) {
    const amount = 1000 + index * 50;
    items.push({
      name: `Gerecht ${index}`,
      description: '',
      priceStatus: 'known',
      amountMinorUnits: amount,
      currency: 'EUR',
      priceText: `€ ${(amount / 100).toFixed(2).replace('.', ',')}`,
      isFrom: false,
      allergens: { status: 'unknown', values: [] },
      evidence: { sourceId: '1', locator: `pagina ${index}`, quote: `Gerecht ${index}` },
    });
  }
  return {
    menus: [
      {
        title: 'Menukaart',
        sourceId: '1',
        variant: null,
        order: null,
        categories: [{ name: 'Lunch', path: [], uncertain: false, items }],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, unreadSources: [], limitations: [] },
  };
}

function fakeAdapter({ costEurCents = 2, answer = null } = {}) {
  const adapter = {
    enabled: true,
    callCount: 0,
    inputs: [],
    lastCall: null,
    async call(input) {
      adapter.callCount += 1;
      adapter.inputs.push(input);
      adapter.lastCall = { costEurCents };
      return answer || answerWith(8);
    },
  };
  return adapter;
}

function selection(options = {}) {
  return ai.allSourceRestaurants({
    report: REPORT,
    menus: MENUS,
    correctionsDir: 'lead-corrections',
    existsSync: (file) => String(file).endsWith(`${path.sep}11.json`),
    ...options,
  });
}

test('--all kiest alleen de overgebleven kaarten en noemt elke reden', () => {
  const { restaurants, skipped } = selection();
  assert.deepEqual(restaurants.map((restaurant) => restaurant.id), ['3', '4']);
  assert.deepEqual(
    skipped.map((entry) => [entry.id, entry.reason]),
    [
      ['1', 'already_has_menu'],
      ['7', 'site_unreachable'],
      ['9', 'other_host'],
      ['11', 'lead_correction'],
    ],
  );
  // De soort en de url komen uit het rapport.
  assert.equal(restaurants[0].reportKind, 'html');
  assert.equal(restaurants[0].pageUrl, 'https://www.restaurantconfuego.com/');
  assert.equal(restaurants[1].reportKind, 'pdf');
  assert.equal(restaurants[1].reportPageCount, 2);
  assert.equal(ai.hasMenuFor('1', MENUS), true);
  assert.equal(ai.hasMenuFor('3', MENUS), false);
});

test('--plan --all toont per restaurant de bron, de soort en het maximum', async () => {
  const { restaurants } = selection();
  const lines = [];
  const plan = await ai.planAllSources({
    restaurants,
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ pageCount: 2, categories: [] }),
    log: (line) => lines.push(line),
  });

  const text = plan.restaurants.find((record) => record.id === '3');
  assert.equal(text.sourceKind, 'text');
  assert.equal(text.status, 'planned');
  assert.match(text.sourceText, /Bruschetta € 7,50/);
  assert.equal(text.sourceText.includes('script-tekst'), false, 'scripts gaan nooit mee als tekstbron');
  assert.equal(text.sourceText.includes('color: red'), false, 'stijl gaat nooit mee als tekstbron');
  assert.ok(text.priceLines >= 3);

  const pdf = plan.restaurants.find((record) => record.id === '4');
  assert.equal(pdf.sourceKind, 'pdf');
  assert.equal(pdf.pageCount, 2);
  assert.equal(pdf.sourceUrl, 'https://www.restaurantuijttewaal.nl/menukaart.pdf');

  // Tekst: 1 pagina → maximaal 3 cent. Pdf: 2 pagina's → maximaal 6 cent.
  assert.equal(text.estimate.maxEurCents, 3);
  assert.equal(pdf.estimate.maxEurCents, 6);
  assert.equal(plan.maxCostEurCents, 9);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /3 Con Fuego: text .*maximaal 3 cent/);
  assert.match(lines[1], /4 Restaurant Uijttewaal: pdf .*maximaal 6 cent/);
});

test('--all slaat een pagina die pas met JavaScript zijn kaart toont over', async () => {
  const { restaurants } = selection();
  const plan = await ai.planAllSources({
    restaurants: restaurants.filter((restaurant) => restaurant.id === '3'),
    loadPage: okPageWith(JS_ONLY_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ pageCount: 2 }),
    log: () => {},
  });
  const record = plan.restaurants[0];
  assert.equal(record.status, 'skipped');
  assert.equal(record.reason, 'javascript_only');
  assert.equal(record.sourceKind, null);
  assert.equal(plan.maxCostEurCents, 0);

  // Een overgeslagen restaurant kost geen enkel verzoek.
  const adapter = fakeAdapter();
  const result = await ai.runAiImages({
    restaurants: [restaurants.find((restaurant) => restaurant.id === '3')],
    plan,
    loadPage: okPageWith(JS_ONLY_PAGE),
    loadImage: async () => ({ ok: false, reason: 'not_read' }),
    loadDocument: loadedDocument(),
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: () => {},
    log: () => {},
  });
  assert.equal(adapter.callCount, 0);
  assert.equal(result.outcomes[0].status, 'skipped');
  assert.equal(result.outcomes[0].reason, 'javascript_only');
});

test('--all leest een tekstbron als tekst en schrijft alleen naar .local', async () => {
  const { restaurants } = selection();
  const plan = await ai.planAllSources({
    restaurants: restaurants.filter((restaurant) => restaurant.id === '3'),
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ pageCount: 2 }),
    log: () => {},
  });
  const adapter = fakeAdapter();
  const written = [];
  const logged = [];
  const result = await ai.runAiImages({
    restaurants: [restaurants.find((restaurant) => restaurant.id === '3')],
    plan,
    loadPage: okPageWith(TEXT_PAGE),
    loadImage: async () => ({ ok: false, reason: 'not_read' }),
    loadDocument: loadedDocument(),
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: (line) => logged.push(line),
    protocol: '# MENU-EXTRACTION\n',
    scraped: '2026-11-01',
  });

  assert.equal(adapter.callCount, 1, 'een tekstbron is één verzoek');
  const source = adapter.inputs[0].sources[0];
  assert.equal(source.kind, 'html');
  assert.equal(source.text, plan.restaurants[0].sourceText);
  assert.equal(result.outcomes[0].sourceKind, 'text');

  const record = written[0];
  assert.equal(record.sourceKind, 'text');
  assert.equal(record.sourceUrl, 'https://www.restaurantconfuego.com/');
  assert.equal(record.writesData, false, 'het script schrijft nooit naar data/');
  assert.equal(record.chunks[0].kind, 'text');
  assert.equal(record.dishes.length, 8);
  // De sleutel komt nergens in de uitvoer of de log terecht.
  assert.equal(JSON.stringify(record).includes(SECRET), false);
  assert.equal(logged.join('\n').includes(SECRET), false);
});

test('--all leest een pdf met tekstlaag via de bestaande documentbron', async () => {
  const { restaurants } = selection();
  const bytes = Buffer.from('%PDF-1.4 nep-document');
  const plan = await ai.planAllSources({
    restaurants: restaurants.filter((restaurant) => restaurant.id === '4'),
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(bytes),
    inspectPdf: async () => ({ pageCount: 2, categories: [] }),
    log: () => {},
  });
  assert.equal(plan.restaurants[0].sourceKind, 'pdf');

  const adapter = fakeAdapter();
  const written = [];
  const result = await ai.runAiImages({
    restaurants: [restaurants.find((restaurant) => restaurant.id === '4')],
    plan,
    loadPage: okPageWith(TEXT_PAGE),
    loadImage: async () => ({ ok: false, reason: 'not_read' }),
    loadDocument: loadedDocument(bytes),
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: () => {},
    protocol: '# MENU-EXTRACTION\n',
    scraped: '2026-11-01',
  });

  assert.equal(adapter.callCount, 1);
  const source = adapter.inputs[0].sources[0];
  assert.equal(source.kind, 'pdf');
  assert.equal(source.pageCount, 2);
  assert.equal(source.documentBase64, bytes.toString('base64'));
  assert.equal(result.outcomes[0].sourceKind, 'pdf');
  assert.equal(written[0].sourceKind, 'pdf');
  assert.equal(written[0].chunks[0].kind, 'pdf');
  assert.equal(written[0].writesData, false);
  assert.equal(JSON.stringify(written[0]).includes(SECRET), false);
});

test('--all zonder tekstlaag slaat de pdf met een reden over', async () => {
  const { restaurants } = selection();
  const plan = await ai.planAllSources({
    restaurants: restaurants.filter((restaurant) => restaurant.id === '4'),
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ refusal: { status: 'unparsed', reason: 'no_text_layer' }, pageCount: 2 }),
    log: () => {},
  });
  assert.equal(plan.restaurants[0].status, 'skipped');
  assert.equal(plan.restaurants[0].reason, 'pdf_without_text_layer');
  assert.equal(plan.maxCostEurCents, 0);
});

test('--all houdt de harde kostengrens van de hele run aan', async () => {
  const restaurants = ['20', '21', '22'].map((id) => ({
    id,
    name: `Restaurant ${id}`,
    website: 'https://voorbeeld.nl',
    pageUrl: 'https://voorbeeld.nl/menukaart/',
    reportKind: 'html',
    reportPageCount: null,
  }));
  const plan = await ai.planAllSources({
    restaurants,
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ pageCount: 2 }),
    log: () => {},
  });
  assert.equal(plan.maxCostEurCents, 9, 'drie tekstbronnen van 3 cent');

  const adapter = fakeAdapter({ costEurCents: 50 });
  const written = [];
  const result = await ai.runAiImages({
    restaurants,
    plan,
    loadPage: okPageWith(TEXT_PAGE),
    loadImage: async () => ({ ok: false, reason: 'not_read' }),
    loadDocument: loadedDocument(),
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: () => {},
    protocol: '# MENU-EXTRACTION\n',
    scraped: '2026-11-01',
  });

  assert.equal(adapter.callCount, 2, 'na twee verzoeken van 50 cent past een derde reservering niet meer');
  assert.equal(result.stop, 'budget_ceiling');
  assert.equal(result.spentEurCents, 100);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.status), ['read', 'read', 'skipped']);
  assert.equal(result.outcomes[2].reason, 'budget_ceiling');
  assert.equal(written.length, 2);
  assert.equal(JSON.stringify(written).includes(SECRET), false);
});

test('--all vraagt in een plan niet om de sleutel en doet geen verzoek', async () => {
  const { restaurants } = selection();
  let askedForKey = false;
  const plan = await ai.planAllSources({
    restaurants,
    loadPage: okPageWith(TEXT_PAGE),
    loadDocument: loadedDocument(),
    inspectPdf: async () => ({ pageCount: 2 }),
    log: () => {},
  });
  const result = await ai.runAiImages({
    restaurants,
    planOnly: true,
    plan,
    loadPage: okPageWith(TEXT_PAGE),
    loadImage: async () => ({ ok: false, reason: 'not_read' }),
    loadDocument: loadedDocument(),
    promptKey: async () => {
      askedForKey = true;
      return Buffer.from(SECRET);
    },
    createCall: () => {
      throw new Error('een plan doet geen verzoek');
    },
    writeOutput: () => {
      throw new Error('een plan schrijft niets');
    },
    log: () => {},
  });
  assert.equal(askedForKey, false);
  assert.equal(result.planOnly, true);
  assert.equal(result.calls, 0);
  assert.deepEqual(ai.parseArgs(['--plan', '--all']), { plan: true, all: true, only: null, help: false });
});

test('--all bevat geen AI-module, geen omgeving en geen data-schrijfactie', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ai-images.js'), 'utf8');
  assert.equal(/@anthropic-ai\/sdk/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/writeFileSync\([^)]*data[/\\]menus\.json/.test(source), false);
  assert.match(source, /MENUS_FILE = path\.join\('data', 'menus\.json'\)/, 'data/menus.json wordt alleen gelezen');
});
