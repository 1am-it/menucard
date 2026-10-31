'use strict';

// BE-68 (#168) — het QR-kaartje: URL, tekst, maten en toegang.
//
// Wat hier bewezen wordt: de QR-code codeert de absolute URL op basis van
// NEXT_PUBLIC_SITE_URL (met de huidige oorsprong als terugval) met `?bron=qr`;
// de tekst op het kaartje houdt de grens van 40 tekens én de daghap-filters;
// alleen een eigen houder komt aan een restaurant; de maten kloppen voor A6,
// 4×A6 op A4 en de PNG; en de QR-matrix van een bekende URL is een vaste
// testvector (foutcorrectie M, rustzone 4).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const {
  QR_BRON,
  QR_DOELEN,
  QR_FOUTCORRECTIE,
  QR_FOUTEN,
  QR_MATEN,
  QR_MESSAGES,
  QR_RUSTZONE,
  QR_STANDAARD_TEKST,
  QR_TEKST_MAX,
  controleerQrTekst,
  doelPad,
  formaatMaat,
  isQrFormaat,
  kiesRestaurant,
  meldingenBij,
  nietLiveMelding,
  qrUrl,
  tekstTeller,
  toonNietLive,
} = require('./qrKaartje');

test('BE-68: de QR-url is de menukaart met ?bron=qr', () => {
  assert.equal(
    qrUrl({ restaurantId: 'abc', siteUrl: 'https://onzemenukaarten.nl' }),
    'https://onzemenukaarten.nl/menu/abc?bron=qr',
  );
  // De standaard is de menukaart.
  assert.equal(QR_DOELEN[0].value, 'menu');
  assert.equal(QR_BRON, 'qr');
  assert.equal(doelPad({ doel: 'menu', restaurantId: 'abc' }), '/menu/abc');
});

test('BE-68: het doel restaurantpagina levert /restaurant/[id]', () => {
  assert.equal(
    qrUrl({ doel: 'restaurant', restaurantId: 'abc', siteUrl: 'https://onzemenukaarten.nl' }),
    'https://onzemenukaarten.nl/restaurant/abc?bron=qr',
  );
  assert.equal(doelPad({ doel: 'restaurant', restaurantId: 'abc' }), '/restaurant/abc');
  // Een onbekend doel valt terug op de menukaart, nooit op een half adres.
  assert.equal(doelPad({ doel: 'iets', restaurantId: 'abc' }), '/menu/abc');
});

test('BE-68: NEXT_PUBLIC_SITE_URL gaat voor de huidige oorsprong', () => {
  assert.equal(
    qrUrl({ restaurantId: 'abc', siteUrl: 'https://onzemenukaarten.nl/', origin: 'http://localhost:3180' }),
    'https://onzemenukaarten.nl/menu/abc?bron=qr',
    'slashes aan het eind tellen niet mee',
  );
  assert.equal(
    qrUrl({ restaurantId: 'abc', siteUrl: '', origin: 'http://localhost:3180' }),
    'http://localhost:3180/menu/abc?bron=qr',
    'zonder site-URL telt de oorsprong',
  );
  assert.equal(
    qrUrl({ restaurantId: 'abc', siteUrl: 'onzemenukaarten.nl' }),
    'https://onzemenukaarten.nl/menu/abc?bron=qr',
    'een basis zonder schema wordt https',
  );
  // Zonder restaurant of zonder basis is er geen kaartje.
  assert.equal(qrUrl({ restaurantId: '', siteUrl: 'https://onzemenukaarten.nl' }), '');
  assert.equal(qrUrl({ restaurantId: 'abc', siteUrl: '', origin: '' }), '');
  // Een id met rare tekens wordt gecodeerd, niet als pad geïnterpreteerd.
  assert.equal(
    qrUrl({ restaurantId: 'a/b', siteUrl: 'https://onzemenukaarten.nl' }),
    'https://onzemenukaarten.nl/menu/a%2Fb?bron=qr',
  );
});

test('BE-68: de tekst op het kaartje is maximaal 40 tekens', () => {
  assert.equal(QR_TEKST_MAX, 40);
  assert.equal(QR_STANDAARD_TEKST, 'Bekijk onze menukaart');
  assert.deepEqual(controleerQrTekst('Bekijk onze menukaart'), {
    ok: true,
    invoer: 'Bekijk onze menukaart',
    effectief: 'Bekijk onze menukaart',
    lengte: 21,
    codes: [],
  });
  // Precies 40 tekens mag, 41 niet.
  const veertig = 'a'.repeat(40);
  assert.equal(controleerQrTekst(veertig).ok, true);
  const eenenveertig = 'a'.repeat(41);
  const teLang = controleerQrTekst(eenenveertig);
  assert.equal(teLang.ok, false);
  assert.deepEqual(teLang.codes, [QR_FOUTEN.teLang]);
  assert.deepEqual(meldingenBij(teLang.codes), ['Gebruik maximaal 40 tekens op het kaartje.']);
  assert.equal(controleerQrTekst(veertig).lengte, 40);
  assert.equal(controleerQrTekst(eenenveertig).lengte, 41);
});

test('BE-68: witruimte wordt opgeschoond en een emoji telt als één teken', () => {
  assert.equal(controleerQrTekst('  Bekijk   onze  menukaart  ').invoer, 'Bekijk onze menukaart');
  assert.equal(controleerQrTekst('🍕'.repeat(3)).lengte, 3);
  assert.equal(tekstTeller('Bekijk onze menukaart'), '21/40');
});

test('BE-68: een leeg veld is een fout en het kaartje toont de standaardtekst', () => {
  const leeg = controleerQrTekst('   ');
  assert.equal(leeg.ok, false);
  assert.deepEqual(leeg.codes, [QR_FOUTEN.leeg]);
  assert.equal(leeg.effectief, QR_STANDAARD_TEKST);
  assert.deepEqual(meldingenBij(leeg.codes), ['Vul een tekst op het kaartje in.']);
});

test('BE-68: dezelfde tekstfilters als de daghap', () => {
  const gevallen = [
    ['Zie www.onzemenukaarten.nl', 'Een link mag niet in de tekst staan.'],
    ['Mail naar info@ons.nl', 'Een e-mailadres mag niet in de tekst staan.'],
    ['Bel 06 12345678', 'Een telefoonnummer mag niet in de tekst staan.'],
    ['BEKIJK ONZE MENUKAART', 'Schrijf de tekst niet helemaal in hoofdletters.'],
    ['Bekijk het!!!', 'Gebruik geen herhaalde leestekens zoals "!!!".'],
    ['🍕🍕🍕🍕', 'Gebruik maximaal 3 emoji.'],
  ];
  for (const [invoer, zin] of gevallen) {
    const uitkomst = controleerQrTekst(invoer);
    assert.equal(uitkomst.ok, false, invoer);
    assert.ok(meldingenBij(uitkomst.codes).includes(zin), `${invoer} → ${zin}`);
    // Nooit een dubbele zin bij meerdere codes.
    const zinnen = meldingenBij(uitkomst.codes);
    assert.equal(new Set(zinnen).size, zinnen.length);
  }
  // Gewone tekst met een prijs of een cijfer is geen telefoonnummer.
  assert.equal(controleerQrTekst('Menu en prijzen, 12,50').ok, true);
});

test('BE-68: alleen de eigen houder krijgt een restaurant', () => {
  const restaurantIndex = {
    eigen: { name: 'Eigen zaak' },
    ander: { name: 'Andere zaak' },
  };
  const roles = [{ role: 'owner', restaurant_id: 'eigen' }];

  assert.deepEqual(kiesRestaurant({ roles, restaurantIndex }), { id: 'eigen', name: 'Eigen zaak' });
  // Een restaurant van iemand anders valt terug op het eigen restaurant.
  assert.deepEqual(
    kiesRestaurant({ roles, restaurantIndex, gevraagdId: 'ander' }),
    { id: 'eigen', name: 'Eigen zaak' },
  );
  // Een 'internal'- of 'editor'-rol is geen houder.
  assert.equal(kiesRestaurant({ roles: [{ role: 'internal' }], restaurantIndex }), null);
  assert.equal(kiesRestaurant({ roles: [{ role: 'editor', restaurant_id: 'eigen' }], restaurantIndex }), null);
  assert.equal(kiesRestaurant({ roles: [], restaurantIndex }), null);
  assert.equal(kiesRestaurant({ roles: undefined, restaurantIndex: undefined }), null);
});

test('BE-68: de maten per formaat zijn die van het ontwerp', () => {
  const a6 = formaatMaat('a6');
  assert.equal(a6.pagina, 'A6');
  assert.equal(a6.kaartBreedteMm, 105);
  assert.equal(a6.kaartHoogteMm, 148);
  assert.equal(a6.perPagina, 1);

  // Vier A6-kaartjes passen precies op een A4: 2 × 105 = 210, 2 × 148 = 296 ≤ 297.
  const a4 = formaatMaat('a4');
  assert.equal(a4.pagina, 'A4');
  assert.equal(a4.perPagina, 4);
  assert.equal(a4.kaartBreedteMm * 2, 210);
  assert.ok(a4.kaartHoogteMm * 2 <= 297);

  assert.equal(formaatMaat('png').px, 1024);
  assert.equal(formaatMaat('png').pagina, null);

  // Een onbekend formaat valt terug op het A6-kaartje, niet op niets.
  assert.equal(formaatMaat('iets').pagina, 'A6');
  assert.equal(isQrFormaat('a6'), true);
  assert.equal(isQrFormaat('png'), true);
  assert.equal(isQrFormaat('brief'), false);
});

test('BE-68: zolang de site niet publiek is staat de melding er', () => {
  assert.equal(toonNietLive(undefined), true);
  assert.equal(toonNietLive(''), true);
  assert.equal(toonNietLive('false'), true);
  assert.equal(toonNietLive(' true '), false);
  assert.equal(toonNietLive('true'), false);
  assert.equal(
    nietLiveMelding(undefined),
    'Je kunt het kaartje al bekijken. Druk het af zodra Onze Menukaarten live is.',
  );
  assert.equal(nietLiveMelding('true'), '');
  assert.equal(QR_MESSAGES.notLive, nietLiveMelding(''));
});

test('BE-68: de QR-matrix van een bekende URL is een vaste testvector', () => {
  // Dezelfde bibliotheek en dezelfde instellingen als de pagina: foutcorrectie
  // M en een rustzone van 4 modules (de rustzone zit om de matrix heen, niet in
  // de matrix zelf). Een vaste vector, zodat een andere versie van de
  // bibliotheek of een andere foutcorrectie meteen opvalt.
  const qr = require('qrcode-generator');
  assert.equal(QR_FOUTCORRECTIE, 'M');
  assert.equal(QR_RUSTZONE, 4);
  const url = 'https://onzemenukaarten.nl/menu/abc?bron=qr';
  const code = qr(0, QR_FOUTCORRECTIE);
  code.addData(url);
  code.make();

  const aantal = code.getModuleCount();
  assert.equal(aantal, 33, 'versie 4 past bij deze URL en foutcorrectie M');
  const rijen = [];
  let donker = 0;
  for (let r = 0; r < aantal; r += 1) {
    let rij = '';
    for (let c = 0; c < aantal; c += 1) {
      const isDonker = code.isDark(r, c);
      rij += isDonker ? '1' : '0';
      if (isDonker) donker += 1;
    }
    rijen.push(rij);
  }
  assert.equal(donker, 577);
  assert.equal(
    crypto.createHash('sha256').update(rijen.join('|')).digest('hex'),
    '8c505c7ab30a2283f42cb0fc784d024ef877e0cc4904cba233a3a32429a75fda',
  );
  // De drie zoekvierkanten van 7 × 7 staan op hun plaats; zonder die markeringen
  // is het geen leesbare QR-code.
  for (const [rij, kolom] of [[0, 0], [0, aantal - 7], [aantal - 7, 0]]) {
    assert.equal(code.isDark(rij, kolom), true, `zoekvierkant op ${rij},${kolom}`);
    assert.equal(code.isDark(rij + 6, kolom + 6), true, `zoekvierkant op ${rij + 6},${kolom + 6}`);
  }
  // Dezelfde URL geeft altijd dezelfde matrix (geen randomness).
  const nogmaals = qr(0, QR_FOUTCORRECTIE);
  nogmaals.addData(url);
  nogmaals.make();
  assert.equal(nogmaals.getModuleCount(), aantal);
});
