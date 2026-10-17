'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure } = require('./htmlMenuStructure');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept } = require('./menuConcept');

const dishes = '<h3>Voor</h3><p>Fictieve soep <strong>8.5</strong><br>Fictieve salade <strong>12.5</strong><br>Fictieve tartaar <strong>17.5</strong></p>';
const accordion = (label, attrs = '', panelAttrs = '') => `<div><div role="button" aria-expanded="false" ${attrs}><span>${label}</span></div><div ${panelAttrs}>${dishes}</div></div>`;

test('an inline supplement never becomes the main dish price', () => {
  const html = '<h2>Diner</h2><p><strong>Fictieve soep</strong> 8,50<br><strong>Fictieve salade</strong> 12,50<br><strong>Fictieve pasta</strong> 18,50<br>' +
    '<strong>Fictieve runderstoof</strong><br>met groenten<br>35 - <em>supplement kaas 9</em></p>';
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.equal(result.sections.flatMap((s) => s.items).some((i) => i.name === 'Fictieve runderstoof'), false);
  assert.ok(result.rejected.some((r) => r.reason === 'modifier' && r.text.includes('Fictieve runderstoof')));
});

test('accordion source labels survive the full chain; implicit panel associations require review', async () => {
  const html = '<h1>Fictief seizoensmenu</h1>' + accordion('Lunch') + accordion('Diner');
  const parsed = extractHtmlMenuStructure(html);
  assert.deepEqual(parsed.sections.map((s) => [s.path, s.uncertain, s.items.length]), [
    [['Fictief seizoensmenu', 'Lunch', 'Voor'], true, 3],
    [['Fictief seizoensmenu', 'Diner', 'Voor'], true, 3],
  ]);
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief.example/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  assert.equal(analysis.menuContexts[0].structure, 'uncertain');
  assert.equal(concept.lines.length, 6);
  assert.ok(concept.lines.every((line) => line.status === 'unclear_category'));
  assert.ok(concept.lines.every((line) => line.status !== 'duplicate'));
});

test('explicit accordion associations remain scoped and do not leak into following sections', () => {
  const html = '<h1>Fictief menu</h1>' + accordion('Lunch', 'aria-controls="lunch"', 'id="lunch"') +
    accordion('Diner', 'aria-controls="diner"', 'id="diner"') + '<h2>Borrel</h2>' + dishes;
  const parsed = extractHtmlMenuStructure(html);
  assert.deepEqual(parsed.sections.map((s) => [s.path, s.uncertain === true]), [
    [['Fictief menu', 'Lunch', 'Voor'], false],
    [['Fictief menu', 'Diner', 'Voor'], false],
    [['Fictief menu', 'Borrel', 'Voor'], false],
  ]);
});

test('a navigation control without expansion semantics cannot label a menu panel', () => {
  const parsed = extractHtmlMenuStructure('<h1>Fictief menu</h1><div><button>Reserveren</button><div>' + dishes + '</div></div>');
  assert.ok(parsed.sections.every((s) => !s.path.includes('Reserveren')));
});

test('an implicit occurrence cannot inherit trust from an earlier explicitly linked panel with the same label', () => {
  const html = '<h1>Fictief menu</h1>' + accordion('Lunch', 'aria-controls="lunch"', 'id="lunch"') + accordion('Lunch');
  const parsed = extractHtmlMenuStructure(html);
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].uncertain, true);
});
