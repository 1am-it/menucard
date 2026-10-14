'use strict';

// Descriptive (sentence-like) headings: skipped only when safely nested below
// a real section heading; anywhere else they stay in the route and make the
// structure uncertain ("Controle nodig"). Fictional, anonymised HTML only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure, isProseHeading } = require('./htmlMenuStructure');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept } = require('./menuConcept');

const EXPLANATION = 'Deze fictieve gerechten worden geserveerd als klein gerecht om samen te delen.';
const LONG_SECTION = 'Huisgemaakte fictieve pasta en risotto met groenten van lokale telers uit de regio';

const dishes = (prefix) => `<ul><li>${prefix} soep <span>€ 8,50</span></li><li>${prefix} salade <span>€ 13,50</span></li><li>${prefix} tartaar <span>€ 16,00</span></li></ul>`;

async function analyse(html) {
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief.example/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  return { menu: analysis.menuContexts[0], concept: buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} }) };
}

test('sentence shape decides, never length alone', () => {
  assert.equal(isProseHeading(EXPLANATION), true);
  assert.equal(isProseHeading('Vraag ernaar bij de bediening. Wij helpen graag'), true);
  assert.equal(isProseHeading('Vraag ernaar. Wij helpen graag'), false); // too short to judge: kept
  assert.equal(isProseHeading(LONG_SECTION), false); // long, but no sentence: a real heading
  for (const name of ['A LA CARTE', 'Voorgerechten', 'Proef het beste van het seizoen', 'Desserts.']) assert.equal(isProseHeading(name), false, name);
});

test('a sentence nested below a real section is context: Lunch/Diner → A LA CARTE keep their dishes, no unclear sections', async () => {
  const variant = (name) => `<h2>${name}</h2><h3>A LA CARTE</h3><h4>${EXPLANATION}</h4>${dishes(`Fictieve ${name.toLowerCase()}`)}`;
  const { menu, concept } = await analyse(`<main>${variant('Lunch')}${variant('Diner')}</main>`);
  assert.deepEqual(menu.categories.map((c) => [c.path, c.items.length]), [[['Lunch', 'A LA CARTE'], 3], [['Diner', 'A LA CARTE'], 3]]);
  assert.equal(menu.structure, 'normalized');
  assert.ok(!JSON.stringify(menu).includes('klein gerecht'));
  assert.deepEqual(concept.blockers, []);
});

test('a long section heading without sentence shape stays a real heading', async () => {
  const html = `<h2>Diner</h2><h3>${LONG_SECTION}</h3>${dishes('Fictieve pasta')}<h3>Desserts</h3>${dishes('Fictief dessert')}`;
  const { menu } = await analyse(html);
  assert.equal(menu.title, 'Diner');
  assert.deepEqual(menu.categories.map((c) => c.path), [[LONG_SECTION], ['Desserts']]);
  assert.equal(menu.structure, 'normalized');
});

test('a sentence on the same level as the section never attaches its dishes to the previous section: the route is uncertain', async () => {
  const html = `<h2>Lunch</h2>${dishes('Fictieve lunch')}<h2>${EXPLANATION}</h2>${dishes('Fictief extra')}`;
  const sections = extractHtmlMenuStructure(html).sections;
  assert.deepEqual(sections.map((s) => [s.path, s.items.map((i) => i.name)]), [
    [['Lunch'], ['Fictieve lunch soep', 'Fictieve lunch salade', 'Fictieve lunch tartaar']],
    [[EXPLANATION], ['Fictief extra soep', 'Fictief extra salade', 'Fictief extra tartaar']],
  ]);
  const { menu, concept } = await analyse(html);
  assert.equal(menu.structure, 'uncertain');
  assert.deepEqual(menu.categories.map((c) => c.uncertain === true), [false, true]);
  // The Lunch dishes are fine; the dishes under the sentence need a human ("Controle nodig").
  assert.deepEqual(concept.lines.map((l) => l.status), ['new', 'new', 'new', 'unclear_category', 'unclear_category', 'unclear_category']);
});

test('a sentence as the only heading is not dropped: it stays in the route, uncertain, never invented structure', async () => {
  const { menu, concept } = await analyse(`<h2>${EXPLANATION}</h2>${dishes('Fictieve')}`);
  assert.deepEqual(menu.categories.map((c) => [c.sourcePath, c.uncertain]), [[[EXPLANATION], true]]);
  assert.equal(menu.structure, 'uncertain');
  assert.ok(concept.lines.every((l) => l.status === 'unclear_category'));
});

test('short real sub-headings stay part of the route, at any depth', async () => {
  const html = `<h2>Diner</h2><h3>A LA CARTE</h3><h4>Vis</h4>${dishes('Fictieve vis')}<h4>Vlees</h4>${dishes('Fictief vlees')}`;
  const { menu } = await analyse(html);
  assert.equal(menu.title, 'Diner');
  assert.deepEqual(menu.categories.map((c) => c.path), [['A LA CARTE', 'Vis'], ['A LA CARTE', 'Vlees']]);
  assert.equal(menu.structure, 'normalized');
});
