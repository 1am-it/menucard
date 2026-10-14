'use strict';

// Descriptive (prose) sub-headings are source context, not menu hierarchy.
// Fictional local HTML only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure, isProseHeading } = require('./htmlMenuStructure');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept } = require('./menuConcept');

const EXPLANATION = 'Deze gerechten worden geserveerd in verfijnd tussengerecht-formaat, ideaal om samen te delen aan tafel.';

function variant(name) {
  return `<h2>${name}</h2><h3>A LA CARTE</h3><h4>${EXPLANATION}</h4>
    <p><strong>Fictieve ${name.toLowerCase()} soep</strong><br>pompoen<br>8,50<br>
       <strong>Fictieve ${name.toLowerCase()} salade</strong><br>geitenkaas<br>13,50<br>
       <strong>Fictief ${name.toLowerCase()} tartaar</strong><br>kappertjes<br>16</p>`;
}

async function analyse(html) {
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief.example/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  return { menu: analysis.menuContexts[0], concept: buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} }) };
}

test('prose detection: sentences and long explanations are prose; short section names are not', () => {
  assert.equal(isProseHeading(EXPLANATION), true);
  assert.equal(isProseHeading('Al onze gerechten zijn ook glutenvrij te bestellen.'), true);
  assert.equal(isProseHeading('Vraag ernaar bij de bediening. Wij helpen graag'), true);
  assert.equal(isProseHeading('Vraag ernaar. Wij helpen graag'), false); // too short to judge: kept (conservative)
  for (const name of ['A LA CARTE', 'Voorgerechten', 'Lunch', 'Vis & schaaldieren', 'Proef het beste van het seizoen', 'Desserts.']) assert.equal(isProseHeading(name), false, name);
});

test('Lunch/Diner → A LA CARTE → long explanation → dishes: the dishes sit under "Lunch › A LA CARTE" and "Diner › A LA CARTE", no unclear sections', async () => {
  const { menu, concept } = await analyse(`<main>${variant('Lunch')}${variant('Diner')}</main>`);
  assert.deepEqual(menu.categories.map((c) => [c.path, c.items.length]), [[['Lunch', 'A LA CARTE'], 3], [['Diner', 'A LA CARTE'], 3]]);
  assert.ok(!JSON.stringify(menu).includes('tussengerecht-formaat'));
  assert.equal(menu.structure, 'normalized');
  assert.ok(!concept.lines.some((l) => l.status === 'unclear_category'));
  assert.deepEqual(concept.blockers, []);
});

test('short real sub-headings stay part of the route, at any depth', async () => {
  const html = `<h2>Diner</h2><h3>A LA CARTE</h3><h4>Vis</h4>
    <ul><li>Fictieve zeebaars <span>€ 24,50</span></li><li>Fictieve tong <span>€ 29,00</span></li></ul>
    <h4>Vlees</h4><p class="intro">${EXPLANATION}</p>
    <ul><li>Fictieve entrecote <span>€ 26,50</span></li><li>Fictieve stoof <span>€ 22,00</span></li></ul>`;
  const { menu } = await analyse(html);
  assert.equal(menu.title, 'Diner');
  assert.deepEqual(menu.categories.map((c) => c.path), [['A LA CARTE', 'Vis'], ['A LA CARTE', 'Vlees']]);
});

test('an explanation between two real sections never opens a section; dishes stay in the section above it', () => {
  const html = `<h2>Lunch</h2><ul><li>Fictieve soep <span>€ 7,50</span></li></ul>
    <h2>${EXPLANATION}</h2><ul><li>Fictieve salade <span>€ 13,50</span></li><li>Fictief broodje <span>€ 8,50</span></li></ul>`;
  const result = extractHtmlMenuStructure(html);
  assert.deepEqual(result.sections.map((s) => [s.path, s.items.length]), [[['Lunch'], 3]]);
});

test('a lone long description is never a section: without a real heading the structure stays "Controle nodig"', async () => {
  const html = `<h2>${EXPLANATION}</h2><ul><li>Fictieve soep <span>€ 7,50</span></li><li>Fictieve salade <span>€ 13,50</span></li><li>Fictief broodje <span>€ 8,50</span></li></ul>`;
  const { menu, concept } = await analyse(html);
  assert.deepEqual(menu.categories.map((c) => c.path), [['Menukaart']]);
  assert.ok(!JSON.stringify(menu.categories).includes('tussengerecht-formaat'));
  // No structure is invented: the vague fallback section needs a human.
  assert.ok(concept.lines.every((l) => l.status === 'unclear_category'));
});
