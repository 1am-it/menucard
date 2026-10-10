'use strict';

// Regression for a live Batchanalyse outcome (2026-10-10): a known
// restaurant's homepage links to its menu page only through the link TEXT
// ("Ontdek het menu" → /nl/restaurant, no menu keyword in the path), and
// that page shows the menu as plain HTML headings and dishes without JSON-LD
// and without a price notation. Fictional pages only (RFC 2606 .example);
// no real site, URL or page content is used.
//
// Pinned behaviour, all within the existing BE-20 bounds:
// - discovery finds the page through its link text (same host, one hop);
// - the live pipeline reads HTML menus only as JSON-LD, so this page yields
//   no menu — the result stays conservative ("Geen bruikbare menukaart
//   gevonden", "Beoordeel handmatig"), never a guessed menu;
// - the page that was read is named in the notes for the human reviewer.

const test = require('node:test');
const assert = require('node:assert/strict');
const { findSameHostMenuCandidates, MAX_CANDIDATES } = require('./sameHostDiscovery');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { deriveItemView } = require('./batchAnalysis');

const HOME_URL = 'https://bistro-fictief.example/nl';
const HOMEPAGE = `<!doctype html><html><body>
  <nav><a href="/">Home</a><a href="/nl/restaurant">Restaurant</a><a href="/nl/events">Events</a><a href="/nl/contact">Contact</a></nav>
  <section><h2>Welkom</h2><a href="/nl/restaurant">Ontdek het menu</a><a href="#reserveren">Reserveren</a></section>
  <footer><a href="https://social.example/bistro">Social</a><a href="mailto:info@bistro-fictief.example">Mail</a></footer>
</body></html>`;
const MENU_PAGE_WITHOUT_PRICES = `<!doctype html><html><body>
  <h3>Koud</h3><p>Fictief gerecht een</p><p>Fictief gerecht twee</p>
  <h3>Warm</h3><p>Fictief gerecht drie</p>
  <h3>Dessert</h3><p>Fictief gerecht vier</p>
</body></html>`;

test('discovery: a menu page linked only by its link text is found once, on the same host, within the candidate limit', () => {
  const candidates = findSameHostMenuCandidates(HOMEPAGE, HOME_URL);
  assert.deepEqual(candidates, [{ url: 'https://bistro-fictief.example/nl/restaurant', matchedOn: 'Ontdek het menu' }]);
  assert.ok(candidates.length <= MAX_CANDIDATES);
});

test('analysis: the menu page is read once, but a price-less HTML menu without JSON-LD yields no menu and a reviewer note naming the page', async () => {
  const fetched = [];
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: HOMEPAGE,
    homepageUrl: HOME_URL,
    fetchCandidate: async (url) => {
      fetched.push(url);
      return { status: 'html', body: MENU_PAGE_WITHOUT_PRICES, finalUrl: url };
    },
  });
  assert.deepEqual(fetched, ['https://bistro-fictief.example/nl/restaurant']);
  assert.deepEqual(result.menuContexts, []);
  assert.deepEqual(result.unknownMenuContexts, []);
  const note = result.notes.find((n) => n.startsWith('Mogelijke menupagina gelezen:'));
  assert.ok(note, 'the page that was read is named for the reviewer');
  assert.match(note, /https:\/\/bistro-fictief\.example\/nl\/restaurant/);
  assert.match(note, /link "Ontdek het menu"/);
  assert.match(note, /bekijk deze pagina handmatig/);
});

test('analysis: a menu page that does carry a JSON-LD menu gets no "not readable" note', async () => {
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Kaart',
    hasMenuSection: [{ '@type': 'MenuSection', name: 'Warm', hasMenuItem: [{ '@type': 'MenuItem', name: 'Fictief gerecht', offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'EUR' } }] }],
  })}</script>`;
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: HOMEPAGE,
    homepageUrl: HOME_URL,
    fetchCandidate: async (url) => ({ status: 'html', body: `<html><body>${jsonLd}</body></html>`, finalUrl: url }),
  });
  assert.ok(result.menuContexts.length > 0);
  assert.equal(result.notes.some((n) => n.startsWith('Mogelijke menupagina gelezen:')), false);
});

test('batch status stays conservative and shows the note under the details', () => {
  const notes = ['Mogelijke menupagina gelezen: https://bistro-fictief.example/nl/restaurant (link "Ontdek het menu"). Hier is geen automatisch leesbare menukaart herkend; bekijk deze pagina handmatig.'];
  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: 'https://bistro-fictief.example/', outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T12:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: [], notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus: [] },
    restaurants: { bistro: { name: 'Bistro Fictief', website: 'https://bistro-fictief.example' } },
    proposals: [],
    now: new Date('2026-10-10T12:05:00Z'),
  });
  assert.equal(view.label, 'Geen bruikbare menukaart gevonden');
  assert.deepEqual(view.actions, ['review_manually']);
  assert.equal(view.high, false);
  assert.deepEqual(view.notes, notes);
});
