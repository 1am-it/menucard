'use strict';

// BE-32 (#75) — OpenStreetMap: query, parsing, linking and "Nieuw gevonden".
// Fictional businesses only; no network, no Supabase, no browser.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  OSM_ATTRIBUTION,
  OVERPASS_ENDPOINT,
  OSM_CACHE_SECONDS,
  OVERPASS_USER_AGENT,
  BREDA_BOUNDS,
  FOOD_AMENITIES,
  buildOverpassQuery,
  normalizeBusinessName,
  comparableBusinessName,
  normalizePostcode,
  canonicalWebsite,
  distanceMeters,
  parseOverpassResponse,
  businessKindLabel,
  osmStorageKey,
  osmIdFromStorageKey,
  osmObjectUrl,
  matchOsmBusiness,
  unknownBusinesses,
  businessAddressLabel,
  addFormHref,
} = require('./osmSource');

function overpassPayload() {
  return {
    elements: [
      {
        type: 'node',
        id: 101,
        lat: 51.5891,
        lon: 4.7755,
        tags: {
          amenity: 'restaurant',
          name: 'Trattoria Voorbeeld',
          'addr:street': 'Havermarkt',
          'addr:housenumber': '1',
          'addr:postcode': '4811 WJ',
          'addr:city': 'Breda',
          website: 'https://trattoria-voorbeeld.example/menu?utm=1#top',
          cuisine: 'italian;pizza',
          phone: '+31 76 000 0000',
          email: 'magazijn@trattoria-voorbeeld.example',
          opening_hours: 'Mo-Su 12:00-22:00',
        },
      },
      {
        type: 'way',
        id: 202,
        center: { lat: 51.5901, lon: 4.7761 },
        tags: {
          amenity: 'cafe',
          name: 'Café Voorbeeld',
          'addr:street': 'Grote Markt',
          'addr:housenumber': '4',
          'addr:postcode': '4811 XS',
          'addr:city': 'Breda',
          'contact:website': 'https://cafe-voorbeeld.example/',
          phone: '+31 76 111 1111',
        },
      },
      { type: 'node', id: 303, lat: 51.59, lon: 4.77, tags: { amenity: 'bakery', name: 'Bakkerij Voorbeeld' } },
      { type: 'node', id: 404, lat: 51.59, lon: 4.77, tags: { amenity: 'supermarket', name: 'Super Voorbeeld' } },
      { type: 'node', id: 505, lat: 51.59, lon: 4.77, tags: { amenity: 'restaurant' } },
      { type: 'node', id: 606, lat: 51.59, lon: 4.77, tags: { amenity: 'bar', name: 'Café Voorbeeld' } },
      { type: 'node', id: 101, lat: 51.5891, lon: 4.7755, tags: { amenity: 'restaurant', name: 'Trattoria Voorbeeld' } },
      null,
    ],
  };
}

test('osm: the query is bounded to Breda and asks only for food businesses with tags', () => {
  const query = buildOverpassQuery();
  assert.match(query, /\[out:json\]\[timeout:25\];/);
  assert.match(query, new RegExp(`\\(${BREDA_BOUNDS.south},${BREDA_BOUNDS.west},${BREDA_BOUNDS.north},${BREDA_BOUNDS.east}\\)`));
  for (const amenity of FOOD_AMENITIES) assert.match(query, new RegExp(amenity));
  assert.match(query, /node\["amenity"/);
  assert.match(query, /way\["amenity"/);
  assert.match(query, /out center tags \d+;/);
  assert.equal(OVERPASS_ENDPOINT, 'https://overpass-api.de/api/interpreter');
  assert.equal(OSM_CACHE_SECONDS, 86400, 'one request per 24 hours');
  assert.match(OVERPASS_USER_AGENT, /OnzeMenukaarten-SourceDiscovery/);
  assert.equal(OSM_ATTRIBUTION, '© OpenStreetMap-bijdragers');
});

test('osm: parsing keeps name, address, website and kind — and never personal data', () => {
  const businesses = parseOverpassResponse(overpassPayload());
  assert.equal(businesses.length, 3, 'two named food businesses plus the second "Café Voorbeeld" bar');
  const trattoria = businesses.find((b) => b.osmId === 'node/101');
  assert.equal(trattoria.name, 'Trattoria Voorbeeld');
  assert.equal(trattoria.address, 'Havermarkt 1, 4811 WJ Breda');
  assert.equal(trattoria.postcode, '4811WJ');
  assert.equal(trattoria.website, 'https://trattoria-voorbeeld.example/menu', 'query and fragment are dropped');
  assert.equal(trattoria.kind, 'restaurant');
  assert.equal(trattoria.attribution, OSM_ATTRIBUTION);
  assert.deepEqual(Object.keys(trattoria).sort(), [
    'address',
    'attribution',
    'cuisine',
    'kind',
    'lat',
    'lon',
    'name',
    'osmId',
    'osmRef',
    'osmType',
    'postcode',
    'website',
  ]);
  assert.equal(JSON.stringify(businesses).includes('076 000'), false, 'no phone number is kept');
  assert.equal(JSON.stringify(businesses).includes('magazijn@'), false, 'no e-mail address is kept');
  assert.equal(JSON.stringify(businesses).includes('Mo-Su'), false, 'no opening hours are kept');
  const cafe = businesses.find((b) => b.osmId === 'way/202');
  assert.equal(cafe.lat, 51.5901, 'a way uses its center');
  assert.equal(cafe.website, 'https://cafe-voorbeeld.example/', 'contact:website is accepted');
});

test('osm: names compare without kind words, accents or punctuation', () => {
  assert.equal(normalizeBusinessName('  Café  De Beyerd! '), 'cafe de beyerd');
  assert.equal(comparableBusinessName('Restaurant Wolfslaar'), comparableBusinessName('Wolfslaar'));
  assert.equal(comparableBusinessName('Café De Beyerd'), comparableBusinessName('De Beyerd'));
  assert.equal(comparableBusinessName('Brasserie & Bar Voorbeeld'), 'voorbeeld');
  assert.equal(comparableBusinessName('Bar'), 'bar', 'a name that is only a kind word is kept');
  assert.equal(comparableBusinessName(''), '');
  assert.equal(normalizePostcode('4834 SP'), '4834SP');
  assert.equal(normalizePostcode('4834sp'), '4834SP');
  assert.equal(normalizePostcode('niet een postcode'), '');
});

test('osm: canonicalWebsite only keeps http(s) without query or fragment', () => {
  assert.equal(canonicalWebsite('https://example.nl/menu/?a=1#x'), 'https://example.nl/menu');
  assert.equal(canonicalWebsite('http://example.nl'), 'http://example.nl/');
  assert.equal(canonicalWebsite('ftp://example.nl/menu'), null);
  assert.equal(canonicalWebsite('example.nl'), null);
  assert.equal(canonicalWebsite(''), null);
});

function business(overrides) {
  return {
    osmId: 'node/1',
    osmType: 'node',
    osmRef: 1,
    name: 'Voorbeeld',
    address: 'Straat 1, 4811 AA Breda',
    postcode: '4811AA',
    website: 'https://voorbeeld.example',
    kind: 'restaurant',
    cuisine: null,
    lat: 51.5891,
    lon: 4.7755,
    attribution: OSM_ATTRIBUTION,
    ...overrides,
  };
}

test('osm: a restaurant links by comparable name plus postcode', () => {
  const restaurant = { name: 'Restaurant Voorbeeld', address: 'Straat 1, 4811 AA Breda' };
  const result = matchOsmBusiness(restaurant, [business({})]);
  assert.equal(result.reason, 'matched');
  assert.equal(result.match.osmId, 'node/1');
});

test('osm: a different postcode means no link, even with the same name', () => {
  const restaurant = { name: 'Voorbeeld', address: 'Elders 9, 4834 SP Breda' };
  const result = matchOsmBusiness(restaurant, [business({})]);
  assert.equal(result.match, null);
  assert.equal(result.reason, 'postcode_mismatch');
  assert.equal(result.candidates.length, 1, 'the candidate is still reported, never silently dropped');
});

test('osm: doubt is no link — two businesses with the same name and postcode', () => {
  const restaurant = { name: 'Voorbeeld', address: 'Straat 1, 4811 AA Breda' };
  const result = matchOsmBusiness(restaurant, [
    business({ osmId: 'node/1' }),
    business({ osmId: 'node/2', lat: 51.5892 }),
  ]);
  assert.equal(result.match, null);
  assert.equal(result.reason, 'ambiguous');
});

test('osm: distance decides when coordinates are known, and too far is no link', () => {
  const restaurant = { name: 'Voorbeeld', address: null, lat: 51.5891, lon: 4.7755 };
  const near = matchOsmBusiness(restaurant, [business({ lat: 51.5892, lon: 4.7756 })]);
  assert.equal(near.reason, 'matched');
  assert.ok(distanceMeters(restaurant, business({ lat: 51.5892, lon: 4.7756 })) <= 150);
  const far = matchOsmBusiness(restaurant, [business({ lat: 51.6, lon: 4.79 })]);
  assert.equal(far.match, null);
  assert.equal(far.reason, 'distance_mismatch');
});

test('osm: no name match or no name at all is never a link', () => {
  assert.equal(matchOsmBusiness({ name: 'Anders' }, [business({})]).reason, 'no_name_match');
  assert.equal(matchOsmBusiness({ name: '' }, [business({})]).reason, 'no_name');
  assert.equal(matchOsmBusiness(null, [business({})]).reason, 'no_name');
});

test('osm: "Nieuw gevonden" excludes links and remembered ignores, sorted by name', () => {
  const restaurants = {
    a: { name: 'Voorbeeld', address: 'Straat 1, 4811 AA Breda' },
  };
  const list = [
    business({ osmId: 'node/1', name: 'Voorbeeld' }),
    business({ osmId: 'node/2', name: 'Zebra' }),
    business({ osmId: 'node/3', name: 'Aap' }),
    business({ osmId: 'node/4', name: 'Beer' }),
  ];
  const unknown = unknownBusinesses({ restaurants, businesses: list, ignoredIds: ['osm-node-2', 'node/4'] });
  assert.deepEqual(unknown.map((b) => b.osmId), ['node/3'], 'node/1 is linked, node/2 and node/4 are ignored');
  assert.deepEqual(unknown.map((b) => b.name), ['Aap']);
  assert.equal(unknownBusinesses({ restaurants, businesses: list }).length, 3);
});

test('osm: storage keys, object URLs and the prefilled add form', () => {
  assert.equal(osmStorageKey('node/101'), 'osm-node-101');
  assert.equal(osmStorageKey('way/202'), 'osm-way-202');
  assert.equal(osmStorageKey('relatie/1'), null);
  assert.equal(osmIdFromStorageKey('osm-node-101'), 'node/101');
  assert.equal(osmIdFromStorageKey('iets-anders'), null);
  assert.equal(osmObjectUrl('node/101'), 'https://www.openstreetmap.org/node/101');
  assert.equal(businessKindLabel(business({ kind: 'restaurant', cuisine: 'italian;pizza' })), 'restaurant · italian');
  assert.equal(businessKindLabel(business({ cuisine: null })), 'restaurant');
  assert.equal(businessAddressLabel(business({ address: null })), 'Geen adres in OpenStreetMap');
  const href = addFormHref(business({ osmId: 'node/101', name: 'Trattoria Voorbeeld' }));
  assert.match(href, /^\/internal\/toevoegen\?/);
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('naam'), 'Trattoria Voorbeeld');
  assert.equal(params.get('adres'), 'Straat 1, 4811 AA Breda');
  assert.equal(params.get('website'), 'https://voorbeeld.example');
  assert.equal(params.get('osm'), 'node/101');
  assert.equal(addFormHref(null), '/internal/toevoegen');
});
