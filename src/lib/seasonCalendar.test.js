'use strict';

// BE-29 (#70) — één geteste seizoenskalender voor de home en één streng
// seizoenslabel voor de menukaart.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { SEASONS, seasonsForMonth, seasonTiles, seasonLabelForMenu } = require('./seasonCalendar');

test('BE-29: de kalender volgt het eigenaarsbesluit — asperges apr–jun, mosselen sep–mrt, wild okt–dec, pompoen sep–nov', () => {
  const expected = {
    asperges: [4, 5, 6],
    mosselen: [1, 2, 3, 9, 10, 11, 12],
    wild: [10, 11, 12],
    pompoen: [9, 10, 11],
  };
  assert.deepEqual(SEASONS.map((season) => season.id).sort(), Object.keys(expected).sort());
  for (const season of SEASONS) {
    assert.deepEqual([...season.months].sort((a, b) => a - b), expected[season.id], season.id);
  }
});

test('BE-29: per maand verschijnen alleen de seizoenen die dan lopen', () => {
  assert.deepEqual(seasonsForMonth(1).map((season) => season.id), ['mosselen']);
  assert.deepEqual(seasonsForMonth(4).map((season) => season.id), ['asperges']);
  assert.deepEqual(seasonsForMonth(6).map((season) => season.id), ['asperges']);
  assert.deepEqual(seasonsForMonth(9).map((season) => season.id), ['mosselen', 'pompoen']);
  assert.deepEqual(seasonsForMonth(10).map((season) => season.id), ['mosselen', 'wild', 'pompoen']);
  assert.deepEqual(seasonsForMonth(12).map((season) => season.id), ['mosselen', 'wild']);
  assert.deepEqual(seasonsForMonth(7), [], 'juli heeft geen seizoenstegel');
  assert.deepEqual(seasonsForMonth(0), []);
  assert.deepEqual(seasonsForMonth(13), []);
  assert.deepEqual(seasonsForMonth('10').map((season) => season.id), ['mosselen', 'wild', 'pompoen']);
});

test('BE-29: een seizoenstegel is een bestaande zoekopdracht, geen nieuwe route', () => {
  assert.deepEqual(seasonTiles(10).map((tile) => tile.href), [
    '/search?q=mosselen',
    '/search?q=wild',
    '/search?q=pompoen',
  ]);
  assert.deepEqual(seasonTiles(4).map((tile) => tile.id), ['asperges']);
});

test('BE-29: het label Seizoen alleen als de kaart het zelf zegt', () => {
  assert.deepEqual(seasonLabelForMenu({ subtitle: 'Wildkaart' }), { label: 'Seizoen', emoji: '🌿' });
  assert.deepEqual(seasonLabelForMenu({ title: 'Seizoenskaart' }), { label: 'Seizoen', emoji: '🌿' });
  assert.deepEqual(
    seasonLabelForMenu({ subtitle: 'Dinerkaart', categories: [{ name: 'Seizoen', items: [] }] }),
    { label: 'Seizoen', emoji: '🌿' }
  );
  // Een gerechtnaam of een gewone rubriek is geen seizoenskaart.
  assert.equal(
    seasonLabelForMenu({ subtitle: 'Dinerkaart', categories: [{ name: 'Bijgerechten', items: [{ name: 'Seizoensgroenten' }] }] }),
    null
  );
  assert.equal(seasonLabelForMenu({ subtitle: 'Dinerkaart', categories: [{ name: 'Hoofdgerechten', items: [] }] }), null);
  assert.equal(seasonLabelForMenu(null), null);
});
