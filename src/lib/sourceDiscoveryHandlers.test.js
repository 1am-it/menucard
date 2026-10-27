'use strict';

// BE-32 (#75) — the "Vind bronnen" engine, tested with fakes only: no network,
// no AI call, no Supabase, no browser. What is proven here: the layer order, the
// platform rejection, the required quote, OSM unreachable, AI off, budget
// exhausted, the provenance that is stored, and a remembered "Negeren".

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSourceDiscoveryHandlers, buildChoiceRequest, buildSearchRequest, MAX_RESTAURANTS } = require('./sourceDiscoveryHandlers');

const WEBSITE_RESTAURANT = {
  name: 'Trattoria Voorbeeld',
  address: 'Havermarkt 1, 4811 WJ Breda',
  website: 'https://trattoria-voorbeeld.example',
};
const NO_SITE_RESTAURANT = {
  name: 'Noodlebar Voorbeeld',
  address: 'Ginnekenweg 2, 4812 JC Breda',
  website: null,
};
// No website of our own, but OpenStreetMap knows one: the OSM chain.
const OSM_ONLY_RESTAURANT = {
  name: 'Con Fuego Voorbeeld',
  address: 'Grote Markt 4, 4811 XS Breda',
  website: null,
};

function restaurantsFixture() {
  return { a: WEBSITE_RESTAURANT, b: NO_SITE_RESTAURANT, c: OSM_ONLY_RESTAURANT };
}

function defaultBusinesses() {
  return [
    osmBusiness(),
    osmBusiness({
      osmId: 'node/9',
      name: 'Con Fuego Voorbeeld',
      address: 'Grote Markt 4, 4811 XS Breda',
      postcode: '4811XS',
      website: 'https://confuego-voorbeeld.example',
      lat: 51.589,
      lon: 4.775,
    }),
  ];
}

function osmBusiness(overrides) {
  return {
    osmId: 'node/1',
    name: 'Trattoria Voorbeeld',
    address: 'Havermarkt 1, 4811 WJ Breda',
    postcode: '4811WJ',
    website: 'https://trattoria-voorbeeld.example',
    kind: 'restaurant',
    cuisine: 'italian',
    lat: 51.5891,
    lon: 4.7755,
    attribution: '© OpenStreetMap-bijdragers',
    ...overrides,
  };
}

function request(body) {
  return { json: async () => body };
}

const INTERNAL = { ok: true, roles: [{ role: 'internal' }], userId: 'user-1' };

/**
 * A handler with fakes. `answers` is called with the purpose ('choice' |
 * 'search') and returns the AI output (or throws / stays disabled). Every
 * dependency records what it was asked.
 */
function makeEngine({
  auth = INTERNAL,
  osm = { ok: true, businesses: defaultBusinesses(), fetchedAt: '2026-10-27T08:12:00.000Z' },
  pages = {},
  candidates = [],
  ai = { enabled: true, answers: {} },
  spendRows = [],
  saveResult = { ok: true, id: 'proposal-1' },
} = {}) {
  const calls = { ai: [], saved: [], ignored: [], pages: [] };
  const handlers = createSourceDiscoveryHandlers({
    authenticate: async () => auth,
    restaurants: restaurantsFixture(),
    now: () => new Date('2026-10-27T09:00:00.000Z'),
    loadBusinesses: async () => osm,
    readHomepage: async (url) => {
      calls.pages.push(url);
      return pages[url] || { ok: false, reason: 'unreachable' };
    },
    findMenuCandidates: () => candidates,
    createCall: ({ budget, purpose }) => {
      calls.ai.push(purpose);
      if (ai.enabled !== true) return { enabled: false, reason: 'ai_not_configured', call: null };
      return {
        enabled: true,
        provider: 'anthropic',
        model: 'test-model',
        async call() {
          const answer = ai.answers[purpose];
          if (typeof answer === 'function') return answer({ budget, purpose });
          return answer === undefined ? {} : answer;
        },
      };
    },
    readSpend: async () => ({ ok: true, rows: spendRows }),
    saveProposal: async (input) => {
      calls.saved.push(input);
      return saveResult;
    },
    readIgnoredIds: async () => ({ ok: true, ids: calls.ignored }),
    ignoreBusiness: async (input) => {
      calls.ignored.push(input);
      return saveResult;
    },
    aiConfig: () => (ai.enabled === true ? { enabled: true, reason: null } : { enabled: false, reason: 'ai_flagged_off' }),
  });
  return { handlers, calls };
}

test('engine: authorization comes before anything else', async () => {
  const noSession = makeEngine({ auth: { ok: false, status: 401 } });
  const denied = await noSession.handlers.findSources(request({ restaurant_ids: ['a'] }));
  assert.equal(denied.status, 401);
  assert.equal(noSession.calls.pages.length, 0);
  assert.equal(noSession.calls.ai.length, 0);

  const notInternal = makeEngine({ auth: { ok: true, roles: [{ role: 'owner', restaurant_id: '1' }], userId: 'u' } });
  const forbidden = await notInternal.handlers.findSources(request({ restaurant_ids: ['a'] }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'Alleen interne medewerkers kunnen bronnen zoeken.');
});

test('engine: the layer order is always OSM, same host, AI choice, AI search', async () => {
  const { handlers } = makeEngine({ pages: { 'https://trattoria-voorbeeld.example': { ok: true, html: '<html></html>' } } });
  const { status, body } = await handlers.findSources(request({ restaurant_ids: ['a'] }));
  assert.equal(status, 200);
  assert.deepEqual(body.results[0].layers.map((layer) => layer.key), ['osm', 'same_host', 'ai_choice', 'ai_search']);
});

test('engine: OSM + same-host menu link becomes one proposal with its provenance, without an AI call', async () => {
  const pages = {
    'https://confuego-voorbeeld.example': { ok: true, html: '<html><body><a href="/menukaart">Menukaart</a></body></html>' },
  };
  const { handlers, calls } = makeEngine({
    pages,
    candidates: [{ url: 'https://confuego-voorbeeld.example/menukaart', matchedOn: 'Menukaart' }],
  });
  const { status, body } = await handlers.findSources(request({ restaurant_ids: ['c'] }));
  assert.equal(status, 200);
  const result = body.results[0];
  assert.equal(result.origin, 'osm');
  assert.equal(result.menu.origin, 'same_host');
  assert.equal(result.website.url, 'https://confuego-voorbeeld.example');
  assert.equal(result.menu.url, 'https://confuego-voorbeeld.example/menukaart');
  assert.equal(result.originLabel, '🗺️ OpenStreetMap → 🌐 menulink op eigen website');
  assert.equal(calls.ai.length, 0, 'the free layers decided it: no AI, no cost');
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].proposedUrl, 'https://confuego-voorbeeld.example/menukaart');
  assert.match(calls.saved[0].note, /^Herkomst: OpenStreetMap/);
  assert.match(calls.saved[0].note, /menulink: https:\/\/confuego-voorbeeld\.example\/menukaart/);
  assert.equal(body.cost.eurCents, 0);
  assert.match(body.summary, /Alles is een voorstel/);
  assert.equal(body.attribution, '© OpenStreetMap-bijdragers');
});

test('engine: OSM unreachable is an honest reason; the other layers keep working', async () => {
  const { handlers } = makeEngine({
    osm: { ok: false, reason: 'osm_unreachable' },
    pages: { 'https://trattoria-voorbeeld.example': { ok: true, html: '<a href="/menu">Menu</a>' } },
    candidates: [{ url: 'https://trattoria-voorbeeld.example/menu', matchedOn: 'Menu' }],
  });
  const { status, body } = await handlers.findSources(request({ restaurant_ids: ['a'] }));
  assert.equal(status, 200);
  assert.equal(body.results[0].layers[0].outcome, 'error');
  assert.match(body.results[0].layers[0].detail, /OpenStreetMap is nu niet bereikbaar/);
  assert.ok(body.notices.includes('osm_unreachable'));
  assert.equal(body.results[0].menu.url, 'https://trattoria-voorbeeld.example/menu', 'the same-host layer still works');
});

test('engine: AI off stops after the free layers and says so', async () => {
  const { handlers, calls } = makeEngine({
    ai: { enabled: false },
    osm: { ok: true, businesses: [], fetchedAt: null },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['b'] }));
  const layers = body.results[0].layers;
  assert.equal(layers.find((layer) => layer.key === 'ai_search').outcome, 'skipped');
  assert.ok(body.notices.includes('ai_flagged_off') || body.notices.includes('ai_not_configured'));
  assert.equal(body.cost.eurCents, 0);
  assert.equal(calls.saved.length, 0, 'no AI, no invented source');
});

test('engine: a full month budget means no AI call at all', async () => {
  const rows = [
    {
      id: 'r1',
      created_at: '2026-10-27T07:00:00.000Z',
      captured_content: { importProvenance: { kind: 'ai_read', cost: { eurCents: 1000, known: true }, readId: 'read-1' } },
    },
  ];
  const { handlers, calls } = makeEngine({
    spendRows: rows,
    osm: { ok: true, businesses: [], fetchedAt: null },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['b'] }));
  assert.equal(calls.ai.length, 0, 'the budget gate runs before the call');
  assert.ok(body.notices.includes('budget_exhausted'));
  assert.equal(body.results[0].layers.find((layer) => layer.key === 'ai_search').detail, 'budget_exhausted');
  assert.equal(body.cost.eurCents, 0);
  assert.equal(body.monthly.spentEurCents, 1000);
});

test('engine: AI search only without a website — platforms are rejected, never proposed', async () => {
  const { handlers, calls } = makeEngine({
    osm: { ok: true, businesses: [], fetchedAt: null },
    ai: {
      enabled: true,
      answers: {
        search: {
          results: [
            { url: 'https://www.thuisbezorgd.nl/noodlebar', title: 'Noodlebar', source: 'https://www.thuisbezorgd.nl/noodlebar' },
            { url: 'https://ubereats.com/nl/store/noodlebar', title: 'Noodlebar', source: 'https://ubereats.com/nl/store/noodlebar' },
          ],
        },
      },
    },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['b'] }));
  const result = body.results[0];
  assert.equal(result.website, null);
  assert.equal(result.proposal, null);
  assert.equal(result.message, 'Alleen bezorgplatforms gevonden (genegeerd)');
  assert.equal(result.layers.find((layer) => layer.key === 'ai_search').outcome, 'rejected');
  assert.equal(calls.saved.length, 0);
  assert.equal(calls.ai.includes('choice'), false, 'no website means no choice layer call');
});

test('engine: AI search with a real source becomes a proposal with that source in the note', async () => {
  const { handlers, calls } = makeEngine({
    osm: { ok: true, businesses: [], fetchedAt: null },
    ai: {
      enabled: true,
      answers: {
        search: {
          results: [
            {
              url: 'https://noodlebar-voorbeeld.example',
              title: 'Noodlebar',
              source: 'https://www.kvk.nl/noodlebar',
              quote: 'Officiële website van Noodlebar',
            },
          ],
        },
      },
    },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['b'] }));
  const result = body.results[0];
  assert.equal(result.origin, 'ai_search');
  assert.equal(result.website.url, 'https://noodlebar-voorbeeld.example');
  assert.equal(result.source, 'https://www.kvk.nl/noodlebar');
  assert.equal(calls.saved.length, 1);
  assert.match(calls.saved[0].note, /Herkomst: AI-zoeken/);
  assert.match(calls.saved[0].note, /bron: https:\/\/www\.kvk\.nl\/noodlebar/);
  assert.match(body.summary, /🤖 1 AI-zoeken/);
});

test('engine: the AI choice needs a quote that really occurs; otherwise no menu is proposed', async () => {
  const pages = {
    'https://confuego-voorbeeld.example': { ok: true, html: '<a href="/ons-verhaal">Ons verhaal</a>' },
    'https://confuego-voorbeeld.example/ons-verhaal': { ok: true, html: '<p>Welkom bij ons restaurant in Breda.</p>' },
  };
  const candidates = [{ url: 'https://confuego-voorbeeld.example/ons-verhaal', matchedOn: 'Ons verhaal' }];
  const { handlers, calls } = makeEngine({
    pages,
    candidates,
    ai: {
      enabled: true,
      answers: {
        choice: { url: 'https://confuego-voorbeeld.example/ons-verhaal', quote: 'Wij serveren de hele dag door verse pasta' },
      },
    },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['c'] }));
  const result = body.results[0];
  assert.equal(result.layers.find((layer) => layer.key === 'ai_choice').outcome, 'rejected');
  assert.equal(result.layers.find((layer) => layer.key === 'ai_choice').detail, 'quote_not_in_source');
  assert.equal(result.menu, null, 'an invented quote never becomes a menu link');
  assert.equal(calls.saved[0].proposedUrl, 'https://confuego-voorbeeld.example', 'the OSM website is still a proposal');
  assert.doesNotMatch(calls.saved[0].note, /citaat/);
});

test('engine: a good AI choice is stored with its quote and its cost counts', async () => {
  const pages = {
    'https://confuego-voorbeeld.example': { ok: true, html: '<a href="/ons-verhaal">Ons verhaal</a>' },
    'https://confuego-voorbeeld.example/ons-verhaal': { ok: true, html: '<p>Onze keuken werkt met gerechten en prijzen per seizoen.</p>' },
  };
  const candidates = [{ url: 'https://confuego-voorbeeld.example/ons-verhaal', matchedOn: 'Ons verhaal' }];
  const { handlers, calls } = makeEngine({
    pages,
    candidates,
    ai: {
      enabled: true,
      answers: {
        choice: ({ budget }) => {
          budget.costEurCents = 4;
          return { url: 'https://confuego-voorbeeld.example/ons-verhaal', quote: 'gerechten en prijzen per seizoen' };
        },
      },
    },
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['c'] }));
  const result = body.results[0];
  assert.equal(result.menuOrigin, 'ai_choice');
  assert.equal(result.origin, 'osm', 'the website still comes from OpenStreetMap');
  assert.equal(result.originLabel, '🗺️ OpenStreetMap → 🤖 AI koos de menupagina (citaat: “gerechten en prijzen per seizoen”)');
  assert.equal(result.quote, 'gerechten en prijzen per seizoen');
  assert.equal(result.menu.url, 'https://confuego-voorbeeld.example/ons-verhaal');
  assert.match(calls.saved[0].note, /Herkomst: OpenStreetMap/);
  assert.match(calls.saved[0].note, /citaat: “gerechten en prijzen per seizoen”/);
  assert.equal(body.cost.eurCents, 4);
  assert.equal(body.monthly.spentEurCents, 4, 'the measured cost counts against the same monthly budget');
  assert.match(body.summary, /Kosten AI: 4 cent/);
});

test('engine: an open proposal is reported, not overwritten', async () => {
  const { handlers } = makeEngine({
    saveResult: { ok: false, reason: 'open_exists' },
    pages: { 'https://trattoria-voorbeeld.example': { ok: true, html: '<a href="/menu">Menu</a>' } },
    candidates: [{ url: 'https://trattoria-voorbeeld.example/menu', matchedOn: 'Menu' }],
  });
  const { body } = await handlers.findSources(request({ restaurant_ids: ['a'] }));
  assert.equal(body.results[0].proposal, null);
  assert.match(body.results[0].message, /Er staat al een open voorstel/);
});

test('engine: only known restaurants, at most the existing batch bound', async () => {
  const { handlers } = makeEngine();
  assert.equal((await handlers.findSources(request({ restaurant_ids: ['a', 'onbekend'] }))).status, 200);
  assert.equal((await handlers.findSources(request({ restaurant_ids: ['onbekend'] }))).status, 400);
  assert.equal(MAX_RESTAURANTS, 10, 'the existing batch bound, never a new one');
  // Duplicate ids are one restaurant, not two AI calls.
  const { body } = await handlers.findSources(request({ restaurant_ids: ['a', 'a', 'a'] }));
  assert.equal(body.results.length, 1);
});

test('engine: "Nieuw gevonden" excludes linked and ignored OSM places, with the attribution', async () => {
  const { handlers } = makeEngine({
    osm: {
      ok: true,
      fetchedAt: '2026-10-27T08:12:00.000Z',
      businesses: [
        osmBusiness({ osmId: 'node/1', name: 'Trattoria Voorbeeld' }),
        osmBusiness({ osmId: 'node/2', name: 'Bakkerij Voorbeeld', website: null, address: 'Haagdijk 3, 4811 TV Breda', postcode: '4811TV' }),
        osmBusiness({ osmId: 'node/3', name: 'Café Voorbeeld', website: 'https://cafe-voorbeeld.example' }),
      ],
    },
  });
  const { status, body } = await handlers.newRestaurants({});
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.items.map((item) => item.name), ['Bakkerij Voorbeeld', 'Café Voorbeeld']);
  assert.equal(body.items[0].kindLabel, 'restaurant · italian');
  assert.match(body.items[0].addHref, /^\/internal\/toevoegen\?naam=Bakkerij/);
  assert.equal(body.attribution, '© OpenStreetMap-bijdragers');

  // An ignored OSM id is not offered again.
  const ignored = makeEngine({
    osm: {
      ok: true,
      businesses: [osmBusiness({ osmId: 'node/3', name: 'Café Voorbeeld' })],
    },
  });
  ignored.calls.ignored.push('osm-node-3');
  const second = await ignored.handlers.newRestaurants({});
  assert.deepEqual(second.body.items, []);
});

test('engine: "Nieuw gevonden" reports an unreachable OSM honestly', async () => {
  const { handlers } = makeEngine({ osm: { ok: false, reason: 'osm_unreachable' } });
  const { status, body } = await handlers.newRestaurants({});
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.deepEqual(body.items, []);
  assert.match(body.message, /OpenStreetMap is nu niet bereikbaar/);
});

test('engine: "Negeren" is stored on the OSM key; a second click is idempotent', async () => {
  const { handlers, calls } = makeEngine({
    osm: { ok: true, businesses: [osmBusiness({ osmId: 'node/2', name: 'Bakkerij Voorbeeld' })] },
  });
  const first = await handlers.ignoreNew(request({ osm_id: 'node/2' }));
  assert.equal(first.status, 200);
  assert.equal(first.body.ignored, 'osm-node-2');
  assert.equal(calls.ignored[0].kind, 'mark_unusable');
  assert.equal(calls.ignored[0].restaurant_id, 'osm-node-2');
  assert.equal(calls.ignored[0].actorUserId, 'user-1');

  const again = makeEngine({
    osm: { ok: true, businesses: [] },
    saveResult: { ok: false, reason: 'open_exists' },
  });
  const second = await again.handlers.ignoreNew(request({ osm_id: 'node/2' }));
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyIgnored, true);

  assert.equal((await handlers.ignoreNew(request({ osm_id: 'onzin' }))).status, 400);
});

test('engine: the AI requests name the same model and the search request uses the web-search tool', () => {
  const choice = buildChoiceRequest({
    restaurant: WEBSITE_RESTAURANT,
    website: { url: 'https://trattoria-voorbeeld.example' },
    candidates: [{ url: 'https://trattoria-voorbeeld.example/menukaart', matchedOn: 'Menukaart' }],
    pageTexts: { 'https://trattoria-voorbeeld.example/menukaart': 'Onze menukaart' },
  });
  assert.equal(choice.model, 'claude-haiku-5-5');
  assert.equal(choice.tools, undefined, 'the choice layer may not search the web');
  assert.match(choice.system, /letterlijk citaat/);
  assert.match(choice.messages[0].content[0].text, /menukaart/);

  const search = buildSearchRequest({ restaurant: NO_SITE_RESTAURANT });
  assert.equal(search.model, 'claude-haiku-5-5');
  assert.deepEqual(search.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }]);
  assert.match(search.system, /Bezorg- en reserveringsplatforms/);
});
