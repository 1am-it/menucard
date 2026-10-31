'use strict';

// BE-71 (#176, besluit 021 §4) — regressions for the startvulling engine.
// No network and no model: every fixture is stored (html, a committed pdf) or a
// fake fetch, and the AI-free guarantee is checked against require.cache.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readHtmlMenu, readPdfMenu, parsePrintedPrice } = require('./readMenuSource');
const { assessCompleteMenu, MIN_DISHES } = require('./completeMenu');
const { buildEntry } = require('./menuEntry');
const { createSourceFetcher, USER_AGENT } = require('./fetchSource');
const { bootstrapRestaurant } = require('./engine');
const { buildReport, renderMarkdown } = require('./report');

const FIXTURES = path.join(__dirname, '__fixtures__');
const COMPLETE_HTML = fs.readFileSync(path.join(FIXTURES, 'complete-menu.html'), 'utf8');
const INCOMPLETE_HTML = fs.readFileSync(path.join(FIXTURES, 'incomplete-menu.html'), 'utf8');
// A committed, real digital PDF that is not a menu card: it must be read and
// refused, never turned into dishes.
const NOT_A_MENU_PDF = path.join(__dirname, '..', '..', '..', 'docs', 'mockups', 'be-25-batch-analysis-handoff-v2.pdf');

function syntheticMenu(items, { category = 'Hoofdgerechten', uncertain = false, attention = [] } = {}) {
  return { kind: 'html', title: null, categories: [{ name: category, path: [category], uncertain, items }], attention };
}

function dish(name, price) {
  return { name, desc: '', price };
}

test('de volledigheidseis: een complete kaart met prijs en categorie per gerecht slaagt', () => {
  const menu = readHtmlMenu(COMPLETE_HTML);
  const assessment = assessCompleteMenu(menu);
  assert.equal(assessment.ok, true);
  assert.deepEqual(assessment.reasons, []);
  assert.equal(assessment.dishCount, 12);
  assert.equal(assessment.pricedCount, 12);
  assert.equal(assessment.categoryCount, 3);
});

test('de volledigheidseis: minder dan acht gerechten wordt overgeslagen met de reden', () => {
  const menu = readHtmlMenu(INCOMPLETE_HTML);
  const assessment = assessCompleteMenu(menu);
  assert.equal(assessment.ok, false);
  assert.deepEqual(assessment.reasons.map((reason) => reason.code), ['too_few_dishes']);
  assert.match(assessment.reasons[0].text, new RegExp(String(MIN_DISHES)));
});

test('de volledigheidseis: een gerecht zonder prijs of zonder categorie blokkeert de kaart', () => {
  const eight = Array.from({ length: 8 }, (_, index) => dish(`Gerecht ${index + 1}`, 12.5));
  const unpriced = syntheticMenu([...eight.slice(1), dish('Soep van de dag', null)]);
  assert.deepEqual(assessCompleteMenu(unpriced).reasons.map((reason) => reason.code), ['unpriced_dishes']);

  const uncategorised = { kind: 'html', title: null, categories: [{ name: '', path: [], items: eight }], attention: [] };
  const codes = assessCompleteMenu(uncategorised).reasons.map((reason) => reason.code);
  assert.ok(codes.includes('uncategorised_dishes'), codes.join(','));
});

test('de volledigheidseis: een open aandachtspunt of een dubbel gerecht blokkeert de kaart', () => {
  const eight = Array.from({ length: 8 }, (_, index) => dish(`Gerecht ${index + 1}`, 12.5));
  const uncertain = syntheticMenu(eight, { uncertain: true });
  assert.deepEqual(assessCompleteMenu(uncertain).reasons.map((reason) => reason.code), ['uncertain_sections']);

  const withAttention = syntheticMenu(eight, { attention: [{ code: 'excluded_sections', detail: '1 sectie' }] });
  assert.deepEqual(assessCompleteMenu(withAttention).reasons.map((reason) => reason.code), ['excluded_sections']);

  const duplicated = syntheticMenu([...eight, dish('Gerecht 1', 13.5)]);
  assert.deepEqual(assessCompleteMenu(duplicated).reasons.map((reason) => reason.code), ['duplicate_dishes']);
});

test('de prijsgrenzen: alleen € 1 tot en met € 150 is geldig', () => {
  const atBounds = syntheticMenu(Array.from({ length: 8 }, (_, index) => dish(`Gerecht ${index + 1}`, index === 0 ? 1 : 150)));
  assert.equal(assessCompleteMenu(atBounds).ok, true);

  const tooCheap = syntheticMenu(Array.from({ length: 8 }, (_, index) => dish(`Gerecht ${index + 1}`, index === 0 ? 0.5 : 12)));
  assert.deepEqual(assessCompleteMenu(tooCheap).reasons.map((reason) => reason.code), ['price_out_of_bounds']);

  const tooExpensive = syntheticMenu(Array.from({ length: 8 }, (_, index) => dish(`Gerecht ${index + 1}`, index === 0 ? 150.5 : 12)));
  assert.deepEqual(assessCompleteMenu(tooExpensive).reasons.map((reason) => reason.code), ['price_out_of_bounds']);
});

test('een geprinte prijs wordt als bedrag gelezen, in elke notatie die de lezers tegenkomen', () => {
  assert.equal(parsePrintedPrice('12,50'), 12.5);
  assert.equal(parsePrintedPrice('12.50'), 12.5);
  assert.equal(parsePrintedPrice('€ 12,50'), 12.5);
  assert.equal(parsePrintedPrice('12,-'), 12);
  assert.equal(parsePrintedPrice(null), null);
});


test('de vorm van de uitvoer: dezelfde vorm als de bestaande kaarten, met bron, datum en notes', () => {
  const menu = readHtmlMenu(COMPLETE_HTML);
  const entry = buildEntry({
    restaurantId: '99',
    menu,
    menus: {},
    sourceUrl: 'https://voorbeeld.nl/menukaart',
    scraped: '2026-11-01',
  });
  assert.deepEqual(Object.keys(entry), ['subtitle', 'scraped', 'source', 'notes', 'categories']);
  assert.equal(entry.subtitle, 'Menukaart');
  assert.equal(entry.scraped, '2026-11-01');
  assert.equal(entry.source, 'https://voorbeeld.nl/menukaart');
  assert.equal(entry.notes, 'Opgehaald van de eigen website van het restaurant. Controleer altijd de actuele kaart.');
  assert.deepEqual(entry.categories.map((category) => category.name), ['Voorgerechten', 'Hoofdgerechten', 'Nagerechten']);
  const first = entry.categories[0].items[0];
  assert.deepEqual(Object.keys(first), ['name', 'desc', 'price', 'priceValue', 'priceOnRequest', 'priceIsSupplement', 'priceIsFrom', 'priceIsMultiple', 'tags', 'allergens']);
  assert.equal(first.name, 'Tomatensoep');
  assert.equal(first.price, '€6,50');
  assert.equal(first.priceValue, 6.5);
  assert.equal(entry.categories[1].items[0].price, '€21,50');
});

test('overslaan met een reden: een digitale pdf die geen menukaart is levert geen gerechten', async () => {
  const read = await readPdfMenu(fs.readFileSync(NOT_A_MENU_PDF));
  assert.equal(read.kind, 'pdf');
  const assessment = assessCompleteMenu(read);
  assert.equal(assessment.ok, false);
  assert.ok(assessment.reasons.length > 0);
  assert.ok(assessment.pricedCount < MIN_DISHES);
});

function fakeFetch({ robots = 'User-agent: *\nAllow: /\n', pages = {}, disallowed = [] } = {}) {
  const calls = [];
  const robotPaths = new Set(disallowed);
  async function fetchImpl(url, options = {}) {
    calls.push({ url, userAgent: options.userAgent || null });
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      return { body: robots, bytes: null, finalUrl: url, contentType: 'text/plain', redirected: false };
    }
    if (robotPaths.has(parsed.pathname)) throw Object.assign(new Error('should not be fetched'), { reason: 'bad-status', statusCode: 200 });
    const page = pages[parsed.pathname];
    if (!page) throw Object.assign(new Error('not found'), { reason: 'bad-status', statusCode: 404 });
    return {
      body: null,
      bytes: Buffer.isBuffer(page) ? page : Buffer.from(page, 'utf8'),
      finalUrl: url,
      contentType: Buffer.isBuffer(page) ? 'application/pdf' : 'text/html',
      redirected: false,
    };
  }
  return { fetchImpl, calls };
}

function fakeClock() {
  let current = 0;
  const waits = [];
  return {
    now: () => current,
    sleep: async (ms) => {
      waits.push(ms);
      current += ms;
    },
    waits,
  };
}


test('robots.txt wordt gerespecteerd en er zit rust tussen twee verzoeken naar dezelfde host', async () => {
  const clock = fakeClock();
  const { fetchImpl, calls } = fakeFetch({
    robots: 'User-agent: *\nDisallow: /geheim\n',
    pages: { '/': COMPLETE_HTML },
    disallowed: ['/geheim'],
  });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: clock.sleep, now: clock.now });

  const allowed = await fetcher.getPage('https://voorbeeld.nl/');
  assert.equal(allowed.ok, true);
  assert.equal(allowed.kind, 'html');
  // Our own, honest user agent on every request.
  assert.ok(calls.every((call) => call.userAgent === USER_AGENT));
  assert.match(USER_AGENT, /^OnzeMenukaarten-startvulling\/1\.0 \(\+\[E-MAILADRES\]\)$/);

  const blocked = await fetcher.getPage('https://voorbeeld.nl/geheim');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'robots');
  assert.ok(!calls.some((call) => call.url.endsWith('/geheim')));

  // Every request after the first one waits at least two seconds.
  assert.ok(calls.length >= 3, String(calls.length));
  assert.ok(clock.waits.length >= 1);
  assert.ok(clock.waits.every((ms) => ms >= 2000), JSON.stringify(clock.waits));
});

test('de cache: een tweede run haalt een html-pagina niet opnieuw op', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-bootstrap-'));
  const clock = fakeClock();
  const { fetchImpl, calls } = fakeFetch({ pages: { '/': COMPLETE_HTML } });
  const fetcher = createSourceFetcher({ cacheDir: dir, fetchImpl, sleep: clock.sleep, now: clock.now });
  const first = await fetcher.getPage('https://voorbeeld.nl/');
  assert.equal(first.fromCache, false);
  const countAfterFirst = calls.length;
  const second = await fetcher.getPage('https://voorbeeld.nl/');
  assert.equal(second.fromCache, true);
  assert.equal(calls.length, countAfterFirst);
  assert.equal(second.text, first.text);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('de motor slaat een restaurant over als de kaart niet aan de eis voldoet, met de reden', async () => {
  const clock = fakeClock();
  const { fetchImpl } = fakeFetch({ pages: { '/': INCOMPLETE_HTML } });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: clock.sleep, now: clock.now });
  const result = await bootstrapRestaurant({
    restaurantId: '99',
    restaurant: { name: 'Fictief', website: 'https://voorbeeld.nl/' },
    menus: {},
    scraped: '2026-11-01',
    fetcher,
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.entry, null);
  assert.ok(result.reasons.some((reason) => reason.code === 'too_few_dishes'));
});

test('de motor levert voor een complete kaart een entry; het rapport noemt bron, vorm en aantallen', async () => {
  const clock = fakeClock();
  const { fetchImpl } = fakeFetch({ pages: { '/': COMPLETE_HTML } });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: clock.sleep, now: clock.now });
  const result = await bootstrapRestaurant({
    restaurantId: '99',
    restaurant: { name: 'Fictief', website: 'https://voorbeeld.nl/' },
    menus: {},
    scraped: '2026-11-01',
    fetcher,
  });
  assert.equal(result.status, 'done');
  assert.equal(result.kind, 'html');
  assert.equal(result.sourceUrl, 'https://voorbeeld.nl/');
  assert.equal(result.dishCount, 12);
  assert.equal(result.entry.categories.length, 3);

  const report = buildReport({ results: [result], previousMenus: {}, scraped: '2026-11-01', generatedAt: '2026-11-01T10:00:00.000Z' });
  assert.equal(report.totals.done, 1);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /https:\/\/voorbeeld\.nl\//);
  assert.match(markdown, /\| 12 \| 12 \| geslaagd \|/);
});

test('het rapport telt nieuw, weg en een andere prijs tegen de kaart van maart', () => {
  const previous = {
    '99-menukaart': {
      scraped: '2026-03-25',
      categories: [{ name: 'Hoofdgerechten', items: [{ name: 'Biefstuk', price: '€24,00', priceValue: 24 }, { name: 'Oude vis', price: '€20,00', priceValue: 20 }] }],
    },
  };
  const result = {
    restaurantId: '99',
    name: 'Fictief',
    website: 'https://voorbeeld.nl/',
    status: 'done',
    sourceUrl: 'https://voorbeeld.nl/',
    kind: 'html',
    dishCount: 2,
    pricedCount: 2,
    reasons: [],
    entry: {
      categories: [{ name: 'Hoofdgerechten', items: [{ name: 'Biefstuk', price: '€26,00', priceValue: 26 }, { name: 'Nieuwe vis', price: '€22,00', priceValue: 22 }] }],
    },
  };
  const report = buildReport({ results: [result], previousMenus: previous, scraped: '2026-11-01' });
  const diff = report.restaurants[0].diff['99-menukaart'];
  assert.equal(diff.added.length, 1);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.repriced.length, 1);
  assert.equal(diff.repriced[0].was, 24);
  assert.equal(diff.repriced[0].now, 26);
});

test('geen AI: de motor laadt geen Anthropic-SDK, geen AI-adapter en geen modelprotocol', () => {
  const loaded = Object.keys(require.cache).join('\n');
  for (const forbidden of ['@anthropic-ai', 'claudeStructuringAdapter', 'menuExtractionAnthropicCall', 'menuExtractionRuntime']) {
    assert.ok(!loaded.includes(forbidden), forbidden);
  }
  const sources = fs.readdirSync(__dirname).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'));
  assert.ok(sources.length >= 5, sources.join(','));
  for (const file of sources) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(!/require\(['"]@anthropic-ai|from ['"]@anthropic-ai|api\.anthropic\.com/.test(source), file);
  }
});

