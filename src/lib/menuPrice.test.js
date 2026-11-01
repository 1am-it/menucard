'use strict';

// BE-29 (#70) — het eerlijke prijslabel, en sinds BE-71 (#176) ook de toeslag.

const test = require('node:test');
const assert = require('node:assert/strict');
const { honestPriceLabel, menuPriceLabel } = require('./menuPrice');

test('een gewone prijs blijft zoals hij is', () => {
  assert.equal(menuPriceLabel({ price: '€12,50', priceValue: 12.5 }), '€12,50');
  assert.equal(menuPriceLabel({ price: 'op aanvraag', priceValue: null }), 'op aanvraag');
  assert.equal(menuPriceLabel({}), 'op aanvraag');
});

test('R5: een toeslag staat als "+ € 4" op de kaart, nooit als losse prijs', () => {
  assert.equal(menuPriceLabel({ price: '€4', priceValue: 4, priceIsSupplement: true }), '+ €4');
  // De bron print het plusteken al: niet verdubbelen.
  assert.equal(menuPriceLabel({ price: '+€20', priceValue: 20, priceIsSupplement: true }), '+€20');
  assert.equal(honestPriceLabel({ price: '€4', priceValue: 4, priceIsSupplement: true }), '€4');
});
