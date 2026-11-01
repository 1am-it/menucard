'use strict';

// BE-78 (#193) — de gedeelde lezer van brontekst (./sourceText.js): alle
// prijsvormen, een naam met accenten en hoofdletters, een afwijkende prijs, een
// verdwenen en een nieuw gerecht, en een kaart met `priceOnRequest`.
// Alles met de fixtures in __fixtures__: geen netwerk, geen data/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { htmlToReadableText, findPrices, findName, matchItem, diffCard, fetchSourceText } = require('./sourceText');

const FIXTURES = path.join(__dirname, '__fixtures__');
const htmlFixture = fs.readFileSync(path.join(FIXTURES, 'prijscontrole-kaart.html'), 'utf8');
const pdfTextFixture = fs.readFileSync(path.join(FIXTURES, 'prijscontrole-kaart.pdftekst.txt'), 'utf8');
const refreshFixture = fs.readFileSync(path.join(FIXTURES, 'ververs-bron.txt'), 'utf8');

const HTML_TEXT = htmlToReadableText(htmlFixture);

function values(text) {
  return findPrices(text).map((price) => price.value);
}

test('html: scripts en stijlen verdwijnen, entities worden tekst en elk blok is een regel', () => {
  assert.equal(/dataLayer|Scriptgerecht|99,00/.test(HTML_TEXT), false, 'scriptinhoud hoort er niet in');
  assert.equal(/color: #111|\.prijs/.test(HTML_TEXT), false, 'stijlregels horen er niet in');
  assert.match(HTML_TEXT, /Lunch & diner/);
  assert.match(HTML_TEXT, /Crème brûlée/);
  const lines = HTML_TEXT.split('\n');
  assert.ok(lines.includes('Carpaccio van rode biet € 12,50'), 'naam en prijs staan op één regel');
  assert.ok(lines.includes('Zeetong à la meunière 24.50'));
});

test('alle prijsvormen worden herkend', () => {
  assert.deepEqual(values('€ 12,50'), [12.5]);
  assert.deepEqual(values('12.50'), [12.5]);
  assert.deepEqual(values('12,-'), [12]);
  assert.deepEqual(values('€12'), [12]);
  assert.deepEqual(values('12,5'), [12.5]);
  assert.deepEqual(values('vanaf 9'), [9]);
  assert.deepEqual(values('1.85st'), [1.85]);
  assert.deepEqual(values('2 stuks 13.95'), [13.95]);
  assert.deepEqual(values('€ 12,-'), [12]);
  assert.deepEqual(values('vanaf 9,50'), [9.5]);
});

test('een prijs wordt nooit twee keer geteld', () => {
  assert.deepEqual(values('Kaasplankje 2 stuks 13.95'), [13.95]);
  assert.deepEqual(values('€ 12,50'), [12.5]);
  assert.deepEqual(values('Oesters 1.85st'), [1.85]);
  assert.deepEqual(values('Kreeft 500/600 gram'), [], 'een gewicht is geen prijs');
  assert.deepEqual(values('nr. 53'), [], 'een menunummer is geen prijs');
});

test('een naam met accenten en hoofdletters wordt gevonden', () => {
  assert.notEqual(findName(HTML_TEXT, 'CRÈME BRÛLÉE'), null);
  assert.notEqual(findName(HTML_TEXT, 'creme brulee'), null);
  assert.notEqual(findName(pdfTextFixture, 'Zeetong à la meunière'), null);
  assert.notEqual(findName('Zeetong - à la meunière 24.50', 'Zeetong à la meunière'), null);
  assert.equal(findName(HTML_TEXT, 'Huiswijn van de tap'), null);
});

test('de prijs van een gerecht wordt naast de naam gevonden', () => {
  const result = matchItem(HTML_TEXT, { name: 'Carpaccio van rode biet', price: '€12,50', priceValue: 12.5 });
  assert.equal(result.status, 'ok');
  assert.equal(result.found, 12.5);
  assert.equal(result.nameFound, true);
});

test('een afwijkende prijs wordt met de gevonden prijs gemeld', () => {
  const result = matchItem(HTML_TEXT, { name: 'Carpaccio van rode biet', price: '€13,50', priceValue: 13.5 });
  assert.equal(result.status, 'price-deviates');
  assert.deepEqual(result.expected, [13.5]);
  assert.deepEqual(result.missing, [13.5]);
  assert.equal(result.found, 12.5);
  assert.deepEqual(result.foundPrices.map((price) => price.value), [12.5]);
});

test('meerdere prijzen in de omschrijving (glas/fles) worden allebei gecontroleerd', () => {
  const good = matchItem(HTML_TEXT, {
    name: 'Huiswijn',
    desc: 'per glas · fles €28,50',
    price: '€9',
    priceValue: 9,
  });
  assert.equal(good.status, 'ok');
  assert.deepEqual(good.expected, [9, 28.5]);

  const bad = matchItem(HTML_TEXT, {
    name: 'Huiswijn',
    desc: 'per glas · fles €27,50',
    price: '€9',
    priceValue: 9,
  });
  assert.equal(bad.status, 'price-deviates');
  assert.deepEqual(bad.missing, [27.5]);
});

test('een kaart met priceOnRequest wordt overgeslagen', () => {
  const result = matchItem(HTML_TEXT, { name: 'Kreeft', priceOnRequest: true, price: null, priceValue: null });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'price-on-request');
});

test('een gerecht dat niet meer in de bron staat heet niet gevonden', () => {
  const result = matchItem(HTML_TEXT, { name: 'Stoofpot van hert', price: '€18', priceValue: 18 });
  assert.equal(result.status, 'name-not-found');
  assert.equal(result.nameFound, false);
});

test('de tekstlaag van een pdf werkt net als html', () => {
  const ok = matchItem(pdfTextFixture, { name: 'Carpaccio van rode biet', price: '€12,50', priceValue: 12.5 });
  assert.equal(ok.status, 'ok');

  const deviates = matchItem(pdfTextFixture, { name: 'Stoofpot van rundvlees', price: '€18', priceValue: 18 });
  assert.equal(deviates.status, 'ok', '18,- is dezelfde prijs als 18');

  const wrong = matchItem(pdfTextFixture, { name: 'Oesters', price: '€1,95', priceValue: 1.95 });
  assert.equal(wrong.status, 'price-deviates');
  assert.equal(wrong.found, 1.85);
});

test('verversen meldt een gewijzigde prijs, een verdwenen en een nieuw gerecht', () => {
  const card = {
    categories: [
      {
        name: 'Voorgerechten',
        items: [
          { name: 'Carpaccio van rode biet', desc: 'dun gesneden rode biet', price: '€12,50', priceValue: 12.5 },
          { name: 'Crème brûlée', desc: 'klassiek bereid', price: '€8,50', priceValue: 8.5 },
        ],
      },
      {
        name: 'Hoofdgerechten',
        items: [
          { name: 'Zeetong à la meunière', price: '€24,50', priceValue: 24.5 },
          { name: 'Stoofpot van rundvlees', price: '€18,-', priceValue: 18 },
        ],
      },
    ],
  };
  const diff = diffCard(refreshFixture, card);
  assert.equal(diff.checked, 3, 'drie gerechten hadden een prijs om te vergelijken');
  assert.deepEqual(diff.changed.map((row) => row.name), ['Carpaccio van rode biet']);
  assert.equal(diff.changed[0].found, 14.5);
  assert.deepEqual(diff.gone.map((row) => row.name), ['Stoofpot van rundvlees']);
  assert.deepEqual(diff.possibleNew.map((row) => row.value), [17.5]);
  assert.match(diff.possibleNew[0].label, /Risotto van paddenstoelen/);
});

test('verversen schrijft niets in de kaart zelf', () => {
  const card = {
    categories: [{ name: 'Voorgerechten', items: [{ name: 'Carpaccio van rode biet', price: '€12,50', priceValue: 12.5 }] }],
  };
  const before = JSON.stringify(card);
  diffCard(refreshFixture, card);
  assert.equal(JSON.stringify(card), before);
});

test('fetchSourceText gebruikt de bestaande fetcher en raakt geen netwerk aan', async () => {
  const calls = [];
  const fetcher = {
    async getPage(url) {
      calls.push(url);
      return { ok: true, url, finalUrl: url, kind: 'html', text: '<html><body><p>Huiswijn €9</p></body></html>', fromCache: true };
    },
  };
  const read = await fetchSourceText('https://voorbeeld.nl/menu', { fetcher });
  assert.equal(read.ok, true);
  assert.equal(read.kind, 'html');
  assert.equal(read.fromCache, true);
  assert.equal(read.text, 'Huiswijn €9');
  assert.deepEqual(calls, ['https://voorbeeld.nl/menu']);

  const refused = await fetchSourceText('https://voorbeeld.nl/menu', {
    fetcher: { async getPage(url) { return { ok: false, url, reason: 'robots', detail: 'robots.txt verbiedt dit pad' }; } },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'robots');

  const docx = await fetchSourceText('https://voorbeeld.nl/menu.docx', {
    fetcher: { async getPage(url) { return { ok: true, url, kind: 'other', contentType: 'application/msword' }; } },
  });
  assert.equal(docx.ok, false);
  assert.equal(docx.reason, 'unsupported_content_type');

  const nothing = await fetchSourceText('geen-url');
  assert.equal(nothing.ok, false);
  assert.equal(nothing.reason, 'invalid_url');
});
