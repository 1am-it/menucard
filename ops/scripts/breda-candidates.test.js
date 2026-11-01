'use strict';

// BE-72 (#178) — offline regressions for the Breda candidate working list.
// The Overpass answer comes from a committed fixture; nothing here touches the
// network, writes a file or reads a restaurant website.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseOverpassResponse, OVERPASS_USER_AGENT, BREDA_BOUNDS } = require('../../src/lib/osmSource');
const {
  CANDIDATE_AMENITIES,
  DISTANCE_RINGS,
  MISSING_CUISINE_BONUS_METERS,
  OUTPUT_ATTRIBUTION,
  isChain,
  isGone,
  usableWebsite,
  cuisineTokensOf,
  ringOf,
  rawTagsByOsmId,
  selectCandidates,
  dedupeCandidates,
  rankCandidates,
  summarize,
  buildOutput,
  renderReport,
  fetchWithRawTags,
} = require('./breda-candidates');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'breda-candidates-overpass.json');
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const RESTAURANTS = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'restaurants.json'), 'utf8'));

/** The fixture plus the real 25 restaurants, filtered, deduplicated and ranked. */
function selection({ restaurants = RESTAURANTS, payload = FIXTURE } = {}) {
  return selectCandidates({
    businesses: parseOverpassResponse(payload),
    rawTags: rawTagsByOsmId(payload),
    restaurants,
  });
}

function names(list) {
  return list.map((candidate) => candidate.name);
}

test('the fixture is read with the existing parser and our three amenities', () => {
  const businesses = parseOverpassResponse(FIXTURE);
  assert.ok(businesses.length > 0, 'the fixture yields businesses');
  assert.equal(parseOverpassResponse(null).length, 0);
  const kinds = new Set(businesses.map((business) => business.kind));
  assert.ok(kinds.has('restaurant') && kinds.has('fast_food') && kinds.has('cafe'));
  assert.ok(kinds.has('bar'), 'a bar reaches the filter, so the filter is what drops it');
  assert.deepEqual([...CANDIDATE_AMENITIES], ['restaurant', 'fast_food', 'cafe']);
});

test('filter: a keten with brand or brand:wikidata does not become a candidate', () => {
  assert.equal(isChain({ brand: 'Big Chain' }), true);
  assert.equal(isChain({ 'brand:wikidata': 'Q000000' }), true);
  assert.equal(isChain({ brand: '   ' }), false);
  assert.equal(isChain({}), false);
  const { candidates, rejected } = selection();
  assert.equal(rejected.chain, 2, 'the two chain elements are counted');
  assert.ok(!names(candidates).includes('Big Chain Burger'));
  assert.ok(!names(candidates).includes('Koffiehuis Centraal'));
});

test('filter: no website, or a website that is not a usable address', () => {
  assert.equal(usableWebsite({ website: 'https://example.nl' }), 'https://example.nl/');
  assert.equal(usableWebsite({ 'contact:website': 'https://example.nl/kaart' }), 'https://example.nl/kaart');
  assert.equal(usableWebsite({}), null);
  assert.equal(usableWebsite({ website: 'n/a' }), null);
  assert.equal(usableWebsite({ url: 'https://example.nl' }), null, 'url is not one of the two allowed tags');
  const { candidates, rejected } = selection();
  assert.equal(rejected.noWebsite, 2, 'one without any website tag, one with "n/a"');
  assert.ok(!names(candidates).includes('Zonder Site'));
  assert.ok(!names(candidates).includes('Buiten Beeld'));
  assert.ok(candidates.every((candidate) => candidate.website && candidate.websiteHost));
});

test('filter: `disused:`/`was:`/closed and another kind stay out', () => {
  assert.equal(isGone({ 'disused:amenity': 'restaurant' }), true);
  assert.equal(isGone({ 'was:amenity': 'restaurant' }), true);
  assert.equal(isGone({ opening_hours: 'closed' }), true);
  assert.equal(isGone({ opening_hours: 'Mo-Su 12:00-22:00' }), false);
  assert.equal(isGone({}), false);
  const { candidates, rejected } = selection();
  assert.equal(rejected.gone, 3, 'disused:, was: and opening_hours=closed');
  assert.equal(rejected.otherKind, 1, 'the bar');
  for (const gone of ['De Gesloten Deur', 'Was Eens', 'Koffie Enzo', 'Café Zonder Website']) {
    assert.ok(!names(candidates).includes(gone), `${gone} is not a candidate`);
  }
});

test('filter: a place already on the site stays out, by normalized name and by host', () => {
  const { candidates, rejected } = selection();
  assert.equal(rejected.alreadyOnSite, 2);
  assert.ok(!names(candidates).includes('Wolfslaar'), 'same normalized name as Restaurant Wolfslaar');
  assert.ok(!names(candidates).includes('Al Dente'), 'host aldentebreda.nl is already on the site');
  const knownHosts = new Set(
    Object.values(RESTAURANTS).map((restaurant) => new URL(restaurant.website).hostname.replace(/^www\./, '')),
  );
  for (const candidate of candidates) {
    assert.ok(!knownHosts.has(candidate.websiteHost), `${candidate.name} has a new host`);
  }
});

test('de ontdubbeling: one entry per comparable name plus host, the nearest wins', () => {
  const duplicate = {
    osmId: 'node/1',
    name: 'Restaurant Test',
    website: 'https://www.test.example/',
    websiteHost: 'test.example',
    address: 'Straat 1',
    distanceMeters: 900,
  };
  const sameNearer = { ...duplicate, osmId: 'node/2', name: 'Test', distanceMeters: 100 };
  const otherPlace = { ...duplicate, osmId: 'node/3', name: 'Test', website: 'https://other.example/', websiteHost: 'other.example' };
  const deduped = dedupeCandidates([duplicate, sameNearer, otherPlace]);
  assert.equal(deduped.length, 2, 'the same name on the same host is one place');
  assert.deepEqual(deduped.map((candidate) => candidate.osmId).sort(), ['node/2', 'node/3']);

  const { candidates, rejected } = selection();
  assert.equal(rejected.duplicate, 1, 'the node and the way for De Nieuwe Markt are one candidate');
  const markt = candidates.filter((candidate) => candidate.name === 'De Nieuwe Markt');
  assert.equal(markt.length, 1);
  assert.equal(markt[0].osmId, 'node/1011', 'the nearest of the two mappings is kept');
});

test('de rangorde: distance first, with a documented head start for a missing cuisine', () => {
  const baseline = { cuisineTokens: new Set(['italian']) };
  const known = { osmId: 'node/1', name: 'Bekend', cuisine: 'italian', distanceMeters: 300, websiteHost: 'a.example' };
  const missing = { osmId: 'node/2', name: 'Nieuw', cuisine: 'ethiopian', distanceMeters: 600, websiteHost: 'b.example' };
  const far = { osmId: 'node/3', name: 'Ver', cuisine: 'italian', distanceMeters: 5000, websiteHost: 'c.example' };
  const noCoordinates = { osmId: 'node/4', name: 'Zonder punt', cuisine: 'ethiopian', distanceMeters: null, websiteHost: 'd.example' };

  const ranked = rankCandidates([known, missing, far, noCoordinates], baseline);
  assert.deepEqual(ranked.map((candidate) => candidate.osmId), ['node/2', 'node/1', 'node/3', 'node/4']);
  assert.deepEqual(ranked.map((candidate) => candidate.rank), [1, 2, 3, 4]);
  assert.equal(ranked[0].cuisineIsNew, true);
  assert.equal(ranked[0].rankScore, 600 - MISSING_CUISINE_BONUS_METERS);
  assert.equal(ranked[1].cuisineIsNew, false);
  assert.equal(ranked[1].rankScore, 300);
  assert.equal(ranked[3].rankScore, null, 'no coordinates means no score and the last place');
  assert.equal(ranked[0].missingCuisines.join(','), 'ethiopian');

  // A cuisine the 25 already have gets no head start at all.
  const twoKnown = rankCandidates([
    { osmId: 'node/5', name: 'Dichtbij', cuisine: 'italian', distanceMeters: 400 },
    { osmId: 'node/6', name: 'Verder', cuisine: 'italian', distanceMeters: 800 },
  ], baseline);
  assert.deepEqual(twoKnown.map((candidate) => candidate.osmId), ['node/5', 'node/6']);
});

test('de rangorde van de echte fixture gebruikt de 25 als maatstaf', () => {
  const { candidates } = selection();
  assert.deepEqual(candidates.map((candidate) => candidate.osmId), [
    'node/1015',
    'node/1011',
    'node/1008',
    'node/1009',
    'way/1019',
    'node/1010',
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.cuisineIsNew), [true, false, true, false, false, true]);
  const distances = candidates.map((candidate) => candidate.distanceMeters);
  assert.deepEqual(distances.map((distance) => ringOf(distance)), ['lt1km', 'lt1km', 'lt1km', '1to2km', '1to2km', 'gt2km']);
  assert.ok(distances.every((distance) => typeof distance === 'number' && distance >= 0));
  assert.ok(distances.filter((distance) => distance > 0).length >= 5, 'every candidate has a real distance');
  assert.equal(candidates[0].missingCuisines.join(','), 'snack');
  assert.equal(candidates[2].missingCuisines.join(','), 'seafood');
  assert.equal(candidates[5].missingCuisines.join(','), 'vegan');
  assert.deepEqual(candidates[4].missingCuisines, [], 'a candidate without cuisine claims nothing');
  assert.equal(candidates[4].cuisineIsNew, false);
});


test('de vorm van de uitvoer: velden per kandidaat, aantallen en bronvermelding', () => {
  const { candidates, rejected } = selection();
  const output = buildOutput({ candidates, rejected, fetchedAt: '2026-11-01T10:00:00.000Z' });
  assert.equal(output.ticket, 'BE-72 (#178)');
  assert.equal(output.fetchedAt, '2026-11-01T10:00:00.000Z');
  assert.equal(output.attribution, OUTPUT_ATTRIBUTION);
  assert.match(output.attribution, /OpenStreetMap-bijdragers, ODbL/);
  assert.deepEqual(output.source.bounds, { ...BREDA_BOUNDS });
  assert.equal(output.ranking.missingCuisineBonusMeters, MISSING_CUISINE_BONUS_METERS);
  assert.deepEqual(output.counts.perKind, { restaurant: 4, fast_food: 1, cafe: 1 });
  assert.deepEqual(output.counts.perRing, { lt1km: 3, '1to2km': 2, gt2km: 1, onbekend: 0 });
  assert.equal(output.counts.total, 6);
  assert.equal(output.counts.rejected.duplicate, 1);
  assert.deepEqual(output.counts.newCuisines, [
    { cuisine: 'seafood', count: 1 },
    { cuisine: 'snack', count: 1 },
    { cuisine: 'vegan', count: 1 },
  ]);
  for (const candidate of output.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), [
      'address', 'cuisine', 'cuisineIsNew', 'distanceMeters', 'distanceRing', 'kind', 'lat', 'lon',
      'missingCuisines', 'name', 'openingHours', 'osmId', 'osmType', 'phone', 'rank', 'rankScore',
      'website', 'websiteHost',
    ].sort());
    assert.ok(['node', 'way', 'relation'].includes(candidate.osmType));
    assert.match(candidate.osmId, /^(node|way|relation)\/\d+$/);
    assert.equal(typeof candidate.lat, 'number');
    assert.equal(typeof candidate.lon, 'number');
    assert.match(candidate.website, /^https?:\/\//);
  }
  const phoneAndHours = output.candidates.find((candidate) => candidate.osmId === 'node/1011');
  assert.equal(phoneAndHours.phone, '+31 76 100 20 02', 'contact:phone survives the parse step');
  const withHours = output.candidates.find((candidate) => candidate.osmId === 'node/1008');
  assert.equal(withHours.openingHours, 'Tu-Su 17:00-23:00');
  assert.equal(withHours.address, null, 'no addr:* in the fixture means an honest null');
});

test('het rapport noemt de aantallen, de ringen, de top en de nieuwe keukens', () => {
  const { candidates, rejected } = selection();
  const report = renderReport(buildOutput({ candidates, rejected, fetchedAt: '2026-11-01T10:00:00.000Z' }));
  assert.match(report, /^# Werklijst van Bredase restaurants uit OpenStreetMap/);
  assert.match(report, /\| restaurant \| 4 \|/);
  assert.match(report, /\| < 1 km \| 3 \|/);
  assert.match(report, /\| 1-2 km \| 2 \|/);
  assert.match(report, /\| > 2 km \| 1 \|/);
  assert.match(report, /© OpenStreetMap-bijdragers, ODbL/);
  assert.match(report, /\| 1 \| Frituur Breda \| snack \| \d+ m \| frituurbreda\.example \|/);
  assert.match(report, /Ontbrekende keukens die de lijst toevoegt/);
  for (const ring of DISTANCE_RINGS) assert.ok(report.includes(ring.label), `${ring.label} is in the report`);
});

test('de top 100 is een tabel van honderd regels, ook bij meer kandidaten', () => {
  const many = Array.from({ length: 130 }, (_unused, index) => ({
    rank: index + 1,
    osmId: `node/${2000 + index}`,
    osmType: 'node',
    name: `Zaak ${index + 1}`,
    kind: 'restaurant',
    cuisine: 'italian',
    website: `https://zaak${index + 1}.example/`,
    websiteHost: `zaak${index + 1}.example`,
    distanceMeters: 100 + index,
    distanceRing: ringOf(100 + index),
    cuisineIsNew: false,
    missingCuisines: [],
    rankScore: 100 + index,
  }));
  const report = renderReport(buildOutput({ candidates: many, rejected: {}, fetchedAt: '2026-11-01T10:00:00.000Z' }));
  const tableRows = report.split('\n').filter((line) => /^\| \d+ \| Zaak \d+ \|/.test(line));
  assert.equal(tableRows.length, 100);
  assert.match(tableRows[0], /^\| 1 \| Zaak 1 \|/);
  assert.match(tableRows[99], /^\| 100 \| Zaak 100 \|/);
});

test('één verzoek door de bestaande helper, met de bestaande grens en user-agent', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => FIXTURE };
  };
  const result = await fetchWithRawTags({ fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, 'exactly one request');
  assert.equal(calls[0].init.headers['User-Agent'], OVERPASS_USER_AGENT);
  const query = new URL(calls[0].url).searchParams.get('data');
  assert.match(query, new RegExp(`${BREDA_BOUNDS.south},${BREDA_BOUNDS.west},${BREDA_BOUNDS.north},${BREDA_BOUNDS.east}`));
  assert.equal(result.businesses.length, parseOverpassResponse(FIXTURE).length);
  assert.equal(result.payload.elements.length, FIXTURE.elements.length, 'the raw answer is kept for phone and opening_hours');
  const tags = rawTagsByOsmId(result.payload);
  assert.equal(tags.get('node/1011')['contact:website'], 'https://deniewemarkt.example/reserveren');
});

test('een onbereikbare Overpass geeft een eerlijke fout en schrijft niets', async () => {
  const failing = async () => {
    throw new Error('offline');
  };
  const result = await fetchWithRawTags({ fetchImpl: failing });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'osm_unreachable');
  assert.equal(result.payload, null);
});

test('keukenwoorden: Nederlands wordt het OSM-woord, weekdagen tellen niet mee', () => {
  assert.deepEqual(cuisineTokensOf('Modern Frans · Fine Dining'), ['modern', 'french', 'fine', 'dining']);
  assert.deepEqual(cuisineTokensOf('dinsdag woensdag zaterdag'), []);
  assert.deepEqual(cuisineTokensOf('Italiaans;Pizza'), ['italian', 'pizza']);
  assert.deepEqual(cuisineTokensOf(null), []);
  const { candidates } = selection();
  const italian = candidates.find((candidate) => candidate.name === 'De Nieuwe Markt');
  assert.deepEqual(italian.cuisineTokens, ['italian'], 'cuisine "italian" of node/1011');
  assert.equal(summarize(candidates, {}).newCuisines.length, 3);
});

