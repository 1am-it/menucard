'use strict';

// BE-29 (#70) — de daghap alleen als de bron het zelf zegt, altijd met de
// brondatum, en een verlopen daghap blijft op de menukaart staan.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  isDailyDish,
  dailyDishInfo,
  isDailyFromToday,
  dailyDishStatus,
  dutchDateLabel,
  parseIsoDate,
} = require('./dailyDish');

test('BE-29: Daghap, Dagschotel, Dagspecial, Vandaag en het Dagspecial-label tellen', () => {
  assert.equal(isDailyDish({ name: 'Daghap' }), true);
  assert.equal(isDailyDish({ name: 'Dagschotel van de chef' }), true);
  assert.equal(isDailyDish({ name: 'Soep van vandaag' }), true);
  assert.equal(isDailyDish({ name: 'Huisgemaakte soep', tags: ['dagspecial'] }), true);
  assert.equal(isDailyDish({ name: 'Huisgemaakte soep', desc: 'Onze dagspecial' }), true);
  assert.equal(isDailyDish({ name: 'Huisgemaakte soep' }), false, 'een gewoon gerecht is geen daghap');
  assert.equal(isDailyDish({ name: 'Soep', desc: 'elke dag vers' }), false, 'geen gok op basis van losse woorden');
});

test('BE-29: het label komt altijd met de brondatum van de kaart', () => {
  const info = dailyDishInfo({ name: 'Daghap' }, { sourceDate: '2026-03-25' });
  assert.deepEqual(info, {
    label: 'Daghap',
    emoji: '📅',
    sourceDate: '2026-03-25',
    dateLabel: '25 maart 2026',
    dateLine: 'volgens de kaart van 25 maart 2026',
  });
  assert.equal(dailyDishInfo({ name: 'Daghap' }, { sourceDate: 'onbekend' }), null, 'zonder brondatum geen label');
  assert.equal(dailyDishInfo({ name: 'Daghap' }, {}), null);
  assert.equal(dailyDishInfo({ name: 'Soep' }, { sourceDate: '2026-03-25' }), null);
});

test('BE-29: vandaag en verlopen zijn twee eerlijke toestanden', () => {
  const info = dailyDishInfo({ name: 'Dagschotel' }, { sourceDate: '2026-10-23' });
  const now = new Date('2026-10-23T18:00:00Z'); // 20:00 in Amsterdam
  assert.equal(isDailyFromToday(info, now), true);
  assert.equal(dailyDishStatus(info, now), 'today');

  const expired = dailyDishInfo({ name: 'Dagschotel' }, { sourceDate: '2026-03-25' });
  assert.equal(isDailyFromToday(expired, now), false);
  assert.equal(dailyDishStatus(expired, now), 'expired');
  assert.equal(dailyDishStatus(expired, now), 'expired', 'een verlopen daghap blijft herkenbaar voor de menukaart');
  assert.equal(dailyDishStatus(null, now), null);
});

test('BE-29: de tijdzone is Europe/Amsterdam, niet de machineklok', () => {
  const info = dailyDishInfo({ name: 'Daghap' }, { sourceDate: '2026-10-24' });
  // 22:30 UTC is al 00:30 op 24 oktober in Amsterdam (zomertijd, UTC+2).
  assert.equal(isDailyFromToday(info, new Date('2026-10-23T22:30:00Z')), true);
  assert.equal(isDailyFromToday(info, new Date('2026-10-23T21:30:00Z')), false);
});

test('BE-29: datumlabels zijn Nederlands en strikt geldig', () => {
  assert.equal(dutchDateLabel('2026-10-25'), '25 oktober 2026');
  assert.equal(dutchDateLabel('2026-01-01'), '1 januari 2026');
  assert.equal(dutchDateLabel('2026-02-30'), null);
  assert.equal(dutchDateLabel('25-10-2026'), null);
  assert.equal(parseIsoDate('2026-10-25').iso, '2026-10-25');
});
