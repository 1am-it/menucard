'use strict';

// BE-42 (#98) — 2A: unit-tests voor het kaartmodel van de restaurantpagina.
// Geen browser, geen React, geen echte data: kleine fixtures, zodat de vaste
// volgorde, de standaardkaart, de tabkeuze en het "maar één kaart"-principe
// precies te bewijzen zijn. Zelfde conventie als src/lib/restaurantBrowse.test.js.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MENU_ACTION,
  MENU_TAB_ORDER,
  MENU_TITLES,
  FALLBACK_TITLE,
  mealTypeOf,
  menuTitleOf,
  dishCountOf,
  orderMenuIds,
  menuTabHref,
  restaurantMenus,
  restaurantForView,
} = require('./menuTabs');

const MENUS = {
  '7-lunch': {
    subtitle: 'Lunchkaart',
    scraped: '2026-03-24',
    source: 'https://example.invalid/lunch.pdf',
    categories: [
      { name: 'Broodjes', items: [{ name: 'Broodje kaas', price: '€ 6,50' }, { name: 'Broodje ham', price: '€ 7,00' }] },
      { name: 'Soep', items: [{ name: 'Tomatensoep', price: '€ 5,00' }] },
    ],
  },
  '7-diner': {
    subtitle: 'Dinerkaart',
    scraped: '2026-03-25',
    source: 'https://example.invalid/diner.pdf',
    categories: [
      { name: 'Voor', items: [{ name: 'Carpaccio', price: '€ 12,50' }] },
      { name: 'Hoofd', items: [{ name: 'Steak', price: '€ 24,00' }, { name: 'Vis van de dag', price: null }] },
    ],
  },
  '7-borrel': {
    subtitle: 'Borrelkaart',
    categories: [{ name: 'Hapjes', items: [{ name: 'Bitterballen', price: '€ 6,00' }] }],
  },
  '7-specialiteiten': {
    subtitle: 'Specialiteiten',
    categories: [{ name: 'Chef', items: [{ name: 'Seizoensmenu', price: '€ 42,50' }] }],
  },
  '8-diner': {
    subtitle: 'Dinerkaart',
    categories: [{ name: 'Hoofd', items: [{ name: 'Vreemde steak', price: '€ 20,00' }] }],
  },
};

const LINKS = [
  { id: '7-specialiteiten', label: '⭐ Specialiteiten' },
  { id: '7-borrel', label: '🍸 Borrelkaart' },
  { id: '7-diner', label: '🍽 Dinerkaart' },
  { id: '7-lunch', label: '🥗 Lunchkaart' },
];

const model = (requested) => restaurantMenus({ restaurantId: '7', menuLinks: LINKS, menus: MENUS, requested });
const ids = (result) => result.tabs.map((tab) => tab.id);

test('BE-42 2A: het menutype komt uit het kaart-id', () => {
  assert.equal(mealTypeOf('7-lunch'), 'lunch');
  assert.equal(mealTypeOf('7-specialiteiten'), 'specialiteiten');
  assert.equal(mealTypeOf('7-menukaart'), 'menukaart');
  assert.equal(mealTypeOf('menukaart'), '');
  assert.equal(mealTypeOf(null), '');
});

test('BE-42 2A: de tabnaam is de echte kaartnaam, met een eerlijke terugval', () => {
  assert.equal(menuTitleOf('7-lunch', MENUS['7-lunch']), 'Lunchkaart');
  assert.equal(menuTitleOf('7-diner', MENUS['7-diner']), 'Dinerkaart');
  assert.equal(menuTitleOf('7-borrel', MENUS['7-borrel']), 'Borrelkaart');
  assert.equal(menuTitleOf('7-specialiteiten', MENUS['7-specialiteiten']), 'Specialiteiten');
  // Onbekend menutype: de eigen titel van de kaart, anders de ondertitel.
  assert.equal(menuTitleOf('7-menukaart', { title: 'Wijnkaart' }), 'Wijnkaart');
  assert.equal(menuTitleOf('7-menukaart', { subtitle: 'Proef het seizoen' }), 'Proef het seizoen');
  assert.equal(menuTitleOf('7-menukaart', null), FALLBACK_TITLE);
  assert.deepEqual(MENU_TITLES, {
    lunch: 'Lunchkaart',
    diner: 'Dinerkaart',
    borrel: 'Borrelkaart',
    specialiteiten: 'Specialiteiten',
  });
});

test('BE-42 2A: de vaste volgorde is lunch, diner, borrel, daarna overige', () => {
  assert.deepEqual(MENU_TAB_ORDER, ['lunch', 'diner', 'borrel']);
  assert.deepEqual(
    orderMenuIds(['7-specialiteiten', '7-borrel', '7-diner', '7-lunch']),
    ['7-lunch', '7-diner', '7-borrel', '7-specialiteiten']
  );
  // Twee "overige" kaarten houden hun eigen (kaartlink)volgorde.
  assert.deepEqual(
    orderMenuIds(['7-wijn', '7-specialiteiten', '7-lunch']),
    ['7-lunch', '7-wijn', '7-specialiteiten']
  );
});

test('BE-42 2A: de tabbladen staan in de vaste volgorde met hun aantal gerechten', () => {
  const result = model();
  assert.deepEqual(ids(result), ['7-lunch', '7-diner', '7-borrel', '7-specialiteiten']);
  assert.deepEqual(
    result.tabs.map((tab) => `${tab.label} ${tab.dishCount}`),
    ['Lunchkaart 3', 'Dinerkaart 3', 'Borrelkaart 1', 'Specialiteiten 1']
  );
});

test('BE-42 2A: elk tabblad is een echte link naar die kaart (?kaart=<id>)', () => {
  const result = model();
  assert.equal(MENU_ACTION, 'kaart');
  for (const tab of result.tabs) {
    assert.equal(tab.href, `/restaurant/7?kaart=${tab.id}`);
    assert.match(tab.href, new RegExp(`^/restaurant/7\\?kaart=${tab.id}$`));
  }
  assert.equal(menuTabHref('7', '7-diner'), '/restaurant/7?kaart=7-diner');
});

test('BE-42 2A: het standaardtabblad is de eerste kaart in de volgorde (lunch), zonder klok', () => {
  const result = model();
  assert.equal(result.activeId, '7-lunch');
  assert.deepEqual(result.tabs.filter((tab) => tab.active).map((tab) => tab.id), ['7-lunch']);
  // De standaardkeuze hangt niet van tijd, datum of toeval af: de module bevat
  // geen klok en geen random, dus de server-HTML is altijd dezelfde.
  const source = fs.readFileSync(path.join(__dirname, 'menuTabs.js'), 'utf8');
  assert.doesNotMatch(source, /\bnew Date\b|Date\.now|Math\.random|Intl\./, 'the default tab must not depend on the clock');
});

test('BE-42 2A: een gekozen kaart is het enige actieve tabblad', () => {
  for (const menuId of ['7-lunch', '7-diner', '7-borrel', '7-specialiteiten']) {
    const result = model(menuId);
    assert.equal(result.activeId, menuId);
    assert.deepEqual(result.tabs.filter((tab) => tab.active).map((tab) => tab.id), [menuId]);
    assert.equal(result.activeMenu.id, menuId);
  }
});

test('BE-42 2A: de kaartkeuze valt terug op de standaardkaart bij een onbekende of vreemde kaart', () => {
  for (const requested of ['7-wijn', '8-diner', 'lunch', '', null, undefined, ['7-diner', '7-lunch'], 6]) {
    const result = model(requested);
    assert.equal(result.activeId, '7-lunch', `requested ${JSON.stringify(requested)} must fall back to the default`);
  }
});

test('BE-42 2A: het model draagt alleen de gekozen kaart, nooit alle kaarten', () => {
  const result = model('7-borrel');
  assert.deepEqual(result.activeMenu.categories.map((category) => category.name), ['Hapjes']);
  const serialized = JSON.stringify(result);
  // Gerechten van de andere kaarten van hetzelfde restaurant staan er niet in.
  for (const dish of ['Broodje kaas', 'Carpaccio', 'Steak', 'Seizoensmenu']) {
    assert.ok(!serialized.includes(dish), `the model must not carry the dish "${dish}" of another menu`);
  }
  // En van een ander restaurant al helemaal niet.
  assert.ok(!serialized.includes('Vreemde steak'));
});

test('BE-42 2A: de bronregel en de link naar de originele kaart gaan mee met de gekozen kaart', () => {
  const result = model('7-diner');
  assert.equal(result.activeMenu.source, 'https://example.invalid/diner.pdf');
  assert.equal(result.activeMenu.scraped, '2026-03-25');
  assert.equal(result.activeMenu.dishCount, 3);
  const lunch = model('7-lunch').activeMenu;
  assert.equal(lunch.source, 'https://example.invalid/lunch.pdf');
  assert.equal(lunch.notes, null);
});

test('BE-42 2A: het restaurantrecord gaat zonder zijn tweede kopie van alle kaarten naar de browser', () => {
  const record = {
    name: 'Fictief',
    address: 'Straat 1',
    menuLinks: [{ id: '7-lunch' }],
    menus: { '7-lunch': { categories: [{ name: 'Broodjes', items: [{ name: 'Broodje kaas' }] }] } },
  };
  const view = restaurantForView(record);
  assert.deepEqual(Object.keys(view), ['name', 'address', 'menuLinks']);
  assert.ok(!('menus' in view), 'the embedded copy of all menus is stripped');
  assert.ok(!JSON.stringify(view).includes('Broodje kaas'), 'no dish of any menu travels along');
  // De bron blijft onaangeroerd: dit is geen datawijziging.
  assert.ok(record.menus && record.menus['7-lunch'], 'the source record is not mutated');
  // Zonder dat veld (of zonder restaurant) verandert er niets.
  assert.deepEqual(restaurantForView({ name: 'Zonder kaarten' }), { name: 'Zonder kaarten' });
  assert.equal(restaurantForView(null), null);
  assert.equal(restaurantForView(undefined), null);
});

test('BE-42 2A: zonder gepubliceerde kaart of zonder data is er geen tabmodel', () => {
  assert.equal(restaurantMenus({ restaurantId: '7', menuLinks: [], menus: MENUS }), null);
  assert.equal(restaurantMenus({ restaurantId: '9', menuLinks: LINKS, menus: MENUS }), null);
  assert.equal(restaurantMenus({ restaurantId: '7', menuLinks: [{ id: '7-wijn' }], menus: MENUS }), null);
  assert.equal(restaurantMenus(), null);
  assert.equal(restaurantMenus({ restaurantId: '7', menuLinks: LINKS, menus: null }), null);
});

test('BE-42 2A: een restaurant met één kaart houdt één tabblad en geen tweede keuze', () => {
  const result = restaurantMenus({
    restaurantId: '8',
    menuLinks: [{ id: '8-diner', label: '🍽 Dinerkaart' }],
    menus: MENUS,
    requested: '8-diner',
  });
  assert.deepEqual(ids(result), ['8-diner']);
  assert.equal(result.activeId, '8-diner');
  assert.equal(result.tabs[0].dishCount, 1);
  assert.equal(result.activeMenu.categories.length, 1);
});

test('BE-42 2A: het aantal gerechten telt de hele kaart over alle menukopjes', () => {
  assert.equal(dishCountOf(MENUS['7-lunch']), 3);
  assert.equal(dishCountOf(MENUS['7-diner']), 3);
  assert.equal(dishCountOf({ categories: [] }), 0);
  assert.equal(dishCountOf({}), 0);
  assert.equal(dishCountOf(null), 0);
});
