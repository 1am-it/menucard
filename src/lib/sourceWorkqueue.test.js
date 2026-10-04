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
  hostOf,
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

const R_ATTR = {
  1: { name: 'Fictief Alfa', website: 'https://www.fictief-a.example.invalid' },
  2: { name: 'Fictief Gedeeld Een', website: 'https://gedeeld.example.invalid' },
  3: { name: 'Fictief Gedeeld Twee', website: 'http://www.Gedeeld.example.invalid/andere-pagina' },
  4: { name: 'Fictief Zonder Schema', website: 'zonderschema.example.invalid/menu' },
};
const exactReceipt = (id) => ({ restaurant_match_type: 'exact', matched_restaurant_id: id });

test('attributeJob: a succeeded job needs host evidence AND an exact receipt for that same restaurant', () => {
  const ok = { status: 'succeeded', canonical_source_url: 'https://fictief-a.example.invalid/menu' };
  assert.equal(attributeJob(ok, exactReceipt('1'), R_ATTR), '1');
  assert.equal(attributeJob(ok, exactReceipt(1), R_ATTR), '1', 'numeric receipt id');
  assert.equal(attributeJob(ok, exactReceipt('2'), R_ATTR), null, 'receipt names another restaurant');
  assert.equal(attributeJob(ok, { restaurant_match_type: 'none', matched_restaurant_id: null }, R_ATTR), null);
  assert.equal(attributeJob(ok, { restaurant_match_type: 'multiple', matched_restaurant_id: '1' }, R_ATTR), null);
  assert.equal(attributeJob(ok, null, R_ATTR), null, 'missing receipt');
  // A receipt id is never an exemption from the host check.
  assert.equal(attributeJob({ status: 'succeeded', canonical_source_url: 'https://elders.example.invalid/' }, exactReceipt('1'), R_ATTR), null);
  assert.equal(attributeJob({ status: 'succeeded' }, exactReceipt('1'), R_ATTR), null, 'no checked URL');
});

test('attributeJob: a failed job uses exactly one restaurant with the same current host — www, case, scheme and path do not matter', () => {
  for (const url of ['https://www.fictief-a.example.invalid/menu', 'http://FICTIEF-A.example.invalid', 'https://fictief-a.example.invalid./x?y']) {
    assert.equal(attributeJob({ status: 'failed', canonical_source_url: url }, null, R_ATTR), '1', url);
  }
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://zonderschema.example.invalid/' }, null, R_ATTR), '4', 'website without a scheme');
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://gedeeld.example.invalid/' }, null, R_ATTR), null, 'two restaurants share the host');
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://onbekend.example.invalid/' }, null, R_ATTR), null);
  assert.equal(attributeJob({ status: 'failed', canonical_source_url: 'https://fictief-a.example.invalid/' }, null, null), null);
  assert.equal(attributeJob(null, null, R_ATTR), null);
});

test('hostOf: pure normalization — scheme optional, www/case/trailing dot removed, everything else null', () => {
  assert.equal(hostOf('https://www.Fictief.example.invalid/menu?x=1'), 'fictief.example.invalid');
  assert.equal(hostOf('fictief.example.invalid/menu'), 'fictief.example.invalid');
  assert.equal(hostOf('WWW.fictief.example.invalid'), 'fictief.example.invalid');
  assert.equal(hostOf('//fictief.example.invalid/x'), 'fictief.example.invalid');
  assert.equal(hostOf('https://fictief.example.invalid.'), 'fictief.example.invalid');
  for (const bad of ['ftp://fictief.example.invalid', 'mailto:x@fictief.example.invalid', 'javascript:alert(1)', 'geen url', 'localhost', '', '   ', null, 42]) {
    assert.equal(hostOf(bad), null, String(bad));
  }
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
  return buildSourceWorkqueue({ restaurants: RESTAURANTS, jobs, receipts });
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
  const empty = buildSourceWorkqueue({ restaurants: {}, jobs: null, receipts: undefined });
  assert.deepEqual(empty, { rows: [], notInQueue: [], counts: { review: 0, source: 0, identity: 0, total: 0 }, unattributedChecks: 0 });
  const odd = buildSourceWorkqueue({ restaurants: { 1: { name: '' }, 2: null, 3: { name: 'Fictief Hotel' } }, jobs: [null, 5], receipts: [null] });
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

test('attributeJob: a receipt that is not an exact match is never attributed, even when it carries an id', () => {
  const job = { status: 'succeeded', canonical_source_url: 'https://fictief-a.example.invalid/' };
  assert.equal(attributeJob(job, { restaurant_match_type: 'multiple', matched_restaurant_id: '1' }, R_ATTR), null);
  assert.equal(attributeJob(job, { restaurant_match_type: 'none', matched_restaurant_id: '1' }, R_ATTR), null);
});

test('buildSourceWorkqueue: the newest usable check wins regardless of input order (the route reads newest first)', () => {
  const restaurants = { 1: { name: 'Fictief Alfa', buurt: 'Centrum', website: 'https://alfa.example.invalid' } };
  const newer = { id: 'n', canonical_source_url: 'https://alfa.example.invalid/', status: 'failed', error_reason: 'fetch_failed', created_at: '2026-03-05T10:00:00Z', updated_at: '2026-03-05T10:01:00Z' };
  const older = { id: 'o', canonical_source_url: 'https://alfa.example.invalid/', status: 'failed', error_reason: 'robots_disallowed', created_at: '2026-03-01T10:00:00Z', updated_at: '2026-03-01T10:01:00Z' };
  for (const jobs of [[newer, older], [older, newer]]) {
    const { rows } = buildSourceWorkqueue({ restaurants, jobs, receipts: [] });
    assert.deepEqual([rows[0].source, rows[0].checkedAt], ['unreachable', '2026-03-05T10:01:00Z']);
  }
});

// ─── Review fix B1: host evidence is required for every job ───────────────

const menuReceipt = (id, rid) => ({ id, restaurant_match_type: 'exact', matched_restaurant_id: rid, menus: [{ name: 'F', categories: [{ name: 'F', items: [{ name: 'Fictief gerecht' }] }] }] });
const okJob = (id, host, receiptId, createdAt) => ({ id, canonical_source_url: `https://${host}/`, status: 'succeeded', result_receipt_id: receiptId, unknown_menu_contexts: [], created_at: createdAt, updated_at: createdAt });
const failJob = (id, host, reason, createdAt, status = 'failed') => ({ id, canonical_source_url: `https://${host}/`, status, error_reason: reason, created_at: createdAt, updated_at: createdAt });
const statusOf = (q, name) => q.rows.find((r) => r.name === name) || q.notInQueue.find((r) => r.name === name);

test('B1: a restaurant whose website changed never gets a status from a check of its old domain', () => {
  const restaurants = { g: { name: 'Fictief G', website: 'https://nieuw-g.example.invalid' } };
  const q = buildSourceWorkqueue({ restaurants, jobs: [okJob('j1', 'oud-g.example.invalid', 'r1', '2026-10-01T10:00:00Z')], receipts: [menuReceipt('r1', 'g')] });
  assert.equal(q.rows.length, 0, 'no green status for a domain that was never checked');
  assert.equal(statusOf(q, 'Fictief G').reason, 'check_ambiguous');
  assert.equal(q.unattributedChecks, 1);
});

test('B1: an old domain that now belongs to another restaurant gives neither restaurant the old green status', () => {
  const restaurants = { g: { name: 'Fictief G', website: '' }, h: { name: 'Fictief H', website: 'https://www.domein.example.invalid' } };
  const receipts = [menuReceipt('r1', 'g')];
  const onlyOld = buildSourceWorkqueue({ restaurants, jobs: [okJob('j1', 'domein.example.invalid', 'r1', '2026-09-01T10:00:00Z')], receipts });
  assert.equal(onlyOld.rows.length, 0);
  assert.equal(statusOf(onlyOld, 'Fictief G').reason, 'check_ambiguous');
  assert.equal(statusOf(onlyOld, 'Fictief H').reason, 'check_ambiguous');
  assert.equal(onlyOld.unattributedChecks, 1);
  const both = buildSourceWorkqueue({
    restaurants,
    jobs: [okJob('j1', 'domein.example.invalid', 'r1', '2026-09-01T10:00:00Z'), failJob('j2', 'DOMEIN.example.invalid', 'fetch_failed', '2026-10-01T10:00:00Z')],
    receipts,
  });
  assert.deepEqual(both.rows.map((r) => [r.name, r.source, r.menu]), [['Fictief H', 'unreachable', 'not_assessed']]);
  assert.equal(statusOf(both, 'Fictief G').reason, 'check_ambiguous');
  assert.equal(both.unattributedChecks, 1);
});

test('B1: restaurants sharing a host are never attributed — all of them get "Controle niet eenduidig te koppelen"', () => {
  const restaurants = { b: { name: 'Fictief B', website: 'https://gedeeld.example.invalid/b' }, c: { name: 'Fictief C', website: 'gedeeld.example.invalid/c' } };
  const jobs = [failJob('j1', 'GEDEELD.example.invalid', 'fetch_failed', '2026-10-01T10:00:00Z'), okJob('j2', 'www.gedeeld.example.invalid', 'r2', '2026-10-02T10:00:00Z')];
  const q = buildSourceWorkqueue({ restaurants, jobs, receipts: [menuReceipt('r2', 'b')] });
  assert.equal(q.rows.length, 0);
  assert.deepEqual(q.notInQueue.map((r) => [r.name, r.reason]), [['Fictief B', 'check_ambiguous'], ['Fictief C', 'check_ambiguous']]);
  assert.equal(q.unattributedChecks, 2);
});

test('B1: a receipt id for an unknown restaurant, or a missing receipt, is never green and is counted', () => {
  const restaurants = { x: { name: 'Fictief X', website: 'https://x.example.invalid' } };
  const unknownId = buildSourceWorkqueue({ restaurants, jobs: [okJob('j1', 'x.example.invalid', 'r1', '2026-10-01T10:00:00Z')], receipts: [menuReceipt('r1', 'bestaat-niet')] });
  assert.equal(unknownId.rows.length, 0);
  assert.equal(statusOf(unknownId, 'Fictief X').reason, 'check_ambiguous');
  assert.equal(unknownId.unattributedChecks, 1);
  const noReceipt = buildSourceWorkqueue({ restaurants, jobs: [okJob('j1', 'x.example.invalid', 'r-missing', '2026-10-01T10:00:00Z')], receipts: [] });
  assert.equal(noReceipt.rows.length, 0);
  assert.equal(statusOf(noReceipt, 'Fictief X').reason, 'check_ambiguous');
  assert.equal(noReceipt.unattributedChecks, 1);
});

test('B1: a job for a nameless restaurant entry is counted as unattributed, never silently dropped', () => {
  const restaurants = { n: { name: '   ', website: 'https://naamloos.example.invalid' }, y: { name: 'Fictief Y', website: 'https://y.example.invalid' } };
  const q = buildSourceWorkqueue({ restaurants, jobs: [failJob('j1', 'naamloos.example.invalid', 'fetch_failed', '2026-10-01T10:00:00Z')], receipts: [] });
  assert.equal(q.unattributedChecks, 1);
  assert.deepEqual(q.notInQueue.map((r) => [r.name, r.reason]), [['Fictief Y', 'never_checked']]);
});

test('B1: across mixed scenarios, a row only ever comes from evidence on the restaurant\'s own current host', () => {
  const restaurants = {
    a: { name: 'Fictief A', website: 'https://a.example.invalid' },
    b: { name: 'Fictief B', website: 'https://nieuw-b.example.invalid' },
    c: { name: 'Fictief C', website: 'https://gedeeld.example.invalid' },
    d: { name: 'Fictief D', website: 'gedeeld.example.invalid' },
  };
  const jobs = [
    okJob('j1', 'a.example.invalid', 'r1', '2026-10-01T10:00:00Z'),
    okJob('j2', 'oud-b.example.invalid', 'r2', '2026-10-01T10:00:00Z'),
    okJob('j3', 'gedeeld.example.invalid', 'r3', '2026-10-01T10:00:00Z'),
    okJob('j4', 'a.example.invalid', 'r4', '2026-10-02T10:00:00Z'), // receipt names b, host is a's
  ];
  const receipts = [menuReceipt('r1', 'a'), menuReceipt('r2', 'b'), menuReceipt('r3', 'c'), menuReceipt('r4', 'b')];
  const q = buildSourceWorkqueue({ restaurants, jobs, receipts });
  assert.deepEqual(q.rows.map((r) => [r.restaurantId, r.domain, r.checkedAt]), [['a', 'a.example.invalid', '2026-10-01T10:00:00Z']]);
  assert.equal(q.unattributedChecks, 3);
  assert.equal(q.counts.total, q.rows.length);
  assert.deepEqual(q.notInQueue.map((r) => [r.restaurantId, r.reason]), [['b', 'check_ambiguous'], ['c', 'check_ambiguous'], ['d', 'check_ambiguous']]);
});

// ─── Review fixes: in-progress only when nothing newer finished ───────────

test('a running or pending check only counts as "Controle loopt nog" when no terminal check is newer', () => {
  const restaurants = { p: { name: 'Fictief P', website: 'https://p.example.invalid' } };
  const run = (jobs) => statusOf(buildSourceWorkqueue({ restaurants, jobs, receipts: [] }), 'Fictief P').reason;
  assert.equal(run([failJob('j1', 'p.example.invalid', null, '2026-01-01T10:00:00Z', 'running'), failJob('j2', 'p.example.invalid', 'internal_error', '2026-10-01T10:00:00Z')]), 'check_not_usable', 'stuck old running job');
  assert.equal(run([failJob('j1', 'p.example.invalid', 'internal_error', '2026-01-01T10:00:00Z'), failJob('j2', 'p.example.invalid', null, '2026-10-01T10:00:00Z', 'running')]), 'check_in_progress');
  assert.equal(run([failJob('j1', 'p.example.invalid', null, '2026-10-01T10:00:00Z', 'pending')]), 'check_in_progress', 'pending counts as in progress');
  assert.equal(run([]), 'never_checked');
});

test('a running check never hides an existing usable row', () => {
  const restaurants = { p: { name: 'Fictief P', website: 'https://p.example.invalid' } };
  const q = buildSourceWorkqueue({ restaurants, jobs: [failJob('j1', 'p.example.invalid', 'robots_disallowed', '2026-09-01T10:00:00Z'), failJob('j2', 'p.example.invalid', null, '2026-10-01T10:00:00Z', 'running')], receipts: [] });
  assert.deepEqual(q.rows.map((r) => r.source), ['access_limited']);
});

test('no website and no evidence is "Geen website bekend"; a website without checks is "Nog nooit gecontroleerd"', () => {
  const q = buildSourceWorkqueue({ restaurants: { a: { name: 'Fictief A', website: '' }, b: { name: 'Fictief B', website: 'b.example.invalid' } }, jobs: [], receipts: [] });
  assert.deepEqual(q.notInQueue.map((r) => [r.name, r.reason, r.domain]), [['Fictief A', 'no_website', null], ['Fictief B', 'never_checked', 'b.example.invalid']]);
});

test('observeJob: inherited object members are never an error-reason mapping', () => {
  for (const reason of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.deepEqual(observeJob({ status: 'failed', error_reason: reason }, null), { kind: 'unusable' }, reason);
  }
});
