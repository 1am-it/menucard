'use strict';

// BE-34 (#81, criterion 1) — the row that starts the existing AI reading with
// one click, and the one-time handoff that brings that reading to the existing
// review screen. All of it is pure; no network, no browser, no AI call.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  AI_READ_API,
  AI_REVIEW_HREF,
  MANUAL_IMPORT_HREF,
  HANDOFF_PREFIX,
  MAX_HANDOFF_CHARS,
  PASTE_LABEL,
  NEXT_MANUAL_LABEL,
  REVIEW_LABEL,
  HANDOFF_FAILED,
  aiReadEstimate,
  aiReadEstimateLine,
  aiReadProgressLine,
  aiReadOutcomeLine,
  aiReadCostLine,
  aiReadFailure,
  aiReadRequestFor,
  aiReadRowKey,
  manualPasteHref,
  handoffPayload,
  stashAiRead,
  takeAiRead,
  aiReviewHref,
  aiHandoffKeyFromSearch,
} = require('./aiReadFlow');

function memoryStorage() {
  const map = new Map();
  return {
    map,
    setItem(key, value) {
      map.set(key, String(value));
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

const ROW = {
  jobId: 'job-123',
  restaurant: { id: 'rest-1', name: 'Smelt' },
  url: 'https://smelt.example/menu',
};

const READING = {
  state: 'sealed-token',
  validUntil: '2026-10-27T12:30:00.000Z',
  import: { importId: 'import-1', summary: { items: 42, valid: 39, needsReview: 3 } },
  review: { rows: [], summary: { items: 42, valid: 39, pending: 3 } },
  summary: { items: 42, valid: 39, needsReview: 3 },
  cost: { eurCents: 1, known: true },
  estimate: { label: '5 afbeeldingen' },
  notice: null,
  imageRead: true,
  plan: { mode: 'images' },
  ai: { label: 'Gelezen door AI' },
  origin: { kind: 'ai_gelezen' },
  monthly: { spentEurCents: 42 },
  // Never kept: the client has no use for it in the review screen.
  internalDebug: { validated: 'nope' },
};

test('the row uses the one existing AI route and the existing review screen', () => {
  assert.equal(AI_READ_API, '/api/internal/v1/menu-ai-import');
  assert.equal(AI_REVIEW_HREF, '/internal/menu-import');
  assert.equal(MANUAL_IMPORT_HREF, '/internal/menu-import');
  assert.equal(PASTE_LABEL, 'Liever zelf plakken');
  assert.equal(NEXT_MANUAL_LABEL, '✍️ Handmatig toevoegen');
  assert.equal(REVIEW_LABEL, 'Bekijk en controleer');
});

test('progress and outcome are the agreed words, with the real counts', () => {
  assert.equal(aiReadProgressLine(), '⏳ AI leest de kaart… ± 1 minuut');
  assert.equal(aiReadEstimateLine(), '± 1 minuut · ± 1 cent');
  assert.deepEqual(aiReadEstimate(), { durationLabel: '± 1 minuut', costLabel: '± 1 cent', label: '± 1 minuut · ± 1 cent' });
  assert.equal(aiReadOutcomeLine({ items: 42, needsReview: 3 }), '✅ 42 gerechten gelezen · 3 controle nodig');
  assert.equal(aiReadOutcomeLine({ items: 1, needsReview: 0 }), '✅ 1 gerecht gelezen · 0 controle nodig');
  // BE-36 (#87, criterion 2): a partial reading says so in the same line.
  assert.equal(
    aiReadOutcomeLine({ items: 16, needsReview: 16, pagesFailed: 1 }),
    '✅ 16 gerechten gelezen · 16 controle nodig · 1 pagina niet gelezen',
  );
  assert.equal(
    aiReadOutcomeLine({ items: 4, needsReview: 1, pagesFailed: 2 }),
    '✅ 4 gerechten gelezen · 1 controle nodig · 2 pagina\'s niet gelezen',
  );
  // Missing or nonsense counts never invent a number.
  assert.equal(aiReadOutcomeLine({}), '✅ 0 gerechten gelezen · 0 controle nodig');
});

test('the measured cost is shown, and an unmeasured one is admitted', () => {
  assert.equal(aiReadCostLine({ eurCents: 1, known: true }), 'Kosten AI: 1 cent van je maandbudget.');
  assert.match(aiReadCostLine({ known: false }), /niet gemeten/);
  assert.match(aiReadCostLine(null), /niet gemeten/);
});

test('a failure is honest per reason and always names "Handmatig toevoegen"', () => {
  const budget = aiReadFailure({ reason: 'budget_exhausted', status: 429 });
  assert.equal(budget.message, 'Het AI-budget van deze maand is op.');
  assert.equal(budget.nextLabel, NEXT_MANUAL_LABEL);
  assert.equal(budget.nextHref, MANUAL_IMPORT_HREF);

  assert.equal(aiReadFailure({ reason: 'ai_flagged_off' }).message, 'AI staat uit.');
  assert.equal(aiReadFailure({ reason: 'ai_not_configured' }).message, 'AI staat uit.');
  assert.equal(aiReadFailure({ reason: 'ai_key_missing' }).message, 'AI staat uit.');
  assert.equal(aiReadFailure({ reason: 'timeout' }).message, 'De AI-lezing duurde te lang.');
  assert.equal(aiReadFailure({ status: 504 }).message, 'De AI-lezing duurde te lang.');
  assert.equal(aiReadFailure({ status: 502 }).message, 'De AI is nu niet bereikbaar (server bezet).');
  assert.equal(aiReadFailure({ reason: 'provider_unavailable' }).message, 'De AI is nu niet bereikbaar (server bezet).');
  // The server's own Dutch message wins over the generic fallback.
  assert.equal(
    aiReadFailure({ reason: 'concept_failed', error: 'Het concept kon niet worden opgeslagen.' }).message,
    'Het concept kon niet worden opgeslagen.',
  );
  assert.equal(aiReadFailure({}).message, 'De AI-lezing lukte niet.');
  assert.equal(aiReadFailure({}).reason, null);
});

test("the request carries only the row's own job and restaurant", () => {
  assert.deepEqual(aiReadRequestFor(ROW), { job_id: 'job-123', restaurant_id: 'rest-1' });
  assert.deepEqual(aiReadRequestFor({ jobId: 'job-9' }), { job_id: 'job-9' });
  assert.deepEqual(aiReadRequestFor({ jobId: 'job-9', restaurantId: 'rest-9' }), { job_id: 'job-9', restaurant_id: 'rest-9' });
  // No job: the route may not read anything, so the row keeps its manual step.
  assert.equal(aiReadRequestFor({ url: 'https://example.nl/menu' }), null);
  assert.equal(aiReadRequestFor(null), null);
  // A URL never travels in the body.
  assert.equal('url' in aiReadRequestFor(ROW), false);
});

test('each row has one stable identity', () => {
  assert.equal(aiReadRowKey(ROW), 'job-123');
  assert.equal(aiReadRowKey({ restaurant: { id: 'rest-2' } }), 'restaurant:rest-2');
  assert.equal(aiReadRowKey(null), null);
});

test('"Liever zelf plakken" points at the existing manual import, scoped when known', () => {
  assert.equal(manualPasteHref(ROW), '/internal/menu-import?restaurant=rest-1&name=Smelt');
  assert.equal(manualPasteHref({ jobId: 'j' }), '/internal/menu-import');
});

test('the handoff keeps exactly the review fields, in this tab only', () => {
  const kept = handoffPayload(READING);
  assert.ok(kept);
  assert.equal(kept.state, 'sealed-token');
  assert.equal(kept.review.rows.length, 0);
  assert.equal('internalDebug' in kept, false);

  const storage = memoryStorage();
  const stash = stashAiRead(storage, READING);
  assert.equal(stash.ok, true);
  assert.match(stash.storageKey, new RegExp(`^${HANDOFF_PREFIX}`));
  // One entry, under the one-time key.
  assert.equal(storage.map.size, 1);

  const href = aiReviewHref(stash.key);
  assert.match(href, /^\/internal\/menu-import\?ai=/);
  const key = aiHandoffKeyFromSearch(href.slice(href.indexOf('?')));
  assert.equal(key, stash.key);

  const taken = takeAiRead(storage, key);
  assert.equal(taken.state, 'sealed-token');
  assert.equal(taken.import.importId, 'import-1');
  // Read once, gone.
  assert.equal(storage.map.size, 0);
  assert.equal(takeAiRead(storage, key), null);
});

test('the handoff refuses what it cannot carry instead of losing it silently', () => {
  const storage = memoryStorage();
  assert.deepEqual(stashAiRead(storage, { review: {} }), { ok: false, reason: 'payload_invalid' });
  assert.deepEqual(stashAiRead(storage, null), { ok: false, reason: 'payload_invalid' });
  assert.deepEqual(stashAiRead(null, READING), { ok: false, reason: 'storage_unavailable' });
  assert.deepEqual(stashAiRead({ setItem() { throw new Error('quota'); } }, READING), { ok: false, reason: 'storage_failed' });
  const huge = { ...READING, state: 'x'.repeat(MAX_HANDOFF_CHARS + 1) };
  assert.deepEqual(stashAiRead(storage, huge), { ok: false, reason: 'payload_too_large' });
  assert.equal(HANDOFF_FAILED.includes('Menuconcepten'), true);
  // A broken entry is never returned as a reading.
  storage.setItem(`${HANDOFF_PREFIX}broken`, '{not json');
  assert.equal(takeAiRead(storage, 'broken'), null);
});

test('the review address accepts only our own key shape', () => {
  assert.equal(aiHandoffKeyFromSearch('?ai=abc-123'), 'abc-123');
  assert.equal(aiHandoffKeyFromSearch('?job=1&ai=abc'), 'abc');
  assert.equal(aiHandoffKeyFromSearch('?ai='), null);
  assert.equal(aiHandoffKeyFromSearch('?ai=../../etc/passwd'), null);
  assert.equal(aiHandoffKeyFromSearch('?ai=<script>'), null);
  assert.equal(aiHandoffKeyFromSearch(''), null);
  assert.equal(aiHandoffKeyFromSearch(null), null);
  assert.equal(aiHandoffKeyFromSearch(`?ai=${'a'.repeat(121)}`), null);
  assert.equal(aiReviewHref(''), AI_REVIEW_HREF);
});
