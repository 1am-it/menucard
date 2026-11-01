'use strict';

// BE-78 (#193), ronde 2 — de oorzaken uit Lead-review #6560710718, elk met een
// fixture van een ECHTE kaart uit de cache (.local/menu-bootstrap-cache):
//   1. een naam in een andere schrijfwijze dan de bron;
//   2. dezelfde naam meer keren in de bron (lunch/diner, pizza/pasta);
//   3. het venster: het bedrag staat een paar regels verder, in de tweede kolom
//      of midden op een regel van een pdf met twee kolommen;
//   4. meerdere prijzen en toeslagen in de omschrijving;
//   5. een groepsprijs die als los bedrag onder de naam staat.
// Daarnaast: drie gevallen met een ECHTE fout, die de controle moet blijven
// vangen, en een bron zonder leesbare prijzen (een kaart die een afbeelding is).
// Geen netwerk, geen data/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { matchItem, findPrices, buildSourceIndex, findNameOccurrences, sourceCarriesPriceList } = require('./sourceText');

const FIXTURES = path.join(__dirname, '__fixtures__');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const ZUYD = read('bron-19-lunch.txt');
const PERRON = read('bron-24-menukaart.txt');
const DOLCE = read('bron-25-menukaart.txt');
const SMELT = read('bron-16-menukaart.txt');
const ALDENTE = read('bron-8-menukaart.txt');

const CARDS = {
  zuyd: buildSourceIndex(ZUYD),
  perron: buildSourceIndex(PERRON),
  dolce: buildSourceIndex(DOLCE),
  smelt: buildSourceIndex(SMELT),
};

function check(card, item) {
  return matchItem('', item, { index: CARDS[card] });
}

test('oorzaak 1: een naam in een andere schrijfwijze dan de bron is dezelfde naam', () => {
  // De bron print "Steak tartaar", de kaart schrijft het met hoofdletters.
  assert.equal(check('zuyd', { name: 'STEAK TARTAAR', priceValue: 27.5 }).status, 'ok');
  // "Kaasfondue Hollands" tegenover alleen "Hollands" in de bron.
  assert.equal(check('smelt', { name: 'Kaasfondue Hollands', priceValue: 27 }).status, 'ok');
  assert.equal(check('smelt', { name: 'Kaasfondue Zwitsers', priceValue: 29.5 }).status, 'ok');
  // Leestekens en apostrofs: "Kaasgerecht ‘3 x Epoisses’" tegenover '3 x Epoisses'.
  const kaasgerecht = check('zuyd', { name: "Kaasgerecht '3 x Epoisses'", price: '€17', desc: 'supplement €8,50' });
  assert.equal(kaasgerecht.status, 'ok');
});

test('oorzaak 2: een kaart die dezelfde naam twee keer print is ok bij een van de voorkomens', () => {
  // Pizza "Mista" €13 staat na "Frittura Mista" €15; pasta "Napolitana" €11 na pizza €12.
  assert.equal(check('dolce', { name: 'Mista', priceValue: 13 }).status, 'ok');
  assert.equal(check('dolce', { name: 'Napolitana', priceValue: 12 }).status, 'ok');
  const occurrences = findNameOccurrences(CARDS.dolce, 'Tonno');
  assert.ok(occurrences.length >= 2, 'de bron print "Tonno" bij de pizza en bij de pasta');
  assert.equal(check('dolce', { name: 'Tonno', priceValue: 14 }).status, 'ok');
  assert.equal(check('dolce', { name: 'Tonno', priceValue: 13 }).status, 'ok');
});

test('oorzaak 3: het bedrag staat een paar regels verder of midden op de regel', () => {
  // Naam, omschrijving, "Prijs", dan pas het bedrag.
  assert.equal(check('perron', { name: 'Appeltaart', priceValue: 5.9 }).status, 'ok');
  // Naam, omschrijving, "per stuk", dan het bedrag: niet het bedrag van de buur.
  const cannoli = check('perron', { name: 'Cannoli', priceValue: 3.2 });
  assert.equal(cannoli.status, 'ok');
  assert.equal(cannoli.found, 3.2);
  // Een pdf met twee kolommen op een gedrukte regel: het bedrag staat na de naam.
  assert.equal(check('smelt', { name: 'Gebakken krieltjes', priceValue: 5 }).status, 'ok');
  assert.equal(check('smelt', { name: 'Omelette du fromage', priceValue: 11 }).status, 'ok');
});

test('oorzaak 4: meerdere prijzen en toeslagen in de omschrijving worden apart gecontroleerd', () => {
  const ossenhaas = check('zuyd', { name: 'Ossenhaas', priceValue: 35, desc: 'supplement eendenlever €9' });
  assert.equal(ossenhaas.status, 'ok');
  assert.equal(ossenhaas.found, 35);
  const kaas = check('zuyd', { name: 'Kaasassortiment', priceValue: 13, desc: 'zes stuks €19,50 · supplement €8,50' });
  assert.equal(kaas.status, 'ok');
  // Een toeslag die niet meer op de kaart staat, is wel een afwijking.
  const toeslagWeg = check('zuyd', { name: 'Ossenhaas', priceValue: 35, desc: 'supplement eendenlever €12,50' });
  assert.equal(toeslagWeg.status, 'price-deviates');
  assert.deepEqual(toeslagWeg.missing, [12.5]);
});

test('oorzaak 5: een groepsprijs als los bedrag onder de naam', () => {
  // "3-gangen menu" met het bedrag "60" op een eigen regel, zonder euroteken.
  assert.equal(check('zuyd', { name: '3-gangen lunchmenu', priceValue: 60 }).status, 'ok');
  assert.equal(check('zuyd', { name: '2-gangen lunchmenu', priceValue: 50 }).status, 'ok');
  const deviates = check('zuyd', { name: '4-gangen lunchmenu', priceValue: 75 });
  assert.equal(deviates.status, 'price-deviates', 'een gewijzigde groepsprijs moet opvallen');
  assert.equal(deviates.found, 70);
  // Dolce e Salato print de groepsprijs één keer boven een lijst gerechten.
  assert.equal(check('dolce', { name: "Scampi all'aglio", priceValue: 22 }).status, 'ok');
  assert.equal(check('dolce', { name: 'Sambuca', priceValue: 5.5 }).status, 'ok');
  const groupChanged = check('dolce', { name: 'Amaretto', priceValue: 6 });
  assert.equal(groupChanged.status, 'price-deviates');
  assert.equal(groupChanged.found, 5.5);
});

test('een echte fout blijft gevangen: een gewijzigde prijs', () => {
  const changed = check('zuyd', { name: 'Steak tartaar', priceValue: 29.5 });
  assert.equal(changed.status, 'price-deviates');
  assert.equal(changed.found, 27.5);
  assert.deepEqual(changed.missing, [29.5]);
});

test('een echte fout blijft gevangen: een verdwenen gerecht', () => {
  const gone = check('perron', { name: 'Pizza quattro stagioni', priceValue: 12.5 });
  assert.equal(gone.status, 'name-not-found');
  assert.equal(gone.nameFound, false);
  assert.equal(gone.reason, 'naam-niet-gevonden');
});

test('een echte fout blijft gevangen: het bedrag van de buur wordt niet geleend', () => {
  // Cannoli staat in de bron op € 3,20; de regel erboven print € 5,90.
  const wrong = check('perron', { name: 'Cannoli', priceValue: 5.9 });
  assert.equal(wrong.status, 'price-deviates', 'het bedrag van de vorige regel telt niet mee');
  assert.equal(wrong.found, 3.2);
});

test('een percentage, een inhoud en een aantal zijn geen bedrag', () => {
  assert.deepEqual(findPrices('Westmalle Tripel 9,5%'), [], 'een alcoholpercentage is geen prijs');
  assert.equal(check('perron', { name: 'Westmalle Tripel 9,5%', priceValue: 6.8 }).status, 'ok');
  assert.equal(check('perron', { name: 'Appelsap', priceValue: 3.7 }).status, 'ok', '20 cl is geen prijs');
  assert.equal(check('perron', { name: 'Royal Bliss Ginger Beer', priceValue: 4 }).status, 'ok');
  assert.deepEqual(findPrices('12,5% korting'), []);
});

test('een bron zonder leesbare prijzen levert geen valse afwijkingen op', () => {
  // De kaart van de Aldente is een afbeelding: de html draagt geen prijslijst,
  // alleen een paar bedragen uit de tekst eromheen.
  const index = buildSourceIndex(ALDENTE);
  assert.equal(sourceCarriesPriceList(index), false);
  assert.ok(index.prices.length < 3, 'geen prijslijst in deze bron');
  const item = { name: 'Vitello tonnato', priceValue: 12.5 };
  assert.equal(matchItem(ALDENTE, item).status, 'name-not-found');
  // Een kaart met een echte prijslijst is wel controleerbaar.
  assert.equal(sourceCarriesPriceList(CARDS.zuyd), true);
});
