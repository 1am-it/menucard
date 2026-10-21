'use strict';

// #59 Delivery Lead review 6316295818 — analysis-level regressions for the
// generic repairs: JSON-LD item evidence, the fail-closed evidence gate, the
// deterministic menu-hub/PDF follow, and honest per-source limits (image menu,
// external PDF, a source that reports its own closure). Fictional pages and
// injected fetchers only; no real site is read.

const test = require('node:test');
const assert = require('node:assert/strict');

const { runRestaurantSourceAnalysis } = require('./restaurantSourceAnalysis');
const { applyItemEvidenceGate, hasItemEvidence } = require('./menuItemEvidence');

const HOME = 'https://fictief.example/';

function jsonLd(node) {
  return `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
}

function menuPage(names, price = '12,50') {
  return `<html><body><h2>Lunch</h2><ul>${names
    .map((name) => `<li>${name} <span>€ ${price}</span></li>`)
    .join('')}</ul></body></html>`;
}

/** Fetch plan: exact URL -> body; anything else is an error and is recorded. */
async function analyse(homepageHtml, plan, homepageUrl = HOME) {
  const fetched = [];
  const result = await runRestaurantSourceAnalysis({
    homepageHtml,
    homepageUrl,
    fetchCandidate: async (url) => {
      fetched.push(url);
      const body = plan.get(url);
      return body ? { status: 'html', body, finalUrl: url } : { status: 'error' };
    },
  });
  return { result, fetched };
}


test('JSON-LD items keep a source locator and survive the evidence gate', async () => {
  const html = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: 'Lunchkaart',
    hasMenuSection: [
      {
        '@type': 'MenuSection',
        name: 'Warm',
        hasMenuItem: [
          { '@type': 'MenuItem', name: 'Fictieve soep', description: 'pompoen', offers: { price: '7.50' } },
          { '@type': 'MenuItem', name: 'Fictieve pasta', offers: { price: '12.00' } },
          { '@type': 'MenuItem', name: 'Fictieve salade', offers: { price: '9.50' } },
        ],
      },
    ],
  });
  const { result } = await analyse(html, new Map());
  assert.equal(result.menuContexts.length, 1);
  const items = result.menuContexts[0].categories[0].items;
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(hasItemEvidence(item), true, item.name);
    assert.equal(item.evidence.pattern, 'json_ld');
    assert.match(item.evidence.locator, /application\/ld\+json/);
  }
  assert.equal(result.limitations.some((line) => /zonder bronbewijs/.test(line)), false);
});

test('a hijacked JSON-LD menu is refused as non-menu content, never accepted', async () => {
  const html = jsonLd({
    '@type': 'Menu',
    name: 'Bonus',
    hasMenuSection: [
      {
        name: 'Casino bonus',
        hasMenuItem: [
          { name: 'Welkomstbonus Unibet', offers: { price: '25.00' } },
          { name: 'Gratis spins casino', offers: { price: '50.00' } },
          { name: 'Stortingsbonus bet365', offers: { price: '100.00' } },
        ],
      },
    ],
  });
  const { result } = await analyse(html, new Map());
  assert.deepEqual(result.menuContexts, []);
  assert.ok(result.limitations.some((line) => line.includes('content_not_menu_suspected')));
});

test('the evidence gate drops items without locator/support and keeps the menu consistent', () => {
  const menus = [
    {
      contextSlug: 'menukaart',
      sourceId: 'source-2',
      sourceUrl: 'https://fictief.example/menu',
      categories: [
        {
          name: 'Warm',
          items: [
            { name: 'Bewezen gerecht', price: '9,50', evidence: { locator: 'html>ul>li[1]', quote: 'Bewezen gerecht 9,50' } },
            { name: 'Onbewezen gerecht', price: '8,50' },
            { name: 'Alleen locator', price: '7,50', evidence: { locator: 'html>ul>li[3]' } },
          ],
        },
        { name: 'Leeg', items: [{ name: 'Ook onbewezen', price: '6,00' }] },
      ],
    },
  ];
  const gate = applyItemEvidenceGate(menus);
  assert.equal(gate.droppedCount, 3);
  assert.equal(menus.length, 1);
  assert.deepEqual(menus[0].categories.map((category) => category.name), ['Warm']);
  assert.deepEqual(menus[0].categories[0].items.map((item) => item.name), ['Bewezen gerecht']);
  assert.deepEqual(gate.dropped.map((row) => row.name), ['Onbewezen gerecht', 'Alleen locator', 'Ook onbewezen']);
});


test('a menu hub without keywords on its children is followed one level deep', async () => {
  const home = `<html><body><nav><a href="/gerechten">Gerechten</a></nav><h1>Fictief</h1></body></html>`;
  const hub = `<html><body><h1>Gerechten</h1>
    <a href="/gerechten/basisgerechten">Basisgerechten</a>
    <a href="/gerechten/combi-maaltijden">Combi Maaltijden</a>
    <a href="/gerechten/soepen">Soepen</a>
    <a href="/blog/kerstmenu-2025">Lees ons kerstmenu blog</a>
  </body></html>`;
  const plan = new Map([
    [`${HOME}gerechten`, hub],
    [`${HOME}gerechten/basisgerechten`, menuPage(['Fictieve nasi', 'Fictieve bami', 'Fictief broodje'])],
    [`${HOME}gerechten/combi-maaltijden`, menuPage(['Fictieve combi een', 'Fictieve combi twee', 'Fictieve combi drie'])],
    [`${HOME}gerechten/soepen`, menuPage(['Fictieve soep een', 'Fictieve soep twee', 'Fictieve soep drie'])],
  ]);
  const { result, fetched } = await analyse(home, plan);
  assert.deepEqual(fetched, [
    `${HOME}gerechten`,
    `${HOME}gerechten/basisgerechten`,
    `${HOME}gerechten/combi-maaltijden`,
    `${HOME}gerechten/soepen`,
  ]);
  assert.equal(result.menuContexts.length, 3);
  assert.equal(result.menuContexts.reduce((n, menu) => n + menu.categories.reduce((m, c) => m + c.items.length, 0), 0), 9);
});

test('a single same-host PDF menu link on a read page is followed', async () => {
  const home = `<html><body><a href="/menu">Menu</a></body></html>`;
  const menu = `<html><body><h1>Afhaalmenu</h1>
    <a href="/files/afhaalmenu-2026.pdf">MENU NIEUW CONCEPT AFHAAL</a>
  </body></html>`;
  const plan = new Map([[`${HOME}menu`, menu]]);
  const { fetched } = await analyse(home, plan);
  assert.deepEqual(fetched, [`${HOME}menu`, `${HOME}files/afhaalmenu-2026.pdf`]);
});

test('an image-only menu is named as such, never guessed or OCR-read', async () => {
  const home = `<html><body><a href="/menukaart">Menukaart</a></body></html>`;
  const menu = `<html><body><h1>Menukaart</h1>
    <img src="/uploads/Menukaart0826a.jpg" alt="Menukaart pagina 1">
    <img src="/uploads/Menukaart0826b.jpg" alt="Menukaart pagina 2">
  </body></html>`;
  const { result } = await analyse(home, new Map([[`${HOME}menukaart`, menu]]));
  assert.equal(result.menuContexts.length, 0);
  assert.ok(result.limitations.some((line) => /alleen als afbeelding/.test(line) && /OCR/.test(line)));
});

test('a PDF menu on another host is reported, never fetched around the source scope', async () => {
  const home = `<html><body><a href="/menu">Menu</a></body></html>`;
  const menu = `<html><body><h1>Menu</h1>
    <a href="https://static.elders.example/lunchkaart.pdf">Lunch</a>
    <a href="https://static.elders.example/dinerkaart.pdf">Dinner</a>
  </body></html>`;
  const { result, fetched } = await analyse(home, new Map([[`${HOME}menu`, menu]]));
  assert.deepEqual(fetched, [`${HOME}menu`]);
  assert.equal(result.menuContexts.length, 0);
  assert.ok(result.limitations.some((line) => /andere host/.test(line) && /static\.elders\.example/.test(line)));
});

test('a source that reports its own closure is reported honestly, without a menu guess', async () => {
  const home = `<html><body><p>Na zes jaar heeft Fictief Restaurant per 27 december haar deuren gesloten.</p></body></html>`;
  const { result } = await analyse(home, new Map());
  assert.equal(result.menuContexts.length, 0);
  assert.ok(result.limitations.some((line) => /gesloten/.test(line)));
  assert.ok(result.limitations.some((line) => /Geen menukaart gevonden/.test(line)));
});
