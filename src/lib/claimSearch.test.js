'use strict';

// BE-54 (#133) — regressies voor de zoekregel van /mijn-restaurant/claimen.
//
// Twee soorten bewijs:
//   1. de regels zelf, op kleine fixtures (naam, straat, buurt, hoofdletters,
//      leeg, maximum 20);
//   2. een vergelijking met de bestaande zoeklogica: dezelfde zoektermen tegen
//      src/services/restaurantIndex.js op de echte data (data/restaurants.json)
//      moeten dezelfde restaurants opleveren. Zo blijft "dezelfde gegevens en
//      dezelfde zoeklogica als Alle restaurants" aantoonbaar en niet alleen
//      beweerd.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CLAIM_SEARCH_MESSAGES,
  MAX_CLAIM_RESULTS,
  claimResultRow,
  claimResultRows,
  claimResultStatus,
  contactMailto,
  countClaimMatches,
  matchClaimRestaurants,
  normalizeClaimQuery,
} = require('./claimSearch');
const { searchRestaurants } = require('../services/restaurantIndex');

const RESTAURANTS = [
  { restaurantId: '1', name: 'Restaurant Wolfslaar', address: 'Wolfslaardreef 100, 4834 SP Breda', buurt: 'Wolfslaar' },
  { restaurantId: '2', name: 'De Haagdijk', address: 'Haagdijk 12, 4811 TV Breda', buurt: 'Centrum' },
  { restaurantId: '3', name: 'T-Huis', address: null, buurt: 'Ginneken' },
];

const ids = (rows) => rows.map((restaurant) => restaurant.restaurantId);

test('claimSearch: zoeken op naam is hoofdletterongevoelig', () => {
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'wolfslaar')), ['1']);
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'WOLFSLAAR')), ['1']);
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'Restaurant Wolfslaar')), ['1']);
  // Een deel van de naam is genoeg.
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'huis')), ['3']);
});

test('claimSearch: zoeken op straat en op buurt werkt net zo goed', () => {
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'wolfslaardreef')), ['1']);
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'HAAGDIJK 12')), ['2']);
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'ginneken')), ['3']);
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'centrum')), ['2']);
  // Straat én buurt mogen allebei matchen; dat geeft nooit een dubbele regel.
  assert.deepEqual(ids(matchClaimRestaurants(RESTAURANTS, 'haagdijk')), ['2']);
});

test('claimSearch: een lege of te korte zoekterm geeft niets', () => {
  for (const query of ['', '   ', null, undefined, 'a', ' a ']) {
    assert.deepEqual(matchClaimRestaurants(RESTAURANTS, query), [], `zoekterm ${JSON.stringify(query)}`);
    assert.equal(countClaimMatches(RESTAURANTS, query), 0);
  }
  assert.equal(normalizeClaimQuery('  Breda  '), 'Breda');
  assert.deepEqual(matchClaimRestaurants(null, 'breda'), []);
  assert.deepEqual(matchClaimRestaurants(RESTAURANTS, 'onbekend'), []);
});

test('claimSearch: maximaal 20 resultaten, ook als er meer treffers zijn', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    restaurantId: String(index + 1),
    name: `Breda Restaurant ${String(index + 1).padStart(2, '0')}`,
    address: `Bredalaan ${index + 1}`,
    buurt: 'Centrum',
  }));

  const matched = matchClaimRestaurants(many, 'breda');
  assert.equal(MAX_CLAIM_RESULTS, 20);
  assert.equal(matched.length, MAX_CLAIM_RESULTS);
  assert.equal(countClaimMatches(many, 'breda'), 30, 'de telling blijft het echte aantal');
  // De eerste 20 in de volgorde van de bestaande zoeklogica (alfabetisch op naam).
  assert.deepEqual(ids(matched), many.slice(0, 20).map((restaurant) => restaurant.restaurantId));
});

test('claimSearch: naam gaat voor buurt, buurt gaat voor straat', () => {
  const list = [
    { restaurantId: 'a', name: 'Iets anders', address: 'Elders 1', buurt: 'Centrum' },
    { restaurantId: 'b', name: 'Ander adres', address: 'Centrumlaan 2', buurt: 'Elders' },
    { restaurantId: 'c', name: 'Centrum Café', address: 'Laan 3', buurt: 'Elders' },
  ];
  assert.deepEqual(ids(matchClaimRestaurants(list, 'centrum')), ['c', 'a', 'b']);
});

test('claimSearch: een regel toont naam, adres en buurt en linkt naar /claim/[id]', () => {
  const row = claimResultRow(RESTAURANTS[0]);
  assert.equal(row.name, 'Restaurant Wolfslaar');
  assert.equal(row.address, 'Wolfslaardreef 100, 4834 SP Breda');
  assert.equal(row.buurt, 'Wolfslaar');
  assert.equal(row.detail, 'Wolfslaardreef 100, 4834 SP Breda · Wolfslaar');
  assert.equal(row.claimHref, '/claim/1');
  assert.equal(row.claimLabel, CLAIM_SEARCH_MESSAGES.claimButton);

  // Zonder adres blijft de regel bruikbaar, met de buurt.
  const bare = claimResultRow(RESTAURANTS[2]);
  assert.equal(bare.address, null);
  assert.equal(bare.detail, 'Ginneken');
  assert.equal(bare.claimHref, '/claim/3');

  // Geen claimstatus in een regel (contractpunt 5): alleen deze velden.
  assert.deepEqual(Object.keys(row).sort(), [
    'address', 'buurt', 'claimHref', 'claimLabel', 'detail', 'name', 'restaurantId',
  ]);
  assert.deepEqual(ids(claimResultRows(RESTAURANTS, 'breda')), ['2', '1']);
});

test('claimSearch: de tekst met role="status" telt eerlijk', () => {
  assert.equal(claimResultStatus('', { matched: 0, shown: 0 }), CLAIM_SEARCH_MESSAGES.typeToSearch);
  assert.equal(claimResultStatus('a', { matched: 0, shown: 0 }), CLAIM_SEARCH_MESSAGES.typeToSearch);
  assert.equal(claimResultStatus('xyz', { matched: 0, shown: 0 }), CLAIM_SEARCH_MESSAGES.noneFound);
  assert.equal(claimResultStatus('wolfslaar', { matched: 1, shown: 1 }), '1 restaurant gevonden.');
  assert.equal(claimResultStatus('breda', { matched: 2, shown: 2 }), '2 restaurants gevonden.');
  assert.equal(claimResultStatus('breda', { matched: 30, shown: 20 }), 'Eerste 20 van 30 restaurants.');
});

test('claimSearch: zonder NEXT_PUBLIC_CONTACT_EMAIL geen mailto, met een adres wel', () => {
  for (const value of [undefined, null, '', '   ', 'geen-adres']) {
    assert.equal(contactMailto(value), null, `waarde ${JSON.stringify(value)}`);
  }
  assert.equal(contactMailto(' hallo@bredaeats.nl '), 'mailto:hallo@bredaeats.nl');
  // De variabele is hier niet gezet: er komt geen verzonnen adres.
  assert.equal(contactMailto(process.env.NEXT_PUBLIC_CONTACT_EMAIL), null);
});

test('claimSearch: dezelfde zoektermen geven dezelfde restaurants als de bestaande zoeklogica', () => {
  // De volledige catalogus zoals /alle-restaurants hem laadt (zelfde API, zelfde
  // paginering). Sinds BE-75 (#187) telt de echte data 21 restaurants; één pagina
  // van 50 is genoeg, de lus blijft toch staan voor het geval de catalogus groeit.
  const first = searchRestaurants({ limit: 50 });
  const catalog = [...first.results];
  let cursor = first.nextCursor;
  while (cursor != null) {
    const page = searchRestaurants({ cursor, limit: 50 });
    catalog.push(...page.results);
    cursor = page.nextCursor;
  }
  assert.ok(catalog.length > 20, 'de echte catalogus is groter dan één pagina');

  const queries = ['wolfslaar', 'Wolfslaar', 'haagdijk', 'dreef', 'breda', 'centrum', 'straat', 'onbekendxyz'];
  for (const query of queries) {
    const expected = searchRestaurants({ q: query, limit: 50 }).results
      .map((restaurant) => restaurant.restaurantId)
      .slice(0, MAX_CLAIM_RESULTS);
    const actual = matchClaimRestaurants(catalog, query).map((restaurant) => restaurant.restaurantId);
    assert.deepEqual(actual, expected, `zoekterm "${query}"`);
  }
});


