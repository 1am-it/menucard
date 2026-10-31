'use strict';

// BE-57 (#139, deel 1) — de cijfers van "Mijn restaurant", de rekenregels.
//
// Zonder Supabase, React of netwerk. Wat hier bewezen wordt:
//   - de privacydrempel: elk getal onder 5 is "minder dan 5";
//   - "Deze week" tegenover "vorige week" in UTC-dagen, en een verschil alleen
//     als beide weken de drempel halen;
//   - de top 4, met bekeken + bewaard + gedeeld opgeteld per gerecht;
//   - "favoriet in Samen kiezen" = de "lekker"-stemmen van dit restaurant;
//   - zonder gegevens de stand "nog geen cijfers".

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  COMPARE_UNAVAILABLE_LABEL,
  MINIMUM_VISIBLE,
  NO_DATA_MESSAGE,
  NO_DATA_STATUS,
  READY_STATUS,
  TOP_LIMIT,
  UNDER_MINIMUM_LABEL,
  WEEK_METRICS,
  aggregateDishCounts,
  buildWeekOverview,
  formatCount,
  isVisibleCount,
  noDataState,
  periodTotals,
  restaurantOfDishKey,
  topDishes,
  weekChange,
  weekWindow,
} = require('./ownerRestaurantStats');

// Vaste klok: donderdag 29 oktober 2026, 12:00 UTC.
const NOW = new Date('2026-10-29T12:00:00.000Z');
const DAYS = {
  today: '2026-10-29',
  yesterday: '2026-10-28',
  weekStart: '2026-10-23',
  lastWeekEnd: '2026-10-22',
  lastWeekStart: '2026-10-16',
  tooOld: '2026-10-15',
};
const DISH_A = '6-diner-0-0';
const DISH_B = '6-diner-0-1';
const DISH_C = '6-diner-1-0';
const DISH_D = '6-lunch-0-0';
const DISH_E = '6-lunch-0-1';

test('cijfers: de privacydrempel is 5 en alles daaronder is "minder dan 5"', () => {
  assert.equal(MINIMUM_VISIBLE, 5);
  assert.equal(UNDER_MINIMUM_LABEL, 'minder dan 5');
  assert.equal(formatCount(0), UNDER_MINIMUM_LABEL);
  assert.equal(formatCount(1), UNDER_MINIMUM_LABEL);
  assert.equal(formatCount(4), UNDER_MINIMUM_LABEL);
  assert.equal(formatCount(5), '5');
  assert.equal(formatCount(12), '12');
  // Rommel telt als 0: nooit "NaN" of een negatief getal op het scherm.
  assert.equal(formatCount(-3), UNDER_MINIMUM_LABEL);
  assert.equal(formatCount('7'), '7');
  assert.equal(formatCount(null), UNDER_MINIMUM_LABEL);
  assert.equal(isVisibleCount(4), false);
  assert.equal(isVisibleCount(5), true);
});

test('cijfers: de vier cijfers van het contract staan in vaste volgorde', () => {
  assert.deepEqual(WEEK_METRICS.map((metric) => metric.id), ['bekeken', 'bewaard', 'gedeeld', 'favoriet']);
  assert.deepEqual(WEEK_METRICS.map((metric) => metric.label), [
    'keer bekeken',
    'keer bewaard',
    'keer gedeeld',
    'keer favoriet in Samen kiezen',
  ]);
});

test('cijfers: deze week is zeven UTC-dagen, vorige week de zeven daarvoor', () => {
  const range = weekWindow(NOW);
  assert.deepEqual(range.week, { van: DAYS.weekStart, tot: DAYS.today });
  assert.deepEqual(range.vorigeWeek, { van: DAYS.lastWeekStart, tot: DAYS.lastWeekEnd });
  // BE-57 deel 2: de afgelopen maand loopt dertig UTC-dagen terug tot vandaag.
  assert.deepEqual(range.maand, { van: '2026-09-30', tot: DAYS.today });
  // Een onbruikbare klok levert geen periode op (en dus geen cijfers).
  const empty = { van: null, tot: null };
  assert.deepEqual(weekWindow('geen datum'), { week: { ...empty }, vorigeWeek: { ...empty }, maand: { ...empty } });
});

test('cijfers: de vergelijking met vorige week', () => {
  const more = weekChange(12, 7);
  assert.equal(more.delta, 5);
  assert.equal(more.direction, 'meer');
  assert.equal(more.label, '5 meer dan vorige week');
  assert.equal(more.comparable, true);

  const less = weekChange(7, 12);
  assert.equal(less.direction, 'minder');
  assert.equal(less.label, '5 minder dan vorige week');

  const same = weekChange(9, 9);
  assert.equal(same.direction, 'gelijk');
  assert.equal(same.label, 'gelijk aan vorige week');

  // Onder de drempel geen verschil tonen: dat zou over een paar gasten zeggen.
  for (const [current, previous] of [[4, 9], [9, 4], [3, 1], [0, 0]]) {
    const change = weekChange(current, previous);
    assert.equal(change.comparable, false, `${current}/${previous}`);
    assert.equal(change.direction, null);
    assert.equal(change.label, COMPARE_UNAVAILABLE_LABEL);
  }
});

test('cijfers: de top 4 telt bekeken, bewaard en gedeeld per gerecht op', () => {
  const rows = [
    { dish_key: DISH_A, day: DAYS.today, saved: 2, shared: 3 },
    { dish_key: DISH_A, day: DAYS.yesterday, saved: 1, shared: 0 },
    { dish_key: DISH_B, day: DAYS.today, saved: 4, shared: 4 },
    { dish_key: DISH_C, day: DAYS.today, saved: 0, shared: 1 },
    { dish_key: DISH_D, day: DAYS.today, saved: 1, shared: 1 },
    { dish_key: DISH_E, day: DAYS.today, saved: 0, shared: 0 },
    // Een rij met een bekeken-aantal telt mee zodra dat veld bestaat.
    { dish_key: '6-diner-2-0', day: DAYS.today, viewed: 9, saved: 0, shared: 0 },
  ];
  const aggregated = aggregateDishCounts(rows);
  const dishA = aggregated.find((entry) => entry.dishKey === DISH_A);
  assert.deepEqual(dishA, { dishKey: DISH_A, viewed: 0, saved: 3, shared: 3, total: 6 });

  const top = topDishes(rows);
  assert.equal(top.length, TOP_LIMIT, 'hooguit vier gerechten');
  assert.deepEqual(top.map((entry) => entry.dishKey), ['6-diner-2-0', DISH_B, DISH_A, DISH_D]);
  assert.deepEqual(top.map((entry) => entry.total), [9, 8, 6, 2]);
  assert.equal(top[0].barPercent, 100, 'het hoogste gerecht vult de balk');
  assert.equal(top[3].barPercent, 22);
  assert.equal(top[3].label, UNDER_MINIMUM_LABEL, 'ook een balkje onder 5 toont geen getal');
  assert.equal(top[1].restaurantId, '6');
});

test('cijfers: een lege of onbekende top is leeg, niet stuk', () => {
  assert.deepEqual(topDishes([]), []);
  assert.deepEqual(topDishes(null), []);
  assert.deepEqual(topDishes([{ dish_key: '', saved: 3 }]), []);
  assert.deepEqual(topDishes([null, 'geen rij', { dish_key: DISH_A, saved: 2 }]).map((entry) => entry.dishKey), [DISH_A]);
});

test('cijfers: het restaurant van een gerecht-id is het deel vóór de maaltijd', () => {
  assert.equal(restaurantOfDishKey('6-diner-0-0'), '6');
  assert.equal(restaurantOfDishKey('23-lunch-2-4'), '23');
  assert.equal(restaurantOfDishKey('geen-id'), null);
  assert.equal(restaurantOfDishKey(null), null);
});

test('cijfers: "favoriet in Samen kiezen" telt de lekker-stemmen, niet de liever-niet', () => {
  const votes = [
    { dish_key: DISH_A, lekker: true, gestemd_op: `${DAYS.today}T09:00:00.000Z` },
    { dish_key: DISH_A, lekker: false, gestemd_op: `${DAYS.today}T09:05:00.000Z` },
    { dish_key: DISH_B, lekker: true, gestemd_op: `${DAYS.yesterday}T19:00:00.000Z` },
  ];
  const totals = periodTotals({ votes });
  assert.equal(totals.favourite, 2, 'precies twee keer "lekker"');
});

test('cijfers: "Deze week" en "vorige week" worden per dag gescheiden', () => {
  const viewRows = [
    { restaurant_id: '6', day: DAYS.today, viewed: 40 },
    { restaurant_id: '6', day: DAYS.weekStart, viewed: 10 },
    { restaurant_id: '6', day: DAYS.lastWeekEnd, viewed: 30 },
    { restaurant_id: '6', day: DAYS.tooOld, viewed: 500 },
  ];
  const counterRows = [
    { dish_key: DISH_A, day: DAYS.today, saved: 6, shared: 4 },
    { dish_key: DISH_B, day: DAYS.lastWeekEnd, saved: 8, shared: 2 },
  ];
  const overview = buildWeekOverview({ restaurantId: '6', viewRows, counterRows, now: NOW });
  assert.equal(overview.status, READY_STATUS);
  assert.equal(overview.hasData, true);
  assert.deepEqual(overview.period.week, { van: DAYS.weekStart, tot: DAYS.today });

  const byId = Object.fromEntries(overview.week.map((metric) => [metric.id, metric]));
  // Bekeken: 40 + 10 deze week, 30 vorige week; 500 valt buiten beide weken.
  assert.equal(byId.bekeken.value, 50);
  assert.equal(byId.bekeken.shown, '50');
  assert.equal(byId.bekeken.previous, 30);
  assert.equal(byId.bekeken.change.direction, 'meer');
  assert.equal(byId.bekeken.change.label, '20 meer dan vorige week');
  // Bewaard: 6 deze week, 8 vorige week → 2 minder.
  assert.equal(byId.bewaard.value, 6);
  assert.equal(byId.bewaard.previous, 8);
  assert.equal(byId.bewaard.change.label, '2 minder dan vorige week');
  // Gedeeld: 4 deze week (onder de drempel) en 2 vorige week → geen verschil.
  assert.equal(byId.gedeeld.shown, UNDER_MINIMUM_LABEL);
  assert.equal(byId.gedeeld.previousShown, UNDER_MINIMUM_LABEL);
  assert.equal(byId.gedeeld.change.label, COMPARE_UNAVAILABLE_LABEL);
  // Favoriet: geen stemmen in deze weken.
  assert.equal(byId.favoriet.value, 0);
  assert.equal(byId.favoriet.shown, UNDER_MINIMUM_LABEL);
  // De top 4 gaat over deze week: alleen DISH_A.
  assert.deepEqual(overview.top.map((entry) => entry.dishKey), [DISH_A]);
  assert.equal(overview.top[0].total, 10);
});

test('cijfers: zonder gegevens de stand "nog geen cijfers"', () => {
  const overview = buildWeekOverview({ restaurantId: '6', viewRows: [], counterRows: [], votes: [], now: NOW });
  assert.equal(overview.status, NO_DATA_STATUS);
  assert.equal(overview.hasData, false);
  assert.equal(overview.message, NO_DATA_MESSAGE);
  assert.equal(NO_DATA_MESSAGE, 'Nog geen cijfers.');
  assert.deepEqual(overview.week, []);
  assert.deepEqual(overview.top, []);
  // Ook helemaal zonder invoer: geen crash, dezelfde eerlijke stand.
  assert.equal(buildWeekOverview().status, NO_DATA_STATUS);
  assert.equal(noDataState().status, NO_DATA_STATUS);
});

test('cijfers: alleen vorige week telt ook als gegevens (met deze week op nul)', () => {
  const overview = buildWeekOverview({
    restaurantId: '6',
    viewRows: [{ restaurant_id: '6', day: DAYS.lastWeekEnd, viewed: 12 }],
    counterRows: [],
    votes: [],
    now: NOW,
  });
  assert.equal(overview.hasData, true);
  const bekeken = overview.week.find((metric) => metric.id === 'bekeken');
  assert.equal(bekeken.value, 0);
  assert.equal(bekeken.shown, UNDER_MINIMUM_LABEL);
  assert.equal(bekeken.change.label, COMPARE_UNAVAILABLE_LABEL);
});

test('cijfers: de stand "net geclaimd" noemt het cijfer van de afgelopen maand', () => {
  // Geen rij in deze of vorige week, wel één van drie weken geleden: nog geen
  // week aan gegevens, dus de welkomststand met een maandcijfer.
  const overview = buildWeekOverview({
    restaurantId: '6',
    viewRows: [{ restaurant_id: '6', day: '2026-10-08', viewed: 12 }],
    counterRows: [{ dish_key: '6-diner-0-0', day: '2026-10-08', saved: 6, shared: 3 }],
    votes: [],
    now: NOW,
  });
  assert.equal(overview.status, NO_DATA_STATUS);
  assert.equal(overview.hasData, false);
  assert.deepEqual(overview.week, []);
  assert.deepEqual(overview.month.period, { van: '2026-09-30', tot: DAYS.today });
  assert.equal(overview.month.totals.viewed, 12);
  assert.equal(overview.month.totals.saved, 6);
  assert.equal(overview.month.totals.shared, 3);
  const byId = Object.fromEntries(overview.month.figures.map((figure) => [figure.id, figure]));
  assert.equal(byId.bekeken.shown, '12');
  assert.equal(byId.bewaard.shown, '6');
  // Ook onder de drempel: nooit een klein getal.
  assert.equal(byId.gedeeld.shown, UNDER_MINIMUM_LABEL);
  assert.equal(byId.favoriet.shown, UNDER_MINIMUM_LABEL);
});

test('cijfers: een maandcijfer ouder dan de maand telt niet mee', () => {
  const overview = buildWeekOverview({
    restaurantId: '6',
    viewRows: [{ restaurant_id: '6', day: '2026-09-01', viewed: 40 }],
    counterRows: [],
    votes: [],
    now: NOW,
  });
  assert.equal(overview.status, NO_DATA_STATUS);
  assert.equal(overview.month.totals.viewed, 0);
  assert.equal(overview.month.figures.find((figure) => figure.id === 'bekeken').shown, UNDER_MINIMUM_LABEL);
  // Zonder enige invoer bestaat de maand altijd, met nullen.
  assert.equal(noDataState().month.totals.viewed, 0);
  assert.equal(noDataState().month.figures.length, 4);
});
