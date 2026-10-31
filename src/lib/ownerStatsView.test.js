'use strict';

// BE-57 (#139, deel 2) — de schermen van "Mijn restaurant" als geteste
// beslissing: de vier cijfers, de top 4, de privacydrempel, de datum van de
// menukaart, en de standen "net geclaimd" en "nog geen cijfers".

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OWNER_STATS_MESSAGES,
  TOP_LIMIT,
  UNDER_MINIMUM_LABEL,
  VIEW_STATUS_READY,
  VIEW_STATUS_UNAVAILABLE,
  VIEW_STATUS_WELCOME,
  buildStatsView,
  formatDutchDate,
  shownOf,
  topRowsOf,
} = require('./ownerStatsView');
const { buildWeekOverview } = require('./ownerRestaurantStats');

const NOW = new Date('2026-10-29T12:00:00.000Z');

const DISHES = { '6-diner-0-0': 'Kabeljauw', '6-diner-0-1': 'Tarte tatin' };

/** Een echt API-antwoord, uit de geteste cijfersmodule. */
function readyStats() {
  return buildWeekOverview({
    restaurantId: '6',
    viewRows: [
      { day: '2026-10-29', viewed: 40 },
      { day: '2026-10-22', viewed: 30 },
    ],
    counterRows: [
      { dish_key: '6-diner-0-0', day: '2026-10-29', saved: 8, shared: 4 },
      { dish_key: '6-diner-0-1', day: '2026-10-28', saved: 2, shared: 1 },
    ],
    votes: [
      { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-29T09:00:00.000Z' },
      { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-28T09:00:00.000Z' },
      { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-27T09:00:00.000Z' },
      { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-26T09:00:00.000Z' },
      { dish_key: '6-diner-0-0', lekker: true, gestemd_op: '2026-10-25T09:00:00.000Z' },
    ],
    now: NOW,
  });
}

test('BE-57: "Deze week" toont vier cijfers met de verandering en de privaceregel', () => {
  const view = buildStatsView({ restaurantId: '6', stats: readyStats(), menuHref: '/menu/6-diner', dishes: DISHES });
  assert.equal(view.status, VIEW_STATUS_READY);
  assert.equal(view.week.title, 'Deze week');
  assert.equal(view.week.privacy, OWNER_STATS_MESSAGES.privacy);
  assert.equal(view.week.privacy, 'Alleen totalen, nooit wie.');
  assert.deepEqual(
    view.week.figures.map((figure) => figure.label),
    ['keer bekeken', 'keer bewaard', 'keer gedeeld', 'keer favoriet in Samen kiezen'],
  );
  const byId = Object.fromEntries(view.week.figures.map((figure) => [figure.id, figure]));
  assert.equal(byId.bekeken.value, '40');
  assert.equal(byId.bekeken.change, '10 meer dan vorige week');
  assert.equal(byId.bekeken.direction, 'meer');
  assert.equal(byId.bewaard.value, '10');
  // Gedeeld is 5: precies op de drempel en dus zichtbaar.
  assert.equal(byId.gedeeld.value, '5');
  assert.equal(byId.favoriet.value, '5');
});

test('BE-57: een getal onder 5 verschijnt nooit, ook niet als de API het toch stuurt', () => {
  assert.equal(shownOf(4), UNDER_MINIMUM_LABEL);
  assert.equal(shownOf(5), '5');
  assert.equal(shownOf('3'), UNDER_MINIMUM_LABEL);
  assert.equal(shownOf(undefined), UNDER_MINIMUM_LABEL);
  assert.equal(shownOf(0), UNDER_MINIMUM_LABEL);

  const stats = readyStats();
  // Een kwaadwillend of oud antwoord met kleine getallen: het scherm houdt de
  // drempel zelf tegen.
  stats.week = stats.week.map((metric) => ({ ...metric, value: 3 }));
  stats.top = stats.top.map((entry) => ({ ...entry, total: 2, label: '2' }));
  const view = buildStatsView({ restaurantId: '6', stats, dishes: DISHES });
  assert.deepEqual(view.week.figures.map((figure) => figure.value), [
    UNDER_MINIMUM_LABEL,
    UNDER_MINIMUM_LABEL,
    UNDER_MINIMUM_LABEL,
    UNDER_MINIMUM_LABEL,
  ]);
  assert.deepEqual(view.top.rows.map((row) => row.shown), [UNDER_MINIMUM_LABEL, UNDER_MINIMUM_LABEL]);
  assert.equal(JSON.stringify(view).includes('"2"'), false, 'geen klein aantal in het schermmodel');
});

test('BE-57: de top 4 noemt het gerecht bij naam, met een balk tussen 0 en 100', () => {
  const stats = readyStats();
  stats.top = [
    { dishKey: '6-diner-0-0', total: 12, barPercent: 100 },
    { dishKey: '6-diner-0-1', total: 3, barPercent: 25 },
    { dishKey: '6-weg-0-0', total: 1, barPercent: 8 },
    { dishKey: '6-diner-1-0', total: 1, barPercent: 8 },
    { dishKey: '6-diner-2-0', total: 1, barPercent: 8 },
  ];
  const rows = topRowsOf(stats.top, DISHES);
  assert.equal(rows.length, TOP_LIMIT, 'nooit meer dan vier');
  assert.equal(rows[0].name, 'Kabeljauw');
  assert.equal(rows[1].name, 'Tarte tatin');
  assert.equal(rows[2].name, OWNER_STATS_MESSAGES.topUnknownDish);
  assert.equal(rows[0].percent, 100);
  assert.equal(rows[1].shown, UNDER_MINIMUM_LABEL);
  // Onbruikbare invoer wordt geen crash en geen rare breedte.
  assert.deepEqual(topRowsOf(null, null), []);
  assert.equal(topRowsOf([{ dishKey: '6-diner-0-0', total: 9, barPercent: 480 }], DISHES)[0].percent, 100);
  assert.equal(topRowsOf([{ dishKey: '6-diner-0-0', total: 9, barPercent: 'x' }], DISHES)[0].percent, 0);
});

test('BE-57: "Je menukaart" toont de datum van de laatste bijwerking en de publieke link', () => {
  assert.equal(formatDutchDate('2026-03-25'), '25 maart 2026');
  assert.equal(formatDutchDate('2026-12-01'), '1 december 2026');
  assert.equal(formatDutchDate('geen datum'), null);
  assert.equal(formatDutchDate(''), null);

  const ready = buildStatsView({ restaurantId: '6', stats: readyStats(), menuHref: '/menu/6-diner', menuUpdatedOn: '2026-03-25' });
  assert.deepEqual(ready.menu, {
    title: 'Je menukaart',
    note: 'Laatst bijgewerkt op 25 maart 2026.',
    href: '/menu/6-diner',
    linkLabel: 'Bekijk je menukaart op de publieke pagina',
  });
  // Zonder datum: geen verzonnen datum, wel de link als die bestaat.
  const noDate = buildStatsView({ restaurantId: '6', stats: readyStats(), menuHref: '/menu/6-diner' });
  assert.equal(noDate.menu.note, OWNER_STATS_MESSAGES.menuUnknownDate);
  assert.equal(noDate.menu.href, '/menu/6-diner');
  // Zonder kaart: geen link naar iets dat niet bestaat.
  const noMenu = buildStatsView({ restaurantId: '6', stats: readyStats(), menuHref: null, menuUpdatedOn: '2026-03-25' });
  assert.equal(noMenu.menu.href, null);
  assert.equal(noMenu.menu.linkLabel, null);
  assert.equal(noMenu.menu.note, OWNER_STATS_MESSAGES.menuMissing);
});


test('BE-57: zonder migratie de nette stand "nog geen cijfers" met de welkomstmelding', () => {
  // Precies het antwoord van de API zonder 0024: geen week, geen top, wel maand.
  const emptyStats = {
    status: 'geen-cijfers',
    message: 'Nog geen cijfers.',
    hasData: false,
    week: [],
    top: [],
    month: {
      period: { van: '2026-09-30', tot: '2026-10-29' },
      totals: { viewed: 12, saved: 3, shared: 0, favourite: 6 },
      figures: [
        { id: 'bekeken', label: 'keer bekeken', value: 12, shown: '12', enough: true },
        { id: 'bewaard', label: 'keer bewaard', value: 3, shown: '3', enough: false },
        { id: 'gedeeld', label: 'keer gedeeld', value: 0, shown: 'minder dan 5', enough: false },
        { id: 'favoriet', label: 'keer favoriet in Samen kiezen', value: 6, shown: '6', enough: true },
      ],
    },
  };
  const view = buildStatsView({
    restaurantId: '6',
    stats: emptyStats,
    menuHref: '/menu/6-diner',
    menuUpdatedOn: '2026-03-25',
  });
  assert.equal(view.status, VIEW_STATUS_WELCOME);
  assert.equal(view.week, null, 'geen weekcijfers zonder gegevens');
  assert.equal(view.top, null);
  assert.equal(view.welcome.title, 'Net geclaimd');
  assert.match(view.welcome.body, /Welkom/);
  assert.equal(view.welcome.monthTitle, 'De afgelopen maand');
  const byId = Object.fromEntries(view.welcome.figures.map((figure) => [figure.id, figure]));
  assert.equal(byId.bekeken.value, '12');
  assert.equal(byId.bewaard.value, UNDER_MINIMUM_LABEL, 'drie blijft "minder dan 5"');
  assert.equal(byId.favoriet.value, '6');
  // "Drie dingen om mee te beginnen": drie stuks, geen enkele link.
  assert.equal(view.welcome.startTitle, 'Drie dingen om mee te beginnen');
  assert.equal(view.welcome.startItems.length, 3);
  assert.deepEqual(view.welcome.startItems, OWNER_STATS_MESSAGES.startItems.slice());
  const startText = JSON.stringify(view.welcome.startItems);
  assert.equal(/href|https?:\/\/|\/mijn-restaurant\//.test(startText), false, 'geen link naar wat nog niet bestaat');
  // En de menukaart staat er ook in deze stand.
  assert.equal(view.menu.href, '/menu/6-diner');
});

test('BE-57: een 403 of een storing geeft een eerlijke melding zonder cijfers', () => {
  const forbidden = buildStatsView({ restaurantId: '6', stats: readyStats(), forbidden: true });
  assert.equal(forbidden.status, VIEW_STATUS_UNAVAILABLE);
  assert.equal(forbidden.problem, OWNER_STATS_MESSAGES.forbiddenBody);
  assert.equal(forbidden.week, null);
  assert.equal(forbidden.welcome, null);

  const failed = buildStatsView({ restaurantId: '6', stats: null });
  assert.equal(failed.status, VIEW_STATUS_UNAVAILABLE);
  assert.equal(failed.problem, OWNER_STATS_MESSAGES.unavailableBody);

  // Ook zonder enige invoer: geen crash, dezelfde eerlijke stand.
  const nothing = buildStatsView();
  assert.equal(nothing.status, VIEW_STATUS_UNAVAILABLE);
  assert.equal(nothing.menu.href, null);
});

test('BE-57: het schermmodel bevat geen enkel gegeven over een gast', () => {
  const view = buildStatsView({ restaurantId: '6', stats: readyStats(), menuHref: '/menu/6-diner', dishes: DISHES });
  const serialised = JSON.stringify(view).toLowerCase();
  for (const forbidden of ['email', 'ip', 'user-agent', 'useragent', 'cookie', 'gast:', 'naam:']) {
    assert.equal(serialised.includes(forbidden), false, `${forbidden} hoort niet in het schermmodel`);
  }
});
