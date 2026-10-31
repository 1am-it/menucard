'use strict';

// BE-58 deel 2 (#143) — de publieke overlay als pure stap, met `node --test`.
//
// Bewezen wordt:
//   - het antwoord van de overlay-API wordt gelezen zoals de handler hem geeft;
//   - een 503 (migratie ontbreekt), 401 of onzin geeft een lege overlay;
//   - de overlay raakt alleen de prijs en de beschikbaarheid van het juiste
//     gerecht, en alleen op de getoonde menukaart;
//   - de statische kaart blijft ongewijzigd (geen mutatie van de invoer).
//
// FICTIONELE DATA: de kaart hieronder is verzonnen en lijkt alleen qua vorm op
// data/menus.json.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { leesPubliekeOverlay, overlayVoorMenu, LEGE_BEVESTIGING } = require('./menukaartOverlay');

function kaart() {
  return {
    name: 'Fictieve kaart',
    categories: [
      {
        name: 'Hoofdgerechten',
        items: [
          { name: 'Gerecht A', price: '€ 12,50', priceValue: 12.5, desc: 'met saus' },
          { name: 'Gerecht B', price: '€ 9', priceValue: 9 },
        ],
      },
      { name: 'Nagerechten', items: [{ name: 'Gerecht C', price: '€ 6,50', priceValue: 6.5 }] },
    ],
  };
}

const BEVESTIGD = {
  actief: true,
  label: 'Bevestigd door het restaurant',
  datum: '30-10-2026',
  verlooptOp: '2027-01-28T00:00:00.000Z',
};

test('een geldig 200-antwoord wordt overgenomen, met het label', () => {
  const overlay = leesPubliekeOverlay({
    status: 200,
    body: {
      ok: true,
      restaurantId: 'fictief',
      wijzigingen: [{ menuId: 'fictief-lunch', categorieIndex: 0, gerechtIndex: 0, soort: 'prijs', prijsCent: 1000 }],
      bevestiging: BEVESTIGD,
    },
  });
  assert.equal(overlay.wijzigingen.length, 1);
  assert.equal(overlay.bevestiging.actief, true);
  assert.equal(overlay.bevestiging.label, 'Bevestigd door het restaurant');
  assert.equal(overlay.bevestiging.datum, '30-10-2026');
});

test('503 zonder migratie, 401 en onzin geven een lege overlay en nooit een fout', () => {
  for (const antwoord of [
    { status: 503, body: { error: 'menukaart_unavailable' } },
    { status: 401, body: { error: 'unauthorized' } },
    { status: 200, body: { ok: false } },
    null,
    undefined,
  ]) {
    const overlay = leesPubliekeOverlay(antwoord);
    assert.deepEqual(overlay.wijzigingen, []);
    assert.equal(overlay.bevestiging.actief, false);
    assert.equal(overlay.bevestiging.label, '');
  }
  assert.equal(LEGE_BEVESTIGING.actief, false);
});

test('een verlopen bevestiging levert geen label op', () => {
  const overlay = leesPubliekeOverlay({
    status: 200,
    body: { ok: true, wijzigingen: [], bevestiging: { actief: false, label: '', datum: '' } },
  });
  assert.equal(overlay.bevestiging.actief, false);
  assert.equal(overlay.bevestiging.label, '');
});

test('de overlay verandert alleen prijs en beschikbaarheid van het juiste gerecht', () => {
  const menu = kaart();
  const origineel = structuredClone(menu);
  const overlay = {
    wijzigingen: [
      { menuId: 'fictief-lunch', categorieIndex: 0, gerechtIndex: 1, soort: 'prijs', prijsCent: 875 },
      { menuId: 'fictief-lunch', categorieIndex: 1, gerechtIndex: 0, soort: 'beschikbaarheid', tijdelijkNietBeschikbaar: true },
    ],
    bevestiging: BEVESTIGD,
  };

  const uit = overlayVoorMenu(menu, overlay, 'fictief-lunch');

  assert.equal(uit.categories[0].items[1].price, '€8,75');
  assert.equal(uit.categories[0].items[1].priceValue, 8.75);
  assert.equal(uit.categories[1].items[0].tijdelijkNietBeschikbaar, true);
  // Het andere gerecht in dezelfde categorie blijft exact gelijk.
  assert.deepEqual(uit.categories[0].items[0], origineel.categories[0].items[0]);
  assert.equal(uit.categories[0].items[0].tijdelijkNietBeschikbaar, undefined);
  // De statische kaart zelf is niet aangepast.
  assert.deepEqual(menu, origineel);
});

test('een wijziging van een andere menukaart komt niet op deze kaart terecht', () => {
  const menu = kaart();
  const overlay = {
    wijzigingen: [{ menuId: 'fictief-diner', categorieIndex: 0, gerechtIndex: 0, soort: 'prijs', prijsCent: 4000 }],
    bevestiging: LEGE_BEVESTIGING,
  };
  const uit = overlayVoorMenu(menu, overlay, 'fictief-lunch');
  assert.deepEqual(uit, menu);
});

test('zonder wijzigingen komt dezelfde kaart terug (geen onnodige render)', () => {
  const menu = kaart();
  assert.equal(overlayVoorMenu(menu, { wijzigingen: [], bevestiging: LEGE_BEVESTIGING }, 'fictief-lunch'), menu);
  assert.equal(overlayVoorMenu(menu, null, 'fictief-lunch'), menu);
});

test('"weer beschikbaar" haalt het label van het gerecht af', () => {
  const menu = kaart();
  menu.categories[1].items[0].tijdelijkNietBeschikbaar = true;
  const overlay = {
    wijzigingen: [{ menuId: 'fictief-lunch', categorieIndex: 1, gerechtIndex: 0, soort: 'beschikbaarheid', tijdelijkNietBeschikbaar: false }],
    bevestiging: LEGE_BEVESTIGING,
  };
  const uit = overlayVoorMenu(menu, overlay, 'fictief-lunch');
  assert.equal(uit.categories[1].items[0].tijdelijkNietBeschikbaar, undefined);
  assert.equal(uit.categories[1].items[0].price, '€ 6,50');
});
