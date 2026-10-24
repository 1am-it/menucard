'use strict';

// #59 Lead review 6351417692 K2 — the generic row shapes behind the Wolfslaar
// card, on invented sources only: a dish whose printed row carries more than
// one amount keeps every amount as its own price variant, a dish title the CMS
// split over two markup runs stays one literal name, and a bold lowercase
// continuation never becomes a dish of its own. No real source, host, dish or
// price appears here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractHtmlMenuStructure } = require('./htmlMenuStructure');

function sections(html) {
  const result = extractHtmlMenuStructure(html);
  assert.equal(result.status, 'parsed', JSON.stringify(result.reason));
  return result;
}

test('K2: two labelled amounts on one dish row are variants with their printed labels, never one amount', () => {
  const result = sections(`<h2>Voorgerechten</h2><p>
    <span><strong>Fictieve kaviaar</strong><br /></span>
    <span>fictieve blini | fictieve room 20 gram 45 | 40 gram 78<br /><br /></span>
    <span><strong>Fictieve soep</strong><br /></span>
    <span>fictieve pompoen 9<br /><br /></span>
    <span><strong>Fictieve salade</strong><br /></span>
    <span>fictieve geitenkaas 11</span></p>`);
  const items = result.sections[0].items;
  const caviar = items.find((item) => item.name === 'Fictieve kaviaar');
  assert.equal(caviar.priceStatus, 'multiple_undecomposed');
  assert.equal(caviar.amountMinorUnits, null);
  assert.deepEqual(caviar.priceVariants, [
    { label: '20 gram', price: '45.00' },
    { label: '40 gram', price: '78.00' },
  ]);
  assert.equal(caviar.priceText, '45.00 / 78.00');
  // The printed description stays with the dish; no amount leaks into it.
  assert.equal(caviar.description, 'fictieve blini | fictieve room');
});

test('K2: a base amount in the title plus a labelled amount at the end of the row stay two variants', () => {
  const result = sections(`<h2>Hoofdgerechten</h2><p>
    <span><strong>Fictief gevogelte 34</strong><br /></span>
    <span>fictief gegaard | fictief seizoensgroen<br /></span>
    <span><em><strong><span>inclusief fictieve ganzenlever 44<br /><br /></span></strong></em></span>
    <span><strong>Fictieve vis 28</strong><br /></span>
    <span>fictief gebakken | fictieve boter<br /><br /></span>
    <span><strong>Fictief gerecht 19</strong><br /></span>
    <span>fictieve saus</span></p>`);
  const items = result.sections[0].items;
  const poultry = items.find((item) => item.name === 'Fictief gevogelte');
  assert.equal(poultry.priceStatus, 'multiple_undecomposed');
  assert.deepEqual(poultry.priceVariants, [
    { label: null, price: '34.00' },
    { label: 'inclusief fictieve ganzenlever', price: '44.00' },
  ]);
  // The bold lowercase continuation is never a dish of its own.
  assert.equal(items.some((item) => /ganzenlever/i.test(item.name)), false);
  // Its neighbours keep their own single price and description.
  const fish = items.find((item) => item.name === 'Fictieve vis');
  assert.equal(fish.priceStatus, 'known');
  assert.equal(fish.amountMinorUnits, 2800);
  assert.equal(fish.description, 'fictief gebakken | fictieve boter');
});

test('K2: a dish title split over two markup runs stays one literal name and does not swallow the dish above', () => {
  const result = sections(`<h2>Nagerechten</h2><p>
    <span><strong>Fictief dessert 9</strong><br /></span>
    <span>fictieve vanille | fictieve room<br /><br /></span>
    <strong><span>F</span></strong><span><strong>ictieve peer 12</strong><br /></span>
    <span>fictieve pecan | fictief karamel<br /><br /></span>
    <span><strong>Fictief kaasje 14</strong><br /></span>
    <span>fictieve noten</span></p>`);
  const items = result.sections[0].items;
  assert.deepEqual(items.map((item) => item.name), ['Fictief dessert', 'F ictieve peer', 'Fictief kaasje']);
  // The split name is kept exactly as printed, never de-spaced into "Fictieve".
  assert.equal(items[1].amountMinorUnits, 1200);
  // The dessert above keeps only its own description.
  assert.equal(items[0].description, 'fictieve vanille | fictieve room');
  assert.equal(items[1].description, 'fictieve pecan | fictief karamel');
});

test('K2: a row with two name+price pairs stays refused, never merged into one dish with variants', () => {
  const result = sections(`<h2>Lunch</h2><p>
    <span><strong>Fictief duogerecht</strong><br /></span>
    <span>fictieve soep 4,50 fictieve salade 6,50<br /><br /></span>
    <span><strong>Fictieve soep</strong><br /></span>
    <span>fictieve pompoen 4,50<br /><br /></span>
    <span><strong>Fictieve salade</strong><br /></span>
    <span>fictieve geitenkaas 6,50<br /><br /></span>
    <span><strong>Fictief brood</strong><br /></span>
    <span>fictief desembrood 3,00</span></p>`);
  const items = result.sections[0].items;
  assert.deepEqual(items.map((item) => item.name), ['Fictieve soep', 'Fictieve salade', 'Fictief brood']);
  assert.equal(items.some((item) => item.priceStatus === 'multiple_undecomposed'), false);
});
