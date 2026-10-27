'use strict';

// BE-34 (#81, criterion 2) — searching a restaurant that is not in our list yet
// by name. The AI is mocked: found, not found and only-a-platform. No network, no
// key, no paid call, and nothing is ever created by the search itself.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSourceDiscoveryHandlers } = require('./sourceDiscoveryHandlers');
const { ONLY_PLATFORMS_MESSAGE, newRestaurantHref, DISCOVERY_MESSAGES } = require('./sourceDiscovery');
const { findOsmBusinessByName } = require('./osmSource');

function request(name) {
  return { json: async () => ({ name }) };
}

function build({ answer = { results: [] }, aiEnabled = true, businesses = null, homepage = null } = {}) {
  const calls = { proposals: 0, ai: 0 };
  const handlers = createSourceDiscoveryHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal' }] }),
    restaurants: {},
    now: () => new Date('2026-10-27T10:00:00.000Z'),
    loadBusinesses: async () =>
      businesses === null
        ? {
            ok: true,
            fetchedAt: '2026-10-27T03:05:00.000Z',
            businesses: [{ osmId: 'node/1', name: "Bobby's Bar", address: 'Haven 1, 4811 AB Breda', website: null }],
          }
        : businesses,
    readHomepage: async (url) => {
      if (homepage) return homepage(url);
      return { ok: true, finalUrl: url, html: '<nav><a href="/menukaart">Menukaart</a></nav>' };
    },
    findMenuCandidates: (html, base) => [{ url: `${base.replace(/\/$/, '')}/menukaart`, matchedOn: 'Menukaart' }],
    createCall: ({ budget }) => ({
      enabled: true,
      async call() {
        calls.ai += 1;
        budget.costEurCents = 3;
        return answer;
      },
    }),
    readSpend: async () => ({ ok: true, rows: [] }),
    saveProposal: async () => {
      calls.proposals += 1;
      return { ok: true, id: 'proposal-1' };
    },
    readIgnoredIds: async () => ({ ok: true, ids: [] }),
    ignoreBusiness: async () => ({ ok: true }),
    aiConfig: () => (aiEnabled ? { enabled: true, reason: null } : { enabled: false, reason: 'ai_flagged_off' }),
  });
  return { handlers, calls };
}

const FOUND = {
  results: [
    {
      url: 'https://bobbysbar.nl/',
      title: "Bobby's Bar",
      source: 'https://bobbysbar.nl/',
      quote: "Bobby's Bar aan de Haven in Breda",
    },
  ],
};

test('a found restaurant becomes a proposal with name, address, website, menu and provenance', async () => {
  const { handlers, calls } = build({ answer: FOUND });
  const { status, body } = await handlers.searchByName(request("Bobby's Bar"));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.name, "Bobby's Bar");

  const proposal = body.proposal;
  assert.ok(proposal);
  assert.equal(proposal.name, "Bobby's Bar");
  // The OSM address of the same business travels to the onboarding (BE-32 restpunt).
  assert.equal(proposal.address, 'Haven 1, 4811 AB Breda');
  assert.deepEqual(proposal.website, { url: 'https://bobbysbar.nl/', origin: 'ai_search' });
  assert.deepEqual(proposal.menu, { url: 'https://bobbysbar.nl/menukaart', origin: 'same_host' });
  assert.equal(proposal.quote, "Bobby's Bar aan de Haven in Breda");
  assert.equal(proposal.source, 'https://bobbysbar.nl/');
  assert.match(proposal.originLabel, /AI-zoeken/);
  assert.match(proposal.originLabel, /menulink op eigen website/);
  assert.equal(proposal.onboardingHref, newRestaurantHref({
    name: "Bobby's Bar",
    address: 'Haven 1, 4811 AB Breda',
    website: 'https://bobbysbar.nl/',
    menu: 'https://bobbysbar.nl/menukaart',
  }));
  const href = new URL(proposal.onboardingHref, 'https://example.test');
  assert.equal(href.pathname, '/internal/onboarding-restaurant');
  assert.equal(href.searchParams.get('naam'), "Bobby's Bar");
  assert.equal(href.searchParams.get('adres'), 'Haven 1, 4811 AB Breda');
  assert.equal(href.searchParams.get('website'), 'https://bobbysbar.nl/');
  assert.equal(href.searchParams.get('menu'), 'https://bobbysbar.nl/menukaart');

  // Cost is visible; the monthly figure is the existing shape.
  assert.deepEqual(body.cost, { eurCents: 3, known: true });
  assert.equal(body.monthly.limitEurCents, 1000);
  // Nothing was created or confirmed by the search.
  assert.equal(calls.proposals, 0);
  assert.equal(calls.ai, 1);
});

test('not found is an honest answer with the measured cost and no proposal', async () => {
  const { handlers, calls } = build({ answer: { results: [] } });
  const { status, body } = await handlers.searchByName(request('Onbekend Restaurant'));
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.proposal, null);
  assert.equal(body.reason, 'no_results');
  assert.equal(body.message, DISCOVERY_MESSAGES.not_found);
  assert.deepEqual(body.cost, { eurCents: 3, known: true });
  assert.equal(calls.proposals, 0);
});

test('only a delivery platform is refused, with the existing message', async () => {
  const { handlers, calls } = build({
    answer: { results: [{ url: 'https://www.thuisbezorgd.nl/bobbys-bar', source: 'https://www.thuisbezorgd.nl/bobbys-bar' }] },
  });
  const { status, body } = await handlers.searchByName(request("Bobby's Bar"));
  assert.equal(status, 200);
  assert.equal(body.proposal, null);
  assert.equal(body.reason, 'only_rejected');
  assert.equal(body.message, ONLY_PLATFORMS_MESSAGE);
  // A refused answer is still a paid call, so its cost is reported.
  assert.deepEqual(body.cost, { eurCents: 3, known: true });
  assert.equal(calls.proposals, 0);
});

test('with AI off nothing is called and the search says so', async () => {
  const { handlers, calls } = build({ aiEnabled: false });
  const { body } = await handlers.searchByName(request("Bobby's Bar"));
  assert.equal(body.proposal, null);
  assert.equal(body.reason, 'ai_flagged_off');
  assert.equal(body.message, DISCOVERY_MESSAGES.ai_flagged_off);
  assert.deepEqual(body.cost, { eurCents: null, known: false });
  assert.equal(calls.ai, 0);
  assert.equal(calls.proposals, 0);
});

test('a website OSM already knows is used first, without an AI call', async () => {
  const { handlers, calls } = build({
    businesses: {
      ok: true,
      fetchedAt: '2026-10-27T03:05:00.000Z',
      businesses: [{ osmId: 'node/2', name: "Bobby's Bar", address: null, website: 'https://bobbysbar.nl' }],
    },
  });
  const { body } = await handlers.searchByName(request("Bobby's Bar"));
  assert.equal(body.proposal.website.origin, 'osm');
  assert.match(body.proposal.originLabel, /OpenStreetMap/);
  assert.equal(body.proposal.address, null);
  assert.equal(calls.ai, 0);
  assert.deepEqual(body.cost, { eurCents: null, known: false });
});

test('an empty or very short name is refused before anything else', async () => {
  const { handlers, calls } = build();
  assert.equal((await handlers.searchByName(request(''))).status, 400);
  assert.equal((await handlers.searchByName(request(' a '))).status, 400);
  assert.equal(calls.ai, 0);
});

test('the OSM address is only used when exactly one business carries the name', () => {
  const businesses = [
    { osmId: 'node/1', name: "Bobby's Bar", address: 'Haven 1' },
    { osmId: 'node/2', name: 'Café Smelt', address: 'Haven 2' },
  ];
  assert.equal(findOsmBusinessByName("Bobby's Bar", businesses).osmId, 'node/1');
  assert.equal(findOsmBusinessByName("bobby's bar", businesses).osmId, 'node/1');
  assert.equal(findOsmBusinessByName("  Bobby's   Bar ", businesses).osmId, 'node/1');
  // The existing comparable-name rule folds accents.
  assert.equal(findOsmBusinessByName('cafe smelt', businesses).osmId, 'node/2');
  // Two businesses with the same name: no address instead of a guess.
  assert.equal(
    findOsmBusinessByName("Bobby's Bar", [...businesses, { osmId: 'node/3', name: "Bobby's Bar", address: 'Haven 3' }]),
    null,
  );
  assert.equal(findOsmBusinessByName('', businesses), null);
  assert.equal(findOsmBusinessByName('Onbekend', businesses), null);
});
