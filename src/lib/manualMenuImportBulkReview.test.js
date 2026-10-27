'use strict';

// BE-34 (#81, criterion 3) — "Alles nagelopen" for the dishes of one image
// reading (BE-33): one button, one confirmation that names the number, one human
// decision per dish, per-dish adjustment still possible, and "Opslaan als
// concept" only after that. No AI call, no network.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  BULK_REVIEW_ACTION,
  BULK_REVIEW_NOTE,
  REOPEN_ACTION,
  bulkReviewOffer,
  bulkReviewRows,
  decideAllUnverifiable,
  decideRow,
  reopenDecision,
  reviewView,
} = require('./manualMenuImportReview');

function imageRow(id, overrides = {}) {
  return {
    id,
    state: 'unverifiable',
    code: 'image_unverified',
    label: 'Controle nodig',
    name: `Gerecht ${id}`,
    priceText: '€ 9,50',
    askAi: true,
    resolved: false,
    ...overrides,
  };
}

function reportWith(rows) {
  return {
    importId: 'import-1',
    importedAt: '2026-10-27T10:00:00.000Z',
    aiName: 'Claude',
    rows,
    summary: { items: rows.length, valid: 0, needsReview: rows.length },
    normalizations: [],
    technical: { sources: [] },
    bundleHash: 'hash',
  };
}

function threeOpenImageRows() {
  return reportWith([imageRow('a'), imageRow('b'), imageRow('c')]);
}

test('the offer names the exact number of dishes from the image', () => {
  const report = threeOpenImageRows();
  const offer = bulkReviewOffer({ report, decisions: new Map() });
  assert.equal(offer.available, true);
  assert.equal(offer.count, 3);
  assert.equal(offer.buttonLabel, '🖐 Alles nagelopen (3)');
  assert.equal(offer.confirmLabel, '3 gerechten nagelopen?');
  assert.equal(offer.confirmAction, 'Ja, alles nagelopen');
  assert.match(offer.hint, /menselijke besluit/);

  const one = bulkReviewOffer({ report: reportWith([imageRow('only')]), decisions: new Map() });
  assert.equal(one.confirmLabel, '1 gerecht nagelopen?');

  const none = bulkReviewOffer({ report: reportWith([]), decisions: new Map() });
  assert.equal(none.available, false);
  assert.equal(none.confirmLabel, '0 gerechten nagelopen?');
});

test('only dishes read from an image take part, and only while they are open', () => {
  const report = reportWith([
    imageRow('a'),
    imageRow('b', { code: 'price_variant', state: 'unsupported' }),
    imageRow('c', { code: 'quote_not_in_source', state: 'error' }),
    imageRow('d', { code: 'scan_unverified', state: 'unverifiable' }),
    imageRow('e'),
  ]);
  const decisions = new Map([['e', { rowId: 'e', action: 'confirm', at: '2026-10-27T10:01:00.000Z' }]]);
  const rows = bulkReviewRows({ report, decisions });
  assert.deepEqual(rows.map((row) => row.id), ['a']);
});

test('one confirmation records a human decision per dish and unblocks saving', () => {
  const report = threeOpenImageRows();
  const result = decideAllUnverifiable({ report, decisions: new Map(), count: 3, at: new Date('2026-10-27T10:05:00.000Z') });
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.decisions.size, 3);
  for (const id of ['a', 'b', 'c']) {
    const entry = result.decisions.get(id);
    assert.equal(entry.action, 'confirm');
    assert.equal(entry.bulk, true);
    assert.equal(entry.note, BULK_REVIEW_NOTE);
    assert.equal(entry.at, '2026-10-27T10:05:00.000Z');
  }

  const review = reviewView({ report, decisions: result.decisions, capture: null });
  assert.equal(review.summary.pending, 0);
  assert.equal(review.canSave, true);
  assert.equal(review.saveBlockReason, null);
  assert.equal(review.bulkReview.available, false);
  assert.equal(review.rows.find((row) => row.id === 'a').outcome, 'keep_bulk_reviewed');
  assert.equal(review.rows.find((row) => row.id === 'a').resolved, true);
});

test('a changed number is refused instead of closing something the human did not see', () => {
  const report = threeOpenImageRows();
  const stale = decideAllUnverifiable({ report, decisions: new Map(), count: 2 });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'count_mismatch');
  assert.match(stale.message, /3/);
  assert.equal(stale.decisions, undefined);

  assert.equal(decideAllUnverifiable({ report, decisions: new Map(), count: '3' }).ok, false);
  assert.equal(decideAllUnverifiable({ report, decisions: new Map(), count: 0 }).ok, false);
});

test('nothing to close is said out loud, never silently approved', () => {
  const onlyOwnPoints = reportWith([imageRow('a', { code: 'price_variant', state: 'unsupported' })]);
  const empty = decideAllUnverifiable({ report: onlyOwnPoints, decisions: new Map(), count: 0 });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'nothing_to_confirm');
  assert.equal(decideAllUnverifiable({ report: null, decisions: new Map(), count: 1 }).code, 'unknown_import');
});

test('adjusting one dish afterwards reopens only that row', () => {
  const report = threeOpenImageRows();
  const bulk = decideAllUnverifiable({ report, decisions: new Map(), count: 3 });
  const reopened = reopenDecision({ report, decisions: bulk.decisions, rowId: 'b' });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.decisions.has('b'), false);
  assert.equal(reopened.decisions.size, 2);
  assert.equal(reopened.row.resolved, false);

  const review = reviewView({ report, decisions: reopened.decisions, capture: null });
  assert.equal(review.summary.pending, 1);
  assert.equal(review.canSave, false);
  assert.equal(review.bulkReview.count, 1);

  assert.equal(reopenDecision({ report, decisions: new Map(), rowId: 'a' }).code, 'row_not_open');
  assert.equal(reopenDecision({ report, decisions: bulk.decisions, rowId: 'zzz' }).code, 'unknown_row');
});

test('"alles accepteren" stays forbidden; a single dish can still be confirmed alone', () => {
  const report = threeOpenImageRows();
  const acceptAll = decideRow({
    report,
    decisions: new Map(),
    decision: { acceptAll: true, action: 'confirm' },
  });
  assert.equal(acceptAll.ok, false);
  assert.equal(acceptAll.code, 'accept_all_forbidden');

  const one = decideRow({ report, decisions: new Map(), decision: { rowId: 'a', action: 'confirm' } });
  assert.equal(one.ok, true);
  assert.equal(one.decisions.get('a').bulk, undefined);
});

test('the review screen offers one confirmed button, and per-dish "Wijzig" stays', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'app/internal/menu-import/page.js'), 'utf8');
  assert.match(page, /review\.bulkReview\.buttonLabel/);
  assert.match(page, /review\.bulkReview\.confirmLabel/);
  assert.match(page, /decision: \{ action: 'confirm_all_unverifiable', count: offer\.count \}/);
  assert.match(page, /decision: \{ action: 'reopen', rowId: row\.id \}/);
  assert.match(page, /keep_bulk_reviewed/);
  // The route and its handler carry both actions.
  assert.equal(BULK_REVIEW_ACTION, 'confirm_all_unverifiable');
  assert.equal(REOPEN_ACTION, 'reopen');
});
