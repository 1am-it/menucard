'use strict';

// BE-32 (#75) — the pure "Vind bronnen" decisions: layer order, platform
// rejection, the quote rule, provenance in the proposal note, and the summary
// the screen shows. Fictional data only; no network, no AI, no database.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  LAYER_ORDER,
  planLayers,
  BLOCKED_PLATFORM_HOSTS,
  ONLY_PLATFORMS_MESSAGE,
  isBlockedPlatformUrl,
  firstAllowedUrl,
  sameSite,
  rankMenuCandidates,
  chooseMenuCandidate,
  validateChoiceAnswer,
  validateSearchAnswer,
  NOTE_MAX,
  originLabel,
  proposalNote,
  parseProposalNote,
  discoveryRow,
  discoverySummary,
  costLine,
  ignoreProposalInput,
  DISCOVERY_MESSAGES,
} = require('./sourceDiscovery');

test('layers: OSM, same host, AI choice and — only without a website — AI search', () => {
  assert.deepEqual(LAYER_ORDER, ['osm', 'same_host', 'ai_choice', 'ai_search']);
  assert.deepEqual(planLayers({ hasWebsite: true }), ['osm', 'same_host', 'ai_choice']);
  assert.deepEqual(planLayers({ hasWebsite: false }), ['osm', 'same_host', 'ai_choice', 'ai_search']);
  assert.deepEqual(planLayers(), ['osm', 'same_host', 'ai_choice', 'ai_search']);
});

test('platforms: delivery and booking platforms are always rejected, on the host and its subdomains', () => {
  for (const url of [
    'https://www.thuisbezorgd.nl/restaurant-x',
    'https://ubereats.com/nl/store/x',
    'https://deliveroo.nl/menu/x',
    'https://www.thefork.nl/restaurant/x',
    'https://www.resengo.com/x',
    'https://formitable.com/x',
    'https://www.google.com/maps/place/x',
    'https://maps.app.goo.gl/x',
    'https://www.tripadvisor.nl/x',
    'https://m.facebook.com/x',
  ]) {
    assert.equal(isBlockedPlatformUrl(url), true, url);
  }
  for (const url of ['https://trattoria-voorbeeld.example', 'https://www.debeyerd.nl/menukaart']) {
    assert.equal(isBlockedPlatformUrl(url), false, url);
  }
  assert.equal(isBlockedPlatformUrl('niet een url'), false);
  assert.equal(firstAllowedUrl(['https://thuisbezorgd.nl/x', 'https://voorbeeld.example/menu']), 'https://voorbeeld.example/menu');
  assert.equal(firstAllowedUrl(['https://thuisbezorgd.nl/x']), null);
  assert.equal(ONLY_PLATFORMS_MESSAGE, 'Alleen bezorgplatforms gevonden (genegeerd)');
  assert.ok(BLOCKED_PLATFORM_HOSTS.includes('thuisbezorgd.nl'));
});

test('same host: a child page is the same website, another domain is not', () => {
  assert.equal(sameSite('https://voorbeeld.example', 'https://www.voorbeeld.example/menukaart'), true);
  assert.equal(sameSite('https://voorbeeld.example', 'https://andere.example/menu'), false);
  assert.equal(sameSite('niet een url', 'https://voorbeeld.example'), false);
});

test('candidates: a menu-ish path comes first, the rest keeps its existing order', () => {
  const candidates = [
    { url: 'https://voorbeeld.example/over-ons', matchedOn: 'Over ons' },
    { url: 'https://voorbeeld.example/menukaart', matchedOn: 'Menukaart' },
    { url: 'https://voorbeeld.example/lunch', matchedOn: 'Lunch' },
  ];
  assert.deepEqual(rankMenuCandidates(candidates).map((c) => c.url), [
    'https://voorbeeld.example/menukaart',
    'https://voorbeeld.example/lunch',
    'https://voorbeeld.example/over-ons',
  ]);
  assert.equal(chooseMenuCandidate(candidates).url, 'https://voorbeeld.example/menukaart');
  assert.equal(chooseMenuCandidate([]), null);
  // A link that only says "Over ons" is not a menu: the AI choice may look at it.
  assert.equal(chooseMenuCandidate([{ url: 'https://voorbeeld.example/over-ons', matchedOn: 'Over ons' }]), null);
  assert.equal(chooseMenuCandidate([{ url: 'https://voorbeeld.example/eten', matchedOn: 'Menukaart' }]).url, 'https://voorbeeld.example/eten');
});

test('AI choice: only a candidate of the same website with a quote that really occurs', () => {
  const website = 'https://voorbeeld.example';
  const candidates = [{ url: 'https://voorbeeld.example/menukaart' }];
  const pageTexts = { 'https://voorbeeld.example/menukaart': 'Onze menukaart met alle gerechten en prijzen.' };
  const good = validateChoiceAnswer(
    { url: 'https://voorbeeld.example/menukaart', quote: 'Onze menukaart met alle gerechten' },
    { website, candidates, pageTexts },
  );
  assert.equal(good.ok, true);
  assert.equal(good.value.quote, 'Onze menukaart met alle gerechten');

  const invented = validateChoiceAnswer(
    { url: 'https://voorbeeld.example/menukaart', quote: 'Wij serveren verse pasta vandaag' },
    { website, candidates, pageTexts },
  );
  assert.equal(invented.ok, false);
  assert.equal(invented.reason, 'quote_not_in_source');

  const otherHost = validateChoiceAnswer(
    { url: 'https://thuisbezorgd.nl/voorbeeld', quote: 'Onze menukaart met alle gerechten' },
    { website, candidates, pageTexts },
  );
  assert.equal(otherHost.ok, false);
  assert.equal(otherHost.reason, 'not_same_host');

  const unknownPage = validateChoiceAnswer(
    { url: 'https://voorbeeld.example/iets-anders', quote: 'Onze menukaart met alle gerechten' },
    { website, candidates, pageTexts },
  );
  assert.equal(unknownPage.ok, false);
  assert.equal(unknownPage.reason, 'not_a_candidate');

  const noQuote = validateChoiceAnswer(
    { url: 'https://voorbeeld.example/menukaart', quote: 'kort' },
    { website, candidates, pageTexts },
  );
  assert.equal(noQuote.ok, false);
  assert.equal(noQuote.reason, 'quote_missing');
});

test('AI search: the first usable result with a source; platforms are dropped, never proposed', () => {
  const answer = {
    results: [
      { url: 'https://www.thuisbezorgd.nl/voorbeeld', title: 'Voorbeeld', source: 'https://www.thuisbezorgd.nl/voorbeeld' },
      { url: 'https://voorbeeld.example', title: 'Voorbeeld', source: 'https://www.kvk.nl/voorbeeld', quote: 'Officiële website van Voorbeeld' },
    ],
  };
  const result = validateSearchAnswer(answer, { name: 'Voorbeeld' });
  assert.equal(result.ok, true);
  assert.equal(result.value.url, 'https://voorbeeld.example');
  assert.equal(result.value.source, 'https://www.kvk.nl/voorbeeld');
  assert.equal(result.value.quote, 'Officiële website van Voorbeeld');
  assert.deepEqual(result.rejected, [{ url: 'https://www.thuisbezorgd.nl/voorbeeld', reason: 'platform' }]);

  const onlyPlatforms = validateSearchAnswer({ results: [{ url: 'https://ubereats.com/x' }] }, { name: 'X' });
  assert.equal(onlyPlatforms.ok, false);
  assert.equal(onlyPlatforms.reason, 'only_rejected');
  assert.equal(validateSearchAnswer({ results: [] }, { name: 'X' }).reason, 'no_results');
  assert.equal(validateSearchAnswer(null, {}).reason, 'no_results');
});

test('provenance: origin, website, menu link, quote and cost fit the existing 280-character note', () => {
  const note = proposalNote({
    origin: 'ai_choice',
    website: 'https://voorbeeld.example',
    menu: 'https://voorbeeld.example/menukaart',
    quote: 'Onze menukaart met alle gerechten',
    costEurCents: 2,
  });
  assert.ok(note.length <= NOTE_MAX, `note is ${note.length}`);
  assert.match(note, /^Herkomst: AI koos de menupagina/);
  const parsed = parseProposalNote(note);
  assert.equal(parsed.origin, 'ai_choice');
  assert.equal(parsed.website, 'https://voorbeeld.example');
  assert.equal(parsed.menu, 'https://voorbeeld.example/menukaart');
  assert.equal(parsed.quote, 'Onze menukaart met alle gerechten');
  assert.equal(parsed.costEurCents, 2);

  const long = proposalNote({
    origin: 'osm',
    website: `https://voorbeeld.example/${'a'.repeat(200)}`,
    menu: `https://voorbeeld.example/${'b'.repeat(200)}`,
    quote: 'x'.repeat(280),
  });
  assert.ok(long.length <= NOTE_MAX, `long note is ${long.length}`);
  assert.match(long, /^Herkomst: OpenStreetMap/);
  assert.equal(parseProposalNote(long).origin, 'osm');

  assert.equal(originLabel('osm'), '🗺️ OpenStreetMap');
  assert.equal(originLabel('same_host'), '🌐 eigen website');
  assert.match(originLabel('ai_choice', { quote: 'Onze kaart' }), /citaat: “Onze kaart”/);
  assert.match(originLabel('ai_search', { source: 'https://kvk.nl/x' }), /bron: https:\/\/kvk\.nl\/x/);
  assert.equal(originLabel('onbekend'), '');
});

test('screens: one result row, the summary line and the cost line, all from the real run', () => {
  const row = discoveryRow({
    restaurantId: 'x',
    name: 'Voorbeeld',
    website: { url: 'https://voorbeeld.example', origin: 'osm' },
    menu: { url: 'https://voorbeeld.example/menukaart', origin: 'osm' },
    origin: 'osm',
    proposal: { id: 'p1', url: 'https://voorbeeld.example/menukaart' },
  });
  assert.equal(row.state, 'certain');
  assert.equal(row.step.key, 'confirm');
  assert.equal(row.url, 'https://voorbeeld.example');
  assert.equal(row.foundUrl, 'https://voorbeeld.example/menukaart');
  assert.match(row.detail, /OpenStreetMap/);

  const empty = discoveryRow({ restaurantId: 'y', name: 'Leeg', message: ONLY_PLATFORMS_MESSAGE });
  assert.equal(empty.state, 'no_menu');
  assert.equal(empty.step.key, 'wait');
  assert.equal(empty.detail, ONLY_PLATFORMS_MESSAGE);

  const results = [
    { website: { url: 'a' }, origin: 'osm' },
    { menu: { url: 'b' }, origin: 'ai_choice' },
    { website: { url: 'c' }, origin: 'ai_search' },
    { message: 'niets' },
  ];
  const summary = discoverySummary({ results, costEurCents: 6 });
  assert.match(summary, /3 websites voorgesteld/);
  assert.match(summary, /🗺️ 1 OpenStreetMap/);
  assert.match(summary, /🤖 1 AI-keuze/);
  assert.match(summary, /🤖 1 AI-zoeken/);
  assert.match(summary, /1 niet gevonden/);
  assert.match(summary, /Alles is een voorstel/);
  assert.match(summary, /Kosten AI: 6 cent\./);

  assert.equal(costLine({ costEurCents: 6, monthly: { remainingEurCents: 962, limitEurCents: 1000 } }), 'Kosten AI: 6 cent van je maandbudget (€ 9,62 over van € 10).');
  assert.equal(costLine({}), 'Kosten AI: niets gemeten voor deze zoekactie.');
});

test('negeren: a remembered ignore is a BE-24 proposal on the OSM key, without a migration', () => {
  const input = ignoreProposalInput({ osmId: 'node/101', name: 'Bakkerij Voorbeeld' });
  assert.equal(input.restaurant_id, 'osm-node-101');
  assert.equal(input.kind, 'mark_unusable');
  assert.equal(input.current_url, 'https://www.openstreetmap.org/node/101');
  assert.equal(input.unusable_reason, 'other_business');
  assert.match(input.note, /Negeren in Nieuw gevonden: Bakkerij Voorbeeld/);
  assert.ok(input.note.length <= NOTE_MAX);
  assert.equal(ignoreProposalInput({ osmId: 'onzin' }), null);
  assert.equal(DISCOVERY_MESSAGES.osm_unreachable, 'OpenStreetMap is nu niet bereikbaar. De andere lagen werken gewoon door.');
});
