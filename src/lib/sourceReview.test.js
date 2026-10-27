'use strict';

// BE-31 (#74) — unit tests for the shared source-review logic: which tasks the
// screen shows (only real work), the real counters, the one row state and the
// one next step per batch result, and the "Nog niet gecontroleerd" rows of
// Dekking. Fictional rows only; no Supabase, no network, no browser.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  BRONNEN_HREF,
  COVERAGE_HREF,
  MENUKOPJES_HREF,
  TASK_FILTER_LABELS,
  STEPS,
  ROW_STATES,
  CHECK_COPY,
  MAX_BATCH_URLS,
  rowForBatchItem,
  stepHref,
  safeReturnHref,
  menukopjesBackHref,
  rowNeedsAction,
  taskFromBatch,
  selectTasks,
  countTasks,
  filterTasks,
  effectiveTaskFilter,
  coverageRows,
  checkSelection,
  canStartCheck,
  countSourceReviewTasks,
} = require('./sourceReview');

const REPO_ROOT = path.join(__dirname, '..', '..');

function entry(overrides) {
  return {
    restaurant_id: 'r-1',
    name: 'Restaurant Een',
    wijk: 'Centrum',
    domain: 'een.nl',
    known_url: 'https://een.nl',
    not_in_queue_reason: null,
    open_proposal_id: null,
    next_step: 'check_via_onboarding',
    attention: null,
    ...overrides,
  };
}

function batchItem(overrides) {
  return {
    key: 'menu_found',
    position: 1,
    url: 'https://een.nl/menu',
    jobId: 'job-1',
    restaurant: { id: 'r-1', name: 'Restaurant Een', known: true },
    foundUrl: 'https://een.nl/menu',
    actions: ['confirm'],
    text: null,
    ...overrides,
  };
}

function batchDetail(items, batchOverrides) {
  return {
    batch: { id: 'batch-1', closed_at: '2026-10-27T10:00:00.000Z', is_starter: true, item_count: items.length, ...batchOverrides },
    items,
    summary: { total: items.length },
  };
}

test('tasks: only open proposals, attention sources and batch results with an action', () => {
  const entries = [
    entry({ restaurant_id: 'a', name: 'Open voorstel', open_proposal_id: 'p1', next_step: 'review_proposal' }),
    entry({ restaurant_id: 'b', name: 'Aandacht', next_step: 'replace_or_mark', attention: 'Bron: Niet bereikbaar' }),
    entry({ restaurant_id: 'c', name: 'Geen bron', next_step: 'add_candidate' }),
    // Not a task: no human action, and "Nog niet gecontroleerd" belongs to Dekking.
    entry({ restaurant_id: 'd', name: 'Onbekend', next_step: 'proposals_unknown' }),
    entry({ restaurant_id: 'e', name: 'In orde', next_step: 'check_via_onboarding' }),
    entry({ restaurant_id: 'f', name: 'Nooit gecontroleerd', not_in_queue_reason: 'never_checked' }),
    entry({ restaurant_id: 'g', name: 'Geen website', not_in_queue_reason: 'no_website' }),
  ];
  const tasks = selectTasks({ entries });
  // Contract order: batches, proposals, attention; then by name.
  assert.deepEqual(tasks.map((t) => t.name), ['Open voorstel', 'Aandacht', 'Geen bron']);
  assert.deepEqual(tasks.map((t) => t.kind), ['proposal', 'attention', 'attention']);
  assert.equal(tasks.some((t) => t.name === 'Nooit gecontroleerd'), false);
});

test('tasks: an empty batch and a fully confirmed batch are not work', () => {
  assert.equal(taskFromBatch(batchDetail([], {})), null);
  assert.equal(taskFromBatch(batchDetail([batchItem({ key: 'confirmed', actions: [] })], {})), null);
  assert.equal(taskFromBatch(null), null);
});

test('tasks: a batch with one open result is one task with its own rows', () => {
  const detail = batchDetail([
    batchItem({ position: 1, key: 'menu_found', actions: ['confirm'] }),
    batchItem({ position: 2, key: 'confirmed', actions: [] }),
    batchItem({ position: 3, key: 'duplicate', actions: [] }),
  ]);
  const task = taskFromBatch(detail);
  assert.ok(task);
  assert.equal(task.kind, 'batch');
  assert.equal(task.name, 'Restaurant Een');
  assert.equal(task.activeCount, 1);
  assert.equal(task.rows.length, 3);
  // Nothing is copied: the row keeps the job and the restaurant of the batch item.
  assert.equal(task.rows[0].jobId, 'job-1');
  assert.equal(task.rows[1].state, 'done');
  assert.equal(task.rows[1].step, null);
  assert.equal(task.rows[2].state, 'skip');
});

test('tasks: a batch of one restaurant keeps that name, several stay a count', () => {
  const one = taskFromBatch(batchDetail([batchItem({})]));
  assert.equal(one.name, 'Restaurant Een');
  const two = taskFromBatch(
    batchDetail([
      batchItem({ position: 1, restaurant: { id: 'r-1', name: 'Een' } }),
      batchItem({ position: 2, restaurant: { id: 'r-2', name: 'Twee' } }),
    ]),
  );
  assert.equal(two.name, '2 restaurants');
});

test('tasks: an unknown restaurant is named as such, never invented', () => {
  const task = taskFromBatch(batchDetail([batchItem({ restaurant: null })]));
  assert.equal(task.name, 'Onbekend restaurant');
});

test('tasks: a source with a menu that is not in order asks attention, a clean source does not', () => {
  const tasks = selectTasks({
    entries: [
      entry({ restaurant_id: 'a', name: 'Niet beoordeeld', menu: 'not_assessed', next_step: 'check_via_onboarding' }),
      entry({ restaurant_id: 'b', name: 'Niet bereikbaar', source: 'unreachable', menu: 'not_assessed', next_step: 'replace_or_mark' }),
      entry({ restaurant_id: 'c', name: 'In orde', source: 'reachable', menu: 'ready_for_review', attention: 'Menukaart wacht op beoordeling' }),
      entry({ restaurant_id: 'd', name: 'Onbekende voorstellen', source: 'unreachable', next_step: 'proposals_unknown' }),
    ],
  });
  assert.deepEqual(tasks.map((t) => t.name), ['Niet beoordeeld', 'Niet bereikbaar']);
});

test('counters: chips count every task exactly once, with real numbers', () => {
  const tasks = selectTasks({
    entries: [
      entry({ restaurant_id: 'a', open_proposal_id: 'p1', next_step: 'review_proposal' }),
      entry({ restaurant_id: 'b', next_step: 'add_candidate' }),
    ],
    batchDetails: [batchDetail([batchItem({ key: 'needs_review', structureReview: { eligible: true } })])],
  });
  const counts = countTasks(tasks);
  assert.deepEqual(counts, { all: 3, batch: 1, proposal: 1, attention: 1 });
  assert.equal(countSourceReviewTasks(tasks), 3);
  assert.equal(counts.all, counts.batch + counts.proposal + counts.attention);
});

test('counters: filters use the real counts and an unknown filter shows everything', () => {
  const tasks = selectTasks({
    entries: [
      entry({ restaurant_id: 'a', open_proposal_id: 'p1', next_step: 'review_proposal' }),
      entry({ restaurant_id: 'b', next_step: 'add_candidate' }),
    ],
    batchDetails: [batchDetail([batchItem({ key: 'needs_review', structureReview: { eligible: true } })])],
  });
  assert.equal(filterTasks(tasks, 'batch').length, 1);
  assert.equal(filterTasks(tasks, 'proposal').length, 1);
  assert.equal(filterTasks(tasks, 'attention').length, 1);
  assert.equal(filterTasks(tasks, 'all').length, 3);
  assert.equal(filterTasks(tasks, 'onbekend').length, 3);
  assert.equal(effectiveTaskFilter('onbekend'), 'all');
  assert.equal(effectiveTaskFilter('batch'), 'batch');
});

test('row states: each batch status gets exactly one next step', () => {
  const cases = [
    ['menu_found', { actions: ['confirm'] }, 'certain', 'confirm'],
    ['needs_review', { structureReview: { eligible: true }, actions: ['review_structure'] }, 'doubt', 'menukopjes'],
    ['needs_review', { structureReview: { eligible: false }, actions: ['review_manually'] }, 'blocked', 'manual'],
    ['no_menu', { actions: ['review_manually'], jobId: 'job-1' }, 'no_menu', 'ai_read'],
    ['image_only', { actions: ['review_source'], jobId: 'job-1' }, 'no_menu', 'ai_read'],
    ['error', { actions: ['retry'], jobId: 'job-1' }, 'no_menu', 'ai_read'],
    ['robots', { actions: ['review_manually'], jobId: 'job-1' }, 'blocked', 'manual'],
    ['invalid', { actions: ['adjust_url'] }, 'blocked', 'manual'],
    ['not_queued', { actions: [] }, 'skip', null],
    ['duplicate', { actions: [] }, 'skip', null],
    ['queued', { actions: [], jobId: null }, 'progress', 'wait'],
    ['running', { actions: [] }, 'progress', 'wait'],
    ['confirmed', { actions: [] }, 'done', null],
  ];
  for (const [key, overrides, state, step] of cases) {
    const row = rowForBatchItem(batchItem({ key, ...overrides }));
    assert.equal(row.state, state, `${key} → state`);
    assert.equal(row.step ? row.step.key : null, step, `${key} → step`);
    assert.equal(row.emoji, ROW_STATES[state].emoji, `${key} → emoji`);
  }
});

test('row states: a no_menu result without a job is manual, never a dead AI button', () => {
  const row = rowForBatchItem(batchItem({ key: 'no_menu', jobId: null, actions: ['review_manually'] }));
  assert.equal(row.state, 'blocked');
  assert.equal(row.step.key, 'manual');
  assert.equal(stepHref(row, { batchId: 'batch-1' }), '/internal/menu-import?restaurant=r-1&name=Restaurant+Een');
});

test('row hrefs: menukopjes opens the BE-30 screen of the same batch and item', () => {
  const row = rowForBatchItem(batchItem({ key: 'needs_review', structureReview: { eligible: true } }), { batchId: 'batch-1' });
  assert.equal(stepHref(row, { batchId: 'batch-1' }), `${MENUKOPJES_HREF}?batch=batch-1&item=1`);
  assert.equal(
    stepHref(row, { batchId: 'batch-1', returnTo: '/internal/toevoegen?batch=batch-1' }),
    `${MENUKOPJES_HREF}?batch=batch-1&item=1&return=%2Finternal%2Ftoevoegen%3Fbatch%3Dbatch-1`,
  );
  assert.equal(
    stepHref(row, { batchId: 'batch-1', returnTo: 'https://example.invalid/phish' }),
    `${MENUKOPJES_HREF}?batch=batch-1&item=1`,
  );
});

test('row hrefs: AI read reuses the existing menu-import link with the job', () => {
  const row = rowForBatchItem(batchItem({ key: 'no_menu', jobId: 'job-9', actions: ['review_manually'] }));
  const href = stepHref(row, { batchId: 'batch-1' });
  assert.match(href, /^\/internal\/menu-import\?/);
  assert.match(href, /job=job-9/);
  assert.match(href, /restaurant=r-1/);
  assert.match(href, /url=https%3A%2F%2Feen\.nl%2Fmenu/);
});

test('row hrefs: confirm and wait are in-page actions without a destination', () => {
  assert.equal(stepHref(rowForBatchItem(batchItem({ key: 'menu_found' }))), null);
  assert.equal(stepHref(rowForBatchItem(batchItem({ key: 'queued', actions: [] }))), null);
  assert.equal(rowNeedsAction(rowForBatchItem(batchItem({ key: 'confirmed', actions: [] }))), false);
  assert.equal(rowNeedsAction(rowForBatchItem(batchItem({ key: 'queued', actions: [] }))), true);
});

test('return hrefs: only the internal screens of this flow are accepted', () => {
  assert.equal(safeReturnHref(`${BRONNEN_HREF}?batch=1`), `${BRONNEN_HREF}?batch=1`);
  assert.equal(safeReturnHref('/internal/toevoegen'), '/internal/toevoegen');
  assert.equal(safeReturnHref(COVERAGE_HREF), COVERAGE_HREF);
  assert.equal(safeReturnHref('https://evil.invalid'), null);
  assert.equal(safeReturnHref('/internal/source-triage'), null);
  assert.equal(safeReturnHref(null), null);
  assert.equal(menukopjesBackHref(null), BRONNEN_HREF);
  assert.equal(menukopjesBackHref('https://evil.invalid'), BRONNEN_HREF);
});

test('Dekking: "Nog niet gecontroleerd" rows keep the existing reason texts', () => {
  const rows = coverageRows([
    entry({ restaurant_id: 'a', name: 'Een', not_in_queue_reason: 'never_checked' }),
    entry({ restaurant_id: 'b', name: 'Twee', not_in_queue_reason: 'no_website', known_url: null }),
    entry({ restaurant_id: 'c', name: 'Drie', not_in_queue_reason: 'check_in_progress' }),
    entry({ restaurant_id: 'd', name: 'Vier', not_in_queue_reason: null, open_proposal_id: 'p1' }),
    entry({ restaurant_id: 'e', name: 'Vijf', not_in_queue_reason: null, next_step: 'replace_or_mark' }),
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['Een', 'Twee', 'Drie']);
  assert.deepEqual(rows.map((r) => r.reasonLabel), ['Nog nooit gecontroleerd', 'Geen website bekend', 'Controle loopt nog']);
  assert.equal(rows[0].canCheck, true);
  assert.deepEqual(rows[0].step, STEPS.check);
  assert.equal(rows[1].canCheck, false);
  assert.equal(rows[1].step, null);
  // The same restaurants are not tasks: they moved, they were not copied.
  const tasks = selectTasks({
    entries: [
      entry({ restaurant_id: 'a', name: 'Een', not_in_queue_reason: 'never_checked' }),
      entry({ restaurant_id: 'e', name: 'Vijf', next_step: 'replace_or_mark' }),
    ],
  });
  assert.deepEqual(tasks.map((t) => t.name), ['Vijf']);
});

test('Dekking: selection checks only known websites, with the existing maximum', () => {
  const rows = coverageRows([
    entry({ restaurant_id: 'a', name: 'Een', not_in_queue_reason: 'never_checked', known_url: 'https://een.nl' }),
    entry({ restaurant_id: 'b', name: 'Twee', not_in_queue_reason: 'never_checked', known_url: 'https://twee.nl' }),
    entry({ restaurant_id: 'c', name: 'Drie', not_in_queue_reason: 'no_website', known_url: null }),
    entry({ restaurant_id: 'd', name: 'Vier', not_in_queue_reason: 'never_checked', known_url: 'https://een.nl' }),
  ]);
  const selection = checkSelection(rows, new Set(['a', 'b', 'c', 'd']));
  assert.deepEqual(selection.urls, ['https://een.nl', 'https://twee.nl']);
  assert.equal(selection.count, 2);
  assert.equal(selection.tooMany, false);
  assert.deepEqual(selection.skipped, ['Drie']);
  assert.equal(canStartCheck({ count: 2, remaining: 25 }).ok, true);
});

test('Dekking: the existing batch limits are stated before the click', () => {
  assert.equal(canStartCheck({ count: 0, remaining: 25 }).ok, false);
  assert.equal(canStartCheck({ count: MAX_BATCH_URLS + 1, remaining: 25 }).ok, false);
  assert.equal(canStartCheck({ count: 4, remaining: 2 }).ok, false);
  assert.equal(canStartCheck({ count: 4, remaining: 25 }).ok, true);

  const many = coverageRows(
    Array.from({ length: MAX_BATCH_URLS + 2 }, (_, index) =>
      entry({ restaurant_id: `x${index}`, name: `X${index}`, not_in_queue_reason: 'never_checked', known_url: `https://x${index}.nl` }),
    ),
  );
  const selection = checkSelection(many, new Set(many.map((row) => row.restaurantId)));
  assert.equal(selection.tooMany, true);
  assert.equal(selection.urls.length, MAX_BATCH_URLS);
  assert.equal(canStartCheck({ count: selection.count, remaining: 25 }).ok, true);
});

test('copy: the empty state and the phone list use the agreed words', () => {
  assert.equal(CHECK_COPY.noWork, '✅ Geen open bronwerk');
  assert.equal(CHECK_COPY.pickTask, 'Kies een taak links');
  assert.match(CHECK_COPY.keepOpen, /alleen zolang deze pagina open is/);
  assert.equal(COVERAGE_HREF, '/internal/coverage');
  assert.equal(BRONNEN_HREF, '/internal/bronnen');
  assert.equal(MENUKOPJES_HREF, '/internal/bronnen/batch');
  for (const key of ['all', 'batch', 'proposal', 'attention']) {
    assert.ok(TASK_FILTER_LABELS[key], `chip ${key}`);
  }
  assert.equal(TASK_FILTER_LABELS.batch, '🧪 Batches');
  assert.equal(TASK_FILTER_LABELS.proposal, '💡 Voorstellen');
  assert.equal(TASK_FILTER_LABELS.attention, '📡 Aandacht');
});

test('addresses: a 308 sends both old addresses to /internal/bronnen', async () => {
  const nextConfig = require(path.join(REPO_ROOT, 'next.config.js'));
  const redirects = await nextConfig.redirects();
  const triage = redirects.find((r) => r.source === '/internal/source-triage');
  const batch = redirects.find((r) => r.source === '/internal/source-triage/batch');
  assert.ok(triage, '/internal/source-triage redirect exists');
  assert.ok(batch, '/internal/source-triage/batch redirect exists');
  assert.equal(triage.destination, BRONNEN_HREF);
  assert.equal(batch.destination, BRONNEN_HREF);
  // `permanent: true` is Next's 308; it keeps the query string, so an existing
  // ?batch=<id> deeplink stays usable on the new address.
  assert.equal(triage.permanent, true);
  assert.equal(batch.permanent, true);
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'app/internal/source-triage/page.js')), false);
});

// __SOURCE_REVIEW_TEST_APPEND__


