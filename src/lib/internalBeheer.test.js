'use strict';

// Issue #53 round 2 — pure view models for the four Beheer sections, plus
// structural safety nets for the page and its panels.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  BEHEER_SECTIONS,
  sectionFromSearch,
  buildOverviewModel,
  buildRestaurantView,
  buildImportHistoryView,
  buildDecisionView,
  EXPORT_LABELS,
} = require('./internalBeheer');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BEHEER_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/page.js');
const BEHEER_NAV_PATH = path.join(REPO_ROOT, 'src/components/beheer/BeheerNav.js');

const coverage = {
  city: 'Breda',
  metrics: {
    basicInfo: { count: 25, total: 25, pct: 100 },
    menuData: { count: 12, total: 25, pct: 48, restaurantIds: ['1'], missingRestaurantIds: ['2'] },
    priceCoverage: { count: 286, total: 310, pct: 92 },
    reservationConfirmed: { count: 18, total: 25, pct: 72 },
  },
  byBuurt: [
    { label: 'Ginneken', total: 6, withMenuData: 2, pct: 33 },
    { label: 'Centrum', total: 9, withMenuData: 2, pct: 22 },
  ],
};

const triage = {
  proposals_available: true,
  restaurants: [
    {
      restaurant_id: '23',
      name: 'Bistro Linde',
      wijk: 'Centrum',
      domain: 'bistro-linde.example',
      known_url: 'https://bistro-linde.example/menu',
      source: 'reachable',
      menu: 'ready_for_review',
      attention: '2 prijzen gewijzigd',
      checked_at: '2026-10-16T10:00:00Z',
      next_step: 'review_proposal',
      proposals: [
        { id: 'p0', kind: 'add_candidate', status: 'accepted', proposed_at: '2026-10-14T09:00:00Z', decided_at: '2026-10-14T10:00:00Z', decision_note: 'Goedgekeurd' },
        { id: 'p1', kind: 'replace_source', status: 'open', proposed_at: '2026-10-16T09:00:00Z' },
        { id: 'p2', kind: 'mark_unusable', status: 'rejected', proposed_at: '2026-10-13T09:00:00Z', decided_at: '2026-10-13T11:00:00Z', decision_note: 'Niet nodig' },
      ],
    },
    {
      restaurant_id: '24',
      name: 'Brasserie Haven',
      source: 'unreachable',
      menu: 'not_assessed',
      not_in_queue_reason: 'check_not_usable',
      proposals: [],
    },
  ],
};

const batches = {
  recent_batches: [
    { id: 'b1', created_at: '2026-10-16T10:00:00Z', closed_at: null, close_reason: null, item_count: 3, is_own: true },
    { id: 'b2', created_at: '2026-10-15T10:00:00Z', closed_at: '2026-10-15T11:00:00Z', close_reason: 'expired', item_count: 1, is_own: false },
  ],
};

const runs = {
  runs: [
    {
      id: 'r1',
      status: 'failed',
      started_at: '2026-10-15T09:00:00Z',
      completed_at: '2026-10-15T09:01:00Z',
      duration_seconds: 60,
      record_counts: { records: 18 },
      error_log: ['timeout'],
      data_origin_source_name: 'OSM Breda',
      source_locator: 'breda.osm.pbf',
      access_provider_source_name: null,
    },
  ],
};

test('sections: exactly the four approved sections, with overview as the safe default', () => {
  assert.deepEqual(BEHEER_SECTIONS.map((s) => s.label), [
    'Overzicht',
    'Restaurants en bronnen',
    'Importhistorie',
    'Concepten en besluiten',
  ]);
  assert.equal(sectionFromSearch(''), 'overview');
  assert.equal(sectionFromSearch('?section=restaurants'), 'restaurants');
  assert.equal(sectionFromSearch('?section=imports'), 'imports');
  assert.equal(sectionFromSearch('?section=decisions'), 'decisions');
  assert.equal(sectionFromSearch('?section=unknown'), 'overview');
});

test('overview: maps only the existing coverage figures and sorts neighbourhood gaps', () => {
  const view = buildOverviewModel(coverage);
  assert.equal(view.city, 'Breda');
  assert.deepEqual(view.menu, { id: 'menuData', label: 'Menukaartgegevens', count: 12, total: 25, pct: 48 });
  assert.deepEqual(view.metrics.map((m) => m.label), [
    'Restaurantgegevens',
    'Menukaartgegevens',
    'Gerechten met prijs',
    'Reserveringskanaal bevestigd',
  ]);
  assert.deepEqual(view.priorityRows.map((r) => [r.label, r.missingMenuData]), [
    ['Centrum', 7],
    ['Ginneken', 4],
  ]);
  assert.equal(view.totalRestaurants, 25);
});

test('overview: missing or malformed coverage data yields no invented dashboard', () => {
  assert.equal(buildOverviewModel(null), null);
  assert.equal(buildOverviewModel({}), null);
  assert.equal(buildOverviewModel({ metrics: null }), null);
});

test('restaurants: keeps every existing record, labels the two statuses and opens the exact source record', () => {
  const view = buildRestaurantView(triage);
  assert.equal(view.total, 2);
  assert.equal(view.proposalsAvailable, true);
  assert.equal(view.openProposalCount, 1);
  assert.deepEqual(view.rows.map((r) => r.name), ['Bistro Linde', 'Brasserie Haven']);

  const bistro = view.rows[0];
  assert.equal(bistro.sourceLabel, 'Bereikbaar');
  assert.equal(bistro.menuLabel, 'Klaar voor review');
  assert.equal(bistro.openProposal.id, 'p1');
  assert.equal(bistro.openProposal.kindLabel, 'Bron vervangen');
  assert.equal(bistro.triageHref, '/internal/source-triage?restaurant=23');
  assert.equal(bistro.workqueueHref, '/internal/source-workqueue?restaurant=23');
  assert.deepEqual(bistro.proposals.map((p) => p.id), ['p1', 'p0', 'p2']);

  const haven = view.rows[1];
  assert.equal(haven.sourceLabel, 'Niet bereikbaar');
  assert.equal(haven.notInQueueLabel, 'Laatste controle gaf geen bruikbaar resultaat');
  assert.equal(haven.nextStepLabel, null);
});

test('restaurants: unavailable proposal storage is reported, never turned into "no proposals"', () => {
  const view = buildRestaurantView({ ...triage, proposals_available: false, restaurants: [triage.restaurants[1]] });
  assert.equal(view.proposalsAvailable, false);
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].openProposal, null);
});

test('restaurants: an empty or malformed payload gives an honest empty list', () => {
  assert.deepEqual(buildRestaurantView(null), { rows: [], proposalsAvailable: false, total: 0, openProposalCount: 0 });
  assert.deepEqual(buildRestaurantView({ restaurants: null }), { rows: [], proposalsAvailable: false, total: 0, openProposalCount: 0 });
});

test('import history: URL batches and dataset runs stay clearly distinct, each with an exact existing destination', () => {
  const view = buildImportHistoryView({ batchData: batches, runsData: runs, batchOk: true, runsOk: true });
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.counts, { urlBatches: 2, datasetRuns: 1, total: 3 });

  assert.deepEqual(view.urlBatches.map((b) => [b.id, b.statusLabel, b.itemCount]), [
    ['b1', 'Open', 3],
    ['b2', 'Verlopen', 1],
  ]);
  assert.equal(view.urlBatches[0].href, '/internal/nieuwe-import?batch=b1');
  assert.equal(view.urlBatches[0].isOwn, true);

  const run = view.datasetRuns[0];
  assert.equal(run.statusLabel, 'Mislukt');
  assert.equal(run.sourceName, 'OSM Breda');
  assert.equal(run.errorLog.length, 1);
  assert.equal(run.href, '/internal/import-inbox?run=r1');
});

test('import history: one unavailable provider is partial; both unavailable is an error, never an empty history', () => {
  const partial = buildImportHistoryView({ batchData: batches, runsData: null, batchOk: true, runsOk: false });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.counts.urlBatches, 2);
  assert.equal(partial.counts.datasetRuns, 0);

  const error = buildImportHistoryView({ batchData: null, runsData: null, batchOk: false, runsOk: false });
  assert.equal(error.status, 'error');
  assert.equal(error.counts.total, 0);

  const empty = buildImportHistoryView({ batchData: { recent_batches: [] }, runsData: { runs: [] }, batchOk: true, runsOk: true });
  assert.equal(empty.status, 'empty');
});

test('decisions: recorded concepts, source decisions and profile drafts are grouped without becoming a workqueue', () => {
  const view = buildDecisionView({
    conceptsData: {
      items: [
        { id: 7, restaurantId: 23, restaurantName: 'Bistro Linde', version: 2, menuContext: 'Lunch', status: 'waiting', createdAt: '2026-10-16T10:00:00Z' },
        { id: 8, restaurantId: 30, restaurantName: 'Restaurant Park', version: 3, menuContext: 'Diner', status: 'approved', createdAt: '2026-10-15T10:00:00Z', export: { status: 'opened' } },
      ],
    },
    triageData: triage,
    draftsData: {
      drafts: [
        { id: 'd1', status: 'draft', candidate_name: 'Café Park', promoted_at: '2026-10-14T10:00:00Z' },
        { id: 'd2', status: 'discarded', candidate_name: 'Oud Pand', promoted_at: '2026-10-13T10:00:00Z', discarded_at: '2026-10-14T11:00:00Z', discard_note: 'Dubbel' },
      ],
    },
    conceptsOk: true,
    triageOk: true,
    draftsOk: true,
  });
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.counts, { menuConcepts: 2, sourceDecisions: 2, profileDrafts: 2, total: 6 });

  assert.deepEqual(view.menuConcepts.map((c) => [c.id, c.statusLabel, c.exportLabel]), [
    ['7', 'Wacht op beoordeling', 'Geen publicatie gestart'],
    ['8', 'Intern goedgekeurd', EXPORT_LABELS.opened],
  ]);
  assert.equal(view.menuConcepts[0].href, '/internal/menu-concepts/7');

  // Only decided proposals are history; the open proposal is daily work and
  // stays in Werkvoorraad, not in this overview.
  assert.deepEqual(view.sourceDecisions.map((d) => [d.id, d.statusLabel]), [
    ['p0', 'Geaccepteerd'],
    ['p2', 'Afgewezen'],
  ]);
  assert.equal(view.sourceDecisions[0].href, '/internal/source-triage?restaurant=23');

  assert.deepEqual(view.profileDrafts.map((d) => [d.id, d.statusLabel]), [
    ['d1', 'Actief profielconcept'],
    ['d2', 'Verworpen profielconcept'],
  ]);
  assert.equal(view.profileDrafts[1].href, '/internal/profile-drafts#draft-d2');
});

test('decisions: approval alone never becomes publication readiness — only the stored export status is shown', () => {
  const view = buildDecisionView({
    conceptsData: {
      items: [
        { id: 1, restaurantName: 'A', status: 'approved', export: null },
        { id: 2, restaurantName: 'B', status: 'approved', export: { status: 'failed' } },
        { id: 3, restaurantName: 'C', status: 'approved', export: { status: 'merged' } },
      ],
    },
    conceptsOk: true,
    triageOk: true,
    draftsOk: true,
  });
  const byId = Object.fromEntries(view.menuConcepts.map((c) => [c.id, c]));
  assert.equal(byId['1'].exportLabel, 'Geen publicatie gestart');
  assert.equal(byId['2'].exportLabel, 'Publicatie mislukt');
  assert.equal(byId['3'].exportLabel, EXPORT_LABELS.merged);
  for (const concept of view.menuConcepts) {
    assert.doesNotMatch(concept.exportLabel, /Klaar voor publicatie/i);
    assert.doesNotMatch(concept.statusLabel, /Klaar voor publicatie/i);
  }
});

test('decisions: provider failures are partial/error and empty history stays empty', () => {
  const partial = buildDecisionView({
    conceptsData: { items: [{ id: 1, restaurantName: 'A', status: 'waiting' }] },
    conceptsOk: true,
    triageOk: false,
    draftsOk: true,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.counts.menuConcepts, 1);
  assert.equal(partial.counts.sourceDecisions, 0);

  const error = buildDecisionView({ conceptsOk: false, triageOk: false, draftsOk: false });
  assert.equal(error.status, 'error');
  assert.equal(error.counts.total, 0);

  const empty = buildDecisionView({
    conceptsData: { items: [] },
    triageData: { restaurants: [] },
    draftsData: { drafts: [] },
    conceptsOk: true,
    triageOk: true,
    draftsOk: true,
  });
  assert.equal(empty.status, 'empty');
});

// ─── Structural safety net: Beheer page, tabs and read-only panels ──────

test('structural safety net: /internal renders the four real sections directly, not module cards or a link-only hub', () => {
  const source = fs.readFileSync(BEHEER_PAGE_PATH, 'utf8');
  assert.match(source, /BeheerNav/);
  assert.match(source, /OverviewPanel/);
  assert.match(source, /RestaurantsPanel/);
  assert.match(source, /ImportHistoryPanel/);
  assert.match(source, /DecisionsPanel/);
  assert.match(source, /sectionFromSearch/);
  assert.doesNotMatch(source, /groupModulesByPlacement|modules\.map\(/);
  assert.doesNotMatch(source, /\.from\(['"]/, 'no direct Supabase access from the page');
});

test('structural safety net: Beheer keeps the real section URLs and marks the current one', () => {
  const source = fs.readFileSync(BEHEER_NAV_PATH, 'utf8');
  assert.match(source, /BEHEER_SECTIONS\.map/);
  assert.match(source, /aria-current=\{section === item\.id \? 'page' : undefined\}/);
  assert.match(source, /href=\{item\.href\}/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
});

test('structural safety net: every Beheer panel uses only an existing read-only endpoint and never writes, imports or publishes', () => {
  const panels = {
    overview: ['src/components/beheer/OverviewPanel.js', '/api/internal/v1/coverage'],
    restaurants: ['src/components/beheer/RestaurantsPanel.js', '/api/internal/v1/source-triage'],
    imports: ['src/components/beheer/ImportHistoryPanel.js', '/api/internal/v1/batch-analysis'],
    decisions: ['src/components/beheer/DecisionsPanel.js', '/api/internal/v1/menu-concepts'],
  };
  for (const [name, [file, endpoint]] of Object.entries(panels)) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.ok(source.includes(endpoint), name + ' must use ' + endpoint);
    assert.doesNotMatch(source, /method:\s*['"]POST['"]/, `${name} must never post`);
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/, `${name} must never write`);
  }
  const imports = fs.readFileSync(path.join(REPO_ROOT, 'src/components/beheer/ImportHistoryPanel.js'), 'utf8');
  assert.match(imports, /\/api\/internal\/v1\/import-inbox\/runs/);
  const model = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/internalBeheer.js'), 'utf8');
  assert.match(model, /\/internal\/nieuwe-import\?batch=/);
  assert.match(model, /\/internal\/import-inbox\?run=/);
  const decisions = fs.readFileSync(path.join(REPO_ROOT, 'src/components/beheer/DecisionsPanel.js'), 'utf8');
  assert.doesNotMatch(decisions, /Klaar voor publicatie/);
  assert.match(decisions, /Open voorstellen staan in de Werkvoorraad/);
});

test('structural safety net: old internal URLs still exist after the Beheer rebuild', () => {
  for (const route of [
    'app/internal/coverage/page.js',
    'app/internal/import-inbox/page.js',
    'app/internal/menu-concepts/page.js',
    'app/internal/source-workqueue/page.js',
    'app/internal/source-triage/page.js',
    'app/internal/profile-drafts/page.js',
  ]) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, route)), true, `${route} must remain reachable`);
  }
});

test('restaurant selection brings its detail heading into view and keyboard focus', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/components/beheer/RestaurantsPanel.js'), 'utf8');
  assert.match(source, /detailHeading\.current\.focus\(\)/);
  assert.match(source, /detailHeading\.current\.scrollIntoView/);
  assert.match(source, /id="bh-restaurant-detail-title" ref=\{detailHeading\} tabIndex=\{-1\}/);
});

