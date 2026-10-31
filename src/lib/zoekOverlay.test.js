'use strict';

// BE-60 (#150) — tests voor de overlay op de zoekresultaten.
//
// Twee lagen: de pure functies zelf (met kleine, nep-objecten), en de
// samenwerking met de echte zoeklaag in src/services/dishSearch.test.js.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  TIJDELIJK_NIET_BESCHIKBAAR,
  overlayPerGerecht,
  pasZoekOverlayToeOpGerecht,
  verzamelRestaurantIds,
  zoekMetOverlay,
} = require('./zoekOverlay');

const PUBLIEK_PRIJS = {
  menuId: '23-lunch',
  categorieIndex: 0,
  gerechtIndex: 10,
  gerechtNaam: 'Steak à la T-Huis',
  soort: 'prijs',
  prijsCent: 1850,
  prijs: '€18,50',
  tijdelijkNietBeschikbaar: false,
};

const PUBLIEK_LABEL = {
  menuId: '23-lunch',
  categorieIndex: 0,
  gerechtIndex: 10,
  gerechtNaam: 'Steak à la T-Huis',
  soort: 'beschikbaarheid',
  prijsCent: null,
  prijs: '',
  tijdelijkNietBeschikbaar: true,
};

function gerecht(extra = {}) {
  return {
    dishId: '23-lunch-0-10',
    name: 'Steak à la T-Huis',
    priceDisplay: '€23,75',
    priceValue: 23.75,
    priceOnRequest: false,
    restaurantId: '23',
    mealType: 'lunch',
    ...extra,
  };
}

test('BE-60: het label is hetzelfde als op de menukaart', () => {
  assert.equal(TIJDELIJK_NIET_BESCHIKBAAR, 'Tijdelijk niet beschikbaar');
});

test('BE-60: overlayPerGerecht leest de publieke vorm én de databaserij', () => {
  const perGerecht = overlayPerGerecht({
    '23': [
      PUBLIEK_PRIJS,
      { menu_id: '23-lunch', categorie_index: 1, gerecht_index: 2, soort: 'beschikbaarheid', beschikbaar: false },
      null,
      { categorieIndex: 9, gerechtIndex: 9 }, // geen menukaart: kan nergens landen
      { menuId: '23-lunch', categorieIndex: -1, gerechtIndex: 0 }, // ongeldige positie
    ],
  });
  assert.deepEqual([...perGerecht.keys()].sort(), ['23-lunch-0-10', '23-lunch-1-2']);
  assert.equal(perGerecht.get('23-lunch-0-10').prijsCent, 1850);
});

test('BE-60: een prijswijziging zet de nieuwe prijs op het zoekgerecht', () => {
  const perGerecht = overlayPerGerecht({ '23': [PUBLIEK_PRIJS] });
  const origineel = gerecht();
  const nieuw = pasZoekOverlayToeOpGerecht(origineel, perGerecht);
  assert.notEqual(nieuw, origineel, 'er moet een kopie terugkomen');
  assert.equal(nieuw.priceDisplay, '€18,50');
  assert.equal(nieuw.priceValue, 18.5);
  assert.equal(origineel.priceDisplay, '€23,75', 'de statische kaart blijft ongewijzigd');
  assert.equal(nieuw.name, origineel.name);
  assert.equal(nieuw.dishId, origineel.dishId);
});

test('BE-60: een gerecht tijdelijk niet beschikbaar krijgt alleen het label', () => {
  const perGerecht = overlayPerGerecht({ '23': [PUBLIEK_LABEL] });
  const nieuw = pasZoekOverlayToeOpGerecht(gerecht(), perGerecht);
  assert.equal(nieuw.tijdelijkNietBeschikbaar, true);
  assert.equal(nieuw.priceDisplay, '€23,75', 'de prijs blijft staan');
  assert.equal(nieuw.priceValue, 23.75);
});

test('BE-60: zonder raakvlak komt exact hetzelfde object terug', () => {
  const origineel = gerecht();
  const perGerecht = overlayPerGerecht({
    '6': [{ menuId: '6-lunch', categorieIndex: 0, gerechtIndex: 0, soort: 'prijs', prijsCent: 1200 }],
  });
  assert.equal(pasZoekOverlayToeOpGerecht(origineel, perGerecht), origineel);
  assert.equal(pasZoekOverlayToeOpGerecht(origineel, overlayPerGerecht(null)), origineel);
});

test('BE-60: een "op aanvraag"-gerecht met een goedgekeurde prijs toont die prijs', () => {
  const perGerecht = overlayPerGerecht({ '23': [PUBLIEK_PRIJS] });
  const nieuw = pasZoekOverlayToeOpGerecht(
    gerecht({ priceOnRequest: true, priceDisplay: 'op aanvraag', priceValue: null }),
    perGerecht,
  );
  assert.equal(nieuw.priceOnRequest, false);
  assert.equal(nieuw.priceDisplay, '€18,50');
  assert.equal(nieuw.priceValue, 18.5);
});

test('BE-60: alleen de restaurants in het resultaat worden opgehaald', () => {
  const ids = verzamelRestaurantIds({
    results: [{ restaurantId: '23' }, { restaurantId: '6' }, { restaurantId: '23' }],
    restaurantGroups: [{ restaurantId: '19' }],
  });
  assert.deepEqual(ids, ['23', '6', '19']);
});


test('BE-60: zoeken haalt de overlay op van de restaurants in het resultaat', async () => {
  const opgehaald = [];
  const zoek = (overlay) => ({
    results: [{ dishId: 'a', restaurantId: '23', priceDisplay: overlay && overlay['23'] ? '€18,50' : '€23,75' }],
    restaurantGroups: [],
  });
  const resultaat = await zoekMetOverlay({
    zoek,
    laadOverlay: async (ids) => {
      opgehaald.push([...ids]);
      return { '23': [PUBLIEK_PRIJS] };
    },
  });
  assert.deepEqual(opgehaald, [['23']], 'één opvraag, alleen voor het getoonde restaurant');
  assert.equal(resultaat.results[0].priceDisplay, '€18,50', 'het tweede antwoord heeft de overlay');
});

test('BE-60: de overlay wordt ook voor de gegroepeerde resultaten opgehaald', async () => {
  const opgehaald = [];
  await zoekMetOverlay({
    zoek: () => ({ results: [], restaurantGroups: [{ restaurantId: '6' }] }),
    laadOverlay: async (ids) => {
      opgehaald.push([...ids]);
      return {};
    },
  });
  assert.deepEqual(opgehaald, [['6']], 'ook /search gebruikt group=restaurant');
});

test('BE-60: zonder wijzigingen blijft het eerste resultaat staan', async () => {
  let rondes = 0;
  const resultaat = await zoekMetOverlay({
    zoek: () => {
      rondes += 1;
      return { results: [{ dishId: 'a', restaurantId: '23', priceDisplay: '€23,75' }], restaurantGroups: [] };
    },
    laadOverlay: async () => ({}),
  });
  assert.equal(rondes, 1, 'geen wijzigingen: geen tweede zoekopdracht');
  assert.equal(resultaat.results[0].priceDisplay, '€23,75');
});

test('BE-60: een storing in de overlay laat de statische prijzen staan', async () => {
  const resultaat = await zoekMetOverlay({
    zoek: () => ({ results: [{ dishId: 'a', restaurantId: '23', priceDisplay: '€23,75' }], restaurantGroups: [] }),
    laadOverlay: async () => {
      throw new Error('503 zonder migratie');
    },
  });
  assert.equal(resultaat.results[0].priceDisplay, '€23,75');
});

test('BE-60: zonder restaurants in beeld wordt niets opgevraagd', async () => {
  let opgevraagd = 0;
  const resultaat = await zoekMetOverlay({
    zoek: () => ({ results: [], restaurantGroups: [] }),
    laadOverlay: async () => {
      opgevraagd += 1;
      return { '23': [PUBLIEK_PRIJS] };
    },
  });
  assert.equal(opgevraagd, 0, 'geen resultaat, geen opvraag');
  assert.deepEqual(resultaat.results, []);
});

test('BE-60: een Map met wijzigingen werkt net zo goed als een object', async () => {
  const rondes = [];
  const resultaat = await zoekMetOverlay({
    zoek: (overlay) => {
      rondes.push(overlay ? 'met' : 'zonder');
      return { results: [{ dishId: 'a', restaurantId: '23', priceDisplay: overlay ? '€18,50' : '€23,75' }], restaurantGroups: [] };
    },
    laadOverlay: async () => new Map([['23', [PUBLIEK_PRIJS]]]),
  });
  assert.deepEqual(rondes, ['zonder', 'met']);
  assert.equal(resultaat.results[0].priceDisplay, '€18,50');
});
