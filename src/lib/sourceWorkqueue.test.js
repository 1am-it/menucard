'use strict';

// Bronwerkvoorraad — unit tests for the pure classification logic in
// src/lib/sourceWorkqueue.js. Fictional restaurants and example.invalid
// domains only.

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SOURCE_STATUSES,
  MENU_STATUSES,
  SOURCE_LABELS,
  MENU_LABELS,
  ACTIONS,
  ACTION_LABELS,
  QUEUES,
  QUEUE_LABELS,
  NOT_IN_QUEUE_REASONS,
  NOT_IN_QUEUE_LABELS,
  SORT_MODES,
  SORT_LABELS,
  classifyRow,
  observeJob,
  attributeJob,
  buildSourceWorkqueue,
  countQueues,
  sortRows,
  filterRows,
  wijkOptions,
  domainOf,
} = require('./sourceWorkqueue');
const { ALLOWED_JOB_ERROR_REASONS, ALLOWED_JOB_STATUSES } = require('./restaurantSourceAnalysisJobs');

// ─── Vocabulary ────────────────────────────────────────────────────────────

test('vocabulary: exactly the agreed Dutch labels, one per status, action and queue', () => {
  assert.deepEqual(SOURCE_STATUSES.map((s) => SOURCE_LABELS[s]), ['Bereikbaar', 'Niet bereikbaar', 'Toegang beperkt', 'Identiteit gewijzigd']);
  assert.deepEqual(MENU_STATUSES.map((s) => MENU_LABELS[s]), ['Klaar voor review', 'Structuur niet herkend', 'Geen menukaart aangetroffen', 'Niet beoordeeld']);
  assert.deepEqual(ACTIONS.map((a) => ACTION_LABELS[a]), ['Beoordeel', 'Beoordeel handmatig', 'Controleer bron', 'Controleer toegang', 'Controleer identiteit']);
  assert.deepEqual(QUEUES.map((q) => QUEUE_LABELS[q]), ['Beoordelen', 'Bron controleren', 'Identiteit']);
  assert.deepEqual(SORT_MODES.map((m) => SORT_LABELS[m]), ['Eerst actie nodig', 'Oudste controle eerst', 'Restaurant (A–Z)']);
  for (const r of NOT_IN_QUEUE_REASONS) assert.ok(NOT_IN_QUEUE_LABELS[r], r);
});

// ─── classifyRow: all 16 combinations and the dependency rule ───────────

const EXPECTED = {
  reachable: {
    ready_for_review: ['ready_for_review', 'review', 'review'],
    structure_not_recognized: ['structure_not_recognized', 'review_manually', 'review'],
    no_menu_found: ['no_menu_found', 'check_source', 'source'],
    not_assessed: ['not_assessed', 'review_manually', 'review'],
  },
  unreachable: 'check_source',
  access_limited: 'check_access',
  identity_changed: 'check_identity',
};

test('classifyRow: every one of the 16 source × menu combinations gives the expected menu, action and queue', () => {
  let combos = 0;
  for (const source of SOURCE_STATUSES) {
    for (const menu of MENU_STATUSES) {
      combos += 1;
      const row = classifyRow({ sourceStatus: source, menuStatus: menu });
      assert.equal(row.source, source);
      if (source === 'reachable') {
        const [expMenu, expAction, expQueue] = EXPECTED.reachable[menu];
        assert.deepEqual([row.menu, row.action, row.queue], [expMenu, expAction, expQueue], `${source}/${menu}`);
      } else {
        assert.equal(row.menu, 'not_assessed', `dependency rule: ${source}/${menu}`);
        assert.equal(row.action, EXPECTED[source], `${source}/${menu}`);
      }
      assert.ok(ACTIONS.includes(row.action) && QUEUES.includes(row.queue));
    }
  }
  assert.equal(combos, 16);
});

test('classifyRow: a source that is not reachable always forces "Niet beoordeeld", even when the input claims a menu', () => {
  for (const source of ['unreachable', 'access_limited', 'identity_changed']) {
    for (const menu of ['ready_for_review', 'structure_not_recognized', 'no_menu_found']) {
      assert.equal(classifyRow({ sourceStatus: source, menuStatus: menu }).menu, 'not_assessed', `${source}/${menu}`);
    }
  }
});

test('classifyRow: identity changed never inherits a menu status and always asks for an identity check', () => {
  const row = classifyRow({ sourceStatus: 'identity_changed', menuStatus: 'ready_for_review' });
  assert.deepEqual([row.menu, row.action, row.queue], ['not_assessed', 'check_identity', 'identity']);
});

test('classifyRow: unknown statuses fail closed (throw), never default', () => {
  assert.throws(() => classifyRow({ sourceStatus: 'ok', menuStatus: 'not_assessed' }));
  assert.throws(() => classifyRow({ sourceStatus: 'reachable', menuStatus: 'published' }));
  assert.throws(() => classifyRow({}));
});

test('classifyRow: exactly one action per row; priority identity < source < manual review < review', () => {
  const p = (s, m) => classifyRow({ sourceStatus: s, menuStatus: m }).priority;
  assert.ok(p('identity_changed', 'not_assessed') < p('unreachable', 'not_assessed'));
  assert.equal(p('unreachable', 'not_assessed'), p('access_limited', 'not_assessed'));
  assert.equal(p('reachable', 'no_menu_found'), p('unreachable', 'not_assessed'));
  assert.ok(p('access_limited', 'not_assessed') < p('reachable', 'structure_not_recognized'));
  assert.ok(p('reachable', 'not_assessed') < p('reachable', 'ready_for_review'));
});

// ─── observeJob: mapping existing analysis data, never a guess ───────────

const receiptWith = (items) => ({ menus: [{ name: 'Fictief', contextSlug: 'x-diner', categories: [{ name: 'Fictief', items }] }] });

test('observeJob: a succeeded job with recognized HTML menu items is reachable and ready for review', () => {
  assert.deepEqual(observeJob({ status: 'succeeded', unknown_menu_contexts: [] }, receiptWith([{ name: 'Fictieve soep', price: '6,50' }])), {
    kind: 'classified', source: 'reachable', menu: 'ready_for_review',
  });
});

test('observeJob: recognized PDF sections count as recognized menu items too', () => {
  const job = { status: 'succeeded', unknown_menu_contexts: [{ recognizedSections: [{ name: 'Fictief', items: [{ name: 'Fictieve taart' }] }] }] };
  assert.equal(observeJob(job, { menus: [] }).menu, 'ready_for_review');
});

test('observeJob: a menu candidate without recognized items is "Structuur niet herkend"', () => {
  assert.equal(observeJob({ status: 'succeeded', unknown_menu_contexts: [{ recognizedSections: [] }] }, { menus: [] }).menu, 'structure_not_recognized');
  assert.equal(observeJob({ status: 'succeeded', unknown_menu_contexts: [] }, receiptWith([])).menu, 'structure_not_recognized');
});

test('observeJob: nothing recognized and no candidate is NOT "Geen menukaart aangetroffen" — it stays "Niet beoordeeld"', () => {
  assert.deepEqual(observeJob({ status: 'succeeded', unknown_menu_contexts: [] }, { menus: [] }), { kind: 'classified', source: 'reachable', menu: 'not_assessed' });
  assert.equal(observeJob({ status: 'succeeded' }, { menus: null }).menu, 'not_assessed');
});

test('observeJob: a succeeded job without its receipt makes no claim', () => {
  assert.deepEqual(observeJob({ status: 'succeeded' }, null), { kind: 'unusable' });
});

test('observeJob: only failure reasons that say something about the source are mapped', () => {
  assert.deepEqual(observeJob({ status: 'failed', error_reason: 'fetch_failed' }, null), { kind: 'classified', source: 'unreachable', menu: 'not_assessed' });
  assert.deepEqual(observeJob({ status: 'failed', error_reason: 'robots_disallowed' }, null), { kind: 'classified', source: 'access_limited', menu: 'not_assessed' });
  assert.deepEqual(observeJob({ status: 'failed', error_reason: 'unsupported_content_type' }, null), { kind: 'classified', source: 'reachable', menu: 'not_assessed' });
  assert.deepEqual(observeJob({ status: 'failed', error_reason: 'pdf_extraction_failed' }, null), { kind: 'classified', source: 'reachable', menu: 'not_assessed' });
  for (const reason of ['internal_error', 'unsafe_url', 'ai_structuring_failed', 'budget_exceeded', 'no_reliable_content_found', 'something_new', undefined]) {
    assert.deepEqual(observeJob({ status: 'failed', error_reason: reason }, null), { kind: 'unusable' }, String(reason));
  }
});

test('observeJob: pending, running and unknown job states are not observations', () => {
  for (const status of ['pending', 'running', 'queued', undefined]) assert.deepEqual(observeJob({ status }, null), { kind: 'unusable' });
  assert.deepEqual(observeJob(null, null), { kind: 'unusable' });
});

test('observeJob: no job status or error reason that exists today ever yields "Identiteit gewijzigd" or "Geen menukaart aangetroffen"', () => {
  const receipts = [null, { menus: [] }, receiptWith([]), receiptWith([{ name: 'Fictief' }])];
  for (const status of ALLOWED_JOB_STATUSES) {
    for (const reason of [null, ...ALLOWED_JOB_ERROR_REASONS]) {
      for (const receipt of receipts) {
        for (const unknown of [[], [{ recognizedSections: [] }]]) {
          const o = observeJob({ status, error_reason: reason, unknown_menu_contexts: unknown }, receipt);
          if (o.kind !== 'classified') continue;
          assert.notEqual(o.source, 'identity_changed');
          assert.notEqual(o.menu, 'no_menu_found');
        }
      }
    }
  }
});

// ─── attributeJob ──────────────────────────────────────────────────────────

const matcherFor = (map) => (url) => {
  const host = domainOf(url);
  const ids = Object.entries(map).filter(([, h]) => h === host).map(([id]) => id);
  if (ids.length === 1) return { matchType: 'exact', restaurantId: ids[0] };
  return { matchType: ids.length > 1 ? 'multiple' : 'none', restaurantId: null };
};

test('attributeJob: a succeeded job uses only the receipt\'s exact match; never none/multiple', () => {
  const match = matcherFor({ 1: 'fictief-a.example.invalid' });
  assert.equal(attributeJob({ status: 'succeeded' }, { restaurant_match_type: 'exact', matched_restaurant_id: '7' }, match), '7');
  assert.equal(attributeJob({ status: 'succeeded', canonical_source_url: 'https://fictief-a.example.invalid/' }, { restaurant_match_type: 'none', matched_restaurant_id: null }, match), null);
  assert.equal(attributeJob({ status: 'succeeded' }, { restaurant_match_type: 'multiple' }, match), null);
  assert.equal(attributeJob({ status: 'succeeded' }, null, match), null);
});

test('attributeJob: a failed job uses an exact hostname match of the checked URL only', () => {
  const match = matcherFor({ 1: 'fictief-a.example.invalid', 2: 'gedeeld.example.invalid', 3: 'gedeeld.example.invalid' });
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://www.fictief-a.example.invalid/menu' }, null, match), '1');
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://gedeeld.example.invalid/' }, null, match), null);
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://onbekend.example.invalid/' }, null, match), null);
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://fictief-a.example.invalid/' }, null, undefined), null);
});

// ─── buildSourceWorkqueue ──────────────────────────────────────────────────

const RESTAURANTS = {
  1: { name: 'Fictief Alfa', buurt: 'Centrum', website: 'https://www.alfa.example.invalid' },
  2: { name: 'Fictief Bravo', buurt: 'Ginneken', website: 'https://bravo.example.invalid' },
  3: { name: 'Fictief Charlie', buurt: 'Centrum', website: 'https://charlie.example.invalid' },
  4: { name: 'Fictief Delta', buurt: '', website: 'https://delta.example.invalid' },
  5: { name: 'Fictief Echo', buurt: 'Boeimeer', website: '' },
  6: { name: 'Fictief Foxtrot', buurt: 'Heuvel', website: 'https://foxtrot.example.invalid' },
  7: { name: 'Fictief Golf', buurt: 'Heuvel', website: 'https://golf.example.invalid' },
};
const HOSTS = { 1: 'alfa.example.invalid', 2: 'bravo.example.invalid', 3: 'charlie.example.invalid', 4: 'delta.example.invalid', 6: 'foxtrot.example.invalid', 7: 'golf.example.invalid' };
const job = (id, url, status, extra = {}) => ({ id, canonical_source_url: url, status, created_at: extra.created_at || '2026-03-01T10:00:00Z', updated_at: extra.updated_at || extra.created_at || '2026-03-01T10:01:00Z', ...extra });

function sampleQueue() {
  const jobs = [
    // Alfa: an older failure, then a newer success with recognized items -> ready
    job('j1', 'https://alfa.example.invalid/', 'failed', { error_reason: 'fetch_failed', created_at: '2026-03-01T09:00:00Z' }),
    job('j2', 'https://alfa.example.invalid/', 'succeeded', { result_receipt_id: 'r2', unknown_menu_contexts: [], created_at: '2026-03-02T09:00:00Z', updated_at: '2026-03-02T09:05:00Z' }),
    // Bravo: robots -> access limited
    job('j3', 'https://bravo.example.invalid/', 'failed', { error_reason: 'robots_disallowed', created_at: '2026-03-03T09:00:00Z' }),
    // Charlie: a newer internal error does not erase the older usable observation
    job('j4', 'https://charlie.example.invalid/', 'succeeded', { result_receipt_id: 'r4', unknown_menu_contexts: [{ recognizedSections: [] }], created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:02:00Z' }),
    job('j5', 'https://charlie.example.invalid/', 'failed', { error_reason: 'internal_error', created_at: '2026-03-05T08:00:00Z' }),
    // Delta: only an internal error -> not in queue
    job('j6', 'https://delta.example.invalid/', 'failed', { error_reason: 'internal_error' }),
    // Foxtrot: only running -> not in queue
    job('j7', 'https://foxtrot.example.invalid/', 'running'),
    // A check of an unknown site -> unattributed
    job('j8', 'https://onbekend.example.invalid/', 'failed', { error_reason: 'fetch_failed' }),
    // Golf: never checked (no job)
  ];
  const receipts = [
    { id: 'r2', restaurant_match_type: 'exact', matched_restaurant_id: '1', menus: receiptWith([{ name: 'Fictieve soep' }]).menus },
    { id: 'r4', restaurant_match_type: 'exact', matched_restaurant_id: '3', menus: [] },
  ];
  return buildSourceWorkqueue({ restaurants: RESTAURANTS, jobs, receipts, matchHostname: matcherFor(HOSTS) });
}

test('buildSourceWorkqueue: the latest usable observation per restaurant decides the row', () => {
  const { rows } = sampleQueue();
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['Fictief Alfa', 'Fictief Bravo', 'Fictief Charlie']);
  assert.deepEqual([byName['Fictief Alfa'].source, byName['Fictief Alfa'].menu, byName['Fictief Alfa'].action], ['reachable', 'ready_for_review', 'review']);
  assert.equal(byName['Fictief Alfa'].checkedAt, '2026-03-02T09:05:00Z');
  assert.deepEqual([byName['Fictief Bravo'].source, byName['Fictief Bravo'].menu, byName['Fictief Bravo'].action], ['access_limited', 'not_assessed', 'check_access']);
  assert.deepEqual([byName['Fictief Charlie'].menu, byName['Fictief Charlie'].action], ['structure_not_recognized', 'review_manually']);
  assert.equal(byName['Fictief Alfa'].domain, 'alfa.example.invalid');
  assert.equal(byName['Fictief Alfa'].wijk, 'Centrum');
  for (const r of rows) assert.equal(r.identityEvidence, null);
});

test('buildSourceWorkqueue: restaurants without a usable check get a plain reason, never a guessed status', () => {
  const { notInQueue } = sampleQueue();
  const byName = Object.fromEntries(notInQueue.map((r) => [r.name, r.reason]));
  assert.deepEqual(byName, {
    'Fictief Delta': 'check_not_usable',
    'Fictief Echo': 'no_website',
    'Fictief Foxtrot': 'check_in_progress',
    'Fictief Golf': 'never_checked',
  });
  for (const r of notInQueue) assert.equal(r.source, undefined);
});

test('buildSourceWorkqueue: checks that cannot be tied to exactly one known restaurant are counted, not attributed', () => {
  assert.equal(sampleQueue().unattributedChecks, 1);
});

test('buildSourceWorkqueue: every known restaurant is in exactly one place — a row or the not-in-queue list', () => {
  const { rows, notInQueue } = sampleQueue();
  const ids = [...rows, ...notInQueue].map((r) => r.restaurantId).sort();
  assert.deepEqual(ids, Object.keys(RESTAURANTS).sort());
});

test('buildSourceWorkqueue: empty or malformed input gives an empty, consistent queue', () => {
  const empty = buildSourceWorkqueue({ restaurants: {}, jobs: null, receipts: undefined, matchHostname: null });
  assert.deepEqual(empty, { rows: [], notInQueue: [], counts: { review: 0, source: 0, identity: 0, total: 0 }, unattributedChecks: 0 });
  const odd = buildSourceWorkqueue({ restaurants: { 1: { name: '' }, 2: null, 3: { name: 'Fictief Hotel' } }, jobs: [null, 5], receipts: [null], matchHostname: () => null });
  assert.deepEqual(odd.notInQueue.map((r) => [r.name, r.reason]), [['Fictief Hotel', 'no_website']]);
});

// ─── Counting ──────────────────────────────────────────────────────────────

test('countQueues: queues are mutually exclusive and always add up to the total', () => {
  const rows = [];
  for (const s of SOURCE_STATUSES) for (const m of MENU_STATUSES) rows.push(classifyRow({ sourceStatus: s, menuStatus: m }));
  const c = countQueues(rows);
  assert.equal(c.total, 16);
  assert.equal(c.review + c.source + c.identity, c.total);
  assert.deepEqual(c, { review: 3, source: 9, identity: 4, total: 16 });
  const sample = sampleQueue().counts;
  assert.deepEqual(sample, { review: 2, source: 1, identity: 0, total: 3 });
});

test('countQueues: rows without a known queue are ignored, never counted', () => {
  assert.deepEqual(countQueues([{ queue: 'x' }, null, { queue: 'review' }]), { review: 1, source: 0, identity: 0, total: 1 });
});

// ─── Sorting and filtering ────────────────────────────────────────────────

const row = (name, s, m, checkedAt, wijk = null, domain = null) => ({ name, wijk, domain, checkedAt, ...classifyRow({ sourceStatus: s, menuStatus: m }) });

test('sortRows: default "Eerst actie nodig", then oldest check, then name — input unchanged', () => {
  const rows = [
    row('Fictief Review Nieuw', 'reachable', 'ready_for_review', '2026-03-09T10:00:00Z'),
    row('Fictief Review Oud', 'reachable', 'ready_for_review', '2026-03-01T10:00:00Z'),
    row('Fictief Handmatig', 'reachable', 'structure_not_recognized', '2026-03-10T10:00:00Z'),
    row('Fictief Toegang', 'access_limited', 'not_assessed', '2026-03-08T10:00:00Z'),
    row('Fictief Kapot', 'unreachable', 'not_assessed', '2026-03-02T10:00:00Z'),
    row('Fictief Identiteit', 'identity_changed', 'not_assessed', '2026-03-11T10:00:00Z'),
  ];
  const before = rows.map((r) => r.name);
  assert.deepEqual(sortRows(rows).map((r) => r.name), [
    'Fictief Identiteit', 'Fictief Kapot', 'Fictief Toegang', 'Fictief Handmatig', 'Fictief Review Oud', 'Fictief Review Nieuw',
  ]);
  assert.deepEqual(rows.map((r) => r.name), before);
  assert.deepEqual(sortRows(rows, 'unknown-mode').map((r) => r.name), sortRows(rows).map((r) => r.name));
});

test('sortRows: "Oudste controle eerst" and "Restaurant (A–Z)"', () => {
  const rows = [row('Fictief B', 'reachable', 'ready_for_review', '2026-03-05T10:00:00Z'), row('Fictief a', 'unreachable', 'not_assessed', '2026-03-06T10:00:00Z'), row('Fictief C', 'reachable', 'ready_for_review', null)];
  assert.deepEqual(sortRows(rows, 'oldest_check').map((r) => r.name), ['Fictief C', 'Fictief B', 'Fictief a']);
  assert.deepEqual(sortRows(rows, 'name').map((r) => r.name), ['Fictief a', 'Fictief B', 'Fictief C']);
});

test('filterRows: queue, source, menu, wijk and search on name or domain', () => {
  const rows = [
    row('Fictief Alfa', 'reachable', 'ready_for_review', null, 'Centrum', 'alfa.example.invalid'),
    row('Fictief Bravo', 'unreachable', 'not_assessed', null, 'Ginneken', 'bravo.example.invalid'),
    row('Fictief Charlie', 'access_limited', 'not_assessed', null, 'Centrum', 'charlie.example.invalid'),
  ];
  assert.equal(filterRows(rows).length, 3);
  assert.deepEqual(filterRows(rows, { queue: 'source' }).map((r) => r.name), ['Fictief Bravo', 'Fictief Charlie']);
  assert.deepEqual(filterRows(rows, { source: 'unreachable' }).map((r) => r.name), ['Fictief Bravo']);
  assert.deepEqual(filterRows(rows, { menu: 'ready_for_review' }).map((r) => r.name), ['Fictief Alfa']);
  assert.deepEqual(filterRows(rows, { wijk: 'Centrum' }).map((r) => r.name), ['Fictief Alfa', 'Fictief Charlie']);
  assert.deepEqual(filterRows(rows, { query: 'BRAVO' }).map((r) => r.name), ['Fictief Bravo']);
  assert.deepEqual(filterRows(rows, { query: 'charlie.example' }).map((r) => r.name), ['Fictief Charlie']);
  assert.deepEqual(filterRows(rows, { queue: 'identity' }), []);
});

test('wijkOptions and domainOf', () => {
  assert.deepEqual(wijkOptions([{ wijk: 'Heuvel' }, { wijk: 'Centrum' }, { wijk: null }, { wijk: 'Centrum' }]), ['Centrum', 'Heuvel']);
  assert.equal(domainOf('https://www.Fictief.example.invalid/menu?x=1'), 'fictief.example.invalid');
  assert.equal(domainOf('http://fictief.example.invalid'), 'fictief.example.invalid');
  assert.equal(domainOf('ftp://fictief.example.invalid'), null);
  assert.equal(domainOf('geen url'), null);
  assert.equal(domainOf(''), null);
  assert.equal(domainOf(null), null);
});
