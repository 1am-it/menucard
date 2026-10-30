'use strict';

// BE-55 stap B (#135) — het houderformulier en het blok "Vandaag".
//
// Wat hier bewezen wordt: een fout van de API landt bij het juiste veld (en een
// tekstregel bij naam én beschrijving), `in_controle` heet "Wordt kort
// gecontroleerd", de verloopzin klopt met het echte Amsterdamse moment, en het
// formulier stuurt precies de velden die de API verwacht.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  FORM_MESSAGES,
  aanbodVerzoek,
  beschrijvingTeller,
  foutmeldingen,
  formulierVanAanbod,
  leegFormulier,
  prijsInvoer,
  statusLabel,
  veldenVoorFout,
  verloopTekst,
} = require('./daghapFormulier');
const { DAGHAP_FOUTEN } = require('./daghapAanbod');

test('in_controle heet op het scherm "Wordt kort gecontroleerd"', () => {
  assert.equal(statusLabel('in_controle'), 'Wordt kort gecontroleerd');
  assert.equal(statusLabel('online'), 'Online');
  assert.equal(statusLabel('offline'), 'Offline');
  assert.equal(statusLabel('verlopen'), 'Verlopen');
  assert.equal(statusLabel('iets_nieuws'), 'Onbekende status');
  assert.equal(FORM_MESSAGES.wordtGecontroleerd, 'Wordt kort gecontroleerd.');
});

test('een validatiefout landt bij het juiste veld', () => {
  const uitkomst = foutmeldingen({
    error: 'invalid_aanbod',
    errors: [DAGHAP_FOUTEN.prijs, DAGHAP_FOUTEN.naamKort, DAGHAP_FOUTEN.einddatum],
  });
  assert.deepEqual(uitkomst.velden.prijs, ['Vul een prijs tussen € 0,50 en € 150 in.']);
  assert.deepEqual(uitkomst.velden.naam, ['Gebruik een naam van 3 tot 80 tekens.']);
  assert.deepEqual(uitkomst.velden.einddatum, ['Vul een einddatum binnen 90 dagen in.']);
  assert.deepEqual(uitkomst.velden.beschrijving, []);
  assert.equal(uitkomst.algemeen, '');
});

test('een tekstregel staat bij naam én beschrijving, zonder dubbeling', () => {
  assert.deepEqual(veldenVoorFout(DAGHAP_FOUTEN.url), ['naam', 'beschrijving']);
  assert.deepEqual(veldenVoorFout(DAGHAP_FOUTEN.emoji), ['naam', 'beschrijving']);
  const uitkomst = foutmeldingen({
    errors: [DAGHAP_FOUTEN.url, DAGHAP_FOUTEN.url, DAGHAP_FOUTEN.hoofdletters],
  });
  assert.deepEqual(uitkomst.velden.naam, [
    'Een link mag niet in de tekst staan.',
    'Schrijf de tekst niet helemaal in hoofdletters.',
  ]);
  assert.deepEqual(uitkomst.velden.beschrijving, uitkomst.velden.naam);
  assert.deepEqual(veldenVoorFout('iets_anders'), []);
});

test('een losse weigering (limiet, 403, 503) wordt één algemene melding', () => {
  const limiet = foutmeldingen({ error: 'daghap_vol', message: 'Er staat al een daghap online.' });
  assert.equal(limiet.algemeen, 'Er staat al een daghap online.');
  assert.deepEqual(limiet.velden.naam, []);
  assert.equal(foutmeldingen(null).algemeen, '');
  assert.deepEqual(foutmeldingen(undefined).velden, {
    soort: [], naam: [], prijs: [], beschrijving: [], labels: [], einddatum: [],
  });
});

test('de verloopzin gebruikt het echte Amsterdamse moment', () => {
  // 30 oktober 2026, 21:00 in Amsterdam (CET) is 20:00 UTC.
  assert.equal(
    verloopTekst({ soort: 'daghap', verlooptOp: '2026-10-30T20:00:00.000Z' }),
    'Online vandaag tot 21:00',
  );
  // Het einde van 31 december in Amsterdam valt al in het nieuwe UTC-jaar.
  assert.equal(
    verloopTekst({ soort: 'seizoensgerecht', verlooptOp: '2026-12-31T22:59:00.000Z' }),
    'Online tot en met 31 december',
  );
  assert.equal(verloopTekst({ soort: 'daghap', verlooptOp: 'geen datum' }), '');
});

test('het formulier vult zich uit een bestaand aanbod en stuurt dezelfde velden terug', () => {
  const aanbod = {
    soort: 'seizoensgerecht',
    naam: 'Pompoensoep met brood',
    prijsCent: 650,
    beschrijving: 'Met geroosterde pompoenpitten',
    labels: ['veganistisch', 'onbekend', 'glutenvrij'],
    verlooptOp: '2026-12-30T22:59:00.000Z',
  };
  const waarden = formulierVanAanbod(aanbod);
  assert.deepEqual(waarden, {
    soort: 'seizoensgerecht',
    naam: 'Pompoensoep met brood',
    prijs: '6,50',
    beschrijving: 'Met geroosterde pompoenpitten',
    labels: ['veganistisch', 'glutenvrij'],
    einddatum: '2026-12-30',
  });

  const verzoek = aanbodVerzoek(waarden);
  assert.deepEqual(verzoek, {
    soort: 'seizoensgerecht',
    naam: 'Pompoensoep met brood',
    prijs: '6,50',
    beschrijving: 'Met geroosterde pompoenpitten',
    labels: ['veganistisch', 'glutenvrij'],
    einddatum: '2026-12-30',
  });
});

test('een daghap stuurt geen einddatum mee', () => {
  const verzoek = aanbodVerzoek({ soort: 'daghap', naam: ' Soep ', prijs: ' 6,50 ', einddatum: '2026-12-30' });
  assert.equal(verzoek.einddatum, undefined);
  assert.equal(verzoek.naam, 'Soep');
  assert.equal(verzoek.prijs, '6,50');
  assert.deepEqual(verzoek.labels, []);
  assert.equal(prijsInvoer(50), '0,50');
  assert.equal(prijsInvoer(undefined), '');
  assert.deepEqual(leegFormulier(), {
    soort: 'daghap', naam: '', prijs: '', beschrijving: '', labels: [], einddatum: '',
  });
});

test('de tekenteller telt tekens, niet bytes', () => {
  assert.equal(beschrijvingTeller('Pompoen'), '7/140');
  assert.equal(beschrijvingTeller('🍕 soep'), '6/140');
  assert.equal(beschrijvingTeller(''), '0/140');
});
