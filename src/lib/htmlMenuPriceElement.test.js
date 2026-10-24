'use strict';

// Regression for a real Colonia Breda menu page (2026-10-18): each dish is a
// repeated card with a dedicated class-based name, description and price
// element. The price element prints whole euros ("18") and one decimal
// ("15.5"). Those are valid menu prices but not tokens the generic prose
// scanner accepts, so the dedicated price element is structural evidence and
// goes through the same strict 0,50–500,00 rule as a trailing list price.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHtmlMenuStructure } = require('./htmlMenuStructure');

function card(name, price, description, priceClass = 'gerecht-prijs') {
  return `<div class="probu-item">
    <p class="gerecht gerecht-titel"><span class="gerecht-titel">${name}</span></p>
    <p class="gerecht"><span class="gerecht-omschrijving">${description}</span></p>
    <p class="${priceClass}">${price}</p>
  </div>`;
}

test('a class-based price element accepts whole euros and one decimal', () => {
  const html = `<html><body>
    <h2>Lunch</h2>
    <h3>Bagels - Sandwiches - Broodjes</h3>
    ${card('Onze beroemde clubsandwich', '18', 'Gerookte kipfilet | bacon | tomaat')}
    ${card('Open sandwich oude kaas', '15.5', 'Bruin boerenbrood | honing-mosterd saus')}
    ${card('Bagel carpaccio', '16', 'Truffelmayonaise | rucola')}
  </body></html>`;

  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.equal(result.sections.length, 1);
  const items = result.sections[0].items;
  assert.deepEqual(items.map((item) => [item.name, item.amountMinorUnits]), [
    ['Onze beroemde clubsandwich', 1800],
    ['Open sandwich oude kaas', 1550],
    ['Bagel carpaccio', 1600],
  ]);
  assert.equal(items[0].description, 'Gerookte kipfilet | bacon | tomaat');
});

test('a price element with two variants is never flattened to one amount', () => {
  const html = `<html><body>
    <h2>Wijn</h2>
    ${card('Huiswijn', '12,50 / 27,50', 'Glas of fles', 'price')}
    ${card('Rode wijn', '13,50 / 29,50', 'Glas of fles', 'price')}
    ${card('Witte wijn', '11,50 / 25,50', 'Glas of fles', 'price')}
  </body></html>`;

  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.equal(result.sections[0].items.length, 3);
  for (const item of result.sections[0].items) {
    assert.equal(item.priceStatus, 'multiple_undecomposed');
    assert.equal(item.amountMinorUnits, null);
  }
});

test('a price element with on-request text becomes on_request, never a filled-in amount', () => {
  const html = `<html><body>
    <h2>Lunch</h2>
    ${card('Gerecht een', 'op aanvraag', 'Beschrijving een')}
    ${card('Gerecht twee', 'dagprijs', 'Beschrijving twee')}
    ${card('Gerecht drie', 'market price', 'Beschrijving drie')}
  </body></html>`;

  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed');
  assert.equal(result.sections[0].items.length, 3);
  for (const item of result.sections[0].items) {
    assert.equal(item.priceStatus, 'on_request');
    assert.equal(item.amountMinorUnits, null);
  }
});

test('a price element with non-price text is not filled in as a price', () => {
  const html = `<html><body>
    <h2>Lunch</h2>
    ${card('Gerecht een', 'zie bord', 'Beschrijving een')}
    ${card('Gerecht twee', 'vraag ernaar', 'Beschrijving twee')}
    ${card('Gerecht drie', 'niet vermeld', 'Beschrijving drie')}
  </body></html>`;

  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'unparsed');
  assert.equal(result.reason, 'no_structured_items');
});
