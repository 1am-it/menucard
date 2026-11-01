'use strict';

// BE-71 (#176) — R10/R11: van AI-uitvoer naar data/.
//
// De Lead-correctie (ops/scripts/menu-bootstrap/lead-corrections/<id>.json) is de
// kaart; de AI-uitvoer is bewijs. Zonder correctie wordt er geen AI-kaart
// geschreven. Deze tests gebruiken de echte bestanden van De Beyerd en kleine
// nep-uitvoeren in een tijdelijke map — geen netwerk, geen AI-aanroep.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadLeadCard, buildLeadCard, AI_WITHOUT_LEAD_CHECK, CORRECTIONS_DIR } = require('./leadCard');

// BE-76 (#189): de R10-regressie draait op een vaste nepuitvoer in
// ops/scripts/menu-bootstrap/__fixtures__/, niet op .local/menu-bootstrap-ai/.
// Die map staat alleen op de machine van de Lead en maakte deze test in elke
// andere werkmap rood. De nepuitvoer leest de kaart breder (de Engelse kaart),
// net als de echte AI-uitvoer, dus de verwachtingen blijven gelijk.
const FIXTURE_AI = path.join(__dirname, '__fixtures__', 'ai-dishes-11.json');

function correctionOf(id) {
  return JSON.parse(fs.readFileSync(path.join(CORRECTIONS_DIR, `${id}.json`), 'utf8'));
}

function aiOf(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function dishesOf(entry) {
  return entry.categories.reduce((all, category) => all.concat((category.items || []).map((item) => ({ ...item, category: category.name }))), []);
}

test('R10: de Lead-correctie wint van de AI-uitvoer (De Beyerd, 15 gerechten)', () => {
  const correction = correctionOf('11');
  const ai = aiOf(FIXTURE_AI);
  assert.ok(ai, 'de vaste nepuitvoer van De Beyerd hoort in ops/scripts/menu-bootstrap/__fixtures__/ai-dishes-11.json te staan');
  assert.notEqual((ai.dishes || []).length, correction.categories.reduce((n, c) => n + c.items.length, 0), 'de AI las meer (de Engelse kaart); de correctie is korter');

  const built = buildLeadCard({ restaurantId: '11', correction, ai, menus: {} });
  assert.equal(built.ok, true);
  assert.equal(built.key, '11-lunch');
  const dishes = dishesOf(built.entry);
  assert.equal(dishes.length, 15);
  assert.deepEqual(built.entry.categories.map((c) => c.name), ['Lunch', 'Luxe belegd bierbostelbrood', 'Salades', 'Warme lunch']);
  // R11: de Engelse kaart telt niet mee.
  for (const dish of dishes) assert.doesNotMatch(dish.name, /^(Goat cheese|Grilled chicken|Croquettes|Shrimp croquettes)$/);
});

test('R10: zonder Lead-correctie wordt er geen AI-kaart geschreven', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-bootstrap-ai-'));
  const corrections = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-bootstrap-lead-'));
  try {
    const ai = { restaurantId: '99', name: 'Neprestaurant', scraped: '2026-11-01', model: 'x', dishes: [{ name: 'Soep', category: 'Lunch', price: 6 }], assessment: { ok: true } };
    fs.writeFileSync(path.join(dir, '99.json'), JSON.stringify(ai));
    const loaded = loadLeadCard({ restaurantId: '99', aiDir: dir, correctionsDir: corrections });
    assert.equal(loaded.correction, null);
    assert.equal(loaded.ai.restaurantId, '99');

    const built = buildLeadCard({ restaurantId: '99', correction: loaded.correction, ai: loaded.ai, menus: {} });
    assert.equal(built.ok, false);
    assert.equal(built.entry, null);
    assert.deepEqual(built.reasons, [AI_WITHOUT_LEAD_CHECK]);
    assert.equal(built.ai.dishCount, 1, 'de AI-uitvoer blijft als bewijs bij de reden staan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(corrections, { recursive: true, force: true });
  }
});

test('R10: de velden van de gecorrigeerde kaart zijn bron, datum, subtitel, notes, aiRead en leadChecked', () => {
  const correction = correctionOf('11');
  const ai = aiOf(FIXTURE_AI);
  const built = buildLeadCard({ restaurantId: '11', correction, ai, menus: {} });
  const entry = built.entry;
  assert.equal(entry.source, 'https://www.beyerd.nl/cafe-lunchkaart/');
  assert.equal(entry.scraped, ai ? ai.scraped : '2026-11-01');
  assert.equal(entry.subtitle, 'Lunchkaart');
  assert.equal(entry.notes, correction.note);
  assert.equal(entry.aiRead, true);
  assert.equal(entry.leadChecked, '2026-11-01');
  // Dezelfde vorm als de bestaande kaarten: prijs, priceValue, vlaggen, tags.
  const dish = dishesOf(entry)[0];
  assert.equal(typeof dish.price, 'string');
  assert.equal(typeof dish.priceValue, 'number');
  assert.equal(dish.priceOnRequest, false);
  assert.deepEqual(dish.tags, []);
  assert.deepEqual(dish.allergens, []);
});

test('R10: een gerecht dat als broodje én als salade bestaat blijft twee gerechten', () => {
  const built = buildLeadCard({ restaurantId: '11', correction: correctionOf('11'), ai: null, menus: {} });
  const kip = dishesOf(built.entry).filter((dish) => dish.name === 'Gegrilde kipfilet');
  assert.equal(kip.length, 2);
  assert.deepEqual(kip.map((dish) => dish.category), ['Luxe belegd bierbostelbrood', 'Salades']);
  assert.deepEqual(kip.map((dish) => dish.priceValue), [12, 14]);
});

test('R6/R1-R9: de correctie gaat door dezelfde eis en wordt met de reden overgeslagen', () => {
  const base = correctionOf('11');
  const tooFew = { ...base, categories: [{ name: 'Lunch', items: base.categories[0].items.slice(0, 3) }] };
  const few = buildLeadCard({ restaurantId: '11', correction: tooFew, ai: null, menus: {} });
  assert.equal(few.ok, false);
  assert.equal(few.entry, null);
  assert.deepEqual(few.reasons.map((reason) => reason.code), ['too_few_dishes']);

  const priced = JSON.parse(JSON.stringify(base));
  priced.categories[0].items[0].price = 400;
  const outOfBounds = buildLeadCard({ restaurantId: '11', correction: priced, ai: null, menus: {} });
  assert.equal(outOfBounds.ok, false);
  assert.deepEqual(outOfBounds.reasons.map((reason) => reason.code), ['price_out_of_bounds']);

  const unpriced = JSON.parse(JSON.stringify(base));
  unpriced.categories[1].items[0].price = null;
  const withoutPrice = buildLeadCard({ restaurantId: '11', correction: unpriced, ai: null, menus: {} });
  assert.equal(withoutPrice.ok, false);
  assert.deepEqual(withoutPrice.reasons.map((reason) => reason.code), ['unpriced_dishes']);
});
