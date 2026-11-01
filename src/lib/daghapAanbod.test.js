'use strict';

// BE-55 stap A (#135, criterium 1) — de pure regels van daghap en
// seizoensgerecht, zonder database en zonder Supabase.
//
// Elke regel uit het contract heeft hier zijn eigen test, inclusief de
// weigeringen: naam, prijs, beschrijving, labels, geen URL/e-mail/telefoon,
// niet geheel in hoofdletters, geen "!!!", maximaal 3 emoji, het verloop in
// Europe/Amsterdam, de seizoensgrens van 90 dagen, het filter met woordenlijst
// en de 3×-prijsgrens, en de limieten (1 daghap, 3 seizoensgerechten, 10
// plaatsingen of wijzigingen per dag).
//
// De menukaarten en restaurants komen uit de echte projectdata, zodat een
// verkeerde aanname over data/menus.json meteen opvalt.

const assert = require('node:assert/strict');
const { test } = require('node:test');
require('../test-fixtures/useFrozenData').useFrozenData();
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const {
  DAGHAP_FOUTEN,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_LABELS,
  DAGHAP_MAX_WIJZIGINGEN_PER_DAG,
  DAGHAP_MESSAGES,
  aanbodVoorScherm,
  aantalEmoji,
  begindagVan,
  beoordeelAanbod,
  berichtBij,
  centenNaarPrijs,
  controleerTekst,
  duursteKaartPrijsCent,
  filterRedenen,
  heeftEmail,
  heeftTelefoon,
  heeftUrl,
  isActiefAanbod,
  isVerlopen,
  magSoortToevoegen,
  magVandaagWijzigen,
  normaliseerAanbod,
  normaliseerLabels,
  prijsNaarCenten,
  staatInHoofdletters,
  telActief,
  vervalmoment,
} = require('./daghapAanbod');

// Een gewone vrijdagmiddag in Amsterdam (CET, +1): 12:00 lokaal is 11:00 UTC.
const NU = Date.parse('2026-10-30T11:00:00.000Z');

const basis = {
  soort: 'daghap',
  naam: 'Pompoensoep met brood',
  prijs: '6,50',
  beschrijving: 'Met geroosterde pompoenpitten',
  labels: ['veganistisch'],
  nu: NU,
};

test('BE-55: een volledig daghap-aanbod komt er normaal door', () => {
  const resultaat = normaliseerAanbod(basis);
  assert.equal(resultaat.ok, true);
  assert.deepEqual(resultaat.fouten, []);
  assert.deepEqual(resultaat.aanbod, {
    soort: 'daghap',
    naam: 'Pompoensoep met brood',
    prijsCent: 650,
    beschrijving: 'Met geroosterde pompoenpitten',
    labels: ['veganistisch'],
    verlooptOp: '2026-10-30T22:59:00.000Z',
  });
});

test('BE-55: de naam moet 3 tot 80 tekens zijn', () => {
  const kort = normaliseerAanbod({ ...basis, naam: 'So' });
  assert.equal(kort.ok, false);
  assert.ok(kort.fouten.includes(DAGHAP_FOUTEN.naamKort));
  assert.equal(berichtBij(DAGHAP_FOUTEN.naamKort), DAGHAP_MESSAGES.naam);

  const leeg = normaliseerAanbod({ ...basis, naam: '   ' });
  assert.ok(leeg.fouten.includes(DAGHAP_FOUTEN.naamKort));

  const net = normaliseerAanbod({ ...basis, naam: 'Soep' });
  assert.equal(net.ok, true, 'precies drie tekens mag');

  const tachtig = normaliseerAanbod({ ...basis, naam: 'a'.repeat(80) });
  assert.equal(tachtig.ok, true, 'precies 80 tekens mag');
  assert.equal(tachtig.aanbod.naam.length, 80);

  const lang = normaliseerAanbod({ ...basis, naam: 'a'.repeat(81) });
  assert.equal(lang.ok, false);
  assert.ok(lang.fouten.includes(DAGHAP_FOUTEN.naamLang));
});

test('BE-55: de prijs is verplicht en ligt tussen € 0,50 en € 150', () => {
  assert.equal(normaliseerAanbod({ ...basis, prijs: undefined }).ok, false);
  assert.equal(normaliseerAanbod({ ...basis, prijs: null }).ok, false);
  assert.equal(normaliseerAanbod({ ...basis, prijs: 'gratis' }).ok, false);
  assert.equal(normaliseerAanbod({ ...basis, prijs: 0.49 }).ok, false);
  assert.equal(normaliseerAanbod({ ...basis, prijs: 150.01 }).ok, false);
  assert.equal(normaliseerAanbod({ ...basis, prijs: '0,50' }).ok, true);
  assert.equal(normaliseerAanbod({ ...basis, prijs: '150' }).ok, true);
  assert.equal(normaliseerAanbod({ ...basis, prijs: 12.5 }).aanbod.prijsCent, 1250);
  assert.equal(normaliseerAanbod({ ...basis, prijs: '€ 12,50' }).aanbod.prijsCent, 1250);
  assert.equal(normaliseerAanbod({ ...basis, prijs_cent: 1250 }).ok, true);
  // Meer dan twee decimalen is geen ingetypte prijs: weigeren, niet afronden.
  assert.equal(prijsNaarCenten('12,505'), null);
  assert.equal(prijsNaarCenten(12.505), null);
  assert.equal(centenNaarPrijs(1250), '€ 12,50');
});

test('BE-55: de beschrijving is optioneel en mag maximaal 140 tekens zijn', () => {
  assert.equal(normaliseerAanbod({ ...basis, beschrijving: undefined }).ok, true);
  assert.equal(normaliseerAanbod({ ...basis, beschrijving: 'x'.repeat(140) }).ok, true);
  const teLang = normaliseerAanbod({ ...basis, beschrijving: 'x'.repeat(141) });
  assert.equal(teLang.ok, false);
  assert.ok(teLang.fouten.includes(DAGHAP_FOUTEN.beschrijving));
});

test('BE-55: alleen de labels vegetarisch, veganistisch en glutenvrij', () => {
  assert.deepEqual(DAGHAP_LABELS, ['vegetarisch', 'veganistisch', 'glutenvrij']);
  const ongeordend = normaliseerAanbod({ ...basis, labels: ['glutenvrij', 'veganistisch', 'glutenvrij'] });
  assert.deepEqual(ongeordend.aanbod.labels, ['veganistisch', 'glutenvrij']);
  assert.deepEqual(normaliseerLabels(['VEGANISTISCH']), ['veganistisch']);
  const onbekend = normaliseerAanbod({ ...basis, labels: ['pittig'] });
  assert.equal(onbekend.ok, false);
  assert.ok(onbekend.fouten.includes(DAGHAP_FOUTEN.labels));
});

test('BE-55: geen URL, e-mailadres of telefoonnummer in de tekst', () => {
  for (const naam of [
    'Soep zie https://voorbeeld.nl',
    'Soep van www.voorbeeld.nl',
    'Soep van voorbeeld.nl',
    'Soep mail naar kok@voorbeeld.nl',
    'Bel 076 201 49 75 voor soep',
    'Bel +31 6 1234 5678',
  ]) {
    const resultaat = normaliseerAanbod({ ...basis, naam });
    assert.equal(resultaat.ok, false, `${naam} hoort geweigerd te worden`);
  }
  assert.equal(heeftUrl('Onze kaart staat op bredaeats.nl'), true);
  assert.equal(heeftEmail('kok@restaurant.nl'), true);
  assert.equal(heeftTelefoon('076-201-4975'), true);
  // Een prijs of een tijd is geen telefoonnummer.
  assert.equal(heeftTelefoon('€ 12,50'), false);
  assert.equal(heeftTelefoon('Van 12:00 tot 21:00'), false);
  assert.equal(heeftUrl('Pompoensoep met brood'), false);
});

test('BE-55: niet geheel in hoofdletters, geen herhaalde leestekens', () => {
  assert.equal(staatInHoofdletters('POMPOENSOEP'), true);
  assert.equal(staatInHoofdletters('Pompoensoep'), false);
  assert.equal(staatInHoofdletters('12,50'), false, 'cijfers alleen zijn geen hoofdlettertekst');

  const hoofdletters = normaliseerAanbod({ ...basis, naam: 'POMPOENSOEP' });
  assert.equal(hoofdletters.ok, false);
  assert.ok(hoofdletters.fouten.includes(DAGHAP_FOUTEN.hoofdletters));

  const uitroeptekens = normaliseerAanbod({ ...basis, beschrijving: 'Heerlijk!!!' });
  assert.equal(uitroeptekens.ok, false);
  assert.ok(uitroeptekens.fouten.includes(DAGHAP_FOUTEN.leestekens));

  // Twee uitroeptekens is gewone tekst.
  assert.equal(normaliseerAanbod({ ...basis, beschrijving: 'Heerlijk!!' }).ok, true);
});

test('BE-55: maximaal drie emoji', () => {
  assert.equal(aantalEmoji('Soep 🍲 met brood 🥖'), 2);
  assert.equal(aantalEmoji('Niets bijzonders'), 0);
  assert.equal(normaliseerAanbod({ ...basis, naam: 'Soep 🍲🍲🍲' }).ok, true);
  const vier = normaliseerAanbod({ ...basis, naam: 'Soep 🍲🍲🍲🍲' });
  assert.equal(vier.ok, false);
  assert.ok(vier.fouten.includes(DAGHAP_FOUTEN.emoji));
});

test('BE-55: alleen een bekende soort, en platte tekst blijft platte tekst', () => {
  const onbekend = normaliseerAanbod({ ...basis, soort: 'dagschotel' });
  assert.equal(onbekend.ok, false);
  assert.ok(onbekend.fouten.includes(DAGHAP_FOUTEN.soort));

  // Wat er binnenkomt wordt als tekst opgeslagen: nooit als HTML uitgevoerd.
  const metHoekhaken = normaliseerAanbod({ ...basis, beschrijving: '<b>Soep</b> van de dag' });
  assert.equal(metHoekhaken.ok, true);
  assert.equal(metHoekhaken.aanbod.beschrijving, '<b>Soep</b> van de dag');
  const scherm = aanbodVoorScherm({
    id: 1,
    restaurant_id: '1',
    soort: 'daghap',
    naam: 'Soep',
    prijs_cent: 650,
    beschrijving: '<b>Soep</b> van de dag',
    labels: ['veganistisch'],
    status: 'online',
    verloopt_op: '2026-10-30T22:59:00.000Z',
  });
  assert.equal(scherm.beschrijving, '<b>Soep</b> van de dag', 'geen HTML, gewone tekst');
  assert.equal(scherm.prijs, '€ 6,50');
  assert.equal(scherm.inControle, false);
  assert.equal(scherm.melding, '');
});

test('BE-55: de tekstcontrole geeft alle fouten in één keer terug', () => {
  const resultaat = controleerTekst('GRATIS!!! SOEP VIA WWW.SOEP.NL');
  assert.equal(resultaat.ok, false);
  assert.deepEqual(resultaat.fouten, [
    DAGHAP_FOUTEN.url,
    DAGHAP_FOUTEN.hoofdletters,
    DAGHAP_FOUTEN.leestekens,
  ]);
});

test('BE-55: een daghap verloopt aan het eind van de dag in Europe/Amsterdam', () => {
  // 30 oktober is CET (+1): 23:59 lokaal is 22:59 UTC.
  assert.deepEqual(vervalmoment({ soort: 'daghap', nu: NU }), {
    ok: true,
    verlooptOp: '2026-10-30T22:59:00.000Z',
  });
  // Met een sluitingstijd verloopt hij daar: 21:30 lokaal is 20:30 UTC.
  assert.deepEqual(vervalmoment({ soort: 'daghap', nu: NU, sluitingstijd: '21:30' }), {
    ok: true,
    verlooptOp: '2026-10-30T20:30:00.000Z',
  });
  // Een onleesbare sluitingstijd valt terug op 23:59, niet op een gok.
  assert.equal(vervalmoment({ soort: 'daghap', nu: NU, sluitingstijd: '26:00' }).verlooptOp,
    '2026-10-30T22:59:00.000Z');
  // Zomertijd (CEST, +2): 23:59 lokaal is 21:59 UTC.
  assert.equal(vervalmoment({ soort: 'daghap', nu: Date.parse('2026-07-01T09:00:00.000Z') }).verlooptOp,
    '2026-07-01T21:59:00.000Z');
  // Vlak na middernacht plaatsen hoort bij de nieuwe dag, niet bij de oude.
  assert.equal(vervalmoment({ soort: 'daghap', nu: Date.parse('2026-10-30T23:30:00.000Z') }).verlooptOp,
    '2026-10-31T22:59:00.000Z');
});

test('BE-55: een seizoensgerecht verloopt na de einddatum, maximaal 90 dagen vooruit', () => {
  assert.deepEqual(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2026-11-15' }), {
    ok: true,
    verlooptOp: '2026-11-15T22:59:00.000Z',
  });
  // Vandaag zelf mag nog.
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2026-10-30' }).ok, true);
  // Precies 90 dagen vooruit mag; één dag meer niet.
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2027-01-28' }).ok, true);
  assert.deepEqual(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2027-01-29' }), {
    ok: false,
    fout: DAGHAP_FOUTEN.einddatum,
  });
  // Gisteren, een onmogelijke datum en onzin zijn alle drie geweigerd.
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2026-10-29' }).ok, false);
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: '2026-02-30' }).ok, false);
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU, einddatum: 'volgende maand' }).ok, false);
  assert.equal(vervalmoment({ soort: 'seizoensgerecht', nu: NU }).ok, false);
  // En de weigering komt door de gewone validatie heen als foutcode.
  const resultaat = normaliseerAanbod({ ...basis, soort: 'seizoensgerecht', einddatum: '2027-06-01' });
  assert.equal(resultaat.ok, false);
  assert.ok(resultaat.fouten.includes(DAGHAP_FOUTEN.einddatum));
});

test('BE-55: verlopen aanbod is verlopen, ook zonder geldig moment', () => {
  assert.equal(isVerlopen('2026-10-30T22:59:00.000Z', NU), false);
  assert.equal(isVerlopen('2026-10-30T11:00:00.000Z', NU), true);
  assert.equal(isVerlopen(null, NU), true);
  assert.equal(isVerlopen('geen datum', NU), true);
});

test('BE-55: het filter houdt reclametaal tegen', () => {
  for (const tekst of ['50% korting', 'Gratis broodje', 'Actie van de dag', 'Happy hour', '1+1 deal']) {
    const resultaat = beoordeelAanbod({ naam: tekst, prijsCent: 650 });
    assert.equal(resultaat.status, 'in_controle', `${tekst} hoort tegengehouden te worden`);
    assert.ok(resultaat.redenen.length > 0);
  }
  // "actief" is geen "actie": het filter kijkt naar losse woorden.
  assert.equal(beoordeelAanbod({ naam: 'Actief van de dag' }).status, 'online');
});

test('BE-55: het filter houdt scheldwoorden en discriminerende termen tegen', () => {
  const scheldwoord = beoordeelAanbod({ naam: 'Kut pizza' });
  assert.equal(scheldwoord.status, 'in_controle');
  assert.ok(scheldwoord.redenen.includes('scheldwoord:kut'));
  // Accenten en hoofdletters veranderen niets aan de treffer.
  assert.equal(beoordeelAanbod({ beschrijving: 'KÓRTING voor vaste gasten' }).status, 'in_controle');
  assert.ok(filterRedenen('discriminatie').includes('discriminatie:discriminatie'));
});

test('BE-55: het filter houdt een prijs boven 3× de duurste prijs op de kaart tegen', () => {
  const duurste = 2000; // € 20,00 op de kaart
  assert.equal(beoordeelAanbod({ naam: 'Soep', prijsCent: 6000, duursteKaartPrijsCent: duurste }).status, 'online');
  const teDuur = beoordeelAanbod({ naam: 'Soep', prijsCent: 6001, duursteKaartPrijsCent: duurste });
  assert.equal(teDuur.status, 'in_controle');
  assert.deepEqual(teDuur.redenen, ['prijs:boven_kaart']);
  // Zonder kaartprijs vervalt alleen de prijsgrens.
  assert.equal(beoordeelAanbod({ naam: 'Soep', prijsCent: 15000, duursteKaartPrijsCent: 0 }).status, 'online');
});

test('BE-55: een schoon aanbod staat online en de melding voor de houder klopt', () => {
  const schoon = beoordeelAanbod({ naam: 'Pompoensoep met brood', beschrijving: 'Van de dag', prijsCent: 650 });
  assert.deepEqual(schoon, { status: 'online', redenen: [] });
  const scherm = aanbodVoorScherm({
    id: 7,
    restaurant_id: '1',
    soort: 'daghap',
    naam: 'Soep',
    prijs_cent: 650,
    status: 'in_controle',
    verloopt_op: '2026-10-30T22:59:00.000Z',
  });
  assert.equal(scherm.inControle, true);
  assert.equal(scherm.melding, DAGHAP_IN_CONTROLE_MESSAGE);
  assert.equal(DAGHAP_IN_CONTROLE_MESSAGE, 'Wordt kort gecontroleerd.');
});

test('BE-55: maximaal 1 actieve daghap en 3 seizoensgerechten per restaurant', () => {
  const nu = NU;
  const daghap = { id: 1, soort: 'daghap', status: 'online', verloopt_op: '2026-10-30T22:59:00.000Z' };
  const vol = magSoortToevoegen({ bestaand: [daghap], soort: 'daghap', nu });
  assert.equal(vol.ok, false);
  assert.equal(vol.fout, DAGHAP_FOUTEN.daghapVol);

  // Een tweede daghap mag weer als de eerste offline is of verlopen.
  assert.equal(magSoortToevoegen({ bestaand: [{ ...daghap, status: 'offline' }], soort: 'daghap', nu }).ok, true);
  assert.equal(magSoortToevoegen({
    bestaand: [{ ...daghap, verloopt_op: '2026-10-30T08:00:00.000Z' }],
    soort: 'daghap',
    nu,
  }).ok, true);

  const seizoen = (id) => ({
    id,
    soort: 'seizoensgerecht',
    status: 'online',
    verloopt_op: '2026-11-20T22:59:00.000Z',
  });
  assert.equal(magSoortToevoegen({ bestaand: [seizoen(2), seizoen(3)], soort: 'seizoensgerecht', nu }).ok, true);
  const derde = magSoortToevoegen({ bestaand: [seizoen(2), seizoen(3), seizoen(4)], soort: 'seizoensgerecht', nu });
  assert.equal(derde.ok, false);
  assert.equal(derde.fout, DAGHAP_FOUTEN.seizoenVol);
  assert.equal(derde.telling.seizoensgerecht, 3);

  // Een wijziging telt niet tegen zijn eigen plaats.
  assert.equal(magSoortToevoegen({
    bestaand: [seizoen(2), seizoen(3), seizoen(4)],
    soort: 'seizoensgerecht',
    behalveId: 4,
    nu,
  }).ok, true);

  // Een tegengehouden aanbod telt mee: het staat tenslotte in de wachtrij.
  assert.equal(telActief([{ ...daghap, status: 'in_controle' }], nu).daghap, 1);
  assert.equal(isActiefAanbod({ ...daghap, status: 'verlopen' }, nu), false);
});

test('BE-55: maximaal 10 plaatsingen of wijzigingen per account per dag', () => {
  assert.equal(DAGHAP_MAX_WIJZIGINGEN_PER_DAG, 10);
  assert.equal(magVandaagWijzigen({ aantalVandaag: 9 }).ok, true);
  const tiende = magVandaagWijzigen({ aantalVandaag: 10 });
  assert.equal(tiende.ok, false);
  assert.equal(tiende.fout, DAGHAP_FOUTEN.daglimiet);
  assert.equal(magVandaagWijzigen({}).ok, true);
  assert.equal(magVandaagWijzigen({ aantalVandaag: 'geen getal' }).ok, true);
});

test('BE-55: de daglimiet telt vanaf middernacht in Europe/Amsterdam', () => {
  // Middernacht lokaal op 30 oktober (CET, +1) is 23:00 UTC de dag ervoor.
  assert.equal(begindagVan(NU), '2026-10-29T23:00:00.000Z');
  // In de zomer (CEST, +2) is middernacht lokaal 22:00 UTC de dag ervoor.
  assert.equal(begindagVan(Date.parse('2026-07-01T09:00:00.000Z')), '2026-06-30T22:00:00.000Z');
});

test('BE-55: de duurste kaartprijs komt uit de echte menukaarten', () => {
  // Restaurant 6 heeft vier kaarten; de duurste prijs komt uit de echte data.
  const duurste6 = duursteKaartPrijsCent({
    restaurantId: '6',
    restaurant: restaurantsData['6'],
    menus: menusData,
  });
  assert.ok(duurste6 > 0, 'de echte data levert een prijs op');
  const hoogstePrijs = Object.keys(menusData)
    .filter((id) => id.startsWith('6-'))
    .flatMap((id) => menusData[id].categories.flatMap((categorie) => categorie.items))
    .reduce((hoogste, item) => Math.max(hoogste, Number(item.priceValue) || 0), 0);
  assert.equal(duurste6, Math.round(hoogstePrijs * 100));

  // Restaurant 7 heeft geen kaart: de grens vervalt, er wordt niets verzonnen.
  assert.equal(duursteKaartPrijsCent({
    restaurantId: '7',
    restaurant: restaurantsData['7'],
    menus: menusData,
  }), 0);
  assert.equal(duursteKaartPrijsCent(), 0);
});
// BE-67 (ronde 3): de aanbodsleutel waarmee de bestaande bewaar- en deelknop
// via /api/v1/tellers in daghap_gebeurtenissen telt.
const { aanbodSleutel, parseAanbodSleutel } = require('./daghapAanbod');

test('BE-67: de aanbodsleutel is eenduidig en leest terug als restaurant en aanbod', () => {
  assert.equal(aanbodSleutel({ restaurantId: '6', aanbodId: 42 }), 'daghap-6-42');
  assert.deepEqual(parseAanbodSleutel('daghap-6-42'), {
    sleutel: 'daghap-6-42',
    restaurantId: '6',
    aanbodId: 42,
  });
  // Een restaurant-id met een streepje erin blijft heel.
  const metStreepje = aanbodSleutel({ restaurantId: 'de-baron', aanbodId: '7' });
  assert.equal(metStreepje, 'daghap-de-baron-7');
  assert.deepEqual(parseAanbodSleutel(metStreepje), {
    sleutel: 'daghap-de-baron-7',
    restaurantId: 'de-baron',
    aanbodId: 7,
  });
});

test('BE-67: een gerecht-id en een kapotte sleutel zijn geen aanbod', () => {
  for (const value of [
    undefined,
    null,
    '',
    '6-diner-0-0',
    'daghap-6',
    'daghap-6-',
    'daghap-6-abc',
    'daghap--12',
    'daghap-6-42-',
    'x'.repeat(120),
  ]) {
    assert.equal(parseAanbodSleutel(value), null, `${String(value)} is geen aanbodsleutel`);
  }
  assert.equal(aanbodSleutel({ restaurantId: '', aanbodId: 1 }), null);
  assert.equal(aanbodSleutel({ restaurantId: '6', aanbodId: 'abc' }), null);
  assert.equal(aanbodSleutel(), null);
});





