'use strict';

// HTML character references in menu text are decoded once, centrally, at
// extraction — for the HTML path and the JSON-LD path alike — so analysis,
// concept, review, Publicatievoorbeeld and export all carry the real
// characters. Fictional text only.

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeEntities, extractHtmlMenuStructure } = require('./htmlMenuStructure');
const { extractMenusFromHtml } = require('./menuJsonLdExtraction');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { buildCandidateSummary } = require('./urlIntakes');
const { buildMenuConcept } = require('./menuConcept');
const { buildMenuEntry } = require('./menuExport');

test('named quotes and accented letters, case-sensitive', () => {
  assert.equal(decodeEntities('&lsquo;Fictie van de dag&rsquo;'), '‘Fictie van de dag’');
  assert.equal(decodeEntities('&ldquo;Fictief&rdquo; &sbquo;x&bdquo;'), '“Fictief” ‚x„');
  assert.equal(decodeEntities('2 &agrave; 3'), '2 à 3');
  assert.equal(decodeEntities('&Eacute;&eacute; cr&egrave;me br&ucirc;l&eacute;e'), 'Éé crème brûlée');
});

test('decimal and hexadecimal numeric references; invalid code points stay', () => {
  assert.equal(decodeEntities('&#8216;Fictief&#8217; caf&#233;'), '‘Fictief’ café');
  assert.equal(decodeEntities('&#x2018;Fictief&#x2019; caf&#xE9;'), '‘Fictief’ café');
  assert.equal(decodeEntities('&#0; &#xD800; &#x110000;'), '&#0; &#xD800; &#x110000;');
});

test('ampersands: "&amp;" becomes "&", a plain "&" and unknown names stay', () => {
  assert.equal(decodeEntities('Fictieve vis &amp; friet'), 'Fictieve vis & friet');
  assert.equal(decodeEntities('Fictieve vis & friet'), 'Fictieve vis & friet');
  assert.equal(decodeEntities('Fictief &onbekend; &amp'), 'Fictief &onbekend; &amp');
});

test('decoded exactly once: an escaped reference stays literal text', () => {
  assert.equal(decodeEntities('&amp;lsquo;Fictief&amp;rsquo;'), '&lsquo;Fictief&rsquo;');
  assert.equal(decodeEntities(decodeEntities('&amp;amp;')), '&');
  // In a page, "&amp;lt;b&amp;gt;" is text "&lt;b&gt;", never markup or a second decode.
  const result = extractHtmlMenuStructure('<h2>Lunch</h2><ul><li>Fictief &amp;lt;b&amp;gt; broodje <span>€ 7,50</span></li><li>Fictieve soep <span>€ 6,50</span></li><li>Fictieve salade <span>€ 9,50</span></li></ul>');
  assert.equal(result.sections[0].items[0].name, 'Fictief &lt;b&gt; broodje');
});

test('HTML path: dish name, description, section and title are decoded at extraction', () => {
  const html = `<h1>Fictief caf&eacute;</h1><h2>Lunch &amp; diner</h2>
    <p><strong>Fictieve &lsquo;vangst van de dag&rsquo;</strong><br>2 &agrave; 3 gerechtjes om te delen<br>9,50<br>
       <strong>Fictieve cr&egrave;me br&ucirc;l&eacute;e</strong><br>vanille<br>8,50<br>
       <strong>Fictieve vis &amp; friet</strong><br>remoulade<br>17</p>`;
  const result = extractHtmlMenuStructure(html);
  assert.deepEqual(result.sections.map((s) => s.path), [['Fictief café', 'Lunch & diner']]);
  assert.deepEqual(result.sections[0].items.map((i) => [i.name, i.description]), [
    ['Fictieve ‘vangst van de dag’', '2 à 3 gerechtjes om te delen'],
    ['Fictieve crème brûlée', 'vanille'],
    ['Fictieve vis & friet', 'remoulade'],
  ]);
});

test('JSON-LD path: menu, section, dish name and description are decoded once by the same decoder', () => {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Fictief caf&eacute;',
    hasMenuSection: [{ name: 'Lunch &amp; diner', hasMenuItem: [{ name: 'Fictieve &lsquo;vangst&rsquo;', description: '2 &agrave; 3 &amp;amp; meer', offers: { price: '9.50' } }] }],
  };
  const [menu] = extractMenusFromHtml(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  assert.equal(menu.name, 'Fictief café');
  assert.equal(menu.categories[0].name, 'Lunch & diner');
  assert.deepEqual(menu.categories[0].items[0], { name: 'Fictieve ‘vangst’', desc: '2 à 3 &amp; meer', price: '9.50' });
});

test('through the chain: analysis → concept → export carry the decoded text, decoded once', async () => {
  const html = `<h2>Lunch</h2><ul><li>Fictieve &lsquo;vangst van de dag&rsquo; <span>€ 9,50</span></li><li>Fictieve cr&egrave;me br&ucirc;l&eacute;e <span>€ 8,50</span></li><li>Fictieve vis &amp; friet <span>€ 17,00</span></li></ul>`;
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml: html, homepageUrl: 'https://fictief.invalid/', fetchCandidate: async () => ({ status: 'blocked' }) });
  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts });
  const concept = buildMenuConcept({ menus: summary.menus, liveLines: [], edits: {} });
  const entry = buildMenuEntry({ content: concept.content, currentEntries: {}, sourceUrl: 'https://fictief.invalid/', scraped: '2026-10-15' });
  const names = ['Fictieve ‘vangst van de dag’', 'Fictieve crème brûlée', 'Fictieve vis & friet'];
  assert.deepEqual(summary.menus[0].categories[0].items.map((i) => i.name), names);
  assert.deepEqual(concept.content.categories[0].items.map((i) => i.name), names);
  assert.deepEqual(entry.categories[0].items.map((i) => i.name), names);
  assert.ok(!JSON.stringify(entry).includes('&'.concat('lsquo;')));
});
