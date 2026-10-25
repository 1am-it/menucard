'use strict';

// BE-29 (#70) — de kalenderdag moet in Breda (Europe/Amsterdam) vallen, niet
// in de tijdzone van de server of de bezoeker.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { zonedParts } = require('./localTime');

test('BE-29: zonedParts rekent in Europe/Amsterdam en levert de bestaande weeksleutel', () => {
  const summer = zonedParts(new Date('2026-10-23T18:00:00Z'), 'Europe/Amsterdam');
  assert.equal(summer.dateKey, '2026-10-23');
  assert.equal(summer.dayKey, 'vr');
  assert.equal(summer.hour, 20);
  assert.equal(summer.minute, 0);
  assert.equal(summer.minutes, 20 * 60);

  const winter = zonedParts(new Date('2026-12-01T12:00:00Z'), 'Europe/Amsterdam');
  assert.equal(winter.hour, 13, 'wintertijd is UTC+1');
});

test('BE-29: middernacht wordt 00:00 en niet 24:00, en de datum schuift mee', () => {
  const midnight = zonedParts(new Date('2026-10-23T22:00:00Z'), 'Europe/Amsterdam');
  assert.equal(midnight.dateKey, '2026-10-24');
  assert.equal(midnight.dayKey, 'za');
  assert.equal(midnight.hour, 0);
  assert.equal(midnight.minutes, 0);
});

test('BE-29: een ongeldig moment faalt luid in plaats van stil te gokken', () => {
  assert.throws(() => zonedParts(new Date('niet-een-datum')), /localTime/);
});
