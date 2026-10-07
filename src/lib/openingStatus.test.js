'use strict';

// Kleurtaal v2 — src/lib/openingStatus.js. Deterministic: every case uses an
// explicit local moment, so the result never depends on when the test runs.
// Wednesday 7 October 2026 ("wo").

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { todayOpening, openingBadge } = require('./openingStatus');

const HOURS = { wo: '12:00-23:00', do: '17:00-22:00' };
const at = (h, m = 0) => new Date(2026, 9, 7, h, m);
const badgeAt = (h, m) => openingBadge(todayOpening(HOURS, at(h, m)), HOURS, 'wo');
const NO_OPEN_WORD = /\bOpen\b|Nu open/;

test('02:00, before opening: not open — neutral clock, "Opent vandaag om 12:00", never the word Open', () => {
  assert.equal(todayOpening(HOURS, at(2)).state, 'later');
  const b = badgeAt(2);
  assert.deepEqual([b.role, b.icon], ['neutral', 'clock']);
  assert.equal(b.text, 'Opent vandaag om 12:00');
  assert.doesNotMatch(b.text, NO_OPEN_WORD);
});

test('13:30, inside the window: open now — positive, check, "Nu open · tot 23:00"', () => {
  assert.equal(todayOpening(HOURS, at(13, 30)).state, 'open');
  assert.deepEqual(badgeAt(13, 30), { role: 'positive', icon: 'check', text: 'Nu open · tot 23:00' });
});

test('the window is open from the opening minute up to, not including, the closing minute (same rule as the existing helpers)', () => {
  assert.equal(todayOpening(HOURS, at(11, 59)).state, 'later');
  assert.equal(todayOpening(HOURS, at(12, 0)).state, 'open');
  assert.equal(todayOpening(HOURS, at(22, 59)).state, 'open');
  assert.equal(todayOpening(HOURS, at(23, 0)).state, 'closed-now');
});

test('23:30, after closing: neutral "Nu gesloten · vandaag 12:00-23:00", not positive', () => {
  const b = badgeAt(23, 30);
  assert.deepEqual([b.role, b.icon, b.text], ['neutral', 'clock', 'Nu gesloten · vandaag 12:00-23:00']);
  assert.doesNotMatch(b.text, NO_OPEN_WORD);
});

test('no opening hours today: neutral "Gesloten vandaag"', () => {
  const b = openingBadge(todayOpening({ do: '17:00-22:00' }, at(13)), { do: '17:00-22:00' }, 'wo');
  assert.deepEqual(b, { role: 'neutral', icon: 'clock', text: 'Gesloten vandaag' });
  assert.equal(todayOpening(undefined, at(13)).state, 'closed-today');
});

test('an unreadable entry is never shown as open', () => {
  const hours = { wo: 'op afspraak' };
  const b = openingBadge(todayOpening(hours, at(13)), hours, 'wo');
  assert.deepEqual([b.role, b.text], ['neutral', 'Vandaag op afspraak']);
});

test('before the browser clock is known (server render, first paint) the badge is neutral, even during opening hours', () => {
  assert.deepEqual(openingBadge(null, HOURS, 'wo'), { role: 'neutral', icon: 'clock', text: 'Vandaag 12:00-23:00' });
  assert.deepEqual(openingBadge(null, HOURS, 'ma'), { role: 'neutral', icon: 'clock', text: 'Gesloten vandaag' });
});

test('only an open-now state is positive, over a whole day in 15-minute steps', () => {
  for (let min = 0; min < 24 * 60; min += 15) {
    const opening = todayOpening(HOURS, at(Math.floor(min / 60), min % 60));
    const b = openingBadge(opening, HOURS, 'wo');
    assert.equal(b.role === 'positive', opening.state === 'open', `${min} min`);
    if (b.role !== 'positive') assert.doesNotMatch(b.text, NO_OPEN_WORD, `${min} min`);
  }
});
