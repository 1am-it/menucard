'use strict';

// Lossless menu hierarchy: normalisation, the Blossem-like nested case end to
// end (analysis → receipt summary → concept → export entry), uncertainty as
// "Controle nodig", flat menus unchanged, and a Zuyd-like formatted menu
// through the whole analysis pipeline. Fictional local HTML only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMenuHierarchy, groupHeadingsBefore, categoryPath } = require('./menuHierarchy');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept, summarizeRecognisedMenu, storedConceptInput, publicMenu } = require('./menuConcept');
const { buildMenuEntry } = require('./menuExport');
const { menuSourceUrls, deriveItemView } = require('./batchAnalysis');

const TITLE = 'Proef het beste van het seizoen';
const NESTED_PAGE = `<html><body>
  <h1>${TITLE}</h1>
  <h2>Diner</h2>
  <h3>Voor</h3><ul><li>Fictieve gamba, rabarber <span>€ 19,50</span></li><li>Fictieve burrata, tomaat <span>€ 17,00</span></li></ul>
  <h3>Tussen</h3><ul><li>Fictieve bisque, venkel <span>€ 12,50</span></li></ul>
  <h3>Hoofd</h3><ul><li>Fictieve rode mul, tomaat <span>€ 21,00</span></li><li>Fictieve entrecote, bearnaise <span>€ 24,50</span></li></ul>
  <h3>Bijgerechten</h3><ul><li>Fictieve frieten <span>€ 5,00</span></li></ul>
  <h3>Dessert</h3><ul><li>Fictieve crème brûlée <span>€ 9,50</span></li></ul>
</body></html>`;

test('normalisation: a shared title, a path of any depth, the full source route; never a flattened name', () => {
  const h = normalizeMenuHierarchy([[TITLE, 'Diner', 'Voor'], [TITLE, 'Diner', 'Tussen'], [TITLE, 'Lunch', 'Broodjes', 'Warm']]);
  assert.equal(h.title, TITLE);
  assert.equal(h.structure, 'normalized');
  assert.deepEqual(h.categories.map((c) => [c.name, c.path, c.sourcePath.length]), [
    ['Voor', ['Diner', 'Voor'], 3],
    ['Tussen', ['Diner', 'Tussen'], 3],
    ['Warm', ['Lunch', 'Broodjes', 'Warm'], 4],
  ]);
  assert.ok(!JSON.stringify(h).includes(' — '));
  // No shared heading: no title, paths as they are.
  assert.deepEqual(normalizeMenuHierarchy([['Voorgerechten'], ['Hoofdgerechten']]), {
    title: null,
    structure: 'normalized',
    categories: [
      { name: 'Voorgerechten', path: ['Voorgerechten'], sourcePath: ['Voorgerechten'], uncertain: false },
      { name: 'Hoofdgerechten', path: ['Hoofdgerechten'], sourcePath: ['Hoofdgerechten'], uncertain: false },
    ],
  });
  // A single section keeps its heading as its own name (no empty path).
  assert.equal(normalizeMenuHierarchy([['Lunch']]).title, null);
});

test('normalisation: uncertainty is flagged, never resolved by guessing', () => {
  const unlabelled = normalizeMenuHierarchy([[], ['Diner', 'Voor']]);
  assert.equal(unlabelled.structure, 'uncertain');
  assert.deepEqual(unlabelled.categories.map((c) => [c.name, c.uncertain]), [['Menukaart', true], ['Voor', false]]);
  const groupWithItems = normalizeMenuHierarchy([['Diner'], ['Diner', 'Voor']]);
  assert.deepEqual(groupWithItems.categories.map((c) => c.uncertain), [true, false]);
  assert.equal(normalizeMenuHierarchy([['a', 'b', 'c', 'd', 'e']]).structure, 'uncertain');
});

test('group headings: only where the group changes; flat menus get none', () => {
  const nested = [{ name: 'Voor', path: ['Diner', 'Voor'] }, { name: 'Hoofd', path: ['Diner', 'Hoofd'] }, { name: 'Broodjes', path: ['Lunch', 'Broodjes'] }];
  assert.deepEqual([0, 1, 2].map((i) => groupHeadingsBefore(nested, i)), [[{ label: 'Diner', depth: 0 }], [], [{ label: 'Lunch', depth: 0 }]]);
  const flat = [{ name: 'Lunch' }, { name: 'Diner' }];
  assert.deepEqual([0, 1].map((i) => groupHeadingsBefore(flat, i)), [[], []]);
  assert.deepEqual(categoryPath({ name: 'Lunch' }), ['Lunch']);
});

test('Blossem-like page end to end: title → Diner → Voor/Tussen/Hoofd/Bijgerechten/Dessert, in order, through receipt, concept and export', async () => {
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: NESTED_PAGE, homepageUrl: 'https://bistro-fictief.example/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const menu = analysis.menuContexts[0];
  assert.equal(menu.title, TITLE);
  assert.equal(menu.structure, 'normalized');
  assert.deepEqual(menu.categories.map((c) => c.path), [['Diner', 'Voor'], ['Diner', 'Tussen'], ['Diner', 'Hoofd'], ['Diner', 'Bijgerechten'], ['Diner', 'Dessert']]);
  assert.deepEqual(menu.categories[0].sourcePath, [TITLE, 'Diner', 'Voor']);
  assert.deepEqual(menu.categories.map((c) => c.position), [0, 1, 2, 3, 4]);
  assert.ok(menu.categories.every((c) => typeof c.locator === 'string' && c.locator.length > 0));

  // The receipt keeps the structure (bounded summary).
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  assert.equal(summary.menus[0].title, TITLE);
  assert.deepEqual(summary.menus[0].categories[2].path, ['Diner', 'Hoofd']);
  assert.deepEqual(summary.menus[0].categories[2].sourcePath, [TITLE, 'Diner', 'Hoofd']);

  // The control view shows the proposed structure and the source route.
  const control = summarizeRecognisedMenu(summary.menus);
  assert.equal(control.title, TITLE);
  assert.deepEqual(control.categories.map((c) => c.label), ['Diner › Voor', 'Diner › Tussen', 'Diner › Hoofd', 'Diner › Bijgerechten', 'Diner › Dessert']);
  assert.equal(control.categories[0].sourceRoute, `${TITLE} › Diner › Voor`);

  // Concept and export carry the same semantic structure; a stored version round-trips unchanged.
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.equal(concept.canSave, true);
  assert.equal(concept.content.title, TITLE);
  assert.deepEqual(concept.content.categories.map((c) => [c.name, c.path]), [['Voor', ['Diner', 'Voor']], ['Tussen', ['Diner', 'Tussen']], ['Hoofd', ['Diner', 'Hoofd']], ['Bijgerechten', ['Diner', 'Bijgerechten']], ['Dessert', ['Diner', 'Dessert']]]);
  const stored = storedConceptInput(concept.content);
  assert.deepEqual(buildMenuConcept({ menus: stored.menus, liveLines: [], edits: stored.edits }).content, concept.content);
  const entry = buildMenuEntry({ content: concept.content, currentEntries: {}, sourceUrl: 'https://bistro-fictief.example/', scraped: '2026-10-14' });
  assert.equal(entry.title, TITLE);
  assert.deepEqual(entry.categories.map((c) => [c.name, c.path]), concept.content.categories.map((c) => [c.name, c.path]));
  assert.ok(!entry.categories.some((c) => 'sourcePath' in c || 'uncertain' in c), 'internal audit fields never reach the public data');
  assert.deepEqual(publicMenu(concept.content).categories.map((c) => c.path), entry.categories.map((c) => c.path));
});

test('a corrected section name keeps its group; "Lunch › Voor" and "Diner › Voor" never merge', () => {
  const menus = [
    { title: 'Lunch', categories: [{ name: 'Voor', path: ['Voor'], items: [{ name: 'Fictieve soep', price: '7.50' }] }] },
    { title: 'Diner', categories: [{ name: 'Voor', path: ['Voor'], items: [{ name: 'Fictieve gamba', price: '19.50' }] }] },
  ];
  const concept = buildMenuConcept({ menus, liveLines: [], edits: { lines: { '1.0.0': { category: 'Voorgerechten' } } } });
  assert.equal(concept.content.title, undefined); // several menus: their titles become groups
  assert.deepEqual(concept.content.categories.map((c) => c.path), [['Lunch', 'Voor'], ['Diner', 'Voorgerechten']]);
});

test('an uncertain structure is "Controle nodig": unclear sections block until named or accepted, and the batch never offers one-click confirmation', async () => {
  const page = `<h2>Fictief</h2><ul><li>Fictieve soep <span>€ 7,50</span></li><li>Fictieve salade <span>€ 9,50</span></li></ul>
    <h3>Voor</h3><ul><li>Fictieve gamba <span>€ 19,50</span></li><li>Fictieve burrata <span>€ 17,00</span></li></ul>`;
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: page, homepageUrl: 'https://bistro-fictief.example/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const menu = analysis.menuContexts[0];
  assert.equal(menu.structure, 'uncertain');
  assert.ok(analysis.notes.some((n) => /menukopjes zijn onzeker/.test(n)));
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.deepEqual(concept.blockers.map((b) => b.status), ['unclear_category', 'unclear_category']);
  const named = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: { lines: { '0.0.0': { category: 'Soepen' }, '0.0.1': { accept: true } } } });
  assert.deepEqual(named.blockers, []);

  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: 'https://bistro-fictief.example/', outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-14T12:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: menuSourceUrls(analysis), notes: analysis.notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus: summary.menus },
    restaurants: { bistro: { name: 'Bistro Fictief', website: 'https://www.bistro-fictief.example/nl' } },
    proposals: [],
    now: new Date('2026-10-14T12:05:00Z'),
  });
  assert.equal(view.label, 'Controle nodig');
  assert.equal(view.high, false);
});

test('flat menus keep exactly their earlier shape everywhere', () => {
  const flat = { categories: [{ name: 'Lunch', items: [{ name: 'Fictieve soep', desc: null, price: '7.50' }] }] };
  const concept = buildMenuConcept({ menus: [flat], liveLines: [], edits: {} });
  assert.deepEqual(Object.keys(concept.content), ['categories']);
  assert.deepEqual(Object.keys(concept.content.categories[0]), ['name', 'items']);
  const entry = buildMenuEntry({ content: concept.content, currentEntries: {}, sourceUrl: 'https://fictief.example/', scraped: '2026-10-14' });
  assert.deepEqual(Object.keys(entry), ['subtitle', 'scraped', 'source', 'categories']);
  assert.deepEqual(Object.keys(entry.categories[0]), ['name', 'items']);
});

// ─── Zuyd-like site through the whole analysis pipeline ───

const HOMEPAGE = `<html><head><title>Fictief Restaurant</title></head><body>
  <nav><a href="/lunch">Lunch</a> <a href="/diner">Diner</a> <a href="/kerstmenu">Kerstmenu</a></nav>
  <p>Welkom bij ons fictieve restaurant.</p>
</body></html>`;
const PAGES = {
  'https://fictief-restaurant.example/lunch': `<h1>Lunch</h1><h2>Lunchgerechten</h2>
    <p><strong>Fictieve tomatensoep</strong> basilicum 7,50<br><strong>Fictief broodje kroket</strong><br>twee kroketten<br>9,50<br><strong>Fictieve salade</strong><br>geitenkaas<br>14</p>`,
  'https://fictief-restaurant.example/diner': `<h1>Diner</h1><h2>Hoofdgerechten</h2>
    <div><b>Fictieve runderstoof</b><br>seizoensgroenten<br>25<br><b>Fictieve zeebaars</b><br>beurre blanc<br>27,50<br><b>Fictieve risotto</b><br>paddenstoelen<br>19</div>`,
  'https://fictief-restaurant.example/kerstmenu': `<h1>Kerstmenu</h1><p>Reserveer tijdig via ons formulier.</p>`,
};

test('pipeline: the pages are fetched, the candidate pages are read, menu contexts appear and the result is no longer "Geen bruikbare menukaart gevonden"', async () => {
  const fetched = [];
  const analysis = await runRestaurantSourceAnalysis({
    homepageHtml: HOMEPAGE,
    homepageUrl: 'https://fictief-restaurant.example/',
    fetchCandidate: async (url) => {
      fetched.push(url);
      return PAGES[url] ? { status: 'html', body: PAGES[url], finalUrl: url } : { status: 'blocked' };
    },
  });
  assert.deepEqual(fetched.sort(), Object.keys(PAGES).sort());
  assert.deepEqual(analysis.menuContexts.map((m) => [m.sourceUrl, m.extractionMethod, m.title, m.categories.map((c) => c.items.length)]), [
    ['https://fictief-restaurant.example/lunch', 'html', 'Lunch', [3]],
    ['https://fictief-restaurant.example/diner', 'html', 'Diner', [3]],
  ]);
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: 'https://fictief-restaurant.example/', outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-14T12:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: menuSourceUrls(analysis), notes: analysis.notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: 'fictief', menus: summary.menus },
    restaurants: { fictief: { name: 'Fictief Restaurant', website: 'https://fictief-restaurant.example' } },
    proposals: [],
    now: new Date('2026-10-14T12:05:00Z'),
  });
  assert.notEqual(view.label, 'Geen bruikbare menukaart gevonden');
  assert.equal(view.label, 'Menukaart gevonden · controle nodig');
  assert.equal(view.menu.itemCount, 6);
  // Two pages, two titles: in the concept each title becomes the outer group.
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.deepEqual(concept.content.categories.map((c) => c.path), [['Lunch', 'Lunchgerechten'], ['Diner', 'Hoofdgerechten']]);
});
