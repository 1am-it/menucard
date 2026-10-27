'use strict';

// Z2/Z3/Z5 of the Delivery Lead order 6382953597 (variant 5): the card with
// markings. Pure tests: no provider, no network, no database, no browser.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IMAGE_NOTICE,
  LEGEND,
  PDF_TEXT_NOTICE,
  WEBSITE_NOTICE,
  buildSourceCard,
  buildSourceMap,
  chooseCardView,
  describeMark,
} = require('./menuSourceMap');

const TEXT = ['DINER', 'Voorgerechten', 'Fictieve carpaccio', '11,00', 'Fictieve steak 24,50', 'Friet 3,50'].join('\n');

function source(extra = {}) {
  return { id: 'source-1', url: 'https://fictief-brasserie.invalid/diner', kind: 'html', hasText: true, text: TEXT, ...extra };
}

function menus(items) {
  return [{ title: 'Diner', sourceId: 'source-1', categories: [{ name: 'Voorgerechten', items }] }];
}

const STEAK = {
  name: 'Fictieve steak',
  priceStatus: 'known',
  amountMinorUnits: 2250,
  currency: 'EUR',
  evidence: { sourceId: 'source-1', locator: 'regel 5', quote: 'Fictieve steak 24,50' },
};

test('Z3: een website toont de opgehaalde tekst, een PDF de tekst met een eerlijke melding', () => {
  const website = chooseCardView({ kind: 'html', hasText: true, pageCount: 1 });
  assert.equal(website.mode, 'website_text');
  assert.equal(website.notice, WEBSITE_NOTICE);
  assert.equal(website.pageRenderable, false);
  // No new dependency and no byte store: the PDF page itself cannot be drawn.
  const pdf = chooseCardView({ kind: 'pdf', hasText: true, pageCount: 3 });
  assert.equal(pdf.mode, 'pdf_text');
  assert.equal(pdf.notice, PDF_TEXT_NOTICE);
  assert.equal(pdf.pageRenderable, false);
  assert.equal(pdf.reason, 'pdf_bytes_not_kept');
  assert.match(pdf.label, /3 pagina/);
  const image = chooseCardView({ kind: 'pdf', hasText: false });
  // BE-33 (#79): a scan PDF is its own card with the page origin, not a silent
  // "image without text" anymore.
  assert.equal(image.mode, 'pdf_scan');
  assert.match(image.notice, /Controle nodig/);
  // An unknown kind is still honest: text of the source, no page image.
  assert.equal(chooseCardView({ kind: 'other', hasText: true }).mode, 'source_text');
});

test('Z2: de compacte index noemt per bron de tellingen en de markeringen zonder brontekst', () => {
  const map = buildSourceMap({ sources: [source()], menus: menus([STEAK]) });
  assert.equal(map.available, true);
  assert.equal(map.version, 'menu-source-map/v1');
  assert.equal(map.legend.length, 4);
  assert.deepEqual(map.legend.map((entry) => entry.label), ['Overgenomen', 'Niet overgenomen', 'Prijs wijkt af', 'Geen gerecht']);
  assert.equal(map.sources.length, 1);
  assert.deepEqual(map.sources[0].counts, { covered: 0, uncovered: 2, priceMismatch: 1, notDish: 0, total: 3 });
  assert.equal(map.sources[0].view.notice, WEBSITE_NOTICE);
  assert.deepEqual(map.marks.map((mark) => [mark.id, mark.tone, mark.lineNumber]), [
    ['source-1:4', 'uncovered', 4],
    ['source-1:5', 'price_mismatch', 5],
    ['source-1:6', 'uncovered', 6],
  ]);
  // The red mark carries the dish and the two prices; the source text stays out
  // of the review payload.
  const red = map.marks.find((mark) => mark.tone === 'price_mismatch');
  assert.equal(red.rowId, '0.0.0');
  assert.equal(red.name, 'Fictieve steak');
  assert.equal(red.priceText, '24,50');
  assert.equal(red.conceptPriceText, '€ 22,50');
  assert.equal(JSON.stringify(map).includes('Fictieve steak 24,50'), false);
  assert.equal(JSON.stringify(map).includes('DINER'), false);
});

test('Z2: een bron zonder tekst levert geen markeringen en geen groen resultaat', () => {
  const map = buildSourceMap({ sources: [source({ hasText: false, text: '' })], menus: [] });
  assert.equal(map.available, false);
  assert.equal(map.reason, 'capture_unavailable');
  assert.equal(map.message, 'Vergelijking niet beschikbaar voor dit concept');
  assert.deepEqual(map.marks, []);
});

test('Z3: een scan zonder tekst staat als bron in de kaart met een eerlijke melding', () => {
  const sources = [source(), source({ id: 'source-2', kind: 'pdf', hasText: false, text: '' })];
  const map = buildSourceMap({ sources, menus: menus([STEAK]) });
  assert.equal(map.available, true);
  assert.equal(map.sources.length, 2);
  assert.equal(map.sources[1].id, 'source-2');
  assert.equal(map.sources[1].view.mode, 'pdf_scan');
  assert.match(map.sources[1].view.notice, /Controle nodig/);
  assert.equal(map.sources[1].counts.total, 0);
  // The card of that source says it cannot be compared yet, and draws nothing.
  const card = buildSourceCard({ sources, menus: [], sourceId: 'source-2' });
  assert.match(card.source.view.notice, /Controle nodig/);
  assert.deepEqual(card.page.lines, []);
});

test('Z3: de kaart toont de echte regels van één pagina met de markering op de juiste regel', () => {
  const card = buildSourceCard({ sources: [source()], menus: menus([STEAK]), sourceId: 'source-1', page: 1 });
  assert.equal(card.available, true);
  assert.equal(card.page.number, 1);
  assert.equal(card.page.total, 1);
  assert.equal(card.source.view.mode, 'website_text');
  assert.deepEqual(card.page.lines.map((line) => [line.number, line.text, line.tone, line.marker]), [
    [1, 'DINER', null, false],
    [2, 'Voorgerechten', null, false],
    [3, 'Fictieve carpaccio', 'uncovered', true],
    [4, '11,00', 'uncovered', false],
    [5, 'Fictieve steak 24,50', 'price_mismatch', true],
    [6, 'Friet 3,50', 'uncovered', true],
  ]);
  // A pair is one mark: the button sits on the name line, the price line stays
  // visibly part of it without a second button.
  const pair = card.marks.find((mark) => mark.lineNumber === 4);
  assert.equal(pair.paired, true);
  assert.equal(pair.markerLine, 3);
  assert.equal(pair.endLine, 4);
  assert.equal(pair.locator, 'regels 3–4');
  assert.match(card.page.lines[2].ariaLabel, /Fictieve carpaccio: niet overgenomen, kaart 11,00/);
  // A price line without a name can be dismissed but never added.
  const loose = buildSourceCard({ sources: [source({ text: '11,00' })], menus: [], sourceId: 'source-1' });
  assert.equal(loose.marks[0].name, null);
  assert.equal(loose.marks[0].canAdd, false);
  assert.equal(loose.marks[0].ariaLabel, 'regel zonder gerechtnaam: niet overgenomen, kaart 11,00');
});

test('Z3: pagina 2 van een PDF-tekst wordt apart opgevraagd en de melding blijft eerlijk', () => {
  const paged = ['DINER', 'Fictieve carpaccio', '11,00', 'Hoofdgerechten', 'Fictieve steak', '24,50']
    .join('\n')
    .replace('Hoofdgerechten', '\fHoofdgerechten');
  const card = buildSourceCard({
    sources: [source({ kind: 'pdf', text: paged })],
    menus: menus([{ ...STEAK, amountMinorUnits: 2450 }]),
    sourceId: 'source-1',
    page: 2,
  });
  assert.equal(card.source.view.mode, 'pdf_text');
  assert.equal(card.source.view.notice, PDF_TEXT_NOTICE);
  assert.equal(card.page.total, 2);
  assert.deepEqual(card.page.lines.map((line) => [line.number, line.text]), [
    [4, 'Hoofdgerechten'],
    [5, 'Fictieve steak'],
    [6, '24,50'],
  ]);
  assert.deepEqual(card.marks.map((mark) => [mark.id, mark.page, mark.tone]), [['source-1:6', 2, 'covered']]);
  const outOfRange = buildSourceCard({ sources: [source()], menus: [], sourceId: 'source-1', page: 4 });
  assert.equal(outOfRange.available, false);
  assert.equal(outOfRange.reason, 'page_out_of_range');
  const unknown = buildSourceCard({ sources: [source()], menus: [], sourceId: 'source-9' });
  assert.equal(unknown.reason, 'unknown_source');
});

test('Z3: een afbeelding zonder tekst toont geen verzonnen pagina', () => {
  const card = buildSourceCard({ sources: [source({ kind: 'pdf', hasText: false, text: '' })], menus: [], sourceId: 'source-1' });
  assert.equal(card.source.view.mode, 'pdf_scan');
  assert.match(card.source.view.notice, /Controle nodig/);
  assert.deepEqual(card.page.lines, []);
});

test('Z2/Z4: elke markering heeft tekst voor een schermlezer, niet alleen kleur', () => {
  assert.equal(LEGEND.every((entry) => entry.label && entry.detail), true);
  assert.equal(describeMark({ tone: 'covered', name: 'Soep', conceptPriceText: '€ 6,50' }), 'Soep: overgenomen, concept € 6,50');
  assert.equal(describeMark({ tone: 'uncovered', name: null, priceText: '3,50' }), 'regel zonder gerechtnaam: niet overgenomen, kaart 3,50');
  assert.equal(
    describeMark({ tone: 'price_mismatch', name: 'Steak', priceText: '24,50', conceptPriceText: '€ 22,50' }),
    'Steak: prijs wijkt af, kaart 24,50 en concept € 22,50',
  );
  assert.equal(describeMark({ tone: 'not_dish', name: 'Friet' }), 'Friet: geen gerecht, eerder beoordeeld');
});
// BE-33 (#79, criterion 3): a menu read from images shows the image beside the
// dishes that came from it, and every dish keeps "Controle nodig".
const IMAGE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg==';

function imageSource(extra = {}) {
  return {
    id: 'source-1',
    url: 'https://fictief-brasserie.invalid/menukaart',
    kind: 'image',
    hasText: false,
    text: null,
    imageRead: true,
    images: [
      { number: 1, url: 'https://fictief-brasserie.invalid/kaart-1.jpg', alt: 'Menukaart 1', mediaType: 'image/jpeg' },
      { number: 2, url: 'https://fictief-brasserie.invalid/kaart-2.jpg', alt: 'Menukaart 2', mediaType: 'image/jpeg' },
    ],
    ...extra,
  };
}

function imageItem(name, locator, amount) {
  return {
    name,
    priceStatus: 'known',
    amountMinorUnits: amount,
    currency: 'EUR',
    priceText: `${amount / 100},00`,
    evidence: { sourceId: 'source-1', locator, quote: name },
  };
}

test('BE-33: een kaart van afbeeldingen is beschikbaar zonder tekst en toont de afbeelding naast de gerechten', () => {
  const menusWithImages = menus([imageItem('Fictieve steak', 'afbeelding 1', 2450), imageItem('Fictieve soep', 'afbeelding 2', 650)]);
  const map = buildSourceMap({ sources: [imageSource()], menus: menusWithImages });
  assert.equal(map.available, true, 'an image menu has its own card instead of "not comparable"');
  assert.deepEqual(map.sources.map((entry) => entry.view.mode), ['images']);
  assert.match(map.sources[0].view.notice, /Controle nodig/);
  assert.equal(map.sources[0].imageCount, 2);
  assert.deepEqual(map.marks, [], 'no text comparison is invented');

  const first = buildSourceCard({ sources: [imageSource()], menus: menusWithImages, sourceId: 'source-1', page: 1 });
  assert.equal(first.available, true);
  assert.equal(first.source.view.mode, 'images');
  assert.deepEqual(first.images.map((image) => image.url), ['https://fictief-brasserie.invalid/kaart-1.jpg']);
  assert.deepEqual(first.dishes.map((dish) => [dish.name, dish.provenance, dish.label]), [
    ['Fictieve steak', 'gelezen van afbeelding 1', 'Controle nodig'],
  ]);
  assert.equal(first.dishes[0].needsCheck, true);
  assert.deepEqual(first.page, { number: 1, total: 2, lines: [] });

  const second = buildSourceCard({ sources: [imageSource()], menus: menusWithImages, sourceId: 'source-1', page: 2 });
  assert.deepEqual(second.images.map((image) => image.url), ['https://fictief-brasserie.invalid/kaart-2.jpg']);
  assert.deepEqual(second.dishes.map((dish) => dish.provenance), ['gelezen van afbeelding 2']);
  // A page outside the images is refused, never drawn empty.
  const outOfRange = buildSourceCard({ sources: [imageSource()], menus: menusWithImages, sourceId: 'source-1', page: 3 });
  assert.equal(outOfRange.available, false);
  assert.equal(outOfRange.reason, 'page_out_of_range');
});

test('BE-33: een scan-PDF toont de paginanummer-herkomst naast de gerechten', () => {
  const scan = {
    id: 'source-1',
    url: 'https://fictief-brasserie.invalid/menukaart.pdf',
    kind: 'pdf',
    hasText: false,
    text: null,
    imageRead: true,
    pageCount: 3,
    images: [],
  };
  const scanMenus = menus([imageItem('Fictieve steak', 'pagina 2', 2450)]);
  const map = buildSourceMap({ sources: [scan], menus: scanMenus });
  assert.equal(map.available, true);
  assert.equal(map.sources[0].view.mode, 'pdf_scan');
  const card = buildSourceCard({ sources: [scan], menus: scanMenus, sourceId: 'source-1', page: 2 });
  assert.equal(card.available, true);
  assert.deepEqual(card.images, []);
  assert.equal(card.page.total, 3);
  assert.deepEqual(card.dishes.map((dish) => dish.provenance), ['gelezen van pagina 2']);
  // The same dish is not claimed on another page.
  const other = buildSourceCard({ sources: [scan], menus: scanMenus, sourceId: 'source-1', page: 1 });
  assert.deepEqual(other.dishes, []);
});

