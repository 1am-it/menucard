'use strict';

// Regression for a live Batchanalyse outcome (2026-10-10): a known
// restaurant's homepage links to its menu page only through the link TEXT
// ("Ontdek het menu" → /nl/restaurant, no menu keyword in the path). That
// page shows its menu as plain HTML: accordion cards, section headings, and
// per section one paragraph whose dish lines are separated by <br>, each
// line ending in its own <strong> price in a one-decimal notation ("14.5").
// It has no JSON-LD. Fictional pages only (RFC 2606 .example); no real
// site, URL or page content is used.
//
// Pinned behaviour, all within the existing BE-20 bounds (same host, one
// hop, at most five candidates, the same fetch gates):
// - discovery finds the page through its link text;
// - the deterministic BE-22 recognizer (promoted to src/lib) reads the
//   priced dish lines, and the result runs through the existing certainty
//   and next-step logic;
// - opening hours, events, price-less lines and prose never become a menu;
// - when nothing is readable, the page that was read is named for review.

const test = require('node:test');
const assert = require('node:assert/strict');
const { findSameHostMenuCandidates, MAX_CANDIDATES } = require('./sameHostDiscovery');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { extractHtmlMenuStructure, parseHtml, createBudget } = require('./htmlMenuStructure');
const { deriveItemView, menuSourceUrls } = require('./batchAnalysis');

const HOME_URL = 'https://bistro-fictief.example/nl';
const MENU_URL = 'https://bistro-fictief.example/nl/restaurant';
const RESTAURANTS = { bistro: { name: 'Bistro Fictief', website: 'https://www.bistro-fictief.example' } };

const HOMEPAGE = `<!doctype html><html><body>
  <nav><a href="/">Home</a><a href="/nl/restaurant">Restaurant</a><a href="/nl/events">Events</a><a href="/nl/contact">Contact</a></nav>
  <section><h2>Welkom</h2><a href="/nl/restaurant">Ontdek het menu</a><a href="#reserveren">Reserveren</a></section>
  <footer><a href="https://social.example/bistro">Social</a><a href="mailto:info@bistro-fictief.example">Mail</a></footer>
</body></html>`;

// Accordion cards around whole menus; one paragraph per section, dish lines
// separated by <br>, the price alone in a <strong> ("14.5" = 14,50).
const MENU_PAGE_LINE_LIST = `<!doctype html><html><body>
  <h1>Restaurant</h1>
  <div class="menucard">
    <div class="menucard__item">
      <div class="menucard__header" role="button"><span class="menucard__title">Diner</span></div>
      <div class="menucard__panel"><div class="menucard__columns">
        <div class="menucard__column">
          <h3>Koud</h3>
          <p>Fictieve salade met citroen <strong>14.5</strong><br>Fictief tartaar met kappertjes <strong>16.5</strong><br>Fictieve carpaccio van biet <strong>13</strong><br><strong></strong></p>
          <h3>Warm</h3>
          <p>Fictieve risotto met paddenstoelen <strong>18.5</strong><br>Fictieve vis van de dag <strong>21,5</strong><br></p>
        </div>
        <div class="menucard__column">
          <h3>Dessert</h3>
          <p>Fictieve crème brûlée <strong>9.5</strong><br>Fictief kaasplankje <strong>12</strong></p>
        </div>
      </div></div>
    </div>
    <div class="menucard__item">
      <div class="menucard__header" role="button"><span class="menucard__title">Wijn</span></div>
      <div class="menucard__panel"><p>Vraag naar de wijnkaart.</p></div>
    </div>
  </div>
  <h2>Openingstijden</h2>
  <p>Maandag <strong>12.00</strong><br>Dinsdag <strong>12.00</strong><br>Woensdag <strong>12.00</strong></p>
</body></html>`;

const MENU_PAGE_WITHOUT_PRICES = `<!doctype html><html><body>
  <h3>Koud</h3><p>Fictief gerecht een<br>Fictief gerecht twee</p>
  <h3>Warm</h3><p>Fictief gerecht drie<br>Fictief gerecht vier</p>
</body></html>`;

function analyse(menuPage) {
  return runRestaurantSourceAnalysis({
    homepageHtml: HOMEPAGE,
    homepageUrl: HOME_URL,
    fetchCandidate: async (url) => ({ status: 'html', body: menuPage, finalUrl: url }),
  });
}

test('discovery: a menu page linked only by its link text is found once, on the same host, within the candidate limit', () => {
  const candidates = findSameHostMenuCandidates(HOMEPAGE, HOME_URL);
  assert.deepEqual(candidates, [{ url: MENU_URL, matchedOn: 'Ontdek het menu' }]);
  assert.ok(candidates.length <= MAX_CANDIDATES);
});

test('parser: a <br> no longer closes an open paragraph', () => {
  const { root } = parseHtml('<div><p>Een <strong>1</strong><br>Twee <strong>2</strong></p></div>', createBudget());
  const p = root.children[0].children[0];
  assert.equal(p.tag, 'p');
  assert.deepEqual(p.children.map((c) => c.tag), ['#text', 'strong', 'br', '#text', 'strong']);
});

test('recognizer: br-separated dish lines with their own price element are read per section, one-decimal prices included', () => {
  const result = extractHtmlMenuStructure(MENU_PAGE_LINE_LIST);
  assert.equal(result.status, 'parsed');
  const byName = Object.fromEntries(result.sections.map((s) => [s.path[s.path.length - 1], s.items]));
  assert.deepEqual(Object.keys(byName).sort(), ['Dessert', 'Koud', 'Warm']);
  assert.deepEqual(
    byName.Koud.map((i) => [i.name, i.amountMinorUnits, i.evidence.pattern]),
    [
      ['Fictieve salade met citroen', 1450, 'line_break_list'],
      ['Fictief tartaar met kappertjes', 1650, 'line_break_list'],
      ['Fictieve carpaccio van biet', 1300, 'line_break_list'],
    ]
  );
  assert.equal(byName.Warm[1].amountMinorUnits, 2150);
  // Opening hours never become dishes.
  assert.ok(!result.sections.some((s) => s.path.join(' ').includes('Openingstijden')));
  assert.ok(result.sections.every((s) => s.items.every((i) => !/maandag|dinsdag|woensdag/i.test(i.name))));
});

test('recognizer: opening hours, events and prose are never a menu', () => {
  const hours = '<h2>Openingstijden</h2><p>Maandag <strong>12.00</strong><br>Dinsdag <strong>12.00</strong><br>Vrijdag <strong>17.30</strong><br>Zaterdag <strong>17.30</strong></p>';
  const events = '<h2>Agenda</h2><p>Pizza avond op 12 oktober <strong>15</strong><br>Wijnproeverij 24 oktober <strong>25</strong><br>Live muziek 2 november <strong>10</strong></p>';
  const prose = '<h2>Over ons</h2><p>Sinds jaar en dag koken wij met liefde. Een lunch kost vanaf <strong>12.5</strong> en een diner vanaf <strong>25</strong> per persoon.</p>';
  const reservations = '<h2>Reserveren</h2><p>Tafel voor twee <strong>10</strong><br>Tafel voor vier <strong>20</strong><br>Tafel voor zes <strong>30</strong></p>';
  for (const html of [hours, events, prose, reservations]) {
    assert.equal(extractHtmlMenuStructure(`<html><body>${html}</body></html>`).status, 'unparsed', html.slice(0, 40));
  }
});

test('analysis: the menu page is read once and becomes one priced menu context with its source URL and a reviewer note', async () => {
  const result = await analyse(MENU_PAGE_LINE_LIST);
  assert.equal(result.menuContexts.length, 1);
  const menu = result.menuContexts[0];
  assert.equal(menu.sourceUrl, MENU_URL);
  assert.equal(menu.extractionMethod, 'html');
  assert.equal(menu.contextSlug, 'menukaart');
  // The heading route is kept losslessly: a shared title, the section path and the full source route.
  assert.equal(menu.title, 'Restaurant');
  assert.equal(menu.structure, 'normalized');
  assert.deepEqual(menu.categories.map((c) => [c.name, c.path, c.sourcePath, c.items.length]), [
    ['Koud', ['Koud'], ['Restaurant', 'Koud'], 3],
    ['Warm', ['Warm'], ['Restaurant', 'Warm'], 2],
    ['Dessert', ['Dessert'], ['Restaurant', 'Dessert'], 2],
  ]);
  assert.deepEqual(menu.categories[0].items[0], { name: 'Fictieve salade met citroen', desc: null, price: '14.50' });
  assert.ok(menu.categories.every((c) => c.items.every((i) => /^\d+\.\d{2}$/.test(i.price))));
  assert.ok(result.notes.some((n) => n.startsWith(`Menukaart herkend uit de HTML van ${MENU_URL}: 7 gerechten met prijs in 3 rubrieken.`)));
  assert.deepEqual(menuSourceUrls(result), [MENU_URL]);
});

test('batch: a recognised HTML menu runs through the existing certainty logic — a known restaurant on its own host gets "Bevestig bron"', async () => {
  const analysis = await analyse(MENU_PAGE_LINE_LIST);
  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: 'https://www.bistro-fictief.example/', outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T12:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: menuSourceUrls(analysis), notes: analysis.notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus: analysis.menuContexts },
    restaurants: RESTAURANTS,
    proposals: [],
    now: new Date('2026-10-10T12:05:00Z'),
  });
  assert.equal(view.label, 'Menukaart gevonden · controle nodig');
  assert.equal(view.high, true);
  assert.equal(view.foundUrl, MENU_URL);
  assert.deepEqual(view.actions, ['confirm']);
  assert.notEqual(view.label, 'Bron bevestigd'); // never confirmed automatically
});

test('analysis: a price-less HTML menu yields no menu, stays conservative and names the page that was read', async () => {
  const result = await analyse(MENU_PAGE_WITHOUT_PRICES);
  assert.deepEqual(result.menuContexts, []);
  assert.deepEqual(result.unknownMenuContexts, []);
  const note = result.notes.find((n) => n.startsWith('Mogelijke menupagina gelezen:'));
  assert.ok(note);
  assert.match(note, /link "Ontdek het menu"/);
  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: 'https://www.bistro-fictief.example/', outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T12:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: [], notes: result.notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus: [] },
    restaurants: RESTAURANTS,
    proposals: [],
    now: new Date('2026-10-10T12:05:00Z'),
  });
  assert.equal(view.label, 'Geen bruikbare menukaart gevonden');
  assert.deepEqual(view.actions, ['review_manually']);
  assert.deepEqual(view.notes, result.notes);
});

test('entry page: a menu page entered directly is read from its already-fetched HTML, without any extra fetch', async () => {
  const fetched = [];
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: MENU_PAGE_LINE_LIST,
    homepageUrl: MENU_URL,
    fetchCandidate: async (url) => {
      fetched.push(url);
      return { status: 'error' };
    },
  });
  assert.deepEqual(fetched, []); // the page links to no other menu page
  assert.equal(result.menuContexts.length, 1);
  assert.equal(result.menuContexts[0].sourceUrl, MENU_URL);
  assert.equal(result.menuContexts[0].extractionMethod, 'html');
  assert.equal(result.menuContexts[0].categories.reduce((n, c) => n + c.items.length, 0), 7);
  assert.ok(result.notes.some((n) => n.startsWith(`Menukaart herkend uit de HTML van ${MENU_URL}: 7 gerechten met prijs in 3 rubrieken.`)));
  assert.deepEqual(menuSourceUrls(result), [MENU_URL]);
});

test('entry page: opening hours, events, reservations and price-less lines on the entry page never become a menu', async () => {
  const pages = [
    '<h2>Openingstijden</h2><p>Maandag <strong>12.00</strong><br>Dinsdag <strong>12.00</strong><br>Vrijdag <strong>17.30</strong></p>',
    '<h2>Agenda</h2><p>Pizza avond op 12 oktober <strong>15</strong><br>Wijnproeverij 24 oktober <strong>25</strong><br>Live muziek 2 november <strong>10</strong></p>',
    '<h2>Reserveren</h2><p>Tafel voor twee <strong>10</strong><br>Tafel voor vier <strong>20</strong><br>Tafel voor zes <strong>30</strong></p>',
    '<h3>Koud</h3><p>Fictief gerecht een<br>Fictief gerecht twee<br>Fictief gerecht drie</p>',
  ];
  for (const body of pages) {
    const result = await runRestaurantSourceAnalysis({
      homepageHtml: `<html><body>${body}</body></html>`,
      homepageUrl: HOME_URL,
      fetchCandidate: async () => ({ status: 'error' }),
    });
    assert.deepEqual(result.menuContexts, [], body.slice(0, 40));
  }
});

test('entry page: the homepage-with-discovered-menu-page path is unchanged when the homepage itself holds no menu', async () => {
  const result = await analyse(MENU_PAGE_LINE_LIST);
  assert.equal(result.menuContexts.length, 1);
  assert.equal(result.menuContexts[0].sourceUrl, MENU_URL);
});

test('analysis: a JSON-LD menu on the page still wins; the HTML recognizer is not used then', async () => {
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Kaart',
    hasMenuSection: [{ '@type': 'MenuSection', name: 'Warm', hasMenuItem: [{ '@type': 'MenuItem', name: 'Fictief gerecht', offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'EUR' } }] }],
  })}</script>`;
  const result = await analyse(MENU_PAGE_LINE_LIST.replace('<body>', `<body>${jsonLd}`));
  assert.equal(result.menuContexts.length, 1);
  assert.notEqual(result.menuContexts[0].contextSlug, 'menukaart');
  assert.equal(result.notes.some((n) => n.startsWith('Menukaart herkend uit de HTML')), false);
  assert.equal(result.notes.some((n) => n.startsWith('Mogelijke menupagina gelezen:')), false);
});
