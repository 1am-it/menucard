'use strict';

// Regression for a real menu overview page (Mr Moos Breda, 2026-10-18):
// the entry page links to /menukaart, and that page is only a hub with tiles
// for /lunch, /diner and /dranken. The hub itself has no menu, so the earlier
// one-hop-only discovery stopped after the hub and reported zero items even
// though the linked menu pages were readable HTML. The shared MAX_CANDIDATES
// budget now covers one bounded hub level, never a second one.

const test = require('node:test');
const assert = require('node:assert/strict');
const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { MAX_CANDIDATES } = require('./sameHostDiscovery');

const HOME = 'https://mrmoos-fictief.example/';

function menuPage(title, prices) {
  const cards = prices
    .map((price, index) => `<div class="menu-item">
      <p class="name">${title} gerecht ${index + 1}</p>
      <p class="description">Fictieve omschrijving ${index + 1}</p>
      <p class="price">${price}</p>
    </div>`)
    .join('');
  return `<html><body><h1>${title}</h1><h2>Gerechten</h2>${cards}</body></html>`;
}

const HUB = `<html><body>
  <h1>Menukaart</h1>
  <a href="/lunch">Bekijken</a>
  <a href="/diner">Bekijken</a>
  <a href="/dranken">Bekijken</a>
</body></html>`;

const HOME_WITH_HUB = `<html><body>
  <h1>Mr Moos Fictief</h1>
  <a href="/menukaart">Menukaart</a>
</body></html>`;

test('hub discovery: a menu overview page yields its bounded same-host menu children', async () => {
  const pages = new Map([
    [`${HOME}menukaart`, HUB],
    [`${HOME}lunch`, menuPage('Lunch', ['12.5', '14', '16,50'])],
    [`${HOME}diner`, menuPage('Diner', ['18.5', '22', '24,50'])],
    [`${HOME}dranken`, menuPage('Dranken', ['3.5', '4', '5,50'])],
  ]);
  const fetched = [];
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: HOME_WITH_HUB,
    homepageUrl: HOME,
    fetchCandidate: async (url) => {
      fetched.push(url);
      const body = pages.get(url);
      return body ? { status: 'html', body, finalUrl: url } : { status: 'error' };
    },
  });

  assert.deepEqual(fetched, [`${HOME}menukaart`, `${HOME}lunch`, `${HOME}diner`, `${HOME}dranken`]);
  assert.equal(result.menuContexts.length, 3);
  assert.deepEqual(result.menuContexts.map((menu) => menu.sourceUrl), [`${HOME}lunch`, `${HOME}diner`, `${HOME}dranken`]);
  assert.equal(result.menuContexts.reduce((n, menu) => n + menu.categories.reduce((m, category) => m + category.items.length, 0), 0), 9);
  assert.ok(result.notes.some((note) => note.includes('is een tussenpagina; 3 relevante menulink(s)')));
  assert.equal(result.sourceInventory.length, 5);
});

test('hub discovery: the hub level shares the existing MAX_CANDIDATES fetch budget', async () => {
  const fetched = [];
  const hub = `<html><body>
    <h1>Menukaart</h1>
    <a href="/lunch-kaart">Bekijken</a>
    <a href="/diner-kaart">Bekijken</a>
    <a href="/dranken-kaart">Bekijken</a>
  </body></html>`;
  const pages = new Map([
    [`${HOME}menukaart`, hub],
    [`${HOME}lunch`, menuPage('Lunch', ['12.5', '14', '16,50'])],
    [`${HOME}diner`, menuPage('Diner', ['18.5', '22', '24,50'])],
    [`${HOME}dranken`, menuPage('Dranken', ['3.5', '4', '5,50'])],
    [`${HOME}lunch-kaart`, menuPage('Lunchkaart', ['11.5', '13', '15,50'])],
    [`${HOME}diner-kaart`, menuPage('Dinerkaart', ['17.5', '21', '23,50'])],
    [`${HOME}dranken-kaart`, menuPage('Drankenkaart', ['3.5', '4', '5,50'])],
  ]);
  const home = `<html><body>
    <a href="/menukaart">Menukaart</a>
    <a href="/lunch">Lunch</a>
    <a href="/diner">Diner</a>
    <a href="/dranken">Dranken</a>
  </body></html>`;
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: home,
    homepageUrl: HOME,
    fetchCandidate: async (url) => {
      fetched.push(url);
      const body = pages.get(url);
      return body ? { status: 'html', body, finalUrl: url } : { status: 'error' };
    },
  });

  assert.equal(fetched.length, MAX_CANDIDATES);
  assert.equal(new Set(fetched).size, fetched.length);
  assert.ok(fetched.includes(`${HOME}lunch-kaart`));
  assert.equal(fetched.includes(`${HOME}diner-kaart`), false);
  assert.equal(result.sourceInventory.length, MAX_CANDIDATES + 1);
});

test('hub discovery: a child of a hub is never expanded again', async () => {
  const fetched = [];
  const pages = new Map([
    [`${HOME}menukaart`, HUB],
    [`${HOME}lunch`, `<html><body><h1>Lunch</h1><a href="/extra-een">Menu</a><a href="/extra-twee">Kaart</a></body></html>`],
    [`${HOME}diner`, '<html><body><h1>Diner</h1></body></html>'],
    [`${HOME}dranken`, '<html><body><h1>Dranken</h1></body></html>'],
    [`${HOME}extra-een`, menuPage('Extra een', ['10', '11', '12'])],
    [`${HOME}extra-twee`, menuPage('Extra twee', ['13', '14', '15'])],
  ]);
  await runRestaurantSourceAnalysis({
    homepageHtml: HOME_WITH_HUB,
    homepageUrl: HOME,
    fetchCandidate: async (url) => {
      fetched.push(url);
      const body = pages.get(url);
      return body ? { status: 'html', body, finalUrl: url } : { status: 'error' };
    },
  });

  assert.equal(fetched.includes(`${HOME}extra-een`), false);
  assert.equal(fetched.includes(`${HOME}extra-twee`), false);
});

test('hub discovery: a hub with only one menu child does not expand', async () => {
  const fetched = [];
  const result = await runRestaurantSourceAnalysis({
    homepageHtml: HOME_WITH_HUB,
    homepageUrl: HOME,
    fetchCandidate: async (url) => {
      fetched.push(url);
      if (url === `${HOME}menukaart`) {
        return { status: 'html', body: '<html><body><h1>Menukaart</h1><a href="/lunch">Bekijken</a><a href="/contact">Contact</a></body></html>', finalUrl: url };
      }
      return { status: 'html', body: menuPage('Lunch', ['12.5', '14', '16,50']), finalUrl: url };
    },
  });

  assert.deepEqual(fetched, [`${HOME}menukaart`]);
  assert.deepEqual(result.menuContexts, []);
  assert.ok(result.limitations.some((line) => line.includes('zonder automatisch herkende menukaart')));
});
