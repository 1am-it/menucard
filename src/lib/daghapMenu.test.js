'use strict';

// BE-67 (#164, criterium 1) — het dagmenu, de herhaling, Op = op en de cijfers
// als pure regels. Zonder database, zonder Supabase en zonder systeemklok: elk
// moment komt uit de test, zodat de grens rond middernacht in Europe/Amsterdam
// echt te controleren is.
//
// Dezelfde opzet als daghapAanbod.test.js (BE-55): één regel per test, met de
// weigeringen erbij.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  DAGHAP_FOUTEN,
  DAGHAP_MESSAGES,
  aanbodFilterTekst,
  aanbodVoorScherm,
  beoordeelAanbod,
  berichtBij,
  cijferTekst,
  isUitverkochtVandaag,
  magSoortToevoegen,
  normaliseerAanbod,
  normaliseerGangen,
  normaliseerHerhaling,
  normaliseerWeekdagen,
  staatOnlineVandaag,
  vandaagInAmsterdam,
  weekdagInAmsterdam,
} = require('./daghapAanbod');

// Vrijdag 30 oktober 2026, 12:00 in Amsterdam (CET, +1) is 11:00 UTC.
const VRIJDAG = Date.parse('2026-10-30T11:00:00.000Z');

const dagmenuBasis = {
  soort: 'dagmenu',
  naam: 'Herfstmenu',
  prijs: '22,50',
  prijs3: '27,50',
  beschrijving: 'Met pompoen en wild',
  labels: [],
  gangen: [
    { gang: 'voor', naam: 'Pompoensoep' },
    { gang: 'hoofd', naam: 'Hertenstoof' },
    { gang: 'na', naam: 'Kastanjetaart' },
  ],
  nu: VRIJDAG,
};

test('BE-67: een dagmenu met drie gangen en twee prijzen komt erdoor', () => {
  const resultaat = normaliseerAanbod(dagmenuBasis);
  assert.equal(resultaat.ok, true, JSON.stringify(resultaat.fouten));
  assert.deepEqual(resultaat.aanbod.gangen, [
    { gang: 'voor', naam: 'Pompoensoep' },
    { gang: 'hoofd', naam: 'Hertenstoof' },
    { gang: 'na', naam: 'Kastanjetaart' },
  ]);
  assert.equal(resultaat.aanbod.prijsCent, 2250, 'de eerste prijs is die voor twee gangen');
  assert.equal(resultaat.aanbod.prijs3Cent, 2750);
  // Alleen vandaag: het verloopmoment is het einde van vandaag.
  assert.equal(resultaat.aanbod.verlooptOp, '2026-10-30T22:59:00.000Z');
  assert.equal(resultaat.aanbod.herhaling, undefined, 'geen herhaling zonder weekdagen');
});

test('BE-67: twee gangen mogen, als het hoofdgerecht er maar is', () => {
  const twee = normaliseerAanbod({
    ...dagmenuBasis,
    prijs3: '',
    gangen: [
      { gang: 'hoofd', naam: 'Hertenstoof' },
      { gang: 'na', naam: 'Kastanjetaart' },
    ],
  });
  assert.equal(twee.ok, true, JSON.stringify(twee.fouten));
  assert.deepEqual(twee.aanbod.gangen.map((gang) => gang.gang), ['hoofd', 'na']);
  assert.equal(twee.aanbod.prijs3Cent, null);

  // Zonder hoofdgerecht is het geen dagmenu.
  const zonderHoofd = normaliseerAanbod({
    ...dagmenuBasis,
    prijs3: '',
    gangen: [
      { gang: 'voor', naam: 'Pompoensoep' },
      { gang: 'na', naam: 'Kastanjetaart' },
    ],
  });
  assert.equal(zonderHoofd.ok, false);
  assert.ok(zonderHoofd.fouten.includes(DAGHAP_FOUTEN.gangen));
  assert.equal(berichtBij(DAGHAP_FOUTEN.gangen), DAGHAP_MESSAGES.gangen);

  // Eén gang is te weinig.
  const een = normaliseerAanbod({ ...dagmenuBasis, gangen: [{ gang: 'hoofd', naam: 'Stoof' }] });
  assert.ok(een.fouten.includes(DAGHAP_FOUTEN.gangen));
});

test('BE-67: een derde prijs hoort bij drie gangen en niet bij een andere soort', () => {
  const tweeMetDerdePrijs = normaliseerAanbod({
    ...dagmenuBasis,
    gangen: [
      { gang: 'voor', naam: 'Pompoensoep' },
      { gang: 'hoofd', naam: 'Hertenstoof' },
    ],
  });
  assert.equal(tweeMetDerdePrijs.ok, false);
  assert.ok(tweeMetDerdePrijs.fouten.includes(DAGHAP_FOUTEN.geenDerdePrijs));

  const drieZonderDerdePrijs = normaliseerAanbod({ ...dagmenuBasis, prijs3: '' });
  assert.equal(drieZonderDerdePrijs.ok, false);
  assert.ok(drieZonderDerdePrijs.fouten.includes(DAGHAP_FOUTEN.prijs3));

  const teDuur = normaliseerAanbod({ ...dagmenuBasis, prijs3: '300,00' });
  assert.ok(teDuur.fouten.includes(DAGHAP_FOUTEN.prijs3));

  // Een daghap heeft geen gangen en geen derde prijs.
  const daghapMetGangen = normaliseerAanbod({
    soort: 'daghap',
    naam: 'Pompoensoep met brood',
    prijs: '6,50',
    nu: VRIJDAG,
    gangen: [{ gang: 'hoofd', naam: 'Soep' }],
  });
  assert.equal(daghapMetGangen.ok, false);
  assert.ok(daghapMetGangen.fouten.includes(DAGHAP_FOUTEN.gangen));
});

test('BE-67: de gangen worden schoongemaakt en ontdubbeld', () => {
  const schoon = normaliseerGangen([
    { gang: 'na', naam: '  Kastanjetaart  ' },
    { gang: 'hoofd', naam: 'Hertenstoof' },
    { gang: 'hoofd', naam: 'Hertenstoof met jus' },
    { gang: 'onbekend', naam: 'Iets' },
    { gang: 'voor', naam: '   ' },
    null,
  ]);
  assert.deepEqual(schoon, [
    { gang: 'hoofd', naam: 'Hertenstoof met jus' },
    { gang: 'na', naam: 'Kastanjetaart' },
  ], 'één per gang, in de vaste volgorde, zonder lege namen');

  const teLang = normaliseerAanbod({
    ...dagmenuBasis,
    gangen: [
      { gang: 'voor', naam: 'a'.repeat(81) },
      { gang: 'hoofd', naam: 'Hertenstoof' },
    ],
    prijs3: '',
  });
  assert.ok(teLang.fouten.includes(DAGHAP_FOUTEN.gangNaam));
});

test('BE-67: de herhaling bestaat uit weekdagen en een einddatum binnen 90 dagen', () => {
  const eenvoudig = normaliseerHerhaling({ weekdagen: [5, 1, 5], tot: '2026-12-31', nu: VRIJDAG });
  assert.equal(eenvoudig.ok, true, JSON.stringify(eenvoudig.fouten));
  assert.deepEqual(eenvoudig.herhaling, { weekdagen: [1, 5], tot: '2026-12-31' }, 'ontdubbeld en gesorteerd');

  // Alleen vandaag is de standaard: geen weekdagen en geen einddatum.
  assert.equal(normaliseerHerhaling({ weekdagen: [], tot: '', nu: VRIJDAG }).herhaling, null);

  // Weekdagen zonder einddatum en een einddatum zonder weekdagen zijn beide fout.
  const zonderTot = normaliseerHerhaling({ weekdagen: [1], nu: VRIJDAG });
  assert.equal(zonderTot.ok, false);
  assert.ok(zonderTot.fouten.includes(DAGHAP_FOUTEN.herhaaltot));

  const zonderDag = normaliseerHerhaling({ weekdagen: [], tot: '2026-12-31', nu: VRIJDAG });
  assert.equal(zonderDag.ok, false);
  assert.ok(zonderDag.fouten.includes(DAGHAP_FOUTEN.herhaaldag));

  // Meer dan 90 dagen vooruit bestaat niet, en een datum in het verleden ook niet.
  const teVer = normaliseerHerhaling({ weekdagen: [1], tot: '2027-03-01', nu: VRIJDAG });
  assert.ok(teVer.fouten.includes(DAGHAP_FOUTEN.herhaaltot));
  const gisteren = normaliseerHerhaling({ weekdagen: [1], tot: '2026-10-29', nu: VRIJDAG });
  assert.ok(gisteren.fouten.includes(DAGHAP_FOUTEN.herhaaltot));

  // Precies 90 dagen vooruit mag.
  const grens = normaliseerHerhaling({ weekdagen: [1], tot: '2027-01-28', nu: VRIJDAG });
  assert.equal(grens.ok, true, JSON.stringify(grens.fouten));
});

test('BE-67: een herhaling geldt op de gekozen weekdag, tot en met de einddatum', () => {
  const aanbod = { herhaalWeekdagen: [5], herhaalTot: '2026-12-31' };
  assert.equal(weekdagInAmsterdam(VRIJDAG), 5, 'vrijdag 30 oktober 2026');
  const vrijdag = staatOnlineVandaag({ ...aanbod, nu: VRIJDAG, verlooptOp: '2026-12-31T22:59:00.000Z' });
  assert.equal(vrijdag.online, true);

  // Zaterdag 31 oktober: niet de gekozen dag.
  const zaterdag = staatOnlineVandaag({
    ...aanbod,
    nu: Date.parse('2026-10-31T11:00:00.000Z'),
    verlooptOp: '2026-12-31T22:59:00.000Z',
  });
  assert.equal(zaterdag.online, false);
  assert.equal(zaterdag.reden, 'andere_dag');

  // Na de einddatum is het aanbod voorbij, ook op een gekozen weekdag.
  const na = staatOnlineVandaag({
    ...aanbod,
    nu: Date.parse('2027-01-01T11:00:00.000Z'),
    verlooptOp: '2026-12-31T22:59:00.000Z',
  });
  assert.equal(na.online, false);
  assert.equal(na.reden, 'verlopen');
});

test('BE-67: de grens rond middernacht valt in Europe/Amsterdam', () => {
  const alleenVandaag = { verlooptOp: '2026-10-30T22:59:00.000Z' };
  // 23:30 Amsterdamse tijd op dezelfde dag: nog online.
  assert.equal(vandaagInAmsterdam(Date.parse('2026-10-30T22:30:00.000Z')), '2026-10-30');
  assert.equal(staatOnlineVandaag({ ...alleenVandaag, nu: Date.parse('2026-10-30T22:30:00.000Z') }).online, true);
  // 00:30 Amsterdamse tijd op de volgende dag: voorbij, ook al is het in UTC nog
  // dezelfde dag.
  assert.equal(vandaagInAmsterdam(Date.parse('2026-10-30T23:30:00.000Z')), '2026-10-31');
  assert.equal(staatOnlineVandaag({ ...alleenVandaag, nu: Date.parse('2026-10-30T23:30:00.000Z') }).online, false);

  // Dezelfde grens voor de weekdag van een herhaling: vrijdag 23:30 lokaal is
  // nog vrijdag, 00:30 lokaal is zaterdag.
  const herhaling = { verlooptOp: '2026-12-31T22:59:00.000Z', herhaalWeekdagen: [5], herhaalTot: '2026-12-31' };
  assert.equal(staatOnlineVandaag({ ...herhaling, nu: Date.parse('2026-10-30T22:30:00.000Z') }).online, true);
  assert.equal(staatOnlineVandaag({ ...herhaling, nu: Date.parse('2026-10-30T23:30:00.000Z') }).online, false);
});

test('BE-67: de tekstregels gelden ook voor een gangnaam', () => {
  const metLink = normaliseerAanbod({
    ...dagmenuBasis,
    gangen: [
      { gang: 'voor', naam: 'Soep zie www.example.nl' },
      { gang: 'hoofd', naam: 'Hertenstoof' },
    ],
    prijs3: '',
  });
  assert.ok(metLink.fouten.includes(DAGHAP_FOUTEN.url));
});


test('BE-67: Op = op geldt vandaag en vervalt de volgende dag', () => {
  const aanbod = { verlooptOp: '2026-12-31T22:59:00.000Z', herhaalWeekdagen: [5, 6], herhaalTot: '2026-12-31' };
  const vandaag = staatOnlineVandaag({
    ...aanbod,
    uitverkochtOp: '2026-10-30',
    nu: VRIJDAG,
  });
  assert.equal(vandaag.online, true);
  assert.equal(vandaag.uitverkocht, true);
  assert.equal(vandaag.reden, 'uitverkocht');

  // De volgende dag is het aanbod weer beschikbaar, zonder opruimactie: ook bij
  // een herhaling op zaterdag.
  const morgen = staatOnlineVandaag({
    ...aanbod,
    uitverkochtOp: '2026-10-30',
    nu: Date.parse('2026-10-31T11:00:00.000Z'),
  });
  assert.equal(morgen.online, true);
  assert.equal(morgen.uitverkocht, false);

  // Een datum in de toekomst is geen stand van vandaag.
  assert.equal(isUitverkochtVandaag('2026-10-31', VRIJDAG), false);
  assert.equal(isUitverkochtVandaag('', VRIJDAG), false);
  assert.equal(isUitverkochtVandaag(null, VRIJDAG), false);
});

test('BE-67: per restaurant maximaal één actief dagmenu, net als de daghap', () => {
  const bestaand = [{ id: 4, soort: 'dagmenu', status: 'online', verloopt_op: '2026-12-31T22:59:00.000Z' }];
  const vol = magSoortToevoegen({ bestaand, soort: 'dagmenu', nu: VRIJDAG });
  assert.equal(vol.ok, false);
  assert.equal(vol.fout, DAGHAP_FOUTEN.dagmenuVol);
  assert.equal(berichtBij(DAGHAP_FOUTEN.dagmenuVol), DAGHAP_MESSAGES.dagmenuVol);
  assert.equal(vol.telling.dagmenu, 1);

  // Een wijziging telt niet tegen zijn eigen plaats.
  const wijzigen = magSoortToevoegen({ bestaand, soort: 'dagmenu', behalveId: 4, nu: VRIJDAG });
  assert.equal(wijzigen.ok, true);

  // Een dagmenu naast een daghap en een seizoensgerecht mag wel.
  const naast = magSoortToevoegen({
    bestaand: [
      { id: 1, soort: 'daghap', status: 'online', verloopt_op: '2026-10-30T22:59:00.000Z' },
      { id: 2, soort: 'seizoensgerecht', status: 'online', verloopt_op: '2026-12-31T22:59:00.000Z' },
    ],
    soort: 'dagmenu',
    nu: VRIJDAG,
  });
  assert.equal(naast.ok, true);
});

test('BE-67: een gangnaam haalt hetzelfde filter als de naam van het aanbod', () => {
  const tekst = aanbodFilterTekst({
    naam: 'Herfstmenu',
    beschrijving: 'Met pompoen',
    gangen: [{ gang: 'hoofd', naam: 'Hertenstoof met korting' }],
  });
  assert.match(tekst, /Hertenstoof met korting/);
  const beoordeeld = beoordeelAanbod({ naam: tekst, prijsCent: 2250, duursteKaartPrijsCent: 4000 });
  assert.equal(beoordeeld.status, 'in_controle');
  assert.deepEqual(beoordeeld.redenen, ['reclame:korting']);
});

test('BE-67: een oude rij zonder de kolommen van 0026 geeft geen fout', () => {
  // Precies de kolommen van 0023: de migratie is nog niet toegepast.
  const oud = {
    id: 9,
    restaurant_id: '1',
    soort: 'daghap',
    naam: 'Pompoensoep',
    prijs_cent: 650,
    beschrijving: 'Van de dag',
    labels: ['veganistisch'],
    status: 'online',
    verloopt_op: '2026-10-30T22:59:00.000Z',
  };
  const scherm = aanbodVoorScherm(oud);
  assert.deepEqual(Object.keys(scherm).sort(), [
    'beschrijving', 'id', 'inControle', 'labels', 'melding', 'naam', 'prijs',
    'prijsCent', 'restaurantId', 'soort', 'status', 'verlooptOp',
  ], 'zonder 0026 blijft de vorm van BE-55 precies zoals hij was');

  // En de regels zelf werken ook zonder die kolommen: undefined is "alleen vandaag".
  assert.equal(staatOnlineVandaag({ verlooptOp: oud.verloopt_op, nu: VRIJDAG }).online, true);
  const morgen = staatOnlineVandaag({ verlooptOp: oud.verloopt_op, nu: Date.parse('2026-10-31T11:00:00.000Z') });
  assert.equal(morgen.online, false);
});

test('BE-67: een cijfer onder de vijf leest als "< 5", daarboven als getal', () => {
  // Uitkomst 4, dezelfde regel als BE-57.
  assert.equal(cijferTekst(0), '< 5');
  assert.equal(cijferTekst(4), '< 5');
  assert.equal(cijferTekst(5), '5');
  assert.equal(cijferTekst(41), '41');
  assert.equal(cijferTekst(undefined), '< 5');
  assert.equal(cijferTekst(-3), '< 5');
});
