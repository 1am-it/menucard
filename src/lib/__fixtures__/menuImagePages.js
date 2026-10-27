'use strict';

// BE-35 ronde 2 (#84) — fictional pages with the shape of the live Al Dente
// menu pages: navigation, footer, cookies and opening hours as readable text,
// while the menu itself exists only as an image. Pure text, no network, no real
// restaurant data. The domain is a reserved example domain on purpose.

const ORIGIN = 'https://www.aldente-voorbeeld.example';
const UPLOAD = '/wp-content/uploads/2026/08';

function navigation() {
  return [
    '<header class="site-header"><nav aria-label="Hoofdmenu">',
    `<a href="${ORIGIN}/">Home</a>`,
    `<a href="${ORIGIN}/menukaart-restaurant-2/">Menukaart</a>`,
    `<a href="${ORIGIN}/menu-classico/">Menu Classico</a>`,
    `<a href="${ORIGIN}/reserveren/">Reserveren</a>`,
    '</nav></header>',
  ].join('');
}

function footer() {
  return [
    '<footer class="site-footer">',
    '<p>Al Dente Voorbeeld · Grote Markt 1, 4811 XR Breda · 076 000 0000</p>',
    '<p>Openingstijden: maandag tot en met zondag van 12:00 tot 22:00</p>',
    '<p>Volg ons op <a href="https://www.instagram.com/">Instagram</a> en <a href="https://www.facebook.com/">Facebook</a></p>',
    '<p>Deze site gebruikt cookies. Lees onze privacyverklaring en ons cookiebeleid.</p>',
    '</footer>',
  ].join('');
}

/**
 * One page in the real shape: navigation, an intro, the menu images (in page
 * order) and the footer. The images carry a normal menu size, so only their
 * file name or the page itself decides whether they are menu images.
 */
function menuImagePage({ path, title, heading, intro, files }) {
  const html = [
    '<!DOCTYPE html>',
    '<html lang="nl"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    '</head><body>',
    navigation(),
    '<main>',
    `<h1>${heading}</h1>`,
    `<p>${intro}</p>`,
    ...files.map(
      (file) =>
        `<p><img src="${UPLOAD}/${file}" alt="" width="1200" height="1700" loading="lazy" class="wp-image"></p>`,
    ),
    '</main>',
    footer(),
    '</body></html>',
  ].join('\n');
  return {
    pageUrl: `${ORIGIN}${path}`,
    html,
    imageUrls: files.map((file) => `${ORIGIN}${UPLOAD}/${file}`),
  };
}

/** `/menukaart-restaurant-2/`: 7 menu images, the real Al Dente shape. */
function alDenteMenuPage({ count = 7 } = {}) {
  const files = Array.from({ length: count }, (_, index) => `Menukaart0826${String.fromCharCode(97 + index)}.jpg`);
  return menuImagePage({
    path: '/menukaart-restaurant-2/',
    title: 'Menukaart restaurant 2 - Al Dente Voorbeeld',
    heading: 'Menukaart',
    intro: 'Onze kaart wisselt met de seizoenen. Vraag ons team naar de allergenen en de daggerechten.',
    files,
  });
}

/** `/menu-classico/`: 2 menu images whose file name does not say "menu". */
function classicoPage() {
  return menuImagePage({
    path: '/menu-classico/',
    title: 'Menu Classico - Al Dente Voorbeeld',
    heading: 'Menu Classico',
    intro: 'Het klassieke menu van de chef. Alleen beschikbaar op dinsdag en woensdag.',
    files: ['Classico0826a.jpg', 'Classico0826b.jpg'],
  });
}

/**
 * A page that really has a text menu (price lines) and one menu image. The text
 * must stay the source: free to read and exactly checkable.
 */
function textMenuPage() {
  const page = menuImagePage({
    path: '/lunchkaart/',
    title: 'Lunchkaart - Al Dente Voorbeeld',
    heading: 'Lunchkaart',
    intro: 'Elke dag vers bereid. Brood wordt geserveerd met huisgemaakte olie.',
    files: ['Lunchkaart0826.jpg'],
  });
  return {
    ...page,
    html: page.html.replace(
      '<h1>Lunchkaart</h1>',
      [
        '<h1>Lunchkaart</h1>',
        '<ul>',
        '<li>Bruschetta pomodoro 8,50</li>',
        '<li>Pasta carbonara € 14,50</li>',
        '<li>Insalata caprese 11,-</li>',
        '<li>Tiramisu 7.50</li>',
        '</ul>',
      ].join('\n'),
    ),
  };
}

/** A page with WordPress size variants of the same file in its content. */
function wordpressVariantsPage() {
  const files = [
    'Menukaart0826a-300x212.jpg',
    'Menukaart0826a-768x1086.jpg',
    'Menukaart0826a.jpg',
    'Menukaart0826b-300x212.jpg',
  ];
  const page = menuImagePage({
    path: '/menukaart-restaurant-2/',
    title: 'Menukaart restaurant 2 - Al Dente Voorbeeld',
    heading: 'Menukaart',
    intro: 'Onze kaart wisselt met de seizoenen.',
    files,
  });
  return page;
}

module.exports = { ORIGIN, UPLOAD, alDenteMenuPage, classicoPage, menuImagePage, textMenuPage, wordpressVariantsPage };
