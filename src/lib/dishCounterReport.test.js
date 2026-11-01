'use strict';

// BE-45 (#114) — de rekenregels van de tellertabel.
//
// Hier staan de controles uit het contract die geen browser nodig hebben:
// optellen per periode en de UTC-daggrens, een onbekende `dish_key`, een
// ongeldige periode, de resolutie van gerecht en restaurant uit de echte
// menudata, de grens van 500 rijen en het sorteren.
//
// FICTIONELE DATA: de Supabase-rijen hieronder zijn verzonnen. De laatste test
// gebruikt de echte data/menus.json en data/restaurants.json, zodat de
// gerechtnaam, de restaurantnaam en de deeplink aantoonbaar uit de bestaande
// resolutie komen en niet uit een tweede, eigen interpretatie.

const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../test-fixtures/useFrozenData').useFrozenData();

const {
  COLUMNS,
  DEFAULT_PERIOD,
  DEFAULT_SORT,
  EMPTY_MESSAGE,
  FORBIDDEN_MESSAGE,
  MAX_ROWS,
  PERIODS,
  SORT_OPTIONS,
  TRUNCATED_MESSAGE,
  UNAVAILABLE_MESSAGE,
  UNKNOWN_DISH_LABEL,
  aggregateCounterRows,
  buildTellersReport,
  nextSort,
  normalizePeriod,
  parseSortOption,
  periodDays,
  periodLabel,
  periodRange,
  resolveReportRow,
  resolveSort,
  sortOptionValue,
  sortRows,
  utcDayOf,
} = require('./dishCounterReport');

const MENUS = {
  '7-diner': {
    name: 'Fictief Restaurant',
    categories: [
      {
        name: 'Voorgerechten',
        items: [{ name: 'Tomatensoep' }, { name: 'Bitterballen' }],
      },
    ],
  },
};
const RESTAURANTS = { 7: { name: 'Fictief Restaurant' } };

function counterRow(dishKey, day, shared, saved, reservationClicks) {
  return {
    dish_key: dishKey,
    day,
    shared,
    saved,
    reservation_clicks: reservationClicks,
  };
}

test('periode: alleen vandaag, 7 en 30 zijn geldig; al het andere wordt 7', () => {
  assert.deepEqual(PERIODS.map((period) => period.id), ['vandaag', '7', '30']);
  assert.equal(normalizePeriod('vandaag'), 'vandaag');
  assert.equal(normalizePeriod('7'), '7');
  assert.equal(normalizePeriod('30'), '30');
  assert.equal(normalizePeriod(' Vandaag '), 'vandaag');
  for (const invalid of ['14', '', ' ', null, undefined, 'week', '0', '-7', 7, {}]) {
    assert.equal(normalizePeriod(invalid), DEFAULT_PERIOD, `ongeldige periode ${String(invalid)} valt terug op 7`);
  }
  assert.equal(DEFAULT_PERIOD, '7');
  assert.equal(periodDays('vandaag'), 1);
  assert.equal(periodDays('7'), 7);
  assert.equal(periodDays('30'), 30);
  assert.equal(periodLabel('7'), '7 dagen');
  assert.equal(periodLabel('onzin'), '7 dagen');
});

test('periode: de grenzen zijn UTC-kalenderdagen, inclusief vandaag', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.deepEqual(periodRange('vandaag', now), { periode: 'vandaag', dagen: 1, van: '2026-10-29', tot: '2026-10-29' });
  assert.deepEqual(periodRange('7', now), { periode: '7', dagen: 7, van: '2026-10-23', tot: '2026-10-29' });
  assert.deepEqual(periodRange('30', now), { periode: '30', dagen: 30, van: '2026-09-30', tot: '2026-10-29' });
  assert.deepEqual(periodRange('14', now), periodRange('7', now), 'een ongeldige periode gebruikt de 7-daagse grens');

  // De UTC-dag telt, niet de lokale dag van de server: 23:59 UTC is nog
  // dezelfde dag, 00:00 UTC is de volgende.
  assert.equal(utcDayOf(new Date('2026-10-29T23:59:59Z')), '2026-10-29');
  assert.equal(utcDayOf(new Date('2026-10-30T00:00:00Z')), '2026-10-30');
  assert.equal(utcDayOf(new Date('2026-10-30T01:30:00+02:00')), '2026-10-29', '01:30 in Brussel is 23:30 UTC');
  assert.equal(periodRange('vandaag', new Date('2026-10-30T00:00:01Z')).tot, '2026-10-30');
  assert.deepEqual(periodRange('7', new Date('invalid')), { periode: '7', dagen: 7, van: null, tot: null });
});

test('optellen: twee dagen van één gerecht worden één rij met de opgetelde waarden', () => {
  const rows = [
    counterRow('7-diner-0-0', '2026-10-27', 3, 1, 0),
    counterRow('7-diner-0-0', '2026-10-29', 2, 0, 4),
    counterRow('7-diner-0-1', '2026-10-28', 1, 5, 1),
  ];
  const aggregated = aggregateCounterRows(rows);
  assert.deepEqual(aggregated, [
    { dishKey: '7-diner-0-0', gedeeld: 5, bewaard: 1, reserveren: 4 },
    { dishKey: '7-diner-0-1', gedeeld: 1, bewaard: 5, reserveren: 1 },
  ]);

  const report = buildTellersReport({ periode: '7', rows, menus: MENUS, restaurants: RESTAURANTS });
  assert.equal(report.rijen.length, 2, 'één rij per gerecht, niet per dag');
  assert.equal(report.rijen[0].gerecht, 'Tomatensoep');
  assert.equal(report.rijen[0].gedeeld, 5);
  assert.equal(report.rijen[0].bewaard, 1);
  assert.equal(report.rijen[0].reserveren, 4);
  assert.deepEqual(report.totalen, { gedeeld: 6, bewaard: 6, reserveren: 5 });
});

test('optellen: een rij buiten de periode en een onbruikbare rij tellen niet mee', () => {
  const range = periodRange('7', new Date('2026-10-29T12:00:00Z'));
  const rows = [
    counterRow('7-diner-0-0', '2026-10-23', 1, 0, 0),
    counterRow('7-diner-0-0', '2026-10-22', 9, 9, 9), // één dag te oud
    counterRow('7-diner-0-0', '2026-10-30', 9, 9, 9), // morgen
    counterRow('', '2026-10-29', 9, 9, 9),
    counterRow(null, '2026-10-29', 9, 9, 9),
    counterRow('x'.repeat(97), '2026-10-29', 9, 9, 9),
    null,
    'geen rij',
  ];
  assert.deepEqual(aggregateCounterRows(rows, range), [
    { dishKey: '7-diner-0-0', gedeeld: 1, bewaard: 0, reserveren: 0 },
  ]);
  // Zonder periodegrens telt elke bruikbare rij mee (drie dagen van hetzelfde gerecht).
  assert.deepEqual(aggregateCounterRows(rows), [
    { dishKey: '7-diner-0-0', gedeeld: 19, bewaard: 18, reserveren: 18 },
  ]);
});

test('optellen: een negatief of niet-geheel aantal telt als 0, nooit als schuld', () => {
  const rows = [
    { dish_key: '7-diner-0-0', day: '2026-10-29', shared: -3, saved: 1.5, reservation_clicks: '7' },
  ];
  assert.deepEqual(aggregateCounterRows(rows), [
    { dishKey: '7-diner-0-0', gedeeld: 0, bewaard: 0, reserveren: 7 },
  ]);
});

test('onbekende dish_key: blijft staan, met de sleutel als naam en "onbekend gerecht"', () => {
  const report = buildTellersReport({
    periode: '7',
    rows: [counterRow('7-diner-9-9', '2026-10-29', 4, 2, 1)],
    menus: MENUS,
    restaurants: RESTAURANTS,
  });
  assert.equal(report.rijen.length, 1, 'een onbekend gerecht wordt nooit weggegooid');
  const row = report.rijen[0];
  assert.equal(row.dishKey, '7-diner-9-9');
  assert.equal(row.gerecht, '7-diner-9-9');
  assert.equal(row.restaurant, 'Fictief Restaurant', 'het restaurant van de menukaart blijft bekend');
  assert.equal(row.restaurantId, '7');
  assert.equal(row.onbekend, true);
  assert.equal(row.href, null, 'een onbekend gerecht heeft geen link naar een gerechtpagina');
  assert.equal(UNKNOWN_DISH_LABEL, 'onbekend gerecht');
  assert.deepEqual(report.totalen, { gedeeld: 4, bewaard: 2, reserveren: 1 }, 'de tellingen blijven in de totalen');
});

test('onbekende menukaart: geen restaurant, geen link, maar wel een eerlijke rij', () => {
  const row = resolveReportRow(
    { dishKey: '99-diner-0-0', gedeeld: 2, bewaard: 0, reserveren: 0 },
    MENUS,
    RESTAURANTS
  );
  assert.equal(row.gerecht, '99-diner-0-0');
  assert.equal(row.restaurant, '');
  assert.equal(row.restaurantId, '99');
  assert.equal(row.href, null);
  assert.equal(row.onbekend, true);
});

test('een sleutel zonder geldige vorm blijft staan zonder restaurant en zonder crash', () => {
  const report = buildTellersReport({
    periode: '7',
    rows: [counterRow('geen-positie', '2026-10-29', 1, 1, 1)],
    menus: MENUS,
    restaurants: RESTAURANTS,
  });
  assert.equal(report.rijen.length, 1);
  assert.deepEqual(
    { gerecht: report.rijen[0].gerecht, restaurantId: report.rijen[0].restaurantId, onbekend: report.rijen[0].onbekend },
    { gerecht: 'geen-positie', restaurantId: null, onbekend: true }
  );
});

test('sorteren: standaard "Gedeeld" aflopend, en elke kolom sorteert echt', () => {
  const rows = [
    { dishKey: 'a', gerecht: 'Bitterballen', restaurant: 'De Twee', gedeeld: 2, bewaard: 9, reserveren: 0 },
    { dishKey: 'b', gerecht: 'appeltaart', restaurant: 'De Een', gedeeld: 10, bewaard: 1, reserveren: 5 },
    { dishKey: 'c', gerecht: 'Tomatensoep', restaurant: 'De Een', gedeeld: 2, bewaard: 4, reserveren: 7 },
  ];
  assert.deepEqual(DEFAULT_SORT, { kolom: 'gedeeld', richting: 'aflopend' });
  assert.deepEqual(sortRows(rows).map((row) => row.dishKey), ['b', 'a', 'c'], 'gelijk blijft in zijn eigen volgorde');
  assert.deepEqual(sortRows(rows, { kolom: 'gedeeld', richting: 'oplopend' }).map((row) => row.dishKey), ['a', 'c', 'b']);
  assert.deepEqual(sortRows(rows, { kolom: 'bewaard', richting: 'aflopend' }).map((row) => row.dishKey), ['a', 'c', 'b']);
  assert.deepEqual(sortRows(rows, { kolom: 'reserveren', richting: 'aflopend' }).map((row) => row.dishKey), ['c', 'b', 'a']);
  // Tekst sorteert met de Nederlandse collatie: "appeltaart" voor "Bitterballen".
  assert.deepEqual(sortRows(rows, { kolom: 'gerecht', richting: 'oplopend' }).map((row) => row.gerecht), ['appeltaart', 'Bitterballen', 'Tomatensoep']);
  assert.deepEqual(sortRows(rows, { kolom: 'restaurant', richting: 'oplopend' }).map((row) => row.dishKey), ['b', 'c', 'a']);
  // De invoer blijft ongemoeid.
  assert.deepEqual(rows.map((row) => row.dishKey), ['a', 'b', 'c']);
  // Onbekende kolom of richting valt terug op de standaardsortering.
  assert.deepEqual(resolveSort({ kolom: 'onbekend', richting: 'zijwaarts' }), DEFAULT_SORT);
  assert.deepEqual(resolveSort(null), DEFAULT_SORT);
  assert.deepEqual(resolveSort({ kolom: 'gerecht' }), { kolom: 'gerecht', richting: 'oplopend' });
});

test('sorteren: een klik op dezelfde kolom keert om, een andere kolom begint met zijn eigen richting', () => {
  assert.deepEqual(nextSort(DEFAULT_SORT, 'gedeeld'), { kolom: 'gedeeld', richting: 'oplopend' });
  assert.deepEqual(nextSort(nextSort(DEFAULT_SORT, 'gedeeld'), 'gedeeld'), DEFAULT_SORT);
  assert.deepEqual(nextSort(DEFAULT_SORT, 'gerecht'), { kolom: 'gerecht', richting: 'oplopend' });
  assert.deepEqual(nextSort(DEFAULT_SORT, 'bewaard'), { kolom: 'bewaard', richting: 'aflopend' });
  assert.deepEqual(nextSort(DEFAULT_SORT, 'onbekend'), DEFAULT_SORT);
});

test('de tabel sorteert standaard op Gedeeld, aflopend, ook in het API-antwoord', () => {
  const rows = [
    counterRow('7-diner-0-0', '2026-10-29', 1, 0, 0),
    counterRow('7-diner-0-1', '2026-10-29', 9, 0, 0),
  ];
  const report = buildTellersReport({ periode: '7', rows, menus: MENUS, restaurants: RESTAURANTS });
  assert.deepEqual(report.rijen.map((row) => [row.gerecht, row.gedeeld]), [['Bitterballen', 9], ['Tomatensoep', 1]]);
  assert.deepEqual(COLUMNS.map((column) => column.label), ['Gerecht', 'Restaurant', 'Gedeeld', 'Bewaard', 'Reserveer']);
});

test('maximaal 500 rijen, terwijl de totalen over alle gerechten gaan', () => {
  const rows = [];
  for (let index = 0; index < MAX_ROWS + 20; index += 1) {
    rows.push(counterRow(`7-diner-0-${index}`, '2026-10-29', 1, 1, 1));
  }
  const report = buildTellersReport({ periode: '7', rows, menus: MENUS, restaurants: RESTAURANTS });
  assert.equal(MAX_ROWS, 500);
  assert.equal(report.rijen.length, MAX_ROWS);
  assert.equal(report.aantalGerechten, MAX_ROWS + 20);
  assert.deepEqual(report.totalen, { gedeeld: MAX_ROWS + 20, bewaard: MAX_ROWS + 20, reserveren: MAX_ROWS + 20 });
  assert.match(TRUNCATED_MESSAGE, /500/);
});

test('de teksten van de lege staat, de foutstaat en het verbod staan vast', () => {
  assert.equal(EMPTY_MESSAGE, 'Nog geen tellingen in deze periode.');
  assert.equal(UNAVAILABLE_MESSAGE, 'Tellers zijn nu niet beschikbaar.');
  assert.equal(FORBIDDEN_MESSAGE, 'Alleen interne medewerkers kunnen de tellers zien.');
  const empty = buildTellersReport({ periode: '30', rows: [], menus: MENUS, restaurants: RESTAURANTS });
  assert.deepEqual(empty, {
    periode: '30',
    totalen: { gedeeld: 0, bewaard: 0, reserveren: 0 },
    rijen: [],
    aantalGerechten: 0,
  });
  const noRows = buildTellersReport();
  assert.deepEqual(noRows.rijen, []);
  assert.equal(noRows.periode, DEFAULT_PERIOD);
});

test('echte menudata: naam, restaurant en deeplink komen uit de bestaande resolutie', () => {
  const menus = require('../../data/menus.json');
  const restaurants = require('../../data/restaurants.json');
  const { dishIdOf } = require('./dishList');
  const { resolveDishTarget } = require('./dishDeepLink');

  const menuId = Object.keys(menus)[0];
  const menu = menus[menuId];
  const category = menu.categories[0];
  const item = category.items[0];
  const dishKey = dishIdOf({ menuId, catIdx: 0, itemIdx: 0 });
  const restaurantId = menuId.split('-')[0];

  const report = buildTellersReport({
    periode: 'vandaag',
    rows: [counterRow(dishKey, '2026-10-29', 2, 1, 3)],
    menus,
    restaurants,
  });
  const row = report.rijen[0];
  assert.equal(row.dishKey, dishKey);
  assert.equal(row.gerecht, item.name, 'de echte gerechtnaam uit de menukaart');
  assert.equal(row.restaurantId, restaurantId);
  assert.equal(row.restaurant, restaurants[restaurantId].name, 'de echte restaurantnaam, net als het lijstje');
  assert.equal(row.onbekend, false);
  assert.ok(row.href, 'een bekend gerecht heeft een publieke deeplink');
  // De link is tevens een geldige BE-12-deeplink: precies dit gerecht, op deze
  // categorie, met deze naam — dezelfde lezer als de menupagina.
  const url = new URL(row.href, 'http://localhost');
  assert.equal(url.pathname, `/menu/${menuId}`);
  assert.equal(url.searchParams.get('dish'), dishKey);
  assert.equal(url.searchParams.get('name'), item.name);
  assert.equal(url.searchParams.get('cat'), category.name);
  const target = resolveDishTarget(
    url.searchParams.get('dish'),
    url.searchParams.get('name'),
    url.searchParams.get('cat'),
    menuId,
    menu.categories
  );
  assert.deepEqual(target, { catIdx: 0, itemIdx: 0 });
});

test('de keuzelijst van de telefoon biedt kolom én richting, en leest ze terug', () => {
  assert.deepEqual(SORT_OPTIONS.map((option) => option.value), [
    'gerecht:oplopend',
    'restaurant:oplopend',
    'gedeeld:aflopend',
    'gedeeld:oplopend',
    'bewaard:aflopend',
    'bewaard:oplopend',
    'reserveren:aflopend',
    'reserveren:oplopend',
  ]);
  assert.equal(sortOptionValue(DEFAULT_SORT), 'gedeeld:aflopend');
  assert.equal(sortOptionValue({ kolom: 'gerecht', richting: 'oplopend' }), 'gerecht:oplopend');
  assert.deepEqual(parseSortOption('bewaard:oplopend'), { kolom: 'bewaard', richting: 'oplopend' });
  assert.deepEqual(parseSortOption('reserveren:aflopend'), { kolom: 'reserveren', richting: 'aflopend' });
  // Onbekend of half ingevuld valt terug, nooit een lege sortering.
  assert.deepEqual(parseSortOption('onbekend:aflopend'), DEFAULT_SORT);
  assert.deepEqual(parseSortOption(''), DEFAULT_SORT);
  assert.deepEqual(parseSortOption(null), DEFAULT_SORT);
  assert.deepEqual(parseSortOption('gerecht'), { kolom: 'gerecht', richting: 'oplopend' });
  assert.deepEqual(parseSortOption('gedeeld:zijwaarts'), { kolom: 'gedeeld', richting: 'aflopend' });
  // Elke optie uit de lijst komt terug als dezelfde sortering.
  for (const option of SORT_OPTIONS) {
    assert.equal(sortOptionValue(parseSortOption(option.value)), option.value);
  }
});
