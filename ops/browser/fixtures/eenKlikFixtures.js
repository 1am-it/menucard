'use strict';

// BE-34 (#81) — fictional data for the one-click browser check.
//
// Everything here is built with the product's own modules (buildImportReport,
// reviewView) so the real components receive the exact shapes the server sends.
// The source, the restaurant and every URL are fictional (`.invalid`), the
// images are a committed fictional PNG, and no provider, database or production
// identity is involved. FIXTURE EVIDENCE: not production or independent
// acceptance.

const menuReviewFixtures = require('./menuReviewFixtures');
const baseBronnen = require('./bronnenFixtures');

const imageScenario = menuReviewFixtures.scenarios['manual-image'].manual;
const IMAGE_IMPORT = imageScenario.import;
const IMAGE_REVIEW = imageScenario.reviews[0];

const aiStatusOn = {
  enabled: true,
  reason: null,
  message: null,
  label: 'Gelezen door AI',
  aiName: 'Claude (Haiku 5.5)',
  perCallMaxEurCents: 30,
  monthly: { spentEurCents: 12, limitEurCents: 1000, remainingEurCents: 988, unknownConcepts: 0 },
  budget: { allowed: true, reason: null },
};

/** The body of one successful AI reading of the fictional image menu. */
const aiReadBody = {
  state: 'fixture-state-een-klik',
  validUntil: '2026-10-27T13:00:00.000Z',
  import: IMAGE_IMPORT,
  review: IMAGE_REVIEW,
  summary: {
    items: IMAGE_IMPORT.summary.items,
    valid: IMAGE_IMPORT.summary.valid,
    needsReview: IMAGE_IMPORT.summary.needsReview,
  },
  cost: { eurCents: 1, known: true },
  estimate: { label: '2 afbeeldingen · ± 1 minuut' },
  notice: 'Deze kaart is als afbeelding gelezen; een citaat is daar niet letterlijk te controleren. Elk gerecht blijft staan.',
  imageRead: true,
  plan: { mode: 'images', estimate: { label: '2 afbeeldingen · ± 1 minuut' } },
  ai: {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    label: 'Gelezen door AI',
    readAt: '2026-10-27T12:05:00.000Z',
    protocolVersion: 'fixture-protocol',
    protocolHash: 'fixture-protocol-hash',
    schemaVersion: 'fixture-schema',
    bundleHash: 'fixture-bundle-hash',
    requestId: null,
    durationMs: 4200,
  },
  origin: { kind: 'ai_gelezen', label: 'Gelezen door AI', aiName: 'Claude (Haiku 5.5)' },
  monthly: { spentEurCents: 13, limitEurCents: 1000, remainingEurCents: 987, unknownConcepts: 0 },
};

/** "✨ Zoek op internet: Bobby's Bar, Breda" — a fictional found restaurant. */
const nameSearch = {
  ok: true,
  name: "Bobby's Bar",
  proposal: {
    name: "Bobby's Bar",
    address: 'Haven 1, 4811 AB Breda',
    website: { url: 'https://bobbys-bar.invalid', origin: 'ai_search' },
    menu: { url: 'https://bobbys-bar.invalid/menukaart', origin: 'same_host' },
    originChain: ['ai_search', 'same_host'],
    originLabel: '🤖 AI-zoeken · bron: https://gids.invalid/bobbys — 🌐 menulink op eigen website',
    quote: "Bobby's Bar aan de Haven in Breda",
    source: 'https://gids.invalid/bobbys',
    aiCostEurCents: 3,
    layers: [
      { key: 'osm', outcome: 'no_website', detail: 'name_match' },
      { key: 'ai_search', outcome: 'hit', detail: 'https://gids.invalid/bobbys' },
      { key: 'same_host', outcome: 'hit', detail: 'Menukaart' },
    ],
    onboardingHref:
      '/internal/onboarding-restaurant?naam=Bobby%27s+Bar&adres=Haven+1%2C+4811+AB+Breda&website=https%3A%2F%2Fbobbys-bar.invalid&menu=https%3A%2F%2Fbobbys-bar.invalid%2Fmenukaart',
  },
  reason: null,
  message: null,
  layers: [
    { key: 'osm', outcome: 'no_website', detail: 'name_match' },
    { key: 'ai_search', outcome: 'hit', detail: 'https://gids.invalid/bobbys' },
    { key: 'same_host', outcome: 'hit', detail: 'Menukaart' },
  ],
  cost: { eurCents: 3, known: true },
  monthly: { spentEurCents: 15, limitEurCents: 1000, remainingEurCents: 985, unknownConcepts: 0 },
  notices: [],
  messages: [],
  attribution: '© OpenStreetMap-bijdragers',
};

const nameSearchNotFound = {
  ...nameSearch,
  proposal: null,
  reason: 'no_results',
  message: 'Geen website gevonden.',
  cost: { eurCents: 2, known: true },
};

/** "Nieuw gevonden" with nothing new: the same read shape, an honest empty list. */
const discoveryNewEmpty = {
  ok: true,
  items: [],
  fetchedAt: '2026-10-27T03:05:00.000Z',
  attribution: '© OpenStreetMap-bijdragers',
  sourceUrl: 'https://www.openstreetmap.org',
};

const SCENARIOS = {
  // One image-only menu whose row starts the existing AI reading with one click,
  // plus the name search of the add form. `aiState=slow` holds the fictional
  // answer so the progress state is observable; `?nameState=notfound` answers the
  // honest "nothing found".
  eenKlik: {
    triage: baseBronnen.SCENARIOS.beeldLezen.triage,
    batchOverview: baseBronnen.SCENARIOS.beeldLezen.batchOverview,
    batchDetail: baseBronnen.SCENARIOS.beeldLezen.batchDetail,
    batchDetails: baseBronnen.SCENARIOS.beeldLezen.batchDetails,
    coverage: baseBronnen.coverage,
    discoveryNew: discoveryNewEmpty,
    manual: { restaurants: [] },
    ai: { status: aiStatusOn, read: { status: 200, body: aiReadBody } },
    nameSearch,
  },
  // The same row when the reading fails: nothing is invented, the row offers the
  // existing manual step.
  eenKlikFout: {
    triage: baseBronnen.SCENARIOS.beeldLezen.triage,
    batchOverview: baseBronnen.SCENARIOS.beeldLezen.batchOverview,
    batchDetail: baseBronnen.SCENARIOS.beeldLezen.batchDetail,
    batchDetails: baseBronnen.SCENARIOS.beeldLezen.batchDetails,
    coverage: baseBronnen.coverage,
    discoveryNew: discoveryNewEmpty,
    manual: { restaurants: [] },
    ai: { status: aiStatusOn, read: {} },
    nameSearch: nameSearchNotFound,
  },
};

module.exports = { SCENARIOS, aiReadBody, nameSearch, nameSearchNotFound };
