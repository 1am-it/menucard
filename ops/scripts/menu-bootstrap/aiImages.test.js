'use strict';

// BE-71 (#176, R8) — regressies op het AI-script voor kaarten als afbeelding.
// Alles met een nep-client: er gaat geen enkel verzoek naar Anthropic, er wordt
// nooit om een echte sleutel gevraagd en er wordt niets in data/ geschreven.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ai = require('./ai-images');

const SECRET = 'sk-ant-test-000000000000000000000000';
const PAGE_URL = 'https://www.restaurantwolfslaar.com/menu';
const IMAGE_URL = 'https://www.restaurantwolfslaar.com/wp-content/uploads/2026/03/menukaart-lunch.jpg';

const REPORT = {
  restaurants: [
    { id: '1', name: 'Restaurant Wolfslaar', website: 'https://www.restaurantwolfslaar.com', status: 'skipped' },
    { id: '8', name: 'Al Dente Ristorante', website: 'https://www.aldentebreda.nl', status: 'skipped' },
  ],
};

const PAGE_HTML = `<html><head><title>Menukaart</title></head><body>
  <h1>Menukaart</h1>
  <img src="/wp-content/uploads/2026/03/menukaart-lunch.jpg" alt="menukaart lunch">
  <img src="/wp-content/uploads/2026/03/menukaart-diner.gif" alt="menukaart diner">
  <img src="/wp-content/uploads/2026/03/menukaart-diner.pdf" alt="menukaart diner pdf">
  <img src="/wp-content/uploads/2026/03/logo.png" alt="logo">
</body></html>`;

function restaurant(id = '1', name = 'Restaurant Wolfslaar') {
  return { id, name, website: 'https://www.restaurantwolfslaar.com', pageUrl: PAGE_URL };
}

function answerWith(count, { price = 1250 } = {}) {
  const items = [];
  for (let index = 1; index <= count; index += 1) {
    items.push({
      name: `Gerecht ${index}`,
      description: '',
      priceStatus: 'known',
      amountMinorUnits: price + index * 100,
      currency: 'EUR',
      priceText: `€ ${((price + index * 100) / 100).toFixed(2).replace('.', ',')}`,
      isFrom: false,
      allergens: { status: 'unknown', values: [] },
      evidence: { sourceId: '1', locator: 'afbeelding 1', quote: `Gerecht ${index}` },
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

function fakeAdapter({ answer = null, costEurCents = 2, failure = null, lastCost = undefined } = {}) {
  const adapter = {
    enabled: true,
    callCount: 0,
    lastCall: null,
    async call() {
      adapter.callCount += 1;
      const cost = lastCost === undefined ? costEurCents : lastCost;
      adapter.lastCall = { costEurCents: cost };
      if (failure) {
        const error = new Error(failure);
        error.code = 'provider_unavailable';
        error.callRecord = { costEurCents: cost };
        throw error;
      }
      return answer;
    },
  };
  return adapter;
}

const loadedImage = async (url) => ({
  ok: true,
  url,
  finalUrl: url,
  mediaType: 'image/jpeg',
  bytes: Buffer.from('fake-jpeg-bytes'),
});

const okPage = async (url) => ({ ok: true, url, finalUrl: url, text: PAGE_HTML });

test('--plan doet geen verzoek en vraagt niet om de sleutel', async () => {
  const lines = [];
  const result = await ai.runAiImages({
    restaurants: [restaurant()],
    planOnly: true,
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: () => {
      throw new Error('er is om een sleutel gevraagd');
    },
    createCall: () => {
      throw new Error('er is een AI-verzoek gedaan');
    },
    log: (line) => lines.push(line),
  });
  assert.equal(result.planOnly, true);
  assert.equal(result.calls, 0);
  assert.equal(result.outcomes.length, 0);
  assert.equal(result.plan.restaurants[0].images.length, 1, 'alleen de jpg/png/webp-kandidaat telt mee');
  assert.equal(result.plan.maxCostEurCents, 3);
  assert.match(lines.join('\n'), /zonder verzoek en zonder sleutel/);
});

test('de sleutel komt niet in de uitvoer, de logs of een foutmelding terecht', async () => {
  const written = [];
  const lines = [];
  const buffer = Buffer.from(SECRET);
  const result = await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => buffer,
    createCall: () => fakeAdapter({ failure: `invalid api key ${SECRET}` }),
    writeOutput: (record) => written.push(record),
    log: (line) => lines.push(line),
  });
  const everything = `${JSON.stringify(written)}\n${lines.join('\n')}\n${JSON.stringify(result.outcomes)}`;
  assert.equal(everything.includes(SECRET), false, 'de sleutel staat nergens');
  assert.equal(result.outcomes[0].status, 'failed');
  assert.match(result.outcomes[0].message, /\[verborgen\]/);
  assert.equal(result.outcomes[0].message.includes(SECRET), false);
  assert.equal(buffer.some((byte) => byte !== 0), false, 'de invoerbuffer is gewist');
  assert.equal(written.length, 0, 'een mislukte lezing schrijft geen uitvoer');
});

test('de kostengrens van € 1 stopt de run voordat een volgend verzoek te duur wordt', async () => {
  const adapter = fakeAdapter({ answer: answerWith(8), costEurCents: 60 });
  const result = await ai.runAiImages({
    restaurants: [restaurant('1', 'Een'), restaurant('8', 'Twee'), restaurant('11', 'Drie')],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: () => {},
    log: () => {},
  });
  assert.equal(adapter.callCount, 2, 'na twee verzoeken van 60 cent past een derde niet meer');
  assert.equal(result.spentEurCents, 120);
  assert.equal(result.stop, 'budget_ceiling');
  assert.equal(result.outcomes[2].status, 'skipped');
  assert.equal(result.outcomes[2].reason, 'budget_ceiling');
  assert.equal(ai.BUDGET_EUR_CENTS, 100);
});

test('er zijn geen herpogingen: één verzoek per restaurant, ook bij een fout', async () => {
  const adapter = fakeAdapter({ failure: 'verbinding verbroken' });
  const result = await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: () => {},
    log: () => {},
  });
  assert.equal(adapter.callCount, 1);
  assert.equal(result.calls, 1);
  assert.equal(result.outcomes[0].status, 'failed');
});

test('een onbekende prijs stopt de run in plaats van hem te herhalen', async () => {
  const adapter = fakeAdapter({ answer: answerWith(8), lastCost: null });
  const result = await ai.runAiImages({
    restaurants: [restaurant('1', 'Een'), restaurant('8', 'Twee')],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: () => {},
    log: () => {},
  });
  assert.equal(adapter.callCount, 1);
  assert.equal(result.stop, 'cost_unknown');
  assert.equal(result.outcomes[1].reason, 'cost_unknown');
  assert.equal(result.spentEurCents, 0, 'een onbekende prijs wordt nooit als nul geboekt');
});

test('de vorm van de uitvoer: gerechten met bron-afbeelding, model en kosten, en dezelfde eis als html', async () => {
  const written = [];
  const result = await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => fakeAdapter({ answer: answerWith(8), costEurCents: 2 }),
    writeOutput: (record) => written.push(record),
    log: () => {},
    model: 'claude-haiku-5-5',
    scraped: '2026-11-01',
  });
  assert.equal(result.outcomes[0].complete, true);
  assert.equal(written.length, 1);
  const record = written[0];
  assert.equal(record.restaurantId, '1');
  assert.equal(record.model, 'claude-haiku-5-5');
  assert.equal(record.scraped, '2026-11-01');
  assert.equal(record.writesData, false, 'het script schrijft nooit naar data/');
  assert.equal(record.budget.ceilingEurCents, 100);
  assert.equal(record.budget.spentEurCents, 2);
  assert.equal(record.dishes.length, 8);
  for (const dish of record.dishes) {
    assert.equal(dish.sourceImage, IMAGE_URL, 'elk gerecht wijst naar de afbeelding waar het op staat');
    assert.equal(dish.category, 'Lunch');
    assert.equal(typeof dish.price, 'number');
  }
  assert.equal(record.sourceImages.length, 1);
  assert.equal(record.assessment.ok, true);
});

test('R5: een toeslag blijft een toeslag in een afbeeldingslezing', () => {
  const answer = answerWith(1);
  answer.menus[0].categories[0].items[0].supplementOf = 'Gerecht 1';
  const reading = ai.toMenuReading(answer, { images: [{ number: 1, url: IMAGE_URL }] });
  assert.equal(reading.categories[0].items[0].priceIsSupplement, true);
  assert.equal(ai.flattenDishes(reading)[0].priceIsSupplement, true);
});

test('R1 en R3 gelden ook voor een afbeeldingslezing', async () => {
  const answer = answerWith(8);
  for (const item of answer.menus[0].categories[0].items) item.name = 'STEAK TARTARE';
  answer.menus[0].categories[0].name = 'Visgerechten indien voorradig:';
  const written = [];
  await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => fakeAdapter({ answer }),
    writeOutput: (record) => written.push(record),
    log: () => {},
  });
  assert.equal(written[0].reading.categories[0].name, 'Visgerechten indien voorradig');
  assert.equal(written[0].dishes[0].name, 'Steak tartare');
});

test('dezelfde eis: een lezing met minder dan acht gerechten wordt niet compleet', async () => {
  const written = [];
  await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => fakeAdapter({ answer: answerWith(2) }),
    writeOutput: (record) => written.push(record),
    log: () => {},
  });
  assert.equal(written[0].assessment.ok, false);
  assert.deepEqual(written[0].assessment.reasons.map((reason) => reason.code), ['too_few_dishes']);
});

test('alleen PNG, JPEG en WebP worden bekeken; een GIF of een pdf nooit', async () => {
  const plan = await ai.planImages({ restaurants: [restaurant()], loadPage: okPage, log: () => {} });
  assert.deepEqual(plan.restaurants[0].images.map((image) => image.mediaType), ['image/jpeg']);
  assert.equal(ai.ALLOWED_MEDIA_TYPES.includes('image/gif'), true);
  assert.equal(ai.ALLOWED_MEDIA_TYPES.includes('image/svg+xml'), false);
});

test('de vijf restaurants met een kaart als afbeelding komen uit het rapport, op de eigen host', () => {
  const report = {
    restaurants: [
      { id: '1', name: 'Restaurant Wolfslaar', website: 'https://www.restaurantwolfslaar.com' },
      { id: '8', name: 'Al Dente Ristorante', website: 'https://www.aldentebreda.nl' },
      { id: '11', name: 'De Beyerd', website: 'https://www.beyerd.nl' },
      { id: '20', name: 'Klein Java', website: 'https://www.klein-java.nl' },
      { id: '23', name: 'T-Huis', website: 'https://t-huis.online' },
    ],
  };
  const { restaurants, skipped } = ai.imageRestaurantsFromReport(report);
  assert.deepEqual(restaurants.map((entry) => entry.id), ['1', '8', '11', '20', '23']);
  assert.equal(restaurants[0].pageUrl, 'https://www.restaurantwolfslaar.com/menu');
  assert.equal(restaurants[4].pageUrl, 'https://t-huis.online/menu/');
  assert.equal(skipped.length, 0);
  const partial = ai.imageRestaurantsFromReport(REPORT);
  assert.deepEqual(partial.restaurants.map((entry) => entry.id), ['1', '8']);
  assert.deepEqual(partial.skipped.map((entry) => entry.id), ['11', '20', '23']);
});

test('de sleutel komt niet uit de omgeving of een argument en gaat niet naar een child-proces', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ai-images.js'), 'utf8');
  assert.equal(/process\.env/.test(source), false, 'geen omgevingsvariabele voor de sleutel');
  assert.equal(/require\(['"]node:child_process|require\(['"]child_process/.test(source), false);
  assert.equal(/\bexecSync\b|\bspawnSync\b|\bspawn\(/.test(source), false);
  assert.equal(/ANTHROPIC_API_KEY\s*=/.test(source), false, 'de sleutel wordt niet uit een variabele gezet');
  assert.match(source, /setRawMode\(true\)/, 'de invoer wordt verborgen gelezen');
});

// EINDE-TESTS
