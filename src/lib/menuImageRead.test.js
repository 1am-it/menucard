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
  MIN_MENU_IMAGE_EDGE,
  MENU_TEXT_MIN_PRICE_LINES,
  CONTROLE_NODIG,
  collectMenuImages,
  hasMenuText,
  imageReadNotice,
  imageProvenance,
  isSharedSiteImage,
  isSiteAssetUrl,
  menuPriceLineCount,
  pageHasMenuContext,
  planImageRead,
  provenanceLabel,
  sharedSiteImageKeys,
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

test('BE-33: at most ten menu images are collected, and a page without a menu word yields none', () => {
  const many = Array.from({ length: 13 }, (_, index) => `<img src="/kaart-${index + 1}.jpg" alt="Menukaart ${index + 1}">`).join('');
  assert.equal(MAX_MENU_IMAGES, 10);
  assert.equal(collectMenuImages({ html: many, pageUrl: 'https://voorbeeld.nl/menu' }).length, MAX_MENU_IMAGES);
  // Slightly over the limit is still detectable by the caller (limit + 1).
  assert.equal(collectMenuImages({ html: many, pageUrl: 'https://voorbeeld.nl/menu', limit: MAX_MENU_IMAGES + 1 }).length, MAX_MENU_IMAGES + 1);
  // The caller can also count every candidate and decide what it reads itself.
  assert.equal(collectMenuImages({ html: many, pageUrl: 'https://voorbeeld.nl/menu', limit: Number.MAX_SAFE_INTEGER }).length, 13);
test('BE-35 ronde 3: site-opmaak is geen menukaart — cropped-header, klein beeld en een beeld op elke pagina', () => {
  const pageUrl = 'https://www.aldente-voorbeeld.example/menukaart-restaurant-2/';
  const html = [
    // The WordPress header/site icon: "cropped-" in the file name.
    '<header><a href="/"><img src="/wp-content/uploads/2022/03/cropped-PNG-afbeelding.png" alt="" width="1920" height="240"></a></header>',
    // A declared icon: longest side below the minimum edge.
    '<img src="/wp-content/uploads/2026/08/small-menu-icon.jpg" alt="Menukaart" width="480" height="480">',
    // A portrait menu scan: a short width, a long side above the minimum.
    '<img src="/wp-content/uploads/2026/08/Menukaart0826a.jpg" alt="" width="300" height="1700">',
    // No declared size at all is never a reason to drop an image.
    '<img src="/wp-content/uploads/2026/08/Menukaart0826b.jpg" alt="">',
  ].join('\n');
  const found = collectMenuImages({ html, pageUrl });
  assert.deepEqual(
    found.map((entry) => entry.url),
    [
      'https://www.aldente-voorbeeld.example/wp-content/uploads/2026/08/Menukaart0826a.jpg',
      'https://www.aldente-voorbeeld.example/wp-content/uploads/2026/08/Menukaart0826b.jpg',
    ],
  );
  assert.equal(MIN_MENU_IMAGE_EDGE, 600);
  assert.equal(isSiteAssetUrl('https://voorbeeld.nl/uploads/cropped-logo-2022.png'), true);
  assert.equal(isSiteAssetUrl('https://voorbeeld.nl/uploads/Menukaart0826a.jpg'), false);

  // An image that this same reading finds on more than one page is site layout:
  // the pure rule names its key, with WordPress size variants grouped together.
  const shared = sharedSiteImageKeys([
    { pageUrl: 'https://voorbeeld.nl/menukaart/', images: [{ url: 'https://voorbeeld.nl/uploads/kop-2022.png' }, { url: 'https://voorbeeld.nl/uploads/Menukaart0826a.jpg' }] },
    { pageUrl: 'https://voorbeeld.nl/menu-classico/', images: [{ url: 'https://voorbeeld.nl/uploads/kop-2022-768x120.png' }, { url: 'https://voorbeeld.nl/uploads/Classico0826a.jpg' }] },
  ]);
  assert.equal(isSharedSiteImage('https://voorbeeld.nl/uploads/kop-2022.png', shared), true);
  assert.equal(isSharedSiteImage('https://voorbeeld.nl/uploads/kop-2022-300x47.png', shared), true);
  assert.equal(isSharedSiteImage('https://voorbeeld.nl/uploads/Menukaart0826a.jpg', shared), false);
  assert.equal(isSharedSiteImage('https://voorbeeld.nl/uploads/Classico0826a.jpg', shared), false);
  // One page alone never makes an image "shared".
  assert.equal(sharedSiteImageKeys([{ pageUrl: 'https://voorbeeld.nl/menukaart/', images: [{ url: 'https://voorbeeld.nl/uploads/kop-2022.png' }] }]).size, 0);
  // The same image twice on one page is still one page.
  assert.equal(sharedSiteImageKeys([
    { pageUrl: 'https://voorbeeld.nl/menukaart/', images: [{ url: 'https://voorbeeld.nl/uploads/kop-2022.png' }, { url: 'https://voorbeeld.nl/uploads/kop-2022.png' }] },
  ]).size, 0);
});


  assert.deepEqual(collectMenuImages({ html: '<img src="/header-1.jpg" alt="Welkom">', pageUrl: 'https://voorbeeld.nl/' }), []);
  assert.deepEqual(collectMenuImages({ html: '', pageUrl: 'https://voorbeeld.nl/' }), []);
});

test('BE-35: text with fewer than three price lines holds no menu; a date is not a price', () => {
  assert.equal(MENU_TEXT_MIN_PRICE_LINES, 3);
  // Real Al Dente text: navigation is not part of this text, but opening hours,
  // an address and an intro are. No price line at all.
  const pageText = [
    'Menukaart',
    'Onze kaart wisselt met de seizoenen.',
    'Al Dente Voorbeeld · Grote Markt 1, 4811 XR Breda · 076 000 0000',
    'Openingstijden: maandag tot en met zondag van 12:00 tot 22:00',
    'Volg ons op Instagram en Facebook',
  ].join('\n');
  assert.equal(menuPriceLineCount(pageText), 0);
  assert.equal(hasMenuText(pageText), false);

  // Two price lines are not yet a menu; three are.
  assert.equal(hasMenuText('Bruschetta 8,50\nPasta € 14,50'), false);
  assert.equal(hasMenuText('Bruschetta 8,50\nPasta € 14,50\nTiramisu 7.50'), true);
  assert.equal(hasMenuText('Insalata 11,-\nSoep 6,50\nWijn 4,00'), true);
  assert.equal(menuPriceLineCount('Bruschetta 8,50'), 1);
  // A date line is not a price, so a page of dates is still not a menu.
  assert.equal(menuPriceLineCount('27.10.2026\n28.10.2026\n29.10.2026'), 0);
  assert.equal(hasMenuText(''), false);
  assert.equal(hasMenuText(null), false);
});

test('BE-35: a page URL or title that names the menu makes its own images candidates', () => {
  const html = [
    '<html><head><title>Menu Classico - Al Dente Voorbeeld</title></head><body>',
    '<img src="/wp-content/uploads/2026/08/Classico0826a.jpg" alt="">',
    '<img src="/wp-content/uploads/2026/08/logo-al-dente.png" alt="Logo Al Dente">',
    '<img src="/wp-content/uploads/2026/08/Classico0826b.jpg" alt="">',
    '<img src="/wp-content/uploads/2026/08/team-foto.jpg" alt="Ons team">',
    '<img src="/wp-content/uploads/2026/08/pixel.gif" width="24" height="24" alt="">',
    '<img src="https://cdn.instagram.com/classico.jpg" alt="Menu">',
    '</body></html>',
  ].join('');
  const pageUrl = 'https://www.aldente-voorbeeld.example/menu-classico/';
  assert.equal(pageHasMenuContext({ html, pageUrl }), true);
  assert.deepEqual(
    collectMenuImages({ html, pageUrl }).map((entry) => entry.url),
    [
      'https://www.aldente-voorbeeld.example/wp-content/uploads/2026/08/Classico0826a.jpg',
      'https://www.aldente-voorbeeld.example/wp-content/uploads/2026/08/Classico0826b.jpg',
    ],
  );
  // Without the page hint those file names say nothing about a menu.
  const noHintHtml = html.replace('<title>Menu Classico - Al Dente Voorbeeld</title>', '<title>Al Dente Voorbeeld</title>');
  assert.equal(pageHasMenuContext({ html: noHintHtml, pageUrl: 'https://www.aldente-voorbeeld.example/over-ons/' }), false);
  assert.deepEqual(collectMenuImages({ html: noHintHtml, pageUrl: 'https://www.aldente-voorbeeld.example/over-ons/' }), []);
  // NOT_MENU still applies inside a menu page: no logo, no team photo, no icon,
  // and never another website.
  const urls = collectMenuImages({ html, pageUrl }).map((entry) => entry.url);
  assert.equal(urls.some((url) => url.includes('logo')), false);
  assert.equal(urls.some((url) => url.includes('team')), false);
  assert.equal(urls.some((url) => url.includes('pixel')), false);
  assert.equal(urls.some((url) => url.includes('instagram')), false);
});

test('BE-35: WordPress size variants count as one image, and the original wins', () => {
  const html = [
    '<img src="/uploads/Menukaart0826a-300x212.jpg" alt="Menukaart a">',
    '<img src="/uploads/Menukaart0826a-768x1086.jpg" alt="Menukaart a">',
    '<img src="/uploads/Menukaart0826a.jpg" alt="Menukaart a">',
    '<img src="/uploads/Menukaart0826b-300x212.jpg" alt="Menukaart b">',
  ].join('');
  const found = collectMenuImages({ html, pageUrl: 'https://voorbeeld.nl/menukaart' });
  assert.deepEqual(
    found.map((entry) => entry.url),
    ['https://voorbeeld.nl/uploads/Menukaart0826a.jpg', 'https://voorbeeld.nl/uploads/Menukaart0826b-300x212.jpg'],
  );
  // The order stays the page order and the numbers stay 1..N.
  assert.deepEqual(found.map((entry) => entry.number), [1, 2]);
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
  // BE-36 (#87, criterion 5): the estimate and the maximum follow the pages —
  // two pages cost about two cents and reserve at most six.
  assert.match(images.estimate.label, /geschat ± 2 cent/);
  assert.match(images.estimate.label, /maximaal 6 cent per lezing/);
  assert.equal(images.estimate.estimatedEurCents, 2);
  assert.equal(images.estimate.maxEurCents, 6);

  const scan = planImageRead({ sources: [{ id: 'source-1', kind: 'pdf', documentBase64: TINY_PNG, pageCount: 3, hasText: false }] });
  assert.equal(scan.ok, true);
  assert.equal(scan.mode, 'document');
  assert.equal(scan.pageCount, 3);
  assert.match(scan.estimate.label, /3 pagina/);

  // Criterion 2 (BE-35 ronde 3, #84): ten images are the maximum of a reading. An
  // eleventh is never a refusal: the first ten are read and the real number is
  // said out loud in ordinary language.
  const tenImages = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => image(n)), hasText: false }] });
  assert.equal(tenImages.ok, true);
  assert.equal(tenImages.imageCount, 10);
  assert.equal(tenImages.limitation, null);
  const elevenImages = planImageRead({ sources: [{ id: 'source-1', kind: 'image', images: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => image(n)), hasText: false }] });
  assert.equal(elevenImages.ok, true);
  assert.equal(elevenImages.imageCount, 10);
  assert.equal(elevenImages.availableImageCount, 11);
  assert.equal(elevenImages.limitation, 'Deze lezing heeft 11 menu-afbeeldingen; de eerste 10 zijn gelezen.');
  assert.match(elevenImages.estimate.label, /10 afbeeldingen/);
  assert.equal(elevenImages.sources.length, 1);
  assert.equal(elevenImages.sources[0].imageCount, 10);

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
