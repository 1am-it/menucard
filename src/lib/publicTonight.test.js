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
  availableFrom,
  momentAvailability,
  clockLabel,
  dayAfter,
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

test('BE-38: de sectie verdwijnt pas als ook de terugval niets oplevert', () => {
  // Twee dinergerechten op het dinermoment, geen later moment die dag en geen
  // lunch van morgen: dan is er echt niets om te tonen.
  const candidates = [
    candidate({ restaurantId: '1', priceValue: 9 }),
    candidate({ restaurantId: '2', priceValue: 20 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.hidden, true);
  assert.deepEqual(selection.dishes, [], 'de sectie toont niets in plaats van een halve selectie');
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

test('BE-29/BE-38: een gerecht zonder echte prijs doet nooit mee', () => {
  const candidates = [
    candidate({ restaurantId: '1', priceValue: null, priceDisplay: null }),
    candidate({ restaurantId: '2', priceValue: 0, priceDisplay: 'op aanvraag' }),
    candidate({ restaurantId: '3', priceValue: 20 }),
    candidate({ restaurantId: '4', priceValue: 40 }),
  ];
  const selection = selectTonight({ candidates, now: new Date(DINER) });
  assert.equal(selection.hidden, true, 'op aanvraag en een lege prijs tellen niet als drie gerechten');
  assert.deepEqual(selection.dishes.map((dish) => dish.restaurantId), []);
  assert.equal(
    candidates.slice(0, 2).some((unpriced) => selection.dishes.includes(unpriced)),
    false,
    'een gerecht zonder echte prijs komt in geen enkele selectie'
  );
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

test('BE-38: de echte data heeft om 17:00 twee borrelgerechten, dus de sectie valt terug op diner', () => {
  const { buildTonightCandidates } = require('./publicTonightData');
  const selection = selectTonight({ candidates: buildTonightCandidates(), now: new Date(BORREL) });
  assert.equal(selection.hidden, false, 'de sectie blijft staan in plaats van te verdwijnen');
  assert.equal(selection.mode, 'later');
  assert.equal(selection.mealType, 'diner', 'het eerstvolgende moment van vandaag');
  assert.match(selection.title, /^Straks op de kaart · vanaf \d{2}:\d{2}$/);
  assert.equal(selection.dishes.length, MAX_DISHES);
  assert.equal(new Set(selection.dishes.map((dish) => dish.restaurantId)).size, MAX_DISHES);
  for (const dish of selection.dishes) {
    assert.match(dish.opensAt, /^\d{2}:\d{2}$/, 'elk terugvalgerecht noemt zijn eigen tijd');
    assert.ok(dish.priceDisplay && dish.priceValue > 0, 'ook de terugval toont een echte prijs');
  }
  assert.equal(
    selection.title,
    `Straks op de kaart · vanaf ${selection.dishes.map((dish) => dish.opensAt).sort()[0]}`,
    'de titel noemt het vroegste moment van de getoonde gerechten'
  );
});

// ─── BE-38 (#90): de terugval met vaste fixtures ──────────────────────────

// 2026-10-23 is een vrijdag (zomertijd, UTC+2).
const BORREL_1630 = '2026-10-23T14:30:00Z'; // 16:30 lokaal
const LATE_EVENING = '2026-10-23T21:30:00Z'; // 23:30 lokaal
const LUNCHTIME = '2026-10-23T10:30:00Z'; // 12:30 lokaal

const BORREL_HOURS = { vr: '16:00-22:00' };
const DINER_HOURS_1730 = { vr: '17:30-22:00' };
const TOMORROW_LUNCH_HOURS = { vr: '17:30-22:00', za: '12:00-22:00' };

function borrelCandidates() {
  return [
    candidate({ restaurantId: '1', dishId: '1-borrel-0-0', mealType: 'borrel', name: 'Bitterbal', priceValue: 6, priceDisplay: '€ 6,00', cuisine: 'Frans', openingHours: BORREL_HOURS }),
    candidate({ restaurantId: '2', dishId: '2-borrel-0-0', mealType: 'borrel', name: 'Bruschetta', priceValue: 8, priceDisplay: '€ 8,00', cuisine: 'Italiaans', openingHours: BORREL_HOURS }),
  ];
}

function dinerCandidates(openingHours = DINER_HOURS_1730) {
  return [
    candidate({ restaurantId: '3', dishId: '3-diner-0-0', name: 'Soep', priceValue: 12, priceDisplay: '€ 12,00', cuisine: 'Frans', openingHours }),
    candidate({ restaurantId: '4', dishId: '4-diner-0-0', name: 'Pasta', priceValue: 20, priceDisplay: '€ 20,00', cuisine: 'Italiaans', openingHours }),
    candidate({ restaurantId: '5', dishId: '5-diner-0-0', name: 'Steak', priceValue: 30, priceDisplay: '€ 30,00', cuisine: 'Grill', openingHours }),
  ];
}

function tomorrowLunchCandidates() {
  return [
    candidate({ restaurantId: '3', dishId: '3-lunch-0-0', mealType: 'lunch', name: 'Broodje', priceValue: 9, priceDisplay: '€ 9,00', cuisine: 'Frans', openingHours: TOMORROW_LUNCH_HOURS }),
    candidate({ restaurantId: '4', dishId: '4-lunch-0-0', mealType: 'lunch', name: 'Salade', priceValue: 18, priceDisplay: '€ 18,00', cuisine: 'Italiaans', openingHours: TOMORROW_LUNCH_HOURS }),
    candidate({ restaurantId: '5', dishId: '5-lunch-0-0', mealType: 'lunch', name: 'Toast', priceValue: 27, priceDisplay: '€ 27,00', cuisine: 'Grill', openingHours: TOMORROW_LUNCH_HOURS }),
  ];
}

test('BE-38: 16:30 met twee borrelrestaurants geeft "Straks op de kaart · vanaf 17:30"', () => {
  const selection = selectTonight({
    candidates: [...borrelCandidates(), ...dinerCandidates()],
    now: new Date(BORREL_1630),
  });
  assert.equal(selection.mode, 'later');
  assert.equal(selection.mealType, 'diner', 'de gerechten van het eerstvolgende moment');
  assert.equal(selection.title, 'Straks op de kaart · vanaf 17:30');
  assert.equal(selection.opensFrom, '17:30');
  assert.equal(selection.hidden, false);
  assert.equal(selection.dateKey, '2026-10-23');
  assert.deepEqual(selection.dishes.map((dish) => dish.name).sort(), ['Pasta', 'Soep', 'Steak']);
  for (const dish of selection.dishes) {
    assert.equal(dish.opensAt, '17:30');
    assert.equal(dish.mealType, 'diner');
  }
});

test('BE-38: "vanaf" is het vroegste moment van de getoonde gerechten, elk gerecht houdt zijn eigen tijd', () => {
  const candidates = [
    ...borrelCandidates(),
    candidate({ restaurantId: '3', dishId: '3-diner-0-0', name: 'Soep', priceValue: 12, priceDisplay: '€ 12,00', cuisine: 'Frans', openingHours: { vr: '18:00-22:00' } }),
    candidate({ restaurantId: '4', dishId: '4-diner-0-0', name: 'Pasta', priceValue: 20, priceDisplay: '€ 20,00', cuisine: 'Italiaans', openingHours: { vr: '17:30-22:00' } }),
    candidate({ restaurantId: '5', dishId: '5-diner-0-0', name: 'Steak', priceValue: 30, priceDisplay: '€ 30,00', cuisine: 'Grill', openingHours: { vr: '17:45-22:00' } }),
  ];
  const selection = selectTonight({ candidates, now: new Date(BORREL_1630) });
  assert.equal(selection.title, 'Straks op de kaart · vanaf 17:30');
  const byName = Object.fromEntries(selection.dishes.map((dish) => [dish.name, dish.opensAt]));
  assert.deepEqual(byName, { Soep: '18:00', Pasta: '17:30', Steak: '17:45' });
});

test('BE-38: is er genoeg voor dit moment, dan blijft de normale titel en heeft geen gerecht een tijd', () => {
  const enoughBorrel = [
    ...borrelCandidates(),
    candidate({ restaurantId: '7', dishId: '7-borrel-0-0', mealType: 'borrel', name: 'Kaasplank', priceValue: 14, priceDisplay: '€ 14,00', cuisine: 'Grill', openingHours: BORREL_HOURS }),
  ];
  const selection = selectTonight({
    candidates: [...enoughBorrel, ...dinerCandidates()],
    now: new Date(BORREL_1630),
  });
  assert.equal(selection.mode, 'now');
  assert.equal(selection.mealType, 'borrel');
  assert.equal(selection.title, 'Borrel');
  assert.equal(selection.opensFrom, null);
  assert.equal(selection.hidden, false);
  assert.equal(selection.dishes.length, 3);
  assert.equal(selection.dishes.every((dish) => dish.opensAt === null), true);
});

test('BE-38: 23:30 geeft "Morgen op de kaart" met de lunch van morgen', () => {
  const selection = selectTonight({
    candidates: [
      candidate({ restaurantId: '1', dishId: '1-diner-0-0', priceValue: 12, priceDisplay: '€ 12,00', openingHours: DINER_HOURS_1730 }),
      candidate({ restaurantId: '2', dishId: '2-diner-0-0', priceValue: 20, priceDisplay: '€ 20,00', cuisine: 'Italiaans', openingHours: DINER_HOURS_1730 }),
      ...tomorrowLunchCandidates(),
    ],
    now: new Date(LATE_EVENING),
  });
  assert.equal(selection.mode, 'tomorrow');
  assert.equal(selection.title, 'Morgen op de kaart');
  assert.equal(selection.mealType, 'lunch');
  assert.equal(selection.dateKey, '2026-10-24', 'de kalenderdag van morgen');
  assert.equal(selection.hidden, false);
  assert.equal(selection.dishes.length, 3);
  for (const dish of selection.dishes) {
    assert.equal(dish.mealType, 'lunch');
    assert.equal(dish.opensAt, '12:00', 'de openingstijd van morgen');
  }
});

test('BE-38: is er morgen ook niets, dan verdwijnt de sectie', () => {
  const selection = selectTonight({
    candidates: [
      candidate({ restaurantId: '1', dishId: '1-diner-0-0', priceValue: 12, priceDisplay: '€ 12,00', openingHours: DINER_HOURS_1730 }),
      candidate({ restaurantId: '2', dishId: '2-diner-0-0', priceValue: 20, priceDisplay: '€ 20,00', cuisine: 'Italiaans', openingHours: DINER_HOURS_1730 }),
    ],
    now: new Date(LATE_EVENING),
  });
  assert.equal(selection.hidden, true);
  assert.deepEqual(selection.dishes, []);

  const thinTomorrow = selectTonight({
    candidates: [
      // Het huidige moment heeft er maar twee, en de lunch van morgen ook:
      // nog steeds te weinig.
      ...dinerCandidates().slice(0, 2),
      ...tomorrowLunchCandidates().slice(0, 2),
    ],
    now: new Date(LATE_EVENING),
  });
  assert.equal(thinTomorrow.hidden, true, 'twee gerechten zijn geen reden om de sectie te tonen');
});

test('BE-38: de terugval slaat een leeg tussenliggend moment over', () => {
  const selection = selectTonight({
    candidates: [...borrelCandidates(), ...dinerCandidates()],
    now: new Date(LUNCHTIME),
  });
  assert.equal(selection.mode, 'later');
  assert.equal(selection.mealType, 'diner', 'borrel heeft maar twee gerechten, diner heeft er drie');
  assert.equal(selection.title, 'Straks op de kaart · vanaf 17:30');
});

test('BE-38: de terugval is deterministisch per dag, net als de normale selectie', () => {
  const candidates = [...borrelCandidates(), ...dinerCandidates()];
  const first = selectTonight({ candidates, now: new Date(BORREL_1630) });
  const again = selectTonight({ candidates, now: new Date(BORREL_1630) });
  assert.deepEqual(first, again);
});

test('BE-38: "vanaf" is nooit een openingstijd van vanochtend', () => {
  // Een zaak die om 12:00 al opengaat blijft voor de dinerkeuze vanaf 17:00
  // meetellen; het kwartier tussen 15:00 en 16:00 is diner (BE-29).
  assert.equal(availableFrom({ vr: '12:00-23:00' }, 'vr', 'diner'), 17 * 60);
  assert.equal(availableFrom({ vr: '17:30-22:00' }, 'vr', 'diner'), 17 * 60 + 30);
  assert.equal(availableFrom({ vr: '12:00-22:00' }, 'vr', 'lunch'), 12 * 60);
  assert.equal(availableFrom({ vr: '18:00-22:00' }, 'vr', 'borrel'), null);
  assert.equal(availableFrom({ za: '18:00-22:00' }, 'vr', 'diner'), null);
  assert.equal(availableFrom(null, 'vr', 'diner'), null);
});

test('BE-38: de klokhulp en de volgende kalenderdag rekenen in hele minuten en UTC', () => {
  assert.equal(clockLabel(17 * 60 + 30), '17:30');
  assert.equal(clockLabel(0), '00:00');
  assert.equal(clockLabel(23 * 60 + 59), '23:59');
  assert.deepEqual(dayAfter('2026-10-23'), { dateKey: '2026-10-24', dayKey: 'za' });
  assert.deepEqual(dayAfter('2026-10-31'), { dateKey: '2026-11-01', dayKey: 'zo' });
  assert.deepEqual(dayAfter('2026-12-31'), { dateKey: '2027-01-01', dayKey: 'vr' });
  assert.equal(dayAfter('geen datum'), null);
});

test('BE-38: de terugval hoeft geen nieuwe data, AI of willekeur', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs
    .readFileSync(path.join(__dirname, 'publicTonight.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /\bfetch\(|anthropic|openai/i);
});

// ─── BE-38 (#90): na sluitingstijd is er vandaag niets meer ────────────────

const DINER_HOURS_CLOSE_2300 = { vr: '17:30-23:00' };

test('BE-38: na sluitingstijd telt een restaurant dat vandaag al dicht is niet meer mee', () => {
  // Drie dinergerechten van zaken die om 23:00 sluiten: om 22:59 is het nog
  // "Vanavond op de kaart", om 23:30 is die dag voorbij en toont de home de
  // lunch van morgen in plaats van een kaart van gesloten keukens.
  const candidates = [...dinerCandidates(DINER_HOURS_CLOSE_2300), ...tomorrowLunchCandidates()];

  const beforeClosing = selectTonight({ candidates, now: new Date('2026-10-23T20:59:00Z') }); // 22:59 lokaal
  assert.equal(beforeClosing.mode, 'now');
  assert.equal(beforeClosing.title, 'Vanavond op de kaart');
  assert.equal(beforeClosing.dishes.length, MAX_DISHES);
  assert.equal(beforeClosing.dishes.every((dish) => dish.opensAt === null), true);

  const afterClosing = selectTonight({ candidates, now: new Date(LATE_EVENING) }); // 23:30 lokaal
  assert.equal(afterClosing.mode, 'tomorrow');
  assert.equal(afterClosing.title, 'Morgen op de kaart');
  assert.equal(afterClosing.dateKey, '2026-10-24');
  assert.equal(afterClosing.dishes.length, MAX_DISHES);
  assert.equal(afterClosing.dishes.every((dish) => dish.mealType === 'lunch'), true);
});

test('BE-38: na sluitingstijd zonder lunch van morgen verdwijnt de sectie', () => {
  const selection = selectTonight({
    candidates: dinerCandidates(DINER_HOURS_CLOSE_2300),
    now: new Date(LATE_EVENING),
  });
  assert.equal(selection.hidden, true, 'een gesloten keuken is geen reden om de sectie te tonen');
  assert.deepEqual(selection.dishes, []);
});

test('BE-38: momentAvailability geeft het "vanaf"-moment én de sluitingstijd van die dag', () => {
  assert.deepEqual(momentAvailability({ vr: '17:30-22:00' }, 'vr', 'diner'), { opens: 17 * 60 + 30, closes: 22 * 60 });
  assert.deepEqual(momentAvailability({ vr: '12:00-23:00' }, 'vr', 'diner'), { opens: 17 * 60, closes: 23 * 60 });
  assert.equal(momentAvailability({ vr: '18:00-22:00' }, 'vr', 'borrel'), null);
  assert.equal(momentAvailability({ za: '17:30-22:00' }, 'vr', 'diner'), null);
  assert.equal(momentAvailability(null, 'vr', 'diner'), null);
  // De "vanaf"-tijd blijft precies wat availableFrom al beloofde.
  for (const hours of [{ vr: '17:30-22:00' }, { vr: '12:00-23:00' }, { vr: '18:00-22:00' }, null]) {
    const availability = momentAvailability(hours, 'vr', 'diner');
    assert.equal(availableFrom(hours, 'vr', 'diner'), availability ? availability.opens : null);
  }
});

test('BE-38: met de echte data geeft 23:30 de lunch van morgen, uit dezelfde bron', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildTonightCandidates } = require('./publicTonightData');
  const root = path.join(__dirname, '..', '..');
  const menus = JSON.parse(fs.readFileSync(path.join(root, 'data/menus.json'), 'utf8'));

  const selection = selectTonight({ candidates: buildTonightCandidates(), now: new Date(LATE_EVENING) });
  assert.equal(selection.mode, 'tomorrow', 'na sluitingstijd toont de home morgen');
  assert.equal(selection.title, 'Morgen op de kaart');
  assert.equal(selection.mealType, 'lunch');
  assert.equal(selection.dateKey, '2026-10-24', 'zaterdag 24 oktober');
  assert.equal(selection.hidden, false);
  assert.equal(selection.dishes.length, MAX_DISHES);
  assert.equal(new Set(selection.dishes.map((dish) => dish.restaurantId)).size, MAX_DISHES);

  for (const dish of selection.dishes) {
    const idParts = dish.dishId.split('-');
    const itemIndex = Number(idParts.pop());
    const categoryIndex = Number(idParts.pop());
    const menuKey = idParts.join('-');
    assert.equal(dish.menuLink, `/menu/${menuKey}`);
    const sourceItem = menus[menuKey].categories[categoryIndex].items[itemIndex];
    assert.equal(sourceItem.name, dish.name, 'de getoonde naam bestaat letterlijk in de bron');
    assert.equal(sourceItem.price, dish.priceDisplay, 'de getoonde prijs is de bronprijs');
    assert.match(dish.opensAt, /^\d{2}:\d{2}$/, 'ook de lunch van morgen noemt zijn openingstijd');
  }
});