'use strict';

// Onze Menukaarten — toelichting en extern-markering bij reserveeracties
// (handoff "5 · Oker licht — uitgewerkt"). Routering zelf is BE-07 en
// verandert hier niet.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getReservationNote, isExternalReservation } = require('./reservation');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('getReservationNote names the restaurant\'s own channel and says Onze Menukaarten takes no bookings', () => {
  const tail = 'Onze Menukaarten neemt zelf geen reserveringen of bestellingen aan.';
  assert.equal(getReservationNote({ method: 'website' }, 'Con Fuego'), `Reserveren gaat via de website van Con Fuego. ${tail}`);
  assert.equal(getReservationNote({ method: 'whatsapp' }, 'Con Fuego'), `Reserveren gaat via WhatsApp met Con Fuego. ${tail}`);
  assert.equal(getReservationNote({ method: 'phone' }, 'Con Fuego'), `Reserveren gaat telefonisch bij Con Fuego. ${tail}`);
});

test('getReservationNote returns null without an action or for an unknown method', () => {
  assert.equal(getReservationNote(null, 'X'), null);
  assert.equal(getReservationNote({ method: 'fax' }, 'X'), null);
});

test('isExternalReservation: website and WhatsApp leave the site, phone does not', () => {
  assert.equal(isExternalReservation({ method: 'website', external: true }), true);
  assert.equal(isExternalReservation({ method: 'whatsapp' }), true);
  assert.equal(isExternalReservation({ method: 'phone' }), false);
  assert.equal(isExternalReservation(undefined), false);
});

for (const file of ['app/menu/[id]/MenuView.js', 'app/restaurant/[id]/RestaurantDetailView.js']) {
  test(`${file}: the visible reservation action shows the note and the accessible external icon`, () => {
    const src = read(file);
    assert.match(src, /<p className="reservation-note">\{getReservationNote\(primaryReservation, /);
    assert.match(src, /\{isExternalReservation\(primaryReservation\) && <ExternalLinkIcon \/>\}/);
  });
}

test('ExternalLinkIcon: decorative icon plus visually hidden "opens in a new window" text', () => {
  const src = read('src/components/ExternalLinkIcon.js');
  assert.match(src, /aria-hidden="true"/);
  assert.match(src, /<span className="visually-hidden"> \(opent in een nieuw venster\)<\/span>/);
});
