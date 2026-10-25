'use strict';

// BE-29 (#70) — de server-side kandidatenlijst is de enige plek die
// data/menus.json leest. Deze tests bewijzen met de echte data én met kleine
// fixtures dat er niets in de lijst komt dat niet bestelbaar, gepubliceerd of
// eerlijk geprijsd is.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildTonightCandidates, realPrice } = require('./publicTonightData');
const { isMainDishCategory } = require('./publicTonight');

const OPEN_ALL = {
  ma: '11:00-23:00',
  di: '11:00-23:00',
  wo: '11:00-23:00',
  do: '11:00-23:00',
  vr: '11:00-23:00',
  za: '11:00-23:00',
  zo: '11:00-23:00',
};

function fixtureData(categories, options = {}) {
  return {
    menus: {
      '9-diner': {
        subtitle: options.subtitle || 'Dinerkaart',
        scraped: options.scraped || '2026-10-23',
        categories,
      },
    },
    restaurants: {
      9: {
        name: 'Fictief Restaurant',
        cuisine: 'Frans',
        openingHours: OPEN_ALL,
        menuLinks: options.menuLinks || [{ id: '9-diner', label: 'Dinerkaart' }],
      },
    },
  };
}

test('BE-29: de echte data levert alleen bestelbare gerechten met een echte prijs', () => {
  const candidates = buildTonightCandidates();
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.equal(isMainDishCategory(candidate.category), true, `${candidate.category} is geen bestelbaar gerecht`);
    assert.ok(candidate.priceValue > 0);
    assert.ok(candidate.priceDisplay);
    assert.ok(!/op aanvraag/i.test(candidate.priceDisplay));
    assert.match(candidate.dishId, /^\d+-[a-z]+-\d+-\d+$/);
    assert.ok(candidate.menuLink.startsWith('/menu/'));
    assert.ok(candidate.restaurantName);
    assert.ok(candidate.openingHours, 'openingStatus heeft echte uren nodig');
  }
});

test('BE-29: drank, bijgerechten, desserts en arrangementen komen nooit in de lijst', () => {
  const categories = [
    { name: 'Hoofdgerechten', items: [{ name: 'Echte kip', price: '€ 20', priceValue: 20 }] },
    { name: 'Bijgerechten', items: [{ name: 'Friet', price: '€ 4', priceValue: 4 }] },
    { name: 'Dranken — Bier', items: [{ name: 'Pils', price: '€ 3', priceValue: 3 }] },
    { name: 'Desserts', items: [{ name: 'Taart', price: '€ 8', priceValue: 8 }] },
    { name: "Lunchmenu's", items: [{ name: 'Menu', price: '€ 30', priceValue: 30 }] },
  ];
  const candidates = buildTonightCandidates(fixtureData(categories));
  assert.deepEqual(candidates.map((candidate) => candidate.name), ['Echte kip']);
});

test('BE-29: op aanvraag, een lege prijs, een supplement en een meervoudige prijs vallen af', () => {
  assert.equal(realPrice({ price: '€ 10', priceValue: 10 }), true);
  assert.equal(realPrice({ price: 'op aanvraag', priceValue: null, priceOnRequest: true }), false);
  assert.equal(realPrice({ price: '', priceValue: null }), false);
  assert.equal(realPrice({ price: '+€ 5', priceValue: 5, priceIsSupplement: true }), false);
  assert.equal(realPrice({ price: '€ 5 / € 9', priceValue: null, priceIsMultiple: true }), false);
  assert.equal(realPrice({ price: '€ 0', priceValue: 0 }), false);

  const categories = [
    {
      name: 'Hoofdgerechten',
      items: [
        { name: 'Echt', price: '€ 20', priceValue: 20 },
        { name: 'Op aanvraag', price: 'op aanvraag', priceValue: null, priceOnRequest: true },
        { name: 'Supplément', price: '+€ 5', priceValue: 5, priceIsSupplement: true },
        { name: 'Glas of fles', price: '€ 5 / € 9', priceValue: null, priceIsMultiple: true },
      ],
    },
  ];
  const candidates = buildTonightCandidates(fixtureData(categories));
  assert.deepEqual(candidates.map((candidate) => candidate.name), ['Echt']);
});

test('BE-29: alleen een gepubliceerde menukaart (in de menuLinks van het restaurant) telt mee', () => {
  const categories = [{ name: 'Hoofdgerechten', items: [{ name: 'Echt', price: '€ 20', priceValue: 20 }] }];
  const unpublished = buildTonightCandidates(fixtureData(categories, { menuLinks: [{ id: '9-lunch', label: 'Lunchkaart' }] }));
  assert.deepEqual(unpublished, []);
  const published = buildTonightCandidates(fixtureData(categories));
  assert.equal(published.length, 1);
});

test('BE-29: de kandidaten dragen de echte brondatum en een bron-qualifier', () => {
  const categories = [
    {
      name: 'Hoofdgerechten',
      items: [
        { name: 'Mixed grill', price: '€ 27,50', priceValue: 27.5, priceNote: 'voor 2 personen' },
        { name: 'Mosselen', price: '€ 12,50 per kilo', priceValue: 12.5 },
      ],
    },
  ];
  const candidates = buildTonightCandidates(fixtureData(categories, { scraped: '2026-10-23' }));
  assert.equal(candidates.find((candidate) => candidate.name === 'Mixed grill').priceDisplay, '€ 27,50 · voor 2 personen');
  assert.equal(candidates.find((candidate) => candidate.name === 'Mosselen').priceDisplay, '€ 12,50 per kilo');
  assert.equal(candidates[0].sourceDate, '2026-10-23');
});

test('BE-29: de seizoenskaart en de daghap komen alleen uit wat de kaart zelf zegt', () => {
  const categories = [
    {
      name: 'Hoofdgerechten',
      items: [
        { name: 'Hertenbiefstuk', price: '€ 28', priceValue: 28 },
        { name: 'Dagschotel', price: '€ 18', priceValue: 18 },
      ],
    },
  ];
  const seasonal = buildTonightCandidates(fixtureData(categories, { subtitle: 'Wildkaart', scraped: '2026-10-23' }));
  assert.equal(seasonal.every((candidate) => candidate.seasonal === true), true, 'een Wildkaart is een seizoenskaart');
  const daily = seasonal.find((candidate) => candidate.name === 'Dagschotel');
  assert.deepEqual(daily.daily, { sourceDate: '2026-10-23' }, 'alleen de datum gaat mee, geen label in de serverdata');

  const ordinary = buildTonightCandidates(fixtureData(categories, { subtitle: 'Dinerkaart', scraped: '2026-10-23' }));
  assert.equal(ordinary.every((candidate) => candidate.seasonal === false), true, 'een gewone dinerkaart is geen seizoenskaart');
  assert.equal(ordinary.find((candidate) => candidate.name === 'Hertenbiefstuk').daily, null);
});

