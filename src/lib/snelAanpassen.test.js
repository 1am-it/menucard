'use strict';

// BE-58 deel 1 (#143) — de pure rekenregels, met `node --test`.
//
// Wat hier bewezen wordt (contract: grenzen, "grote wijziging", 30 per dag,
// 90 dagen en de overlay):
//   - de prijsgrens is € 0,50 - € 150 en de notatie blijft die van de kaart;
//   - meer dan 50% afwijking markeert "grote wijziging", precies 50% niet;
//   - het dagmaximum is 30 en de dag begint om middernacht in Amsterdam;
//   - het bevestigingslabel vervalt na 90 dagen;
//   - de overlay verandert alleen prijs en beschikbaarheid van het juiste
//     gerecht; elk ander veld en elk ander gerecht blijft exact gelijk.
//
// FICTIONELE DATA: de kaart hieronder is verzonnen en lijkt alleen qua vorm op
// data/menus.json.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  BEVESTIGING_LABEL,
  BEVESTIGING_GELDIG_DAGEN,
  FOUTEN,
  MAX_WIJZIGINGEN_PER_DAG,
  PRIJS_MAX_CENT,
  PRIJS_MIN_CENT,
  TIJDELIJK_NIET_BESCHIKBAAR_LABEL,
  beginVanDagAmsterdam,
  bevestigingDatum,
  bevestigingStatus,
  bevestigingVoorScherm,
  formatPrijsCent,
  isBevestigingGeldig,
  isGroteWijziging,
  magWijzigenVandaag,
  overlayVoorScherm,
  parsePrijsCent,
  pasOverlayToe,
  resterendVandaag,
  valideerWijziging,
} = require('./snelAanpassen');

const MENU = {
  name: 'Fictief Restaurant',
  address: 'Markt 1',
  scraped: '2026-10-01',
  categories: [
    {
      name: 'Voorgerechten',
      items: [
        { name: 'Tomatensoep', desc: 'Met basilicum', price: '€6,50', priceValue: 6.5, tags: ['vega'], allergens: [] },
        { name: 'Bruschetta', desc: 'Met tomaat', price: '€7', priceValue: 7, tags: [], allergens: [] },
      ],
    },
    {
      name: 'Hoofdgerechten',
      items: [
        { name: 'Stoofvlees', desc: 'Met friet', price: '€18,50', priceValue: 18.5, tags: [], allergens: ['gluten'] },
      ],
    },
  ],
};

test('BE-58: de prijsgrens is € 0,50 - € 150, in centen', () => {
  assert.equal(PRIJS_MIN_CENT, 50);
  assert.equal(PRIJS_MAX_CENT, 15000);
  for (const [invoer, cent] of [['0,50', 50], ['150', 15000], ['12,50', 1250], ['€ 12,50', 1250], ['85', 8500], [12.5, 1250]]) {
    assert.equal(parsePrijsCent(invoer), cent, `invoer ${invoer}`);
  }
  for (const ongeldig of ['', 'abc', '-1', '12,345', null, undefined, {}, '1.234,56']) {
    assert.equal(parsePrijsCent(ongeldig), null, `invoer ${ongeldig}`);
  }
  assert.equal(formatPrijsCent(7250), '€72,50');
  assert.equal(formatPrijsCent(8500), '€85');
  assert.equal(formatPrijsCent(50), '€0,50');
});

test('BE-58: onder de grens en boven de grens worden geweigerd', () => {
  assert.deepEqual(valideerWijziging({ soort: 'prijs', prijsCent: 49 }), { ok: false, fouten: [FOUTEN.prijsGrens] });
  assert.deepEqual(valideerWijziging({ soort: 'prijs', prijsCent: 15001 }), { ok: false, fouten: [FOUTEN.prijsGrens] });
  assert.equal(valideerWijziging({ soort: 'prijs', prijsCent: 50 }).ok, true);
  assert.equal(valideerWijziging({ soort: 'prijs', prijsCent: 15000 }).ok, true);
  assert.deepEqual(valideerWijziging({ soort: 'prijs', prijs: 'x' }).fouten, [FOUTEN.prijs]);
  assert.deepEqual(valideerWijziging({ soort: 'onbekend' }).fouten, [FOUTEN.soort]);
  assert.deepEqual(valideerWijziging({ soort: 'beschikbaarheid' }).fouten, [FOUTEN.beschikbaarheid]);
  assert.equal(valideerWijziging({ soort: 'beschikbaarheid', beschikbaar: false }).ok, true);
});

test('BE-58: "grote wijziging" bij meer dan 50% verschil, niet bij precies 50%', () => {
  assert.equal(isGroteWijziging(1000, 1500), false, 'precies 50% omhoog is geen grote wijziging');
  assert.equal(isGroteWijziging(1000, 500), false, 'precies 50% omlaag is geen grote wijziging');
  assert.equal(isGroteWijziging(1000, 1501), true);
  assert.equal(isGroteWijziging(1000, 499), true);
  assert.equal(isGroteWijziging(0, 500), false, 'zonder huidige prijs geen markering');
  assert.equal(isGroteWijziging(undefined, 500), false);
  const groot = valideerWijziging({ soort: 'prijs', prijsCent: 3000, huidigePrijsCent: 1000 });
  assert.equal(groot.ok, true);
  assert.equal(groot.wijziging.groteWijziging, true);
  const klein = valideerWijziging({ soort: 'prijs', prijsCent: 1200, huidigePrijsCent: 1000 });
  assert.equal(klein.wijziging.groteWijziging, false);
  const beschikbaarheid = valideerWijziging({ soort: 'beschikbaarheid', beschikbaar: false, huidigePrijsCent: 1000 });
  assert.equal(beschikbaarheid.wijziging.groteWijziging, false);
});

test('BE-58: maximaal 30 wijzigingen per Amsterdamse kalenderdag', () => {
  assert.equal(MAX_WIJZIGINGEN_PER_DAG, 30);
  assert.equal(magWijzigenVandaag(29), true);
  assert.equal(magWijzigenVandaag(30), false);
  assert.equal(magWijzigenVandaag(31), false);
  assert.equal(resterendVandaag(30), 0);
  assert.equal(resterendVandaag(7), 23);
  // De dag begint om middernacht in Amsterdam, ook bij zomer- en wintertijd.
  assert.equal(beginVanDagAmsterdam(new Date('2026-08-15T12:00:00Z')), '2026-08-14T22:00:00.000Z');
  assert.equal(beginVanDagAmsterdam(new Date('2026-12-01T12:00:00Z')), '2026-11-30T23:00:00.000Z');
  assert.equal(beginVanDagAmsterdam(new Date('2026-07-01T22:30:00Z')), '2026-07-01T22:00:00.000Z');
});

test('BE-58: het bevestigingslabel vervalt na 90 dagen', () => {
  assert.equal(BEVESTIGING_GELDIG_DAGEN, 90);
  const bevestigd = '2026-08-01T10:00:00.000Z';
  const dag89 = '2026-10-29T10:00:00.000Z';
  const dag90 = '2026-10-30T10:00:00.000Z';
  assert.equal(isBevestigingGeldig(bevestigd, dag89), true);
  assert.equal(isBevestigingGeldig(bevestigd, dag90), false, 'na precies 90 dagen geldt het niet meer');
  const status = bevestigingStatus(bevestigd, dag89);
  assert.equal(status.actief, true);
  assert.equal(status.verlooptOp, '2026-10-30T10:00:00.000Z');
  assert.equal(bevestigingStatus(bevestigd, dag90).dagenOver, 0);
  assert.equal(isBevestigingGeldig(null), false);
  assert.equal(isBevestigingGeldig('geen datum'), false);
});

test('BE-58: het bevestigingslabel toont de datum en de vaste tekst', () => {
  const scherm = bevestigingVoorScherm({ bevestigdOp: '2026-10-30T09:00:00.000Z', now: '2026-11-05T09:00:00.000Z' });
  assert.deepEqual(scherm, {
    actief: true,
    label: 'Bevestigd door het restaurant',
    datum: '30-10-2026',
    verlooptOp: '2027-01-28T09:00:00.000Z',
  });
  assert.equal(BEVESTIGING_LABEL, 'Bevestigd door het restaurant');
  assert.equal(bevestigingDatum('2026-10-30T09:00:00.000Z'), '30-10-2026');
  assert.deepEqual(bevestigingVoorScherm({ bevestigdOp: '2026-01-01T00:00:00.000Z', now: '2026-10-30T00:00:00.000Z' }), {
    actief: false,
    label: '',
    datum: '',
    verlooptOp: null,
  });
});

test('BE-58: de overlay verandert alleen de prijs van het juiste gerecht', () => {
  const gewijzigd = pasOverlayToe(MENU, [
    { menu_id: '9-lunch', categorie_index: 0, gerecht_index: 1, soort: 'prijs', prijs_cent: 900 },
  ]);
  assert.notEqual(gewijzigd, MENU);
  assert.equal(gewijzigd.categories[0].items[1].price, '€9');
  assert.equal(gewijzigd.categories[0].items[1].priceValue, 9);
  // Het andere gerecht en de andere categorie blijven hetzelfde object.
  assert.equal(gewijzigd.categories[0].items[0], MENU.categories[0].items[0]);
  assert.equal(gewijzigd.categories[1], MENU.categories[1]);
  // Alles behalve prijs en prijsValue is gelijk.
  const { price, priceValue, ...rest } = gewijzigd.categories[0].items[1];
  const { price: oudePrijs, priceValue: oudeWaarde, ...oudRest } = MENU.categories[0].items[1];
  assert.deepEqual(rest, oudRest);
  assert.notEqual(price, oudePrijs);
  assert.notEqual(priceValue, oudeWaarde);
  // De rest van de kaart is onaangeroerd.
  assert.equal(gewijzigd.name, MENU.name);
  assert.equal(gewijzigd.address, MENU.address);
  assert.equal(MENU.categories[0].items[1].price, '€7', 'de statische data zelf blijft ongewijzigd');
});

test('BE-58: de overlay zet en haalt "tijdelijk niet beschikbaar"', () => {
  const uit = pasOverlayToe(MENU, [
    { categorie_index: 1, gerecht_index: 0, soort: 'beschikbaarheid', beschikbaar: false },
  ]);
  assert.equal(uit.categories[1].items[0].tijdelijkNietBeschikbaar, true);
  assert.equal(uit.categories[1].items[0].price, '€18,50');
  assert.equal(TIJDELIJK_NIET_BESCHIKBAAR_LABEL, 'Tijdelijk niet beschikbaar');

  const weerAan = pasOverlayToe(uit, [
    { categorie_index: 1, gerecht_index: 0, soort: 'beschikbaarheid', beschikbaar: true },
  ]);
  assert.equal('tijdelijkNietBeschikbaar' in weerAan.categories[1].items[0], false);
  assert.equal(weerAan.categories[1].items[0].price, '€18,50');
});

test('BE-58: een wijziging buiten de kaart laat alles gelijk', () => {
  const zelfde = pasOverlayToe(MENU, [
    { categorie_index: 5, gerecht_index: 0, soort: 'prijs', prijs_cent: 900 },
    { categorie_index: 0, gerecht_index: 9, soort: 'prijs', prijs_cent: 900 },
  ]);
  assert.equal(zelfde, MENU);
  assert.equal(pasOverlayToe(MENU, []), MENU);
  assert.equal(pasOverlayToe(MENU, null), MENU);
  assert.equal(pasOverlayToe(null, [{ categorie_index: 0, gerecht_index: 0 }]), null);
});

test('BE-58: de laatste wijziging per gerecht wint', () => {
  const uit = pasOverlayToe(MENU, [
    { categorie_index: 0, gerecht_index: 0, soort: 'prijs', prijs_cent: 800 },
    { categorie_index: 0, gerecht_index: 0, soort: 'prijs', prijs_cent: 950 },
  ]);
  assert.equal(uit.categories[0].items[0].price, '€9,50');
});

test('BE-58: de publieke overlay bevat alleen weergavevelden', () => {
  const scherm = overlayVoorScherm([
    {
      wijziging_id: 7, restaurant_id: '9', menu_id: '9-lunch', categorie_index: 0, gerecht_index: 1,
      gerecht_naam: 'Bruschetta', soort: 'prijs', prijs_cent: 900, user_id: 'geheim',
      status: 'goedgekeurd', beoordeeld_door: 'intern', grote_wijziging: true,
    },
    {
      menu_id: '9-lunch', categorie_index: 1, gerecht_index: 0, gerecht_naam: 'Stoofvlees',
      soort: 'beschikbaarheid', beschikbaar: false,
    },
  ]);
  assert.deepEqual(scherm, [
    {
      menuId: '9-lunch', categorieIndex: 0, gerechtIndex: 1, gerechtNaam: 'Bruschetta',
      soort: 'prijs', prijsCent: 900, prijs: '€9', tijdelijkNietBeschikbaar: false,
    },
    {
      menuId: '9-lunch', categorieIndex: 1, gerechtIndex: 0, gerechtNaam: 'Stoofvlees',
      soort: 'beschikbaarheid', prijsCent: null, prijs: '', tijdelijkNietBeschikbaar: true,
    },
  ]);
  const velden = Object.keys(scherm[0]).sort();
  assert.deepEqual(velden, ['categorieIndex', 'gerechtIndex', 'gerechtNaam', 'menuId', 'prijs', 'prijsCent', 'soort', 'tijdelijkNietBeschikbaar']);
});
