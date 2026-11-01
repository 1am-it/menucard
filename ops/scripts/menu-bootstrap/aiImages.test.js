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

// ---------------------------------------------------------------------------
// Ronde 6 (Lead-review 6557509881): punten 1, 2 en 3.
// ---------------------------------------------------------------------------

function menuPageHtml(count, { prefix = 'menukaart', alt = 'menukaart' } = {}) {
  const images = Array.from(
    { length: count },
    (_, index) => `<img src="/wp-content/uploads/2026/03/${prefix}-${index + 1}.jpg" alt="${alt} ${index + 1}">`,
  ).join('\n');
  return `<html><head><title>Menukaart</title></head><body>\n${images}\n</body></html>`;
}

const okPageWith = (html) => async (url) => ({ ok: true, url, finalUrl: url, text: html });

function answerWithItems(items, { category = 'Lunch', title = 'Menukaart' } = {}) {
  return {
    menus: [
      {
        title,
        sourceId: '1',
        variant: null,
        order: null,
        categories: [
          {
            name: category,
            path: [],
            uncertain: false,
            items: items.map((entry, index) => ({
              name: entry.name,
              description: '',
              priceStatus: 'known',
              amountMinorUnits: entry.price,
              currency: 'EUR',
              priceText: `€ ${(entry.price / 100).toFixed(2).replace('.', ',')}`,
              isFrom: false,
              allergens: { status: 'unknown', values: [] },
              evidence: { sourceId: '1', locator: entry.locator || `afbeelding ${index + 1}`, quote: entry.name },
            })),
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, unreadSources: [], limitations: [] },
  };
}

test('punt 1: alleen een menuwoord in de naam, de alt of het bijschrift is een kaart', () => {
  const pageUrl = 'https://www.restaurantwolfslaar.com/menu';
  const html = [
    // De echte gevallen uit de cache van de eigenaar: portretten en sfeerfoto's.
    '<img src="/assets/files/Afbeeldingen/Portretten/DSC05737.jpg" alt="DSC05737">',
    '<img src="/assets/files/Afbeeldingen/Nieuwe-foto-indeling/Portretten/Studio-1412---Wolfslaar-Maarten-Camps-261023-1.jpg" alt="Studio 1412 Wolfslaar">',
    '<img src="/assets/thumbs/640-1000-fit/Afbeeldingen/Nieuwe-foto-indeling/Food-fotografie/2026/Studio1412-RestaurantWolfslaarsfeer.jpg" alt="">',
    '<img src="/assets/files/Logos/16_POINTS_GM_BLACK.png" alt="">',
    // De echte kaart.
    '<img src="/wp-content/uploads/2026/08/Menukaart0826a.jpg" alt="">',
    // Een kaart die alleen in de alt-tekst een menuwoord heeft (Klein Java).
    '<img src="/_astro/smart_PeDwL.png" alt="Indonesiche-Gerechten-afhalen-bestellen">',
  ].join('\n');
  const { images, dropped } = ai.collectStrictMenuImages({ html, pageUrl });
  assert.deepEqual(images.map((image) => image.url), [
    'https://www.restaurantwolfslaar.com/wp-content/uploads/2026/08/Menukaart0826a.jpg',
    'https://www.restaurantwolfslaar.com/_astro/smart_PeDwL.png',
  ]);
  assert.deepEqual(images.map((image) => image.number), [1, 2], "de nummering volgt de kaarten, niet de foto's");
  // De twee sfeerfoto's vallen al af bij de bestaande lezer; de twee portretten
  // vallen hier af, met hun reden.
  assert.equal(dropped.length, 2);
  for (const entry of dropped) assert.equal(entry.reason, 'never_a_menu');
  assert.equal(ai.isStrictMenuImage({ url: 'https://voorbeeld.nl/DSC05294-scaled.jpg', alt: 'dsc05294' }), false);
  assert.equal(ai.isStrictMenuImage({ url: 'https://voorbeeld.nl/portret.jpg', alt: 'Menukaart' }), false);
  assert.equal(ai.isStrictMenuImage({ url: 'https://voorbeeld.nl/lunch.jpg' }), true);
  assert.equal(ai.isStrictMenuImage({ url: 'https://voorbeeld.nl/foto.jpg', caption: 'Bekijk de menukaart' }), true);
});

test('punt 1: zonder kaart op de pagina volgt hooguit één extra ophaalstap op dezelfde site', async () => {
  const pageUrl = 'https://www.restaurantwolfslaar.com/menu';
  const first = `<html><head><title>Menu</title></head><body>
    <img src="/assets/files/Afbeeldingen/Portretten/DSC05737.jpg" alt="DSC05737">
    <a href="/nl/menu-lunch">Menukaart lunch</a>
    <a href="/nl/menu-diner">Menukaart diner</a>
    <a href="https://andere-site.nl/menu">Menukaart elders</a>
  </body></html>`;
  const second = menuPageHtml(2, { prefix: 'Lunchkaart-2026', alt: 'lunchkaart' });
  const loaded = [];
  const plan = await ai.planImages({
    restaurants: [{ id: '1', name: 'Restaurant Wolfslaar', website: 'https://www.restaurantwolfslaar.com', pageUrl }],
    loadPage: async (url) => {
      loaded.push(url);
      return { ok: true, url, finalUrl: url, text: url === pageUrl ? first : second };
    },
    log: () => {},
  });
  assert.deepEqual(loaded, [pageUrl, 'https://www.restaurantwolfslaar.com/nl/menu-lunch'], 'precies één extra stap, op dezelfde host');
  const record = plan.restaurants[0];
  assert.equal(record.status, 'planned');
  assert.equal(record.images.length, 2);
  assert.equal(record.imageSearch.found, 1, 'de portretfoto is gevonden en afgekeurd');
  assert.equal(record.imageSearch.dropped[0].reason, 'never_a_menu');
  assert.equal(record.imageSearch.extraStep.url, 'https://www.restaurantwolfslaar.com/nl/menu-lunch');
  assert.equal(record.imageSearch.extraStep.images, 2);
  assert.equal(record.pageUrl, 'https://www.restaurantwolfslaar.com/nl/menu-lunch', 'de bron is de pagina met de kaart');
});

test('punt 1: een kaart die alleen als svg bestaat wordt overgeslagen met die reden', async () => {
  const pageUrl = 'https://t-huis.online/menu/';
  const html = `<html><head><title>Menu</title></head><body>
    <img src="https://t-huis.online/wp-content/uploads/2025/12/DSC05294-scaled.jpg" alt="dsc05294">
    <img src="https://t-huis.online/wp-content/uploads/2026/09/THS-Diner_Herfst-2026.2_DIGI.svg" alt="ths diner herfst 2026 digi">
    <img src="https://t-huis.online/wp-content/uploads/2026/09/THS-Lunch_Herfst-2026.2_DIGI.svg" alt="ths lunch herfst 2026 digi">
  </body></html>`;
  const plan = await ai.planImages({
    restaurants: [{ id: '23', name: 'T-Huis', website: 'https://t-huis.online', pageUrl }],
    loadPage: async (url) => ({ ok: true, url, finalUrl: url, text: html }),
    log: () => {},
  });
  const record = plan.restaurants[0];
  assert.equal(record.images.length, 0, 'een svg gaat niet naar de AI');
  assert.equal(record.status, 'skipped');
  assert.equal(record.reason, 'menu_is_svg');
  assert.deepEqual(record.imageSearch.svgMenus, [
    'https://t-huis.online/wp-content/uploads/2026/09/THS-Diner_Herfst-2026.2_DIGI.svg',
    'https://t-huis.online/wp-content/uploads/2026/09/THS-Lunch_Herfst-2026.2_DIGI.svg',
  ]);
  assert.equal(plan.maxCostEurCents, 0);
});

test('punt 1: een kaart-pdf wordt als vondst vastgelegd, niet gefetcht', async () => {
  const pageUrl = 'https://voorbeeld.nl/menu';
  const html = `<html><head><title>Menu</title></head><body>
    <a href="https://voorbeeld.nl/wp-content/uploads/2026/03/menukaart.pdf">Menukaart (pdf)</a>
  </body></html>`;
  const loaded = [];
  const plan = await ai.planImages({
    restaurants: [{ id: '9', name: 'Voorbeeld', website: 'https://voorbeeld.nl', pageUrl }],
    loadPage: async (url) => {
      loaded.push(url);
      return { ok: true, url, finalUrl: url, text: html };
    },
    log: () => {},
  });
  assert.deepEqual(loaded, [pageUrl], 'een pdf wordt niet als pagina opgehaald');
  assert.equal(plan.restaurants[0].reason, 'menu_is_pdf');
  assert.equal(plan.restaurants[0].imageSearch.pdfMenu, 'https://voorbeeld.nl/wp-content/uploads/2026/03/menukaart.pdf');
});

test('punt 2: meer dan drie afbeeldingen worden in groepen van drie gelezen en samengevoegd', async () => {
  const pageUrl = 'https://www.aldentebreda.nl/menukaart-restaurant-2/';
  const html = menuPageHtml(7);
  const inputs = [];
  const answers = [
    answerWithItems([{ name: 'Soep', price: 650 }, { name: 'Bruschetta', price: 750 }, { name: 'Carpaccio', price: 1150 }]),
    answerWithItems(
      [{ name: 'Pizza Margherita', price: 1050 }, { name: 'Pizza Diavola', price: 1250 }, { name: 'Lasagne', price: 1350 }],
      { category: 'Pizza' },
    ),
    answerWithItems([{ name: 'Tiramisu', price: 750 }], { category: 'Dolci' }),
  ];
  const written = [];
  const adapter = {
    enabled: true,
    lastCall: null,
    callCount: 0,
    async call(input) {
      inputs.push(input);
      adapter.callCount += 1;
      adapter.lastCall = { costEurCents: 2 };
      return answers[adapter.callCount - 1];
    },
  };
  const result = await ai.runAiImages({
    restaurants: [{ id: '8', name: 'Al Dente Ristorante', website: 'https://www.aldentebreda.nl', pageUrl }],
    loadPage: okPageWith(html),
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: () => {},
  });
  assert.equal(adapter.callCount, 3, 'zeven afbeeldingen zijn drie verzoeken');
  assert.deepEqual(inputs.map((input) => input.sources[0].images.length), [3, 3, 1]);
  assert.deepEqual(inputs.map((input) => input.sources[0].images.map((image) => image.number)), [[1, 2, 3], [1, 2, 3], [1]]);
  assert.equal(ai.IMAGE_CHUNK_SIZE, 3);
  const record = written[0];
  assert.equal(record.chunks.length, 3);
  assert.equal(record.budget.spentEurCents, 6, 'elk verzoek wordt met zijn eigen kosten geboekt');
  assert.equal(record.dishes.length, 7);
  assert.deepEqual(record.reading.categories.map((category) => category.name), ['Lunch', 'Pizza', 'Dolci']);
  // De bron-afbeelding per gerecht blijft de afbeelding uit de pagina-orde.
  assert.equal(record.dishes[3].sourceImage, 'https://www.aldentebreda.nl/wp-content/uploads/2026/03/menukaart-4.jpg');
  assert.equal(record.dishes[6].sourceImage, 'https://www.aldentebreda.nl/wp-content/uploads/2026/03/menukaart-7.jpg');
  assert.equal(result.calls, 3);
  assert.equal(result.outcomes[0].attempts, 3);
});

test('punt 2: de kostengrens geldt per verzoek, zonder herpoging', async () => {
  const pageUrl = 'https://www.aldentebreda.nl/menukaart-restaurant-2/';
  const adapter = fakeAdapter({ answer: answerWith(3), costEurCents: 50 });
  const written = [];
  const result = await ai.runAiImages({
    restaurants: [{ id: '8', name: 'Al Dente Ristorante', website: 'https://www.aldentebreda.nl', pageUrl }],
    loadPage: okPageWith(menuPageHtml(7)),
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: () => {},
  });
  assert.equal(adapter.callCount, 2, 'na twee verzoeken van 50 cent past een derde reservering niet meer');
  assert.equal(result.stop, 'budget_ceiling');
  assert.equal(result.outcomes[0].status, 'failed');
  assert.equal(result.outcomes[0].reason, 'budget_ceiling');
  assert.equal(written.length, 0, 'een onaffe kaart wordt niet geschreven');
});

test('punt 3: de extra instructie gaat mee en het vastgepinde protocol blijft ongewijzigd', async () => {
  const pinned = '# MENU-EXTRACTION\nStatus: CONCEPT v1.0\n\nLees de kaart.\n';
  const inputs = [];
  const adapter = fakeAdapter({ answer: answerWith(8) });
  const original = adapter.call;
  adapter.call = async (input) => {
    inputs.push(input);
    return original(input);
  };
  const written = [];
  await ai.runAiImages({
    restaurants: [restaurant()],
    loadPage: okPage,
    loadImage: loadedImage,
    promptKey: async () => Buffer.from(SECRET),
    createCall: () => adapter,
    writeOutput: (record) => written.push(record),
    log: () => {},
    protocol: pinned,
  });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].protocol.startsWith(pinned), true, 'het protocol staat er letterlijk en vooraan');
  assert.equal(inputs[0].protocol.includes(ai.AI_READ_INSTRUCTIONS), true, 'de instructie gaat mee in hetzelfde verzoek');
  assert.match(ai.AI_READ_INSTRUCTIONS, /letterlijk over/i);
  assert.match(ai.AI_READ_INSTRUCTIONS, /tussenkop/i);
  assert.match(ai.AI_READ_INSTRUCTIONS, /Voeg niets toe/i);
  // Het vastgepinde bestand zelf is niet veranderd.
  const protocolFile = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'MENU-EXTRACTION.md'), 'utf8');
  assert.equal(protocolFile.includes('Aanvulling voor deze startvulling'), false);
  // De uitvoer draagt de vlag en de bron-afbeelding per gerecht.
  assert.equal(written[0].aiRead, true);
  assert.equal(written[0].instruction.appended, true);
  for (const dish of written[0].dishes) assert.equal(dish.sourceImage, IMAGE_URL);
});

// EINDE-TESTS
