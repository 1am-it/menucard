'use strict';

// BE-31 (#74) — fictional fixtures for the new "Bronnen beoordelen" screen, the
// "Nog niet gecontroleerd" section of Dekking and the result rows of
// "Restaurant of menu toevoegen".
//
// Every name, URL and number is fictional; every URL is on the .invalid TLD.
// The bodies are the exact read shapes of the existing APIs (BE-24 triage,
// BE-25 batch overview/detail, the coverage dashboard), so the real components
// render them without a fixture-only branch. Nothing here writes, confirms,
// analyses or publishes.

const BATCH_ID = 'batch-bronnen-0001';
const NOW = '2026-10-27T10:15:00.000Z';

const RESTAURANT = { id: '9001', name: 'Fictief Restaurant Smelt', known: true };

function proposal(overrides) {
  return {
    id: 'proposal-fictief-1',
    kind: 'add_candidate',
    proposed_url: 'https://fictief-andalous.invalid/menukaart',
    current_url: null,
    unusable_reason: null,
    note: 'Fictieve bron gevonden op de eigen website.',
    status: 'open',
    proposed_by: { self: false, ref: 'fictief12' },
    proposed_at: '2026-10-26T09:00:00.000Z',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    events: [
      { event: 'proposed', actor: { self: false, ref: 'fictief12' }, note: null, created_at: '2026-10-26T09:00:00.000Z' },
    ],
    ...overrides,
  };
}

function entry(overrides) {
  return {
    restaurant_id: '9001',
    name: 'Fictief Restaurant Smelt',
    wijk: 'Centrum',
    domain: 'fictief-smelt.invalid',
    known_url: 'https://fictief-smelt.invalid',
    source: 'reachable',
    menu: 'ready_for_review',
    not_in_queue_reason: null,
    checked_at: '2026-10-26T08:00:00.000Z',
    attention: 'Menukaart wacht op beoordeling',
    next_step: 'check_via_onboarding',
    open_proposal_id: null,
    proposals_known: true,
    proposals: [],
    ...overrides,
  };
}

function item(overrides) {
  return {
    key: 'menu_found',
    position: 1,
    url: 'https://fictief-smelt.invalid/menu',
    jobId: 'job-bronnen-1',
    restaurant: RESTAURANT,
    foundUrl: 'https://fictief-smelt.invalid/menu.pdf',
    high: true,
    actions: ['confirm'],
    text: null,
    structureReview: null,
    menu: null,
    notes: [],
    limitations: [],
    ...overrides,
  };
}

const items = [
  // ✅ zeker resultaat → Bevestig bron
  item({ position: 1 }),
  // ⚠️ twijfel → Menukopjes controleren (het BE-30-scherm)
  item({
    position: 2,
    key: 'needs_review',
    jobId: 'job-bronnen-2',
    actions: ['review_structure'],
    text: 'Er is een menukaart gevonden, maar de menukopjes zijn onzeker.',
    structureReview: {
      eligible: true,
      receiptHash: 'fictieve-receipt-hash',
      required: [
        { key: '0.0', path: ['Lunch', 'Koud'], label: 'Lunch › Koud', sourcePath: ['LUNCH', 'KOUD'] },
        { key: '0.1', path: ['Lunch', 'Warm'], label: 'Lunch › Warm', sourcePath: ['LUNCH', 'WARM'] },
      ],
      treated: [],
      storeAvailable: true,
    },
  }),
  // 📋 geen menukaart gevonden → Lees met AI
  item({
    position: 3,
    key: 'no_menu',
    jobId: 'job-bronnen-3',
    high: false,
    actions: ['review_manually'],
    foundUrl: null,
    text: 'Op deze website is geen bruikbare menukaart gevonden.',
  }),
  // ⛔ geblokkeerd → Handmatig toevoegen
  item({
    position: 4,
    key: 'robots',
    jobId: 'job-bronnen-4',
    high: false,
    actions: ['review_manually'],
    foundUrl: null,
    text: 'De website staat automatische controle niet toe (robots.txt).',
  }),
  // ⏳ bezig
  item({ position: 5, key: 'running', jobId: 'job-bronnen-5', high: false, actions: [], foundUrl: null }),
  // al afgerond
  item({ position: 6, key: 'confirmed', jobId: 'job-bronnen-6', high: false, actions: [], foundUrl: null }),
];

const batchDetail = {
  batch: {
    id: BATCH_ID,
    created_at: '2026-10-27T10:00:00.000Z',
    closed_at: null,
    close_reason: null,
    item_count: items.length,
    is_starter: true,
  },
  items,
  summary: { total: items.length, done: 3, running: 1, queued: 0, open: 2, highCertainty: 1, byAction: { confirm: 1, review_structure: 1 } },
};

const batchOverview = {
  daily: { used: 3, limit: 25 },
  own_open_batch_id: null,
  recent_batches: [
    {
      id: BATCH_ID,
      created_at: '2026-10-27T10:00:00.000Z',
      closed_at: null,
      close_reason: null,
      item_count: items.length,
      is_own: true,
    },
  ],
};

const triage = {
  city: 'Breda',
  proposals_available: true,
  orphan_proposals: 0,
  unattributed_checks: 0,
  job_limit_reached: false,
  proposal_limit_reached: false,
  restaurants: [
    // 💡 voorstel: wacht op besluit
    entry({
      restaurant_id: '9002',
      name: 'Fictief Andalous',
      domain: 'fictief-andalous.invalid',
      known_url: 'https://fictief-andalous.invalid',
      attention: 'Menukaart wacht op beoordeling',
      next_step: 'review_proposal',
      open_proposal_id: 'proposal-fictief-1',
      proposals: [proposal({})],
    }),
    // 📡 aandacht: bron niet bereikbaar
    entry({
      restaurant_id: '9003',
      name: 'Fictief Con Fuego',
      domain: 'fictief-confuego.invalid',
      known_url: 'https://fictief-confuego.invalid',
      source: 'unreachable',
      menu: 'not_assessed',
      attention: 'Bron: Niet bereikbaar',
      next_step: 'replace_or_mark',
    }),
    // Dekking: nog niet gecontroleerd, met de bestaande redenen
    entry({
      restaurant_id: '9004',
      name: 'Fictief De Beyerd',
      domain: 'fictief-debeyerd.invalid',
      known_url: 'https://fictief-debeyerd.invalid',
      source: null,
      menu: null,
      not_in_queue_reason: 'never_checked',
      checked_at: null,
      attention: 'Nog nooit gecontroleerd',
    }),
    entry({
      restaurant_id: '9005',
      name: 'Fictief Gantau Village',
      domain: null,
      known_url: null,
      source: null,
      menu: null,
      not_in_queue_reason: 'no_website',
      checked_at: null,
      attention: 'Geen website bekend',
    }),
    entry({
      restaurant_id: '9006',
      name: 'Fictief Klein Java',
      domain: 'fictief-kleinjava.invalid',
      known_url: 'https://fictief-kleinjava.invalid',
      source: null,
      menu: null,
      not_in_queue_reason: 'check_not_usable',
      checked_at: '2026-10-20T09:00:00.000Z',
      attention: 'Laatste controle gaf geen bruikbaar resultaat',
    }),
    entry({
      restaurant_id: '9007',
      name: 'Fictief Dolce e Salato',
      domain: 'fictief-dolce.invalid',
      known_url: 'https://fictief-dolce.invalid',
      source: null,
      menu: null,
      not_in_queue_reason: 'check_in_progress',
      checked_at: '2026-10-27T09:30:00.000Z',
      attention: 'Controle loopt nog',
    }),
  ],
};

// No open work at all: only restaurants without a usable source check, which
// belong to Dekking (criterion 2/3).
const triageEmpty = {
  ...triage,
  restaurants: triage.restaurants.filter((row) => Number(row.restaurant_id) >= 9004),
};

const coverage = {
  city: 'Breda',
  sampleThreshold: 5,
  generatedAt: NOW,
  totals: { restaurants: 25 },
  metrics: {
    basicInfo: { count: 25, total: 25, pct: 100 },
    menuData: { count: 5, total: 25, pct: 20, restaurantIds: ['9001', '9002'], missingRestaurantIds: ['9003', '9004', '9005'] },
    priceCoverage: { count: 40, total: 60, pct: 67 },
    reservationConfirmed: { count: 4, total: 25, pct: 16 },
  },
  byBuurt: [
    { label: 'Centrum', total: 12, withMenuData: 4, pct: 33 },
    { label: 'Noord', total: 6, withMenuData: 1, pct: 17 },
    { label: 'Zuid', total: 7, withMenuData: 0, pct: 0 },
  ],
  byCuisine: [],
};

const batchDetailClosed = {
  ...batchDetail,
  batch: { ...batchDetail.batch, closed_at: '2026-10-27T10:05:00.000Z', close_reason: 'completed' },
};

const SCENARIOS = {
  bronnen: { triage, batchOverview, batchDetail, coverage },
  bronnenLeeg: {
    triage: triageEmpty,
    batchOverview: { daily: { used: 0, limit: 25 }, own_open_batch_id: null, recent_batches: [] },
    batchDetail,
    coverage,
  },
  // "Restaurant of menu toevoegen": the same rows, but the fictional batch is
  // already finished so the read-only fixture never calls the process route.
  bronnenToevoegen: { triage, batchOverview, batchDetail: batchDetailClosed, coverage },
};

module.exports = {
  SCENARIOS,
  BATCH_ID,
  triage,
  triageEmpty,
  batchOverview,
  batchDetail,
  batchDetailClosed,
  coverage,
  items,
};
