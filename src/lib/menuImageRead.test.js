'use strict';

// BE-33 (#79) — unit tests for the image/scan menu rules: which images of this
// website are menu images, what may go to the model within the fixed limits,
// and how the origin of a dish read from an image is worded or refused.
// Fictional pages and a 1x1 PNG only; no network, no model, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_MENU_IMAGES,
  MAX_SCAN_PAGES,
  MAX_IMAGE_BYTES,
  CONTROLE_NODIG,
  collectMenuImages,
  imageReadNotice,
  imageProvenance,
  planImageRead,
  provenanceLabel,
} = require('./menuImageRead');
const schema = require('./menuExtractionSchema');

// A real, tiny PNG (1x1, transparent): only its bytes matter to the checks.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2wAAAABJRU5ErkJggg==';

function image(number, url) {
  return { number, url: url || `https://bistro-voorbeeld.nl/kaart-${number}.jpg`, mediaType: 'image/jpeg', data: TINY_PNG, alt: `Menukaart ${number}` };
}

test('BE-33: only menu images of the same website are collected', () => {
  const html = [
    '<img src="/logo.png" alt="Logo Bistro Voorbeeld">',
    '<img src="/img/sfeer-terras.jpg" alt="Ons terras">',
    '<img src="/img/menukaart-1.jpg" alt="Menukaart pagina 1">',
    '<img data-src="/img/lunch-2.webp" alt="Lunchkaart">',
    '<img src="https://f.instagram.com/p/menu.jpg">',
    '<img src="https://cdn.voorbeeld-cdn.nl/menu-3.jpg" alt="Menukaart 3">',
    '<a href="/img/Diner-4.png"><img src="/img/Diner-4.png" alt=""></a>',
    '<img src="/img/menukaart-1.jpg" alt="Dubbel">',
  ].join('\n');
  const found = collectMenuImages({ html, pageUrl: 'https://www.bistro-voorbeeld.nl/menu' });
  assert.deepEqual(
    found.map((entry) => entry.url),
    [
      'https://www.bistro-voorbeeld.nl/img/menukaart-1.jpg',
      'https://www.bistro-voorbeeld.nl/img/lunch-2.webp',
      'https://www.bistro-voorbeeld.nl/img/Diner-4.png',
    ],
  );
  // The origin the model must repeat is fixed here, in page order.
  assert.deepEqual(found.map((entry) => entry.number), [1, 2, 3]);
  // An image of another website is never offered (criterion 2).
  assert.equal(found.some((entry) => entry.url.includes('instagram.com')), false);
  assert.equal(found.some((entry) => entry.url.includes('voorbeeld-cdn.nl')), false);
});

test('BE-33: at most six menu images are collected, and a page without a menu word yields none', () => {
  const many = Array.from({ length: 9 }, (_, index) => `<img src="/kaart-${index + 1}.jpg" alt="Menukaart ${index + 1}">`).join('');
  assert.equal(collectMenuImages({ html: many, pageUrl: 'https://voorbeeld.nl/menu' }).length, MAX_MENU_IMAGES);
  // Slightly over the limit is still detectable by the caller (limit + 1).
  assert.equal(collectMenuImages({ html: many, pageUrl: 'https://voorbeeld.nl/menu', limit: MAX_MENU_IMAGES + 1 }).length, MAX_MENU_IMAGES + 1);
  assert.deepEqual(collectMenuImages({ html: '<img src="/header-1.jpg" alt="Welkom">', pageUrl: 'https://voorbeeld.nl/' }), []);
  assert.deepEqual(collectMenuImages({ html: '', pageUrl: 'https://voorbeeld.nl/' }), []);
});

test('BE-33: a text source wins; images and a scan are planned within the fixed limits', () => {
  const text = planImageRead({ sources: [{ id: 'source-1', kind: 'html', text: 'Huiswijn 5,00', hasText: true }] });
  assert.equal(text.ok, true);
  assert.equal(text.mode, 'text');
  assert.equal(text.imageCount, 0);

  const images = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [image(1), image(2)], hasText: false }] });
  assert.equal(images.ok, true);
  assert.equal(images.mode, 'image');
  assert.equal(images.imageCount, 2);
  assert.match(images.estimate.label, /2 afbeeldingen/);
  assert.equal(images.estimate.maxEurCents, 30);

  const scan = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: 3, hasText: false }] });
  assert.equal(scan.ok, true);
  assert.equal(scan.mode, 'document');
  assert.equal(scan.pageCount, 3);
  assert.match(scan.estimate.label, /3 pagina/);

  // Criterion 2: six images are the maximum, a seventh is refused.
  const six = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [1, 2, 3, 4, 5, 6].map((n) => image(n)), hasText: false }] });
  assert.equal(six.ok, true);
  const seven = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [1, 2, 3, 4, 5, 6, 7].map((n) => image(n)), hasText: false }] });
  assert.equal(seven.ok, false);
  assert.equal(seven.reason, 'too_many_images');
  assert.match(seven.message, /maximaal 6/);

  // Ten pages are the maximum; eleven are refused before anything is sent.
  const ten = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: MAX_SCAN_PAGES, hasText: false }] });
  assert.equal(ten.ok, true);
  const eleven = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: MAX_SCAN_PAGES + 1, hasText: false }] });
  assert.equal(eleven.ok, false);
  assert.equal(eleven.reason, 'too_many_pages');
  // Without a page count the document is not sent at all.
  const unknown = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: null, hasText: false }] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, 'page_count_unknown');

  // The fixed file size is a real boundary, not a suggestion.
  const big = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8);
  const tooLarge = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [{ number: 1, url: 'https://voorbeeld.nl/kaart-1.jpg', mediaType: 'image/jpeg', data: big }], hasText: false }] });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.reason, 'image_too_large');

  const empty = planImageRead({ sources: [{ id: 'source-1', kind: 'html', text: '', hasText: false }] });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'source_empty');
});

test('BE-33: the origin of an image dish is exact; anything else is refused', () => {
  assert.deepEqual(imageProvenance('afbeelding 2'), { kind: 'image', number: 2, label: 'gelezen van afbeelding 2' });
  assert.equal(imageProvenance('pagina 3').label, 'gelezen van pagina 3');
  assert.equal(imageProvenance('Afbeelding 1').number, 1);
  // A line number, an empty locator or a number without a word is not an origin.
  assert.equal(imageProvenance('regel 2'), null);
  assert.equal(imageProvenance(''), null);
  assert.equal(imageProvenance('2'), null);
  assert.equal(imageProvenance('afbeelding 0'), null);
  assert.equal(imageProvenance(null), null);
  // The sentence of a review row; a text source never gets one.
  assert.equal(provenanceLabel({ id: 'source-1', kind: 'image', images: [image(1)] }, 'afbeelding 1'), 'gelezen van afbeelding 1');
  assert.equal(provenanceLabel({ id: 'source-1', kind: 'html', text: 'Huiswijn' }, 'afbeelding 1'), null);
});

test('BE-33: the shared validator demands the origin for an image source and still checks text', () => {
  const imageSource = { id: 'source-1', kind: 'image', imageRead: true, images: [image(1), image(2)] };
  const output = (locator) => ({
    menus: [
      {
        title: 'Menukaart',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Klassiekers',
            items: [
              {
                name: 'Fictieve steak',
                priceStatus: 'known',
                amountMinorUnits: 2150,
                currency: 'EUR',
                priceText: '21,50',
                evidence: { sourceId: 'source-1', locator, quote: 'Fictieve steak 21,50' },
              },
            ],
          },
        ],
      },
    ],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  });
  // A quote that is not literally in any text is fine for an image, because the
  // image cannot be quoted; the origin is what must be there.
  assert.deepEqual(schema.validateStructuredOutput(output('afbeelding 2'), [imageSource]), []);
  const missing = schema.validateStructuredOutput(output('regel 12'), [imageSource]);
  assert.deepEqual(missing, ['menus[0].categories[0].items[0].evidence.locator must name "afbeelding N" or "pagina N" for an image or scan source']);
  // A text source keeps exactly the old rule: the quote must be in the source.
  const textSource = { id: 'source-1', kind: 'html', text: 'Fictieve steak 21,50' };
  assert.deepEqual(schema.validateStructuredOutput(output('regel 1'), [textSource]), []);
  const wrongQuote = output('regel 1');
  wrongQuote.menus[0].categories[0].items[0].evidence.quote = 'Deze zin staat er niet';
  assert.deepEqual(schema.validateStructuredOutput(wrongQuote, [textSource]), ['menus[0].categories[0].items[0].evidence.quote is not present in the cited source']);
  // A scan PDF is an image source too.
  assert.equal(schema.isImageSource({ id: 'source-1', kind: 'pdf', imageRead: true }), true);
  assert.equal(schema.imageProvenance('pagina 4').label, 'gelezen van pagina 4');
});

test('BE-33: the notice says out loud that an image quote cannot be checked', () => {
  const images = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [image(1)], hasText: false }] });
  const imageNotice = imageReadNotice(images);
  assert.match(imageNotice, /niet letterlijk te controleren/);
  assert.match(imageNotice, new RegExp(CONTROLE_NODIG));
  const scan = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: 2, hasText: false }] });
  assert.match(imageReadNotice(scan), /pagina N/);
  assert.equal(imageReadNotice({ ok: true, mode: 'text' }), null);
});
