'use strict';

// BE-29 (#70) — de pure selectie van "Vanavond op de kaart". Vaste datum en
// tijd in Europe/Amsterdam, zodat de tests niet van de machineklok afhangen.
// De kandidaten komen uit de echte data (src/lib/publicTonightData.js); de
// kleine fixtures hieronder bewijzen de regels die de echte data niet op elke
// dag toevallig laat zien.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MAX_DISHES,
  mealMoment,
  mealTitle,
  isMainDishCategory,
  honestPriceLabel,
  isOpenForMoment,
  isNewlyUpdated,
  selectTonight,
} = require('./publicTonight');

const OPEN_ALL = {
  ma: '11:00-23:00',
  di: '11:00-23:00',
  wo: '11:00-23:00',
  do: '11:00-23:00',
  vr: '11:00-23:00',
  za: '11:00-23:00',
  zo: '11:00-23:00',
};

// 2026-10-23 is een vrijdag; Nederland staat dan nog op zomertijd (UTC+2).
const LUNCH = '2026-10-23T10:30:00Z'; // 12:30 lokaal
const BORREL = '2026-10-23T15:00:00Z'; // 17:00 lokaal
const DINER = '2026-10-23T18:00:00Z'; // 20:00 lokaal

function candidate(overrides = {}) {
  const restaurantId = overrides.restaurantId || '1';
  return {
    dishId: `${restaurantId}-diner-0-0`,
    name: `Gerecht ${restaurantId}`,
    restaurantId,
    restaurantName: `Restaurant ${restaurantId}`,
    cuisine: 'Frans',
    mealType: 'diner',
    category: 'Hoofdgerechten',
    isMainCourse: true,
    priceDisplay: '€ 20,00',
    priceValue: 20,
    vegetarian: false,
    seasonal: false,
    sourceDate: '2026-10-01',
    daily: null,
    emoji: '🍽️',
    menuLink: `/menu/${restaurantId}-diner`,
    openingHours: OPEN_ALL,
    ...overrides,
  };
}

test('BE-29: het moment van de dag is lunch vóór 15:00, borrel 16:00–18:00 en daarna diner', () => {
  assert.equal(mealMoment(0), 'lunch');
  assert.equal(mealMoment(14 * 60 + 59), 'lunch');
  assert.equal(mealMoment(15 * 60), 'diner');
  assert.equal(mealMoment(15 * 60 + 59), 'diner');
  assert.equal(mealMoment(16 * 60), 'borrel');
  assert.equal(mealMoment(17 * 60 + 59), 'borrel');
  assert.equal(mealMoment(18 * 60), 'diner');
  assert.equal(mealMoment(23 * 60 + 59), 'diner');
  assert.equal(mealTitle('lunch'), 'Nu op de lunchkaart');
  assert.equal(mealTitle('borrel'), 'Borrel');
  assert.equal(mealTitle('diner'), 'Vanavond op de kaart');
});

test('BE-29: alleen bestelbare gerechten — geen dranken, sauzen, bijgerechten, zoetigheid of arrangementen', () => {
  for (const allowed of ['Hoofdgerechten', 'Voorgerechten', 'Lunchgerechten (12:00–15:00)', 'À la carte', 'Salades', 'Sandwiches', 'Bites', 'Klassieke Borrelhappen', 'Specialiteiten van Bardot']) {
    assert.equal(isMainDishCategory(allowed), true, `${allowed} is een bestelbaar gerecht`);
  }
  for (const excluded of [
    'Dranken — Koffie & Thee',
    'Wijnen — Rood',
    'Cocktails',
    'Spritzers',
    'Bieren — Van de Tap',
    'Bijgerechten',
    'Sauzen',
    'Desserts',
    'Dessert',
    'Sweets',
    'Croissant & Gebak',
    "Lunchmenu's",
    'Wisselend Lunchmenu',
    'Signature Menu — Maarten Camps (5 gangen)',
    'Surprise / Proeverij',
    'Kids Menu',
    '',
  ]) {
    assert.equal(isMainDishCategory(excluded), false, `${excluded || '(leeg)'} valt af`);
  }
});

test('BE-29: de eerlijke prijs laat een bron-qualifier staan en verzint er geen', () => {
  assert.equal(honestPriceLabel({ price: '€ 27,50', priceValue: 27.5 }), '€ 27,50');
  assert.equal(
    honestPriceLabel({ price: '€ 27,50', priceValue: 27.5, priceNote: 'voor 2 personen' }),
    '€ 27,50 · voor 2 personen'
  );
  assert.equal(honestPriceLabel({ price: '€ 12,50 per kilo', priceValue: 12.5 }), '€ 12,50 per kilo');
  assert.equal(
    honestPriceLabel({ price: '€ 27,50', priceValue: 27.5, desc: 'Mix van vis, voor 2 personen' }),
    '€ 27,50 · voor 2 personen'
  );
  assert.equal(
    honestPriceLabel({ price: '€ 12,50', priceValue: 12.5, desc: 'Gewicht per kilo bij aankoop' }),
    '€ 12,50 · per kilo'
  );
  assert.equal(
    honestPriceLabel({ price: '€ 4,00', priceValue: 4, desc: 'Met sjalottenvinaigrette (per stuk)' }),
    '€ 4,00 · per stuk'
  );
  assert.equal(
    honestPriceLabel({ price: '€ 20,95', priceValue: 20.95, desc: 'Krielkippetje met appelcompote' }),
    '€ 20,95',
    'een dubbele p in een gewoon woord is geen prijs per persoon'
  );
  assert.equal(
    honestPriceLabel({ price: '€ 42,00', priceValue: 42, desc: 'Driegangenmenu 42,0 p.p.' }),
    '€ 42,00 · p.p.'
  );
  assert.equal(honestPriceLabel({ price: '€ 9,50', priceValue: 9.5, priceIsFrom: true }), 'vanaf € 9,50');
  assert.equal(honestPriceLabel({ price: 'op aanvraag', priceValue: null, priceOnRequest: true }), null);
  assert.equal(honestPriceLabel({ price: '', priceValue: 12 }), null);
  assert.equal(honestPriceLabel(null), null);
});

test('BE-29: een restaurant telt alleen mee als het in dat deel van de dag open is', () => {
  assert.equal(isOpenForMoment({ vr: '18:00-22:00' }, 'vr', 'diner'), true);
  assert.equal(isOpenForMoment({ vr: '18:00-22:00' }, 'vr', 'lunch'), false);
  assert.equal(isOpenForMoment({ vr: '12:00-15:00' }, 'vr', 'lunch'), true);
  assert.equal(isOpenForMoment({ vr: '16:00-17:00' }, 'vr', 'borrel'), true);
  assert.equal(isOpenForMoment({ vr: '17:00-18:00' }, 'vr', 'borrel'), true, '17:00–18:00 overlapt het borrelvenster');
  assert.equal(isOpenForMoment({ vr: '18:00-22:00' }, 'vr', 'borrel'), false, 'opent pas na het borrelvenster');
  assert.equal(isOpenForMoment({ vr: '10:00-22:00' }, 'vr', 'borrel'), true);
  assert.equal(isOpenForMoment({ za: '10:00-22:00' }, 'vr', 'diner'), false, 'geen uren voor vandaag');
  assert.equal(isOpenForMoment({ vr: 'gebroken' }, 'vr', 'diner'), false);
  assert.equal(isOpenForMoment(null, 'vr', 'diner'), false);
});

test('BE-29: de keuze is deterministisch per dag en wisselt met de volgende dag', () => {
  const candidates = [];
  for (let id = 1; id <= 8; id += 1) {
    for (const priceValue of [9, 20, 40]) {
      candidates.push(candidate({
        restaurantId: String(id),
        dishId: `${id}-diner-0-${priceValue}`,
        name: `Gerecht ${id}-${priceValue}`,
        priceValue,
        priceDisplay: `€ ${priceValue},00`,
        cuisine: `Keuken ${id}`,
      }));
    }
  }
  const first = selectTonight({ candidates, now: new Date(DINER) });
  const again = selectTonight({ candidates, now: new Date(DINER) });
  const nextDay = selectTonight({ candidates, now: new Date('2026-10-24T18:00:00Z') });
  assert.deepEqual(first, again);
  assert.notDeepEqual(
    first.dishes.map((dish) => dish.dishId),
    nextDay.dishes.map((dish) => dish.dishId)
  );
});

test('BE-29: de sectie verdwijnt bij minder dan drie gerechten', () => {
  const candidates = [
    candidate({ restaurantId: '1', priceValue: 9 }),
    candidate({ restaurantId: '2', priceValue: 20 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.hidden, true);
  assert.equal(selection.dishes.length, 2);
});

test('BE-29: hooguit één gerecht per restaurant, ook al heeft een kaart er tien', () => {
  const candidates = [
    candidate({ restaurantId: '1', dishId: '1-diner-0-0', name: 'A', priceValue: 9 }),
    candidate({ restaurantId: '1', dishId: '1-diner-0-1', name: 'B', priceValue: 20 }),
    candidate({ restaurantId: '1', dishId: '1-diner-0-2', name: 'C', priceValue: 40 }),
    candidate({ restaurantId: '2', dishId: '2-diner-0-0', name: 'D', priceValue: 9 }),
    candidate({ restaurantId: '3', dishId: '3-diner-0-0', name: 'E', priceValue: 20 }),
    candidate({ restaurantId: '4', dishId: '4-diner-0-0', name: 'F', priceValue: 40 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.hidden, false);
  assert.equal(new Set(selection.dishes.map((dish) => dish.restaurantId)).size, selection.dishes.length);
});

test('BE-29: prijsspreiding — één onder € 15, één van € 15 tot 25 en één daarboven', () => {
  const candidates = [
    candidate({ restaurantId: '1', dishId: '1-diner-0-0', name: 'Goedkoop', priceValue: 9, cuisine: 'Italiaans' }),
    candidate({ restaurantId: '2', dishId: '2-diner-0-0', name: 'Midden', priceValue: 15, cuisine: 'Frans' }),
    candidate({ restaurantId: '3', dishId: '3-diner-0-0', name: 'Duur', priceValue: 25.01, cuisine: 'Grill' }),
    candidate({ restaurantId: '4', dishId: '4-diner-0-0', name: 'Reserve', priceValue: 20, cuisine: 'Chinees' }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  const prices = selection.dishes.map((dish) => dish.priceValue);
  assert.equal(prices.length, MAX_DISHES);
  assert.ok(prices.some((price) => price < 15));
  assert.ok(prices.some((price) => price >= 15 && price <= 25));
  assert.ok(prices.some((price) => price > 25));
  assert.equal(new Set(selection.dishes.map((dish) => dish.cuisine)).size, 3, 'drie verschillende keukens');
});

test('BE-29: iets vegetarisch en één seizoensgerecht als die labels er zijn', () => {
  const candidates = [
    candidate({ restaurantId: '1', dishId: '1-diner-0-0', name: 'Vlees', priceValue: 9, isMainCourse: false }),
    candidate({ restaurantId: '2', dishId: '2-diner-0-0', name: 'Vega', priceValue: 9, vegetarian: true }),
    candidate({ restaurantId: '3', dishId: '3-diner-0-0', name: 'Vis', priceValue: 20 }),
    candidate({ restaurantId: '4', dishId: '4-diner-0-0', name: 'Wild', priceValue: 20, seasonal: true }),
    candidate({ restaurantId: '5', dishId: '5-diner-0-0', name: 'Vlees2', priceValue: 40 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.dishes.some((dish) => dish.vegetarian), true);
  assert.equal(selection.dishes.some((dish) => dish.seasonal), true);
  assert.equal(selection.dishes.length, 3);
});

test('BE-29: een gerecht zonder echte prijs doet nooit mee', () => {
  const candidates = [
    candidate({ restaurantId: '1', priceValue: null, priceDisplay: null }),
    candidate({ restaurantId: '2', priceValue: 0, priceDisplay: 'op aanvraag' }),
    candidate({ restaurantId: '3', priceValue: 20 }),
    candidate({ restaurantId: '4', priceValue: 40 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.hidden, true, 'op aanvraag en een lege prijs tellen niet als drie gerechten');
  assert.deepEqual(selection.dishes.map((dish) => dish.restaurantId), ['3', '4']);
});


test('BE-29: een verlopen daghap staat niet meer in Vanavond, een daghap van vandaag wel', () => {
  const expired = candidate({
    restaurantId: '1',
    daily: { sourceDate: '2026-10-22', dateLabel: '22 oktober 2026', dateLine: 'volgens de kaart van 22 oktober 2026' },
  });
  const today = candidate({
    restaurantId: '2',
    daily: { sourceDate: '2026-10-23', dateLabel: '23 oktober 2026', dateLine: 'volgens de kaart van 23 oktober 2026' },
  });
  const plain = candidate({ restaurantId: '3' });
  const extra = candidate({ restaurantId: '4' });
  const selection = selectTonight({ candidates: [expired, today, plain, extra], now: new Date(DINER) });
  assert.equal(selection.dishes.some((dish) => dish.restaurantId === '1'), false);
  const todayDish = selection.dishes.find((dish) => dish.restaurantId === '2');
  assert.equal(todayDish.daily.label, 'Daghap');
  assert.equal(todayDish.daily.dateLine, 'volgens de kaart van 23 oktober 2026');
});

test('BE-29: een recent bijgewerkte kaart krijgt het label Nieuw op de kaart', () => {
  assert.equal(isNewlyUpdated('2026-10-23', '2026-10-23'), true);
  assert.equal(isNewlyUpdated('2026-09-24', '2026-10-23'), true);
  assert.equal(isNewlyUpdated('2026-09-01', '2026-10-23'), false);
  assert.equal(isNewlyUpdated('2026-10-24', '2026-10-23'), false);
  assert.equal(isNewlyUpdated(null, '2026-10-23'), false);

  const fresh = candidate({ restaurantId: '1', sourceDate: '2026-10-20', priceValue: 9 });
  const old = candidate({ restaurantId: '2', sourceDate: '2026-01-01', priceValue: 20 });
  const third = candidate({ restaurantId: '3', sourceDate: '2026-01-01', priceValue: 40 });
  const selection = selectTonight({ candidates: [fresh, old, third], now: new Date(DINER) });
  assert.equal(selection.dishes.find((dish) => dish.restaurantId === '1').newOnMenu, true);
});

test('BE-29: de selectie bevat geen AI, populariteit, betaling of willekeur', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs
    .readFileSync(path.join(__dirname, 'publicTonight.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /anthropic|openai|popularity|betaling|payment/i);
});

test('BE-29: met de echte data zijn lunch en diner drie eerlijke gerechten met prijsspreiding', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildTonightCandidates } = require('./publicTonightData');
  const root = path.join(__dirname, '..', '..');
  const menus = JSON.parse(fs.readFileSync(path.join(root, 'data/menus.json'), 'utf8'));
  const candidates = buildTonightCandidates();

  for (const [moment, mealType, title] of [
    [LUNCH, 'lunch', 'Nu op de lunchkaart'],
    [DINER, 'diner', 'Vanavond op de kaart'],
  ]) {
    const selection = selectTonight({ candidates, now: new Date(moment) });
    assert.equal(selection.mealType, mealType);
    assert.equal(selection.title, title);
    assert.equal(selection.hidden, false);
    assert.equal(selection.dishes.length, MAX_DISHES);
    assert.equal(new Set(selection.dishes.map((dish) => dish.restaurantId)).size, 3);
    const prices = selection.dishes.map((dish) => dish.priceValue);
    assert.ok(prices.some((price) => price < 15), `${mealType}: iets onder € 15`);
    assert.ok(prices.some((price) => price >= 15 && price <= 25), `${mealType}: iets van € 15 tot 25`);
    assert.ok(prices.some((price) => price > 25), `${mealType}: iets boven € 25`);

    for (const dish of selection.dishes) {
      const idParts = dish.dishId.split('-');
      const itemIndex = Number(idParts.pop());
      const categoryIndex = Number(idParts.pop());
      const menuKey = idParts.join('-');
      assert.equal(dish.menuLink, `/menu/${menuKey}`);
      const sourceItem = menus[menuKey].categories[categoryIndex].items[itemIndex];
      assert.equal(sourceItem.name, dish.name, 'de getoonde naam bestaat letterlijk in de bron');
      assert.equal(sourceItem.price, dish.priceDisplay, 'de getoonde prijs is de bronprijs');
      assert.ok(dish.href.includes('#gerecht-'), 'de klik opent de menukaart op dit gerecht');
      assert.ok(dish.href.startsWith(`${dish.menuLink}?`));
    }
  }
});

test('BE-29: de echte data levert op dit moment geen drie borrelrestaurants, dus de sectie blijft weg', () => {
  const { buildTonightCandidates } = require('./publicTonightData');
  const selection = selectTonight({ candidates: buildTonightCandidates(), now: new Date(BORREL) });
  assert.equal(selection.mealType, 'borrel');
  assert.equal(selection.title, 'Borrel');
  assert.equal(selection.hidden, true);
});

